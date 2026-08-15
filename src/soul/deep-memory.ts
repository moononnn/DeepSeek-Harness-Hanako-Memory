/**
 * Deep Memory：每日任务 Step5。
 *
 * 遍历「摘要 ≠ 快照」的脏 session，提取 diff 中的新增内容，调 LLM 拆成
 * 元事实（fact + tags + time），批量写入 FactStore。
 *
 * 语义照抄 Hana `lib/memory/deep-memory.ts`（v0.446.6 产物）：
 * - 分批处理，每批最多 MAX_CONCURRENT = 3 个并行 LLM 调用；
 * - 提取带时间上下文（时区 / 会话来源时间范围 / 本地日期）；
 * - temperature = 0.3，maxTokens = 4096；
 * - 失败重试：连续失败 < MAX_RETRIES(3) 下次继续，>= 3 次跳过该 session；
 *   失败计数 TTL 60 分钟，过期清理。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
import { callText } from "./llm.js";
import { SessionSummaryStore } from "./rolling-summary.js";
import type { FactStore } from "./fact-store.js";
import { getLogicalDay, shiftLogicalDate } from "./logical-day.js";

export const MAX_CONCURRENT = 3;
export const MAX_RETRIES = 3;
export const FAIL_COUNT_TTL_MS = 60 * 60 * 1000; // 60 分钟
export interface DirtySession {
  sessionId: string;
  summary: string;
  previousSnapshot: string;
  sourceTimeRange: { start: number; end: number } | null;
  updatedAt: string;
  factReplacementRequired?: boolean;
}

export interface ProcessResult {
  processed: number;
  factsAdded: number;
}

/* ------------------------------------------------------------------ */
/* 时间上下文与时间规范化（照抄 Hana buildFactTimeContext / normalizeFactTime） */
/* ------------------------------------------------------------------ */

interface TimeContext {
  timezone: string;
  sourceRange: { start: string; end: string } | null;
  localDates: string[];
  summaryDateTimes: string[];
  summaryDates: string[];
  summaryTimes: string[];
  singleSourceDate: string | null;
  spansMultipleSourceDates: boolean;
}

const DATETIME_PATTERN = /\b(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})\b/g;
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/g;
const TIME_PATTERN = /\b(\d{2}):(\d{2})\b/g;

/** 会话来源时间范围 → 本地日期列表。 */
function localDatesFromRange(range: { start: number; end: number } | null, timeZone: string): string[] {
  if (!range) return [];
  const start = getLogicalDay(range.start, timeZone).logicalDate;
  const end = getLogicalDay(range.end, timeZone).logicalDate;
  const dates = new Set<string>([start]);
  // 逐步推进最多 60 天，覆盖跨日会话
  let current = start;
  let guard = 0;
  while (current !== end && guard < 60) {
    current = shiftLogicalDate(current, 1);
    dates.add(current);
    guard += 1;
  }
  return [...dates];
}

/** 构建时间上下文（照抄 Hana buildTimeContextBlock 语义）。 */
export function buildFactTimeContext(
  sourceTimeRange: { start: number; end: number } | null,
  summaryText: string,
  timeZone: string,
): TimeContext {
  const localDates = localDatesFromRange(sourceTimeRange, timeZone);
  const summaryDateTimes: string[] = [];
  const summaryDates: string[] = [];
  const summaryTimes: string[] = [];
  for (const match of String(summaryText).matchAll(DATETIME_PATTERN)) summaryDateTimes.push(`${match[1]}T${match[2]}:${match[3]}`);
  for (const match of String(summaryText).matchAll(DATE_PATTERN)) summaryDates.push(match[1]);
  for (const match of String(summaryText).matchAll(TIME_PATTERN)) summaryTimes.push(`${match[1]}:${match[2]}`);
  const singleSourceDate = localDates.length === 1 ? localDates[0] : null;
  const spansMultipleSourceDates = localDates.length > 1;
  return {
    timezone: timeZone,
    sourceRange: sourceTimeRange ? { start: new Date(sourceTimeRange.start).toISOString(), end: new Date(sourceTimeRange.end).toISOString() } : null,
    localDates,
    summaryDateTimes,
    summaryDates,
    summaryTimes,
    singleSourceDate,
    spansMultipleSourceDates,
  };
}

/** 时间上下文渲染块（照抄 Hana buildTimeContextBlock 中文语义）。 */
export function buildTimeContextBlock(context: TimeContext, isZh: boolean): string {
  const sourceRange = context.sourceRange ? `${context.sourceRange.start || "?"} → ${context.sourceRange.end || "?"}` : isZh ? "未知" : "unknown";
  const localDates = context.localDates.length > 0 ? context.localDates.join(", ") : isZh ? "未知" : "unknown";
  const summaryTimes = context.summaryTimes.length > 0 ? context.summaryTimes.join(", ") : isZh ? "（无）" : "(none)";
  return isZh
    ? `## 时间上下文\n- 时区：${context.timezone}\n- 会话来源时间范围：${sourceRange}\n- 会话来源本地日期：${localDates}\n- 摘要中明确出现的时间：${summaryTimes}`
    : `## Time Context\n- Timezone: ${context.timezone}\n- Session source range: ${sourceRange}\n- Session source local dates: ${localDates}\n- Explicit times in summary: ${summaryTimes}`;
}

/** 时间规范化（照抄 Hana normalizeFactTime 语义）：只允许时间上下文或摘要明确出现的日期。 */
export function normalizeFactTime(time: unknown, context: TimeContext): string | null {
  if (time == null) return null;
  const raw = String(time).trim();
  if (!raw) return null;
  const datetime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (datetime) {
    const full = `${datetime[1]}T${datetime[2]}:${datetime[3]}`;
    if (context.summaryDateTimes.includes(full)) return full;
    if (context.summaryDates.includes(datetime[1])) return full;
    if (context.singleSourceDate === datetime[1]) return full;
    return null;
  }
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (dateOnly) {
    return context.summaryDates.includes(dateOnly[1]) || context.singleSourceDate === dateOnly[1] ? dateOnly[1] : null;
  }
  const hhmm = /^(\d{2}):(\d{2})$/.exec(raw);
  if (hhmm) {
    const timeKey = `${hhmm[1]}:${hhmm[2]}`;
    if (!context.summaryTimes.includes(timeKey)) return null;
    if (context.singleSourceDate && !context.spansMultipleSourceDates) return `${context.singleSourceDate}T${timeKey}`;
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 事实提取 prompt（照抄 Hana fact-extraction.v1 中文模板）              */
/* ------------------------------------------------------------------ */

function isZh(locale = "zh-CN"): boolean {
  return String(locale).startsWith("zh");
}

export function buildFactExtractionSystemPrompt(hasPrevious: boolean, locale = "zh-CN"): string {
  if (isZh(locale)) {
    return `你是一个记忆拆分器。${hasPrevious ? `你会收到两部分输入：
1. **上次快照**：上次已处理的摘要内容
2. **当前摘要**：最新的完整摘要

请找出"当前摘要"相对于"上次快照"新增或变化的内容，将其拆分成独立的元事实。
已经在上次快照中存在的内容不要重复提取。` : "将以下摘要内容拆分成独立的元事实。"}

## 规则

1. 只提取用户画像和粗颗粒近况相关的客观事实。
   用户画像包括：身份、人格特质、审美、兴趣、喜欢或讨厌的事物、长期关系、长期关注方向。
   粗颗粒近况包括：用户最近关注的领域/项目/主题，例如"记忆系统""Project Hana""AI Agent"。

2. 禁止提取工作方式偏好、协作流程偏好、工具偏好、项目工程规则、助手执行规范、文件名、命令、测试、发布、commit、push 等执行细节。
   如果一条事实描述的是"以后遇到类似任务应该怎么做"，它应进入经验库或技能，不进入记忆事实。
   如果一条事实描述的是某个主题里的具体子问题、具体方案、具体改法，也不要提取。

3. 每条事实必须是原子的（一条只记一件事）。
   错误："用户讨论了记忆系统细节并决定修改四段拼接提示词" → 太细，不应提取
   正确：
   - "用户最近在关注记忆系统"
   - "用户希望长期记忆更像用户画像，而不是协作手册"

4. 标签用于后续检索，选择有辨识度的关键词，2~5 个。
   标签选择原则：人名、项目名、技术名词、主题类别等

5. time 字段从摘要中的时间标注和"时间上下文"提取，格式 YYYY-MM-DDTHH:MM。
   只使用摘要正文明确出现的日期，或"时间上下文"提供的会话来源本地日期。
   如果摘要只有 HH:MM，且时间上下文只有一个会话来源本地日期，结合该日期和时间标注推算完整时间。
   如果摘要只有 HH:MM，但时间上下文显示会话跨多个本地日期，填 null。
   如果无法确定具体时间，填 null。

6. 不要提取助手的内心活动，只提取客观事实和事件。

7. 如果没有新增内容值得提取，返回空数组 []。

## 输出格式

严格 JSON 数组，不要 markdown 代码块：
[
  {"fact": "用户最近在关注记忆系统", "tags": ["记忆系统", "近况"], "time": null},
  {"fact": "用户希望长期记忆更像用户画像，而不是协作手册", "tags": ["用户画像", "长期记忆", "边界"], "time": null}
]`;
  }
  return `You are a memory splitter. ${hasPrevious ? `You will receive two inputs:
1. **Previous Snapshot**: the summary content from last processing
2. **Current Summary**: the latest full summary

Find content that is new or changed in "Current Summary" compared to "Previous Snapshot", and split it into independent atomic facts.
Do not re-extract content that already exists in the previous snapshot.` : "Split the following summary content into independent atomic facts."}

## Rules

1. Extract only objective facts about the user profile and coarse current state.
   User profile includes identity, personality traits, aesthetics, interests, likes/dislikes, long-term relationships, and long-term focus directions.
   Coarse current state includes the broad domain/project/theme the user is currently focused on, e.g. "memory systems", "Project Hana", "AI Agent".

2. Do NOT extract work-style preferences, collaboration-process preferences, tool preferences, project engineering rules, assistant execution norms, filenames, commands, tests, releases, commits, pushes, or other execution details.
   If a fact describes "how to do a similar task in the future", it belongs to the experience library or skills, not memory facts.
   If a fact describes a specific subproblem, concrete solution, or specific change inside a theme, do not extract it either.

3. Each fact must be atomic (one fact per entry).

4. Tags are for later retrieval; choose distinctive keywords, 2-5 per fact.
   Tag selection: names, project names, technical terms, theme categories, etc.

5. The time field is extracted from timestamps in the summary and the "time context", formatted YYYY-MM-DDTHH:MM.
   Use only dates explicitly present in the summary body or the session source local dates from the "time context".
   If the summary has only HH:MM and the time context has a single session source local date, combine them into a full time.
   If the summary has only HH:MM but the time context shows the session spans multiple local dates, use null.
   If a concrete time cannot be determined, use null.

6. Do not extract the assistant's inner thoughts; extract only objective facts and events.

7. If there is nothing new worth extracting, return an empty array [].

## Output Format

Strict JSON array, no markdown code blocks:
[
  {"fact": "The user is currently focused on memory systems", "tags": ["memory systems", "current state"], "time": null}
]`;
}

/** 提取输入构建（照抄 Hana LLe 语义）。 */
export function buildFactExtractionInput(currentSummary: string, previousSnapshot: string, timeContext: TimeContext): string {
  const zh = isZh();
  const contextBlock = buildTimeContextBlock(timeContext, zh);
  const hasPrevious = !!previousSnapshot.trim();
  return hasPrevious
    ? `${contextBlock}\n\n${zh ? "## 上次快照" : "## Previous Snapshot"}\n\n${previousSnapshot}\n\n${zh ? "## 当前摘要" : "## Current Summary"}\n\n${currentSummary}`
    : `${contextBlock}\n\n${zh ? "## 摘要内容" : "## Summary Content"}\n\n${currentSummary}`;
}

export interface ExtractedFact {
  fact: string;
  tags: string[];
  time: string | null;
}

/** 解析 LLM 返回的 JSON 数组（兼容 markdown 代码块包裹）。 */
export function parseExtractedFacts(text: string): ExtractedFact[] {
  const cleaned = String(text || "").trim();
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  const jsonText = (match ? match[1] : cleaned).trim();
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("deep memory fact extraction returned non-array JSON");
  return parsed
    .filter((item) => item && typeof item.fact === "string" && item.fact.length > 0)
    .map((item) => ({
      fact: String(item.fact),
      tags: Array.isArray(item.tags) ? item.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
      time: typeof item.time === "string" && item.time.trim() ? item.time.trim() : null,
    }));
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

export interface DeepMemoryOptions {
  ctx: Context;
  paths: ProfilePaths;
  store: SessionSummaryStore;
  factStore: FactStore;
  provider: string;
  model: string;
  timeZone?: string;
  now?: number;
  /** 失败计数覆盖（测试用）。 */
  failCounts?: Map<string, { count: number; lastUpdated: number }>;
}

/**
 * 处理脏 session：提取元事实 → 写库 → 标记已处理。
 * @returns { processed, factsAdded }
 */
export async function processDirtySessions(options: DeepMemoryOptions): Promise<ProcessResult> {
  const { ctx, store, factStore, provider, model } = options;
  const timeZone = options.timeZone || "UTC";
  const failCounts = options.failCounts ?? new Map<string, { count: number; lastUpdated: number }>();

  const dirty = store.getDirtySessions();
  if (dirty.length === 0) return { processed: 0, factsAdded: 0 };

  let factsAdded = 0;
  const nowMs = options.now ?? Date.now();

  // TTL 清理：过期的失败计数清除
  for (const [sessionId, record] of failCounts) {
    if (nowMs - record.lastUpdated > FAIL_COUNT_TTL_MS) failCounts.delete(sessionId);
  }

  const processOne = async (record: { session_id: string; summary: string; snapshot: string; source_time_range: { start: number; end: number } | null }): Promise<void> => {
    const sessionId = record.session_id;
    const timeContext = buildFactTimeContext(record.source_time_range, record.summary, timeZone);
    const input = buildFactExtractionInput(record.summary, record.snapshot, timeContext);
    try {
      const text = await callText(ctx, {
        provider,
        model,
        system: buildFactExtractionSystemPrompt(!!record.snapshot.trim()),
        prompt: input,
        maxTokens: 4096,
        operation: "extract_facts",
        temperature: 0.3,
      });
      const facts = parseExtractedFacts(text).map((fact) => ({
        ...fact,
        time: normalizeFactTime(fact.time, timeContext),
        session_id: sessionId,
      }));
      if (facts.length > 0) factStore.addBatch(facts);
      store.markProcessed(sessionId);
      factsAdded += facts.length;
      failCounts.delete(sessionId);
      ctx.logger.info(`[assistant-soul] Deep Memory: ${sessionId.slice(0, 8)}... 提取 ${facts.length} 条元事实`);
    } catch (error) {
      const record = failCounts.get(sessionId) ?? { count: 0, lastUpdated: nowMs };
      record.count += 1;
      record.lastUpdated = nowMs;
      failCounts.set(sessionId, record);
      if (record.count >= MAX_RETRIES) {
        ctx.logger.warn(`[assistant-soul] Deep Memory: ${sessionId.slice(0, 8)}... 连续失败 ${record.count} 次，标记跳过: ${String(error)}`);
        store.markProcessed(sessionId);
        failCounts.delete(sessionId);
      } else {
        ctx.logger.warn(`[assistant-soul] Deep Memory: ${sessionId.slice(0, 8)}... 处理失败 ${record.count}/${MAX_RETRIES}: ${String(error)}`);
      }
    }
  };

  // 分批并行（MAX_CONCURRENT = 3）
  for (let index = 0; index < dirty.length; index += MAX_CONCURRENT) {
    const batch = dirty.slice(index, index + MAX_CONCURRENT);
    await Promise.allSettled(batch.map(processOne));
  }
  return { processed: dirty.length, factsAdded };
}

/** 读脏 session 列表（供测试/调试）。 */
export function listDirtySessions(paths: ProfilePaths): DirtySession[] {
  const store = new SessionSummaryStore(paths);
  return store.getDirtySessions().map((record) => ({
    sessionId: record.session_id,
    summary: record.summary,
    previousSnapshot: record.snapshot,
    sourceTimeRange: record.source_time_range,
    updatedAt: record.updated_at,
  }));
}

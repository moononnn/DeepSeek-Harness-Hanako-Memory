/**
 * 分层编译：today / week / longterm / facts 四个独立窗口 + assemble。
 *
 * 每个编译函数带指纹缓存（`{outputPath}.fingerprint`，MD5）：
 * 输入无变化 → `"skipped"`，跳过 LLM 调用；编译失败不覆盖旧数据。
 *
 * 中文 prompt 语义照抄 Hana `lib/memory/compile.ts`（v0.446.6 产物）：
 * - compileToday：compile-today.v2（用户近况与大主题清单，3-5 条 ≤300 字）
 * - compileWeek：compile-week 语义（7 天窗口 → 本周用户主题概要，3-5 条 ≤400 字）
 * - compileLongterm：compile-longterm.v1（week fold 进长期画像 ≤400 字）
 * - compileFacts：compile-editable-facts.v1（30 天新摘要提取事实段 + 旧 facts 去重 ≤300 字）
 */
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
import { atomicWriteFileSync } from "./atomic.js";
import { computeListFingerprint, shouldCompile, writeFingerprint } from "./fingerprint.js";
import { callText } from "./llm.js";
import { getLogicalDay, getLogicalDayFromDate, shiftLogicalDate } from "./logical-day.js";
import { extractFactSection, hasFactSectionHeading, isEmptyFactSection, SessionSummaryStore } from "./rolling-summary.js";
import { normalizeCompiledSectionBody, readMemorySectionBody, writeMemorySectionBody, parseMemoryMd, readMemoryMd } from "./compiled-snapshot.js";

/* ------------------------------------------------------------------ */
/* 中文 prompt（照抄 Hana bundle 产物）                                 */
/* ------------------------------------------------------------------ */

function isZh(locale = "zh-CN"): boolean {
  return String(locale).startsWith("zh");
}

/** compileToday system prompt（照抄 compile-today.v2 中文模板）。 */
export function buildCompileTodaySystemPrompt(locale = "zh-CN"): string {
  return isZh(locale)
    ? `你会收到「上一版今日草稿」和「新增或修订的时间线条目（delta）」，请据此更新出一份新的"用户近况与大主题清单"草稿。

处理原则：
- 上一版草稿是今天已经沉淀的内容，默认保留；delta 里标注"取代先前相关记述"的条目，说明对应的旧内容已经过时或不准确，请用它更新/替换草稿里的相关部分，而不是并列保留新旧两种说法
- delta 里没有标注"取代"的条目是今天新发生的事，正常并入
- 把同一主题/项目的多次往返归并为一件事，不要逐条流水账
- 每条输出必须保留粗时间锚点，例如"上午"、"07:20 左右"、"傍晚"；不要把时间完全删掉
- 记忆的核心职责是维护用户模型，优先记录用户是谁、喜欢什么、在意什么、最近关注什么
- 工作相关内容只允许保留到大主题层级：只写用户最近关注的领域/项目/主题，不写该主题里的细节

可以记录：
- 用户的身份、人格特质、审美、兴趣、喜欢或讨厌的事物
- 用户最近关注的大主题，例如"记忆系统""Project Hana""AI Agent"
- 用户生活、创作、关系或长期关注方向的变化

不要记录：
- 不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节
- 任务过程中的方法论选择、工具偏好、格式要求、术语规则
- 具体子问题、具体方案、具体改法、具体测试或发布流程
- 助手具体产出的内容（"生成了一篇关于 X 的文章"够了，不要摘录文章内容）
- 来回修改、重试、被打断又恢复这类过程波动

输出 3-5 条粗颗粒事件，每条 1-2 句。最多 300 字。一天平淡就写得短。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`
    : `You will receive the "previous today draft" and "new or revised timeline entries (delta)". Update them into a new "user-current-state and broad-theme list" draft.

Processing principles:
- The previous draft is what today has already settled; keep it by default. Delta entries marked "supersedes prior mention" mean the corresponding old content is outdated or inaccurate — use them to update/replace the related part of the draft rather than keeping both the old and new statements side by side
- Delta entries without a "supersedes" marker are new things that happened today; merge them in normally
- Merge multiple back-and-forth on the same topic/project into ONE event; do not enumerate line by line
- Each output item must keep a coarse time anchor, such as "morning", "around 07:20", or "evening"; do not remove time entirely
- Memory's core job is to maintain a user model: prioritize who the user is, what they like, what they care about, and what they are broadly focused on recently
- Work-related content may only be kept at the broad-theme level: record the domain/project/theme, not details inside that theme

May record:
- The user's identity, personality traits, aesthetics, interests, likes, and dislikes
- Broad themes the user is currently focused on, such as "memory systems", "Project Hana", or "AI Agent"
- Changes in the user's life, creative work, relationships, or long-term areas of attention

Do NOT record:
- Execution steps, filenames, tools, commands, validation order, collaboration preferences, or work details
- Task-level methodology choices, tool preferences, format requirements, terminology rules
- Specific subproblems, concrete solutions, concrete code changes, tests, or release flows
- Specific content of assistant's output ("wrote an article about X" is enough; do not excerpt the article)
- Revisions, retries, interruptions and resumptions — these are process noise

Output 3-5 coarse events, 1-2 sentences each. Max 180 words. Keep it short on quiet days. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`;
}

/** compileWeek system prompt（7 天窗口 → 本周用户主题概要 ≤400 字）。 */
export function buildCompileWeekSystemPrompt(locale = "zh-CN"): string {
  return isZh(locale)
    ? `你会收到过去 7 天的时间线条目或"今日草稿"（每天结束时对用户近况的整理稿），请把它们蒸馏成一份"本周用户主题概要"。

关键定位：这是给长期记忆折叠用的一周概览，不是详细日志。读的人只需要一眼看出这一周大致发生了什么、用户在关注什么。

提炼原则：
- 把同一主题/项目的多次往返归并为一件事，不要逐条流水账
- 保留这一周的粗时间感，例如"周一上午"、"周三"或一个代表性 HH:MM；不要写成无时间锚点的主题标签
- 记忆的核心职责是维护用户模型：优先记录用户是谁、喜欢什么、在意什么、这一周关注什么
- 工作相关内容只允许保留到大主题层级：只写用户这一周关注的领域/项目/主题，不写该主题里的细节

不要记录：
- 不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节
- 任务过程中的方法论选择、工具偏好、格式要求、术语规则
- 具体子问题、具体方案、具体改法、具体测试或发布流程
- 助手具体产出的内容
- 来回修改、重试、被打断又恢复这类过程波动

输出 3-5 条，每条 1-2 句，最多 400 字。这周平淡就写得短。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`
    : `You will receive timeline entries or "today drafts" (end-of-day writeups of the user's current state) from the past 7 days. Distill them into a "weekly user-theme overview".

Positioning: this is one overview feeding long-term-memory folding, not a detailed log. The reader only needs a glance at what broadly happened this week and what the user was focused on.

Principles:
- Merge multiple back-and-forth on the same topic/project into ONE event; do not enumerate line by line
- Preserve the week's coarse sense of time, such as "Monday morning", "Wednesday", or one representative HH:MM; do not turn it into timeless topic labels
- Memory's core job is to maintain a user model: prioritize who the user is, what they like, what they care about, and what they focused on this week
- Work-related content may only be kept at the broad-theme level: record the domain/project/theme, not details inside that theme

Do NOT record:
- Execution steps, filenames, tools, commands, validation order, collaboration preferences, or work details
- Task-level methodology choices, tool preferences, format requirements, terminology rules
- Specific subproblems, concrete solutions, concrete code changes, tests, or release flows
- Specific content of assistant's output
- Revisions, retries, interruptions and resumptions — these are process noise

Output 3-5 items, 1-2 sentences each, max 240 words. Keep it shorter on quiet weeks. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`;
}

/** compileLongterm system prompt（照抄 compile-longterm.v1 中文模板）。 */
export function buildCompileLongtermSystemPrompt(locale = "zh-CN"): string {
  return isZh(locale)
    ? `请综合「上一份长期情况」和「新沉淀内容」，重写成一份新的长期情况。必须控制在 400 字以内。

记忆不是工作日志，也不是协作手册。到 longterm 这一层，记录已经是最稳定的用户画像核心。只保留"如果一年后回看仍然适合用来理解用户这个人"的内容：
- 用户的身份、人格特质、审美、兴趣、价值取向
- 用户长期喜欢或讨厌的事物
- 用户长期关系和稳定生活背景
- 用户持续关注或投入的长期关注方向

去掉这些"单次性内容"：
- 某天/某周完成的具体任务
- 用户偏好的工作方式、协作流程、工程纪律
- 工具使用习惯、检查顺序、汇报格式
- 某类任务的处理方法
- 助手的具体产出内容
- 任何"这周/那周"级别的细节

处理方式：
- 不要追加，不要把旧内容和新内容分开复述
- 必须做取舍、抽象、合并，把重复或过细的信息压成更高层概括
- 如果上一份长期情况已经很长，优先概括旧内容，再吸收真正重要的新内容

不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`
    : `Synthesize "Previous long-term context" and "Newly settled content", then rewrite them into one new long-term context. You must keep the result under 240 words.

Memory is not a work log or collaboration manual. At the longterm layer, the record is the most stable user-profile core. Keep only what would still help understand the user as a person "if reviewed a year from now":
- The user's identity, personality traits, aesthetics, interests, and values
- Things the user has long liked or disliked
- Long-term relationships and stable life background
- Persistent long-term focus directions

Remove these "one-off" contents:
- Specific tasks completed on a particular day or week
- User-preferred work style, collaboration process, or engineering discipline
- Tool habits, validation order, report format
- How to handle a class of task
- Specific content of assistant's output
- Any "this week / that week" level details

How to process:
- Do not append; do not restate old and new content separately
- Make tradeoffs, abstract, and merge; compress repeated or overly specific details into higher-level facts
- If the previous long-term context is already long, summarize it first, then absorb only genuinely important new content

Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`;
}

/** compileFacts system prompt（照抄 compile-editable-facts.v1 中文模板）。 */
export function buildCompileFactsSystemPrompt(locale = "zh-CN"): string {
  return isZh(locale)
    ? "请综合「当前可信 Facts」和「新增候选 Facts」，重写成一份新的重要事实。必须控制在 300 字以内，宁可概括合并，也不要堆叠罗列。当前可信 Facts 代表用户或 Agent 已确认过的稳定信息，默认作为基础，但如果过长，必须压成更高层概括；新增候选 Facts 只在能纠正、补充或更新稳定用户画像时吸收。只保留稳定的、跨时间有效的用户画像：身份、人格特质、审美、兴趣、喜欢或讨厌的事物、长期关系、长期关注方向。新增候选 Facts 与当前可信 Facts 冲突时，以新增候选 Facts 修正当前事实。不要追加，不要把两部分分别复述。不要保留工作方式、协作流程、工具偏好、执行细节。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。"
    : 'Synthesize "Current Trusted Facts" and "New Candidate Facts", then rewrite them into one new Key Facts section. You must keep the result under 200 words; prefer concise abstraction and merging over stacked lists. Current Trusted Facts are stable information confirmed by the user or agent and are the base, but if they are too long, compress them into higher-level facts. Absorb New Candidate Facts only when they correct, supplement, or update stable user-profile information. Keep only stable, time-persistent user-profile facts: identity, personality traits, aesthetics, interests, likes/dislikes, long-term relationships, and long-term focus directions. When New Candidate Facts conflict with Current Trusted Facts, use them to correct the current facts. Do not append. Do not restate the two inputs separately. Do not keep work style, collaboration process, tool preferences, or execution details. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.';
}

/* ------------------------------------------------------------------ */
/* 窗口选择 + 输入构建                                                  */
/* ------------------------------------------------------------------ */

export interface CompileContext {
  ctx: Context;
  paths: ProfilePaths;
  provider: string;
  model: string;
  /** IANA 时区，用于逻辑日窗口。 */
  timeZone?: string;
  /** 参考时刻（epoch 毫秒），测试可注入。 */
  now?: number;
  signal?: AbortSignal;
}

const TODAY_MAX_TOKENS = 450;
const WEEK_MAX_TOKENS = 600;
const LONGTERM_MAX_TOKENS = 600;
const FACTS_MAX_TOKENS = 300;

/** 取窗口内（updated_at 或 created_at 在 [since, until]）的摘要记录。 */
function summariesInWindow(paths: ProfilePaths, since: number, until: number): Array<{ sessionId: string; summary: string; updatedAt: string }> {
  const store = new SessionSummaryStore(paths);
  return store.getAllSummaries()
    .filter((record) => {
      const at = Date.parse(record.updated_at || record.created_at || "");
      return Number.isFinite(at) && at >= since && at <= until;
    })
    .map((record) => ({ sessionId: record.session_id, summary: record.summary, updatedAt: record.updated_at }));
}

/** 指纹键：sessionId:updatedAt 列表（照抄 Hana compileToday 的指纹语义）。 */
function summaryFingerprintKeys(summaries: Array<{ sessionId: string; updatedAt: string }>): string[] {
  return summaries.map((s) => `${s.sessionId}:${s.updatedAt}`).sort();
}

/** 把多条摘要的「事情经过」段（timeline）拼成 delta 输入。 */
function buildTimelineDelta(summaries: Array<{ sessionId: string; summary: string }>): string {
  return summaries
    .map((s) => s.summary.trim())
    .filter(Boolean)
    .map((body) => {
      // 用完整摘要即可：compileToday prompt 本身教模型怎么处理时间线条目
      return body;
    })
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* 四个编译函数 + assemble                                              */
/* ------------------------------------------------------------------ */

/**
 * Step0：compileToday —— 当天 sessions → today.md（近况，3-5 条 ≤300 字）。
 * 指纹：当天窗口内摘要的 sessionId:updatedAt 组合。
 */
export async function compileToday(cx: CompileContext): Promise<"compiled" | "skipped" | "cleared"> {
  const day = getLogicalDay(cx.now ?? Date.now(), cx.timeZone);
  const summaries = summariesInWindow(cx.paths, day.rangeStart, day.rangeEnd);
  const fingerprint = computeListFingerprint(summaryFingerprintKeys(summaries));
  const output = join(cx.paths.memoryDir, "today.md");

  // 空窗口：清空 today.md（Hana 语义：空 sessions → 清空），但不写指纹
  if (summaries.length === 0) {
    atomicWriteFileSync(output, "");
    return "cleared";
  }
  if (!shouldCompile(output, fingerprint)) return "skipped";

  const previous = readMemorySectionBody(cx.paths, "today");
  const delta = buildTimelineDelta(summaries);
  const input = previous.trim()
    ? `## 上一版今日草稿\n\n${previous}\n\n## 新增或修订的时间线条目（delta）\n\n${delta}`
    : `## 新增或修订的时间线条目（delta）\n\n${delta}`;
  const text = await callText(cx.ctx, {
    provider: cx.provider,
    model: cx.model,
    system: buildCompileTodaySystemPrompt(),
    prompt: input,
    maxTokens: TODAY_MAX_TOKENS,
    operation: "compileToday",
    temperature: 0.3,
    signal: cx.signal,
  });
  writeMemorySectionBody(cx.paths, "today", text);
  writeFingerprint(output, fingerprint);
  return "compiled";
}

/**
 * Step1：compileWeek —— 过去 7 天窗口 → week.md（本周概要 ≤400 字）。
 * 指纹：7 天窗口内摘要的 sessionId:updatedAt 组合。
 */
export async function compileWeek(cx: CompileContext): Promise<"compiled" | "skipped" | "cleared"> {
  const day = getLogicalDay(cx.now ?? Date.now(), cx.timeZone);
  const weekStart = getLogicalDayFromDate(shiftLogicalDate(day.logicalDate, -6), cx.timeZone).rangeStart;
  const summaries = summariesInWindow(cx.paths, weekStart, day.rangeEnd);
  const fingerprint = computeListFingerprint(summaryFingerprintKeys(summaries));
  const output = join(cx.paths.memoryDir, "week.md");

  if (summaries.length === 0) {
    atomicWriteFileSync(output, "");
    return "cleared";
  }
  if (!shouldCompile(output, fingerprint)) return "skipped";

  const input = summaries
    .map((s) => s.summary.trim())
    .filter(Boolean)
    .join("\n\n");
  const text = await callText(cx.ctx, {
    provider: cx.provider,
    model: cx.model,
    system: buildCompileWeekSystemPrompt(),
    prompt: input,
    maxTokens: WEEK_MAX_TOKENS,
    operation: "compileWeek",
    temperature: 0.3,
    signal: cx.signal,
  });
  writeMemorySectionBody(cx.paths, "week", text);
  writeFingerprint(output, fingerprint);
  return "compiled";
}

/**
 * Step2：compileLongterm —— week fold 进长期画像 → longterm.md（≤400 字）。
 * 指纹：week.md 全文 MD5（照抄 Hana compileLongterm：week 内容没变就跳过）。
 */
export async function compileLongterm(cx: CompileContext): Promise<"compiled" | "skipped"> {
  const weekBody = readMemorySectionBody(cx.paths, "week");
  const output = join(cx.paths.memoryDir, "longterm.md");
  if (!weekBody.trim()) return "skipped";
  const fingerprint = computeListFingerprint([weekBody.trim()]);
  if (!shouldCompile(output, fingerprint)) return "skipped";

  const previous = readMemorySectionBody(cx.paths, "longterm");
  const input = previous.trim()
    ? `## 上一份长期情况\n\n${previous}\n\n## 新沉淀内容\n\n${weekBody}`
    : `## 新沉淀内容\n\n${weekBody}`;
  const text = await callText(cx.ctx, {
    provider: cx.provider,
    model: cx.model,
    system: buildCompileLongtermSystemPrompt(),
    prompt: input,
    maxTokens: LONGTERM_MAX_TOKENS,
    operation: "compileLongterm",
    temperature: 0.3,
    signal: cx.signal,
  });
  writeMemorySectionBody(cx.paths, "longterm", text);
  writeFingerprint(output, fingerprint);
  return "compiled";
}

/**
 * Step3：compileFacts —— 30 天新摘要提取 `## 重要事实` 段 + 旧 facts 去重合并 → facts.md（≤300 字）。
 * 指纹：30 天窗口内合规摘要的 sessionId:updatedAt + 旧 facts 全文。
 * 旧格式兼容：没有事实段标题的摘要显式跳过并记录；facts 段全空（- 无）视为无新事实。
 */
export async function compileFacts(cx: CompileContext): Promise<"compiled" | "skipped"> {
  const day = getLogicalDay(cx.now ?? Date.now(), cx.timeZone);
  const monthStart = getLogicalDayFromDate(shiftLogicalDate(day.logicalDate, -29), cx.timeZone).rangeStart;
  const summaries = summariesInWindow(cx.paths, monthStart, day.rangeEnd);
  const oldFacts = readMemorySectionBody(cx.paths, "facts");
  const fingerprint = computeListFingerprint([...summaryFingerprintKeys(summaries), oldFacts.trim()]);
  const output = join(cx.paths.memoryDir, "facts.md");
  if (!shouldCompile(output, fingerprint)) return "skipped";

  // 提取合规摘要的事实段
  const candidates: string[] = [];
  const skipped: string[] = [];
  for (const summary of summaries) {
    if (!summary.summary) continue;
    if (!hasFactSectionHeading(summary.summary)) {
      skipped.push(summary.sessionId);
      continue;
    }
    const factBody = extractFactSection(summary.summary);
    if (factBody && !isEmptyFactSection(factBody)) candidates.push(factBody);
  }
  if (skipped.length > 0) {
    console.warn(`[assistant-soul] compileFacts: ${skipped.length} 份摘要缺少事实段标题，已跳过: ${skipped.join(", ")}`);
  }
  if (candidates.length === 0) return "skipped"; // 无新事实 → 保留旧 facts 原样

  const input = oldFacts.trim()
    ? `## 当前可信 Facts\n\n${oldFacts}\n\n## 新增候选 Facts\n\n${candidates.join("\n\n")}`
    : `## 新增候选 Facts\n\n${candidates.join("\n\n")}`;
  const text = await callText(cx.ctx, {
    provider: cx.provider,
    model: cx.model,
    system: buildCompileFactsSystemPrompt(),
    prompt: input,
    maxTokens: FACTS_MAX_TOKENS,
    operation: "compileFacts",
    temperature: 0.3,
    signal: cx.signal,
  });
  writeMemorySectionBody(cx.paths, "facts", text);
  writeFingerprint(output, fingerprint);
  return "compiled";
}

/**
 * Step4：assemble —— 纯文件操作，把四个 .md 拼成 memory.md。
 * 标题中英文自适应，空段写「（暂无）」占位。不调 LLM。
 */
export function assemble(cx: CompileContext): void {
  const zh = isZh();
  const section = (title: string, body: string) => `## ${title}\n\n${normalizeCompiledSectionBody(body) || (zh ? "（暂无）" : "(none)")}`;
  const blocks = [
    section(zh ? "重要事实" : "Key facts", readMemorySectionBody(cx.paths, "facts")),
    section(zh ? "今天" : "Today", readMemorySectionBody(cx.paths, "today")),
    section(zh ? "本周早些时候" : "Earlier this week", readMemorySectionBody(cx.paths, "week")),
    section(zh ? "长期情况" : "Long-term context", readMemorySectionBody(cx.paths, "longterm")),
  ];
  atomicWriteFileSync(cx.paths.memoryMd, blocks.join("\n\n") + "\n");
}

/** 从 memory.md 反向解析四段（供工具/校验用，实现见 compiled-snapshot.ts）。 */
export { parseMemoryMd, readMemoryMd } from "./compiled-snapshot.js";

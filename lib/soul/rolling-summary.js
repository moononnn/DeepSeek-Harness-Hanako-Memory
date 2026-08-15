/**
 * 滚动摘要（rolling summary）：每个 session 维护结构化摘要。
 *
 * 数据布局（每个 profile 一个目录）：
 *   memory/summaries/<sessionId>.md    摘要正文（格式契约：`### 重要事实` + `### 事情经过`）
 *   memory/summaries/<sessionId>.json  机器元数据（updated_at / messageCount / snapshot / …）
 *
 * 触发：每 N 轮 + session 结束（由 ticker 驱动）。写入前做格式校验
 * （缺标题 / 嵌套 / 空段），失败最多修复 1 次；最终失败抛错，旧摘要不被覆盖。
 * 每个 session 有 in-progress 锁（照抄 Hana `_summaryInProgress`），防并发重复触发。
 *
 * 中文 prompt 语义照抄 Hana `lib/memory/session-summary.ts`（v0.446.6 产物）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic.js";
import { textBlocks } from "./memory-util.js";
import { callText } from "./llm.js";
/* ------------------------------------------------------------------ */
/* 格式契约常量（照抄 Hana rolling-summary-format.ts）                  */
/* ------------------------------------------------------------------ */
/** 事实段标题（中英文，任意 1-6 级标题都接受）。 */
export const FACT_SECTION_TITLES = ["重要事实", "Key Facts"];
/** 事情经过段标题（中英文）。 */
export const TIMELINE_SECTION_TITLES = ["事情经过", "Timeline"];
/** 格式修复最多调用次数。 */
export const MAX_ROLLING_SUMMARY_FORMAT_REPAIRS = 1;
function isZh(locale) {
    return String(locale || "zh-CN").startsWith("zh");
}
/** 输出格式要求 prompt 块（照抄 Hana `$1`）。 */
export function buildRollingSummaryFormatRequirements(locale = "zh-CN") {
    return isZh(locale)
        ? "## 输出格式\n最终答案必须只包含两个三级标题，标题文本和顺序固定：\n1. 第一行必须是 `### 重要事实`\n2. 第二个标题必须是 `### 事情经过`\n\n两个标题下的正文都必须使用无序列表。列表项必须以 `- ` 开头。\n如果某一节没有内容，也要输出一个列表项：`- 无`。\n标题之外不要输出前言、后记、XML 标签或代码块。"
        : "## Output Format\nThe final answer must contain exactly two third-level headings, with fixed text and order:\n1. The first line must be `### Key Facts`\n2. The second heading must be `### Timeline`\n\nThe body under both headings must use unordered lists. Each list item must start with `- `.\nIf a section has no content, output one list item: `- None`.\nDo not output any preamble, conclusion, XML tags, or code fences outside those headings.";
}
/** 解析 markdown 标题行：返回 { level, title } 或 null。 */
function parseHeading(line) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(String(line || ""));
    if (!match)
        return null;
    return { level: match[1].length, title: match[2].replace(/[ \t]+#+[ \t]*$/, "").trim() };
}
function normalizeTitle(title) {
    return String(title || "").trim().toLowerCase();
}
/** 提取 markdown 中首个匹配标题段的正文（不含标题行）。 */
export function extractMarkdownSection(markdown, titles) {
    if (!markdown)
        return "";
    const wanted = new Set(titles.map(normalizeTitle));
    const lines = String(markdown).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const heading = parseHeading(lines[index]);
        if (!heading || !wanted.has(normalizeTitle(heading.title)))
            continue;
        const body = [];
        for (let next = index + 1; next < lines.length; next += 1) {
            const child = parseHeading(lines[next]);
            if (child && child.level <= heading.level)
                break;
            body.push(lines[next]);
        }
        return body.join("\n").trim();
    }
    return "";
}
/** 提取事实段正文（compileFacts 入口）。 */
export function extractFactSection(markdown) {
    return extractMarkdownSection(markdown, FACT_SECTION_TITLES);
}
/** 检测摘要中是否存在事实段标题（区分旧自由格式 vs 合规空事实）。 */
export function hasFactSectionHeading(markdown) {
    if (!markdown)
        return false;
    const titles = new Set(FACT_SECTION_TITLES.map(normalizeTitle));
    for (const line of String(markdown).split(/\r?\n/)) {
        const heading = parseHeading(line);
        if (heading && titles.has(normalizeTitle(heading.title)))
            return true;
    }
    return false;
}
/** 判断事实段是否全为 `- 无` / `- None` 空标记。 */
export function isEmptyFactSection(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0)
        return true;
    return lines.every((line) => {
        const body = line.replace(/^[-*+][ \t]+/, "").trim().toLowerCase();
        return body === "无" || body === "none";
    });
}
/**
 * 写入前结构校验（照抄 Hana `validateRollingSummaryFormat`）。
 * 拦截四类破坏 compileFacts 提取的结构问题：
 * 1. 缺事实段标题；2. 缺事情经过段标题；
 * 3. 事情经过标题比事实标题层级更深且在其后（事实段无法收尾）；
 * 4. 事实段正文为空（契约要求空时显式写 `- 无` / `- None`）。
 */
export function validateRollingSummaryFormat(text) {
    const issues = [];
    const lines = String(text || "").split(/\r?\n/);
    const findHeading = (titles) => {
        const wanted = new Set(titles.map(normalizeTitle));
        for (let index = 0; index < lines.length; index += 1) {
            const heading = parseHeading(lines[index]);
            if (heading && wanted.has(normalizeTitle(heading.title)))
                return { index, level: heading.level };
        }
        return null;
    };
    const factHeading = findHeading(FACT_SECTION_TITLES);
    const timelineHeading = findHeading(TIMELINE_SECTION_TITLES);
    if (!factHeading)
        issues.push('missing fact section heading ("### 重要事实" / "### Key Facts")');
    if (!timelineHeading)
        issues.push('missing timeline section heading ("### 事情经过" / "### Timeline")');
    if (factHeading && timelineHeading && timelineHeading.index > factHeading.index && timelineHeading.level > factHeading.level) {
        issues.push("timeline heading is nested deeper than the fact heading, so the fact section cannot be delimited");
    }
    if (factHeading && (extractFactSection(text) || issues.push('fact section body is empty; write "- 无" / "- None" when there are no facts'))) {
        // 有事实段标题：正文为空 → 上述 push 已加 issue
    }
    return { ok: issues.length === 0, issues };
}
/** 格式修复器 system prompt（照抄 Hana `uQ`）。 */
export function buildRollingSummaryRepairPrompt(locale = "zh-CN") {
    const format = buildRollingSummaryFormatRequirements(locale);
    return isZh(locale)
        ? `你是记忆系统滚动摘要的格式修复器。上一步生成的摘要草稿不符合要求的固定结构，记忆系统无法解析。请把给定草稿中的信息原样重排进规定结构：不要新增、删除或改写事实内容，不要解释，直接输出修复后的摘要全文。

${format}`
        : `You are the format repairer for the memory system's rolling summaries. The previous summary draft violates the required fixed structure and cannot be parsed by the memory system. Rearrange the information in the given draft into the required structure: do not add, remove, or rewrite any factual content, do not explain, and output only the full repaired summary.

${format}`;
}
/** 修复输入格式化（照抄 Hana `dQ`）。 */
export function buildRollingSummaryRepairInput(options = {}) {
    const { locale = "zh-CN", issues = [], summaryText = "" } = options;
    const zh = isZh(locale);
    const issuesBlock = (Array.isArray(issues) ? issues : [])
        .map((issue) => `- ${String(issue || "").trim()}`)
        .filter((issue) => issue !== "- ")
        .join("\n");
    return `${zh ? "## 校验失败原因" : "## Validation Failures"}

${issuesBlock || (zh ? "- 未知" : "- unknown")}

${zh ? "## 待修复草稿" : "## Draft To Repair"}

<draft-summary>
${String(summaryText || "")}
</draft-summary>`;
}
/** SessionSummaryStore：滚动摘要的读写与脏判定。 */
export class SessionSummaryStore {
    paths;
    dir;
    constructor(paths) {
        this.paths = paths;
        this.dir = paths.summariesDir;
    }
    /** summaries/ 目录绝对路径。 */
    get summariesDir() {
        return this.dir;
    }
    mdPath(sessionId) {
        return join(this.dir, `${sessionId}.md`);
    }
    jsonPath(sessionId) {
        return join(this.dir, `${sessionId}.json`);
    }
    /** 读指定 session 的摘要；不存在返回 null。 */
    getSummary(sessionId) {
        try {
            const raw = JSON.parse(readFileSync(this.jsonPath(sessionId), "utf8"));
            if (!raw || typeof raw !== "object" || typeof raw.session_id !== "string")
                return null;
            return {
                session_id: raw.session_id,
                created_at: typeof raw.created_at === "string" ? raw.created_at : new Date(0).toISOString(),
                updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date(0).toISOString(),
                summary: typeof raw.summary === "string" ? raw.summary : "",
                messageCount: Number.isFinite(raw.messageCount) ? raw.messageCount : 0,
                snapshot: typeof raw.snapshot === "string" ? raw.snapshot : "",
                snapshot_at: typeof raw.snapshot_at === "string" ? raw.snapshot_at : null,
                source_time_range: raw.source_time_range && typeof raw.source_time_range === "object"
                    ? { start: Number(raw.source_time_range.start) || 0, end: Number(raw.source_time_range.end) || 0 }
                    : null,
            };
        }
        catch {
            // 无 json → 尝试从 .md 重建（老数据或手工放置）
            try {
                const summary = readFileSync(this.mdPath(sessionId), "utf8").trim();
                if (!summary)
                    return null;
                return {
                    session_id: sessionId,
                    created_at: new Date(0).toISOString(),
                    updated_at: new Date(0).toISOString(),
                    summary,
                    messageCount: 0,
                    snapshot: "",
                    snapshot_at: null,
                    source_time_range: null,
                };
            }
            catch {
                return null;
            }
        }
    }
    /** 写摘要（.md + .json 双写，原子）。 */
    saveSummary(sessionId, record) {
        mkdirSync(this.dir, { recursive: true });
        atomicWriteFileSync(this.mdPath(sessionId), `${record.summary.trim()}\n`);
        atomicWriteFileSync(this.jsonPath(sessionId), JSON.stringify(record, null, 2) + "\n");
    }
    /** 全部 sessionId。 */
    listSessionIds() {
        try {
            return readdirSync(this.dir)
                .filter((file) => file.endsWith(".json"))
                .map((file) => file.slice(0, -".json".length));
        }
        catch {
            return [];
        }
    }
    /** 全部摘要记录（有内容者）。 */
    getAllSummaries() {
        return this.listSessionIds()
            .map((sessionId) => this.getSummary(sessionId))
            .filter((record) => record !== null && !!record.summary.trim());
    }
    /** 脏 session：摘要与上次 Deep Memory 快照不一致（摘要非空且与 snapshot 不同）。 */
    getDirtySessions() {
        return this.getAllSummaries().filter((record) => record.summary.trim() !== record.snapshot.trim());
    }
    /** Deep Memory 处理后标记：把当前摘要记入 snapshot。 */
    markProcessed(sessionId) {
        const record = this.getSummary(sessionId);
        if (!record)
            return;
        this.saveSummary(sessionId, { ...record, snapshot: record.summary, snapshot_at: new Date().toISOString() });
    }
}
/**
 * 从 dsh session 派生消息列表（用 session.deriveMessages() 拿文本，
 * 时间戳从事件日志按消息 id 匹配；跳过插件注入与工具结果）。
 */
export function deriveSessionMessages(session) {
    const timeById = new Map();
    for (const event of session.events) {
        if (event.type === "user/message") {
            const data = event.data;
            if (data?.id)
                timeById.set(data.id, event.time);
        }
        else if (event.type === "assistant/message") {
            const data = event.data;
            if (data?.message?.id)
                timeById.set(data.message.id, event.time);
        }
    }
    const messages = [];
    for (const message of session.deriveMessages()) {
        if (message.source.kind === "plugin" || message.source.kind === "tool")
            continue;
        const text = textBlocks(message.content);
        if (!text)
            continue;
        messages.push({
            role: message.role === "assistant" ? "assistant" : "user",
            text,
            timestamp: timeById.get(message.id) ?? null,
        });
    }
    return messages;
}
/** 把派生消息渲染成对话文本（带时间标注，供 LLM 输入）。 */
export function renderConversationText(messages) {
    return messages
        .map((message) => {
        const stamp = message.timestamp ? new Date(message.timestamp).toISOString().slice(0, 16).replace("T", " ") : "";
        const prefix = message.role === "user" ? "用户" : "助手";
        return `${prefix}${stamp ? `（${stamp}）` : ""}：${message.text}`;
    })
        .join("\n");
}
/** 滚动摘要输出预算（照抄 Hana `_rollingSummaryBudget`）。 */
export function rollingSummaryBudget(turnCount) {
    const total = Math.min(400, Math.max(40, turnCount * 40));
    return { totalBudget: total, visibleMaxTokens: Math.max(150, Math.min(750, Math.round(total * 1.5))) };
}
/** 滚动摘要生成 system prompt（照抄 Hana `_callRollingLLM` 中文模板语义）。 */
export function buildRollingSummarySystemPrompt(options) {
    const { locale = "zh-CN", agentName, userName } = options;
    const zh = isZh(locale);
    const identity = options.identityAndPersonality || (zh ? "（未提供）" : "(Not provided)");
    const profile = options.userProfile || (zh ? "（未提供）" : "(Not provided)");
    const memory = options.existingMemory || (zh ? "（暂无已有长期记忆）" : "(No existing long-term memory)");
    const roster = options.roster || (zh ? "（没有其他 Agent）" : "(No other agents)");
    const format = buildRollingSummaryFormatRequirements(locale);
    if (!zh) {
        return `You are ${agentName}. You are reviewing a conversation you just experienced.

Below are the identity, settings, and memories you already had at the start of this session. They are background, not new facts. Review the new conversation from your own perspective and decide what deserves long-term memory.

## Your Identity And Personality
${identity}

## Owner / User Settings
${profile}

## Your Existing Long-Term Memory
This is the memory you already had before this conversation began. Do not rewrite it merely because it appears here; record only what this conversation updates, contradicts, or reinforces.

${memory}

## Roster
The roster tells you which other agents are in the same system. Use it only to understand agent names and collaboration context; do not treat the roster itself as new memory.

${roster}

## Core Principle
Memory's core job is to maintain your understanding of ${userName}: who they are, your relationship with them, their long-running projects, and shared context. Keep the summary user-centric: prioritize who the user is, what they like, what they care about, and the broad themes they are currently focused on. For your replies, only record what was done (e.g. "generated an article about X", "wrote code implementing Y"), not the actual content or transient inner thoughts.

${format}

## Content Requirements

**Key Facts section**
Only record user-profile information: identity attributes, personality traits, aesthetics and interests, likes and dislikes, long-term relationships, and broad themes the user is currently focused on. If none, write \`- None\`.

Do NOT extract work-style preferences, collaboration-process preferences, tool/platform preferences, engineering discipline, or per-task format/standards decisions — those belong to project docs or system rules, not user-profile memory.

Extraction criteria: if the information answers "who the user is, what they like, what they care about", extract it; if it answers "how to work with the user", do not; if it answers "what broad domain/project/theme the user is focused on", keep only the broad theme, not details. When unsure, do not extract. Better to omit than to err.

**Timeline section**
Record what happened in this session in time order, with YYYY-MM-DD HH:MM timestamps, keeping the main threads. Work content may only be kept at the broad-theme level: write "the user was discussing memory systems" or "the user is working on Project Hana", not specific subproblems, plans, files, tools, commands, tests, execution steps, validation order, or collaboration preferences.

## Rules
1. When a previous summary exists: merge old and new content; newer information wins for the same event; do not repeat.
2. Extract timestamps from message timestamps (YYYY-MM-DD HH:MM format).
3. Record only objective facts; do not record MOOD or the assistant's inner thoughts.
4. User-provided files/attachments: record only file name and purpose; ignore file contents.
5. Long assistant outputs (articles, code, analysis): record only what was produced, not its content.
6. Prefer short: summary length should match the conversation's actual information density; a few casual exchanges only need one or two lines.`;
    }
    return `你是 ${agentName}。你正在整理自己刚刚经历的一段对话。

下面是你在本次对话开始前已经拥有的设定和记忆。它们是背景，不是新增事实。请从自己的视角审视本次对话，判断哪些新信息值得进入长期记忆。

## 你的身份与人格
${identity}

## 主人设定
${profile}

## 你已有的长期记忆
这是你在本次对话开始前已经拥有的记忆。不要因为它出现在这里就重复写入；只有本次对话更新、反驳、强化它时才记录变化。

${memory}

## 花名册
花名册告诉你同处于这个系统里的别的 Agent。它只用于理解对话中的 Agent 名字和协作语境，不要把花名册本身当作新增记忆。

${roster}

## 核心原则
记忆的核心职责是维护你对${userName}的理解，让你以后更自然地理解这个人、你们的关系、长期项目和共同语境。摘要仍然以用户侧为中心：优先记录${userName}是谁、喜欢什么、在意什么、最近关注什么大主题。你的回复只需记录"做了什么"（如"生成了一篇关于X的文章""写了一段代码实现Y功能"），不记录回复的具体内容，也不记录即时内心想法。

${format}

## 内容要求

**重要事实一节**
只记录用户画像类信息：身份属性、人格特质、审美和兴趣、喜欢或讨厌的事物、长期关系、生活或创作取向、近期正在关注/投入的大主题。没有则写 \`- 无\`。

不要抽：
- 工作方式偏好：用户希望助手怎样审查、规划、调研、实现、测试、汇报、commit、push
- 协作流程偏好：用户要求的步骤、确认点、验证顺序、上下文管理方式
- 工具和平台偏好：某次任务中使用什么工具、命令、文件、模型、目录
- 工程纪律和项目规则：这些属于项目文档或系统规则，不属于用户画像记忆
- 一次任务里的格式、标准、临时判断

只抽：
- 用户是什么样的人
- 用户喜欢或讨厌什么对象、风格、内容、体验
- 用户长期在意的主题、关系、身份、审美、价值取向
- 用户最近正在关注哪个领域/项目/主题，只保留大主题，不保留细节

判别标准：
- 如果这条信息回答的是"用户是谁、喜欢什么、在意什么"，可以抽。
- 如果这条信息回答的是"和用户工作时该怎么做"，不要抽。
- 如果这条信息回答的是"用户最近在关注哪个领域/项目/主题"，只保留大主题，不保留该主题里的细节。
- 拿不准一律不抽。宁可漏，不可错。

字数要求：按实际信息量写，遵守本次摘要预算。信息少就写短，不要凑字数。

**事情经过一节**
按时间顺序记录本 session 发生了什么，带 YYYY-MM-DD HH:MM 时间标注，抓重点脉络。工作相关内容只允许保留到大主题层级。
工作内容可以写成"用户在讨论记忆系统""用户在做 Project Hana"，不要写具体子问题、方案、文件、工具、命令、测试、执行步骤、检查顺序或协作偏好。
字数要求：按实际信息量写，遵守本次摘要预算。三句话能说清的事不要写成一段。

## 规则
1. 有已有摘要时：新旧内容合并，同一件事以新信息为准，不要重复
2. 时间标注从消息时间戳提取（YYYY-MM-DD HH:MM 格式）
3. 只记录客观事实，不记录 MOOD 或助手内心想法
4. 用户提供的文件/附件：只记录文件名和用途，忽略文件的具体内容
5. 助手的长篇输出（文章、代码、分析等）：只记录产出了什么，不摘录内容
6. 宁短勿长：摘要长度应与对话的实际信息密度成正比，闲聊几句只需一两行`;
}
/** 滚动摘要生成输入（user 侧）。 */
export function buildRollingSummaryUserPrompt(conversationText, previousSummary) {
    const previous = previousSummary.trim()
        ? `## 已有摘要\n${previousSummary}`
        : "";
    return `${previous ? `${previous}\n\n` : ""}## 本次对话\n${conversationText}`;
}
/**
 * 生成/更新一个 session 的滚动摘要（含格式校验 + 最多 1 次修复）。
 * @returns 新摘要文本。
 */
export async function updateRollingSummary(options) {
    const { ctx, paths, sessionId, session, provider, model, agentName, userName } = options;
    const store = new SessionSummaryStore(paths);
    const previous = store.getSummary(sessionId);
    const messages = deriveSessionMessages(session);
    const conversationText = renderConversationText(messages);
    const budget = rollingSummaryBudget(options.turnCount || Math.max(1, previous?.messageCount || 1));
    const system = buildRollingSummarySystemPrompt({
        agentName,
        userName,
        identityAndPersonality: options.identityAndPersonality,
        existingMemory: options.existingMemory,
    });
    const user = buildRollingSummaryUserPrompt(conversationText, previous?.summary || "");
    let text = await callText(ctx, {
        provider,
        model,
        system,
        prompt: user,
        maxTokens: budget.visibleMaxTokens,
        operation: "rolling_summary",
        temperature: 0.3,
        signal: options.signal,
    });
    // 校验 → 修复（最多 1 次）
    let validation = validateRollingSummaryFormat(text);
    for (let attempt = 0; attempt < MAX_ROLLING_SUMMARY_FORMAT_REPAIRS && !validation.ok; attempt += 1) {
        const repairSystem = buildRollingSummaryRepairPrompt();
        const repairUser = buildRollingSummaryRepairInput({ issues: validation.issues, summaryText: text });
        const repaired = await callText(ctx, {
            provider,
            model,
            system: repairSystem,
            prompt: repairUser,
            maxTokens: budget.visibleMaxTokens,
            operation: "rolling_summary_repair",
            temperature: 0.3,
            signal: options.signal,
        });
        text = repaired;
        validation = validateRollingSummaryFormat(text);
    }
    if (!validation.ok) {
        throw new Error(`滚动摘要格式校验失败（修复 ${MAX_ROLLING_SUMMARY_FORMAT_REPAIRS} 次后仍不合格）：${validation.issues.join("; ")}`);
    }
    const now = new Date().toISOString();
    const sourceRange = messages.some((m) => m.timestamp !== null)
        ? {
            start: Math.min(...messages.map((m) => m.timestamp ?? Number.POSITIVE_INFINITY)),
            end: Math.max(...messages.map((m) => m.timestamp ?? Number.NEGATIVE_INFINITY)),
        }
        : null;
    store.saveSummary(sessionId, {
        session_id: sessionId,
        created_at: previous?.created_at || now,
        updated_at: now,
        summary: text.trim(),
        messageCount: messages.length,
        snapshot: previous?.snapshot || "",
        snapshot_at: previous?.snapshot_at || null,
        source_time_range: sourceRange,
    });
    return text.trim();
}
/** 从 summaries 目录读所有摘要正文（供编译输入）。 */
export function readAllSummaryBodies(paths) {
    const store = new SessionSummaryStore(paths);
    return store.getAllSummaries().map((record) => ({
        sessionId: record.session_id,
        summary: record.summary,
        updatedAt: record.updated_at,
    }));
}
/** 目录是否存在且非空。 */
export function summariesExist(paths) {
    try {
        return existsSync(paths.summariesDir) && readdirSync(paths.summariesDir).length > 0;
    }
    catch {
        return false;
    }
}

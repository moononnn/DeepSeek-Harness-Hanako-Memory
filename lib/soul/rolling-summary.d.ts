import type { Session } from "@deepseek-ai/dsh-session";
import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
/** 事实段标题（中英文，任意 1-6 级标题都接受）。 */
export declare const FACT_SECTION_TITLES: string[];
/** 事情经过段标题（中英文）。 */
export declare const TIMELINE_SECTION_TITLES: string[];
/** 格式修复最多调用次数。 */
export declare const MAX_ROLLING_SUMMARY_FORMAT_REPAIRS = 1;
/** 输出格式要求 prompt 块（照抄 Hana `$1`）。 */
export declare function buildRollingSummaryFormatRequirements(locale?: string): string;
/** 提取 markdown 中首个匹配标题段的正文（不含标题行）。 */
export declare function extractMarkdownSection(markdown: string, titles: readonly string[]): string;
/** 提取事实段正文（compileFacts 入口）。 */
export declare function extractFactSection(markdown: string): string;
/** 检测摘要中是否存在事实段标题（区分旧自由格式 vs 合规空事实）。 */
export declare function hasFactSectionHeading(markdown: string): boolean;
/** 判断事实段是否全为 `- 无` / `- None` 空标记。 */
export declare function isEmptyFactSection(text: string): boolean;
/**
 * 写入前结构校验（照抄 Hana `validateRollingSummaryFormat`）。
 * 拦截四类破坏 compileFacts 提取的结构问题：
 * 1. 缺事实段标题；2. 缺事情经过段标题；
 * 3. 事情经过标题比事实标题层级更深且在其后（事实段无法收尾）；
 * 4. 事实段正文为空（契约要求空时显式写 `- 无` / `- None`）。
 */
export declare function validateRollingSummaryFormat(text: string): {
    ok: boolean;
    issues: string[];
};
/** 格式修复器 system prompt（照抄 Hana `uQ`）。 */
export declare function buildRollingSummaryRepairPrompt(locale?: string): string;
/** 修复输入格式化（照抄 Hana `dQ`）。 */
export declare function buildRollingSummaryRepairInput(options?: {
    locale?: string;
    issues?: string[];
    summaryText?: string;
}): string;
/** 摘要元数据（json 侧），对应 Hana session-summary 的持久化字段。 */
export interface SummaryRecord {
    session_id: string;
    created_at: string;
    updated_at: string;
    /** 摘要正文（与 .md 文件一致）。 */
    summary: string;
    /** 已覆盖的消息总数。 */
    messageCount: number;
    /** 上次 Deep Memory 处理时的摘要快照（用于脏判定）。 */
    snapshot: string;
    snapshot_at: string | null;
    /** 会话消息时间范围（epoch 毫秒）。 */
    source_time_range: {
        start: number;
        end: number;
    } | null;
}
/** SessionSummaryStore：滚动摘要的读写与脏判定。 */
export declare class SessionSummaryStore {
    private readonly paths;
    private readonly dir;
    constructor(paths: ProfilePaths);
    /** summaries/ 目录绝对路径。 */
    get summariesDir(): string;
    private mdPath;
    private jsonPath;
    /** 读指定 session 的摘要；不存在返回 null。 */
    getSummary(sessionId: string): SummaryRecord | null;
    /** 写摘要（.md + .json 双写，原子）。 */
    saveSummary(sessionId: string, record: SummaryRecord): void;
    /** 全部 sessionId。 */
    listSessionIds(): string[];
    /** 全部摘要记录（有内容者）。 */
    getAllSummaries(): SummaryRecord[];
    /** 脏 session：摘要与上次 Deep Memory 快照不一致（摘要非空且与 snapshot 不同）。 */
    getDirtySessions(): SummaryRecord[];
    /** Deep Memory 处理后标记：把当前摘要记入 snapshot。 */
    markProcessed(sessionId: string): void;
}
/** 会话消息（滚动摘要输入）：从 session 派生。 */
export interface SessionMessage {
    role: "user" | "assistant";
    text: string;
    /** epoch 毫秒，无则 null。 */
    timestamp: number | null;
}
/**
 * 从 dsh session 派生消息列表（用 session.deriveMessages() 拿文本，
 * 时间戳从事件日志按消息 id 匹配；跳过插件注入与工具结果）。
 */
export declare function deriveSessionMessages(session: Session): SessionMessage[];
/** 把派生消息渲染成对话文本（带时间标注，供 LLM 输入）。 */
export declare function renderConversationText(messages: readonly SessionMessage[]): string;
/** 滚动摘要输出预算（照抄 Hana `_rollingSummaryBudget`）。 */
export declare function rollingSummaryBudget(turnCount: number): {
    totalBudget: number;
    visibleMaxTokens: number;
};
/** 滚动摘要生成 system prompt（照抄 Hana `_callRollingLLM` 中文模板语义）。 */
export declare function buildRollingSummarySystemPrompt(options: {
    locale?: string;
    agentName: string;
    userName: string;
    identityAndPersonality?: string;
    userProfile?: string;
    existingMemory?: string;
    roster?: string;
}): string;
/** 滚动摘要生成输入（user 侧）。 */
export declare function buildRollingSummaryUserPrompt(conversationText: string, previousSummary: string): string;
/**
 * 生成/更新一个 session 的滚动摘要（含格式校验 + 最多 1 次修复）。
 * @returns 新摘要文本。
 */
export declare function updateRollingSummary(options: {
    ctx: Context;
    paths: ProfilePaths;
    sessionId: string;
    session: Session;
    provider: string;
    model: string;
    agentName: string;
    userName: string;
    identityAndPersonality?: string;
    existingMemory?: string;
    /** 已覆盖的消息数（轮数），用于输出预算。 */
    turnCount?: number;
    signal?: AbortSignal;
}): Promise<string>;
/** 从 summaries 目录读所有摘要正文（供编译输入）。 */
export declare function readAllSummaryBodies(paths: ProfilePaths): Array<{
    sessionId: string;
    summary: string;
    updatedAt: string;
}>;
/** 目录是否存在且非空。 */
export declare function summariesExist(paths: ProfilePaths): boolean;

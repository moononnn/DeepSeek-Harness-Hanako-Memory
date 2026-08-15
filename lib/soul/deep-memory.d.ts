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
import { SessionSummaryStore } from "./rolling-summary.js";
import type { FactStore } from "./fact-store.js";
export declare const MAX_CONCURRENT = 3;
export declare const MAX_RETRIES = 3;
export declare const FAIL_COUNT_TTL_MS: number;
export interface DirtySession {
    sessionId: string;
    summary: string;
    previousSnapshot: string;
    sourceTimeRange: {
        start: number;
        end: number;
    } | null;
    updatedAt: string;
    factReplacementRequired?: boolean;
}
export interface ProcessResult {
    processed: number;
    factsAdded: number;
}
interface TimeContext {
    timezone: string;
    sourceRange: {
        start: string;
        end: string;
    } | null;
    localDates: string[];
    summaryDateTimes: string[];
    summaryDates: string[];
    summaryTimes: string[];
    singleSourceDate: string | null;
    spansMultipleSourceDates: boolean;
}
/** 构建时间上下文（照抄 Hana buildTimeContextBlock 语义）。 */
export declare function buildFactTimeContext(sourceTimeRange: {
    start: number;
    end: number;
} | null, summaryText: string, timeZone: string): TimeContext;
/** 时间上下文渲染块（照抄 Hana buildTimeContextBlock 中文语义）。 */
export declare function buildTimeContextBlock(context: TimeContext, isZh: boolean): string;
/** 时间规范化（照抄 Hana normalizeFactTime 语义）：只允许时间上下文或摘要明确出现的日期。 */
export declare function normalizeFactTime(time: unknown, context: TimeContext): string | null;
export declare function buildFactExtractionSystemPrompt(hasPrevious: boolean, locale?: string): string;
/** 提取输入构建（照抄 Hana LLe 语义）。 */
export declare function buildFactExtractionInput(currentSummary: string, previousSnapshot: string, timeContext: TimeContext): string;
export interface ExtractedFact {
    fact: string;
    tags: string[];
    time: string | null;
}
/** 解析 LLM 返回的 JSON 数组（兼容 markdown 代码块包裹）。 */
export declare function parseExtractedFacts(text: string): ExtractedFact[];
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
    failCounts?: Map<string, {
        count: number;
        lastUpdated: number;
    }>;
}
/**
 * 处理脏 session：提取元事实 → 写库 → 标记已处理。
 * @returns { processed, factsAdded }
 */
export declare function processDirtySessions(options: DeepMemoryOptions): Promise<ProcessResult>;
/** 读脏 session 列表（供测试/调试）。 */
export declare function listDirtySessions(paths: ProfilePaths): DirtySession[];
export {};

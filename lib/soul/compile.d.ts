import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
/** compileToday system prompt（照抄 compile-today.v2 中文模板）。 */
export declare function buildCompileTodaySystemPrompt(locale?: string): string;
/** compileWeek system prompt（7 天窗口 → 本周用户主题概要 ≤400 字）。 */
export declare function buildCompileWeekSystemPrompt(locale?: string): string;
/** compileLongterm system prompt（照抄 compile-longterm.v1 中文模板）。 */
export declare function buildCompileLongtermSystemPrompt(locale?: string): string;
/** compileFacts system prompt（照抄 compile-editable-facts.v1 中文模板）。 */
export declare function buildCompileFactsSystemPrompt(locale?: string): string;
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
/**
 * Step0：compileToday —— 当天 sessions → today.md（近况，3-5 条 ≤300 字）。
 * 指纹：当天窗口内摘要的 sessionId:updatedAt 组合。
 */
export declare function compileToday(cx: CompileContext): Promise<"compiled" | "skipped" | "cleared">;
/**
 * Step1：compileWeek —— 过去 7 天窗口 → week.md（本周概要 ≤400 字）。
 * 指纹：7 天窗口内摘要的 sessionId:updatedAt 组合。
 */
export declare function compileWeek(cx: CompileContext): Promise<"compiled" | "skipped" | "cleared">;
/**
 * Step2：compileLongterm —— week fold 进长期画像 → longterm.md（≤400 字）。
 * 指纹：week.md 全文 MD5（照抄 Hana compileLongterm：week 内容没变就跳过）。
 */
export declare function compileLongterm(cx: CompileContext): Promise<"compiled" | "skipped">;
/**
 * Step3：compileFacts —— 30 天新摘要提取 `## 重要事实` 段 + 旧 facts 去重合并 → facts.md（≤300 字）。
 * 指纹：30 天窗口内合规摘要的 sessionId:updatedAt + 旧 facts 全文。
 * 旧格式兼容：没有事实段标题的摘要显式跳过并记录；facts 段全空（- 无）视为无新事实。
 */
export declare function compileFacts(cx: CompileContext): Promise<"compiled" | "skipped">;
/**
 * Step4：assemble —— 纯文件操作，把四个 .md 拼成 memory.md。
 * 标题中英文自适应，空段写「（暂无）」占位。不调 LLM。
 */
export declare function assemble(cx: CompileContext): void;
/** 从 memory.md 反向解析四段（供工具/校验用，实现见 compiled-snapshot.ts）。 */
export { parseMemoryMd, readMemoryMd } from "./compiled-snapshot.js";

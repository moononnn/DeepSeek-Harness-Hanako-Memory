/**
 * 记忆调度器（Memory Ticker）：轮数触发 + 每日任务。
 *
 * 触发机制（照抄 Hana `lib/memory/memory-ticker.ts`）：
 * - 每 `compileEvery` 轮：当前 session 滚动摘要 → compileToday → assemble；
 * - session 结束（agent/disposed）：final 滚动摘要 → compileToday → assemble；
 * - 日期变化（逻辑日）：每日任务六步，断点续跑：
 *     Step0 compileToday → Step1 compileWeek → Step2 compileLongterm
 *     → Step3 compileFacts → Step4 assemble → Step5 deep-memory
 *   每步记录健康状态 { lastSuccessAt, lastErrorAt, lastErrorMsg, failCount }，
 *   同一天不重复执行已完成的步骤（断点续跑，状态持久化在 daily-state.json）。
 *
 * 并发保护：每个 session 的滚动摘要有 in-progress 锁（照抄 Hana `_summaryInProgress`）。
 * 所有任务后台异步，绝不 await 在回合链路里。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
import { type DailyStepName } from "./daily-state.js";
export interface MemoryTickerConfig {
    enabled: boolean;
    /** 每 N 轮触发一次滚动摘要 + compileToday。 */
    compileEvery: number;
    recentMessages: number;
    model: {
        provider: string;
        model: string;
    };
    /** IANA 时区，用于逻辑日窗口。 */
    timeZone?: string;
    /** 每日任务深度记忆开关。 */
    deepMemory?: boolean;
}
/** 每日任务六步（含依赖顺序）。 */
export declare const DAILY_STEPS: ReadonlyArray<{
    name: DailyStepName;
    label: string;
}>;
/**
 * 注册记忆调度器：
 * - `agent/pre-step`（waterfall）：按 turn 变化计数，每 compileEvery 轮触发后台编译；
 * - `agent/turn-stopping`（serial）：turn 关闭前检查（轮数补齐 + 日期检查）；
 * - `agent/disposed`（emit）：session 结束触发 final 滚动摘要；
 * - 每小时定时检查日期变化（备用触发）。
 */
export declare function registerMemoryTicker(ctx: Context, config: MemoryTickerConfig, paths: ProfilePaths, agentName: string): void;
export { readDailyState, writeDailyState } from "./daily-state.js";
export type { DailyState, DailyStepName, StepHealth } from "./daily-state.js";

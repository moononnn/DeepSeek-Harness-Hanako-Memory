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
import type { Session } from "@deepseek-ai/dsh-session";
import type { ProfilePaths } from "./paths.js";
import { compileToday, compileWeek, compileLongterm, compileFacts, assemble } from "./compile.js";
import { updateRollingSummary, SessionSummaryStore } from "./rolling-summary.js";
import { getLogicalDay } from "./logical-day.js";
import { readDailyState, writeDailyState, type DailyStepName, type DailyState } from "./daily-state.js";
import { FactStore } from "./fact-store.js";
import { processDirtySessions } from "./deep-memory.js";

export interface MemoryTickerConfig {
  enabled: boolean;
  /** 每 N 轮触发一次滚动摘要 + compileToday。 */
  compileEvery: number;
  recentMessages: number;
  model: { provider: string; model: string };
  /** IANA 时区，用于逻辑日窗口。 */
  timeZone?: string;
  /** 每日任务深度记忆开关。 */
  deepMemory?: boolean;
}

/** 每日任务六步（含依赖顺序）。 */
export const DAILY_STEPS: ReadonlyArray<{ name: DailyStepName; label: string }> = [
  { name: "compileToday", label: "compileToday" },
  { name: "compileWeek", label: "compileWeek" },
  { name: "compileLongterm", label: "compileLongterm" },
  { name: "compileFacts", label: "compileFacts" },
  { name: "assemble", label: "assemble" },
  { name: "deepMemory", label: "deepMemory" },
];

/**
 * 注册记忆调度器：
 * - `agent/pre-step`（waterfall）：按 turn 变化计数，每 compileEvery 轮触发后台编译；
 * - `agent/turn-stopping`（serial）：turn 关闭前检查（轮数补齐 + 日期检查）；
 * - `agent/disposed`（emit）：session 结束触发 final 滚动摘要；
 * - 每小时定时检查日期变化（备用触发）。
 */
export function registerMemoryTicker(
  ctx: Context,
  config: MemoryTickerConfig,
  paths: ProfilePaths,
  agentName: string,
): void {
  let turnsSinceCompile = 0;
  let lastTurn = -1;
  const summaryInProgress = new Set<string>();
  let lastLogicalDate = getLogicalDay(Date.now(), config.timeZone).logicalDate;
  let dailyRunning = false;

  const provider = config.model?.provider || "deepseek-official";
  const model = config.model?.model || "deepseek-v4-flash";

  /** 滚动摘要（带 in-progress 锁）。 */
  async function runRollingSummary(session: Session, sessionId: string, signal?: AbortSignal): Promise<void> {
    if (summaryInProgress.has(sessionId)) return;
    summaryInProgress.add(sessionId);
    try {
      await updateRollingSummary({
        ctx,
        paths,
        sessionId,
        session,
        provider,
        model,
        agentName,
        userName: "用户",
        signal,
      });
    } finally {
      summaryInProgress.delete(sessionId);
    }
  }

  /** 轮数触发链：滚动摘要 → compileToday → assemble（全部后台异步）。 */
  function runTurnCompile(session: Session, sessionId: string, signal?: AbortSignal): void {
    void (async () => {
      try {
        await runRollingSummary(session, sessionId, signal);
        await compileToday({ ctx, paths, provider, model, timeZone: config.timeZone, signal });
        assemble({ ctx, paths, provider, model, timeZone: config.timeZone, signal });
      } catch (error) {
        ctx.logger.warn(`[assistant-soul] 记忆编译失败：${String(error)}`);
      }
    })();
  }

  /** 每日任务：六步断点续跑，每步独立健康状态。 */
  async function runDailyTask(): Promise<void> {
    if (dailyRunning) return;
    dailyRunning = true;
    const now = Date.now();
    const day = getLogicalDay(now, config.timeZone);
    try {
      let state = readDailyState(paths);
      if (state.lastDailyDate !== day.logicalDate) {
        // 新的一天：重置断点
        state = { ...state, lastDailyDate: day.logicalDate, completed: [], health: state.health };
      }
      const cx = { ctx, paths, provider, model, timeZone: config.timeZone, now };

      for (const step of DAILY_STEPS) {
        if (state.completed.includes(step.name)) continue;
        try {
          switch (step.name) {
            case "compileToday":
              await compileToday(cx);
              break;
            case "compileWeek":
              await compileWeek(cx);
              break;
            case "compileLongterm":
              await compileLongterm(cx);
              break;
            case "compileFacts":
              await compileFacts(cx);
              break;
            case "assemble":
              assemble(cx);
              break;
            case "deepMemory": {
              if (config.deepMemory !== false) {
                const store = new SessionSummaryStore(paths);
                const factStore = new FactStore(paths.factsDb);
                try {
                  await processDirtySessions({ ctx, paths, store, factStore, provider, model, timeZone: config.timeZone, now });
                } finally {
                  factStore.close();
                }
              }
              break;
            }
          }
          markStepSuccess(paths, state, step.name, now);
          ctx.logger.info(`[assistant-soul] 每日任务完成：${step.label}`);
        } catch (error) {
          markStepFailure(paths, state, step.name, now, error);
          ctx.logger.warn(`[assistant-soul] 每日任务失败：${step.label} - ${String(error)}`);
          break; // 断点续跑：失败后停止本轮，下轮从失败步骤继续
        }
      }
    } finally {
      dailyRunning = false;
    }
  }

  // agent/pre-step：轮数计数 + 触发
  ctx.on("agent/pre-step", (payload, next) => {
    const session = (payload as { agent?: { session?: Session } }).agent?.session;
    const turn = (payload as { turn?: number }).turn ?? -1;
    const signal = (payload as { signal?: AbortSignal }).signal;
    if (turn !== lastTurn) {
      lastTurn = turn;
      turnsSinceCompile += 1;
      if (turnsSinceCompile >= Math.max(1, config.compileEvery)) {
        turnsSinceCompile = 0;
        if (session) runTurnCompile(session, session.id, signal);
      }
      // 顺带检查日期变化（主触发之一）
      const today = getLogicalDay(Date.now(), config.timeZone).logicalDate;
      if (today !== lastLogicalDate) {
        lastLogicalDate = today;
        void runDailyTask().catch((error) => ctx.logger.warn(`[assistant-soul] 每日任务异常：${String(error)}`));
      }
    }
    return next();
  });

  // agent/turn-stopping：turn 关闭前，检查日期变化（serial 事件，快速返回不阻塞）
  ctx.on("agent/turn-stopping", () => {
    try {
      const today = getLogicalDay(Date.now(), config.timeZone).logicalDate;
      if (today !== lastLogicalDate) {
        lastLogicalDate = today;
        void runDailyTask().catch((error) => ctx.logger.warn(`[assistant-soul] 每日任务异常：${String(error)}`));
      }
    } catch {
      /* 观察性检查失败不阻塞回合 */
    }
  });

  // agent/disposed：session 结束 → final 滚动摘要
  ctx.on("agent/disposed", (payload) => {
    const session = (payload as { agent?: { session?: Session } }).agent?.session;
    if (!session) return;
    void (async () => {
      try {
        await runRollingSummary(session, session.id);
        await compileToday({ ctx, paths, provider, model, timeZone: config.timeZone });
        assemble({ ctx, paths, provider, model, timeZone: config.timeZone });
      } catch (error) {
        ctx.logger.warn(`[assistant-soul] session 结束记忆编译失败：${String(error)}`);
      }
    })();
  });

  // 每小时日期检查（备用触发）
  const timer = setInterval(() => {
    const today = getLogicalDay(Date.now(), config.timeZone).logicalDate;
    if (today !== lastLogicalDate) {
      lastLogicalDate = today;
      void runDailyTask().catch((error) => ctx.logger.warn(`[assistant-soul] 每日任务异常：${String(error)}`));
    }
  }, 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  // ctx.effect 在 cordis 4 存在；测试 mock ctx 可能没有，防御性调用
  if (typeof (ctx as { effect?: (execute: () => unknown) => unknown }).effect === "function") {
    (ctx as { effect: (execute: () => unknown) => unknown }).effect(() => () => clearInterval(timer));
  }
}

/* ------------------------------------------------------------------ */
/* 健康状态（daily-state.json 读写）                                    */
/* ------------------------------------------------------------------ */

function markStepSuccess(paths: ProfilePaths, state: DailyState, step: DailyStepName, now: number): void {
  const next = { ...state, completed: [...state.completed.filter((s) => s !== step), step] };
  next.health[step] = {
    lastSuccessAt: new Date(now).toISOString(),
    lastErrorAt: next.health[step]?.lastErrorAt ?? null,
    lastErrorMsg: null,
    failCount: 0,
  };
  writeDailyState(paths, next);
}

function markStepFailure(paths: ProfilePaths, state: DailyState, step: DailyStepName, now: number, error: unknown): void {
  const current = state.health[step];
  const next = { ...state };
  next.health[step] = {
    lastSuccessAt: current?.lastSuccessAt ?? null,
    lastErrorAt: new Date(now).toISOString(),
    lastErrorMsg: error instanceof Error ? error.message : String(error),
    failCount: (current?.failCount ?? 0) + 1,
  };
  writeDailyState(paths, next);
}

export { readDailyState, writeDailyState } from "./daily-state.js";
export type { DailyState, DailyStepName, StepHealth } from "./daily-state.js";

/**
 * 每日任务状态（daily-state.json）：断点续跑 + 健康状态。
 *
 * 对应 Hana `daily-state.json` 语义：
 * - `lastDailyDate`：上次执行的逻辑日；
 * - `completed`：当天已完成的步骤名（断点续跑：同一天不重复执行）；
 * - `health`：每步 { lastSuccessAt, lastErrorAt, lastErrorMsg, failCount }，
 *   成功即 failCount 清零。
 */
import { readFileSync } from "node:fs";
import type { ProfilePaths } from "./paths.js";
import { atomicWriteFileSync } from "./atomic.js";

export type DailyStepName =
  | "compileToday"
  | "compileWeek"
  | "compileLongterm"
  | "compileFacts"
  | "assemble"
  | "deepMemory";

export interface StepHealth {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  failCount: number;
}

export interface DailyState {
  lastDailyDate: string | null;
  completed: DailyStepName[];
  health: Partial<Record<DailyStepName, StepHealth>>;
}

export function emptyDailyState(): DailyState {
  return { lastDailyDate: null, completed: [], health: {} };
}

/** 读每日任务状态；文件缺失/损坏返回空状态。 */
export function readDailyState(paths: ProfilePaths): DailyState {
  try {
    const raw = JSON.parse(readFileSync(paths.dailyState, "utf8"));
    if (!raw || typeof raw !== "object") return emptyDailyState();
    const health: Partial<Record<DailyStepName, StepHealth>> = {};
    for (const [key, value] of Object.entries(raw.health ?? {})) {
      const step = key as DailyStepName;
      if (value && typeof value === "object") {
        health[step] = {
          lastSuccessAt: typeof (value as StepHealth).lastSuccessAt === "string" ? (value as StepHealth).lastSuccessAt : null,
          lastErrorAt: typeof (value as StepHealth).lastErrorAt === "string" ? (value as StepHealth).lastErrorAt : null,
          lastErrorMsg: typeof (value as StepHealth).lastErrorMsg === "string" ? (value as StepHealth).lastErrorMsg : null,
          failCount: Number.isFinite((value as StepHealth).failCount) ? (value as StepHealth).failCount : 0,
        };
      }
    }
    return {
      lastDailyDate: typeof raw.lastDailyDate === "string" ? raw.lastDailyDate : null,
      completed: Array.isArray(raw.completed)
        ? raw.completed.filter((name: unknown): name is DailyStepName => typeof name === "string")
        : [],
      health,
    };
  } catch {
    return emptyDailyState();
  }
}

/** 原子写每日任务状态。 */
export function writeDailyState(paths: ProfilePaths, state: DailyState): void {
  atomicWriteFileSync(paths.dailyState, JSON.stringify(state, null, 2) + "\n");
}

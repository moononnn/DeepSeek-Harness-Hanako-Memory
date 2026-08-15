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
import { atomicWriteFileSync } from "./atomic.js";
export function emptyDailyState() {
    return { lastDailyDate: null, completed: [], health: {} };
}
/** 读每日任务状态；文件缺失/损坏返回空状态。 */
export function readDailyState(paths) {
    try {
        const raw = JSON.parse(readFileSync(paths.dailyState, "utf8"));
        if (!raw || typeof raw !== "object")
            return emptyDailyState();
        const health = {};
        for (const [key, value] of Object.entries(raw.health ?? {})) {
            const step = key;
            if (value && typeof value === "object") {
                health[step] = {
                    lastSuccessAt: typeof value.lastSuccessAt === "string" ? value.lastSuccessAt : null,
                    lastErrorAt: typeof value.lastErrorAt === "string" ? value.lastErrorAt : null,
                    lastErrorMsg: typeof value.lastErrorMsg === "string" ? value.lastErrorMsg : null,
                    failCount: Number.isFinite(value.failCount) ? value.failCount : 0,
                };
            }
        }
        return {
            lastDailyDate: typeof raw.lastDailyDate === "string" ? raw.lastDailyDate : null,
            completed: Array.isArray(raw.completed)
                ? raw.completed.filter((name) => typeof name === "string")
                : [],
            health,
        };
    }
    catch {
        return emptyDailyState();
    }
}
/** 原子写每日任务状态。 */
export function writeDailyState(paths, state) {
    atomicWriteFileSync(paths.dailyState, JSON.stringify(state, null, 2) + "\n");
}

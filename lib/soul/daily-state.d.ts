import type { ProfilePaths } from "./paths.js";
export type DailyStepName = "compileToday" | "compileWeek" | "compileLongterm" | "compileFacts" | "assemble" | "deepMemory";
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
export declare function emptyDailyState(): DailyState;
/** 读每日任务状态；文件缺失/损坏返回空状态。 */
export declare function readDailyState(paths: ProfilePaths): DailyState;
/** 原子写每日任务状态。 */
export declare function writeDailyState(paths: ProfilePaths, state: DailyState): void;

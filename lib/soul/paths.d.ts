export interface ProfilePaths {
    /** profile 根目录：<dshHome>/assistant-soul/<profile> */
    root: string;
    /** 置顶记忆文件 pinned.md */
    pinned: string;
    /** 置顶记忆索引 pinned-memory.json */
    pinnedIndex: string;
    /** 记忆快照目录 memory/ */
    memoryDir: string;
    /** 滚动摘要目录 memory/summaries/（每 session 一个 <sessionId>.md + <sessionId>.json 元数据） */
    summariesDir: string;
    /** FactStore 数据库 memory/facts.db（node:sqlite） */
    factsDb: string;
    /** 组装快照 memory/memory.md（四段拼装产物，UI 只读展示用） */
    memoryMd: string;
    /** 每日任务状态 memory/daily-state.json（断点续跑 + 健康状态） */
    dailyState: string;
    /** 经验目录 experience/ */
    experienceDir: string;
    /** 经验索引 experience.md */
    experienceIndex: string;
}
/**
 * 解析一个 profile 的全部数据路径。
 * @param dshHome - 显式 dshHome 覆盖；空串/undefined 时走默认解析（$DSH_HOME → ~/.dsh）。
 * @param profile - profile 目录名，唯一标识一个助手。
 */
export declare function resolveProfileDir(dshHome: string | undefined, profile: string): ProfilePaths;
export interface UserPaths {
    /** <dshHome>/assistant-soul/user.yaml（name + profile） */
    yaml: string;
    /** <dshHome>/assistant-soul/user-avatar.png */
    avatar: string;
}
/**
 * 解析全局用户文件路径。home 解析逻辑与 resolveProfileDir 完全一致：
 * 显式配置 > $DSH_HOME 环境变量 > ~/.dsh；多 dshHome 场景下 user.yaml 跟着 home 走。
 */
export declare function resolveUserPaths(dshHome: string | undefined): UserPaths;

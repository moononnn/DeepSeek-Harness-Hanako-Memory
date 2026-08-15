/** 分层编译四文件的读取顺序（soul 插件 COMPILED_MEMORY_BLOCKS 同序）。 */
export declare const MEMORY_SECTION_KEYS: readonly ["facts", "today", "week", "longterm"];
export type MemorySectionKey = (typeof MEMORY_SECTION_KEYS)[number];
/** 一个滚动摘要文件的信息（内容随列表返回，前端 <details> 展开显示）。 */
export interface MemorySummaryEntry {
    /** 文件名（xxx.md）。 */
    file: string;
    /** 会话 id（去 .md 后缀）。 */
    sessionId: string;
    /** 最后修改时间（ms 时间戳）。 */
    updatedAt: number;
    /** 文件大小（字节）。 */
    size: number;
    /** 摘要正文（可展开显示）。 */
    content: string;
}
/** GET /api/agents/{id}/memory 的返回结构。 */
export interface MemorySnapshot {
    /** 四文件内容（缺失回落空串）。 */
    sections: Record<MemorySectionKey, string>;
    /** 组装快照 memory.md 全文；不存在返回空串。 */
    memoryMd: string;
    /** summaries/ 下 .md 文件列表（按更新时间倒序）；目录不存在返回空数组。 */
    summaries: MemorySummaryEntry[];
    /** facts.db 是否存在。 */
    factsDbExists: boolean;
    /** facts 表条数；不存在/打不开返回 null（前端显示「不可用」）。 */
    factsCount: number | null;
}
/** 读一个 profile 的 memory 目录（只读）；目录不存在返回空快照。 */
export declare function readMemorySnapshot(soulRoot: string, profile: string): MemorySnapshot;
/**
 * facts.db 条数统计（只读打开，只跑 COUNT）。
 * - 文件不存在 / 打不开 / 表缺失 → 返回 null（前端显示「不可用」），绝不抛错。
 */
export declare function countFacts(dbPath: string): number | null;

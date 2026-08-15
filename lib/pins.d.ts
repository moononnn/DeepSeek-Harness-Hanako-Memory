export interface PinnedEntry {
    id: string;
    content: string;
}
/** 条目 id：与 soul 插件 entryId() 一致（sha256 前 10 位）。 */
export declare function pinnedEntryId(content: string): string;
/** 一个 profile 的置顶记忆文件路径。 */
export declare function pinFiles(soulRoot: string, profile: string): {
    md: string;
    json: string;
};
/**
 * 读置顶记忆索引；pinned-memory.json 缺失/损坏时从 pinned.md 重建（与 soul 同策略）。
 * 两者都拿不到时返回空列表。
 */
export declare function readPinnedEntries(soulRoot: string, profile: string): PinnedEntry[];
/** 追加一条置顶记忆（内容去重，与 pin_memory 同款行为）。 */
export declare function addPinnedEntry(soulRoot: string, profile: string, content: string): {
    added: boolean;
    alreadyExists: boolean;
};
/**
 * 删除置顶记忆：按 id 精确匹配，或按内容/关键词（包含）删除（与 soul unpin_memory 同语义）。
 * @returns 删除的条目数；0 表示没匹配到。
 */
export declare function removePinnedEntry(soulRoot: string, profile: string, idOrKeyword: string): {
    removed: number;
};
/** 校验 profile 名是合法预设 id（防目录穿越；记忆隔离要求 profile = 预设 id）。 */
export declare function isValidProfile(profile: string): boolean;
/** 列出 profile 数据目录下已存在的置顶记忆文件（供调试/只读视图）。 */
export declare function pinFilesOnDisk(soulRoot: string, profile: string): string[];

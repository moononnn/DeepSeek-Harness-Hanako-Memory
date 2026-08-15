import type { ProfilePaths } from "./paths.js";
export type MemorySectionKey = "facts" | "today" | "week" | "longterm";
export declare const COMPILED_MEMORY_BLOCKS: ReadonlyArray<{
    key: MemorySectionKey;
    file: string;
    label: string;
}>;
export type CompiledMemory = Record<MemorySectionKey, string>;
/** 空快照：{ facts: "", today: "", week: "", longterm: "" }。 */
export declare function emptyCompiledMemory(): CompiledMemory;
/** 标准化一段编译输出：去首尾空白，连续空行压成一个。 */
export declare function normalizeCompiledSectionBody(body: string): string;
/** 标准化整个快照对象。 */
export declare function normalizeCompiledMemory(value?: Partial<CompiledMemory> | null): CompiledMemory;
/** 是否有任何记忆内容（任一 key 非空）。 */
export declare function hasCompiledMemory(compiled: Partial<CompiledMemory>): boolean;
/** 剔除空值字段，仅保留有内容的部分。 */
export declare function compactCompiledMemory(compiled: CompiledMemory): Partial<CompiledMemory>;
/** 读一段已编译记忆；不存在返回空串。 */
export declare function readMemorySectionBody(paths: ProfilePaths, key: MemorySectionKey): string;
/** 读全部四段。 */
export declare function readCompiledMemorySnapshot(paths: ProfilePaths): CompiledMemory;
/**
 * 写一段编译记忆（原子写）。body 为 undefined 时跳过（不覆盖旧值）；
 * 空串时写空文件（清空该段）。
 */
export declare function writeMemorySectionBody(paths: ProfilePaths, key: MemorySectionKey, body: string): void;
/** 写整个快照（只写传入的 key；段缺失不覆盖旧值，兼容旧行为）。 */
export declare function writeCompiledMemorySnapshot(paths: ProfilePaths, compiled: Partial<CompiledMemory>): void;
/** 从 memory.md 反向解析四段；`（暂无）` / `(none)` 视为空。 */
export declare function parseMemoryMd(content: string): CompiledMemory;
/** 读 memory.md；不存在返回空串。 */
export declare function readMemoryMd(paths: ProfilePaths): string;
/** 记忆快照渲染文本（systemPrompt variable）：`## 记忆快照` + 四段；空返回空串。 */
export declare function formatMemorySnapshotBody(paths: ProfilePaths): string;
export { COMPILED_MEMORY_BLOCKS as MEMORY_FILES };

/**
 * 编译记忆快照（compiled memory snapshot）：四个 .md 文件的统一读写。
 *
 * 对应 Hana `lib/memory/compiled-memory-snapshot.ts`：
 * - 四块记忆：facts / today / week / longterm，文件名固定；
 * - 标准化：`normalizeCompiledSectionBody()` 去首尾空白、压空行；
 * - memory.md 解析：中英文标题映射，`（暂无）` / `(none)` 视为空。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProfilePaths } from "./paths.js";
import { atomicWriteFileSync } from "./atomic.js";

export type MemorySectionKey = "facts" | "today" | "week" | "longterm";

export const COMPILED_MEMORY_BLOCKS: ReadonlyArray<{ key: MemorySectionKey; file: string; label: string }> = [
  { key: "facts", file: "facts.md", label: "重要事实" },
  { key: "today", file: "today.md", label: "今天" },
  { key: "week", file: "week.md", label: "本周早些时候" },
  { key: "longterm", file: "longterm.md", label: "长期情况" },
];

export type CompiledMemory = Record<MemorySectionKey, string>;

/** 空快照：{ facts: "", today: "", week: "", longterm: "" }。 */
export function emptyCompiledMemory(): CompiledMemory {
  return { facts: "", today: "", week: "", longterm: "" };
}

/** 标准化一段编译输出：去首尾空白，连续空行压成一个。 */
export function normalizeCompiledSectionBody(body: string): string {
  return String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 标准化整个快照对象。 */
export function normalizeCompiledMemory(value?: Partial<CompiledMemory> | null): CompiledMemory {
  const result = emptyCompiledMemory();
  if (value && typeof value === "object") {
    for (const { key } of COMPILED_MEMORY_BLOCKS) {
      result[key] = normalizeCompiledSectionBody(typeof value[key] === "string" ? (value[key] as string) : "");
    }
  }
  return result;
}

/** 是否有任何记忆内容（任一 key 非空）。 */
export function hasCompiledMemory(compiled: Partial<CompiledMemory>): boolean {
  return COMPILED_MEMORY_BLOCKS.some(({ key }) => !!normalizeCompiledSectionBody(compiled[key] ?? ""));
}

/** 剔除空值字段，仅保留有内容的部分。 */
export function compactCompiledMemory(compiled: CompiledMemory): Partial<CompiledMemory> {
  const result: Partial<CompiledMemory> = {};
  for (const { key } of COMPILED_MEMORY_BLOCKS) {
    const body = normalizeCompiledSectionBody(compiled[key]);
    if (body) result[key] = body;
  }
  return result;
}

/** 读一段已编译记忆；不存在返回空串。 */
export function readMemorySectionBody(paths: ProfilePaths, key: MemorySectionKey): string {
  const file = COMPILED_MEMORY_BLOCKS.find((block) => block.key === key)?.file;
  if (!file) return "";
  try {
    return readFileSync(join(paths.memoryDir, file), "utf8").trim();
  } catch {
    return "";
  }
}

/** 读全部四段。 */
export function readCompiledMemorySnapshot(paths: ProfilePaths): CompiledMemory {
  const result = emptyCompiledMemory();
  for (const { key } of COMPILED_MEMORY_BLOCKS) result[key] = readMemorySectionBody(paths, key);
  return result;
}

/**
 * 写一段编译记忆（原子写）。body 为 undefined 时跳过（不覆盖旧值）；
 * 空串时写空文件（清空该段）。
 */
export function writeMemorySectionBody(paths: ProfilePaths, key: MemorySectionKey, body: string): void {
  const file = COMPILED_MEMORY_BLOCKS.find((block) => block.key === key)?.file;
  if (!file) return;
  const normalized = normalizeCompiledSectionBody(body ?? "");
  atomicWriteFileSync(join(paths.memoryDir, file), normalized ? `${normalized}\n` : "");
}

/** 写整个快照（只写传入的 key；段缺失不覆盖旧值，兼容旧行为）。 */
export function writeCompiledMemorySnapshot(paths: ProfilePaths, compiled: Partial<CompiledMemory>): void {
  for (const { key } of COMPILED_MEMORY_BLOCKS) {
    const body = compiled[key];
    if (body === undefined) continue;
    writeMemorySectionBody(paths, key, body);
  }
}

/** memory.md 标题 → key 映射（中英文）。 */
const MEMORY_MD_TITLE_MAP: Record<string, MemorySectionKey> = {
  "重要事实": "facts",
  "key facts": "facts",
  "今天": "today",
  "today": "today",
  "本周早些时候": "week",
  "earlier this week": "week",
  "长期情况": "longterm",
  "long-term context": "longterm",
};

/** 从 memory.md 反向解析四段；`（暂无）` / `(none)` 视为空。 */
export function parseMemoryMd(content: string): CompiledMemory {
  const result = emptyCompiledMemory();
  const buckets: Record<MemorySectionKey, string[]> = { facts: [], today: [], week: [], longterm: [] };
  let current: MemorySectionKey | null = null;
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = MEMORY_MD_TITLE_MAP[match[1].trim().toLowerCase()] ?? null;
      continue;
    }
    if (current) buckets[current].push(line);
  }
  for (const key of Object.keys(buckets) as MemorySectionKey[]) {
    const body = buckets[key].join("\n").trim();
    result[key] = body === "（暂无）" || body === "(none)" ? "" : normalizeCompiledSectionBody(body);
  }
  return result;
}

/** 读 memory.md；不存在返回空串。 */
export function readMemoryMd(paths: ProfilePaths): string {
  try {
    return existsSync(paths.memoryMd) ? readFileSync(paths.memoryMd, "utf8") : "";
  } catch {
    return "";
  }
}

/** 记忆快照渲染文本（systemPrompt variable）：`## 记忆快照` + 四段；空返回空串。 */
export function formatMemorySnapshotBody(paths: ProfilePaths): string {
  const parts: string[] = [];
  for (const { key, label } of COMPILED_MEMORY_BLOCKS) {
    const body = readMemorySectionBody(paths, key);
    if (body) parts.push(`## ${label}\n${body}`);
  }
  if (parts.length === 0) return "";
  return `## 记忆快照\n\n${parts.join("\n\n")}`;
}

export { COMPILED_MEMORY_BLOCKS as MEMORY_FILES };

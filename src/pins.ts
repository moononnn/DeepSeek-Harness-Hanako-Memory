/**
 * 置顶记忆读写：与 dsh-assistant-soul 运行时插件完全兼容（§6.2 / §7）。
 *
 * 数据布局（每个 profile 一个目录，profile = 预设 id，§10.8）：
 *   assistant-soul/<profile>/pinned.md          置顶记忆渲染视图（每行一条）
 *   assistant-soul/<profile>/pinned-memory.json 置顶记忆索引（{ items: [{ id, content }] }，用于 unpin）
 *
 * 兼容约定（照抄 soul 插件 src/memory.ts，勿改）：
 * - 条目 id = sha256(content) 前 10 位 hex；
 * - 读优先 pinned-memory.json，缺失/损坏时从 pinned.md 逐行重建；
 * - 写双写：pinned.md（每行一条）+ pinned-memory.json（完整索引）。
 *
 * 纪律：所有写文件走原子写（临时文件 + rename，§10.4）。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./presets.js";

export interface PinnedEntry {
  id: string;
  content: string;
}

/** 条目 id：与 soul 插件 entryId() 一致（sha256 前 10 位）。 */
export function pinnedEntryId(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 10);
}

/** 一个 profile 的置顶记忆文件路径。 */
export function pinFiles(soulRoot: string, profile: string): { md: string; json: string } {
  const root = join(soulRoot, profile);
  return { md: join(root, "pinned.md"), json: join(root, "pinned-memory.json") };
}

/**
 * 读置顶记忆索引；pinned-memory.json 缺失/损坏时从 pinned.md 重建（与 soul 同策略）。
 * 两者都拿不到时返回空列表。
 */
export function readPinnedEntries(soulRoot: string, profile: string): PinnedEntry[] {
  const { md, json } = pinFiles(soulRoot, profile);
  try {
    const raw = JSON.parse(readFileSync(json, "utf8"));
    if (Array.isArray(raw?.items)) {
      const entries: PinnedEntry[] = [];
      for (const item of raw.items) {
        if (typeof item?.content === "string" && item.content.trim()) {
          entries.push({ id: typeof item.id === "string" ? item.id : pinnedEntryId(item.content), content: item.content });
        }
      }
      return entries;
    }
  } catch {
    /* 回退到 md 重建 */
  }
  try {
    return readFileSync(md, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((content) => ({ id: pinnedEntryId(content), content }));
  } catch {
    return [];
  }
}

/** 双写置顶记忆（原子写）：pinned.md 每行一条 + pinned-memory.json 完整索引。 */
function writePinnedFiles(soulRoot: string, profile: string, entries: PinnedEntry[]): void {
  const { md, json } = pinFiles(soulRoot, profile);
  mkdirSync(join(soulRoot, profile), { recursive: true });
  atomicWrite(md, entries.map((entry) => entry.content).join("\n") + (entries.length ? "\n" : ""));
  atomicWrite(json, JSON.stringify({ items: entries }, null, 2));
}

/** 追加一条置顶记忆（内容去重，与 pin_memory 同款行为）。 */
export function addPinnedEntry(soulRoot: string, profile: string, content: string): { added: boolean; alreadyExists: boolean } {
  const clean = String(content ?? "").trim();
  if (!clean) throw new Error("置顶记忆内容不能为空");
  const entries = readPinnedEntries(soulRoot, profile);
  if (entries.some((entry) => entry.content === clean)) return { added: false, alreadyExists: true };
  writePinnedFiles(soulRoot, profile, [...entries, { id: pinnedEntryId(clean), content: clean }]);
  return { added: true, alreadyExists: false };
}

/**
 * 删除置顶记忆：按 id 精确匹配，或按内容/关键词（包含）删除（与 soul unpin_memory 同语义）。
 * @returns 删除的条目数；0 表示没匹配到。
 */
export function removePinnedEntry(soulRoot: string, profile: string, idOrKeyword: string): { removed: number } {
  const key = String(idOrKeyword ?? "").trim();
  if (!key) throw new Error("需要提供 id 或关键词");
  const entries = readPinnedEntries(soulRoot, profile);
  const remaining = entries.filter(
    (entry) => entry.id !== key && entry.content !== key && !entry.content.includes(key),
  );
  const removed = entries.length - remaining.length;
  if (removed === 0) return { removed };
  writePinnedFiles(soulRoot, profile, remaining);
  return { removed };
}

/** 校验 profile 名是合法预设 id（防目录穿越；记忆隔离要求 profile = 预设 id）。 */
export function isValidProfile(profile: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(profile) && !profile.includes("..");
}

/** 列出 profile 数据目录下已存在的置顶记忆文件（供调试/只读视图）。 */
export function pinFilesOnDisk(soulRoot: string, profile: string): string[] {
  const dir = join(soulRoot, profile);
  try {
    return readdirSync(dir).filter((f) => f === "pinned.md" || f === "pinned-memory.json");
  } catch {
    return [];
  }
}

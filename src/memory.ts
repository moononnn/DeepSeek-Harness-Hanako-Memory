/**
 * 记忆快照只读视图（Phase 4）：把 dsh-assistant-soul 运行时写入的记忆数据
 * 以只读方式暴露给管理页，不做任何写入（记忆由 soul 插件全权管理）。
 *
 * 数据布局（照抄 soul 插件 src/paths.ts，勿改）：
 *   assistant-soul/<profile>/memory/
 *   ├── today.md / week.md / longterm.md / facts.md   ← 分层编译快照（四文件）
 *   ├── memory.md                                     ← 组装快照（四段拼装，可选）
 *   ├── summaries/<sessionId>.md (+ .json 元数据)      ← 滚动摘要（每会话一个）
 *   └── facts.db                                      ← FactStore（SQLite，只统计条数）
 *
 * 纪律：
 * - 只读：任何情况不写 memory/ 下的文件；facts.db 用只读模式打开；
 * - 文件缺失/损坏一律回落空值，不抛错（只读视图要稳）；
 * - facts.db 用 node:sqlite（Node v24 内置，与 soul 插件同款，零外部依赖），
 *   只做 COUNT 统计，不强行可视化（§Phase 4 任务 1）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** 分层编译四文件的读取顺序（soul 插件 COMPILED_MEMORY_BLOCKS 同序）。 */
export const MEMORY_SECTION_KEYS = ["facts", "today", "week", "longterm"] as const;
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
export function readMemorySnapshot(soulRoot: string, profile: string): MemorySnapshot {
  const memoryDir = join(soulRoot, profile, "memory");
  const sections: Record<MemorySectionKey, string> = { facts: "", today: "", week: "", longterm: "" };

  if (existsSync(memoryDir)) {
    for (const key of MEMORY_SECTION_KEYS) {
      sections[key] = readTextSafe(join(memoryDir, `${key}.md`));
    }
  }

  return {
    sections,
    memoryMd: readTextSafe(join(memoryDir, "memory.md")),
    summaries: listSummaries(memoryDir),
    factsDbExists: existsSync(join(memoryDir, "facts.db")),
    factsCount: countFacts(join(memoryDir, "facts.db")),
  };
}

/** 读文本文件，任何失败回落空串。 */
function readTextSafe(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** 列出 summaries/ 下的 .md 文件（含内容），按 mtime 倒序（最新在前）。 */
function listSummaries(memoryDir: string): MemorySummaryEntry[] {
  const dir = join(memoryDir, "summaries");
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".md"));
  } catch {
    return [];
  }
  const entries: MemorySummaryEntry[] = [];
  for (const file of files) {
    const full = join(dir, file);
    try {
      const st = statSync(full);
      entries.push({
        file,
        sessionId: file.replace(/\.md$/, ""),
        updatedAt: st.mtimeMs,
        size: st.size,
        content: readFileSync(full, "utf8"),
      });
    } catch {
      /* 单个文件读失败跳过 */
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return entries;
}

/**
 * facts.db 条数统计（只读打开，只跑 COUNT）。
 * - 文件不存在 / 打不开 / 表缺失 → 返回 null（前端显示「不可用」），绝不抛错。
 */
export function countFacts(dbPath: string): number | null {
  if (!existsSync(dbPath)) return null;
  try {
    // readOnly: true：绝不触发 WAL 恢复/写入，防止只读视图动到运行时数据
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT COUNT(*) AS cnt FROM facts").get() as { cnt: number } | undefined;
      return row && typeof row.cnt === "number" ? row.cnt : 0;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

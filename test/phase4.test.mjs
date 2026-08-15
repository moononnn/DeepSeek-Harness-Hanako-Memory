// Phase 4 单测：记忆快照只读视图（§Phase 4 任务 1 / 3）。
// - readMemorySnapshot：四文件内容、memory.md、summaries 列表（文件名+更新时间+内容）、
//   facts.db 统计（node:sqlite 只读 COUNT，与 soul 插件同款，零外部依赖）；
// - 缺失/损坏回落：memory 目录不存在、文件缺失、facts.db 打不开 → 空值/null，绝不抛错；
// - 只读纪律：readMemorySnapshot 后 memory/ 目录内容与 mtime 不变（不写任何文件）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readMemorySnapshot, countFacts, MEMORY_SECTION_KEYS } from "../lib/memory.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dsh-am-mem-"));
}

/** 造一个 profile 的 memory/ 目录（四文件 + memory.md + summaries + facts.db）。 */
function seedMemoryDir(soulRoot, profile) {
  const memoryDir = join(soulRoot, profile, "memory");
  mkdirSync(join(memoryDir, "summaries"), { recursive: true });

  writeFileSync(join(memoryDir, "today.md"), "- 今天聊了工作节奏\n", "utf8");
  writeFileSync(join(memoryDir, "week.md"), "- 无。\n", "utf8");
  writeFileSync(join(memoryDir, "longterm.md"), "- 用户关注协作效率\n", "utf8");
  writeFileSync(join(memoryDir, "facts.md"), "- 助理工作节奏核心是「稳当」\n", "utf8");
  writeFileSync(
    join(memoryDir, "memory.md"),
    "## 记忆快照\n\n## 重要事实\n- 稳当\n\n## 今天\n- 聊了工作节奏\n",
    "utf8",
  );

  // 滚动摘要：两个会话（内容 + 元数据 .json 应被忽略，只列 .md）
  writeFileSync(join(memoryDir, "summaries", "sess-1.md"), "### 重要事实\n- 事实一\n\n### 事情经过\n- 过程一\n", "utf8");
  writeFileSync(join(memoryDir, "summaries", "sess-1.json"), '{"updated_at":"2026-08-15"}', "utf8");
  writeFileSync(join(memoryDir, "summaries", "sess-2.md"), "### 重要事实\n- 事实二\n\n### 事情经过\n- 过程二\n", "utf8");

  // facts.db：两条元事实
  const db = new DatabaseSync(join(memoryDir, "facts.db"));
  db.exec("CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL, search_text TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', time TEXT, session_id TEXT, created_at TEXT NOT NULL)");
  db.prepare("INSERT INTO facts (fact, search_text, tags, time, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    "用户喜欢喝茶", "用户喜欢喝茶 用户 喜欢 喝茶 喜欢 喝茶", "[]", "2026-08-15", "sess-1", "2026-08-15T00:00:00Z",
  );
  db.prepare("INSERT INTO facts (fact, search_text, tags, time, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    "用户作息偏晚", "用户作息偏晚 用户 作息 偏晚 作息 偏晚", "[]", "2026-08-15", "sess-2", "2026-08-15T00:00:00Z",
  );
  db.close();
  return memoryDir;
}

test("readMemorySnapshot：四文件 + memory.md + summaries + facts 统计齐全", () => {
  const root = tempRoot();
  const soulRoot = join(root, "assistant-soul");
  const profile = "xiaohua";
  const memoryDir = seedMemoryDir(soulRoot, profile);

  const snap = readMemorySnapshot(soulRoot, profile);

  // 四文件内容
  assert.ok(snap.sections.today.includes("今天聊了工作节奏"));
  assert.ok(snap.sections.week.includes("无。"));
  assert.ok(snap.sections.longterm.includes("协作效率"));
  assert.ok(snap.sections.facts.includes("稳当"));

  // memory.md 全文
  assert.ok(snap.memoryMd.includes("## 记忆快照"));
  assert.ok(snap.memoryMd.includes("重要事实"));

  // summaries：只列 .md（.json 忽略），按 mtime 倒序，带内容
  assert.equal(snap.summaries.length, 2);
  const ids = snap.summaries.map((s) => s.sessionId).sort();
  assert.deepEqual(ids, ["sess-1", "sess-2"]);
  for (const s of snap.summaries) {
    assert.ok(s.file.endsWith(".md"));
    assert.ok(typeof s.updatedAt === "number" && s.updatedAt > 0, "summaries 应带更新时间");
    assert.ok(s.size > 0, "summaries 应带文件大小");
    assert.ok(s.content.includes("### 重要事实") && s.content.includes("### 事情经过"), "summaries 应带正文（内容可展开）");
  }
  // 倒序：最新在前
  assert.ok(snap.summaries[0].updatedAt >= snap.summaries[1].updatedAt);

  // facts 统计
  assert.equal(snap.factsDbExists, true);
  assert.equal(snap.factsCount, 2);

  // 只读纪律：调用后目录文件与 mtime 原封不动
  const before = readdirSync(memoryDir).sort().join(",") + "|" + readdirSync(join(memoryDir, "summaries")).sort().join(",");
  const mtimes = statSync(join(memoryDir, "today.md")).mtimeMs;
  readMemorySnapshot(soulRoot, profile);
  const after = readdirSync(memoryDir).sort().join(",") + "|" + readdirSync(join(memoryDir, "summaries")).sort().join(",");
  assert.equal(after, before, "只读视图不应新增/删除任何文件");
  assert.equal(statSync(join(memoryDir, "today.md")).mtimeMs, mtimes, "只读视图不应改写文件");

  rmSync(root, { recursive: true, force: true });
});

test("readMemorySnapshot：目录缺失 / 文件缺失回落空值，不抛错", () => {
  const root = tempRoot();
  const soulRoot = join(root, "assistant-soul");

  // profile 目录完全不存在
  const snap = readMemorySnapshot(soulRoot, "ghost");
  assert.deepEqual(snap.sections, { facts: "", today: "", week: "", longterm: "" });
  assert.equal(snap.memoryMd, "");
  assert.deepEqual(snap.summaries, []);
  assert.equal(snap.factsDbExists, false);
  assert.equal(snap.factsCount, null);

  // memory/ 存在但只有部分文件
  const memoryDir = join(soulRoot, "partial", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, "today.md"), "- 只有今天\n", "utf8");
  const partial = readMemorySnapshot(soulRoot, "partial");
  assert.ok(partial.sections.today.includes("只有今天"));
  assert.equal(partial.sections.week, "");
  assert.equal(partial.sections.longterm, "");
  assert.equal(partial.sections.facts, "");
  assert.equal(partial.memoryMd, "");
  assert.deepEqual(partial.summaries, []);
  assert.equal(partial.factsCount, null);

  rmSync(root, { recursive: true, force: true });
});

test("countFacts：无库 / 空表 / 损坏库分别回落", () => {
  const root = tempRoot();

  // 不存在 → null
  assert.equal(countFacts(join(root, "nope.db")), null);

  // 空表（建库但没建表）→ null（表缺失）
  const emptyDb = join(root, "empty.db");
  new DatabaseSync(emptyDb).close();
  assert.equal(countFacts(emptyDb), null);

  // 建表无数据 → 0
  const zeroDb = join(root, "zero.db");
  const db0 = new DatabaseSync(zeroDb);
  db0.exec("CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL)");
  db0.close();
  assert.equal(countFacts(zeroDb), 0);

  // 损坏文件 → null（打不开不抛错）
  const badDb = join(root, "bad.db");
  writeFileSync(badDb, "this is not a sqlite database at all", "utf8");
  assert.equal(countFacts(badDb), null);

  rmSync(root, { recursive: true, force: true });
});

test("MEMORY_SECTION_KEYS：与 soul 插件四文件一致（facts/today/week/longterm）", () => {
  assert.deepEqual([...MEMORY_SECTION_KEYS], ["facts", "today", "week", "longterm"]);
});

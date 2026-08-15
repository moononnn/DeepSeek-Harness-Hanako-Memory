/**
 * 记忆单测：编译输出解析、置顶记忆增删、快照格式化、最近对话收集。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPinnedEntry,
  collectRecentConversation,
  formatMemorySnapshot,
  formatPinned,
  parseCompiledMemory,
  readPinnedEntries,
  removePinnedEntry,
  writeCompiledMemory,
} from "../../lib/soul/memory.js";
import { resolveProfileDir } from "../../lib/soul/paths.js";

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-soul-test-"));
  return resolveProfileDir(dir, "test-profile");
}

function cleanup(paths) {
  rmSync(join(paths.root, "..", "..", "assistant-soul"), { recursive: true, force: true });
}

test("parseCompiledMemory：标准四段输出", () => {
  const text = [
    "## 重要事实",
    "- 用户喜欢四川话",
    "- 用户做插件开发",
    "",
    "## 今天",
    "讨论了 dsh 插件 API",
    "",
    "## 本周早些时候",
    "本周初装好了环境",
    "",
    "## 长期情况",
    "目标是做出助手人格插件",
  ].join("\n");
  const parsed = parseCompiledMemory(text);
  assert.ok(parsed);
  assert.match(parsed.facts, /四川话/);
  assert.match(parsed.today, /dsh 插件 API/);
  assert.match(parsed.week, /装好了环境/);
  assert.match(parsed.longterm, /助手人格插件/);
});

test("parseCompiledMemory：带括号标题与缺失段", () => {
  const text = [
    "## 重要事实（稳定、跨会话的事实，一句话一条）",
    "1. 用户是开发者",
    "",
    "## 长期情况",
    "长期目标：多助手系统",
  ].join("\n");
  const parsed = parseCompiledMemory(text);
  assert.ok(parsed);
  assert.equal(parsed.today, undefined);
  assert.match(parsed.facts, /用户是开发者/);
  assert.match(parsed.longterm, /多助手系统/);
});

test("parseCompiledMemory：无法识别时返回 null", () => {
  assert.equal(parseCompiledMemory("没有任何标题的文本"), null);
  assert.equal(parseCompiledMemory(""), null);
  const onlyUnknown = "## 别的标题\n内容";
  assert.equal(parseCompiledMemory(onlyUnknown), null);
});

test("置顶记忆：追加去重 + 按 id 删除 + 按关键词删除", () => {
  const paths = tempPaths();
  try {
    const first = addPinnedEntry(paths, "用户叫小花");
    assert.equal(first.alreadyExists, false);
    const dup = addPinnedEntry(paths, "用户叫小花");
    assert.equal(dup.alreadyExists, true);
    addPinnedEntry(paths, "每周五开周会");

    const entries = readPinnedEntries(paths);
    assert.equal(entries.length, 2);
    const id = entries.find((e) => e.content === "用户叫小花").id;

    const byId = removePinnedEntry(paths, id);
    assert.equal(byId.removed, true);
    assert.equal(readPinnedEntries(paths).length, 1);

    const byKeyword = removePinnedEntry(paths, "周会");
    assert.equal(byKeyword.removed, true);
    assert.equal(readPinnedEntries(paths).length, 0);

    const miss = removePinnedEntry(paths, "不存在的关键词");
    assert.equal(miss.removed, false);

    // pinned.md 与 json 同步
    assert.equal(readFileSync(paths.pinned, "utf8").trim(), "");
  } finally {
    cleanup(paths);
  }
});

test("formatPinned / formatMemorySnapshot：空返回空串，有内容返回 markdown", () => {
  const paths = tempPaths();
  try {
    assert.equal(formatPinned(paths), "");
    assert.equal(formatMemorySnapshot(paths), "");

    addPinnedEntry(paths, "永远记住这件事");
    const pinned = formatPinned(paths);
    assert.match(pinned, /## 置顶记忆/);
    assert.match(pinned, /- 永远记住这件事/);

    writeCompiledMemory(paths, { facts: "- 事实一", longterm: "- 长期一" });
    const snapshot = formatMemorySnapshot(paths);
    assert.match(snapshot, /## 记忆快照/);
    assert.match(snapshot, /## 重要事实\n- 事实一/);
    assert.match(snapshot, /## 长期情况\n- 长期一/);
    assert.doesNotMatch(snapshot, /## 今天/);
  } finally {
    cleanup(paths);
  }
});

test("writeCompiledMemory：不覆盖缺失段", () => {
  const paths = tempPaths();
  try {
    writeCompiledMemory(paths, { facts: "- 事实A" });
    writeCompiledMemory(paths, { longterm: "- 长期B" });
    const snapshot = formatMemorySnapshot(paths);
    assert.match(snapshot, /事实A/);
    assert.match(snapshot, /长期B/);
  } finally {
    cleanup(paths);
  }
});

test("collectRecentConversation：按倒序收集、跳过插件注入", () => {
  const events = [
    { type: "user/message", data: { content: [{ type: "text", text: "第一条" }], source: { kind: "user" } } },
    { type: "assistant/message", data: { turn: 1, step: 0, message: { content: [{ type: "text", text: "回复一" }] } } },
    { type: "user/message", data: { content: [{ type: "text", text: "时间注入" }], source: { kind: "plugin", plugin: "time-context" } } },
    { type: "user/message", data: { content: [{ type: "text", text: "第二条" }], source: { kind: "user" } } },
    { type: "turn/start", data: { turn: 2 } },
    { type: "assistant/message", data: { turn: 2, step: 0, message: { content: [{ type: "text", text: "回复二" }, { type: "tool-call", id: "x", name: "todo_write", arguments: "{}" }] } } },
  ];
  const agent = { session: { events } };
  const text = collectRecentConversation(agent, 10);
  assert.match(text, /用户：第一条/);
  assert.match(text, /助手：回复一/);
  assert.match(text, /用户：第二条/);
  assert.match(text, /助手：回复二/);
  assert.doesNotMatch(text, /时间注入/);

  const limited = collectRecentConversation(agent, 2);
  // 最近两条：助手：回复二、用户：第二条（plugin 那条被跳过）
  assert.doesNotMatch(limited, /第一条/);
  assert.doesNotMatch(limited, /回复一/);
  assert.match(limited, /第二条/);
  assert.match(limited, /回复二/);
});

/**
 * 滚动摘要单测：格式契约校验、段提取、空事实判定、目录读写、修复输入构建。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProfileDir } from "../../lib/soul/paths.js";
import {
  extractFactSection,
  extractMarkdownSection,
  hasFactSectionHeading,
  isEmptyFactSection,
  validateRollingSummaryFormat,
  buildRollingSummaryFormatRequirements,
  buildRollingSummaryRepairPrompt,
  buildRollingSummaryRepairInput,
  SessionSummaryStore,
  FACT_SECTION_TITLES,
  TIMELINE_SECTION_TITLES,
} from "../../lib/soul/rolling-summary.js";

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "rolling-summary-test-"));
  return resolveProfileDir(dir, "test-profile");
}

function cleanup(paths) {
  rmSync(join(paths.root, "..", "..", "assistant-soul"), { recursive: true, force: true });
}

const VALID_SUMMARY = [
  "### 重要事实",
  "- 用户喜欢四川话",
  "- 用户在做插件开发",
  "",
  "### 事情经过",
  "- 2026-06-11 10:00 用户聊了记忆系统",
  "- 2026-06-11 11:00 讨论了编译方案",
].join("\n");

test("validateRollingSummaryFormat：合规摘要 ok", () => {
  const result = validateRollingSummaryFormat(VALID_SUMMARY);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("validateRollingSummaryFormat：缺事实段标题", () => {
  const text = "### 事情经过\n- 2026-06-11 10:00 聊了记忆系统";
  const result = validateRollingSummaryFormat(text);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("fact section heading")));
});

test("validateRollingSummaryFormat：缺事情经过标题", () => {
  const text = "### 重要事实\n- 用户喜欢四川话";
  const result = validateRollingSummaryFormat(text);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("timeline section heading")));
});

test("validateRollingSummaryFormat：事情经过嵌套比事实深且在其后", () => {
  const text = [
    "### 重要事实",
    "- 用户喜欢四川话",
    "",
    "#### 事情经过",
    "- 2026-06-11 10:00 聊了记忆系统",
  ].join("\n");
  const result = validateRollingSummaryFormat(text);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("nested deeper")));
});

test("validateRollingSummaryFormat：事实段正文为空", () => {
  const text = "### 重要事实\n\n### 事情经过\n- 2026-06-11 10:00 聊了记忆系统";
  const result = validateRollingSummaryFormat(text);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("fact section body is empty")));
});

test("validateRollingSummaryFormat：空文本 → 缺两个标题", () => {
  const result = validateRollingSummaryFormat("");
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
});

test("extractFactSection：提取事实段正文", () => {
  const body = extractFactSection(VALID_SUMMARY);
  assert.match(body, /用户喜欢四川话/);
  assert.doesNotMatch(body, /事情经过/);
});

test("extractMarkdownSection：任意层级标题都接受", () => {
  const text = "## 重要事实\n- 事实A\n\n## 事情经过\n- 经过B";
  assert.match(extractFactSection(text), /事实A/);
  const text2 = "#### Key Facts\n- Fact A\n\n#### Timeline\n- t";
  assert.match(extractFactSection(text2), /Fact A/);
});

test("hasFactSectionHeading：中英文标题检测", () => {
  assert.equal(hasFactSectionHeading("### 重要事实\n- x"), true);
  assert.equal(hasFactSectionHeading("### Key Facts\n- x"), true);
  assert.equal(hasFactSectionHeading("### 事情经过\n- x"), false);
  assert.equal(hasFactSectionHeading("自由格式摘要，没有标题"), false);
});

test("isEmptyFactSection：全空标记判定", () => {
  assert.equal(isEmptyFactSection("- 无"), true);
  assert.equal(isEmptyFactSection("- None"), true);
  assert.equal(isEmptyFactSection("- 无\n- None"), true);
  assert.equal(isEmptyFactSection("- 用户喜欢四川话"), false);
  assert.equal(isEmptyFactSection(""), true);
});

test("buildRollingSummaryFormatRequirements：中文模板含两个三级标题", () => {
  const text = buildRollingSummaryFormatRequirements("zh-CN");
  assert.match(text, /### 重要事实/);
  assert.match(text, /### 事情经过/);
  assert.match(text, /- 无/);
});

test("buildRollingSummaryRepairPrompt：修复器指令", () => {
  const prompt = buildRollingSummaryRepairPrompt("zh-CN");
  assert.match(prompt, /格式修复器/);
  assert.match(prompt, /原样重排/);
});

test("buildRollingSummaryRepairInput：带原因与草稿", () => {
  const input = buildRollingSummaryRepairInput({
    issues: ["missing fact section heading"],
    summaryText: "草稿内容",
  });
  assert.match(input, /校验失败原因/);
  assert.match(input, /missing fact section heading/);
  assert.match(input, /<draft-summary>/);
  assert.match(input, /草稿内容/);
});

test("SessionSummaryStore：写入 → 读回 → 脏判定 → 标记处理", () => {
  const paths = tempPaths();
  try {
    const store = new SessionSummaryStore(paths);
    store.saveSummary("session-1", {
      session_id: "session-1",
      created_at: "2026-06-11T02:00:00.000Z",
      updated_at: "2026-06-11T03:00:00.000Z",
      summary: VALID_SUMMARY,
      messageCount: 12,
      snapshot: "",
      snapshot_at: null,
      source_time_range: null,
    });

    // .md 文件按契约落盘
    const md = readFileSync(join(paths.summariesDir, "session-1.md"), "utf8");
    assert.match(md, /### 重要事实/);
    assert.match(md, /### 事情经过/);

    const record = store.getSummary("session-1");
    assert.ok(record);
    assert.equal(record.messageCount, 12);
    assert.equal(record.summary, VALID_SUMMARY);

    // 脏判定：snapshot 为空 → 脏
    const dirty = store.getDirtySessions();
    assert.equal(dirty.length, 1);

    // 标记处理后不再脏
    store.markProcessed("session-1");
    assert.equal(store.getDirtySessions().length, 0);

    // 更新摘要后再次脏
    store.saveSummary("session-1", { ...store.getSummary("session-1"), summary: VALID_SUMMARY + "\n- 新内容", updated_at: "2026-06-11T04:00:00.000Z" });
    assert.equal(store.getDirtySessions().length, 1);
  } finally {
    cleanup(paths);
  }
});

test("SessionSummaryStore：listSessionIds 与 getAllSummaries", () => {
  const paths = tempPaths();
  try {
    const store = new SessionSummaryStore(paths);
    store.saveSummary("a", { session_id: "a", created_at: "2026-06-11T02:00:00.000Z", updated_at: "2026-06-11T03:00:00.000Z", summary: VALID_SUMMARY, messageCount: 5, snapshot: "", snapshot_at: null, source_time_range: null });
    store.saveSummary("b", { session_id: "b", created_at: "2026-06-11T02:00:00.000Z", updated_at: "2026-06-11T03:00:00.000Z", summary: VALID_SUMMARY, messageCount: 5, snapshot: "", snapshot_at: null, source_time_range: null });
    assert.deepEqual(store.listSessionIds().sort(), ["a", "b"]);
    assert.equal(store.getAllSummaries().length, 2);
  } finally {
    cleanup(paths);
  }
});

test("标题常量：中英文标题值", () => {
  assert.deepEqual(FACT_SECTION_TITLES, ["重要事实", "Key Facts"]);
  assert.deepEqual(TIMELINE_SECTION_TITLES, ["事情经过", "Timeline"]);
});

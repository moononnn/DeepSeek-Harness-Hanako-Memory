/**
 * Deep Memory 单测：脏 session 提取、批量写库、重试/TTL 跳过、时间规范化、
 * JSON 解析（含 markdown 代码块包裹）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProfileDir } from "../../lib/soul/paths.js";
import { SessionSummaryStore } from "../../lib/soul/rolling-summary.js";
import { FactStore } from "../../lib/soul/fact-store.js";
import {
  processDirtySessions,
  parseExtractedFacts,
  normalizeFactTime,
  buildFactTimeContext,
  MAX_RETRIES,
} from "../../lib/soul/deep-memory.js";

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "deep-memory-test-"));
  return resolveProfileDir(dir, "test-profile");
}

function cleanup(paths) {
  rmSync(join(paths.root, "..", "..", "assistant-soul"), { recursive: true, force: true });
}

/** mock ctx：llm 返回给定文本（可按调用次数）。 */
function mockCtx(responses) {
  const calls = [];
  return {
    calls,
    logger: { info() {}, warn() {}, error() {} },
    llm: {
      stream() {
        calls.push(1);
        const text = Array.isArray(responses) ? responses[Math.min(calls.length - 1, responses.length - 1)] : responses;
        return (async function* () {
          yield { type: "text-delta", index: 0, text };
          yield { type: "finish", reason: { kind: "stop" } };
        })();
      },
    },
  };
}

function seedSummary(paths, sessionId, summary, updatedAtIso, snapshot = "") {
  const store = new SessionSummaryStore(paths);
  store.saveSummary(sessionId, {
    session_id: sessionId,
    created_at: updatedAtIso,
    updated_at: updatedAtIso,
    summary,
    messageCount: 8,
    snapshot,
    snapshot_at: snapshot ? updatedAtIso : null,
    source_time_range: { start: Date.parse("2026-06-11T02:00:00.000Z"), end: Date.parse("2026-06-11T04:00:00.000Z") },
  });
}

const SUMMARY = [
  "### 重要事实",
  "- 用户是独立开发者",
  "",
  "### 事情经过",
  "- 2026-06-11 10:00 用户聊了记忆系统",
].join("\n");

const FACTS_JSON = JSON.stringify([
  { fact: "用户是独立开发者", tags: ["用户画像", "职业"], time: null },
  { fact: "用户最近在关注记忆系统", tags: ["记忆系统", "近况"], time: "2026-06-11T10:00" },
]);

test("parseExtractedFacts：纯 JSON 数组", () => {
  const facts = parseExtractedFacts(FACTS_JSON);
  assert.equal(facts.length, 2);
  assert.equal(facts[0].fact, "用户是独立开发者");
  assert.deepEqual(facts[0].tags, ["用户画像", "职业"]);
  assert.equal(facts[0].time, null);
  assert.equal(facts[1].time, "2026-06-11T10:00");
});

test("parseExtractedFacts：markdown 代码块包裹兼容", () => {
  const wrapped = "```json\n" + FACTS_JSON + "\n```";
  const facts = parseExtractedFacts(wrapped);
  assert.equal(facts.length, 2);
});

test("parseExtractedFacts：过滤无效条目 + 空数组", () => {
  const mixed = JSON.stringify([
    { fact: "有效事实", tags: ["a"], time: null },
    { fact: "", tags: [] },
    { fact: 123, tags: [] },
    null,
  ]);
  const facts = parseExtractedFacts(mixed);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact, "有效事实");

  assert.deepEqual(parseExtractedFacts("[]"), []);
});

test("normalizeFactTime：摘要明确日期 + 会话本地日期", () => {
  const context = buildFactTimeContext(
    { start: Date.parse("2026-06-11T05:00:00.000Z"), end: Date.parse("2026-06-11T08:00:00.000Z") },
    SUMMARY,
    "UTC",
  );
  // 摘要里明确出现的日期时间 → 保留
  assert.equal(normalizeFactTime("2026-06-11T10:00", context), "2026-06-11T10:00");
  // 时间上下文提供的会话本地日期（仅 HH:MM 时组合）→ 摘要只有 HH:MM 且单本地日期
  const context2 = buildFactTimeContext(
    { start: Date.parse("2026-06-11T05:00:00.000Z"), end: Date.parse("2026-06-11T08:00:00.000Z") },
    "### 重要事实\n- x\n\n### 事情经过\n- 10:30 聊了天",
    "UTC",
  );
  assert.equal(normalizeFactTime("10:30", context2), "2026-06-11T10:30");
  // 跨多本地日期且只有 HH:MM → null
  const context3 = buildFactTimeContext(
    { start: Date.parse("2026-06-10T05:00:00.000Z"), end: Date.parse("2026-06-12T03:00:00.000Z") },
    "### 重要事实\n- x\n\n### 事情经过\n- 10:30 聊了天",
    "UTC",
  );
  assert.equal(normalizeFactTime("10:30", context3), null);
  // 无法确定 → null
  assert.equal(normalizeFactTime("2027-01-01", context), null);
  assert.equal(normalizeFactTime("", context), null);
  assert.equal(normalizeFactTime(null, context), null);
});

test("processDirtySessions：脏 session 提取事实 → 写库 → 标记处理", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY, "2026-06-11T05:00:00.000Z");
    const store = new SessionSummaryStore(paths);
    assert.equal(store.getDirtySessions().length, 1);

    const factStore = new FactStore(join(paths.factsDb));
    const ctx = mockCtx(FACTS_JSON);
    const result = await processDirtySessions({
      ctx,
      paths,
      store,
      factStore,
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      timeZone: "UTC",
      now: Date.UTC(2026, 5, 11, 10),
    });

    assert.equal(result.processed, 1);
    assert.equal(result.factsAdded, 2);
    assert.equal(factStore.size, 2);
    // session_id 记录正确
    assert.equal(factStore.getBySession("s1").length, 2);
    // 已标记处理 → 不再脏
    assert.equal(store.getDirtySessions().length, 0);
    // 事实带时间上下文
    const facts = factStore.getAll();
    const withTime = facts.find((f) => f.fact === "用户最近在关注记忆系统");
    assert.equal(withTime.time, "2026-06-11T10:00");
    factStore.close();
  } finally {
    cleanup(paths);
  }
});

test("processDirtySessions：无脏 session → 空跑", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY, "2026-06-11T05:00:00.000Z", SUMMARY); // snapshot === summary → 不脏
    const store = new SessionSummaryStore(paths);
    assert.equal(store.getDirtySessions().length, 0);
    const factStore = new FactStore(join(paths.factsDb));
    const ctx = mockCtx(FACTS_JSON);
    const result = await processDirtySessions({
      ctx,
      paths,
      store,
      factStore,
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      timeZone: "UTC",
      now: Date.UTC(2026, 5, 11, 10),
    });
    assert.equal(result.processed, 0);
    assert.equal(result.factsAdded, 0);
    assert.equal(ctx.calls.length, 0);
    factStore.close();
  } finally {
    cleanup(paths);
  }
});

test("processDirtySessions：LLM 失败重试 3 次后标记跳过", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY, "2026-06-11T05:00:00.000Z");
    const store = new SessionSummaryStore(paths);
    const factStore = new FactStore(join(paths.factsDb));

    // 连续失败：LLM 返回非法 JSON
    const failingCtx = mockCtx("不是 JSON");
    const failCounts = new Map();
    // 第一次（fail 1/3）
    await processDirtySessions({ ctx: failingCtx, paths, store, factStore, provider: "p", model: "m", timeZone: "UTC", now: Date.UTC(2026, 5, 11, 10), failCounts });
    // 第二次（fail 2/3）—— 摘要仍脏
    assert.equal(store.getDirtySessions().length, 1);
    await processDirtySessions({ ctx: failingCtx, paths, store, factStore, provider: "p", model: "m", timeZone: "UTC", now: Date.UTC(2026, 5, 11, 10), failCounts });
    // 第三次（fail 3/3）→ 标记跳过
    await processDirtySessions({ ctx: failingCtx, paths, store, factStore, provider: "p", model: "m", timeZone: "UTC", now: Date.UTC(2026, 5, 11, 10), failCounts });
    assert.equal(store.getDirtySessions().length, 0);
    assert.equal(factStore.size, 0);
    factStore.close();
  } finally {
    cleanup(paths);
  }
});

test("processDirtySessions：失败 TTL 过期后重新尝试", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY, "2026-06-11T05:00:00.000Z");
    const store = new SessionSummaryStore(paths);
    const factStore = new FactStore(join(paths.factsDb));

    const failCounts = new Map();
    const failingCtx = mockCtx("坏 JSON");
    // 失败 2 次
    await processDirtySessions({ ctx: failingCtx, paths, store, factStore, provider: "p", model: "m", timeZone: "UTC", now: Date.UTC(2026, 5, 11, 10), failCounts });
    await processDirtySessions({ ctx: failingCtx, paths, store, factStore, provider: "p", model: "m", timeZone: "UTC", now: Date.UTC(2026, 5, 11, 10), failCounts });
    assert.equal(failCounts.get("s1").count, 2);

    // TTL 过期（>60 分钟）后重试成功
    const okCtx = mockCtx(FACTS_JSON);
    const result = await processDirtySessions({
      ctx: okCtx,
      paths,
      store,
      factStore,
      provider: "p",
      model: "m",
      timeZone: "UTC",
      now: Date.UTC(2026, 5, 11, 13), // +3 小时 > TTL
      failCounts,
    });
    assert.equal(result.processed, 1);
    assert.equal(result.factsAdded, 2);
    assert.equal(store.getDirtySessions().length, 0);
    factStore.close();
  } finally {
    cleanup(paths);
  }
});

test("buildFactTimeContext：本地日期列表 + 明确时间", () => {
  const context = buildFactTimeContext(
    { start: Date.parse("2026-06-11T05:00:00.000Z"), end: Date.parse("2026-06-11T08:00:00.000Z") },
    "### 重要事实\n- x\n\n### 事情经过\n- 2026-06-11 10:00 聊了天",
    "UTC",
  );
  assert.deepEqual(context.localDates, ["2026-06-11"]);
  assert.deepEqual(context.summaryDateTimes, ["2026-06-11T10:00"]);
  assert.equal(context.singleSourceDate, "2026-06-11");
  assert.equal(context.spansMultipleSourceDates, false);
  assert.match(context.timezone, /UTC/);
});

test("MAX_RETRIES 常量 = 3", () => {
  assert.equal(MAX_RETRIES, 3);
});

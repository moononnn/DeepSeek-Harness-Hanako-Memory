/**
 * 分层编译单测：compileToday/Week/Longterm/Facts + assemble。
 * 用 mock ctx.llm 验证：
 * - 指纹缓存（无变化 skipped、不重复调 LLM）
 * - 依赖顺序（compileLongterm 依赖 week、compileFacts 提取事实段）
 * - 空窗口清空、无新事实保留旧数据
 * - 失败不覆盖旧数据
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProfileDir } from "../../lib/soul/paths.js";
import { compileToday, compileWeek, compileLongterm, compileFacts, assemble } from "../../lib/soul/compile.js";
import { readMemorySectionBody } from "../../lib/soul/compiled-snapshot.js";
import { SessionSummaryStore } from "../../lib/soul/rolling-summary.js";

/** 构造 mock ctx：llm.stream 返回按操作区分的文本，记录调用。 */
function mockCtx(responders) {
  const calls = [];
  return {
    calls,
    logger: { info() {}, warn() {}, error() {} },
    llm: {
      stream(opts) {
        calls.push({ operation: opts.purpose === "compaction" ? "compaction" : "?", system: opts.system, prompt: opts.messages?.[0]?.content?.[0]?.text ?? "" });
        const responder = responders?.[calls.length - 1] ?? (() => "输出");
        const text = typeof responder === "function" ? responder(calls.length - 1, calls[calls.length - 1]) : responder;
        return (async function* () {
          yield { type: "text-delta", index: 0, text };
          yield { type: "finish", reason: { kind: "stop" } };
        })();
      },
    },
  };
}

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "compile-test-"));
  return resolveProfileDir(dir, "test-profile");
}

function cleanup(paths) {
  rmSync(join(paths.root, "..", "..", "assistant-soul"), { recursive: true, force: true });
}

/** 种一个合规摘要（updated_at 落在固定时刻）。 */
function seedSummary(paths, sessionId, summary, updatedAt) {
  const store = new SessionSummaryStore(paths);
  store.saveSummary(sessionId, {
    session_id: sessionId,
    created_at: updatedAt,
    updated_at: updatedAt,
    summary,
    messageCount: 10,
    snapshot: "",
    snapshot_at: null,
    source_time_range: null,
  });
}

const SUMMARY_TODAY = [
  "### 重要事实",
  "- 用户喜欢四川话",
  "",
  "### 事情经过",
  "- 2026-06-11 10:00 用户聊了记忆系统",
].join("\n");

// 固定参考时刻：2026-06-11 10:00 UTC（当天窗口 [06-11T04:00Z, 06-12T04:00Z)）
const NOW = Date.UTC(2026, 5, 11, 10);

function todayCx(ctx, paths) {
  return { ctx, paths, provider: "opencode-go", model: "deepseek-v4-flash", timeZone: "UTC", now: NOW };
}

test("compileToday：无摘要 → 清空 today.md（cleared）", async () => {
  const paths = tempPaths();
  try {
    const ctx = mockCtx();
    const result = await compileToday(todayCx(ctx, paths));
    assert.equal(result, "cleared");
    assert.equal(ctx.calls.length, 0); // 不调 LLM
    assert.equal(readMemorySectionBody(paths, "today"), "");
  } finally {
    cleanup(paths);
  }
});

test("compileToday：有摘要 → 编译 + 写 today.md + 指纹", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY_TODAY, "2026-06-11T05:00:00.000Z");
    const ctx = mockCtx(["今天用户聊了记忆系统，关注记忆系统。"]);
    const result = await compileToday(todayCx(ctx, paths));
    assert.equal(result, "compiled");
    assert.equal(ctx.calls.length, 1);
    assert.match(ctx.calls[0].prompt, /时间线条目/);
    const body = readMemorySectionBody(paths, "today");
    assert.match(body, /记忆系统/);
    assert.ok(existsSync(join(paths.memoryDir, "today.md.fingerprint")));
  } finally {
    cleanup(paths);
  }
});

test("compileToday：输入无变化 → skipped（指纹缓存）", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY_TODAY, "2026-06-11T05:00:00.000Z");
    const ctx = mockCtx(["今天用户聊了记忆系统"]);
    assert.equal(await compileToday(todayCx(ctx, paths)), "compiled");
    assert.equal(ctx.calls.length, 1);

    // 摘要未变，再次编译 → skipped，不调 LLM
    const ctx2 = mockCtx(["不应该被调用"]);
    assert.equal(await compileToday(todayCx(ctx2, paths)), "skipped");
    assert.equal(ctx2.calls.length, 0);
  } finally {
    cleanup(paths);
  }
});

test("compileToday：摘要更新 → 重新编译（指纹变化）", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY_TODAY, "2026-06-11T05:00:00.000Z");
    const ctx = mockCtx(["第一版"]);
    assert.equal(await compileToday(todayCx(ctx, paths)), "compiled");

    // 摘要 updated_at 变化 → 指纹变化 → 重新编译
    seedSummary(paths, "s1", SUMMARY_TODAY + "\n- 新增经过", "2026-06-11T07:00:00.000Z");
    const ctx2 = mockCtx(["第二版"]);
    assert.equal(await compileToday(todayCx(ctx2, paths)), "compiled");
    assert.equal(ctx2.calls.length, 1);
  } finally {
    cleanup(paths);
  }
});

test("compileToday：LLM 失败不覆盖旧数据", async () => {
  const paths = tempPaths();
  try {
    seedSummary(paths, "s1", SUMMARY_TODAY, "2026-06-11T05:00:00.000Z");
    const ctx = mockCtx(["第一版"]);
    assert.equal(await compileToday(todayCx(ctx, paths)), "compiled");

    // 再次种入新摘要，LLM 抛错 → today.md 保留旧内容
    seedSummary(paths, "s1", SUMMARY_TODAY + "\n- 新增", "2026-06-11T09:00:00.000Z");
    const failingCtx = mockCtx();
    failingCtx.llm.stream = () => {
      throw new Error("LLM 挂了");
    };
    await assert.rejects(compileToday(todayCx(failingCtx, paths)));
    assert.match(readMemorySectionBody(paths, "today"), /第一版/);
  } finally {
    cleanup(paths);
  }
});

test("compileWeek：7 天窗口 → week.md；窗口外摘要不参与", async () => {
  const paths = tempPaths();
  try {
    // 窗口内（6-05 ~ 6-11）
    seedSummary(paths, "w1", SUMMARY_TODAY, "2026-06-10T05:00:00.000Z");
    // 窗口外（>7 天前）
    seedSummary(paths, "w2", SUMMARY_TODAY, "2026-05-20T05:00:00.000Z");
    const ctx = mockCtx(["本周用户关注记忆系统"]);
    const result = await compileWeek(todayCx(ctx, paths));
    assert.equal(result, "compiled");
    assert.match(readMemorySectionBody(paths, "week"), /记忆系统/);
  } finally {
    cleanup(paths);
  }
});

test("compileLongterm：依赖 week 内容；week 没变 → skipped", async () => {
  const paths = tempPaths();
  try {
    // 先有 week
    const ctx = mockCtx(["本周用户关注记忆系统"]);
    seedSummary(paths, "w1", SUMMARY_TODAY, "2026-06-10T05:00:00.000Z");
    assert.equal(await compileWeek(todayCx(ctx, paths)), "compiled");

    const ctx2 = mockCtx(["长期：用户是开发者，关注记忆系统"]);
    assert.equal(await compileLongterm(todayCx(ctx2, paths)), "compiled");
    assert.match(readMemorySectionBody(paths, "longterm"), /开发者/);

    // week 没变 → longterm skipped
    const ctx3 = mockCtx(["不该调用"]);
    assert.equal(await compileLongterm(todayCx(ctx3, paths)), "skipped");
    assert.equal(ctx3.calls.length, 0);
  } finally {
    cleanup(paths);
  }
});

test("compileFacts：30 天新摘要提取事实段 → facts.md", async () => {
  const paths = tempPaths();
  try {
    const summaryWithFacts = [
      "### 重要事实",
      "- 用户是独立开发者",
      "- 用户喜欢四川话",
      "",
      "### 事情经过",
      "- 2026-06-10 10:00 聊了记忆系统",
    ].join("\n");
    seedSummary(paths, "f1", summaryWithFacts, "2026-06-10T05:00:00.000Z");
    const ctx = mockCtx(["- 用户是独立开发者\n- 用户喜欢四川话"]);
    const result = await compileFacts(todayCx(ctx, paths));
    assert.equal(result, "compiled");
    const facts = readMemorySectionBody(paths, "facts");
    assert.match(facts, /独立开发者/);
  } finally {
    cleanup(paths);
  }
});

test("compileFacts：旧格式摘要（无事实段标题）跳过；无新事实保留旧 facts", async () => {
  const paths = tempPaths();
  try {
    // 旧格式摘要（自由格式，无标题）
    seedSummary(paths, "f1", "用户喜欢四川话，聊了记忆系统", "2026-06-10T05:00:00.000Z");
    // 已有旧 facts
    const fs = await import("../../lib/soul/compiled-snapshot.js");
    fs.writeMemorySectionBody(paths, "facts", "- 旧事实保留");
    const ctx = mockCtx(["不该调用"]);
    const result = await compileFacts(todayCx(ctx, paths));
    assert.equal(result, "skipped");
    assert.equal(ctx.calls.length, 0);
    assert.match(readMemorySectionBody(paths, "facts"), /旧事实保留/);
  } finally {
    cleanup(paths);
  }
});

test("compileFacts：事实段全空（- 无）→ 无新事实，保留旧 facts", async () => {
  const paths = tempPaths();
  try {
    const emptyFactsSummary = [
      "### 重要事实",
      "- 无",
      "",
      "### 事情经过",
      "- 2026-06-10 10:00 聊了记忆系统",
    ].join("\n");
    seedSummary(paths, "f1", emptyFactsSummary, "2026-06-10T05:00:00.000Z");
    const fs = await import("../../lib/soul/compiled-snapshot.js");
    fs.writeMemorySectionBody(paths, "facts", "- 旧事实保留");
    const ctx = mockCtx(["不该调用"]);
    assert.equal(await compileFacts(todayCx(ctx, paths)), "skipped");
    assert.equal(ctx.calls.length, 0);
    assert.match(readMemorySectionBody(paths, "facts"), /旧事实保留/);
  } finally {
    cleanup(paths);
  }
});

test("compileFacts：新摘要合并旧 facts 去重 → 不丢旧内容", async () => {
  const paths = tempPaths();
  try {
    const fs = await import("../../lib/soul/compiled-snapshot.js");
    fs.writeMemorySectionBody(paths, "facts", "- 用户是开发者");
    const summaryWithFacts = "### 重要事实\n- 用户喜欢四川话\n\n### 事情经过\n- 2026-06-10 10:00 聊了记忆系统";
    seedSummary(paths, "f1", summaryWithFacts, "2026-06-10T05:00:00.000Z");
    const ctx = mockCtx(["- 用户是开发者\n- 用户喜欢四川话"]);
    assert.equal(await compileFacts(todayCx(ctx, paths)), "compiled");
    // prompt 里应带「当前可信 Facts」（旧内容）
    assert.match(ctx.calls[0].prompt, /当前可信 Facts/);
    assert.match(ctx.calls[0].prompt, /用户是开发者/);
  } finally {
    cleanup(paths);
  }
});

test("assemble：四段拼 memory.md（空段占位 + 中英文标题）", async () => {
  const paths = tempPaths();
  try {
    const fs = await import("../../lib/soul/compiled-snapshot.js");
    fs.writeMemorySectionBody(paths, "facts", "- 事实一");
    fs.writeMemorySectionBody(paths, "today", "今天聊了记忆系统");
    const cx = todayCx(mockCtx(), paths);
    assemble(cx);
    const md = readFileSync(paths.memoryMd, "utf8");
    assert.match(md, /## 重要事实/);
    assert.match(md, /- 事实一/);
    assert.match(md, /## 今天/);
    assert.match(md, /今天聊了记忆系统/);
    assert.match(md, /## 本周早些时候/);
    assert.match(md, /（暂无）/);
    assert.match(md, /## 长期情况/);
  } finally {
    cleanup(paths);
  }
});

test("分层编译依赖顺序：今日→周→长期→事实→组装（一次完整链）", async () => {
  const paths = tempPaths();
  try {
    const summaryToday = [
      "### 重要事实",
      "- 用户是独立开发者",
      "",
      "### 事情经过",
      "- 2026-06-11 10:00 聊了记忆系统",
    ].join("\n");
    const summaryYest = [
      "### 重要事实",
      "- 用户喜欢四川话",
      "",
      "### 事情经过",
      "- 2026-06-10 10:00 装了环境",
    ].join("\n");
    seedSummary(paths, "today-s", summaryToday, "2026-06-11T05:00:00.000Z");
    seedSummary(paths, "yest-s", summaryYest, "2026-06-10T05:00:00.000Z");

    const ctx = mockCtx([
      "今天用户聊了记忆系统",       // compileToday
      "本周用户关注记忆系统开发",   // compileWeek
      "用户是独立开发者，喜欢四川话", // compileLongterm
      "- 用户是独立开发者\n- 用户喜欢四川话", // compileFacts
    ]);
    const cx = todayCx(ctx, paths);
    assert.equal(await compileToday(cx), "compiled");
    assert.equal(await compileWeek(cx), "compiled");
    assert.equal(await compileLongterm(cx), "compiled");
    assert.equal(await compileFacts(cx), "compiled");
    assemble(cx);

    assert.equal(ctx.calls.length, 4);
    const md = readFileSync(paths.memoryMd, "utf8");
    assert.match(md, /## 重要事实/);
    assert.match(md, /## 今天/);
    assert.match(md, /## 本周早些时候/);
    assert.match(md, /## 长期情况/);
    // 四个 .md 都在
    for (const file of ["facts.md", "today.md", "week.md", "longterm.md"]) {
      assert.ok(existsSync(join(paths.memoryDir, file)), `${file} 应存在`);
    }
  } finally {
    cleanup(paths);
  }
});

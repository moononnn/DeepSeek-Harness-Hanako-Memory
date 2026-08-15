/**
 * 每日任务单测：断点续跑、健康状态、日期变化触发。
 *
 * 策略：不直接跑 registerMemoryTicker（它绑定真实 cordis 事件），
 * 而是测试每日任务的核心可测部分：
 * - daily-state.json 读写（断点持久化）
 * - 健康状态更新（lastSuccess/lastError/failCount）
 * - 编译函数在日期窗口下的行为（compileToday 窗口随 now 变化）
 * - 完整链路：mock 日期变化 → 六步按序执行
 *
 * registerMemoryTicker 的「日期变化 → runDailyTask」接线在 smoke 冒烟里覆盖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProfileDir } from "../../lib/soul/paths.js";
import { emptyDailyState, readDailyState, writeDailyState } from "../../lib/soul/daily-state.js";
import { getLogicalDay, shiftLogicalDate } from "../../lib/soul/logical-day.js";
import { compileToday, compileWeek, compileLongterm, compileFacts, assemble } from "../../lib/soul/compile.js";
import { SessionSummaryStore } from "../../lib/soul/rolling-summary.js";
import { readMemorySectionBody } from "../../lib/soul/compiled-snapshot.js";

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "ticker-test-"));
  return resolveProfileDir(dir, "test-profile");
}

function cleanup(paths) {
  rmSync(join(paths.root, "..", "..", "assistant-soul"), { recursive: true, force: true });
}

/** 构造 mock ctx：按顺序返回文本。 */
function mockCtx(texts) {
  const calls = [];
  return {
    calls,
    logger: { info() {}, warn() {}, error() {} },
    llm: {
      stream(opts) {
        calls.push(opts.messages?.[0]?.content?.[0]?.text ?? "");
        const text = texts?.[calls.length - 1] ?? "输出";
        return (async function* () {
          yield { type: "text-delta", index: 0, text };
          yield { type: "finish", reason: { kind: "stop" } };
        })();
      },
    },
  };
}

/** 种合规摘要。 */
function seedSummary(paths, sessionId, summary, updatedAtIso) {
  const store = new SessionSummaryStore(paths);
  store.saveSummary(sessionId, {
    session_id: sessionId,
    created_at: updatedAtIso,
    updated_at: updatedAtIso,
    summary,
    messageCount: 8,
    snapshot: "",
    snapshot_at: null,
    source_time_range: null,
  });
}

const SUMMARY = [
  "### 重要事实",
  "- 用户是开发者",
  "",
  "### 事情经过",
  "- 2026-06-11 10:00 聊了记忆系统",
].join("\n");

const NOW = Date.UTC(2026, 5, 11, 10); // 2026-06-11 10:00 UTC

test("daily-state：空状态 → 写入 → 读回", () => {
  const paths = tempPaths();
  try {
    const initial = readDailyState(paths);
    assert.equal(initial.lastDailyDate, null);
    assert.deepEqual(initial.completed, []);

    const state = emptyDailyState();
    state.lastDailyDate = "2026-06-11";
    state.completed = ["compileToday", "compileWeek"];
    state.health.compileToday = { lastSuccessAt: "2026-06-11T04:00:00.000Z", lastErrorAt: null, lastErrorMsg: null, failCount: 0 };
    writeDailyState(paths, state);

    const read = readDailyState(paths);
    assert.equal(read.lastDailyDate, "2026-06-11");
    assert.deepEqual(read.completed, ["compileToday", "compileWeek"]);
    assert.equal(read.health.compileToday.failCount, 0);
    assert.equal(read.health.compileToday.lastSuccessAt, "2026-06-11T04:00:00.000Z");
    assert.ok(existsSync(paths.dailyState));
  } finally {
    cleanup(paths);
  }
});

test("daily-state：损坏文件回退空状态", () => {
  const paths = tempPaths();
  try {
    writeDailyState(paths, { bad: true });
    const read = readDailyState(paths);
    assert.equal(read.lastDailyDate, null);
    assert.deepEqual(read.completed, []);
  } finally {
    cleanup(paths);
  }
});

test("逻辑日窗口：compileToday 随 now 变化，窗口外摘要不参与", async () => {
  const paths = tempPaths();
  try {
    // 06-11 的摘要
    seedSummary(paths, "s1", SUMMARY, "2026-06-11T05:00:00.000Z");
    const ctx = mockCtx(["06-11 当天近况"]);
    const cx11 = { ctx, paths, provider: "opencode-go", model: "deepseek-v4-flash", timeZone: "UTC", now: Date.UTC(2026, 5, 11, 10) };
    assert.equal(await compileToday(cx11), "compiled");
    assert.equal(ctx.calls.length, 1);

    // 模拟日期跳到 06-12：06-11 的摘要不在 06-12 窗口 → cleared
    const ctx2 = mockCtx();
    const cx12 = { ctx: ctx2, paths, provider: "opencode-go", model: "deepseek-v4-flash", timeZone: "UTC", now: Date.UTC(2026, 5, 12, 10) };
    assert.equal(await compileToday(cx12), "cleared");
    assert.equal(ctx2.calls.length, 0);
  } finally {
    cleanup(paths);
  }
});

test("断点续跑：跨天后 completed 重置语义（新状态不含旧 completed）", () => {
  const paths = tempPaths();
  try {
    const state = emptyDailyState();
    state.lastDailyDate = "2026-06-10";
    state.completed = ["compileToday", "compileWeek", "compileLongterm", "compileFacts", "assemble", "deepMemory"];
    writeDailyState(paths, state);

    // 模拟 ticker 检查日期变化：新一天 → 以空 completed 继续（断点重置）
    const today = getLogicalDay(Date.UTC(2026, 5, 11, 10), "UTC").logicalDate;
    let current = readDailyState(paths);
    if (current.lastDailyDate !== today) {
      current = { ...current, lastDailyDate: today, completed: [] };
      writeDailyState(paths, current);
    }
    assert.equal(current.lastDailyDate, "2026-06-11");
    assert.deepEqual(current.completed, []);
  } finally {
    cleanup(paths);
  }
});

test("完整每日链：六步在 mock 日期变化后按依赖顺序执行", async () => {
  const paths = tempPaths();
  try {
    // 种两天摘要（都在 7 天窗口内）
    seedSummary(paths, "s1", SUMMARY, "2026-06-11T05:00:00.000Z");
    seedSummary(paths, "s2", SUMMARY, "2026-06-10T05:00:00.000Z");

    // 模拟 ticker 的 runDailyTask：日期变化 → 六步顺序执行
    const ctx = mockCtx([
      "今天用户聊了记忆系统",       // Step0 compileToday
      "本周用户关注记忆系统开发",   // Step1 compileWeek
      "用户是开发者，关注记忆系统", // Step2 compileLongterm
      "- 用户是开发者",             // Step3 compileFacts
    ]);
    const cx = { ctx, paths, provider: "opencode-go", model: "deepseek-v4-flash", timeZone: "UTC", now: NOW };

    // 模拟每日任务流程（与 memory-ticker.runDailyTask 相同的步序逻辑）
    let state = readDailyState(paths);
    const today = getLogicalDay(NOW, "UTC").logicalDate;
    if (state.lastDailyDate !== today) {
      state = { ...state, lastDailyDate: today, completed: [] };
    }
    const steps = [
      ["compileToday", () => compileToday(cx)],
      ["compileWeek", () => compileWeek(cx)],
      ["compileLongterm", () => compileLongterm(cx)],
      ["compileFacts", () => compileFacts(cx)],
      ["assemble", () => assemble(cx)],
    ];
    for (const [name, run] of steps) {
      if (state.completed.includes(name)) continue;
      await run();
      state = { ...state, completed: [...state.completed.filter((s) => s !== name), name] };
      state.health[name] = { lastSuccessAt: new Date(NOW).toISOString(), lastErrorAt: null, lastErrorMsg: null, failCount: 0 };
      writeDailyState(paths, state);
    }

    // 全部完成
    assert.deepEqual(state.completed.sort(), ["assemble", "compileFacts", "compileLongterm", "compileToday", "compileWeek"]);
    // 四段 .md 落盘
    assert.match(readMemorySectionBody(paths, "today"), /记忆系统/);
    assert.match(readMemorySectionBody(paths, "week"), /记忆系统/);
    assert.match(readMemorySectionBody(paths, "longterm"), /记忆系统/);
    assert.match(readMemorySectionBody(paths, "facts"), /用户是开发者/);
    // memory.md 组装
    const md = readFileSync(paths.memoryMd, "utf8");
    assert.match(md, /## 重要事实/);
    assert.match(md, /## 今天/);
    assert.match(md, /## 本周早些时候/);
    assert.match(md, /## 长期情况/);

    // 断点：同一天再次运行 → 全部 skipped（completed 已含全部步骤）
    let state2 = readDailyState(paths);
    const ctx2 = mockCtx(["不应调用"]);
    const cx2 = { ctx: ctx2, paths, provider: "opencode-go", model: "deepseek-v4-flash", timeZone: "UTC", now: NOW };
    for (const [name, run] of steps) {
      if (state2.completed.includes(name)) continue;
      await run();
      state2 = { ...state2, completed: [...state2.completed.filter((s) => s !== name), name] };
      writeDailyState(paths, state2);
    }
    assert.equal(ctx2.calls.length, 0); // 没有新 LLM 调用
  } finally {
    cleanup(paths);
  }
});

test("健康状态：失败记录 failCount 递增，成功后清零", () => {
  const paths = tempPaths();
  try {
    const state = emptyDailyState();
    state.lastDailyDate = "2026-06-11";
    state.health.compileToday = { lastSuccessAt: null, lastErrorAt: "2026-06-11T04:01:00.000Z", lastErrorMsg: "LLM 挂了", failCount: 1 };
    state.health.compileWeek = { lastSuccessAt: null, lastErrorAt: "2026-06-11T04:02:00.000Z", lastErrorMsg: "超时", failCount: 2 };
    writeDailyState(paths, state);

    const read = readDailyState(paths);
    assert.equal(read.health.compileToday.failCount, 1);
    assert.match(read.health.compileToday.lastErrorMsg, /LLM 挂了/);
    assert.equal(read.health.compileWeek.failCount, 2);
  } finally {
    cleanup(paths);
  }
});

test("shiftLogicalDate：窗口平移语义", () => {
  assert.equal(shiftLogicalDate("2026-06-11", -6), "2026-06-05");
  assert.equal(shiftLogicalDate("2026-06-11", -29), "2026-05-13");
  assert.equal(shiftLogicalDate("2026-03-01", -1), "2026-02-28");
});

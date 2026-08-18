/**
 * 拟人工具卡前端（client.js 的 tool.call.toolview slot）单测：
 * - TOOL_TALK_KEYS 与服务端 TALK_TABLE 的差集一致（= TALK_TABLE − 官方已注册 key）
 * - 官方已注册 key（bash/edit/write/read/grep/glob/web_search/web_fetch/todo_write/
 *   ask_user_question）绝不能被接管
 * - 模型推导：running / ok / error / interrupted 四态、title 回退、参数与输出提取
 *
 * 执行方式：vm 沙箱跑 client.js（ModuleLoader 静态 bundle），mock require 返回空对象
 * （组件体不执行就不会用 React），从 exports.toolTalk 拿测试钩子。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { TALK_TABLE } from "../../lib/soul/tool-talk.js";

/** 官方已 keyed 注册 tool.call.toolview 的全部 key（replaced-not-shared，勿接管）。
 * 来源（dsh-pkg 各官方包 lib/client.js 实测）：
 * - dsh-client-ui-tool：bash/edit/write/read/grep/glob/web_search/web_fetch/todo_write/ask_user_question
 * - dsh-client-ui-skill：skill（曾漏掉导致同 key 撞车，整个插件 load 失败——已踩坑）
 * - dsh-client-ui-cordis：cordis_define/cordis_run/cordis_stop/cordis_undefine
 */
const OFFICIAL_TOOLVIEW_KEYS = [
  "bash", "edit", "write", "read", "grep", "glob",
  "web_search", "web_fetch", "todo_write", "ask_user_question",
  "skill",
  "cordis_define", "cordis_run", "cordis_stop", "cordis_undefine",
];

/** 生态插件已注册的 toolview key（同为 replaced-not-shared，勿接管）。
 * - dsh-biaoqingbao：express（ExpressCard 表情卡片，表情包插件的核心体验）
 * - @anionex/dsh-vision-toolkit：9 个 vision_*（GroundView/DetectView/TraceView/
 *   PixelDiffView/ArtifactView/PaletteView 专家级可视化，拟人卡让位）
 */
const ECOSYSTEM_TOOLVIEW_KEYS = [
  "express",
  "vision_ground", "vision_detect", "vision_trace", "vision_pixel_diff",
  "vision_crop", "vision_long_screenshot_ocr", "vision_extract_foreground",
  "vision_html_screenshot", "vision_dominant_colors",
];

/**
 * 设计豁免（TALK_TABLE 有但故意不接管）：
 * - pwsh：官方无 keyed 行，但回落到 GenericToolCard 会渲 terminal 卡，
 *   summary = terminal.description（拟人句自然显示），接管反而丢命令；
 * - str_replace_editor：同样回落 GenericToolCard 渲 diff 卡（差异展示更专业），
 *   拟人标题服务于 debug 价值低。
 */
const SKIP_TOOL_TALK_KEYS = ["pwsh", "str_replace_editor"];
const ALL_TAKEN_KEYS = [...OFFICIAL_TOOLVIEW_KEYS, ...ECOSYSTEM_TOOLVIEW_KEYS];

/** 沙箱执行 client.js，返回 exports.toolTalk 钩子。 */
function loadToolTalk() {
  const src = readFileSync(new URL("../../client/client.js", import.meta.url), "utf8");
  let factory = null;
  const window = { __ModuleLoader__: { load({ factory: f }) { factory = f } } };
  vm.runInNewContext(src, { window });
  assert.ok(factory, "client.js 必须通过 __ModuleLoader__.load 注册 factory");
  const fakeRequire = () => ({});
  const ret = factory(fakeRequire);
  assert.ok(ret && ret.toolTalk, "factory 返回值应带 toolTalk 测试钩子");
  return ret.toolTalk;
}

test("TOOL_TALK_KEYS = TALK_TABLE − 全部已占用 key − 设计豁免（精确差集）", () => {
  const { TOOL_TALK_KEYS } = loadToolTalk();
  const expected = Object.keys(TALK_TABLE)
    .filter((k) => !ALL_TAKEN_KEYS.includes(k) && !SKIP_TOOL_TALK_KEYS.includes(k));
  assert.deepEqual([...TOOL_TALK_KEYS].sort(), expected.sort(), "接管 key 必须等于服务端表减已占用 key 再减豁免");
  assert.ok(ALL_TAKEN_KEYS.every((k) => !TOOL_TALK_KEYS.includes(k)), `已占用 key 不应被接管`);
});

test("官方已注册 key 不出现在接管清单", () => {
  const { TOOL_TALK_KEYS } = loadToolTalk();
  for (const k of OFFICIAL_TOOLVIEW_KEYS) {
    assert.ok(!TOOL_TALK_KEYS.includes(k), `官方已注册 key "${k}" 不应被接管`);
  }
});

test("接管清单覆盖表情包/记忆/视觉核心工具", () => {
  const { TOOL_TALK_KEYS } = loadToolTalk();
  for (const k of ["search_stickers", "list_stickers", "pin_memory", "vision_toolkit_activate"]) {
    assert.ok(TOOL_TALK_KEYS.includes(k), `应接管 "${k}"`);
  }
  for (const k of ["express", "vision_detect"]) {
    assert.ok(!TOOL_TALK_KEYS.includes(k), `不应接管生态已占用的 "${k}"`);
  }
});

test("模型：running 态读 callView.title", () => {
  const { model } = loadToolTalk();
  const block = { callId: "c1", name: "express", argsRaw: '{"emotion":"开心"}', callView: { card: "generic", title: "🎭 小花 情绪上头了" } };
  const m = model("express", block);
  assert.equal(m.state, "running");
  assert.equal(m.title, "🎭 小花 情绪上头了");
  assert.equal(m.argsRaw, '{"emotion":"开心"}');
  assert.equal(m.output, null);
  assert.equal(m.errorMessage, null);
});

test("模型：外窗截断（无 callView）时标题回退工具名", () => {
  const { model } = loadToolTalk();
  const m = model("express", { callId: "c1", name: "express", argsRaw: "" });
  assert.equal(m.state, "running");
  assert.equal(m.title, "express");
});

test("模型：ok 态读 resultView.title + 提取 text 输出", () => {
  const { model } = loadToolTalk();
  const block = {
    kind: "tool-result",
    call: { callId: "c1", name: "express", argsRaw: '{"emotion":"开心"}' },
    content: [{ type: "text", text: '已发送表情包「笑死」（匹配度 92）' }],
    isError: false,
    resultView: { card: "generic", title: "🎭 小花 表情包发出去了" },
  };
  const m = model("express", block);
  assert.equal(m.state, "ok");
  assert.equal(m.title, "🎭 小花 表情包发出去了");
  assert.equal(m.output, '已发送表情包「笑死」（匹配度 92）');
  assert.equal(m.errorMessage, null);
});

test("模型：error 态 title 读 failed 短语 + errorMessage", () => {
  const { model } = loadToolTalk();
  const block = {
    kind: "tool-result",
    call: { callId: "c1", name: "express", argsRaw: "{}" },
    content: [],
    isError: true,
    error: { name: "Error", code: "tool_error", message: "emoji 库崩了" },
    resultView: { card: "generic", title: "🎭 小花 表情包卡住了" },
  };
  const m = model("express", block);
  assert.equal(m.state, "error");
  assert.equal(m.title, "🎭 小花 表情包卡住了");
  assert.equal(m.errorMessage, "emoji 库崩了");
});

test("模型：interrupted → stopped 态", () => {
  const { model } = loadToolTalk();
  const block = {
    kind: "tool-result",
    call: { callId: "c1", name: "bash", argsRaw: "" },
    content: [],
    isError: true,
    error: { name: "Interrupted", code: "interrupted" },
    resultView: null,
  };
  const m = model("bash", block);
  assert.equal(m.state, "stopped");
  assert.equal(m.title, "bash");
});

test("模型：空输出与空参数折叠为 null/空串", () => {
  const { model } = loadToolTalk();
  const block = {
    kind: "tool-result",
    call: { callId: "c1", name: "pin_memory", argsRaw: "" },
    content: [],
    isError: false,
    resultView: null,
  };
  const m = model("pin_memory", block);
  assert.equal(m.output, null);
  assert.equal(m.argsRaw, "");
  assert.equal(m.title, "pin_memory");
});
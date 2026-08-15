// 预设读写单测：yml 往返、原子写、新建全流程、broken 标记、PUT 更新（§9.1 / §6.2）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import { createAgent, listAgents, buildAgentCordisRows, atomicWrite, readAgent, updateAgent, readSoulRows } from "../lib/presets.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dsh-am-test-"));
}

test("buildAgentCordisRows：插件行列表结构 + profile = 预设 id", () => {
  const rows = buildAgentCordisRows({
    id: "abc-1",
    name: "测试助手",
    userName: "用户",
    yuan: "hanako",
    identity: "# 测试助手\n\n用户的个人助手。",
    persona: "# 人格定义\n\n- 条目",
  });
  assert.ok(Array.isArray(rows));
  assert.equal(rows[0].id, "assistant-soul");
  assert.equal(rows[0].name, "dsh-assistant-manager/soul");
  assert.equal(rows[0].config.profile, "abc-1");
  assert.equal(rows[0].config.yuan, "hanako");
  assert.equal(rows[0].config.memory.enabled, true);
  assert.equal(rows[0].config.experience.enabled, false);
  // memory.model 不再硬编码：留空由 soul 运行时自适应（全局默认模型接管）
  assert.equal(rows[0].config.memory.model, undefined);
});

test("yml 往返：dump → load 结构一致（含多行文本）", () => {
  const rows = buildAgentCordisRows({
    id: "round-trip",
    name: "往返助手",
    userName: "用户",
    yuan: "butter",
    identity: "# 往返助手\n\n多行\n文本：带冒号 : 和引号 \" 的内容",
    persona: "- 条目1\n- 条目2：带中文冒号",
  });
  const opts = { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' };
  const text = yamlDump(rows, opts);
  const loaded = yamlLoad(text);
  assert.ok(Array.isArray(loaded));
  assert.equal(loaded[0].id, "assistant-soul");
  assert.equal(loaded[0].config.profile, "round-trip");
  assert.equal(loaded[0].config.identity, rows[0].config.identity);
  assert.equal(loaded[0].config.persona, rows[0].config.persona);
  assert.deepEqual(loaded[0].config.memory, rows[0].config.memory);
});

test("atomicWrite：写入后内容一致，无临时文件残留", () => {
  const root = tempRoot();
  const file = join(root, "x.yml");
  atomicWrite(file, "a: 1\n");
  assert.equal(readFileSync(file, "utf8"), "a: 1\n");
  const leftovers = readdirSync(root).filter((f) => f.includes(".tmp-"));
  assert.equal(leftovers.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("createAgent 全流程：预设目录 + 头像 + pinned.md + 列表可见", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");

  const agent = createAgent(presetsRoot, soulRoot, { name: "测试助手", yuan: "hanako" });

  // id 合法且名字生成自 slug 兜底
  assert.match(agent.id, /^assistant-\d+$/);
  assert.equal(agent.name, "测试助手");
  assert.equal(agent.yuan, "hanako");

  const dir = join(presetsRoot, agent.id);
  assert.ok(existsSync(join(dir, "agent.cordis.yml")));
  assert.ok(existsSync(join(dir, "preset.yml")));
  assert.ok(existsSync(join(dir, "assets", "avatar.png")), "默认头像应复制进 preset/assets/avatar.png");
  assert.ok(existsSync(join(soulRoot, agent.id, "pinned.md")), "pinned.md 应初始化");

  // agent.cordis.yml 可读回，profile === id（记忆隔离关键）
  const text = readFileSync(join(dir, "agent.cordis.yml"), "utf8");
  const rows = yamlLoad(text);
  assert.equal(rows[0].config.profile, agent.id);
  assert.ok(rows[0].config.identity.includes("测试助手"), "identity 应渲染名字");
  assert.ok(rows[0].config.persona.length > 0, "persona 应渲染");
  // 模板无占位残留
  assert.ok(!text.includes("{{agentName}}"));
  assert.ok(!text.includes("{{userName}}"));

  // 列表可见 + 头像标记
  const list = listAgents(presetsRoot, agent.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].hasAvatar, true);
  assert.equal(list[0].isDefault, true);

  // 第二个助手互不冲突
  const agent2 = createAgent(presetsRoot, soulRoot, { name: "测试助手", yuan: "butter" });
  assert.notEqual(agent2.id, agent.id);
  assert.equal(agent2.yuan, "butter");
  assert.equal(listAgents(presetsRoot, undefined).length, 2);

  rmSync(root, { recursive: true, force: true });
});

test("createAgent：空名字拒绝", () => {
  const root = tempRoot();
  assert.throws(() => createAgent(join(root, "p"), join(root, "s"), { name: "  ", yuan: "hanako" }), /请输入助手名字/);
  assert.throws(() => createAgent(join(root, "p"), join(root, "s"), { name: "", yuan: "hanako" }), /请输入助手名字/);
  rmSync(root, { recursive: true, force: true });
});

test("createAgent：非法元拒绝", () => {
  const root = tempRoot();
  assert.throws(() => createAgent(join(root, "p"), join(root, "s"), { name: "x", yuan: "robot" }), /未知的元/);
  rmSync(root, { recursive: true, force: true });
});

test("listAgents：broken 预设带原因列出（不跳过）", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const dir = join(presetsRoot, "bad-preset");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.cordis.yml"), "not: [valid\n  yaml: {{{", "utf8");
  writeFileSync(join(dir, "preset.yml"), "name: 坏预设\n", "utf8");

  const list = listAgents(presetsRoot, undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "bad-preset");
  assert.ok(list[0].broken, "broken 预设应带原因");
  assert.equal(list[0].name, "坏预设");

  // readAgent 同路径
  const a = readAgent(presetsRoot, "bad-preset", undefined);
  assert.ok(a.broken);

  rmSync(root, { recursive: true, force: true });
});

/* ---------------- PUT 更新（Phase 2） ---------------- */

test("updateAgent：改名字 → config.name + preset.yml.name 同步，插件行列表结构保持", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");
  const agent = createAgent(presetsRoot, soulRoot, { name: "旧名字", yuan: "hanako" });

  const updated = updateAgent(presetsRoot, agent.id, { name: "新名字" });
  assert.equal(updated.name, "新名字");

  // agent.cordis.yml：config.name 更新 + 仍是插件行列表
  const ymlText = readFileSync(join(presetsRoot, agent.id, "agent.cordis.yml"), "utf8");
  const rows = yamlLoad(ymlText);
  assert.ok(Array.isArray(rows));
  assert.equal(rows[0].id, "assistant-soul");
  assert.equal(rows[0].config.name, "新名字");
  // profile 不能动（记忆隔离）
  assert.equal(rows[0].config.profile, agent.id);
  // 其它字段不受影响
  assert.equal(rows[0].config.yuan, "hanako");
  assert.ok(rows[0].config.identity.includes("旧名字"), "identity 文本不随改名自动改（与 Hana 一致）");

  // preset.yml：name 同步
  const meta = yamlLoad(readFileSync(join(presetsRoot, agent.id, "preset.yml"), "utf8"));
  assert.equal(meta.name, "新名字");

  // 列表 API 看到新名字
  const list = listAgents(presetsRoot, undefined);
  assert.equal(list.find((a) => a.id === agent.id).name, "新名字");

  rmSync(root, { recursive: true, force: true });
});

test("updateAgent：改元只换 yuan，不自动替换 identity/persona（与 Hana 一致）", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");
  const agent = createAgent(presetsRoot, soulRoot, { name: "换元助手", yuan: "hanako" });
  const before = readAgent(presetsRoot, agent.id, undefined);

  const updated = updateAgent(presetsRoot, agent.id, { yuan: "butter" });
  assert.equal(updated.yuan, "butter");
  // identity/persona 保持用户编辑过的文本
  assert.equal(updated.identity, before.identity);
  assert.equal(updated.persona, before.persona);

  // 磁盘上同样如此
  const rows = readSoulRows(join(presetsRoot, agent.id));
  assert.equal(rows.config.yuan, "butter");
  assert.equal(rows.config.identity, before.identity);

  // 非法元拒绝
  assert.throws(() => updateAgent(presetsRoot, agent.id, { yuan: "robot" }), /未知的元/);
  // 拒绝后状态未被破坏
  assert.equal(readAgent(presetsRoot, agent.id, undefined).yuan, "butter");

  rmSync(root, { recursive: true, force: true });
});

test("updateAgent：identity/persona 原样写入（含多行与特殊字符）", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");
  const agent = createAgent(presetsRoot, soulRoot, { name: "文本助手", yuan: "ming" });

  const identity = "新身份：冷静的分析师。\n擅长：数学、物理。带冒号 : 和引号 \" 和换行\n第三行";
  const persona = "# 人格定义\n\n- 理性优先\n- 用逻辑拆解问题：不要玄学";
  const updated = updateAgent(presetsRoot, agent.id, { identity, persona });
  assert.equal(updated.identity, identity);
  assert.equal(updated.persona, persona);

  // yaml 往返无损（多行文本走块标量）
  const rows = readSoulRows(join(presetsRoot, agent.id));
  assert.equal(rows.config.identity, identity);
  assert.equal(rows.config.persona, persona);

  // 允许清空（用户主动清空文本）
  const cleared = updateAgent(presetsRoot, agent.id, { identity: "" });
  assert.equal(cleared.identity, "");

  rmSync(root, { recursive: true, force: true });
});

test("updateAgent：memory/experience 开关切换 + 保留其它子字段", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");
  const agent = createAgent(presetsRoot, soulRoot, { name: "开关助手", yuan: "hanako" });

  // 默认：记忆开、经验关
  assert.equal(readAgent(presetsRoot, agent.id, undefined).memoryEnabled, true);
  assert.equal(readAgent(presetsRoot, agent.id, undefined).experienceEnabled, false);

  const updated = updateAgent(presetsRoot, agent.id, { memoryEnabled: false, experienceEnabled: true });
  assert.equal(updated.memoryEnabled, false);
  assert.equal(updated.experienceEnabled, true);

  // memory.compileEvery 等子字段不被破坏；model 不再硬编码（自适应，保持 undefined）
  const rows = readSoulRows(join(presetsRoot, agent.id));
  assert.equal(rows.config.memory.enabled, false);
  assert.equal(rows.config.memory.compileEvery, 10);
  assert.equal(rows.config.memory.recentMessages, 20);
  assert.equal(rows.config.memory.model, undefined);
  assert.equal(rows.config.experience.enabled, true);

  // 再开回记忆
  const re = updateAgent(presetsRoot, agent.id, { memoryEnabled: true });
  assert.equal(re.memoryEnabled, true);

  rmSync(root, { recursive: true, force: true });
});

test("updateAgent：拒绝不存在的助手 / 空名字 / 无字段", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");
  const agent = createAgent(presetsRoot, soulRoot, { name: "守卫助手", yuan: "kong" });

  assert.throws(() => updateAgent(presetsRoot, "no-such-id", { name: "x" }), /助手不存在/);
  assert.throws(() => updateAgent(presetsRoot, agent.id, { name: "   " }), /请输入助手名字/);
  assert.throws(() => updateAgent(presetsRoot, agent.id, {}), /没有可更新的字段/);

  // 非法 id（目录穿越）拒绝
  assert.throws(() => updateAgent(presetsRoot, "a/b", { name: "x" }), /非法助手 id/);

  // 状态未破坏
  assert.equal(readAgent(presetsRoot, agent.id, undefined).name, "守卫助手");
  rmSync(root, { recursive: true, force: true });
});

test("updateAgent：broken 预设拒绝更新（避免写得更坏）", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const dir = join(presetsRoot, "bad-yml");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.cordis.yml"), "not: [valid\n  yaml: {{{", "utf8");
  writeFileSync(join(dir, "preset.yml"), "name: 坏预设\n", "utf8");

  assert.throws(() => updateAgent(presetsRoot, "bad-yml", { name: "新名" }), /已损坏/);
  // 文件保持原样
  assert.equal(readFileSync(join(dir, "agent.cordis.yml"), "utf8"), "not: [valid\n  yaml: {{{");

  rmSync(root, { recursive: true, force: true });
});

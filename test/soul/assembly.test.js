/**
 * soul 装配单测（Phase 5）：「我」页面在系统提示词中的注入。
 * mock ctx.systemPrompt 收集注册，验证：
 * - assistant:user section 注册，order -50（harness:identity -100 之后、identity 0 之前）
 * - section.text 是 provider：档案为空返回空串（整段消失，不留空标题）；有档案返回 "# 关于用户\n{档案}"
 * - user_name 变量：user.yaml 的 name 全局优先，无 user.yaml 回落 config.userName（老预设）
 * - user_profile 变量：返回档案文本，未设置返回空串
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../../lib/soul/index.js";

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), "soul-assembly-"));
  mkdirSync(join(home, "assistant-soul"), { recursive: true });
  return home;
}

/** 最小装配配置：关掉记忆/经验，只验证提示词装配。 */
function baseConfig(home) {
  return {
    profile: "p1",
    name: "测试助手",
    userName: "预设用户",
    dshHome: home,
    yuan: "hanako",
    identity: "",
    persona: "",
    memory: { enabled: false, compileEvery: 10, recentMessages: 20, timeZone: "", deepMemory: false },
    experience: { enabled: false },
  };
}

/** mock ctx：只收集 systemPrompt 注册。 */
function mockCtx() {
  const sections = [];
  const variables = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agentDefaultModel: { currentSelection: () => null },
    tools: { register() {} },
    systemPrompt: {
      section(s) { sections.push(s); },
      variable(name, provider) { variables.push({ name, provider }); },
    },
  };
  return { ctx, sections, variables };
}

function findVar(variables, name) {
  return variables.find((v) => v.name === name)?.provider;
}

test("装配：assistant:user section order -50，排在 identity(0) 之前", () => {
  const home = tempHome();
  const { ctx, sections } = mockCtx();
  apply(ctx, baseConfig(home));

  const userSection = sections.find((s) => s.name === "assistant:user");
  const identitySection = sections.find((s) => s.name === "assistant:identity");
  assert.ok(userSection, "assistant:user section 应始终注册（不依赖 user.yaml 存在）");
  assert.equal(userSection.order, -50);
  assert.ok(identitySection);
  assert.ok(userSection.order < identitySection.order, "user(-50) 应在 identity(0) 之前");
  assert.equal(typeof userSection.text, "function", "text 是 provider：空档案返回空串，整段消失");
});

test("装配：无 user.yaml（老预设）→ user_profile 空串、user_name 回落 config.userName", () => {
  const home = tempHome();
  const { ctx, variables } = mockCtx();
  apply(ctx, baseConfig(home));

  const userText = () => { const s = mockCtx().sections; return null; }; // placeholder（实际取 sections）
  const sections = [];
  const { ctx: c2, sections: s2 } = mockCtx();
  apply(c2, baseConfig(home));
  void sections;

  const userSection = s2.find((s) => s.name === "assistant:user");
  assert.equal(userSection.text(), "", "档案为空 → section 整段消失（text 返回空串）");

  assert.equal(findVar(variables, "user_profile")(), "", "user_profile 未设置返回空串");
  assert.equal(findVar(variables, "user_name")(), "预设用户", "user.yaml 无 name → 回落 config.userName");
  assert.equal(findVar(variables, "assistant_name")(), "测试助手");
});

test("装配：有 user.yaml → 档案注入「# 关于用户」且 user_name 全局优先", () => {
  const home = tempHome();
  const profile = "我是一个内心敏感的人\n叫我本名会很高兴";
  writeFileSync(join(home, "assistant-soul", "user.yaml"), `name: 用户甲\nprofile: |-\n  我是一个内心敏感的人\n  叫我本名会很高兴\n`, "utf8");
  const { ctx, variables, sections } = mockCtx();
  apply(ctx, baseConfig(home));

  const userSection = sections.find((s) => s.name === "assistant:user");
  assert.equal(userSection.text(), `# 关于用户\n${profile}`);

  assert.equal(findVar(variables, "user_profile")(), profile);
  assert.equal(findVar(variables, "user_name")(), "用户甲", "user.yaml 的 name 优先于 config.userName");
});

test("装配：user.yaml 名字为空白 → 仍回落 config.userName", () => {
  const home = tempHome();
  writeFileSync(join(home, "assistant-soul", "user.yaml"), "name: '  '\n", "utf8");
  const { ctx, variables } = mockCtx();
  apply(ctx, baseConfig(home));
  assert.equal(findVar(variables, "user_name")(), "预设用户");
});

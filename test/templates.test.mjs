// 模板渲染单测：占位替换、kong 回落（§9.1）
import { test } from "node:test";
import assert from "node:assert/strict";
import { identityTemplate, personaTemplate, yuanConsciousness, renderTemplate } from "../lib/templates.js";

test("renderTemplate：替换 {{agentName}}/{{userName}}", () => {
  const out = renderTemplate("# {{agentName}}\n\n{{userName}}的个人助手。", {
    agentName: "测试助手",
    userName: "用户",
  });
  assert.equal(out, "# 测试助手\n\n用户的个人助手。");
  assert.ok(!out.includes("{{"));
});

test("identityTemplate：hanako/butter/ming 有独立模板", () => {
  for (const yuan of ["hanako", "butter", "ming"]) {
    const t = identityTemplate(yuan);
    assert.ok(t.includes("{{agentName}}"), `${yuan} identity 应含占位`);
    assert.ok(t.includes("{{userName}}"), `${yuan} identity 应含 userName 占位`);
  }
});

test("identityTemplate：kong 回落通用模板", () => {
  const t = identityTemplate("kong");
  assert.equal(t, "# {{agentName}}\n\n{{userName}}的个人助手。\n");
});

test("personaTemplate：hanako 模板含「人格定义」", () => {
  const t = personaTemplate("hanako");
  assert.ok(t.includes("# 人格定义"));
  assert.ok(t.length > 50, "人格模板应有内容");
});

test("personaTemplate：kong 回落通用人格", () => {
  const t = personaTemplate("kong");
  assert.ok(t.includes("# 人格定义"));
  assert.ok(!t.includes("{{"));
});

test("yuanConsciousness：hanako 有 MOOD 块，kong 为空", () => {
  assert.ok(yuanConsciousness("hanako").includes("## MOOD"));
  assert.ok(yuanConsciousness("butter").includes("## PULSE"));
  assert.ok(yuanConsciousness("ming").includes("## 沉思"));
  assert.equal(yuanConsciousness("kong").trim(), "");
});

// id 生成单测：slug 化、冲突加后缀、非法拒绝（§9.1）
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, generateAgentId, isValidPresetId } from "../lib/ids.js";

test("slugify：ASCII 名转小写 slug", () => {
  assert.equal(slugify("Test Assistant"), "test-assistant");
  assert.equal(slugify("Xiaohua"), "xiaohua");
});

test("slugify：中文名得到空串（无拼音库，退化兜底）", () => {
  assert.equal(slugify("测试助手"), "");
  assert.equal(slugify("小花"), "");
});

test("slugify：混合名保留 ASCII 部分", () => {
  assert.equal(slugify("我的 Beta 测试2"), "beta-2");
});

test("generateAgentId：生成合法 id（[a-z0-9][a-z0-9-]*）", () => {
  const id = generateAgentId("Test Assistant", new Set());
  assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(id.startsWith("test-assistant-"));
});

test("generateAgentId：中文名兜底 assistant 前缀", () => {
  const id = generateAgentId("测试助手", new Set());
  assert.match(id, /^assistant-\d+$/);
});

test("generateAgentId：与现有 id 冲突时加后缀避开", () => {
  const first = generateAgentId("demo", new Set());
  const second = generateAgentId("demo", new Set([first]));
  assert.notEqual(first, second);
  assert.match(second, /^demo-\d+$/);
});

test("isValidPresetId：拒绝非法 id", () => {
  assert.equal(isValidPresetId("xiaohua"), true);
  assert.equal(isValidPresetId("a-b-c"), true);
  assert.equal(isValidPresetId(""), false);
  assert.equal(isValidPresetId("A"), false);
  assert.equal(isValidPresetId("a_b"), false);
  assert.equal(isValidPresetId("-ab"), false);
  assert.equal(isValidPresetId(".."), false);
  assert.equal(isValidPresetId("a/b"), false);
});

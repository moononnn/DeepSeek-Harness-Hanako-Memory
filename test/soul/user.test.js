/**
 * soul 运行时侧用户数据单测：全局 user.yaml 只读 + userName 优先级 fallback（Phase 5）。
 * - resolveUserPaths：home 解析与 resolveProfileDir 一致（显式配置优先）
 * - readUserYaml / readUserProfile：缺失/损坏回落空（老预设不炸）
 * - resolveUserName：user.yaml name > config.userName > 「用户」三级优先级
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveUserPaths, resolveProfileDir } from "../../lib/soul/paths.js";
import { readUserYaml, readUserProfile, resolveUserName } from "../../lib/soul/user.js";

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), "soul-user-"));
  mkdirSync(join(home, "assistant-soul"), { recursive: true });
  return home;
}

test("resolveUserPaths：与 resolveProfileDir 同根（显式 dshHome 优先）", () => {
  const home = tempHome();
  const userPaths = resolveUserPaths(home);
  const profilePaths = resolveProfileDir(home, "any");
  assert.equal(userPaths.yaml, join(home, "assistant-soul", "user.yaml"));
  assert.equal(userPaths.avatar, join(home, "assistant-soul", "user-avatar.png"));
  // 与 profile 数据平级：同一 assistant-soul 根下
  assert.equal(userPaths.yaml, join(profilePaths.root, "..", "user.yaml"));
});

test("readUserYaml：缺失回落空；正常解析 name + 多行 profile", () => {
  const home = tempHome();
  const paths = resolveUserPaths(home);
  assert.deepEqual(readUserYaml(paths), { name: "", profile: "" });

  writeFileSync(paths.yaml, "name: 用户甲\nprofile: |-\n  多行档案\n  第二行\n", "utf8");
  const data = readUserYaml(paths);
  assert.equal(data.name, "用户甲");
  assert.equal(data.profile, "多行档案\n第二行");
});

test("readUserYaml：损坏 yaml 回落空（绝不抛错）", () => {
  const home = tempHome();
  const paths = resolveUserPaths(home);
  writeFileSync(paths.yaml, "name: [broken\n", "utf8");
  assert.deepEqual(readUserYaml(paths), { name: "", profile: "" });
});

test("readUserProfile：档案文本；未设置返回空串（段消失机制依据）", () => {
  const home = tempHome();
  const paths = resolveUserPaths(home);
  assert.equal(readUserProfile(paths), "");
  writeFileSync(paths.yaml, "name: 用户\nprofile: |-\n  喜欢喝茶\n", "utf8");
  assert.equal(readUserProfile(paths), "喜欢喝茶");
});

test("resolveUserName：user.yaml name > config.userName > 「用户」三级优先级", () => {
  // 全局 name 优先
  assert.equal(resolveUserName("用户甲", "老预设名"), "用户甲");
  // 全局 name 为空白 → fallback 预设
  assert.equal(resolveUserName("", "预设名"), "预设名");
  assert.equal(resolveUserName("   ", "预设名"), "预设名");
  // fallback 也空 → 「用户」
  assert.equal(resolveUserName("", ""), "用户");
  // 老预设场景：无 user.yaml → readUserYaml 返回空 → resolveUserName("", config.userName)
  const home = tempHome();
  const paths = resolveUserPaths(home);
  const legacy = resolveUserName(readUserYaml(paths).name, "用户");
  assert.equal(legacy, "用户");
});

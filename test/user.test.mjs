// 「我」页面用户数据单测：user.yaml 读/写/缺省值/部分更新 + 头像魔数校验（Phase 5）。
// - readUserYaml：缺失/损坏回落空（老预设不炸）；正常解析 name + 多行 profile
// - writeUserYaml：全量写 + yaml 往返；部分更新只覆盖出现的字段；空串写入合法
// - 头像：userAvatarPath 无文件 undefined；writeUserAvatar 魔数校验（合法 PNG 写、非 PNG 抛错）；removeUserAvatar
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { resolveManagerPaths } from "../lib/paths.js";
import { readUserYaml, writeUserYaml, userAvatarPath, writeUserAvatar, removeUserAvatar } from "../lib/user.js";

function tempPaths() {
  const dshHome = mkdtempSync(join(tmpdir(), "dsh-am-user-"));
  const paths = resolveManagerPaths(dshHome);
  mkdirSync(paths.soulRoot, { recursive: true }); // 手动写测试文件前先建目录
  return { dshHome, paths };
}

/** 合法 PNG 的最小样本：8 字节魔数 + 若干内容字节（魔数校验只看文件头）。 */
function pngSample() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("IHDR-fake-body", "utf8")]);
}

test("readUserYaml：文件不存在回落空（老预设不炸）", () => {
  const { paths } = tempPaths();
  const data = readUserYaml(paths);
  assert.deepEqual(data, { name: "", profile: "" });
});

test("readUserYaml：正常解析 name + 多行 profile", () => {
  const { paths } = tempPaths();
  writeFileSync(paths.userYaml, "name: 用户甲\nprofile: |-\n  我是一个内心敏感的人\n  叫我本名会很高兴\n", "utf8");
  const data = readUserYaml(paths);
  assert.equal(data.name, "用户甲");
  assert.equal(data.profile, "我是一个内心敏感的人\n叫我本名会很高兴");
});

test("readUserYaml：损坏 yaml 回落空（绝不抛错）", () => {
  const { paths } = tempPaths();
  writeFileSync(paths.userYaml, "name: [unclosed\nprofile: :::\n", "utf8");
  assert.deepEqual(readUserYaml(paths), { name: "", profile: "" });
});

test("readUserYaml：非对象结构回落空", () => {
  const { paths } = tempPaths();
  writeFileSync(paths.userYaml, "- 列表\n- 不是对象\n", "utf8");
  assert.deepEqual(readUserYaml(paths), { name: "", profile: "" });
});

test("writeUserYaml：全量写 + yaml 往返（多行 profile 原样保留）", () => {
  const { paths } = tempPaths();
  const written = writeUserYaml(paths, { name: "小花", profile: "喜欢四川话\n会写代码" });
  assert.deepEqual(written, { name: "小花", profile: "喜欢四川话\n会写代码" });

  // 落盘 yaml 可再解析且结构一致
  const loaded = yamlLoad(readFileSync(paths.userYaml, "utf8"));
  assert.equal(loaded.name, "小花");
  assert.equal(loaded.profile, "喜欢四川话\n会写代码");
  // 管理平面读回一致
  assert.deepEqual(readUserYaml(paths), written);
});

test("writeUserYaml：部分更新只覆盖出现的字段", () => {
  const { paths } = tempPaths();
  writeUserYaml(paths, { name: "用户甲", profile: "旧档案" });
  const afterName = writeUserYaml(paths, { name: "新名字" });
  assert.deepEqual(afterName, { name: "新名字", profile: "旧档案" });
  const afterProfile = writeUserYaml(paths, { profile: "新档案" });
  assert.deepEqual(afterProfile, { name: "新名字", profile: "新档案" });
});

test("writeUserYaml：空串写入合法（name 空 = 恢复默认称呼，profile 空 = 清空档案）", () => {
  const { paths } = tempPaths();
  writeUserYaml(paths, { name: "测试", profile: "档案" });
  const cleared = writeUserYaml(paths, { name: "", profile: "" });
  assert.deepEqual(cleared, { name: "", profile: "" });
  assert.deepEqual(readUserYaml(paths), { name: "", profile: "" });
});

test("userAvatarPath：无头像返回 undefined，写后有路径", () => {
  const { paths } = tempPaths();
  assert.equal(userAvatarPath(paths), undefined);
  writeUserAvatar(paths, pngSample());
  assert.ok(userAvatarPath(paths)?.endsWith("user-avatar.png"));
});

test("writeUserAvatar：合法 PNG 写入成功且内容一致", () => {
  const { paths } = tempPaths();
  const data = pngSample();
  const result = writeUserAvatar(paths, data);
  assert.ok(existsSync(paths.userAvatar));
  assert.equal(result.size, data.length);
  assert.deepEqual(readFileSync(paths.userAvatar), data);
});

test("writeUserAvatar：非 PNG 魔数拒绝（防上传非图片内容）", () => {
  const { paths } = tempPaths();
  assert.throws(() => writeUserAvatar(paths, Buffer.from("not-a-png", "utf8")), /不是有效的 PNG/);
  assert.equal(existsSync(paths.userAvatar), false);
});

test("removeUserAvatar：有头像删除返回 removed，无头像幂等", () => {
  const { paths } = tempPaths();
  assert.deepEqual(removeUserAvatar(paths), { removed: false });
  writeUserAvatar(paths, pngSample());
  assert.deepEqual(removeUserAvatar(paths), { removed: true });
  assert.equal(existsSync(paths.userAvatar), false);
  assert.deepEqual(removeUserAvatar(paths), { removed: false });
});

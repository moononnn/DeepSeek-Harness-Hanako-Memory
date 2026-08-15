// Phase 3 单测：头像读写（上传/移除/非法类型拒绝）、删除保护（默认/最后一个/不存在）、
// 排序读写（order 持久化 + reorder 校验）、设为主助手（mock settings 服务）。
// §9.1「删除保护逻辑用例」+ §6.2 头像/排序/设默认四行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import {
  createAgent,
  listAgents,
  readAgent,
  writeAvatar,
  removeAvatar,
  avatarFilePath,
  isValidImageMagic,
  deleteAgent,
  reorderAgents,
} from "../lib/presets.js";
import { setDefaultAgent } from "../lib/defaults.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dsh-am-p3-"));
}

function makeRoots(root) {
  return { presetsRoot: join(root, ".agent-presets"), soulRoot: join(root, "assistant-soul") };
}

// 最小图片字节（只有魔数头 + 填充，够后端魔数校验用）
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpg-body")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from("1234"), Buffer.from("WEBP"), Buffer.from("fake-webp")]);

/* ---------------- 头像读写 ---------------- */

test("头像：上传 png → hasAvatar true、文件落盘、GET 路径可读", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const agent = createAgent(presetsRoot, soulRoot, { name: "头像助手", yuan: "hanako" });

  // 新建即带 yuan 默认头像副本（avatar.png）
  assert.equal(agent.hasAvatar, true);
  assert.equal(avatarFilePath(presetsRoot, agent.id), join(presetsRoot, agent.id, "assets", "avatar.png"));

  // 上传自定义 png
  const { file } = writeAvatar(presetsRoot, agent.id, PNG, "png");
  assert.equal(file, join(presetsRoot, agent.id, "assets", "avatar.png"));
  assert.deepEqual(readFileSync(file), PNG);
  assert.equal(readAgent(presetsRoot, agent.id, undefined).hasAvatar, true);
  assert.deepEqual(readFileSync(avatarFilePath(presetsRoot, agent.id)), PNG);

  rmSync(root, { recursive: true, force: true });
});

test("头像：jpg/webp 上传 + 换格式时旧头像被清（不并存）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const agent = createAgent(presetsRoot, soulRoot, { name: "换格式", yuan: "butter" });

  writeAvatar(presetsRoot, agent.id, JPG, "jpg");
  assert.equal(existsSync(join(presetsRoot, agent.id, "assets", "avatar.jpg")), true);
  assert.equal(existsSync(join(presetsRoot, agent.id, "assets", "avatar.png")), false, "png 旧头像应被清掉");

  writeAvatar(presetsRoot, agent.id, WEBP, "webp");
  assert.equal(existsSync(join(presetsRoot, agent.id, "assets", "avatar.webp")), true);
  const leftovers = readdirSync(join(presetsRoot, agent.id, "assets")).filter((f) => f.startsWith("avatar."));
  assert.deepEqual(leftovers, ["avatar.webp"], "同一时刻只保留一个头像文件");

  rmSync(root, { recursive: true, force: true });
});

test("头像：非法扩展名拒绝 / 非法魔数拒绝 / 不存在助手拒绝", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const agent = createAgent(presetsRoot, soulRoot, { name: "校验", yuan: "ming" });

  assert.throws(() => writeAvatar(presetsRoot, agent.id, PNG, "gif"), /不支持的图片格式/);
  // 扩展名 png 但内容不是 png → 魔数拒绝
  assert.throws(() => writeAvatar(presetsRoot, agent.id, Buffer.from("not-an-image"), "png"), /不是有效的图片/);
  assert.throws(() => writeAvatar(presetsRoot, "no-such-id", PNG, "png"), /助手不存在/);
  // 目录穿越 id 拒绝
  assert.throws(() => writeAvatar(presetsRoot, "a/b", PNG, "png"), /非法助手 id/);
  // 拒绝后原头像不受影响
  assert.equal(readAgent(presetsRoot, agent.id, undefined).hasAvatar, true);

  // 魔数校验函数本身
  assert.equal(isValidImageMagic(PNG, "png"), true);
  assert.equal(isValidImageMagic(JPG, "jpg"), true);
  assert.equal(isValidImageMagic(JPG, "jpeg"), true);
  assert.equal(isValidImageMagic(WEBP, "webp"), true);
  assert.equal(isValidImageMagic(PNG, "jpg"), false);
  assert.equal(isValidImageMagic(Buffer.from("xx"), "png"), false);

  rmSync(root, { recursive: true, force: true });
});

test("头像：移除 → hasAvatar false、文件删除（恢复 yuan 默认兜底）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const agent = createAgent(presetsRoot, soulRoot, { name: "移除头像", yuan: "kong" });

  writeAvatar(presetsRoot, agent.id, WEBP, "webp");
  assert.equal(readAgent(presetsRoot, agent.id, undefined).hasAvatar, true);

  const { removed } = removeAvatar(presetsRoot, agent.id);
  assert.equal(removed, true);
  assert.equal(existsSync(join(presetsRoot, agent.id, "assets", "avatar.webp")), false);
  assert.equal(readAgent(presetsRoot, agent.id, undefined).hasAvatar, false);
  assert.equal(avatarFilePath(presetsRoot, agent.id), undefined);

  // 再移除一次：没有文件可删
  assert.equal(removeAvatar(presetsRoot, agent.id).removed, false);

  rmSync(root, { recursive: true, force: true });
});

/* ---------------- 删除保护 ---------------- */

test("删除：默认助手拒绝删除（先设其他为主助手）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "助手甲", yuan: "hanako" });
  createAgent(presetsRoot, soulRoot, { name: "助手乙", yuan: "butter" });

  assert.throws(() => deleteAgent(presetsRoot, soulRoot, a.id, a.id), /默认助手不能删除/);
  // 列表完好
  assert.equal(listAgents(presetsRoot, a.id).length, 2);

  rmSync(root, { recursive: true, force: true });
});

test("删除：最后一个助手拒绝删除（至少保留一个助手）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "唯一助手", yuan: "hanako" });

  assert.throws(() => deleteAgent(presetsRoot, soulRoot, a.id, undefined), /至少保留一个助手/);
  assert.equal(listAgents(presetsRoot, undefined).length, 1);

  rmSync(root, { recursive: true, force: true });
});

test("删除：不存在的 id 拒绝 / 非法 id（目录穿越）拒绝", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  createAgent(presetsRoot, soulRoot, { name: "存在", yuan: "hanako" });
  createAgent(presetsRoot, soulRoot, { name: "存在二", yuan: "ming" });

  assert.throws(() => deleteAgent(presetsRoot, soulRoot, "no-such-id", undefined), /助手不存在/);
  assert.throws(() => deleteAgent(presetsRoot, soulRoot, "a/b", undefined), /非法助手 id/);
  assert.throws(() => deleteAgent(presetsRoot, soulRoot, "..", undefined), /非法助手 id/);

  rmSync(root, { recursive: true, force: true });
});

test("删除：成功 → 预设目录 + soul 数据目录消失、列表立即可见、默认助手不受影响", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "要删的", yuan: "hanako" });
  const b = createAgent(presetsRoot, soulRoot, { name: "保留的", yuan: "butter" });

  // 给 a 制造一点数据：头像 + soul 目录里的 pinned.md + memory 目录
  writeAvatar(presetsRoot, a.id, PNG, "png");
  mkdirSync(join(soulRoot, a.id, "memory"), { recursive: true });
  writeFileSync(join(soulRoot, a.id, "memory", "today.md"), "今天", "utf8");

  const result = deleteAgent(presetsRoot, soulRoot, a.id, b.id);
  assert.deepEqual(result, { deleted: a.id });
  assert.equal(existsSync(join(presetsRoot, a.id)), false, "预设目录应删除");
  assert.equal(existsSync(join(soulRoot, a.id)), false, "soul 数据目录应删除");
  const ids = listAgents(presetsRoot, b.id).map((x) => x.id);
  assert.deepEqual(ids, [b.id], "列表立即可见消失");

  rmSync(root, { recursive: true, force: true });
});

/* ---------------- 排序读写 ---------------- */

test("排序：新建按 order 递增追加到末尾", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "第一个", yuan: "hanako" });
  const b = createAgent(presetsRoot, soulRoot, { name: "第二个", yuan: "butter" });
  const c = createAgent(presetsRoot, soulRoot, { name: "第三个", yuan: "ming" });

  assert.equal(a.order, 0);
  assert.equal(b.order, 1);
  assert.equal(c.order, 2);
  assert.deepEqual(listAgents(presetsRoot, undefined).map((x) => x.id), [a.id, b.id, c.id]);

  // order 持久化在 preset.yml（dsh 官方支持的元数据字段）
  const meta = yamlLoad(readFileSync(join(presetsRoot, c.id, "preset.yml"), "utf8"));
  assert.equal(meta.order, 2);

  rmSync(root, { recursive: true, force: true });
});

test("排序：reorderAgents 反转顺序 + order 重写为 0..n-1", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "甲", yuan: "hanako" });
  const b = createAgent(presetsRoot, soulRoot, { name: "乙", yuan: "butter" });
  const c = createAgent(presetsRoot, soulRoot, { name: "丙", yuan: "ming" });

  const reversed = reorderAgents(presetsRoot, [c.id, a.id, b.id]);
  assert.deepEqual(reversed.map((x) => x.id), [c.id, a.id, b.id]);

  // order 已重写并持久化
  for (const [id, expectOrder] of [[c.id, 0], [a.id, 1], [b.id, 2]]) {
    const meta = yamlLoad(readFileSync(join(presetsRoot, id, "preset.yml"), "utf8"));
    assert.equal(meta.order, expectOrder, `${id} 的 order 应为 ${expectOrder}`);
  }

  // 再次反转回来
  const back = reorderAgents(presetsRoot, [a.id, b.id, c.id]);
  assert.deepEqual(back.map((x) => x.id), [a.id, b.id, c.id]);

  rmSync(root, { recursive: true, force: true });
});

test("排序：reorder 校验（数量不一致 / 不存在 id / 重复 id / 非法 id）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "甲", yuan: "hanako" });
  const b = createAgent(presetsRoot, soulRoot, { name: "乙", yuan: "butter" });

  assert.throws(() => reorderAgents(presetsRoot, [a.id]), /数量不一致/);
  assert.throws(() => reorderAgents(presetsRoot, [a.id, "ghost"]), /不存在的助手/);
  assert.throws(() => reorderAgents(presetsRoot, [a.id, a.id]), /重复 id/);
  assert.throws(() => reorderAgents(presetsRoot, [a.id, "x/y"]), /非法助手 id/);
  assert.throws(() => reorderAgents(presetsRoot, []), /不能为空/);

  // 拒绝后顺序未被破坏
  assert.deepEqual(listAgents(presetsRoot, undefined).map((x) => x.id), [a.id, b.id]);

  rmSync(root, { recursive: true, force: true });
});

test("排序：无 order 的旧预设排末尾（读回落极大值）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const a = createAgent(presetsRoot, soulRoot, { name: "有顺序", yuan: "hanako" });
  // 手造一个没有 order 的旧预设
  const legacy = "legacy-1";
  mkdirSync(join(presetsRoot, legacy, "assets"), { recursive: true });
  writeFileSync(join(presetsRoot, legacy, "preset.yml"), "name: 旧助手\n", "utf8");
  writeFileSync(
    join(presetsRoot, legacy, "agent.cordis.yml"),
    "- id: assistant-soul\n  name: 'dsh-assistant-soul'\n  config:\n    profile: legacy-1\n    name: 旧助手\n    yuan: hanako\n",
    "utf8",
  );

  const list = listAgents(presetsRoot, undefined);
  assert.equal(list[0].id, a.id, "有 order 的排前面");
  assert.equal(list[1].id, legacy, "无 order 的排后面");
  assert.equal(list[1].order, Number.MAX_SAFE_INTEGER);

  rmSync(root, { recursive: true, force: true });
});

/* ---------------- 设为主助手（mock settings 服务） ---------------- */

test("设默认：写 settings 命名空间 agent-presets.default", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  const agent = createAgent(presetsRoot, soulRoot, { name: "新主助", yuan: "hanako" });

  const calls = [];
  const settings = {
    update(ns, patch) {
      calls.push({ ns, patch });
      return undefined;
    },
  };
  setDefaultAgent(settings, presetsRoot, agent.id);
  assert.deepEqual(calls, [{ ns: "agent-presets", patch: { default: agent.id } }]);

  rmSync(root, { recursive: true, force: true });
});

test("设默认：不存在的 id / 非法 id 拒绝（不写 settings）", () => {
  const root = tempRoot();
  const { presetsRoot, soulRoot } = makeRoots(root);
  createAgent(presetsRoot, soulRoot, { name: "助手", yuan: "hanako" });

  let called = false;
  const settings = {
    update() {
      called = true;
      return undefined;
    },
  };
  assert.throws(() => setDefaultAgent(settings, presetsRoot, "no-such-id"), /助手不存在/);
  assert.throws(() => setDefaultAgent(settings, presetsRoot, "a/b"), /非法助手 id/);
  assert.equal(called, false, "校验失败不应写 settings");

  rmSync(root, { recursive: true, force: true });
});

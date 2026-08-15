// 置顶记忆单测：增删 + 与 dsh-assistant-soul 数据格式兼容（§6.2 / §7 / §9.1）
// 格式约定（照抄 soul 插件 src/memory.ts）：
//   pinned.md          每行一条内容
//   pinned-memory.json { items: [{ id, content }] }，id = sha256(content) 前 10 位 hex
//   读优先 json，缺失/损坏时从 md 逐行重建；写双写。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import {
  addPinnedEntry,
  removePinnedEntry,
  readPinnedEntries,
  pinnedEntryId,
  pinFiles,
} from "../lib/pins.js";
import { createAgent } from "../lib/presets.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dsh-am-pins-"));
}

const soulEntryId = (content) => createHash("sha256").update(content).digest("hex").slice(0, 10);

test("pinnedEntryId：与 soul 的 entryId 算法一致（sha256 前 10 位）", () => {
  for (const text of ["记住用户的生日是 3 月", "用户喜欢喝美式咖啡", "a: b \"c\" 特殊字符"]) {
    assert.equal(pinnedEntryId(text), soulEntryId(text));
  }
});

test("addPinnedEntry：双写 pinned.md（每行一条）+ pinned-memory.json（items 索引）", () => {
  const root = tempRoot();
  const soulRoot = join(root, "assistant-soul");
  const profile = "demo-1";

  const r1 = addPinnedEntry(soulRoot, profile, "第一条置顶");
  assert.equal(r1.added, true);
  const r2 = addPinnedEntry(soulRoot, profile, "第二条置顶");
  assert.equal(r2.added, true);

  // pinned.md：每行一条（strip 掉换行差异）
  const md = readFileSync(join(soulRoot, profile, "pinned.md"), "utf8");
  const mdLines = md.split(/\r?\n/).filter(Boolean);
  assert.deepEqual(mdLines, ["第一条置顶", "第二条置顶"]);

  // 多行内容原样保留（与 soul 一致：content 允许换行，md 视图按行展开）
  const multi = addPinnedEntry(soulRoot, profile, "多行内容\n第二行");
  assert.equal(multi.added, true);
  const mdAfterMulti = readFileSync(join(soulRoot, profile, "pinned.md"), "utf8").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(mdAfterMulti, ["第一条置顶", "第二条置顶", "多行内容", "第二行"]);
  const jsonAfterMulti = JSON.parse(readFileSync(join(soulRoot, profile, "pinned-memory.json"), "utf8"));
  assert.equal(jsonAfterMulti.items[2].content, "多行内容\n第二行");
  // 读回也是原始 content（不是被 md 拆行的）
  assert.equal(readPinnedEntries(soulRoot, profile)[2].content, "多行内容\n第二行");

  // pinned-memory.json：items 带 id/content
  const json = JSON.parse(readFileSync(join(soulRoot, profile, "pinned-memory.json"), "utf8"));
  assert.ok(Array.isArray(json.items));
  assert.equal(json.items.length, 3);
  assert.equal(json.items[0].id, soulEntryId("第一条置顶"));
  assert.equal(json.items[0].content, "第一条置顶");

  // 读回一致
  const entries = readPinnedEntries(soulRoot, profile);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].id, soulEntryId("第二条置顶"));

  // 去重：同内容再添加 → alreadyExists，不重复
  const dup = addPinnedEntry(soulRoot, profile, "第一条置顶");
  assert.equal(dup.added, false);
  assert.equal(dup.alreadyExists, true);
  assert.equal(readPinnedEntries(soulRoot, profile).length, 3);

  rmSync(root, { recursive: true, force: true });
});

test("removePinnedEntry：按 id 删 / 按关键词（包含）删 / 未匹配返回 0", () => {
  const root = tempRoot();
  const soulRoot = join(root, "assistant-soul");
  const profile = "demo-2";
  addPinnedEntry(soulRoot, profile, "用户生日是三月");
  addPinnedEntry(soulRoot, profile, "用户喜欢美式咖啡");

  // 按 id 删
  const target = readPinnedEntries(soulRoot, profile)[0];
  const byId = removePinnedEntry(soulRoot, profile, target.id);
  assert.equal(byId.removed, 1);
  assert.deepEqual(readPinnedEntries(soulRoot, profile).map((e) => e.content), ["用户喜欢美式咖啡"]);

  // 按关键词删（包含匹配）
  const byKeyword = removePinnedEntry(soulRoot, profile, "咖啡");
  assert.equal(byKeyword.removed, 1);
  assert.equal(readPinnedEntries(soulRoot, profile).length, 0);

  // 未匹配
  const miss = removePinnedEntry(soulRoot, profile, "不存在的东西");
  assert.equal(miss.removed, 0);

  // 空内容 / 空关键词拒绝
  assert.throws(() => addPinnedEntry(soulRoot, profile, "   "), /不能为空/);
  assert.throws(() => removePinnedEntry(soulRoot, profile, ""), /id 或关键词/);

  rmSync(root, { recursive: true, force: true });
});

test("兼容：读 soul 手写的 pinned.md + pinned-memory.json（json 优先）", () => {
  const root = tempRoot();
  const soulRoot = join(root, "assistant-soul");
  const profile = "legacy-1";
  const dir = join(soulRoot, profile);
  mkdirSync(dir, { recursive: true });
  // 手写 soul 格式：json 索引与 md 视图内容一致
  writeFileSync(join(dir, "pinned.md"), "老置顶一\n老置顶二\n", "utf8");
  writeFileSync(
    join(dir, "pinned-memory.json"),
    JSON.stringify({ items: [{ id: soulEntryId("老置顶一"), content: "老置顶一" }] }, null, 2),
    "utf8",
  );

  // json 优先：只返回 json 里的一条
  const entries = readPinnedEntries(soulRoot, profile);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].content, "老置顶一");

  // 新增一条后 json 与 md 同步
  addPinnedEntry(soulRoot, profile, "新置顶");
  const after = readPinnedEntries(soulRoot, profile);
  assert.deepEqual(after.map((e) => e.content), ["老置顶一", "新置顶"]);
  const mdAfter = readFileSync(join(dir, "pinned.md"), "utf8").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(mdAfter, ["老置顶一", "新置顶"]);

  rmSync(root, { recursive: true, force: true });
});

test("兼容：pinned-memory.json 损坏时从 pinned.md 重建", () => {
  const root = tempRoot();
  const soulRoot = join(root, "assistant-soul");
  const profile = "legacy-2";
  const dir = join(soulRoot, profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pinned.md"), "只有 md 视图\n两行\n", "utf8");
  writeFileSync(join(dir, "pinned-memory.json"), "{ 这不是合法 json", "utf8");

  const entries = readPinnedEntries(soulRoot, profile);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].content, "只有 md 视图");
  assert.equal(entries[0].id, soulEntryId("只有 md 视图"));

  rmSync(root, { recursive: true, force: true });
});

test("createAgent 初始化后：置顶记忆为空列表，pin 文件路径正确", () => {
  const root = tempRoot();
  const presetsRoot = join(root, ".agent-presets");
  const soulRoot = join(root, "assistant-soul");
  const agent = createAgent(presetsRoot, soulRoot, { name: "测试助手", yuan: "hanako" });

  const files = pinFiles(soulRoot, agent.id);
  assert.equal(files.md, join(soulRoot, agent.id, "pinned.md"));
  assert.equal(files.json, join(soulRoot, agent.id, "pinned-memory.json"));
  assert.ok(existsSync(files.md), "pinned.md 应初始化");
  assert.deepEqual(readPinnedEntries(soulRoot, agent.id), []);

  // 与 preset 的 yml 结构无冲突（agent.cordis.yml 仍是插件行列表）
  const yml = yamlLoad(readFileSync(join(presetsRoot, agent.id, "agent.cordis.yml"), "utf8"));
  assert.ok(Array.isArray(yml));
  assert.equal(yml[0].id, "assistant-soul");

  rmSync(root, { recursive: true, force: true });
});

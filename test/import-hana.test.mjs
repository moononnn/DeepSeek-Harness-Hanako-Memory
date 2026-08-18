// 从 Hana 转移（import-hana.js）单测：扫描/匹配/更新/新建/记忆/经验/头像/开关（本地定制 v0.9.0）
// 数据全部为测试内合成（不依赖本机 ~/.hanako/agents），CI 可复现。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { resolveManagerPaths } from "../lib/paths.js";
import { listHanaSources, statHanaSource, matchTarget, importFromHana, rebuildExperienceIndex, defaultHanaAgentsRoot } from "../lib/import-hana.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dsh-am-import-"));
}

/** 1x1 透明 PNG（最小合法头像素材）。 */
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** 合成一个 Hana 助手目录（AGENTS.md / config.yaml / memory 五件套 / 经验 / 头像 / 置顶）。 */
function buildFakeHanaAgent(root, opts) {
  const id = opts.id;
  const name = opts.name;
  const yuan = opts.yuan;
  const expFiles = opts.expFiles ?? 3;
  const pins = opts.pins ?? 2;
  const dir = join(root, id);
  mkdirSync(join(dir, "memory"), { recursive: true });
  mkdirSync(join(dir, "experience"), { recursive: true });
  mkdirSync(join(dir, "avatars"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), `# 人格定义\n\n- ${name} 的测试意识全文\n`, "utf8");
  writeFileSync(join(dir, "config.yaml"), `# HanaAgent 系统配置\nagent:\n  name: ${name}\n  yuan: ${yuan}\n`, "utf8");
  for (const f of ["facts.md", "today.md", "week.md", "longterm.md", "memory.md"]) {
    writeFileSync(join(dir, "memory", f), `- ${f} 内容\n`, "utf8");
  }
  const items = [];
  for (let i = 0; i < pins; i++) {
    items.push({ id: `pin_${id}_${i}`, content: `置顶记忆 ${i + 1}`, createdAt: "2026-08-16T00:00:00.000Z" });
  }
  writeFileSync(join(dir, "pinned-memory.json"), JSON.stringify({ version: 1, items }, null, 2), "utf8");
  writeFileSync(join(dir, "pinned.md"), items.map((it) => `- ${it.content}`).join("\n") + "\n", "utf8");
  for (let i = 0; i < expFiles; i++) {
    const cat = `分类${i + 1}`;
    writeFileSync(join(dir, "experience", `分类${i + 1}-abc${i}.md`),
      `<!-- experience-title: ${Buffer.from(cat, "utf8").toString("base64url")} -->\n1. ${cat} 的第一条经验\n2. ${cat} 的第二条经验\n`, "utf8");
  }
  writeFileSync(join(dir, "avatars", "agent.png"), PNG_1PX);
  return dir;
}

/** 模拟 dsh 已有 preset（xiaohua，与真实格式一致）。 */
function seedXiaohua(presetsRoot, soulRoot) {
  const dir = join(presetsRoot, "xiaohua");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.cordis.yml"), `- id: assistant-soul
  name: dsh-assistant-manager/soul
  config:
    profile: xiaohua
    name: 小花
    userName: 用户
    yuan: hanako
    identity: |
      旧身份内容
    persona: |
      旧人格：理性克制，话不多
    memory:
      enabled: true
      compileEvery: 10
      recentMessages: 20
    experience:
      enabled: true
`);
  writeFileSync(join(dir, "preset.yml"), "name: 小花\ndescription: 温柔理性的个人助手\norder: 1\n");
  mkdirSync(join(soulRoot, "xiaohua", "memory"), { recursive: true });
  writeFileSync(join(soulRoot, "xiaohua", "pinned.md"), "旧的置顶\n");
}

test("listHanaSources：扫描含 AGENTS.md 的助手", () => {
  const root = tempRoot();
  try {
    buildFakeHanaAgent(root, { id: "hanako", name: "小花", yuan: "hanako", expFiles: 12, pins: 3 });
    buildFakeHanaAgent(root, { id: "butter", name: "阿布", yuan: "butter", expFiles: 5, pins: 1 });
    mkdirSync(join(root, "no-agents"), { recursive: true }); // 无 AGENTS.md 不算
    writeFileSync(join(root, "no-agents", "config.yaml"), "agent:\n  name: 无关\n");
    const sources = listHanaSources(root);
    const ids = sources.map((s) => s.id);
    assert.ok(ids.includes("hanako") && ids.includes("butter"), `应有 hanako/butter：${ids}`);
    assert.ok(!ids.includes("no-agents"), "无 AGENTS.md 的目录不算助手");
    const hanako = sources.find((s) => s.id === "hanako");
    assert.equal(hanako.name, "小花");
    assert.equal(hanako.yuan, "hanako");
    assert.equal(hanako.hasAvatar, true);
    const stat = statHanaSource(root, "hanako");
    assert.deepEqual(stat.memory.files, ["facts.md", "today.md", "week.md", "longterm.md", "memory.md"]);
    assert.equal(stat.memory.pins, 3);
    assert.equal(stat.expFiles, 12);
    assert.equal(stat.expEntries, 24, "每分类 2 条");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("matchTarget：id 相同 / name 相同 → update；无匹配 → create", () => {
  const root = tempRoot();
  try {
    const paths = resolveManagerPaths(join(root, "dsh-home"));
    mkdirSync(join(paths.presetsRoot, "xiaohua"), { recursive: true });
    writeFileSync(join(paths.presetsRoot, "xiaohua", "agent.cordis.yml"), `- id: assistant-soul
  name: dsh-assistant-manager/soul
  config:
    profile: xiaohua
    name: 小花
    yuan: hanako
    identity: x
    persona: y
    memory: { enabled: true }
    experience: { enabled: false }
`);
    assert.equal(matchTarget(paths.presetsRoot, { id: "xiaohua", name: "任意" }).mode, "update");
    assert.equal(matchTarget(paths.presetsRoot, { id: "hanako", name: "小花" }).mode, "update");
    const created = matchTarget(paths.presetsRoot, { id: "butter", name: "阿布" });
    assert.equal(created.mode, "create");
    assert.equal(created.id, "butter");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importFromHana：update 场景（意识全文 / persona 保留 / 记忆经验头像 / 开关）", () => {
  const root = tempRoot();
  try {
    const agentsRoot = join(root, "agents");
    buildFakeHanaAgent(agentsRoot, { id: "hanako", name: "小花", yuan: "hanako", expFiles: 12, pins: 3 });
    const paths = resolveManagerPaths(join(root, "dsh-home"));
    seedXiaohua(paths.presetsRoot, paths.soulRoot);
    const agentsMd = readFileSync(join(agentsRoot, "hanako", "AGENTS.md"), "utf8").replace(/^\uFEFF/, "");

    const result = importFromHana(paths, agentsRoot, { id: "hanako", name: "小花", yuan: "hanako" }, true, true, undefined);
    assert.equal(result.target.mode, "update");
    assert.equal(result.target.id, "xiaohua");
    assert.equal(result.identityBytes, Buffer.byteLength(agentsMd, "utf8"));
    assert.equal(result.avatar, "png");
    assert.equal(result.memory.files.length, 5);
    assert.equal(result.memory.pins, 3);
    assert.equal(result.experience.files, 12);
    assert.equal(result.experience.entries, 24);

    const cordis = readFileSync(join(paths.presetsRoot, "xiaohua", "agent.cordis.yml"), "utf8");
    const rows = yamlLoad(cordis);
    assert.equal(rows[0].config.identity, agentsMd, "identity = AGENTS.md 全文");
    assert.equal(rows[0].config.persona.trim(), "旧人格：理性克制，话不多", "persona 保留");
    assert.equal(rows[0].config.name, "小花");
    assert.equal(rows[0].config.yuan, "hanako");
    assert.equal(rows[0].config.memory.enabled, true);
    assert.equal(rows[0].config.experience.enabled, true);

    // 记忆 + 置顶 + 经验索引
    const soul = join(paths.soulRoot, "xiaohua");
    for (const f of ["facts.md", "longterm.md", "today.md", "week.md"]) {
      assert.ok(existsSync(join(soul, "memory", f)), `memory/${f}`);
    }
    const pinned = JSON.parse(readFileSync(join(soul, "pinned-memory.json"), "utf8"));
    assert.ok(pinned.items.length === 3 && /^[0-9a-f]{10}$/.test(pinned.items[0].id), "pinned 转 dsh 格式");
    assert.ok(existsSync(join(soul, "experience", "experience.md")), "经验索引重建");
    const avatars = readdirSync(join(paths.presetsRoot, "xiaohua", "assets"));
    assert.ok(avatars.some((f) => f.startsWith("avatar.")), "头像写入");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importFromHana：create 场景（指定 id 新建 / yuan 跟随源 / 开关随勾选）", () => {
  const root = tempRoot();
  try {
    const agentsRoot = join(root, "agents");
    buildFakeHanaAgent(agentsRoot, { id: "butter", name: "阿布", yuan: "butter", expFiles: 5, pins: 1 });
    const paths = resolveManagerPaths(join(root, "dsh-home"));
    seedXiaohua(paths.presetsRoot, paths.soulRoot);

    const result = importFromHana(paths, agentsRoot, { id: "butter", name: "阿布", yuan: "butter" }, true, false, undefined);
    assert.equal(result.target.mode, "create");
    assert.equal(result.target.id, "butter");
    assert.equal(result.avatar, "png");
    assert.equal(result.memory.files.length, 5);
    assert.equal(result.memory.pins, 1);
    assert.equal(result.experience, null, "不勾经验不写");

    const cordis = readFileSync(join(paths.presetsRoot, "butter", "agent.cordis.yml"), "utf8");
    const rows = yamlLoad(cordis);
    assert.equal(rows[0].config.profile, "butter");
    assert.equal(rows[0].config.name, "阿布");
    assert.equal(rows[0].config.yuan, "butter");
    assert.equal(rows[0].config.memory.enabled, true);
    assert.equal(rows[0].config.experience.enabled, false, "不勾经验 → 开关关");
    const preset = readFileSync(join(paths.presetsRoot, "butter", "preset.yml"), "utf8");
    assert.match(preset, /order: \d+/);
    assert.ok(existsSync(join(paths.soulRoot, "butter")), "soul 数据目录已建");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importFromHana：不勾记忆/经验 → update 场景保留目标现有开关", () => {
  const root = tempRoot();
  try {
    const agentsRoot = join(root, "agents");
    buildFakeHanaAgent(agentsRoot, { id: "hanako", name: "小花", yuan: "hanako" });
    const paths = resolveManagerPaths(join(root, "dsh-home"));
    seedXiaohua(paths.presetsRoot, paths.soulRoot);

    const result = importFromHana(paths, agentsRoot, { id: "hanako", name: "小花", yuan: "hanako" }, false, false, undefined);
    assert.equal(result.memory, null);
    assert.equal(result.experience, null);
    const cordis = readFileSync(join(paths.presetsRoot, "xiaohua", "agent.cordis.yml"), "utf8");
    const rows = yamlLoad(cordis);
    assert.equal(rows[0].config.memory.enabled, true, "保留现有 true");
    assert.equal(rows[0].config.experience.enabled, true, "保留现有 true");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rebuildExperienceIndex：格式与 dsh-assistant-soul 一致", () => {
  const root = tempRoot();
  try {
    const expDir = join(root, "experience");
    mkdirSync(expDir, { recursive: true });
    const cat = "工具使用";
    writeFileSync(join(expDir, `工具使用-abc123.md`), `<!-- experience-title: ${Buffer.from(cat, "utf8").toString("base64url")} -->\n1. 第一条经验内容\n2. 第二条\n`);
    rebuildExperienceIndex(expDir);
    const index = readFileSync(join(expDir, "experience.md"), "utf8");
    assert.match(index, /^# 工具使用（2 条）$/m);
    assert.match(index, /^第一条经验内容；第二条$/m);
    assert.match(index, /^→ experience\/工具使用-abc123\.md$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("defaultHanaAgentsRoot：本机 ~/.hanako/agents", () => {
  assert.equal(defaultHanaAgentsRoot(), join(homedir(), ".hanako", "agents"));
});

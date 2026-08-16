/**
 * 从 Hana 转移助手（本地定制功能，2026-08-16）。
 *
 * 把本机 Hana 助手（~/.hanako/agents/<id>）的配置搬进 dsh：
 *   意识（AGENTS.md 全文 → identity，必选）+ 头像（有则转）
 *   + 记忆（memory/ 四件套 + memory.md + 置顶） + 经验（experience/*.md + 索引重建）
 *
 * 目标匹配：dsh 侧同名助手（preset name 或 id 相同）→ 更新；否则新建 preset。
 * 复用 presets.js / pins.js 的成熟 API（yaml 读写、原子写、头像、开关），
 * 记忆/经验文件与索引为纯文件操作。
 *
 * 注意：本文件是本地定制（不在 src/ 下，tsc 不会覆盖）；重新 build 前请从备份恢复。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { dump as yamlDump } from "js-yaml";
import {
  atomicWrite,
  buildAgentCordisRows,
  readPresetMeta,
  readSoulConfig,
  updateAgent,
  writeAvatar,
} from "./presets.js";

/** Hana 头像扩展名优先级（与 Hana findAgentAvatar 一致）。 */
const AVATAR_EXTS = ["png", "jpg", "jpeg", "webp"];
/** dsh 侧记忆四件套（+ 组装快照 memory.md）。 */
const MEMORY_FILES = ["facts.md", "today.md", "week.md", "longterm.md", "memory.md"];
/** 经验分类文件标题头（与 dsh-assistant-soul 的 TITLE_PATTERN 一致）。 */
const TITLE_PATTERN = /^<!-- experience-title: ([A-Za-z0-9_-]+) -->/;
/** agent.cordis.yml dump 选项（与 presets.js YAML_DUMP_OPTS 同款）。 */
const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' };

function readFileSafe(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function stripQuotes(v) {
  const s = String(v ?? "").trim();
  if (s.length >= 2 && (s[0] === '"' && s[s.length - 1] === '"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (s.length >= 2 && (s[0] === "'" && s[s.length - 1] === "'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** 读 Hana 侧 config.yaml 的 agent.name / agent.yuan。 */
export function readHanaConfig(srcDir) {
  const text = readFileSafe(join(srcDir, "config.yaml")) || "";
  const nameM = /^\s*name:\s*(.+?)\s*$/m.exec(text);
  const yuanM = /^\s*yuan:\s*(.+?)\s*$/m.exec(text);
  return {
    name: nameM ? stripQuotes(nameM[1]) : "",
    yuan: yuanM ? stripQuotes(yuanM[1]) : "",
  };
}

/** 找源助手头像（png > jpg > jpeg > webp 优先级）。返回 { ext, data } 或 null。 */
export function findSourceAvatar(agentsRoot, sourceId) {
  const avatarsDir = join(agentsRoot, sourceId, "avatars");
  for (const ext of AVATAR_EXTS) {
    const file = join(avatarsDir, `agent.${ext}`);
    try {
      return { ext, data: readFileSync(file) };
    } catch { /* 下一个 */ }
  }
  return null;
}

/** 解析经验条目（数字列表；跳过注释行）。 */
function parseExperienceEntries(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*<!--/.test(line))
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(Boolean);
}

/** 重建经验索引 experience.md（照抄 dsh-assistant-soul rebuildExperienceIndex 格式）。 */
export function rebuildExperienceIndex(expDir) {
  let files = [];
  try {
    files = readdirSync(expDir).filter((f) => f.endsWith(".md") && f !== "experience.md");
  } catch {
    return;
  }
  files.sort();
  const lines = [];
  for (const file of files) {
    const text = readFileSafe(join(expDir, file));
    if (text === null) continue;
    const titleMatch = TITLE_PATTERN.exec(text);
    const category = titleMatch ? Buffer.from(titleMatch[1], "base64url").toString("utf8") : file;
    const entries = parseExperienceEntries(text);
    const preview = entries.map((entry) => entry.slice(0, 20)).join("；");
    lines.push(`# ${category}（${entries.length} 条）`);
    if (preview) lines.push(preview);
    lines.push(`→ experience/${file}`, "");
  }
  if (lines.length > 0) {
    mkdirSync(expDir, { recursive: true });
    atomicWrite(join(expDir, "experience.md"), lines.join("\n"));
  }
}

/** 置顶记忆转换：Hana pinned-memory.json → dsh 格式（id = sha256(content) 前 10 位），双写。 */
function writePinnedFiles(soulRoot, profile, hanaPinnedJson, hanaPinnedMd) {
  let items = [];
  try {
    const raw = JSON.parse(hanaPinnedJson || "");
    if (Array.isArray(raw?.items)) {
      items = raw.items.filter((it) => typeof it?.content === "string" && it.content.trim());
    }
  } catch { /* 回退 md */ }
  if (items.length === 0) {
    items = String(hanaPinnedMd || "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean)
      .map((content) => ({ content }));
  }
  const entries = items.map((it) => ({
    id: createHash("sha256").update(it.content).digest("hex").slice(0, 10),
    content: it.content,
  }));
  const root = join(soulRoot, profile);
  mkdirSync(root, { recursive: true });
  atomicWrite(join(root, "pinned.md"), entries.map((e) => e.content).join("\n") + (entries.length ? "\n" : ""));
  atomicWrite(join(root, "pinned-memory.json"), JSON.stringify({ items: entries }, null, 2) + "\n");
  return entries.length;
}

/** 统计 Hana 侧一个助手的记忆/经验体量（preview 用）。 */
export function statHanaSource(agentsRoot, sourceId) {
  const srcDir = join(agentsRoot, sourceId);
  const memoryDir = join(srcDir, "memory");
  const expDir = join(srcDir, "experience");
  const memoryFiles = [];
  for (const f of MEMORY_FILES) {
    if (existsSync(join(memoryDir, f))) memoryFiles.push(f);
  }
  let pins = 0;
  const pinsJson = readFileSafe(join(srcDir, "pinned-memory.json"));
  if (pinsJson) {
    try {
      const raw = JSON.parse(pinsJson);
      if (Array.isArray(raw?.items)) pins = raw.items.filter((it) => typeof it?.content === "string" && it.content.trim()).length;
    } catch { /* md 兜底 */ }
  }
  if (pins === 0) {
    const md = readFileSafe(join(srcDir, "pinned.md")) || "";
    pins = md.split(/\r?\n/).filter((l) => l.trim()).length;
  }
  let expFiles = 0;
  let expEntries = 0;
  try {
    for (const f of readdirSync(expDir)) {
      if (!f.endsWith(".md") || f === "experience.md") continue;
      expFiles += 1;
      const text = readFileSafe(join(expDir, f));
      if (text) expEntries += parseExperienceEntries(text).length;
    }
  } catch { /* 无经验目录 */ }
  const agentsMd = readFileSafe(join(srcDir, "AGENTS.md")) || "";
  return {
    memory: { files: memoryFiles, pins },
    expFiles,
    expEntries,
    agentsMdBytes: Buffer.byteLength(agentsMd, "utf8"),
  };
}

/** 扫描 Hana 助手：~/.hanako/agents/ 下含 AGENTS.md 的目录。 */
export function listHanaSources(agentsRoot) {
  let entries = [];
  try {
    entries = readdirSync(agentsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const sources = [];
  for (const e of entries) {
    if (!e.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(e.name)) continue;
    if (!existsSync(join(agentsRoot, e.name, "AGENTS.md"))) continue;
    const cfg = readHanaConfig(join(agentsRoot, e.name));
    sources.push({
      id: e.name,
      name: cfg.name || e.name,
      yuan: cfg.yuan || "hanako",
      hasAvatar: Boolean(findSourceAvatar(agentsRoot, e.name)),
    });
  }
  sources.sort((a, b) => (a.id === "hanako" ? -1 : b.id === "hanako" ? 1 : a.name.localeCompare(b.name, "zh")));
  return sources;
}

/** 默认 Hana agents 根（本机 ~/.hanako/agents）。 */
export function defaultHanaAgentsRoot() {
  return join(homedir(), ".hanako", "agents");
}

/** 目标匹配：dsh 侧 preset id 相同 → update；name 相同 → update；否则 create（id = 源 id）。 */
export function matchTarget(presetsRoot, source) {
  let dirs = [];
  try {
    dirs = readdirSync(presetsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(e.name));
  } catch { /* 无 preset 目录 → create */ }
  for (const d of dirs) {
    if (d.name === source.id) return { id: d.name, name: source.name, mode: "update" };
  }
  for (const d of dirs) {
    const { config } = readSoulConfig(join(presetsRoot, d.name));
    if (config && config.name === source.name) return { id: d.name, name: config.name, mode: "update" };
  }
  return { id: source.id, name: source.name, mode: "create" };
}

/** 新建 preset（指定 id）：agent.cordis.yml（buildAgentCordisRows + 开关覆写）+ preset.yml。 */
function createPresetWithId(presetsRoot, soulRoot, source, targetId, agentsMd, includeMemory, includeExperience) {
  const dir = join(presetsRoot, targetId);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const rows = buildAgentCordisRows({
    id: targetId,
    name: source.name,
    userName: "用户",
    yuan: source.yuan,
    identity: agentsMd,
    persona: "",
  });
  rows[0].config.memory.enabled = includeMemory;
  rows[0].config.experience.enabled = includeExperience;
  atomicWrite(join(dir, "agent.cordis.yml"), yamlDump(rows, YAML_DUMP_OPTS));
  // preset.yml：order = 现有最大 + 1
  let max = -1;
  try {
    for (const d of readdirSync(presetsRoot, { withFileTypes: true })) {
      if (!d.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(d.name)) continue;
      const o = readPresetMeta(join(presetsRoot, d.name)).order;
      if (o !== undefined && o > max) max = o;
    }
  } catch { /* 无目录 */ }
  atomicWrite(join(dir, "preset.yml"), yamlDump(
    { name: source.name, description: `从 Hana 转移的助手（${source.id}）`, order: max + 1 },
    YAML_DUMP_OPTS
  ));
  // 初始化记忆数据目录（与 createAgent 一致）
  mkdirSync(join(soulRoot, targetId), { recursive: true });
  return dir;
}

/**
 * 执行单个助手的转移。返回摘要；任何一步失败抛错由调用方捕获记入 error。
 * paths: { presetsRoot, soulRoot }；defaultId 供 updateAgent 校验默认助手。
 */
export function importFromHana(paths, agentsRoot, source, includeMemory, includeExperience, defaultId) {
  const srcDir = join(agentsRoot, source.id);
  const target = matchTarget(paths.presetsRoot, source);
  const soulDir = join(paths.soulRoot, target.id);
  const result = { source: source.id, name: source.name, target, identityBytes: 0, avatar: null, memory: null, experience: null };

  // 1. 意识（必选）：AGENTS.md 全文 → identity；persona 保留目标现有（新建时为空）
  const agentsMd = (readFileSafe(join(srcDir, "AGENTS.md")) || "").replace(/^\uFEFF/, ""); // 去 UTF-8 BOM
  if (target.mode === "update") {
    const patch = { name: source.name, yuan: source.yuan, identity: agentsMd };
    if (includeMemory) patch.memoryEnabled = true;
    if (includeExperience) patch.experienceEnabled = true;
    updateAgent(paths.presetsRoot, target.id, patch, defaultId);
  } else {
    createPresetWithId(paths.presetsRoot, paths.soulRoot, source, target.id, agentsMd, includeMemory, includeExperience);
  }
  result.identityBytes = Buffer.byteLength(agentsMd, "utf8");

  // 2. 头像（有则转，无则保留 dsh 默认）
  const av = findSourceAvatar(agentsRoot, source.id);
  if (av) {
    writeAvatar(paths.presetsRoot, target.id, av.data, av.ext);
    result.avatar = av.ext;
  }

  // 3. 记忆（可选）：四件套 + memory.md + 置顶
  if (includeMemory) {
    const srcMemory = join(srcDir, "memory");
    const dstMemory = join(soulDir, "memory");
    mkdirSync(dstMemory, { recursive: true }); // presets.js 的 atomicWrite 不建目录，先建
    const copied = [];
    for (const f of MEMORY_FILES) {
      const content = readFileSafe(join(srcMemory, f));
      if (content !== null) {
        atomicWrite(join(dstMemory, f), content);
        copied.push(f);
      }
    }
    const pins = writePinnedFiles(paths.soulRoot, target.id, readFileSafe(join(srcDir, "pinned-memory.json")) || "", readFileSafe(join(srcDir, "pinned.md")) || "");
    result.memory = { files: copied, pins };
  }

  // 4. 经验（可选）：复制分类文件 + 重建索引
  if (includeExperience) {
    const srcExp = join(srcDir, "experience");
    const dstExp = join(soulDir, "experience");
    mkdirSync(dstExp, { recursive: true });
    let files = 0;
    let entries = 0;
    try {
      for (const f of readdirSync(srcExp)) {
        if (!f.endsWith(".md") || f === "experience.md") continue;
        const text = readFileSafe(join(srcExp, f));
        if (text === null) continue;
        atomicWrite(join(dstExp, f), text);
        files += 1;
        entries += parseExperienceEntries(text).length;
      }
    } catch { /* 无经验目录：0 个文件，不报错 */ }
    rebuildExperienceIndex(dstExp);
    result.experience = { files, entries };
  }

  return result;
}

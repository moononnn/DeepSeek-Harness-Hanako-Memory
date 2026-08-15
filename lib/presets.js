/**
 * 预设读写服务：扫描 .agent-presets/、读 preset.yml + agent.cordis.yml、
 * 新建助手（生成 id → 写模板预设 + 默认头像 + 初始化 pinned.md）。
 *
 * 纪律（§10）：
 * - agent.cordis.yml 是「插件行列表」结构 [{id, name, config}]，读写必须保持；
 * - 写文件用原子写（临时文件 + rename），写坏会让 preset 变 broken；
 * - 新建预设的 config.profile 必须等于预设 id（记忆数据隔离的关键）；
 * - preset 是「创建时组装、运行中不动」的，改配置只影响此后新建的会话。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad, dump as yamlDump, YAMLException } from "js-yaml";
import { generateAgentId, isValidPresetId } from "./ids.js";
import { identityTemplate, personaTemplate, renderTemplate, YUAN_KEYS, YUAN_META } from "./templates.js";
/** 头像扩展名白名单（参考 Hana findAgentAvatar 的 png > jpg > jpeg > webp 优先级，§4.1）。 */
export const AVATAR_EXTS = ["png", "jpg", "jpeg", "webp"];
/** agent.cordis.yml 中 dsh-assistant-soul 插件行。 */
const SOUL_PLUGIN_ID = "assistant-soul";
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === "string" ? v : "";
}
/* ------------------------------------------------------------------ */
/* 读取                                                                 */
/* ------------------------------------------------------------------ */
/** 解析 agent.cordis.yml，返回 assistant-soul 行的 config（读失败返回 undefined）。 */
export function readSoulConfig(presetPath) {
    const file = join(presetPath, "agent.cordis.yml");
    if (!existsSync(file))
        return { config: undefined, error: "缺少 agent.cordis.yml" };
    let parsed;
    try {
        parsed = yamlLoad(readFileSync(file, "utf8"));
    }
    catch (e) {
        return { config: undefined, error: e instanceof YAMLException ? `YAML 解析失败：${e.reason ?? e.message}` : String(e) };
    }
    if (!Array.isArray(parsed))
        return { config: undefined, error: "agent.cordis.yml 不是插件行列表" };
    for (const row of parsed) {
        if (isPlainObject(row) && row.id === SOUL_PLUGIN_ID && isPlainObject(row.config)) {
            return { config: row.config };
        }
    }
    return { config: undefined, error: "未找到 assistant-soul 插件行" };
}
/**
 * 读取 agent.cordis.yml 的完整插件行列表 + assistant-soul 行索引。
 * 更新（PUT）必须走这里拿整行列表再改写回，保持 `[{id, name, config}]` 结构（§10.5）。
 * 解析失败抛错（调用方拒绝更新，避免把 broken 预设写得更坏）。
 */
export function readSoulRows(presetPath) {
    const file = join(presetPath, "agent.cordis.yml");
    if (!existsSync(file))
        throw new Error("缺少 agent.cordis.yml");
    let parsed;
    try {
        parsed = yamlLoad(readFileSync(file, "utf8"));
    }
    catch (e) {
        throw new Error(e instanceof YAMLException ? `YAML 解析失败：${e.reason ?? e.message}` : String(e));
    }
    if (!Array.isArray(parsed))
        throw new Error("agent.cordis.yml 不是插件行列表");
    for (let index = 0; index < parsed.length; index += 1) {
        const row = parsed[index];
        if (isPlainObject(row) && row.id === SOUL_PLUGIN_ID && isPlainObject(row.config)) {
            return { rows: parsed, index, config: row.config };
        }
    }
    throw new Error("未找到 assistant-soul 插件行");
}
/** 读 preset.yml 展示元信息（缺失/损坏回落空，§「preset.yml 只承载展示文本」）。 */
export function readPresetMeta(presetPath) {
    const file = join(presetPath, "preset.yml");
    try {
        const parsed = yamlLoad(readFileSync(file, "utf8"));
        if (isPlainObject(parsed)) {
            return {
                name: str(parsed.name),
                description: str(parsed.description),
                // order：dsh-agent-presets 官方支持的元数据字段（readPresetMetadata 读 record.order，
                // 必须是有限 number），管理插件用它做助手排序（§6.2「排序」行）。
                order: typeof parsed.order === "number" && Number.isFinite(parsed.order) ? parsed.order : undefined,
            };
        }
    }
    catch {
        /* 回落空 */
    }
    return { name: "", description: "" };
}
/** 扫描 .agent-presets/，返回全部助手汇总（broken 也列出，§10.6），按 order 升序。 */
export function listAgents(presetsRoot, defaultId) {
    if (!existsSync(presetsRoot))
        return [];
    const ids = [];
    for (const entry of readdirSync(presetsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && isValidPresetId(entry.name))
            ids.push(entry.name);
    }
    return ids
        .map((id) => readAgent(presetsRoot, id, defaultId))
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
}
/** 读单个助手汇总。 */
export function readAgent(presetsRoot, id, defaultId) {
    const dir = join(presetsRoot, id);
    const meta = readPresetMeta(dir);
    const { config, error } = readSoulConfig(dir);
    const base = {
        id,
        name: str(config?.name) || meta.name || id,
        description: meta.description,
        yuan: YUAN_KEYS.includes(config?.yuan) ? config?.yuan : "hanako",
        identity: str(config?.identity),
        persona: str(config?.persona),
        memoryEnabled: isPlainObject(config?.memory) ? Boolean(config?.memory?.enabled) : false,
        experienceEnabled: isPlainObject(config?.experience) ? Boolean(config?.experience?.enabled) : false,
        hasAvatar: findAvatarFile(dir) !== undefined,
        isDefault: id === defaultId,
        order: meta.order ?? Number.MAX_SAFE_INTEGER,
    };
    if (error)
        base.broken = error;
    return base;
}
/* ------------------------------------------------------------------ */
/* 写入                                                                 */
/* ------------------------------------------------------------------ */
/** 原子写：先写临时文件再 rename（同一目录内 rename 是原子的，§10.4）。 */
export function atomicWrite(file, content) {
    atomicWriteBuffer(file, Buffer.from(content, "utf8"));
}
/** 原子写（二进制）：图片等非文本内容同样走临时文件 + rename，避免半路写坏。 */
export function atomicWriteBuffer(file, data) {
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, data);
    try {
        renameSync(tmp, file);
    }
    catch (e) {
        // rename 失败时清理临时文件，避免留下半成品
        try {
            rmSync(tmp, { force: true });
        }
        catch {
            /* ignore */
        }
        throw e;
    }
}
/** agent.cordis.yml dump 选项（参考 Hana agent-manager，§6.2）。 */
const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' };
/** 组装新建助手的 agent.cordis.yml（插件行列表，结构照抄 xiaohua，§6.3）。 */
export function buildAgentCordisRows(opts) {
    return [
        {
            id: SOUL_PLUGIN_ID,
            // 单包发布形态：soul 运行时并入 dsh-assistant-manager，插件行按子路径解析
            // （package.json exports "./soul" → lib/soul/index.js，dsh 官方支持 name 子路径）
            name: "dsh-assistant-manager/soul",
            config: {
                profile: opts.id, // = 预设 id，记忆数据隔离的关键（§10.8）
                name: opts.name,
                userName: opts.userName,
                yuan: opts.yuan,
                identity: opts.identity,
                persona: opts.persona,
                memory: {
                    enabled: true,
                    compileEvery: 10,
                    recentMessages: 20,
                    // 记忆编译模型不再硬编码：由 soul 运行时自适应解析
                    // （config.memory.model → 全局默认模型 agentDefaultModel.currentSelection()，
                    //   解析不到时编译任务跳过并记 warning，绝不崩）
                },
                experience: {
                    enabled: false, // 默认关闭，与 Hana 一致（config.example.yaml）
                },
            },
        },
    ];
}
/** 新建助手：校验 → 生成 id → 建目录 → 写模板预设 + 头像 + pinned.md。 */
export function createAgent(presetsRoot, soulRoot, opts) {
    const name = String(opts.name ?? "").trim();
    if (!name)
        throw new Error("请输入助手名字");
    if (!YUAN_KEYS.includes(opts.yuan))
        throw new Error(`未知的元：${opts.yuan}`);
    const existingIds = existsSync(presetsRoot)
        ? readdirSync(presetsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        : [];
    const id = generateAgentId(name, new Set(existingIds));
    // 展示顺序：追加到末尾（现有最大 order + 1；无则从 0 起），与 Hana 新建追加行为一致
    const nextOrder = existingIds.reduce((max, eid) => {
        const o = readPresetMeta(join(presetsRoot, eid)).order;
        return o !== undefined && o > max ? o : max;
    }, -1) + 1;
    const userName = opts.userName && opts.userName.trim() ? opts.userName.trim() : "用户";
    const identity = renderTemplate(identityTemplate(opts.yuan), { agentName: name, userName });
    const persona = renderTemplate(personaTemplate(opts.yuan), { agentName: name, userName });
    const dir = join(presetsRoot, id);
    mkdirSync(join(dir, "assets"), { recursive: true });
    // 1. agent.cordis.yml（插件行列表，原子写）
    const rows = buildAgentCordisRows({ id, name, userName, yuan: opts.yuan, identity, persona });
    atomicWrite(join(dir, "agent.cordis.yml"), yamlDump(rows, YAML_DUMP_OPTS));
    // 2. preset.yml（展示名 + 元描述 + 展示顺序 order，dsh 官方支持的元数据字段）
    const meta = YUAN_META[opts.yuan];
    const presetYaml = yamlDump({ name, description: `${meta.label} · ${meta.description}`, order: nextOrder }, YAML_DUMP_OPTS);
    atomicWrite(join(dir, "preset.yml"), presetYaml);
    // 3. 默认头像（复制 yuan 默认头像 → assets/avatar.png，素材随包分发，§10.15）
    const avatarSrc = new URL(`../assets/avatars/${opts.yuan}.png`, import.meta.url);
    writeFileSync(join(dir, "assets", "avatar.png"), readFileSync(avatarSrc));
    // 4. 初始化 assistant-soul/<profile>/pinned.md（记忆数据目录，空文件）
    const profileDir = join(soulRoot, id);
    mkdirSync(profileDir, { recursive: true });
    const pinnedFile = join(profileDir, "pinned.md");
    if (!existsSync(pinnedFile))
        writeFileSync(pinnedFile, "", "utf8");
    return readAgent(presetsRoot, id, undefined);
}
/** 校验 id 对应的预设目录存在且非 broken（更新前守卫）。 */
function assertUpdatablePreset(presetsRoot, id) {
    if (!isValidPresetId(id))
        throw new Error(`非法助手 id：${id}`);
    const dir = join(presetsRoot, id);
    if (!existsSync(dir))
        throw new Error(`助手不存在：${id}`);
    return dir;
}
/**
 * 更新助手字段并原子写回。
 *
 * - name：agent.cordis.yml 的 config.name + preset.yml 的 name 同步改（§6.2）；
 * - yuan：只换 config.yuan，**不自动替换 identity/persona**（与 Hana 行为一致，§6.2）；
 * - identity/persona：原样写入（允许清空，用户自己编辑的文本）；
 * - memoryEnabled / experienceEnabled：写 config.memory.enabled / config.experience.enabled。
 *
 * 改动只影响此后新建的会话（preset 是「创建时组装、运行中不动」，§6.2 / §10.10）。
 */
export function updateAgent(presetsRoot, id, patch, defaultId) {
    const dir = assertUpdatablePreset(presetsRoot, id);
    let read;
    try {
        read = readSoulRows(dir);
    }
    catch (e) {
        throw new Error(`预设已损坏，拒绝更新：${e instanceof Error ? e.message : String(e)}`);
    }
    const { rows, index, config } = read;
    const patchKeys = Object.keys(patch ?? {});
    if (patchKeys.length === 0)
        throw new Error("没有可更新的字段");
    // 名字：非空校验 + 写 config.name；改完同步 preset.yml
    let nameChanged = false;
    if (patch.name !== undefined) {
        const name = String(patch.name).trim();
        if (!name)
            throw new Error("请输入助手名字");
        if (config.name !== name) {
            config.name = name;
            nameChanged = true;
        }
    }
    // 元：只换 yuan 字段，不自动替换 identity/persona（与 Hana 一致）
    if (patch.yuan !== undefined) {
        if (!YUAN_KEYS.includes(patch.yuan))
            throw new Error(`未知的元：${patch.yuan}（可选：${YUAN_KEYS.join("/")}）`);
        config.yuan = patch.yuan;
    }
    // 身份 / 人格：原样写入（用户编辑的文本，允许清空）
    if (patch.identity !== undefined)
        config.identity = String(patch.identity);
    if (patch.persona !== undefined)
        config.persona = String(patch.persona);
    // 记忆 / 经验开关
    if (patch.memoryEnabled !== undefined) {
        if (typeof patch.memoryEnabled !== "boolean")
            throw new Error("memoryEnabled 必须是布尔值");
        const memory = isPlainObject(config.memory) ? { ...config.memory } : {};
        memory.enabled = patch.memoryEnabled;
        config.memory = memory;
    }
    if (patch.experienceEnabled !== undefined) {
        if (typeof patch.experienceEnabled !== "boolean")
            throw new Error("experienceEnabled 必须是布尔值");
        const experience = isPlainObject(config.experience) ? { ...config.experience } : {};
        experience.enabled = patch.experienceEnabled;
        config.experience = experience;
    }
    // 原子写回 agent.cordis.yml（保持插件行列表结构，§10.5）
    rows[index] = { ...rows[index], config };
    atomicWrite(join(dir, "agent.cordis.yml"), yamlDump(rows, YAML_DUMP_OPTS));
    // 名字变了 → 同步 preset.yml 的 name（preset.yml 只承载展示文本，§dsh-agent-presets）
    if (nameChanged) {
        const meta = readPresetMeta(dir);
        atomicWrite(join(dir, "preset.yml"), yamlDump({ ...meta, name: String(config.name) }, YAML_DUMP_OPTS));
    }
    return readAgent(presetsRoot, id, defaultId);
}
/* ------------------------------------------------------------------ */
/* 头像（Phase 3）                                                       */
/* ------------------------------------------------------------------ */
/** 列出 preset 目录 assets/ 下已存在的头像文件（按 png > jpg > jpeg > webp 优先级）。 */
function listAvatarFiles(presetDir) {
    const files = [];
    for (const ext of AVATAR_EXTS) {
        const file = join(presetDir, "assets", `avatar.${ext}`);
        if (existsSync(file))
            files.push(file);
    }
    return files;
}
/**
 * 找 preset 的自定义头像文件（Hana findAgentAvatar 同款优先级 png > jpg > jpeg > webp，§4.1）。
 * 无自定义头像返回 undefined（前端按 yuan 用默认头像兜底，§3.2）。
 */
export function findAvatarFile(presetDir) {
    return listAvatarFiles(presetDir)[0];
}
/** 校验扩展名是否在白名单内。 */
export function isValidAvatarExt(ext) {
    return AVATAR_EXTS.includes(ext.toLowerCase());
}
/**
 * 图片魔数校验（防上传非图片内容）：按扩展名检查文件头。
 * - png：\x89PNG\r\n\x1a\n
 * - jpg：\xFF\xD8\xFF
 * - webp：RIFF....WEBP
 */
export function isValidImageMagic(data, ext) {
    if (!isValidAvatarExt(ext))
        return false;
    const e = ext.toLowerCase();
    if (e === "png") {
        return data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
            data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;
    }
    if (e === "jpg" || e === "jpeg") {
        return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    }
    if (e === "webp") {
        return data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
    }
    return false;
}
/** 上传头像：校验 id/扩展名/魔数 → 清掉旧头像（其它扩展名）→ 原子写新头像。 */
export function writeAvatar(presetsRoot, id, data, ext) {
    if (!isValidPresetId(id))
        throw new Error(`非法助手 id：${id}`);
    const dir = join(presetsRoot, id);
    if (!existsSync(dir))
        throw new Error(`助手不存在：${id}`);
    if (!isValidAvatarExt(ext))
        throw new Error(`不支持的图片格式：${ext}（仅支持 png/jpg/jpeg/webp）`);
    if (!isValidImageMagic(data, ext))
        throw new Error("文件内容不是有效的图片");
    // 清掉旧头像，只保留新写的这一个（避免 png/jpg/webp 并存）
    for (const old of listAvatarFiles(dir)) {
        rmSync(old, { force: true });
    }
    const file = join(dir, "assets", `avatar.${ext.toLowerCase()}`);
    mkdirSync(join(dir, "assets"), { recursive: true });
    atomicWriteBuffer(file, data);
    return { file, size: data.length };
}
/** 移除头像（恢复 yuan 默认头像兜底）。返回是否真的删了文件。 */
export function removeAvatar(presetsRoot, id) {
    if (!isValidPresetId(id))
        throw new Error(`非法助手 id：${id}`);
    const dir = join(presetsRoot, id);
    if (!existsSync(dir))
        throw new Error(`助手不存在：${id}`);
    const files = listAvatarFiles(dir);
    for (const file of files) {
        rmSync(file, { force: true });
    }
    return { removed: files.length > 0 };
}
/** 取头像文件路径（GET serve 用）；无自定义头像返回 undefined。 */
export function avatarFilePath(presetsRoot, id) {
    if (!isValidPresetId(id))
        return undefined;
    return findAvatarFile(join(presetsRoot, id));
}
/* ------------------------------------------------------------------ */
/* 删除助手（Phase 3）                                                    */
/* ------------------------------------------------------------------ */
/**
 * 删除助手：删 .agent-presets/{id}/ 目录 + assistant-soul/{id}/ 目录（profile = 预设 id，§10.8）。
 *
 * 保护逻辑（§6.2 / Hana lastAgent）：
 * - 非法 id（目录穿越）拒绝；
 * - 不存在的 id 拒绝（404）；
 * - 默认助手拒绝删除（§6.2「若为默认 preset 则先拒绝或要求先改默认」——先拒绝，UI 提示先设其他为主助手）；
 * - 最后一个助手拒绝删除（Hana「至少保留一个助手」）。
 *
 * 删除是破坏性操作：路径拼装前先校验 id 合法（join presetsRoot/id 后不可能越界），再删。
 */
export function deleteAgent(presetsRoot, soulRoot, id, defaultId) {
    if (!isValidPresetId(id))
        throw new Error(`非法助手 id：${id}`);
    const dir = join(presetsRoot, id);
    if (!existsSync(dir))
        throw new Error(`助手不存在：${id}`);
    if (id === defaultId)
        throw new Error("默认助手不能删除，请先设其他助手为主助手");
    const ids = existsSync(presetsRoot)
        ? readdirSync(presetsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory() && isValidPresetId(e.name))
            .map((e) => e.name)
        : [];
    if (ids.length <= 1)
        throw new Error("至少保留一个助手");
    rmSync(dir, { recursive: true, force: true });
    // 记忆数据目录：profile = 预设 id；可能还没聊过天（目录不存在），force 幂等
    const soulDir = join(soulRoot, id);
    if (existsSync(soulDir))
        rmSync(soulDir, { recursive: true, force: true });
    return { deleted: id };
}
/* ------------------------------------------------------------------ */
/* 排序（Phase 3）                                                       */
/* ------------------------------------------------------------------ */
/**
 * 重排助手：按传入顺序把每个预设的 preset.yml 的 order 重写为 0..n-1。
 *
 * 排序载体调研结论（2026-08）：dsh 无「preset 列表顺序」概念，但 preset.yml 的
 * order 字段是官方支持的元数据（dsh-agent-presets readPresetMetadata 读 record.order，
 * 有限 number），管理插件列表 API 按它升序渲染（§6.2「排序」行）。
 *
 * 校验：顺序列表必须与现有助手 id 集合完全一致（长度 + 内容 + 无重复），
 * 防止前端提交删掉的/伪造的 id。
 */
export function reorderAgents(presetsRoot, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0)
        throw new Error("排序列表不能为空");
    const current = existsSync(presetsRoot)
        ? new Set(readdirSync(presetsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory() && isValidPresetId(e.name))
            .map((e) => e.name))
        : new Set();
    if (orderedIds.length !== current.size)
        throw new Error("排序列表与现有助手数量不一致");
    const seen = new Set();
    for (const id of orderedIds) {
        if (!isValidPresetId(id))
            throw new Error(`非法助手 id：${id}`);
        if (!current.has(id))
            throw new Error(`排序列表包含不存在的助手：${id}`);
        if (seen.has(id))
            throw new Error(`排序列表包含重复 id：${id}`);
        seen.add(id);
    }
    orderedIds.forEach((id, index) => {
        const dir = join(presetsRoot, id);
        const meta = readPresetMeta(dir);
        // 只带非空字段 + order，避免给没有 preset.yml 的预设写出空 name/description 键
        const record = {};
        if (meta.name)
            record.name = meta.name;
        if (meta.description)
            record.description = meta.description;
        record.order = index;
        atomicWrite(join(dir, "preset.yml"), yamlDump(record, YAML_DUMP_OPTS));
    });
    return listAgents(presetsRoot, undefined);
}

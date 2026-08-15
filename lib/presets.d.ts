import { type YuanKey } from "./templates.js";
/** 一个助手的汇总信息（列表 API 返回）。 */
export interface AgentSummary {
    id: string;
    name: string;
    description: string;
    yuan: YuanKey;
    identity: string;
    persona: string;
    memoryEnabled: boolean;
    experienceEnabled: boolean;
    hasAvatar: boolean;
    isDefault: boolean;
    /** 展示顺序（preset.yml 的 order；缺失时给极大值排末尾，列表按此升序）。 */
    order: number;
    /** 读取/解析失败时的原因（broken preset，§10.6）。 */
    broken?: string;
}
/** 头像扩展名白名单（参考 Hana findAgentAvatar 的 png > jpg > jpeg > webp 优先级，§4.1）。 */
export declare const AVATAR_EXTS: readonly ["png", "jpg", "jpeg", "webp"];
export type AvatarExt = (typeof AVATAR_EXTS)[number];
/** 解析 agent.cordis.yml，返回 assistant-soul 行的 config（读失败返回 undefined）。 */
export declare function readSoulConfig(presetPath: string): {
    config: Record<string, unknown> | undefined;
    error?: string;
};
/**
 * 读取 agent.cordis.yml 的完整插件行列表 + assistant-soul 行索引。
 * 更新（PUT）必须走这里拿整行列表再改写回，保持 `[{id, name, config}]` 结构（§10.5）。
 * 解析失败抛错（调用方拒绝更新，避免把 broken 预设写得更坏）。
 */
export declare function readSoulRows(presetPath: string): {
    rows: unknown[];
    index: number;
    config: Record<string, unknown>;
};
/** 读 preset.yml 展示元信息（缺失/损坏回落空，§「preset.yml 只承载展示文本」）。 */
export declare function readPresetMeta(presetPath: string): {
    name: string;
    description: string;
    order?: number;
};
/** 扫描 .agent-presets/，返回全部助手汇总（broken 也列出，§10.6），按 order 升序。 */
export declare function listAgents(presetsRoot: string, defaultId: string | undefined): AgentSummary[];
/** 读单个助手汇总。 */
export declare function readAgent(presetsRoot: string, id: string, defaultId: string | undefined): AgentSummary;
/** 原子写：先写临时文件再 rename（同一目录内 rename 是原子的，§10.4）。 */
export declare function atomicWrite(file: string, content: string): void;
/** 原子写（二进制）：图片等非文本内容同样走临时文件 + rename，避免半路写坏。 */
export declare function atomicWriteBuffer(file: string, data: Buffer): void;
/** 组装新建助手的 agent.cordis.yml（插件行列表，结构照抄 xiaohua，§6.3）。 */
export declare function buildAgentCordisRows(opts: {
    id: string;
    name: string;
    userName: string;
    yuan: YuanKey;
    identity: string;
    persona: string;
}): unknown[];
/** 新建助手：校验 → 生成 id → 建目录 → 写模板预设 + 头像 + pinned.md。 */
export declare function createAgent(presetsRoot: string, soulRoot: string, opts: {
    name: string;
    yuan: YuanKey;
    userName?: string;
}): AgentSummary;
/** PUT /api/agents/{id} 的可更新字段（§6.2「API 与落盘映射」）。 */
export interface AgentUpdate {
    name?: string;
    identity?: string;
    persona?: string;
    yuan?: YuanKey;
    memoryEnabled?: boolean;
    experienceEnabled?: boolean;
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
export declare function updateAgent(presetsRoot: string, id: string, patch: AgentUpdate, defaultId?: string): AgentSummary;
/**
 * 找 preset 的自定义头像文件（Hana findAgentAvatar 同款优先级 png > jpg > jpeg > webp，§4.1）。
 * 无自定义头像返回 undefined（前端按 yuan 用默认头像兜底，§3.2）。
 */
export declare function findAvatarFile(presetDir: string): string | undefined;
/** 校验扩展名是否在白名单内。 */
export declare function isValidAvatarExt(ext: string): ext is AvatarExt;
/**
 * 图片魔数校验（防上传非图片内容）：按扩展名检查文件头。
 * - png：\x89PNG\r\n\x1a\n
 * - jpg：\xFF\xD8\xFF
 * - webp：RIFF....WEBP
 */
export declare function isValidImageMagic(data: Buffer, ext: string): boolean;
/** 上传头像：校验 id/扩展名/魔数 → 清掉旧头像（其它扩展名）→ 原子写新头像。 */
export declare function writeAvatar(presetsRoot: string, id: string, data: Buffer, ext: string): {
    file: string;
    size: number;
};
/** 移除头像（恢复 yuan 默认头像兜底）。返回是否真的删了文件。 */
export declare function removeAvatar(presetsRoot: string, id: string): {
    removed: boolean;
};
/** 取头像文件路径（GET serve 用）；无自定义头像返回 undefined。 */
export declare function avatarFilePath(presetsRoot: string, id: string): string | undefined;
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
export declare function deleteAgent(presetsRoot: string, soulRoot: string, id: string, defaultId?: string): {
    deleted: string;
};
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
export declare function reorderAgents(presetsRoot: string, orderedIds: string[]): AgentSummary[];

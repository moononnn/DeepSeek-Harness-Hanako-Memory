/**
 * 助手 id 生成：目录名 = preset id，必须匹配 `[a-z0-9][a-z0-9-]*`
 * （dsh agentPresets 对非法 id 目录直接跳过，复制/创建 API 也拒绝非法 id）。
 *
 * 中文名没有拼音库（依赖树里无 pinyin），按「ASCII slug + 数字后缀」退化：
 * - 名字转小写，非 [a-z0-9] 段替换为单个 '-'
 * - 全中文名 → slug 为空 → 用 'assistant' 兜底前缀
 * - 数字后缀（4 位随机）保证唯一；与现有 id 冲突则重试
 */

/** 合法 preset id 字符集（dsh 规则）。 */
export const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 名字 → ASCII slug（小写，'a-z0-9-'，首尾无 '-'，空则返回空串）。 */
export function slugify(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomSuffix(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * 生成唯一助手 id：slug 兜底 'assistant' + '-' + 数字后缀。
 * @param name 助手名字（可为中文）。
 * @param existing 现有 id 集合（用于冲突检测）。
 */
export function generateAgentId(name: string, existing: ReadonlySet<string>): string {
  const base = slugify(name) || "assistant";
  if (!/^[a-z0-9]/.test(base)) {
    throw new Error(`无法从名字生成合法 id：${name}`);
  }
  for (let attempt = 0; attempt < 16; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`id 生成冲突次数过多：${name}`);
}

/** 校验一个 id 是否合法 preset id。 */
export function isValidPresetId(id: string): boolean {
  return PRESET_ID_RE.test(id);
}

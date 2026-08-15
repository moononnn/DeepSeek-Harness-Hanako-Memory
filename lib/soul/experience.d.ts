import type { ProfilePaths } from "./paths.js";
export interface ExperienceEntry {
    category: string;
    content: string;
}
export interface ExperienceDocument {
    /** 规范化后的分类名 */
    category: string;
    /** 分类文件绝对路径 */
    file: string;
    entries: string[];
}
/** 规范化分类名：去空白（连续空白合并为一个空格）、禁路径分隔符/..、禁盘符、禁控制字符。 */
export declare function normalizeExperienceCategory(raw: string): string;
/**
 * 分类名 → 存储文件名：NFKC 小写 → 非字母数字替换为 `-` → 去首尾 `-` → 截断 48 字符
 * → 加 sha256(分类名) 前 10 位哈希。例：`tool usage` → `tool-usage-<hash>.md`。
 */
export declare function buildExperienceStorageFileName(category: string): string;
/** 解析分类文件正文为条目列表（`1. xxx` 数字列表；跳过文件头注释行）。 */
export declare function parseExperienceEntries(text: string): string[];
/** 读一个分类文档；不存在返回 undefined。 */
export declare function readExperienceDocument(paths: ProfilePaths, category: string): ExperienceDocument | undefined;
/** 追加一条经验（去重），然后重建索引。 */
export declare function recordExperienceEntry(paths: ProfilePaths, category: string, content: string): {
    added: boolean;
    message: string;
};
/**
 * 重建经验索引 experience.md：每分类输出 `# 分类名（N 条）` + 每条前 20 字分号拼接 + `→ experience/<文件名>`。
 */
export declare function rebuildExperienceIndex(paths: ProfilePaths): void;
/** 读经验索引（给 systemPrompt variable 用）；不存在返回空串（渲染时该段自动消失）。 */
export declare function readExperienceIndex(paths: ProfilePaths): string;
/**
 * 召回经验：无参返回索引；带 category 返回该分类全部条目。
 * @returns 模型可读文本。
 */
export declare function recallExperience(paths: ProfilePaths, category?: string): string;

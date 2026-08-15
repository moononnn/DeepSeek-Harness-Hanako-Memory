/**
 * 经验库：纯文件系统实现（照抄 HanaAgent lib/tools/experience.ts 的逻辑）。
 *
 * 存储格式：
 *   experience/<文件名>.md  每分类一个文件；文件头 `<!-- experience-title: <base64url(分类名)> -->`，
 *                           正文是 `1. xxx\n2. xxx` 数字列表。
 *   experience/experience.md 索引，由 rebuildIndex 自动生成，不手写。
 *
 * 所有读写用同步 fs：文件小、操作少，同步保证工具执行时无并发写冲突。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const TITLE_PATTERN = /^<!-- experience-title: ([A-Za-z0-9_-]+) -->/;
/** 规范化分类名：去空白（连续空白合并为一个空格）、禁路径分隔符/..、禁盘符、禁控制字符。 */
export function normalizeExperienceCategory(raw) {
    const trimmed = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (trimmed.length === 0)
        throw new Error("分类名不能为空");
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
        throw new Error("分类名不能包含路径分隔符");
    }
    if (/^[a-zA-Z]:/.test(trimmed))
        throw new Error("分类名不能是盘符形式");
    if (/[\x00-\x1f\x7f]/.test(trimmed))
        throw new Error("分类名不能包含控制字符");
    return trimmed;
}
/**
 * 分类名 → 存储文件名：NFKC 小写 → 非字母数字替换为 `-` → 去首尾 `-` → 截断 48 字符
 * → 加 sha256(分类名) 前 10 位哈希。例：`tool usage` → `tool-usage-<hash>.md`。
 */
export function buildExperienceStorageFileName(category) {
    const base = category
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "experience";
    const hash = createHash("sha256").update(category).digest("hex").slice(0, 10);
    return `${base}-${hash}.md`;
}
/** 解析分类文件正文为条目列表（`1. xxx` 数字列表；跳过文件头注释行）。 */
export function parseExperienceEntries(text) {
    return text
        .split(/\r?\n/)
        .filter((line) => !/^\s*<!--/.test(line))
        .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
        .filter(Boolean);
}
/** 读一个分类文档；不存在返回 undefined。 */
export function readExperienceDocument(paths, category) {
    const file = join(paths.experienceDir, buildExperienceStorageFileName(category));
    let text;
    try {
        text = readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    }
    const titleMatch = TITLE_PATTERN.exec(text);
    const resolvedCategory = titleMatch ? Buffer.from(titleMatch[1], "base64url").toString("utf8") : category;
    return { category: resolvedCategory, file, entries: parseExperienceEntries(text) };
}
/** 追加一条经验（去重），然后重建索引。 */
export function recordExperienceEntry(paths, category, content) {
    const normalized = normalizeExperienceCategory(category);
    const clean = String(content ?? "").trim();
    if (!clean)
        throw new Error("经验内容不能为空");
    const doc = readExperienceDocument(paths, normalized);
    const existing = doc?.entries ?? [];
    if (existing.includes(clean)) {
        return { added: false, message: `「${normalized}」下已有相同经验，未重复添加` };
    }
    const title = `<!-- experience-title: ${Buffer.from(normalized, "utf8").toString("base64url")} -->`;
    const body = [...existing.map((entry, index) => `${index + 1}. ${entry}`), `${existing.length + 1}. ${clean}`].join("\n");
    mkdirSync(paths.experienceDir, { recursive: true });
    writeFileSync(join(paths.experienceDir, buildExperienceStorageFileName(normalized)), `${title}\n${body}\n`, "utf8");
    rebuildExperienceIndex(paths);
    return { added: true, message: `已记录经验到「${normalized}」（第 ${existing.length + 1} 条）` };
}
/**
 * 重建经验索引 experience.md：每分类输出 `# 分类名（N 条）` + 每条前 20 字分号拼接 + `→ experience/<文件名>`。
 */
export function rebuildExperienceIndex(paths) {
    let files;
    try {
        files = readdirSync(paths.experienceDir).filter((file) => file.endsWith(".md") && file !== "experience.md");
    }
    catch {
        files = [];
    }
    files.sort();
    const lines = [];
    for (const file of files) {
        let text = "";
        try {
            text = readFileSync(join(paths.experienceDir, file), "utf8");
        }
        catch {
            continue;
        }
        const titleMatch = TITLE_PATTERN.exec(text);
        const category = titleMatch ? Buffer.from(titleMatch[1], "base64url").toString("utf8") : file;
        const entries = parseExperienceEntries(text);
        const preview = entries.map((entry) => entry.slice(0, 20)).join("；");
        lines.push(`# ${category}（${entries.length} 条）`);
        if (preview)
            lines.push(preview);
        lines.push(`→ experience/${file}`, "");
    }
    if (lines.length > 0) {
        mkdirSync(paths.experienceDir, { recursive: true });
        writeFileSync(paths.experienceIndex, lines.join("\n"), "utf8");
    }
    else if (existsSync(paths.experienceDir)) {
        // 空库时清掉旧索引，避免残留
        try {
            writeFileSync(paths.experienceIndex, "", "utf8");
        }
        catch {
            /* 目录不可写时忽略 */
        }
    }
}
/** 读经验索引（给 systemPrompt variable 用）；不存在返回空串（渲染时该段自动消失）。 */
export function readExperienceIndex(paths) {
    try {
        return readFileSync(paths.experienceIndex, "utf8").trim();
    }
    catch {
        return "";
    }
}
/**
 * 召回经验：无参返回索引；带 category 返回该分类全部条目。
 * @returns 模型可读文本。
 */
export function recallExperience(paths, category) {
    if (!category || !category.trim()) {
        const index = readExperienceIndex(paths);
        return index.trim() || "经验库为空。";
    }
    const doc = readExperienceDocument(paths, category.trim());
    if (!doc)
        return `分类「${category.trim()}」不存在。`;
    const body = doc.entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
    return `# ${doc.category}\n\n${body}`;
}

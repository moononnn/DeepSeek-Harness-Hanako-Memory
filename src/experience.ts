/**
 * 经验只读视图：列出 dsh-assistant-soul 写入的经验分类（Phase 2 只读展示，§3.7）。
 *
 * 数据格式（照抄 soul 插件 src/experience.ts，勿改）：
 *   assistant-soul/<profile>/experience/<文件名>.md  每分类一个文件
 *     文件头 `<!-- experience-title: <base64url(分类名)> -->`，
 *     正文是 `1. xxx` 数字列表。
 *   assistant-soul/<profile>/experience/experience.md 索引（自动生成，不手写）
 *
 * 分类列表 = 扫描 experience/ 下所有 .md（排除 experience.md），
 * 分类名优先取文件头 base64url 标题，取不到时回退文件名。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ExperienceCategory {
  /** 分类名（文件头 base64url 标题，缺失时回退文件名）。 */
  category: string;
  /** 分类文件相对 experience/ 的文件名。 */
  file: string;
  /** 条目列表。 */
  entries: string[];
}

const TITLE_PATTERN = /^<!-- experience-title: ([A-Za-z0-9_-]+) -->/;

/** 解析分类文件正文为条目列表（`1. xxx` 数字列表；跳过文件头注释行）。 */
export function parseExperienceEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*<!--/.test(line))
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(Boolean);
}

/** 扫描一个 profile 的经验分类（只读）；目录不存在返回空列表。 */
export function listExperienceCategories(soulRoot: string, profile: string): ExperienceCategory[] {
  const dir = join(soulRoot, profile, "experience");
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".md") && file !== "experience.md");
  } catch {
    return [];
  }
  files.sort();
  const categories: ExperienceCategory[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    const titleMatch = TITLE_PATTERN.exec(text);
    const category = titleMatch ? Buffer.from(titleMatch[1], "base64url").toString("utf8") : file.replace(/\.md$/, "");
    categories.push({ category, file, entries: parseExperienceEntries(text) });
  }
  return categories;
}

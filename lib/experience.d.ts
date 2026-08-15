export interface ExperienceCategory {
    /** 分类名（文件头 base64url 标题，缺失时回退文件名）。 */
    category: string;
    /** 分类文件相对 experience/ 的文件名。 */
    file: string;
    /** 条目列表。 */
    entries: string[];
}
/** 解析分类文件正文为条目列表（`1. xxx` 数字列表；跳过文件头注释行）。 */
export declare function parseExperienceEntries(text: string): string[];
/** 扫描一个 profile 的经验分类（只读）；目录不存在返回空列表。 */
export declare function listExperienceCategories(soulRoot: string, profile: string): ExperienceCategory[];

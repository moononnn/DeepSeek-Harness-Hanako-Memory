/**
 * systemPrompt section 文本拼装。
 *
 * section 的 text 是模板，`{{...}}` 在渲染时严格对照已注册变量解析；
 * 动态内容（记忆/经验/名字）用 variable 提供，静态结构写进 section。
 * 变量 provider 返回空字符串时，渲染后对应段自动消失——这是「没有记忆时不注入记忆段」的天然机制。
 */
export interface SoulPromptConfig {
    name: string;
    identity: string;
    persona: string;
    yuan: string;
}
/** 记忆使用规则（注入时附带的元规则，核心三条）。 */
export declare const MEMORY_RULES: string;
/** 关于ta + 人格定义（order 0）。 */
export declare function buildIdentitySectionText(config: SoulPromptConfig): string;
/** 记忆 section（order 2）：规则 + 置顶记忆 + 快照。 */
export declare function buildMemorySectionText(): string;
/** 经验 section（order 3）：索引。 */
export declare function buildExperienceSectionText(): string;

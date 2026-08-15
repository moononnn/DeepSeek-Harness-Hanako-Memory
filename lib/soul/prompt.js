/**
 * systemPrompt section 文本拼装。
 *
 * section 的 text 是模板，`{{...}}` 在渲染时严格对照已注册变量解析；
 * 动态内容（记忆/经验/名字）用 variable 提供，静态结构写进 section。
 * 变量 provider 返回空字符串时，渲染后对应段自动消失——这是「没有记忆时不注入记忆段」的天然机制。
 */
/** 记忆使用规则（注入时附带的元规则，核心三条）。 */
export const MEMORY_RULES = [
    "## 记忆使用规则",
    "- 记忆是空气：存在但不可见，不主动翻出来讲",
    "- 只有用户提到相关内容时记忆才参与",
    "- 记忆可能过时，当前对话优先",
].join("\n");
/** 关于ta + 人格定义（order 0）。 */
export function buildIdentitySectionText(config) {
    const parts = [`你是 {{assistant_name}}。`];
    if (config.identity.trim())
        parts.push(`\n# 关于你（关于ta）\n${config.identity.trim()}`);
    if (config.persona.trim())
        parts.push(`\n# 人格定义\n${config.persona.trim()}`);
    return parts.join("\n");
}
/** 记忆 section（order 2）：规则 + 置顶记忆 + 快照。 */
export function buildMemorySectionText() {
    return [`# 记忆\n`, MEMORY_RULES, `\n{{pinned_memory}}`, `\n{{memory_snapshot}}`].join("\n");
}
/** 经验 section（order 3）：索引。 */
export function buildExperienceSectionText() {
    return "# 经验库\n做具体任务前先查经验库（recall_experience）。\n\n{{experience_index}}";
}

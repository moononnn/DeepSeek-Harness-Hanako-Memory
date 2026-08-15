/** 包根目录（lib/ 上溯一级）。 */
export declare const PACKAGE_ROOT: string;
/** 四元键（与 dsh-assistant-soul 一致）。 */
export type YuanKey = "hanako" | "butter" | "ming" | "kong";
export declare const YUAN_KEYS: readonly YuanKey[];
/** 元展示元信息（zh.json yuan.types 语义，§3.5）。 */
export declare const YUAN_META: Record<YuanKey, {
    label: string;
    description: string;
}>;
/** 替换模板占位符。 */
export declare function renderTemplate(template: string, vars: {
    agentName: string;
    userName: string;
}): string;
/** 身份模板原文（yuan 模板；kong 回落通用模板）。 */
export declare function identityTemplate(yuan: YuanKey): string;
/** 人格模板原文（yuan 模板；kong 回落通用模板）。 */
export declare function personaTemplate(yuan: YuanKey): string;
/** yuan 意识块原文（kong 为空文件 → 空串，表示无意识块）。 */
export declare function yuanConsciousness(yuan: YuanKey): string;

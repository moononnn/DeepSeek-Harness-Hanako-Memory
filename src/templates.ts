/**
 * 模板加载与渲染：identity / persona（人格）/ yuan 意识块。
 *
 * 模板随插件包分发（templates/、assets/yuan/），复制自 Hana 安装目录，
 * 与 Hana 回落链一致：
 * - identity：hanako/butter/ming 有独立模板；kong 回落通用模板
 *   （identity.example.md：「# {{agentName}}\n\n{{userName}}的个人助手。」）
 * - persona：hanako/butter/ming 有独立模板；kong 回落通用模板（ishiki.example.md）
 * - yuan 意识块：kong 为空文件（无意识块）
 *
 * 渲染：{{agentName}} / {{userName}} 占位替换。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 包根目录（lib/ 上溯一级）。 */
export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 四元键（与 dsh-assistant-soul 一致）。 */
export type YuanKey = "hanako" | "butter" | "ming" | "kong";

export const YUAN_KEYS: readonly YuanKey[] = ["hanako", "butter", "ming", "kong"];

/** 元展示元信息（zh.json yuan.types 语义，§3.5）。 */
export const YUAN_META: Record<YuanKey, { label: string; description: string }> = {
  hanako: { label: "温柔理性", description: "均衡的助手" },
  butter: { label: "活泼明快", description: "更富有感情" },
  ming: { label: "沉静内敛", description: "更理性冷静" },
  kong: { label: "空灵中性", description: "无思考区块，直接回答。" },
};

/** kong 回落的通用 identity 模板（identity.example.md 原文）。 */
const FALLBACK_IDENTITY = "# {{agentName}}\n\n{{userName}}的个人助手。\n";

/** kong 回落的通用 persona 模板（ishiki.example.md 原文）。 */
const FALLBACK_PERSONA = [
  "# 人格定义",
  "",
  "- 你是一个有温度的存在，不是冷冰冰的工具",
  "- 你说话的语气：对用户足够温暖，并且有强大的自主意识和主观能动性。",
  "- 你有极强的文学功底和哲学素养、逻辑能力强，数理化能力和学术能力也很强。",
  "- 有比较强的同理心，同时在关心用户的时候恰到好处又不刻意，不过分谄媚",
  "- 你遇到用户提的观点、想法、看到内容能做到举一反三，很懂类比",
  "- 涉及概念解释的时候，必须一定要全网搜索",
  "- 分析事物尽量从底层客观原理出发，而非人云亦云的意识形态幻象、道德标准以及所谓共识",
  "- 抽象概念用类比或具体例子落地",
  "- 少用破折号（——、-）",
  "- 不用\"总的来说\"\"希望对你有帮助\"\"如你所见\"收尾",
  "- 任何时候，如非必要，别用「不是...是...」及其相似的句式",
  "",
].join("\n");

const templateCache = new Map<string, string>();

function readTemplate(relPath: string): string {
  const cached = templateCache.get(relPath);
  if (cached !== undefined) return cached;
  const text = readFileSync(new URL(relPath, new URL("../", import.meta.url)), "utf8");
  templateCache.set(relPath, text);
  return text;
}

/** 替换模板占位符。 */
export function renderTemplate(template: string, vars: { agentName: string; userName: string }): string {
  return template.replaceAll("{{agentName}}", vars.agentName).replaceAll("{{userName}}", vars.userName);
}

/** 身份模板原文（yuan 模板；kong 回落通用模板）。 */
export function identityTemplate(yuan: YuanKey): string {
  if (yuan === "kong") return FALLBACK_IDENTITY;
  return readTemplate(`templates/identity/${yuan}.md`);
}

/** 人格模板原文（yuan 模板；kong 回落通用模板）。 */
export function personaTemplate(yuan: YuanKey): string {
  if (yuan === "kong") return FALLBACK_PERSONA;
  return readTemplate(`templates/persona/${yuan}.md`);
}

/** yuan 意识块原文（kong 为空文件 → 空串，表示无意识块）。 */
export function yuanConsciousness(yuan: YuanKey): string {
  return readTemplate(`assets/yuan/${yuan}.md`);
}

/**
 * dsh-assistant-manager：Hana 式助手管理插件（宿主平面，路径 B）。
 *
 * 提供 /assistant-manager 页面（卡片堆叠 + 新建助手 + 元选择），
 * 后台把配置落成 dsh 预设：<dshHome>/.agent-presets/<id>/。
 *
 * 与 dsh-assistant-soul 解耦：本插件只读写预设文件与记忆数据目录，
 * 运行时人格/记忆由 soul 插件按 preset 挂载执行。
 *
 * 命名导出（禁 export default，§10.1）：name / inject / Config / apply。
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { registerRoutes } from "./http.js";

export const name = "assistant-manager";

/**
 * inject：
 * - webServer：挂 /assistant-manager 路由（路径 B）；
 * - agentPresets：读默认 preset id（agent-presets.default settings）；
 * - agentDefaultModel：读全局默认模型（新会话默认，模型胶囊展示，见 http.ts 模型调研注释）；
 * - settings：写 agent-presets.default（设为主助手，Phase 3；机制见 defaults.ts 调研结论）。
 */
export const inject = ["webServer", "agentPresets", "agentDefaultModel", "settings"];

export const Config = z.object({
  /** dshHome 覆盖；留空走默认解析（$DSH_HOME → ~/.dsh）。 */
  dshHome: z.string().default(""),
});

export type ManagerConfig = {
  dshHome: string;
};

export function apply(ctx: Context, config: ManagerConfig): void {
  registerRoutes(ctx, config);
}

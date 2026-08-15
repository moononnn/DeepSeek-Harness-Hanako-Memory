/**
 * 设为主助手：写 dsh 原生 settings 命名空间 `agent-presets.default`。
 *
 * 【写入机制调研结论，2026-08，依据 dsh-pkg/node_modules/@deepseek-ai 源码】
 * - dsh-agent-presets 在构造时经 `ctx.inject(['settings'])` 注册 settings 命名空间
 *   `'agent-presets'`（schema `{ default: z.string() }`），组合 base 来自配置
 *   `agentPresets.default`（本机 = xiaohua）。
 * - `ctx.agentPresets.defaultId` 每次调用实时读 `settings.get().default ?? config.default`，
 *   settings 文档热重载：update 持久化后立即生效，只影响此后新建的会话。
 * - 写入姿势：`ctx.settings.update('agent-presets', { default: <id> })`——深合并进
 *   用户分节（settings.yaml 的 `agent-presets:` 段），绝不硬编码改文件。
 * - 删除默认 preset 时 dsh 原生 remove() 会 `mutate unset default` 回落底层配置；
 *   本插件的删除 API 直接拒绝删默认助手（§6.2「先拒绝」），故无需 unset。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isValidPresetId } from "./ids.js";

/** dsh-settings 服务的最小形状（宿主组合已挂载，运行时经 ctx 注入）。 */
export interface SettingsLike {
  update(ns: string, patch: { default: string }): unknown;
}

/**
 * 把 id 设为默认助手（写 settings 命名空间 agent-presets.default）。
 * 校验：id 合法（防目录穿越）+ 预设目录存在；settings 服务不可用由调用方判空。
 */
export function setDefaultAgent(settings: SettingsLike, presetsRoot: string, id: string): void {
  if (!isValidPresetId(id)) throw new Error(`非法助手 id：${id}`);
  if (!existsSync(join(presetsRoot, id))) throw new Error(`助手不存在：${id}`);
  settings.update("agent-presets", { default: id });
}

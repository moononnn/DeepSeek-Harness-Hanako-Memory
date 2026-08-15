import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
/** dsh-host-webserver 的 WebServer 服务最小形状（宿主组合已挂载，运行时经 ctx 注入）。 */
interface WebServerLike {
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/** dsh-agent-presets 的 AgentPresets 服务最小形状。 */
interface AgentPresetsLike {
    defaultId: string | undefined;
}
/** dsh-agent-default-model 服务最小形状（base 组合已挂载）。 */
interface AgentDefaultModelLike {
    currentSelection(): {
        provider: string;
        model: string;
        reasoningEffort?: string;
    };
}
/** dsh-settings 服务最小形状（写入 agent-presets.default 用，见 defaults.ts 调研结论）。 */
interface SettingsLike {
    update(ns: string, patch: {
        default: string;
    }): unknown;
}
declare module "@deepseek-ai/cordis" {
    interface Context {
        webServer: WebServerLike;
        agentPresets?: AgentPresetsLike;
        agentDefaultModel?: AgentDefaultModelLike;
        settings?: SettingsLike;
    }
}
export declare const ROUTE_PREFIX = "/assistant-manager";
/** 注册 /assistant-manager 前缀路由。 */
export declare function registerRoutes(ctx: Context, config: {
    dshHome?: string;
}): void;
export {};

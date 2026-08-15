/** dsh-settings 服务的最小形状（宿主组合已挂载，运行时经 ctx 注入）。 */
export interface SettingsLike {
    update(ns: string, patch: {
        default: string;
    }): unknown;
}
/**
 * 把 id 设为默认助手（写 settings 命名空间 agent-presets.default）。
 * 校验：id 合法（防目录穿越）+ 预设目录存在；settings 服务不可用由调用方判空。
 */
export declare function setDefaultAgent(settings: SettingsLike, presetsRoot: string, id: string): void;

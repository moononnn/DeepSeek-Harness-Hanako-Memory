import type { UserPaths } from "./paths.js";
export interface UserData {
    /** 「Ta 怎么称呼你」（单行；空串表示未设置）。 */
    name: string;
    /** 用户档案（多行文本原样；空串表示未设置）。 */
    profile: string;
}
/**
 * 读 user.yaml；缺失/损坏回落 { name: "", profile: "" }（绝不抛错）。
 */
export declare function readUserYaml(paths: UserPaths): UserData;
/** 用户档案文本；未设置返回空串（dsh 渲染时整段消失的机制依据）。 */
export declare function readUserProfile(paths: UserPaths): string;
/**
 * userName 解析优先级：user.yaml 的 name（trim 后非空）> config.userName（老预设）> 「用户」。
 * 全局优先、预设兜底：老预设没有 user.yaml 时一切照旧。
 */
export declare function resolveUserName(name: string, fallback: string): string;

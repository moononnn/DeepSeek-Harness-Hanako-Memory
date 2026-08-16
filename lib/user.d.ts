import type { ManagerPaths } from "./paths.js";
/** user.yaml 的解析结果。 */
export interface UserData {
    /** 「Ta 怎么称呼你」（单行；空串表示未设置，由调用方 fallback）。 */
    name: string;
    /** 用户档案（多行文本原样；空串表示未设置）。 */
    profile: string;
}
/**
 * 读 user.yaml；缺失/损坏回落 { name: "", profile: "" }（绝不抛错，老预设兼容）。
 */
export declare function readUserYaml(paths: Pick<ManagerPaths, "userYaml">): UserData;
/**
 * 部分更新写 user.yaml：只覆盖 patch 里出现的字段（name/profile 均可为空串，
 * 空串 name 等价「恢复默认称呼」、空串 profile 等价「清空档案」）。
 * 返回写后的完整数据。
 */
export declare function writeUserYaml(paths: Pick<ManagerPaths, "userYaml">, patch: {
    name?: string;
    profile?: string;
}): UserData;
/** 用户头像文件路径；无自定义头像返回 undefined（GET serve 与前端 404 兜底用）。 */
export declare function userAvatarPath(paths: Pick<ManagerPaths, "userAvatar">): string | undefined;
/**
 * 写用户头像：固定 PNG（「我」页裁剪器输出 base64 PNG），魔数校验复用 presets 的
 * isValidImageMagic（同款防上传非图片内容），原子写 user-avatar.png。
 */
export declare function writeUserAvatar(paths: Pick<ManagerPaths, "userAvatar">, data: Buffer): {
    file: string;
    size: number;
};
/** 移除用户头像（恢复前端 SVG 人形占位）。返回是否真的删了文件。 */
export declare function removeUserAvatar(paths: Pick<ManagerPaths, "userAvatar">): {
    removed: boolean;
};

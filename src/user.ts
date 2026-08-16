/**
 * 全局用户数据读写（「我」页面后端）：
 * - <dshHome>/assistant-soul/user.yaml：name（单行）+ profile（多行文本，对应 Hana 的 user.name / user.md）
 * - <dshHome>/assistant-soul/user-avatar.png：用户头像（裁剪器输出 PNG）
 *
 * 分享版红线：只读写自己的 user.yaml 与 user-avatar.png，绝不触碰任何助手身份/预设文件。
 * 兼容策略：文件缺失/损坏一律回落空值（老预设不炸），由调用方决定 fallback。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { load as yamlLoad, dump as yamlDump, YAMLException } from "js-yaml";
import type { ManagerPaths } from "./paths.js";
import { atomicWrite, atomicWriteBuffer, isValidImageMagic } from "./presets.js";

/** user.yaml 的解析结果。 */
export interface UserData {
  /** 「Ta 怎么称呼你」（单行；空串表示未设置，由调用方 fallback）。 */
  name: string;
  /** 用户档案（多行文本原样；空串表示未设置）。 */
  profile: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** user.yaml dump 选项（与 presets.ts 一致，多行文本走块样式）。 */
const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' };

/**
 * 读 user.yaml；缺失/损坏回落 { name: "", profile: "" }（绝不抛错，老预设兼容）。
 */
export function readUserYaml(paths: Pick<ManagerPaths, "userYaml">): UserData {
  if (!existsSync(paths.userYaml)) return { name: "", profile: "" };
  let parsed: unknown;
  try {
    parsed = yamlLoad(readFileSync(paths.userYaml, "utf8"));
  } catch (e) {
    // 损坏的 yaml 当「未设置」处理，不炸（与 soul 读档案同款容忍）
    if (e instanceof YAMLException || e instanceof Error) {
      return { name: "", profile: "" };
    }
    return { name: "", profile: "" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { name: "", profile: "" };
  }
  const obj = parsed as Record<string, unknown>;
  return { name: str(obj.name), profile: str(obj.profile) };
}

/**
 * 部分更新写 user.yaml：只覆盖 patch 里出现的字段（name/profile 均可为空串，
 * 空串 name 等价「恢复默认称呼」、空串 profile 等价「清空档案」）。
 * 返回写后的完整数据。
 */
export function writeUserYaml(
  paths: Pick<ManagerPaths, "userYaml">,
  patch: { name?: string; profile?: string },
): UserData {
  const current = readUserYaml(paths);
  const next: UserData = {
    name: patch.name !== undefined ? str(patch.name) : current.name,
    profile: patch.profile !== undefined ? str(patch.profile) : current.profile,
  };
  mkdirSync(dirname(paths.userYaml), { recursive: true }); // 首次保存时 assistant-soul/ 可能还不存在
  atomicWrite(paths.userYaml, yamlDump(next, YAML_DUMP_OPTS));
  return next;
}

/** 用户头像文件路径；无自定义头像返回 undefined（GET serve 与前端 404 兜底用）。 */
export function userAvatarPath(paths: Pick<ManagerPaths, "userAvatar">): string | undefined {
  if (!existsSync(paths.userAvatar)) return undefined;
  return paths.userAvatar;
}

/**
 * 写用户头像：固定 PNG（「我」页裁剪器输出 base64 PNG），魔数校验复用 presets 的
 * isValidImageMagic（同款防上传非图片内容），原子写 user-avatar.png。
 */
export function writeUserAvatar(
  paths: Pick<ManagerPaths, "userAvatar">,
  data: Buffer,
): { file: string; size: number } {
  if (!isValidImageMagic(data, "png")) {
    throw new Error("文件内容不是有效的 PNG 图片");
  }
  mkdirSync(dirname(paths.userAvatar), { recursive: true }); // 首次上传时 assistant-soul/ 可能还不存在
  atomicWriteBuffer(paths.userAvatar, data);
  return { file: paths.userAvatar, size: data.length };
}

/** 移除用户头像（恢复前端 SVG 人形占位）。返回是否真的删了文件。 */
export function removeUserAvatar(paths: Pick<ManagerPaths, "userAvatar">): { removed: boolean } {
  const file = userAvatarPath(paths);
  if (!file) return { removed: false };
  rmSync(file, { force: true });
  return { removed: true };
}

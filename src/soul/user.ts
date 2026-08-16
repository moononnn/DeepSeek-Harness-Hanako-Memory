/**
 * 全局用户文件读取（soul 运行时侧，只读）：
 * - user.yaml 的 name → 「我」页面设置的用户称呼（全局，优先于预设 config.userName）
 * - user.yaml 的 profile → 用户档案（注入 assistant:user section，对应 Hana user.md）
 *
 * 只读纪律：soul 运行时绝不写 user.yaml（写入只属于管理平面 src/user.ts）。
 * 缺失/损坏一律回落空值，老预设不炸。
 */
import { existsSync, readFileSync } from "node:fs";
import { load as yamlLoad, YAMLException } from "js-yaml";
import type { UserPaths } from "./paths.js";

export interface UserData {
  /** 「Ta 怎么称呼你」（单行；空串表示未设置）。 */
  name: string;
  /** 用户档案（多行文本原样；空串表示未设置）。 */
  profile: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * 读 user.yaml；缺失/损坏回落 { name: "", profile: "" }（绝不抛错）。
 */
export function readUserYaml(paths: UserPaths): UserData {
  if (!existsSync(paths.yaml)) return { name: "", profile: "" };
  let parsed: unknown;
  try {
    parsed = yamlLoad(readFileSync(paths.yaml, "utf8"));
  } catch {
    return { name: "", profile: "" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { name: "", profile: "" };
  }
  const obj = parsed as Record<string, unknown>;
  return { name: str(obj.name), profile: str(obj.profile) };
}

/** 用户档案文本；未设置返回空串（dsh 渲染时整段消失的机制依据）。 */
export function readUserProfile(paths: UserPaths): string {
  return readUserYaml(paths).profile;
}

/**
 * userName 解析优先级：user.yaml 的 name（trim 后非空）> config.userName（老预设）> 「用户」。
 * 全局优先、预设兜底：老预设没有 user.yaml 时一切照旧。
 */
export function resolveUserName(name: string, fallback: string): string {
  const n = (name ?? "").trim();
  return n || fallback || "用户";
}

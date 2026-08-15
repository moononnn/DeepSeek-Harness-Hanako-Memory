/**
 * js-yaml 最小类型声明（依赖树里无 @types/js-yaml）。
 * 只用 load / dump 两个函数，保持结构往返。
 */
declare module "js-yaml" {
  export interface DumpOptions {
    indent?: number;
    lineWidth?: number;
    sortKeys?: boolean;
    quotingType?: string;
    noRefs?: boolean;
    forceQuotes?: boolean;
  }
  export interface LoadOptions {
    filename?: string;
    schema?: unknown;
  }
  export function load(str: string, opts?: LoadOptions): unknown;
  export function dump(obj: unknown, opts?: DumpOptions): string;
  export class YAMLException extends Error {
    reason?: string;
    mark?: unknown;
  }
}

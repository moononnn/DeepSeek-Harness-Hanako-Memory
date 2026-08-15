/**
 * 原子写：临时文件 + rename，避免写一半崩溃留下损坏文件。
 *
 * Hana 的 `Qe()` 同款语义：先写 `<path>.<随机后缀>.tmp`，成功后 rename 覆盖目标。
 * 所有记忆/摘要/状态文件的写入都必须走这里。
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * 原子写入一个 UTF-8 文本文件（临时文件 + rename）。
 * @param filePath - 目标路径。
 * @param content - 要写入的内容。
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.${Date.now()}-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
}

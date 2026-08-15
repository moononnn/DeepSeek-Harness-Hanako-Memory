/**
 * 编译指纹缓存：`{outputPath}.fingerprint`（MD5）。
 *
 * 每个编译函数（compileToday/compileWeek/compileLongterm/compileFacts）在执行前
 * 先计算输入指纹，与上次成功编译时写下的指纹比对：
 * - 一致 → `"skipped"`，跳过 LLM 调用；
 * - 不一致或缺失 → 正常编译，成功后原子写新指纹。
 *
 * 语义照抄 Hana `lib/memory/compile.ts`：
 * - 指纹文件与输出文件同目录，名为 `{outputPath}.fingerprint`；
 * - 编译失败（异常）不写指纹，旧指纹保留，避免失败态被指纹锁死；
 * - 空输入（无 sessions）时同样不写指纹，让下次有数据时能正常触发。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { atomicWriteFileSync } from "./atomic.js";
/** 计算一段输入文本的 MD5 指纹。 */
export function computeFingerprint(input) {
    return createHash("md5").update(input).digest("hex");
}
/** 计算多行输入（如 sessionId:updatedAt 列表）的 MD5 指纹。 */
export function computeListFingerprint(lines) {
    return computeFingerprint(lines.join("\n"));
}
/** 指纹文件路径：`{outputPath}.fingerprint`。 */
export function fingerprintPathFor(outputPath) {
    return `${outputPath}.fingerprint`;
}
/** 读上次指纹；文件缺失返回 null。 */
export function readFingerprint(outputPath) {
    try {
        return readFileSync(fingerprintPathFor(outputPath), "utf8").trim() || null;
    }
    catch {
        return null;
    }
}
/**
 * 判断是否需要编译：指纹一致且输出文件已存在 → false（跳过）；
 * 其余情况 → true（需要编译）。任何读失败都视为需要编译。
 */
export function shouldCompile(outputPath, fingerprint) {
    const previous = readFingerprint(outputPath);
    if (previous === null || previous !== fingerprint)
        return true;
    return !existsSync(outputPath);
}
/**
 * 编译成功后原子写指纹。调用方只在成功路径调用；
 * 失败路径不写，旧指纹保留（失败不覆盖旧数据）。
 */
export function writeFingerprint(outputPath, fingerprint) {
    atomicWriteFileSync(fingerprintPathFor(outputPath), fingerprint);
}

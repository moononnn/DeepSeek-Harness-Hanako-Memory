/** 计算一段输入文本的 MD5 指纹。 */
export declare function computeFingerprint(input: string): string;
/** 计算多行输入（如 sessionId:updatedAt 列表）的 MD5 指纹。 */
export declare function computeListFingerprint(lines: readonly string[]): string;
/** 指纹文件路径：`{outputPath}.fingerprint`。 */
export declare function fingerprintPathFor(outputPath: string): string;
/** 读上次指纹；文件缺失返回 null。 */
export declare function readFingerprint(outputPath: string): string | null;
/**
 * 判断是否需要编译：指纹一致且输出文件已存在 → false（跳过）；
 * 其余情况 → true（需要编译）。任何读失败都视为需要编译。
 */
export declare function shouldCompile(outputPath: string, fingerprint: string): boolean;
/**
 * 编译成功后原子写指纹。调用方只在成功路径调用；
 * 失败路径不写，旧指纹保留（失败不覆盖旧数据）。
 */
export declare function writeFingerprint(outputPath: string, fingerprint: string): void;

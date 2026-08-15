/**
 * 原子写入一个 UTF-8 文本文件（临时文件 + rename）。
 * @param filePath - 目标路径。
 * @param content - 要写入的内容。
 */
export declare function atomicWriteFileSync(filePath: string, content: string): void;

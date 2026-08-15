/**
 * 消息内容工具：从 dsh 消息内容块数组里拼接 text 块文本。
 * 从旧 memory.ts 抽出的共享函数。
 */

/** 从消息内容块数组里拼接 text 块文本。 */
export function textBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => {
      return typeof block === "object" && block !== null && (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string";
    })
    .map((block) => block.text)
    .join("")
    .trim();
}

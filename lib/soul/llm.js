import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
/**
 * 调用一次 LLM 文本生成（非流式消费，返回完整文本）。
 * @throws 流未正常完成或无法解析为文本时抛错。
 */
export async function callText(ctx, options) {
    const message = createUserMessage({
        content: [{ type: "text", text: options.prompt }],
        source: {
            kind: "plugin",
            plugin: "assistant-soul",
            form: "snapshot",
            sections: [{ name: `assistant-soul:${options.operation}`, text: options.prompt }],
        },
    });
    const assembler = new BlockAssembler();
    const stream = ctx.llm.stream({
        provider: options.provider,
        model: options.model,
        system: options.system,
        messages: [message],
        signal: options.signal,
        purpose: "compaction",
        maxTokens: options.maxTokens,
    });
    for await (const chunk of stream)
        assembler.push(chunk);
    const finish = assembler.finish;
    if (finish.kind === "error" || finish.kind === "aborted") {
        throw new Error(`记忆任务 LLM 流未完成（${options.operation}: ${finish.kind}）`);
    }
    const text = assembler
        .blocks()
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
    if (!text)
        throw new Error(`记忆任务 LLM 返回空文本（${options.operation}）`);
    return text;
}

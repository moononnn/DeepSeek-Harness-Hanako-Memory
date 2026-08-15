/**
 * 编译用 LLM 调用封装。
 *
 * 所有记忆后台任务（滚动摘要 / 分层编译 / Deep Memory 事实提取）共用这一条调用链：
 * - 模型走配置的 `memory.model`（便宜模型），绝不吃主对话模型；
 * - `purpose: "compaction"`，与主对话流量区分；
 * - 单次调用超时、temperature 由调用方传入。
 */
import type { Context } from "@deepseek-ai/cordis";
export interface CallTextOptions {
    provider: string;
    model: string;
    system: string;
    prompt: string;
    maxTokens: number;
    operation: string;
    temperature?: number;
    signal?: AbortSignal;
}
/**
 * 调用一次 LLM 文本生成（非流式消费，返回完整文本）。
 * @throws 流未正常完成或无法解析为文本时抛错。
 */
export declare function callText(ctx: Context, options: CallTextOptions): Promise<string>;

import type { Context } from "@deepseek-ai/cordis";
import type { ProfilePaths } from "./paths.js";
import type { MemoryTickerConfig } from "./memory-ticker.js";
export interface PinnedEntry {
    id: string;
    content: string;
}
/** 读置顶记忆索引（pinned-memory.json）；缺失/损坏时从 pinned.md 重建。 */
export declare function readPinnedEntries(paths: ProfilePaths): PinnedEntry[];
/** 追加一条置顶记忆（内容去重）。 */
export declare function addPinnedEntry(paths: ProfilePaths, content: string): {
    alreadyExists: boolean;
};
/** 按 id 精确匹配或按内容关键词（包含）删除置顶记忆。 */
export declare function removePinnedEntry(paths: ProfilePaths, idOrKeyword: string): {
    removed: boolean;
    message: string;
};
/** 置顶记忆渲染文本（systemPrompt variable）；空返回空串，渲染时该段自动消失。 */
export declare function formatPinned(paths: ProfilePaths): string;
export { MEMORY_FILES, parseMemoryMd, readMemoryMd, normalizeCompiledSectionBody } from "./compiled-snapshot.js";
export { readMemorySectionBody as readMemorySection, writeCompiledMemorySnapshot as writeCompiledMemory, readCompiledMemorySnapshot as readCompiledMemory, } from "./compiled-snapshot.js";
export type { MemorySectionKey, CompiledMemory } from "./compiled-snapshot.js";
/** 记忆快照渲染文本（systemPrompt variable）；空返回空串，渲染时该段自动消失。 */
export declare function formatMemorySnapshot(paths: ProfilePaths): string;
/** session 事件的最小结构（dsh-session 的会话事件：{ type, data }）。 */
export interface SessionEvent {
    type: string;
    data: any;
}
/** agent/pre-step 载荷的最小结构（dsh-agent-loop 的 waterfall 载荷：{ agent, turn, step, signal }）。 */
export interface PreStepPayload {
    agent: {
        session: {
            events: readonly SessionEvent[];
        };
    };
    turn: number;
    step: number;
    signal?: AbortSignal;
}
/** 从会话事件里取最近对话文本（用户/助手消息，跳过插件注入消息）。 */
export declare function collectRecentConversation(agent: PreStepPayload["agent"], limit: number): string;
/**
 * 把 LLM 编译输出解析成四段记忆（旧格式兼容）。
 * 按 `## ` 二级标题切分，标题模糊匹配（包含关键字）；
 * 没有任何可识别段落时返回 null（调用方保留旧快照）。
 */
export declare function parseCompiledMemory(text: string): Partial<Record<"facts" | "today" | "week" | "longterm", string>> | null;
export interface MemoryConfig extends MemoryTickerConfig {
}
/**
 * 注册记忆编译调度器（转发 memory-ticker.ts）：
 * 轮数触发（agent/pre-step）+ session 结束（agent/disposed）+ 每日任务（日期变化）。
 * 所有编译后台异步，不阻塞回合。
 */
export declare function registerMemoryTicker(ctx: Context, config: MemoryConfig, paths: ProfilePaths, profileName: string): void;

/**
 * 记忆系统：置顶记忆（pinned）+ 记忆快照（facts/today/week/longterm）。
 *
 * 数据布局（每个 profile 一个目录）：
 *   <profile>/pinned.md          置顶记忆渲染视图（每行一条）
 *   <profile>/pinned-memory.json 置顶记忆索引（带 id，用于 unpin）
 *   <profile>/memory/facts.md    重要事实
 *   <profile>/memory/today.md    今天
 *   <profile>/memory/week.md     本周早些时候
 *   <profile>/memory/longterm.md 长期情况
 *
 * 滚动摘要 / 分层编译 / 每日任务 / FactStore / Deep Memory 见：
 *   ./rolling-summary.ts / ./compile.ts / ./memory-ticker.ts / ./fact-store.ts / ./deep-memory.ts
 * 调度器注册（registerMemoryTicker）转发到 ./memory-ticker.ts。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { textBlocks } from "./memory-util.js";
import { registerMemoryTicker as registerTicker } from "./memory-ticker.js";
import { formatMemorySnapshotBody as _formatMemorySnapshot, } from "./compiled-snapshot.js";
function entryId(content) {
    return createHash("sha256").update(content).digest("hex").slice(0, 10);
}
/** 读置顶记忆索引（pinned-memory.json）；缺失/损坏时从 pinned.md 重建。 */
export function readPinnedEntries(paths) {
    try {
        const raw = JSON.parse(readFileSync(paths.pinnedIndex, "utf8"));
        if (Array.isArray(raw?.items)) {
            const entries = [];
            for (const item of raw.items) {
                if (typeof item?.content === "string" && item.content.trim()) {
                    entries.push({ id: typeof item.id === "string" ? item.id : entryId(item.content), content: item.content });
                }
            }
            return entries;
        }
    }
    catch {
        /* 回退到 md 重建 */
    }
    try {
        return readFileSync(paths.pinned, "utf8")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((content) => ({ id: entryId(content), content }));
    }
    catch {
        return [];
    }
}
function writePinnedFiles(paths, entries) {
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.pinned, entries.map((entry) => entry.content).join("\n") + (entries.length ? "\n" : ""), "utf8");
    writeFileSync(paths.pinnedIndex, JSON.stringify({ items: entries }, null, 2), "utf8");
}
/** 追加一条置顶记忆（内容去重）。 */
export function addPinnedEntry(paths, content) {
    const clean = String(content ?? "").trim();
    if (!clean)
        throw new Error("置顶记忆内容不能为空");
    const entries = readPinnedEntries(paths);
    if (entries.some((entry) => entry.content === clean))
        return { alreadyExists: true };
    writePinnedFiles(paths, [...entries, { id: entryId(clean), content: clean }]);
    return { alreadyExists: false };
}
/** 按 id 精确匹配或按内容关键词（包含）删除置顶记忆。 */
export function removePinnedEntry(paths, idOrKeyword) {
    const key = String(idOrKeyword ?? "").trim();
    if (!key)
        throw new Error("需要提供 id 或关键词");
    const entries = readPinnedEntries(paths);
    const remaining = entries.filter((entry) => entry.id !== key && entry.content !== key && !entry.content.includes(key));
    if (remaining.length === entries.length)
        return { removed: false, message: `没有找到匹配「${key}」的置顶记忆` };
    writePinnedFiles(paths, remaining);
    return { removed: true, message: `已移除 ${entries.length - remaining.length} 条置顶记忆` };
}
/** 置顶记忆渲染文本（systemPrompt variable）；空返回空串，渲染时该段自动消失。 */
export function formatPinned(paths) {
    const entries = readPinnedEntries(paths);
    if (entries.length === 0)
        return "";
    return `## 置顶记忆\n${entries.map((entry) => `- ${entry.content}`).join("\n")}`;
}
/* ------------------------------------------------------------------ */
/* 记忆快照（转发 compiled-snapshot.ts）                                */
/* ------------------------------------------------------------------ */
export { MEMORY_FILES, parseMemoryMd, readMemoryMd, normalizeCompiledSectionBody } from "./compiled-snapshot.js";
export { readMemorySectionBody as readMemorySection, writeCompiledMemorySnapshot as writeCompiledMemory, readCompiledMemorySnapshot as readCompiledMemory, } from "./compiled-snapshot.js";
/** 记忆快照渲染文本（systemPrompt variable）；空返回空串，渲染时该段自动消失。 */
export function formatMemorySnapshot(paths) {
    return _formatMemorySnapshot(paths);
}
const MAX_RECENT_CHARS = 20000;
/** 从会话事件里取最近对话文本（用户/助手消息，跳过插件注入消息）。 */
export function collectRecentConversation(agent, limit) {
    const lines = [];
    let count = 0;
    const events = agent.session.events;
    for (let index = events.length - 1; index >= 0 && count < limit; index -= 1) {
        const event = events[index];
        if (event.type === "user/message") {
            const data = event.data;
            if (data?.source?.kind === "plugin")
                continue;
            const text = textBlocks(data?.content);
            if (text) {
                lines.push(`用户：${text}`);
                count += 1;
            }
        }
        else if (event.type === "assistant/message") {
            const data = event.data;
            const text = textBlocks(data?.message?.content);
            if (text) {
                lines.push(`助手：${text}`);
                count += 1;
            }
        }
    }
    return lines.reverse().join("\n").slice(0, MAX_RECENT_CHARS);
}
/* ------------------------------------------------------------------ */
/* 编译输出解析（旧格式，保留兼容）                                      */
/* ------------------------------------------------------------------ */
const SECTION_RULES = [
    { key: "facts", headings: ["重要事实", "事实"] },
    { key: "today", headings: ["今天"] },
    { key: "week", headings: ["本周"] },
    { key: "longterm", headings: ["长期"] },
];
/**
 * 把 LLM 编译输出解析成四段记忆（旧格式兼容）。
 * 按 `## ` 二级标题切分，标题模糊匹配（包含关键字）；
 * 没有任何可识别段落时返回 null（调用方保留旧快照）。
 */
export function parseCompiledMemory(text) {
    const lines = String(text ?? "").split(/\r?\n/);
    const heads = [];
    lines.forEach((line, index) => {
        if (/^##\s+/.test(line))
            heads.push({ index, heading: line.replace(/^##\s+/, "").trim() });
    });
    if (heads.length === 0)
        return null;
    const result = {};
    let matched = 0;
    for (let i = 0; i < heads.length; i += 1) {
        const { index, heading } = heads[i];
        const end = i + 1 < heads.length ? heads[i + 1].index : lines.length;
        const body = lines.slice(index + 1, end).join("\n").trim();
        if (!body)
            continue;
        const rule = SECTION_RULES.find((candidate) => candidate.headings.some((candidateHeading) => heading.includes(candidateHeading)));
        if (!rule)
            continue;
        result[rule.key] = body;
        matched += 1;
    }
    return matched > 0 ? result : null;
}
/**
 * 注册记忆编译调度器（转发 memory-ticker.ts）：
 * 轮数触发（agent/pre-step）+ session 结束（agent/disposed）+ 每日任务（日期变化）。
 * 所有编译后台异步，不阻塞回合。
 */
export function registerMemoryTicker(ctx, config, paths, profileName) {
    registerTicker(ctx, config, paths, profileName);
}

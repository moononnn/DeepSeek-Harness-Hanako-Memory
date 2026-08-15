/**
 * 工具注册：置顶记忆（pin/unpin）+ 经验库（recall/record）。
 * defineTool 写法参照 dsh-tool-todo 实码：扁平参数 spec、输出 object 带 additionalProperties: false。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { addPinnedEntry, removePinnedEntry } from "./memory.js";
import { recallExperience, recordExperienceEntry } from "./experience.js";
const TEXT_OUTPUT = (message) => [{ type: "text", text: message }];
export function registerTools(ctx, config, paths) {
    if (config.memory.enabled) {
        ctx.tools.register(defineTool({
            name: "pin_memory",
            description: "让助手永远记住一件事（置顶记忆）。用户说「记住这个」「别忘了」「以后都这样」时调用。",
            parameters: {
                content: { type: "string", required: true, description: "要永远记住的内容" },
            },
            output: {
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        pinned: { type: "boolean", required: true },
                        message: { type: "string", required: true },
                    },
                },
                render: (_args, value) => TEXT_OUTPUT(value.message),
            },
            async execute(args) {
                const { alreadyExists } = addPinnedEntry(paths, args.content);
                return alreadyExists
                    ? { pinned: true, message: "已记住（之前记过，未重复添加）" }
                    : { pinned: true, message: "已记住。" };
            },
        }));
        ctx.tools.register(defineTool({
            name: "unpin_memory",
            description: "删除一条置顶记忆。用户说「不用记住了」「忘掉那个」时调用。提供 id（pin_memory 返回或 pinned 列表里的 id）或关键词（内容包含的关键词）。",
            parameters: {
                id: { type: "string", description: "置顶记忆的 id（精确匹配）" },
                keyword: { type: "string", description: "内容关键词（包含匹配）" },
            },
            output: {
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        removed: { type: "boolean", required: true },
                        message: { type: "string", required: true },
                    },
                },
                render: (_args, value) => TEXT_OUTPUT(value.message),
            },
            async execute(args) {
                const key = args.id ?? args.keyword;
                if (!key)
                    throw new Error("unpin_memory 需要提供 id 或 keyword 之一");
                const result = removePinnedEntry(paths, key);
                return { removed: result.removed, message: result.message };
            },
        }));
    }
    if (config.experience.enabled) {
        ctx.tools.register(defineTool({
            name: "recall_experience",
            description: "查看经验库。做具体任务前先查经验库：无参数返回全部经验的索引（分类名+条数+预览）；带 category 返回该分类全部条目。",
            parameters: {
                category: { type: "string", description: "经验分类名（2-4 词短语），可选" },
            },
            output: {
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        content: { type: "string", required: true },
                    },
                },
                render: (_args, value) => TEXT_OUTPUT(value.content),
            },
            async execute(args) {
                return { content: recallExperience(paths, args.category) };
            },
        }));
        ctx.tools.register(defineTool({
            name: "record_experience",
            description: "记录一条经验（踩过的坑、学到的教训）。做事踩坑后记录，下次同类任务先 recall_experience。",
            parameters: {
                category: {
                    type: "string",
                    required: true,
                    description: "经验分类名（2-4 词短语，如「tool usage」「prompt style」）",
                },
                content: { type: "string", required: true, description: "一句话教训" },
            },
            output: {
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        added: { type: "boolean", required: true },
                        message: { type: "string", required: true },
                    },
                },
                render: (_args, value) => TEXT_OUTPUT(value.message),
            },
            async execute(args) {
                const { added, message } = recordExperienceEntry(paths, args.category, args.content);
                return { added, message };
            },
        }));
    }
}

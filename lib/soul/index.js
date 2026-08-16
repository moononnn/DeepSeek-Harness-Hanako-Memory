/**
 * 小花记忆（dsh-assistant-soul 运行时，随 dsh-assistant-manager 单包分发）：
 * HanaAgent 式「助手人格 + 意识 + 记忆 + 经验」插件。
 *
 * 通过 preset + 配置组合出不同助手：每个 preset 挂一次本插件，
 * `profile` 字段保证各自独立的记忆库/经验库；`yuan` 选择四性格之一。
 *
 * 装配：4 个 systemPrompt section（identity 0 / consciousness 1 / memory 2 / experience 3）
 * + 动态 variable（名字、置顶记忆、记忆快照、经验索引）
 * + 4 个工具（pin/unpin/recall/record）
 * + 记忆调度器（轮数触发滚动摘要 + 每日任务分层编译 + Deep Memory，全部后台异步）。
 *
 * 记忆编译模型自适应（单包发布形态）：config.memory.model（可选）→ 全局默认模型
 * ctx.agentDefaultModel.currentSelection() → 都没有则编译任务跳过并记 warning，绝不崩。
 */
import z from "@deepseek-ai/schemastery";
import { YUAN_TEMPLATES } from "./yuan.js";
import { resolveProfileDir, resolveUserPaths } from "./paths.js";
import { buildIdentitySectionText, buildMemorySectionText, buildExperienceSectionText } from "./prompt.js";
import { formatPinned, formatMemorySnapshot, registerMemoryTicker } from "./memory.js";
import { readExperienceIndex } from "./experience.js";
import { readUserYaml, readUserProfile, resolveUserName } from "./user.js";
import { registerTools } from "./tools.js";
export const name = "assistant-soul";
export const inject = ["tools", "systemPrompt", "llm", "agentDefaultModel"];
export const Config = z.object({
    /** profile 目录名，唯一标识一个助手（决定记忆/经验数据目录）。 */
    profile: z.string().required(),
    /** 助手名字（{{assistantName}}）。 */
    name: z.string().required(),
    /** 用户称呼（yuan 模板里的 {{userName}} 占位）。 */
    userName: z.string().default("用户"),
    /** dshHome 覆盖；留空走默认解析（$DSH_HOME 环境变量 → ~/.dsh）。 */
    dshHome: z.string().default(""),
    /** 四性格：hanako（温柔理性）/ butter（活泼明快）/ ming（沉静内敛）/ kong（空灵中性）。 */
    yuan: z.union([z.const("hanako"), z.const("butter"), z.const("ming"), z.const("kong")]).default("hanako"),
    /** 关于ta：助手核心身份。 */
    identity: z.string().default(""),
    /** 人格定义：个性化设定。 */
    persona: z.string().default(""),
    memory: z.object({
        enabled: z.boolean().default(true),
        /** 每 N 轮对话触发一次滚动摘要 + compileToday。 */
        compileEvery: z.number().default(10),
        /** 编译时回溯的最近消息条数。 */
        recentMessages: z.number().default(20),
        /** 记忆编译专用模型（要便宜，绝不吃主对话模型）。可选：缺省由全局默认模型
            （agentDefaultModel.currentSelection()）接管；两者都解析不到时编译任务跳过并记 warning。 */
        model: z.object({
            provider: z.string().default(""),
            model: z.string().default(""),
        }).required(false),
        /** IANA 时区，用于逻辑日窗口（缺省用进程时区）。 */
        timeZone: z.string().default(""),
        /** 每日任务 Step5 深度记忆（写 facts.db）开关。 */
        deepMemory: z.boolean().default(true),
    }),
    experience: z.object({
        enabled: z.boolean().default(true),
    }),
});
/**
 * 记忆编译模型解析（自适应）：
 * 1. config.memory.model（preset 显式配置，兼容老预设）；
 * 2. ctx.agentDefaultModel.currentSelection()（dsh 全局默认模型，base 组合已挂载）；
 * 3. 都没有 → null（调用方跳过编译任务并记 warning，绝不崩）。
 */
function resolveMemoryModel(config, ctx) {
    const explicit = config.memory.model;
    if (explicit && explicit.provider && explicit.model) {
        return { provider: explicit.provider, model: explicit.model };
    }
    const selection = ctx.agentDefaultModel?.currentSelection?.();
    if (selection && selection.provider && selection.model) {
        return { provider: selection.provider, model: selection.model };
    }
    return null;
}
export function apply(ctx, config) {
    const paths = resolveProfileDir(config.dshHome, config.profile);
    const userPaths = resolveUserPaths(config.dshHome);
    const yuanText = YUAN_TEMPLATES[config.yuan] ?? "";
    const memoryModel = resolveMemoryModel(config, ctx);
    // userName 全局优先：user.yaml 的 name > 预设 config.userName（老预设兜底）> 「用户」
    const userName = resolveUserName(readUserYaml(userPaths).name, config.userName);
    /* ① 系统提示词 section（静态结构 + {{变量}} 占位） */
    // 用户档案 section（「我」页面）：order -50，卡在 harness:identity(-100) 之后、
    // 助手身份 identity(0)/意识 consciousness(1) 之前，与 Hana「user.md → identity → ishiki」顺序语义一致。
    // text 是 provider：档案为空返回空串 → 渲染时空段整体消失（不留「# 关于用户」空标题）；
    // section 始终注册、不依赖文件存在（dsh 渲染时逐段求值）。
    ctx.systemPrompt.section({
        name: "assistant:user",
        order: -50,
        text: () => {
            const profile = readUserProfile(userPaths);
            return profile ? `# 关于用户\n${profile}` : "";
        },
    });
    ctx.systemPrompt.section({
        name: "assistant:identity",
        order: 0,
        text: buildIdentitySectionText(config),
    });
    if (yuanText) {
        ctx.systemPrompt.section({
            name: "assistant:consciousness",
            order: 1,
            text: yuanText,
        });
    }
    if (config.memory.enabled) {
        ctx.systemPrompt.section({
            name: "assistant:memory",
            order: 2,
            text: buildMemorySectionText(),
        });
    }
    if (config.experience.enabled) {
        ctx.systemPrompt.section({
            name: "assistant:experience",
            order: 3,
            text: buildExperienceSectionText(),
        });
    }
    /* ② 动态变量（每次装配求值；返回空串则对应段自动消失）
       dsh 变量名规范：/^[a-z][a-z0-9_]*$/，必须全小写下划线 */
    ctx.systemPrompt.variable("assistant_name", () => config.name);
    ctx.systemPrompt.variable("user_profile", () => readUserProfile(userPaths));
    if (yuanText) {
        ctx.systemPrompt.variable("user_name", () => userName);
    }
    if (config.memory.enabled) {
        ctx.systemPrompt.variable("pinned_memory", () => formatPinned(paths));
        ctx.systemPrompt.variable("memory_snapshot", () => formatMemorySnapshot(paths));
    }
    if (config.experience.enabled) {
        ctx.systemPrompt.variable("experience_index", () => readExperienceIndex(paths));
    }
    /* ③ 工具（按开关） */
    registerTools(ctx, config, paths);
    /* ④ 记忆调度器（轮数触发滚动摘要 + 每日任务分层编译 + Deep Memory，不阻塞回合） */
    if (config.memory.enabled) {
        if (memoryModel) {
            registerMemoryTicker(ctx, {
                ...config.memory,
                model: memoryModel,
                timeZone: config.memory.timeZone || undefined,
            }, paths, config.name);
        }
        else {
            // 自适应失败：跳过编译任务并记 warning，绝不崩（置顶/快照等只读功能不受影响）
            ctx.logger.warn("[assistant-soul] 记忆编译模型未配置（memory.model 或全局默认模型 agentDefaultModel 均不可用），记忆编译任务已跳过");
        }
    }
}

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
import type { Context } from "@deepseek-ai/cordis";
import type { YuanKey } from "./yuan.js";
/** dsh-agent-default-model 服务最小形状（base 组合已挂载，与 manager http.ts 同款姿势）。 */
interface AgentDefaultModelLike {
    currentSelection(): {
        provider: string;
        model: string;
        reasoningEffort?: string;
    };
}
declare module "@deepseek-ai/cordis" {
    interface Context {
        agentDefaultModel?: AgentDefaultModelLike;
    }
}
export declare const name = "assistant-soul";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<{
    /** profile 目录名，唯一标识一个助手（决定记忆/经验数据目录）。 */
    profile: z<string, string>;
    /** 助手名字（{{assistantName}}）。 */
    name: z<string, string>;
    /** 用户称呼（yuan 模板里的 {{userName}} 占位）。 */
    userName: z<string, string>;
    /** dshHome 覆盖；留空走默认解析（$DSH_HOME 环境变量 → ~/.dsh）。 */
    dshHome: z<string, string>;
    /** 四性格：hanako（温柔理性）/ butter（活泼明快）/ ming（沉静内敛）/ kong（空灵中性）。 */
    yuan: z<"hanako" | "butter" | "ming" | "kong", "hanako" | "butter" | "ming" | "kong">;
    /** 关于ta：助手核心身份。 */
    identity: z<string, string>;
    /** 人格定义：个性化设定。 */
    persona: z<string, string>;
    memory: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        /** 每 N 轮对话触发一次滚动摘要 + compileToday。 */
        compileEvery: z<number, number>;
        /** 编译时回溯的最近消息条数。 */
        recentMessages: z<number, number>;
        /** 记忆编译专用模型（要便宜，绝不吃主对话模型）。可选：缺省由全局默认模型
            （agentDefaultModel.currentSelection()）接管；两者都解析不到时编译任务跳过并记 warning。 */
        model: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
        }>>;
        /** IANA 时区，用于逻辑日窗口（缺省用进程时区）。 */
        timeZone: z<string, string>;
        /** 每日任务 Step5 深度记忆（写 facts.db）开关。 */
        deepMemory: z<boolean, boolean>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        /** 每 N 轮对话触发一次滚动摘要 + compileToday。 */
        compileEvery: z<number, number>;
        /** 编译时回溯的最近消息条数。 */
        recentMessages: z<number, number>;
        /** 记忆编译专用模型（要便宜，绝不吃主对话模型）。可选：缺省由全局默认模型
            （agentDefaultModel.currentSelection()）接管；两者都解析不到时编译任务跳过并记 warning。 */
        model: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
        }>>;
        /** IANA 时区，用于逻辑日窗口（缺省用进程时区）。 */
        timeZone: z<string, string>;
        /** 每日任务 Step5 深度记忆（写 facts.db）开关。 */
        deepMemory: z<boolean, boolean>;
    }>>;
    experience: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
    }>>;
    /** 拟人工具卡：工具调用标题渲染成「{助手名} 动作短语」（Hana 风格）。 */
    toolTalk: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    /** profile 目录名，唯一标识一个助手（决定记忆/经验数据目录）。 */
    profile: z<string, string>;
    /** 助手名字（{{assistantName}}）。 */
    name: z<string, string>;
    /** 用户称呼（yuan 模板里的 {{userName}} 占位）。 */
    userName: z<string, string>;
    /** dshHome 覆盖；留空走默认解析（$DSH_HOME 环境变量 → ~/.dsh）。 */
    dshHome: z<string, string>;
    /** 四性格：hanako（温柔理性）/ butter（活泼明快）/ ming（沉静内敛）/ kong（空灵中性）。 */
    yuan: z<"hanako" | "butter" | "ming" | "kong", "hanako" | "butter" | "ming" | "kong">;
    /** 关于ta：助手核心身份。 */
    identity: z<string, string>;
    /** 人格定义：个性化设定。 */
    persona: z<string, string>;
    memory: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        /** 每 N 轮对话触发一次滚动摘要 + compileToday。 */
        compileEvery: z<number, number>;
        /** 编译时回溯的最近消息条数。 */
        recentMessages: z<number, number>;
        /** 记忆编译专用模型（要便宜，绝不吃主对话模型）。可选：缺省由全局默认模型
            （agentDefaultModel.currentSelection()）接管；两者都解析不到时编译任务跳过并记 warning。 */
        model: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
        }>>;
        /** IANA 时区，用于逻辑日窗口（缺省用进程时区）。 */
        timeZone: z<string, string>;
        /** 每日任务 Step5 深度记忆（写 facts.db）开关。 */
        deepMemory: z<boolean, boolean>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        /** 每 N 轮对话触发一次滚动摘要 + compileToday。 */
        compileEvery: z<number, number>;
        /** 编译时回溯的最近消息条数。 */
        recentMessages: z<number, number>;
        /** 记忆编译专用模型（要便宜，绝不吃主对话模型）。可选：缺省由全局默认模型
            （agentDefaultModel.currentSelection()）接管；两者都解析不到时编译任务跳过并记 warning。 */
        model: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
        }>>;
        /** IANA 时区，用于逻辑日窗口（缺省用进程时区）。 */
        timeZone: z<string, string>;
        /** 每日任务 Step5 深度记忆（写 facts.db）开关。 */
        deepMemory: z<boolean, boolean>;
    }>>;
    experience: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
    }>>;
    /** 拟人工具卡：工具调用标题渲染成「{助手名} 动作短语」（Hana 风格）。 */
    toolTalk: z<boolean, boolean>;
}>>;
export type SoulConfig = {
    profile: string;
    name: string;
    userName: string;
    dshHome: string;
    yuan: YuanKey;
    identity: string;
    persona: string;
    memory: {
        enabled: boolean;
        compileEvery: number;
        recentMessages: number;
        model?: {
            provider: string;
            model: string;
        };
        timeZone: string;
        deepMemory: boolean;
    };
    experience: {
        enabled: boolean;
    };
    toolTalk: boolean;
};
export declare function apply(ctx: Context, config: SoulConfig): void;
export {};

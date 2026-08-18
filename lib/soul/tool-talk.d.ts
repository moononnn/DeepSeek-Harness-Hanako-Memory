/**
 * 拟人工具卡（Hana 风格工具标题）。
 *
 * preset 装配时给常用工具注册「话痨 presenter」：工具卡渲染成
 * 「{助手名} 动作短语」三态（进行中 / 完成 / 失败），灵感来自 Hana
 * 前端的工具标题映射（"小花 正在翻阅档案" / "小红 改好了" 这种）。
 *
 * 关键设计（混合渲染）：
 * - terminal 卡（bash/pwsh）：命令本身保留为标题，拟人句放 description
 *   （渲染在卡上方），不丢命令；
 * - diff 卡（write/edit）：标题换成拟人句，diff 内容原样保留；
 * - generic 卡（read 等）：标题换成拟人句，kind / locations 原样保留。
 *
 * 实现方式：拿全局工具定义 → spread 复制 → 只覆盖 presentCall /
 * presentResult（包装原 presenter）→ 注册回调用 agent 的 scope 层。
 * 注册进 preset 层即对加入该 preset 的每个 agent 会话生效（近者遮蔽远者），
 * 执行逻辑与 schema 完全不动。
 */
import type { Context } from "@deepseek-ai/cordis";
export interface ToolTalkPhrases {
    running: string;
    done: string;
    failed: string;
}
/**
 * 工具 → 三态短语表。风格对齐 Hana：每个动词都带人味儿，
 * 失败态不冷冰冰（"没翻到" "电脑没听话" 这种）。
 */
export declare const TALK_TABLE: Record<string, ToolTalkPhrases>;
/**
 * 在调用 agent 的 scope 层给 TALK_TABLE 里的工具注册拟人 presenter。
 * 只覆盖展示（presentCall / presentResult），执行与 schema 原样保留。
 * - 首次调用：给当时已注册的工具全部包装；
 * - 订阅 tools/change：晚注册的工具（preset 顺序不定）出现时补挂；
 * - 已包装（带 TALK_MARK）的工具跳过，重复触发不重复包装。
 */
export declare function registerToolTalk(ctx: Context, opts: {
    name: string;
    enabled: boolean;
}): () => void;

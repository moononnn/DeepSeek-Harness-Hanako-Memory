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
import type { DiffCallView, GenericCallView, TerminalCallView, ToolCallView, ToolResultView, ToolResult, ToolDefinition } from "@deepseek-ai/dsh-tools";

export interface ToolTalkPhrases {
  running: string;
  done: string;
  failed: string;
}

/** 助手名占位符（装配时替换）。 */
const NAME_PLACEHOLDER = "{name}";

/**
 * 工具 → 三态短语表。风格对齐 Hana：每个动词都带人味儿，
 * 失败态不冷冰冰（"没翻到" "电脑没听话" 这种）。
 */
export const TALK_TABLE: Record<string, ToolTalkPhrases> = {
  bash: {
    running: "💻 {name} 正在小心翼翼地用你的电脑",
    done: "💻 {name} 用完电脑了",
    failed: "💻 {name} 电脑没听话",
  },
  pwsh: {
    running: "💻 {name} 正在敲 PowerShell",
    done: "💻 {name} 敲完了",
    failed: "💻 {name} 命令行闹脾气了",
  },
  read: {
    running: "📖 {name} 正在翻阅档案",
    done: "📖 {name} 翻完了",
    failed: "📖 {name} 没翻到",
  },
  read_image: {
    running: "🖼️ {name} 正在看图片",
    done: "🖼️ {name} 看清了",
    failed: "🖼️ {name} 图打不开",
  },
  write: {
    running: "✏️ {name} 提笔写字中",
    done: "✏️ {name} 落笔了",
    failed: "✏️ {name} 笔没墨了",
  },
  edit: {
    running: "✏️ {name} 提笔改字中",
    done: "✏️ {name} 改好了",
    failed: "✏️ {name} 越改越乱了",
  },
  grep: {
    running: "🔍 {name} 正在档案里翻找",
    done: "🔍 {name} 翻到了",
    failed: "🔍 {name} 翻了个遍，没有",
  },
  glob: {
    running: "🔍 {name} 正在找档案",
    done: "🔍 {name} 找到了",
    failed: "🔍 {name} 翻遍了也没找到",
  },
  web_search: {
    running: "🌐 {name} 正在网络上冲浪",
    done: "🌐 {name} 冲浪回来了",
    failed: "🌐 {name} 没冲到浪",
  },
  web_fetch: {
    running: "📄 {name} 正在看网页",
    done: "📄 {name} 了然于心",
    failed: "📄 {name} 上网失败",
  },
  str_replace_editor: {
    running: "✂️ {name} 正在裁剪文字",
    done: "✂️ {name} 剪好了",
    failed: "✂️ {name} 剪歪了",
  },
  todo_write: {
    running: "📝 {name} 正在记待办",
    done: "📝 {name} 记下了",
    failed: "📝 {name} 笔打滑了",
  },
  skill: {
    running: "🧭 {name} 正在翻技能手册",
    done: "🧭 {name} 翻到诀窍了",
    failed: "🧭 {name} 手册里没这本",
  },
  ask_user_question: {
    running: "🙋 {name} 有件事想问你",
    done: "🙋 {name} 收到你的答复了",
    failed: "🙋 {name} 没等到你的答复",
  },
  job_list: {
    running: "📋 {name} 正在翻任务清单",
    done: "📋 {name} 清点完了",
    failed: "📋 {name} 清单不见了",
  },
  job_output: {
    running: "🖥️ {name} 正在看任务输出",
    done: "🖥️ {name} 看完了",
    failed: "🖥️ {name} 输出丢了",
  },
  job_kill: {
    running: "🛑 {name} 正在叫停任务",
    done: "🛑 {name} 停下来了",
    failed: "🛑 {name} 没拦住",
  },
  create_goal: {
    running: "🎯 {name} 正在立小目标",
    done: "🎯 {name} 目标立好了",
    failed: "🎯 {name} 目标立歪了",
  },
  get_goal: {
    running: "🎯 {name} 正在看进度",
    done: "🎯 {name} 进度看清了",
    failed: "🎯 {name} 没找到目标",
  },
  update_goal: {
    running: "🎯 {name} 正在更新进度",
    done: "🎯 {name} 进度更新了",
    failed: "🎯 {name} 更新失败了",
  },
  ralph: {
    running: "🛠️ {name} 正在捣鼓东西",
    done: "🛠️ {name} 捣鼓完了",
    failed: "🛠️ {name} 捣鼓不动",
  },
  "ralph-loop": {
    running: "🛠️ {name} 正在来回调",
    done: "🛠️ {name} 调顺了",
    failed: "🛠️ {name} 卡在死循环了",
  },
  report: {
    running: "📄 {name} 正在写报告",
    done: "📄 {name} 报告写好了",
    failed: "📄 {name} 报告写砸了",
  },
  send_message: {
    running: "📨 {name} 正在捎话",
    done: "📨 {name} 话带到了",
    failed: "📨 {name} 话没捎到",
  },
  interrupt_agent: {
    running: "🛎️ {name} 正在打断同事",
    done: "🛎️ {name} 打断了",
    failed: "🛎️ {name} 没打断成",
  },
  // —— dsh 小花实际在用的工具（表情包 / 记忆 / 视觉） ——
  search_stickers: {
    running: "🎭 {name} 正在翻表情包",
    done: "🎭 {name} 翻到对味的了",
    failed: "🎭 {name} 没找到合适的",
  },
  list_stickers: {
    running: "🎭 {name} 正在清点表情包",
    done: "🎭 {name} 清点完了",
    failed: "🎭 {name} 表情包库打不开",
  },
  express: {
    running: "🎭 {name} 情绪上头了",
    done: "🎭 {name} 表情包发出去了",
    failed: "🎭 {name} 表情包卡住了",
  },
  report_bad_match: {
    running: "🗳️ {name} 正在给小表情打分",
    done: "🗳️ {name} 记下了",
    failed: "🗳️ {name} 打分卡壳了",
  },
  update_sticker_tags: {
    running: "🏷️ {name} 正在给表情包换标签",
    done: "🏷️ {name} 标签换好了",
    failed: "🏷️ {name} 标签贴歪了",
  },
  pin_memory: {
    running: "📌 {name} 正在把重要的事钉起来",
    done: "📌 {name} 钉好了",
    failed: "📌 {name} 图钉掉了",
  },
  unpin_memory: {
    running: "📌 {name} 正在取下钉子",
    done: "📌 {name} 取下来了",
    failed: "📌 {name} 钉子拔不动",
  },
  recall_experience: {
    running: "💭 {name} 正在翻经验账本",
    done: "💭 {name} 想起来了",
    failed: "💭 {name} 账本没这页",
  },
  record_experience: {
    running: "📓 {name} 正在记一笔经验",
    done: "📓 {name} 记下了",
    failed: "📓 {name} 笔没水了",
  },
  vision_toolkit_activate: {
    running: "👁️ {name} 正在睁大眼睛",
    done: "👁️ {name} 看清了",
    failed: "👁️ {name} 眼睛花了",
  },
  vision_glance: {
    running: "👁️ {name} 正在瞄一眼画面",
    done: "👁️ {name} 看清楚了",
    failed: "👁️ {name} 画面太糊",
  },
  vision_ground: {
    running: "📐 {name} 正在测量位置",
    done: "📐 {name} 量好了",
    failed: "📐 {name} 量歪了",
  },
  vision_detect: {
    running: "🔎 {name} 正在找目标",
    done: "🔎 {name} 找到了",
    failed: "🔎 {name} 没找到",
  },
  vision_crop: {
    running: "✂️ {name} 正在裁剪画面",
    done: "✂️ {name} 剪好了",
    failed: "✂️ {name} 剪坏了",
  },
  vision_trace: {
    running: "🖊️ {name} 正在描轮廓",
    done: "🖊️ {name} 描好了",
    failed: "🖊️ {name} 笔尖断了",
  },
  vision_pixel_diff: {
    running: "🧮 {name} 正在比对像素",
    done: "🧮 {name} 比对完了",
    failed: "🧮 {name} 像素不听话",
  },
  vision_long_screenshot_ocr: {
    running: "📃 {name} 正在读长图",
    done: "📃 {name} 读完了",
    failed: "📃 {name} 长图糊了",
  },
  vision_extract_foreground: {
    running: "🖼️ {name} 正在抠图",
    done: "🖼️ {name} 抠出来了",
    failed: "🖼️ {name} 图抠破了",
  },
  vision_dominant_colors: {
    running: "🎨 {name} 正在看配色",
    done: "🎨 {name} 看清了",
    failed: "🎨 {name} 色盲了",
  },
  vision_html_screenshot: {
    running: "🖥️ {name} 正在给页面拍照",
    done: "🖥️ {name} 拍好了",
    failed: "🖥️ {name} 相机坏了",
  },
};

type AnyView = GenericCallView | TerminalCallView | DiffCallView | ToolResultView;

/**
 * call 态拟人句挂载：terminal 卡命令保留为标题，拟人句放 description
 * （渲染在终端卡上方）；其余卡直接替换 title。
 */
function relabelCall(view: ToolCallView, phrase: string): ToolCallView {
  if (view.card === "terminal") {
    return { ...view, description: phrase };
  }
  return { ...view, title: phrase };
}

/** result 态拟人句挂载：一律替换 title（terminal 结果卡标题换掉，output 仍完整保留）。 */
function relabelResult(view: ToolResultView, phrase: string): ToolResultView {
  return { ...view, title: phrase };
}

/** 幂等保护：同一个 agent ctx 只注册一次事件监听（dsh 按 preset 常驻挂载 + 可能的 HMR 重挂载）。
 * 注意：挂载分「初始」和「补偿」两段。预设里工具（如新增的 tool-pwsh）可能比 soul 晚注册，
 * 所以订阅 tools/change，工具表变化时补挂还没挂过的工具。
 *
 * 2026-08-17 崩溃修复：dsh 的 scope 层叠语义下，ctx.tools.get 可能永远看不到我们自己
 * register 的包装版（返回原始 def），导致定时补偿反复对同名工具 register →
 * “already registered in this scope” 未捕获异常 → node 进程崩溃。
 * 因此用插件侧 registered Set 记已包装名字防重，不再依赖 def 上的 TALK_MARK 可见性；
 * patch 整体 try/catch，任何异常只记日志不崩进程。 */
const installedCtx = new WeakSet<Context>();

/** 包装过的工具定义上的标记，作为第二道防线（get 可见时防重）。 */
const TALK_MARK = "__toolTalk";

interface TalkableDefinition {
  [TALK_MARK]?: boolean;
  presentCall?: ((args: unknown) => ToolCallView | undefined) | undefined;
  presentResult?: ((args: unknown, result: ToolResult) => ToolResultView | undefined) | undefined;
}

/**
 * 在调用 agent 的 scope 层给 TALK_TABLE 里的工具注册拟人 presenter。
 * 只覆盖展示（presentCall / presentResult），执行与 schema 原样保留。
 * - 首次调用：给当时已注册的工具全部包装；
 * - 订阅 tools/change：晚注册的工具（preset 顺序不定）出现时补挂；
 * - 已包装（带 TALK_MARK）的工具跳过，重复触发不重复包装。
 */
export function registerToolTalk(ctx: Context, opts: { name: string; enabled: boolean }): () => void {
  if (!opts.enabled) return () => {};
  // 极简/测试 ctx 可能没有 tools.get（如冒烟 mock），退化安全：直接不装。
  // 注意：不要解构 get 再调用——ToolRuntime.get 依赖 this（内部 this.view），
  // 解构会丢绑定导致 TypeError。
  if (!ctx.tools || typeof ctx.tools.get !== "function") return () => {};
  if (installedCtx.has(ctx)) return () => {};
  installedCtx.add(ctx);

  const fill = (tpl: string) => tpl.replaceAll(NAME_PLACEHOLDER, opts.name);

  /** 已包装的工具名集合：dsh scope 层叠下 get 可能看不到包装版，必须由插件侧记录防重。 */
  const registered = new Set<string>();
  // presenter 最终按 Agent 对象解析工具；把包装安装到 agent.ctx，
  // 并用 ctx.agent 作为 scope，避免静态 bundle 自带的 dsh-scope 副本
  // 与宿主 dsh-scope 副本不一致时读不到作用域标签。
  const scope = (ctx as Context & { agent?: object }).agent;

  const patch = () => {
    try {
      for (const [toolName, phrases] of Object.entries(TALK_TABLE)) {
        if (registered.has(toolName)) continue;
        const def = ctx.tools.get(toolName, scope) as (TalkableDefinition & Record<string, unknown>) | undefined;
        if (!def || def[TALK_MARK]) continue;

        const origCall = def.presentCall;
        const origResult = def.presentResult;

        ctx.tools.register({
          ...def,
          [TALK_MARK]: true,
          presentCall: (args: unknown) => {
            const phrase = fill(phrases.running);
            const view = origCall ? origCall(args) : undefined;
            return view ? relabelCall(view as ToolCallView, phrase) : { card: "generic", title: phrase };
          },
          presentResult: (args: unknown, result: ToolResult) => {
            const phrase = fill(result.isError ? phrases.failed : phrases.done);
            const view = origResult ? origResult(args, result) : undefined;
            return view ? relabelResult(view as ToolResultView, phrase) : { card: "generic", title: phrase };
          },
        } as unknown as ToolDefinition);
        registered.add(toolName);
      }
    } catch (err) {
      // 补偿挂载绝不能崩 agent 进程：任何异常只吞掉记日志（dsh 无全局日志时 console）。
      console.warn("[tool-talk] patch failed:", err);
    }
  };

  patch();
  // tools/change 由 dsh-tools 在宿主 root ctx 上 emit（ScopedLayers 变更回调）；
  // agent 会话可能运行在独立 root，跨 root 事件不可达，所以这里双保险：
  // 1) 尽量挂 root 监听（同 root 时有效）；2) 有限次定时补偿（跨 root 时兜底）。
  const root = (ctx as Context & { root?: Context }).root ?? ctx;
  if (typeof root.on === "function") {
    root.on("tools/change", patch);
  }
  let remaining = 30;
  const timer = setInterval(() => {
    patch();
    if (--remaining <= 0) clearInterval(timer);
  }, 1000);
  // 防止定时器悬挂：ctx 销毁时清理（cordis ctx 有 onDispose/ dispose 语义）
  const dispose = root as Context & { onDispose?: (fn: () => void) => void };
  if (typeof dispose.onDispose === "function") {
    dispose.onDispose(() => clearInterval(timer));
  }
  return () => clearInterval(timer);
}

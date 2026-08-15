/**
 * 冒烟测试（不依赖宿主进程）：mock ctx → apply 插件 → 验证
 * 1. section 注册（名字/order）
 * 2. 变量求值与渲染（空记忆段消失、{{assistantName}} 替换）
 * 3. 工具注册 + pin_memory 执行
 * 4. 记忆调度器（模拟 agent/pre-step 两次 → 滚动摘要 + compileToday → summaries/ + today.md 落盘）
 */
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { apply, Config } from "../../lib/soul/index.js";

const dshHome = mkdtempSync(join(tmpdir(), "soul-smoke-"));
const config = Config({
  profile: "smoke-xiaohua",
  name: "小花",
  userName: "用户",
  dshHome,
  yuan: "hanako",
  identity: "小花的身份描述。",
  persona: "小花的性格设定。",
  memory: {
    enabled: true,
    compileEvery: 2,
    recentMessages: 10,
    model: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    timeZone: "UTC",
    deepMemory: false,
  },
  experience: { enabled: true },
});

const sections = [];
const variables = new Map();
const tools = [];
const listeners = new Map();

/** mock session：events 事件溯源 + deriveMessages 派生（滚动摘要输入）。 */
function makeSession(events) {
  const messages = [];
  for (const event of events) {
    if (event.type === "user/message") {
      messages.push({ id: event.data?.id ?? `u${messages.length}`, role: "user", content: event.data?.content ?? [], source: event.data?.source ?? { kind: "user" }, time: event.time });
    } else if (event.type === "assistant/message") {
      messages.push({ id: event.data?.message?.id ?? `a${messages.length}`, role: "assistant", content: event.data?.message?.content ?? [], source: { kind: "model", provider: "x", model: "y" }, time: event.time });
    }
  }
  return {
    id: "smoke-session",
    events,
    deriveMessages() {
      return messages.map((m) => ({ id: m.id, role: m.role, content: m.content, source: m.source }));
    },
  };
}

const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  on(name, listener) {
    listeners.set(name, listener);
  },
  effect() {},
  systemPrompt: {
    section(sec) { sections.push(sec); },
    variable(name, provider) { variables.set(name, provider); },
  },
  tools: { register(def) { tools.push(def); } },
  llm: {
    stream(opts) {
      // 按 system 内容区分返回：滚动摘要 → 两节格式；compileToday → 近况正文
      const system = opts.system ?? "";
      let text = "输出";
      if (system.includes("格式修复器") || system.includes("滚动摘要") || system.includes("reviewing a conversation")) {
        text = "### 重要事实\n- 用户喜欢冒烟测试\n\n### 事情经过\n- 2026-06-11 10:00 跑通了记忆编译";
      } else if (system.includes("用户近况")) {
        text = "今天用户聊了冒烟测试，跑通了记忆编译";
      }
      return (async function* () {
        yield { type: "text-delta", index: 0, text };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  },
};

apply(ctx, config);

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed += 1;
};

/* 1. section 注册 */
const names = sections.map((s) => s.name);
check("4 个 section", names.length === 4, names.join(","));
check("order 0 identity", sections[0].order === 0 && sections[0].name === "assistant:identity");
check("order 1 consciousness", sections[1].order === 1 && sections[1].name === "assistant:consciousness");
check("order 2 memory", sections[2].order === 2 && sections[2].name === "assistant:memory");
check("order 3 experience", sections[3].order === 3 && sections[3].name === "assistant:experience");

/* 2. 变量求值 + 渲染（空记忆 → 段消失） */
const assembly = {
  sections: sections.map((s) => ({ name: s.name, order: s.order, text: s.text })),
  tools: [],
  variables: Object.fromEntries([...variables].map(([k, fn]) => [k, fn()])),
};
const rendered = renderPrompt(assembly);
check("渲染含「你是 小花。」", rendered.includes("你是 小花。"));
check("渲染含身份/人格", rendered.includes("小花的身份描述") && rendered.includes("小花的性格设定"));
check("渲染含 MOOD 意识块", rendered.includes("## MOOD") && rendered.includes("<mood>"));
check("空记忆时无「置顶记忆」段", !rendered.includes("## 置顶记忆"));
check("空记忆时无「记忆快照」段", !rendered.includes("## 记忆快照"));
check("空经验时无经验索引内容", !rendered.includes("## 经验库\n做具体任务前先查经验库（recall_experience）。\n\n# "));

/* 3. 工具注册 + pin_memory 执行 */
const toolNames = tools.map((t) => t.name).sort();
check("4 个工具", toolNames.length === 4, toolNames.join(","));
const pin = tools.find((t) => t.name === "pin_memory");
const pinResult = await pin.execute({ content: "用户喜欢四川话" });
check("pin_memory 执行成功", pinResult.pinned === true, pinResult.message);

// 重新渲染：置顶记忆应出现
const assembly2 = {
  sections: sections.map((s) => ({ name: s.name, order: s.order, text: s.text })),
  tools: [],
  variables: Object.fromEntries([...variables].map(([k, fn]) => [k, fn()])),
};
const rendered2 = renderPrompt(assembly2);
check("置顶后出现「置顶记忆」段", rendered2.includes("## 置顶记忆") && rendered2.includes("- 用户喜欢四川话"));

/* 4. 记忆调度器（compileEvery=2：两次 pre-step 触发滚动摘要 + compileToday） */
const events = [
  { type: "user/message", time: Date.UTC(2026, 5, 11, 6), data: { id: "m1", content: [{ type: "text", text: "冒烟对话内容" }], source: { kind: "user" } } },
  { type: "assistant/message", time: Date.UTC(2026, 5, 11, 6), data: { turn: 1, step: 0, message: { id: "m2", content: [{ type: "text", text: "冒烟回复" }] } } },
];
const session = makeSession(events);
const preStep = listeners.get("agent/pre-step");
check("agent/pre-step 监听已注册", typeof preStep === "function");
preStep({ agent: { session }, turn: 1, step: 0, signal: undefined }, () => {});
preStep({ agent: { session }, turn: 2, step: 0, signal: undefined }, () => {});
await new Promise((resolve) => setTimeout(resolve, 800));

const memoryDir = join(dshHome, "assistant-soul", "smoke-xiaohua", "memory");
const summaryMd = join(memoryDir, "summaries", "smoke-session.md");
const todayFile = join(memoryDir, "today.md");
const memoryMdFile = join(memoryDir, "memory.md");
check("summaries/smoke-session.md 已生成（滚动摘要）", existsSync(summaryMd), summaryMd);
if (existsSync(summaryMd)) {
  const summaryText = readFileSync(summaryMd, "utf8");
  check("摘要含「### 重要事实」", summaryText.includes("### 重要事实"));
  check("摘要含「### 事情经过」", summaryText.includes("### 事情经过"));
  check("摘要含冒烟内容", summaryText.includes("冒烟测试") || summaryText.includes("记忆编译"));
}
check("today.md 已写入（compileToday 近况）", existsSync(todayFile) && readFileSync(todayFile, "utf8").includes("记忆编译"), existsSync(todayFile) ? readFileSync(todayFile, "utf8").trim() : "missing");
check("memory.md 已组装（assemble）", existsSync(memoryMdFile) && readFileSync(memoryMdFile, "utf8").includes("## 今天"), existsSync(memoryMdFile) ? "assembled" : "missing");

console.log(failed === 0 ? "\n冒烟全部通过 ✓" : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);

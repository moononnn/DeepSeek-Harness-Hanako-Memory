/**
 * 拟人工具卡（tool-talk）单测：
 * - 开关关闭时不注册任何东西
 * - 只给 TALK_TABLE 里存在且全局已注册的工具注册
 * - 拟人短语替换 {name} 占位符；三条短语齐全
 * - 混合渲染：terminal 卡改 description、其余卡改 title，非标题字段原样保留
 * - result 态按 isError 区分 done / failed 短语
 * - 原 presenter 缺失时兜底 generic 拟人卡
 * - 原 execute / schema 原样保留（同引用）
 * - 同 ctx 幂等（只注册一次）
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerToolTalk, TALK_TABLE } from "../../lib/soul/tool-talk.js";

/** 包装 registerToolTalk：收集 dispose，after 统一清理（防定时器悬挂测试进程）。 */
const disposers = [];
after(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function reg(ctx, opts) {
  const dispose = registerToolTalk(ctx, opts);
  disposers.push(dispose);
  return dispose;
}

/** 最小工具定义（带可选原生 presenter）。 */
function mkDef(name, presentCall, presentResult, executeMarker = `execute-${name}`) {
  return {
    name,
    schema: { type: "object" },
    output: { schema: {}, render: () => "" },
    execute: () => executeMarker,
    ...(presentCall === undefined ? {} : { presentCall }),
    ...(presentResult === undefined ? {} : { presentResult }),
  };
}

/** mock ctx：defs 按工具名提供 get 目标，register 统一收集，on 收集 tools/change 回调。
 * get 写成依赖 this 的普通方法（模拟真实 ToolRuntime.get 内部 this.view），
 * 防回归：插件实现若解构 get 会丢绑定。
 * opts.opaqueGet=true 时 register 不更新 _defs（模拟真实 dsh scope 层叠：get 看不到包装版）。 */
function makeCtx(defs, opts = {}) {
  const registered = [];
  const listeners = {};
  const ctx = {
    tools: {
      _defs: defs,
      get(name) {
        // 故意依赖 this，模拟 ToolRuntime.get 内部 this.view()
        return this._defs[name];
      },
      register(def) {
        registered.push(def);
        // 模拟 dsh 工具层叠语义：注册后 get 应返回新 def（包装版带 __toolTalk 标记），
        // 否则 tools/change 补挂会反复包装同一个工具。
        if (!opts.opaqueGet) this._defs[def.name] = def;
      },
    },
    on(event, fn) {
      (listeners[event] ||= []).push(fn);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
      };
    },
    _emit(event) {
      for (const fn of listeners[event] || []) fn();
    },
  };
  return {
    ctx,
    registered,
    emitToolsChange() {
      ctx._emit("tools/change");
    },
  };
}

test("开关关闭时不注册任何东西", () => {
  const { ctx } = makeCtx({ bash: mkDef("bash") });
  reg(ctx, { name: "小花", enabled: false });
});

test("同 ctx 重复调用幂等：只注册一次", () => {
  const { ctx, registered } = makeCtx({ bash: mkDef("bash"), read: mkDef("read") });
  reg(ctx, { name: "小花", enabled: true });
  reg(ctx, { name: "小花", enabled: true });
  assert.equal(registered.length, 2, "只应注册 TALK_TABLE 里命中的 2 个工具一次");
});

test("只注册 TALK_TABLE 且全局存在的工具，未注册的跳过", () => {
  const { ctx, registered } = makeCtx({ bash: mkDef("bash") });
  reg(ctx, { name: "小花", enabled: true });
  // 只有 bash 在 defs 里；read 等全局不存在 → 跳过
  assert.deepEqual(registered.map((d) => d.name), ["bash"]);
});

test("当前助手 scope 内的工具也能被 presenter 接管", () => {
  const scopeKey = {};
  const registered = [];
  const defs = { pwsh: mkDef("pwsh", (args) => ({ card: "terminal", title: args.command })) };
  const tools = {
    get(name, scope) {
      // 模拟 dsh：工具只存在当前 Agent scope；不传 scope 查不到。
      return scope === scopeKey ? defs[name] : undefined;
    },
    register(def) {
      registered.push(def);
    },
  };
  const ctx = { agent: scopeKey, tools };
  reg(ctx, { name: "小花", enabled: true });
  assert.equal(registered.length, 1);
  const view = registered[0].presentCall({ command: "Get-Location" });
  assert.equal(view.description, "💻 小花 正在敲 PowerShell");
});

test("注册后原 execute 与 schema 原样保留（同一引用）", () => {
  const orig = mkDef("bash", undefined, undefined, "EXEC");
  const { ctx, registered } = makeCtx({ bash: orig });
  reg(ctx, { name: "小花", enabled: true });
  const shadowed = registered[0];
  assert.equal(shadowed.execute, orig.execute, "execute 应引用原函数");
  assert.equal(shadowed.schema, orig.schema, "schema 应是原对象");
  const marker = shadowed.execute();
  assert.equal(marker, "EXEC");
});

test("generic 卡：标题换成拟人 running 短语，kind/locations 保留", () => {
  const orig = mkDef(
    "read",
    (args) => ({ card: "generic", title: `Read ${args.file_path}`, kind: "read", locations: [{ path: args.file_path }] }),
  );
  const { ctx, registered } = makeCtx({ read: orig });
  reg(ctx, { name: "小花", enabled: true });
  const view = registered[0].presentCall({ file_path: "a/b.txt", offset: 1 });
  assert.equal(view.card, "generic");
  assert.equal(view.title, "📖 小花 正在翻阅档案");
  assert.equal(view.kind, "read");
  assert.deepEqual(view.locations, [{ path: "a/b.txt" }]);
});

test("terminal 卡（call 态）：命令保留为标题，description 换成拟人句", () => {
  const orig = mkDef(
    "bash",
    (args) => ({ card: "terminal", title: args.command, cwd: "/w" }),
  );
  const { ctx, registered } = makeCtx({ bash: orig });
  reg(ctx, { name: "小花", enabled: true });
  const view = registered[0].presentCall({ command: "node --check x.js" });
  assert.equal(view.card, "terminal");
  assert.equal(view.title, "node --check x.js", "terminal 标题应保留命令");
  assert.equal(view.description, "💻 小花 正在小心翼翼地用你的电脑");
  assert.equal(view.cwd, "/w");
});

test("diff 卡：标题换成拟人句，diffs 保留", () => {
  const diffs = [{ path: "x.ts", oldText: "a", newText: "b" }];
  const orig = mkDef(
    "edit",
    (args) => ({ card: "diff", title: `Edit ${args.file_path}`, diffs }),
  );
  const { ctx, registered } = makeCtx({ edit: orig });
  reg(ctx, { name: "小花", enabled: true });
  const view = registered[0].presentCall({ file_path: "x.ts" });
  assert.equal(view.card, "diff");
  assert.equal(view.title, "✏️ 小花 提笔改字中");
  assert.deepEqual(view.diffs, diffs);
});

test("result 完成态：done 短语 + 原 view 结构保留", () => {
  const orig = mkDef(
    "read",
    undefined,
    (_args, _result) => ({ card: "read", title: "Read a.ts", path: "a.ts", offset: 1, lines: [], totalLines: 3 }),
  );
  const { ctx, registered } = makeCtx({ read: orig });
  reg(ctx, { name: "小花", enabled: true });
  const view = registered[0].presentResult({ file_path: "a.ts" }, { content: "x", isError: false });
  assert.equal(view.title, "📖 小花 翻完了");
  assert.equal(view.path, "a.ts");
  assert.equal(view.totalLines, 3);
});

test("result 失败态：failed 短语（原 presenter 返回 undefined 也兜底）", () => {
  const orig = mkDef(
    "bash",
    undefined,
    (_args, result) => {
      if (result.isError) return undefined;
      return { card: "terminal", title: "cmd", output: "ok" };
    },
  );
  const { ctx, registered } = makeCtx({ bash: orig });
  reg(ctx, { name: "小花", enabled: true });
  const failView = registered[0].presentResult({ command: "cmd" }, { content: "boom", isError: true });
  assert.deepEqual(failView, { card: "generic", title: "💻 小花 电脑没听话" });
  const okView = registered[0].presentResult({ command: "cmd" }, { content: "ok", isError: false });
  assert.equal(okView.title, "💻 小花 用完电脑了");
  assert.equal(okView.output, "ok");
});

test("没有原生 presenter 时兜底 generic 拟人卡", () => {
  const orig = mkDef("glob");
  const { ctx, registered } = makeCtx({ glob: orig });
  reg(ctx, { name: "小花", enabled: true });
  const callView = registered[0].presentCall({ pattern: "**/*.ts" });
  assert.deepEqual(callView, { card: "generic", title: "🔍 小花 正在找档案" });
  const resView = registered[0].presentResult({ pattern: "**/*.ts" }, { content: "[]", isError: false });
  assert.deepEqual(resView, { card: "generic", title: "🔍 小花 找到了" });
});

test("result terminal 卡：标题换成 done 短语，output / exitCode 保留", () => {
  const orig = mkDef(
    "bash",
    undefined,
    (_args, _result) => ({ card: "terminal", title: "cmd", output: "out", exitCode: 0 }),
  );
  const { ctx, registered } = makeCtx({ bash: orig });
  reg(ctx, { name: "小花", enabled: true });
  const view = registered[0].presentResult({ command: "cmd" }, { content: "out", isError: false });
  assert.equal(view.title, "💻 小花 用完电脑了");
  assert.equal(view.output, "out");
  assert.equal(view.exitCode, 0);
});

test("tools/change 补偿挂载：晚注册的工具出现后补挂，已包装的不重复", () => {
  // 初始只有 bash；pwsh 之后才被注册（preset 顺序不定）
  const defs = { bash: mkDef("bash") };
  const { ctx, registered, emitToolsChange } = makeCtx(defs);
  reg(ctx, { name: "小花", enabled: true });
  assert.deepEqual(registered.map((d) => d.name), ["bash"], "初始只挂 bash");

  // pwsh 出现 → tools/change 触发 → 补挂 pwsh
  defs.pwsh = mkDef("pwsh", (args) => ({ card: "terminal", title: args.command }), undefined, "PWSH-EXEC");
  emitToolsChange();
  assert.deepEqual(registered.map((d) => d.name), ["bash", "pwsh"], "补挂后应含 pwsh");
  assert.equal(registered[1].name, "pwsh");
  // pwsh 的 presenter 生效且执行体保留
  const view = registered[1].presentCall({ command: "pwd" });
  assert.equal(view.card, "terminal");
  assert.equal(view.title, "pwd", "terminal 卡标题保留命令");
  assert.equal(view.description, "💻 小花 正在敲 PowerShell");

  // 再次触发 tools/change 不重复包装
  emitToolsChange();
  assert.equal(registered.length, 2, "重复触发不重复注册");
});

test("回归：get 看不到包装版（真实 scope 层叠）时，反复触发 patch 不抛错、不重复注册", () => {
  // 模拟真实 dsh：register 后 get 仍返回原始 def（无 TALK_MARK），
  // 定时补偿反复触发时若靠 def 标记防重会重复 register → duplicateError → 进程崩溃。
  const defs = { bash: mkDef("bash"), search_stickers: mkDef("search_stickers") };
  const { ctx, registered, emitToolsChange } = makeCtx(defs, { opaqueGet: true });
  reg(ctx, { name: "小花", enabled: true });
  assert.equal(registered.length, 2, "初始挂载 2 个工具");

  // 模拟定时补偿多次触发（tools/change 反复 emit + 插件内部定时器同一 patch 路径）
  for (let i = 0; i < 10; i++) {
    assert.doesNotThrow(() => emitToolsChange(), `第 ${i + 1} 次触发不应抛错`);
  }
  assert.equal(registered.length, 2, "反复触发后仍只有初始的 2 个注册，不重复");

  // 晚注册工具仍能补挂（registered Set 只挡已挂过的名字）
  defs.pwsh = mkDef("pwsh");
  emitToolsChange();
  assert.deepEqual(registered.map((d) => d.name), ["bash", "search_stickers", "pwsh"], "新工具 pwsh 应补挂");
});

test("TALK_TABLE 每条短语都带 {name} 占位符（防手滑漏写）", () => {
  for (const [tool, phrases] of Object.entries(TALK_TABLE)) {
    for (const key of ["running", "done", "failed"]) {
      assert.ok(phrases[key].includes("{name}"), `${tool}.${key} 应含 {name} 占位符`);
    }
  }
});

// 冒烟测试（不依赖宿主进程）：mock ctx → apply 插件 → 临时 http server
// 验证：列表 API、新建 API（落盘模板预设）、静态页、默认头像资源、404、
// memory 只读接口（Phase 4）、提示文案存在性（Phase 4）
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { load as yamlLoad } from "js-yaml";
import { apply } from "../lib/index.js";

const dshHome = mkdtempSync(join(tmpdir(), "am-smoke-"));
const presetsRoot = join(dshHome, ".agent-presets");

let capturedHandler = null;
const settingsCalls = [];
const ctx = {
  agentPresets: { defaultId: "xiaohua" },
  agentDefaultModel: {
    currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }),
  },
  settings: {
    update(ns, patch) {
      settingsCalls.push({ ns, patch });
      return undefined;
    },
  },
  webServer: {
    register(route) {
      if (route.kind !== "prefix" || route.path !== "/assistant-manager") {
        throw new Error(`意外路由：${route.kind} ${route.path}`);
      }
      capturedHandler = route.handler;
      return () => {};
    },
  },
};

apply(ctx, { dshHome });

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed += 1;
};

const server = createServer((req, res) => capturedHandler(req, res));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/assistant-manager`;

try {
  /* 1. 空列表 */
  let res = await fetch(`${base}/api/agents`);
  let data = await res.json();
  check("初始列表为空", res.status === 200 && Array.isArray(data.agents) && data.agents.length === 0, JSON.stringify(data));

  /* 2. 新建助手 */
  res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "测试助手", yuan: "hanako" }),
  });
  data = await res.json();
  check("新建返回 201", res.status === 201, JSON.stringify(data));
  check("新建 id 合法", /^[a-z0-9][a-z0-9-]*$/.test(data.agent.id), data.agent.id);
  check("新建名字/元正确", data.agent.name === "测试助手" && data.agent.yuan === "hanako");

  const id = data.agent.id;
  const presetDir = join(presetsRoot, id);
  check("agent.cordis.yml 落盘", existsSync(join(presetDir, "agent.cordis.yml")));
  check("preset.yml 落盘", existsSync(join(presetDir, "preset.yml")));
  check("默认头像落盘", existsSync(join(presetDir, "assets", "avatar.png")));
  check("pinned.md 初始化", existsSync(join(dshHome, "assistant-soul", id, "pinned.md")));

  const rows = yamlLoad(readFileSync(join(presetDir, "agent.cordis.yml"), "utf8"));
  check("profile = 预设 id（记忆隔离）", rows[0].config.profile === id, rows[0].config.profile);
  check("identity 渲染了名字", rows[0].config.identity.includes("测试助手"));
  check("无占位残留", !readFileSync(join(presetDir, "agent.cordis.yml"), "utf8").includes("{{"));

  /* 3. 列表含新助手 */
  res = await fetch(`${base}/api/agents`);
  data = await res.json();
  check("列表含新助手", data.agents.length === 1 && data.agents[0].id === id);
  check("列表带元/开关/头像标记", data.agents[0].memoryEnabled === true && data.agents[0].experienceEnabled === false && data.agents[0].hasAvatar === true);

  /* 4. 空名字 / 非法元 400 */
  res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "  ", yuan: "hanako" }),
  });
  check("空名字拒绝 400", res.status === 400);
  res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x", yuan: "robot" }),
  });
  check("非法元拒绝 400", res.status === 400);

  /* 5. PUT 更新全字段（Phase 2） */
  res = await fetch(`${base}/api/agents/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "改名助手", identity: "新身份", persona: "新人格", memoryEnabled: false, experienceEnabled: true }),
  });
  data = await res.json();
  check("PUT 更新 200", res.status === 200, JSON.stringify(data));
  check("PUT 名字生效", data.agent.name === "改名助手");
  check("PUT identity/persona 生效", data.agent.identity === "新身份" && data.agent.persona === "新人格");
  check("PUT 开关生效", data.agent.memoryEnabled === false && data.agent.experienceEnabled === true);
  const rowsAfterPut = yamlLoad(readFileSync(join(presetDir, "agent.cordis.yml"), "utf8"));
  check("PUT 后仍插件行列表", Array.isArray(rowsAfterPut) && rowsAfterPut[0].id === "assistant-soul");
  const presetMetaAfterPut = yamlLoad(readFileSync(join(presetDir, "preset.yml"), "utf8"));
  check("PUT 同步 preset.yml name", presetMetaAfterPut.name === "改名助手");

  /* 6. 置顶记忆增删查（复用 soul 格式） */
  res = await fetch(`${base}/api/agents/${id}/pins`);
  data = await res.json();
  check("pins 初始为空", res.status === 200 && Array.isArray(data.pins) && data.pins.length === 0);
  res = await fetch(`${base}/api/agents/${id}/pins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "记住这件事" }),
  });
  data = await res.json();
  check("pin 添加 201", res.status === 201 && data.pins.length === 1 && data.pins[0].content === "记住这件事");
  check("pin 双写 pinned.md", readFileSync(join(dshHome, "assistant-soul", id, "pinned.md"), "utf8").includes("记住这件事"));
  check("pin 双写 pinned-memory.json", readFileSync(join(dshHome, "assistant-soul", id, "pinned-memory.json"), "utf8").includes('"记住这件事"'));
  const pinId = data.pins[0].id;
  res = await fetch(`${base}/api/agents/${id}/pins/${pinId}`, { method: "DELETE" });
  data = await res.json();
  check("pin 删除 200", res.status === 200 && data.pins.length === 0);
  res = await fetch(`${base}/api/agents/${id}/pins`, { method: "DELETE" });
  check("pin 空 body 删除拒绝", res.status === 404);

  /* 7. 经验只读列表（造 soul 侧 experience/ 数据，验证分类读取） */
  // 格式照抄 soul 插件：experience/<file>.md，文件头 base64url 分类名 + 数字列表正文
  const expDir = join(dshHome, "assistant-soul", id, "experience");
  mkdirSync(expDir, { recursive: true });
  const catName = Buffer.from("工作方法").toString("base64url");
  writeFileSync(join(expDir, "workflow.md"), `<!-- experience-title: ${catName} -->\n1. 先想后动再沉淀\n2. 查库再干\n`, "utf8");
  writeFileSync(join(expDir, "experience.md"), "# 经验索引（自动生成）\n", "utf8");
  res = await fetch(`${base}/api/agents/${id}/experience`);
  data = await res.json();
  check("experience 只读列表", res.status === 200 && data.enabled === true && Array.isArray(data.categories));
  check("experience 分类读取（base64url 标题 + 条目）",
    data.categories.length === 1 && data.categories[0].category === "工作方法" &&
    data.categories[0].entries.length === 2 && data.categories[0].entries[0] === "先想后动再沉淀");

  /* 7.5. memory 只读接口（Phase 4）：四文件 + memory.md + summaries + facts.db 统计 */
  // 造一份 soul 侧记忆数据（模拟运行时插件写入）
  const memDir = join(dshHome, "assistant-soul", id, "memory");
  mkdirSync(join(memDir, "summaries"), { recursive: true });
  writeFileSync(join(memDir, "today.md"), "- 今天聊了工作节奏\n", "utf8");
  writeFileSync(join(memDir, "week.md"), "- 无。\n", "utf8");
  writeFileSync(join(memDir, "longterm.md"), "- 用户关注协作效率\n", "utf8");
  writeFileSync(join(memDir, "facts.md"), "- 助理工作节奏核心是「稳当」\n", "utf8");
  writeFileSync(join(memDir, "memory.md"), "## 记忆快照\n\n## 重要事实\n- 稳当\n", "utf8");
  writeFileSync(join(memDir, "summaries", "sess-1.md"), "### 重要事实\n- 事实一\n\n### 事情经过\n- 过程一\n", "utf8");
  const fdb = new DatabaseSync(join(memDir, "facts.db"));
  fdb.exec("CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL, search_text TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', time TEXT, session_id TEXT, created_at TEXT NOT NULL)");
  fdb.prepare("INSERT INTO facts (fact, search_text, tags, time, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("用户喜欢喝茶", "用户喜欢喝茶", "[]", null, "sess-1", "2026-08-15T00:00:00Z");
  fdb.close();

  res = await fetch(`${base}/api/agents/${id}/memory`);
  data = await res.json();
  check("memory 只读接口 200", res.status === 200, JSON.stringify(data));
  check("memory 四文件内容", data.sections.today.includes("工作节奏") && data.sections.facts.includes("稳当") && data.sections.longterm.includes("协作效率") && data.sections.week.includes("无"));
  check("memory 组装快照", data.memoryMd.includes("## 记忆快照"));
  check("memory summaries 列表（含内容）", data.summaries.length === 1 && data.summaries[0].sessionId === "sess-1" && data.summaries[0].content.includes("### 重要事实") && data.summaries[0].updatedAt > 0);
  check("memory facts 统计", data.factsDbExists === true && data.factsCount === 1);

  // 不存在的助手 memory → 空快照（200，不 404，只读视图要稳）
  res = await fetch(`${base}/api/agents/no-such-id/memory`);
  data = await res.json();
  check("memory 不存在助手回落空快照", res.status === 200 && data.sections.today === "" && data.summaries.length === 0 && data.factsCount === null);

  /* 8. 模型默认（agentDefaultModel 服务） */
  res = await fetch(`${base}/api/model-default`);
  data = await res.json();
  check("model-default 返回默认模型", res.status === 200 && data.provider === "deepseek-official" && data.model === "deepseek-v4-flash");

  /* 9. 静态页与资源 */
  res = await fetch(`${base}/`);
  const html = await res.text();
  check("首页 200 且含标题", res.status === 200 && html.includes("助手配置") && html.includes("新建助手"));

  // Phase 4：常驻提示条（配置修改新会话生效）+ 记忆快照展开区（只读）
  check("首页含「新建会话后生效」提示条", html.includes("会在新会话生效") && html.includes("当前会话不受影响"));
  check("首页提示条区分即时生效项", html.includes("即时生效"));
  check("首页含「查看记忆快照」展开区", html.includes("查看记忆快照") && html.includes("只读"));

  res = await fetch(`${base}/app.js`);
  check("app.js 200", res.status === 200 && (await res.text()).includes("createAgent"));

  res = await fetch(`${base}/assets/avatars/hanako.png`);
  check("默认头像 200 image/png", res.status === 200 && (res.headers.get("content-type") || "").includes("image/png"));

  res = await fetch(`${base}/nope`);
  check("未知路径 404", res.status === 404);

  /* 10. 头像上传 / 读取 / 移除（Phase 3） */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  res = await fetch(`${base}/api/agents/${id}/avatar`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: PNG,
  });
  data = await res.json();
  check("头像上传 200", res.status === 200 && data.agent.hasAvatar === true, JSON.stringify(data));
  check("头像文件落盘", existsSync(join(presetDir, "assets", "avatar.png")));
  res = await fetch(`${base}/api/agents/${id}/avatar`);
  check("头像 GET 200 image/png", res.status === 200 && (res.headers.get("content-type") || "").includes("image/png"));
  res = await fetch(`${base}/api/agents/${id}/avatar`, {
    method: "PUT",
    headers: { "content-type": "image/gif" },
    body: PNG,
  });
  check("头像非法类型 400", res.status === 400);
  res = await fetch(`${base}/api/agents/${id}/avatar`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: new Uint8Array([1, 2, 3, 4, 5]),
  });
  check("头像非法魔数 400", res.status === 400);
  res = await fetch(`${base}/api/agents/${id}/avatar`, { method: "DELETE" });
  data = await res.json();
  check("头像移除 200 + hasAvatar false", res.status === 200 && data.agent.hasAvatar === false, JSON.stringify(data));
  check("头像文件已删", !existsSync(join(presetDir, "assets", "avatar.png")));

  /* 11. 排序（Phase 3） */
  res = await fetch(`${base}/api/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "第二助手", yuan: "butter" }) });
  data = await res.json();
  const id2 = data.agent.id;
  check("第二个助手 order 递增", data.agent.order === 1, JSON.stringify(data));
  res = await fetch(`${base}/api/agents/order`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [id2, id] }),
  });
  data = await res.json();
  check("排序 200 + 顺序生效", res.status === 200 && data.agents[0].id === id2 && data.agents[1].id === id, JSON.stringify(data));
  res = await fetch(`${base}/api/agents/order`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [id] }),
  });
  check("排序数量不一致 400", res.status === 400);

  /* 12. 设为主助手（Phase 3，写 settings 命名空间） */
  res = await fetch(`${base}/api/agents/${id2}/default`, { method: "PUT" });
  data = await res.json();
  check("设默认 200 + defaultId", res.status === 200 && data.defaultId === id2, JSON.stringify(data));
  check("settings.update 写入 agent-presets.default", settingsCalls.some((c) => c.ns === "agent-presets" && c.patch.default === id2));
  res = await fetch(`${base}/api/agents/no-such-id/default`, { method: "PUT" });
  check("设默认不存在 404", res.status === 404);

  /* 13. 删除助手（Phase 3，保护逻辑；mock defaultId 固定 'xiaohua'，删默认场景在单测覆盖） */
  res = await fetch(`${base}/api/agents/${id}`, { method: "DELETE" });
  check("删除非默认 200", res.status === 200, JSON.stringify(await res.json()));
  check("删除后预设目录消失", !existsSync(join(presetsRoot, id)));
  check("删除后 soul 目录消失", !existsSync(join(dshHome, "assistant-soul", id)));
  res = await fetch(`${base}/api/agents`);
  data = await res.json();
  check("删除后列表立即可见消失", data.agents.length === 1 && data.agents[0].id === id2);
  res = await fetch(`${base}/api/agents/${id}`, { method: "DELETE" });
  check("删除不存在 404", res.status === 404);
  res = await fetch(`${base}/api/agents/${id2}`, { method: "DELETE" });
  check("删除最后一个助手被拦 400（至少保留一个）", res.status === 400, JSON.stringify(await res.json()));
} finally {
  server.closeAllConnections?.();
  server.close();
  rmSync(dshHome, { recursive: true, force: true });
}

console.log(failed === 0 ? "\n冒烟全部通过 ✓" : `\n${failed} 项失败 ✗`);
// undici 全局连接池在 Windows 上需先收尾，否则 process.exit 触发 libuv 断言
await new Promise((resolve) => setTimeout(resolve, 150));
process.exit(failed === 0 ? 0 : 1);

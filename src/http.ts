/**
 * HTTP 路由：挂在 dsh webServer 的 /assistant-manager 前缀下（路径 B）。
 *
 * - GET  /assistant-manager/api/agents             → 助手列表 JSON
 * - POST /assistant-manager/api/agents             → 新建助手 {name, yuan}
 * - PUT  /assistant-manager/api/agents/{id}        → 更新助手（name/identity/persona/yuan/开关）
 * - GET  /assistant-manager/api/agents/{id}/pins   → 置顶记忆列表
 * - POST /assistant-manager/api/agents/{id}/pins   → 添加置顶记忆 {content}
 * - DELETE /assistant-manager/api/agents/{id}/pins/{key} → 删除置顶记忆（id 或关键词）
 * - GET  /assistant-manager/api/agents/{id}/experience → 经验分类列表（只读）
 * - GET  /assistant-manager/api/model-default      → 全局默认模型 {provider, model, reasoningEffort?}
 * - GET  /assistant-manager/                       → 前端单页（web/index.html）
 * - GET  /assistant-manager/app.css|app.js         → 前端静态
 * - GET  /assistant-manager/assets/*               → 插件包素材（默认头像等）
 *
 * 前端与素材都从插件包目录读取（插件自包含，§10.15），不碰宿主白名单。
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

/** dsh-host-webserver 的 WebServer 服务最小形状（宿主组合已挂载，运行时经 ctx 注入）。 */
interface WebServerLike {
  register(route: {
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}
/** dsh-agent-presets 的 AgentPresets 服务最小形状。 */
interface AgentPresetsLike {
  defaultId: string | undefined;
}
/** dsh-agent-default-model 服务最小形状（base 组合已挂载）。 */
interface AgentDefaultModelLike {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string };
}
/** dsh-settings 服务最小形状（写入 agent-presets.default 用，见 defaults.ts 调研结论）。 */
interface SettingsLike {
  update(ns: string, patch: { default: string }): unknown;
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    webServer: WebServerLike;
    agentPresets?: AgentPresetsLike;
    agentDefaultModel?: AgentDefaultModelLike;
    settings?: SettingsLike;
  }
}
import { resolveManagerPaths } from "./paths.js";
import { createAgent, listAgents, readAgent, updateAgent, deleteAgent, reorderAgents, writeAvatar, removeAvatar, avatarFilePath } from "./presets.js";
import { setDefaultAgent } from "./defaults.js";
import { addPinnedEntry, readPinnedEntries, removePinnedEntry } from "./pins.js";
import { listExperienceCategories } from "./experience.js";
import { readMemorySnapshot } from "./memory.js";
import { YUAN_KEYS } from "./templates.js";

export const ROUTE_PREFIX = "/assistant-manager";

/** 包根：<pkg>/web 与 <pkg>/assets（lib/ 上溯）。 */
const PKG_WEB = fileURLToPath(new URL("../web/", import.meta.url));
const PKG_ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 读原始请求体（二进制，头像上传用，不转 utf8）。 */
function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** 解析 JSON 请求体；非法 JSON 时返回 undefined（调用方回 400）。 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const raw = await readBody(req);
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 从 URL 路径解析 /api/agents/{id} 或 /api/agents/{id}/{sub}/{key}。 */
function parseAgentRoute(rest: string): { id: string; sub?: string; key?: string } | undefined {
  const m = /^\/api\/agents\/([a-z0-9][a-z0-9-]*)(?:\/(pins|experience|memory)(?:\/([^/]+))?)?$/.exec(rest);
  if (!m) return undefined;
  return { id: m[1], sub: m[2], key: m[3] ? decodeURIComponent(m[3]) : undefined };
}

/** 静态文件服务（防目录穿越：相对路径必须以根开头且不越界）。 */
function serveFile(res: ServerResponse, filePath: string, root: string): void {
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    sendText(res, 403, "forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendText(res, 404, "not found");
    return;
  }
  const ct = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": ct,
    "content-length": statSync(filePath).size,
    "cache-control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

/** 注册 /assistant-manager 前缀路由。 */
export function registerRoutes(ctx: Context, config: { dshHome?: string }): void {
  const paths = resolveManagerPaths(config.dshHome);
  // 默认 preset id：每次请求实时从 agentPresets 服务读（apply 时服务可能未就绪）
  const currentDefaultId = (): string | undefined => ctx.agentPresets?.defaultId;

  ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rest = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname;
      const clean = rest.startsWith("/") ? rest : `/${rest}`;

      try {
        /* ---------- API ---------- */
        if (clean === "/api/agents" && req.method === "GET") {
          sendJson(res, 200, { agents: listAgents(paths.presetsRoot, currentDefaultId()) });
          return;
        }
        if (clean === "/api/agents" && req.method === "POST") {
          const raw = await readBody(req);
          let payload: unknown;
          try {
            payload = JSON.parse(raw || "{}");
          } catch {
            sendJson(res, 400, { error: "请求体不是合法 JSON" });
            return;
          }
          const name = String((payload as { name?: unknown })?.name ?? "");
          const yuan = String((payload as { yuan?: unknown })?.yuan ?? "");
          if (!name.trim()) {
            sendJson(res, 400, { error: "请输入助手名字" });
            return;
          }
          if (!YUAN_KEYS.includes(yuan as never)) {
            sendJson(res, 400, { error: `未知的元：${yuan}（可选：${YUAN_KEYS.join("/")}）` });
            return;
          }
          const agent = createAgent(paths.presetsRoot, paths.soulRoot, { name, yuan: yuan as never });
          sendJson(res, 201, { agent });
          return;
        }

        // PUT /api/agents/order：重排助手顺序（必须在 {id} 更新路由之前——
        // 'order' 本身也匹配 [a-z0-9][a-z0-9-]*，先判这里避免被当成 id）
        if (req.method === "PUT" && clean === "/api/agents/order") {
          const payload = await readJsonBody(req);
          const ids = payload?.ids;
          if (!Array.isArray(ids) || !ids.every((v) => typeof v === "string")) {
            sendJson(res, 400, { error: "需要 ids 字符串数组" });
            return;
          }
          try {
            const agents = reorderAgents(paths.presetsRoot, ids as string[]);
            sendJson(res, 200, { agents });
          } catch (e) {
            sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }

        // PUT /api/agents/{id}：更新字段（name/identity/persona/yuan/memoryEnabled/experienceEnabled）
        if (req.method === "PUT" && /^\/api\/agents\/[a-z0-9][a-z0-9-]*$/.test(clean)) {
          const id = clean.split("/")[3];
          const payload = await readJsonBody(req);
          if (!payload) {
            sendJson(res, 400, { error: "请求体不是合法 JSON" });
            return;
          }
          const patch: {
            name?: string;
            identity?: string;
            persona?: string;
            yuan?: string;
            memoryEnabled?: boolean;
            experienceEnabled?: boolean;
          } = {};
          if (payload.name !== undefined) patch.name = String(payload.name);
          if (payload.identity !== undefined) patch.identity = String(payload.identity);
          if (payload.persona !== undefined) patch.persona = String(payload.persona);
          if (payload.yuan !== undefined) patch.yuan = String(payload.yuan);
          if (payload.memoryEnabled !== undefined) patch.memoryEnabled = Boolean(payload.memoryEnabled);
          if (payload.experienceEnabled !== undefined) patch.experienceEnabled = Boolean(payload.experienceEnabled);
          try {
            const updated = updateAgent(paths.presetsRoot, id, patch as Parameters<typeof updateAgent>[2], currentDefaultId());
            sendJson(res, 200, { agent: updated });
          } catch (e) {
            sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }

        // DELETE /api/agents/{id}：删除助手（默认/最后一个/不存在被保护逻辑拦下）
        if (req.method === "DELETE" && /^\/api\/agents\/[a-z0-9][a-z0-9-]*$/.test(clean)) {
          const id = clean.split("/")[3];
          try {
            const result = deleteAgent(paths.presetsRoot, paths.soulRoot, id, currentDefaultId());
            sendJson(res, 200, result);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, msg.includes("不存在") ? 404 : 400, { error: msg });
          }
          return;
        }

        // PUT /api/agents/{id}/default：设为主助手（写 settings 命名空间 agent-presets.default）
        if (req.method === "PUT" && /^\/api\/agents\/[a-z0-9][a-z0-9-]*\/default$/.test(clean)) {
          const id = clean.split("/")[3];
          if (!ctx.settings) {
            sendJson(res, 500, { error: "settings 服务不可用" });
            return;
          }
          try {
            setDefaultAgent(ctx.settings, paths.presetsRoot, id);
            sendJson(res, 200, { agent: readAgent(paths.presetsRoot, id, id), defaultId: id });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, msg.includes("不存在") ? 404 : 400, { error: msg });
          }
          return;
        }

        // 头像读写：GET 读取（无自定义 404，前端兜底 yuan 默认头像）、
        // PUT 上传（content-type 判扩展名 + 魔数校验）、DELETE 移除恢复默认
        if (req.method === "GET" && /^\/api\/agents\/[a-z0-9][a-z0-9-]*\/avatar$/.test(clean)) {
          const id = clean.split("/")[3];
          const file = avatarFilePath(paths.presetsRoot, id);
          if (!file) {
            sendJson(res, 404, { error: "该助手没有自定义头像" });
            return;
          }
          serveFile(res, file, file);
          return;
        }
        if (req.method === "PUT" && /^\/api\/agents\/[a-z0-9][a-z0-9-]*\/avatar$/.test(clean)) {
          const id = clean.split("/")[3];
          const data = await readBodyBuffer(req);
          const ct = String(req.headers["content-type"] ?? "").toLowerCase();
          const ext = ct.includes("image/png")
            ? "png"
            : ct.includes("image/jpeg")
              ? "jpg"
              : ct.includes("image/webp")
                ? "webp"
                : "";
          if (!ext) {
            sendJson(res, 400, { error: "content-type 必须是 image/png / image/jpeg / image/webp" });
            return;
          }
          try {
            writeAvatar(paths.presetsRoot, id, data, ext);
            sendJson(res, 200, { agent: readAgent(paths.presetsRoot, id, currentDefaultId()) });
          } catch (e) {
            sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }
        if (req.method === "DELETE" && /^\/api\/agents\/[a-z0-9][a-z0-9-]*\/avatar$/.test(clean)) {
          const id = clean.split("/")[3];
          try {
            const { removed } = removeAvatar(paths.presetsRoot, id);
            sendJson(res, 200, { removed, agent: readAgent(paths.presetsRoot, id, currentDefaultId()) });
          } catch (e) {
            sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }

        // /api/agents/{id}/pins 与 /api/agents/{id}/experience（置顶记忆 + 经验只读）
        if (clean.startsWith("/api/agents/")) {
          const route = parseAgentRoute(clean);
          if (route && route.sub === "pins" && req.method === "GET") {
            sendJson(res, 200, { pins: readPinnedEntries(paths.soulRoot, route.id) });
            return;
          }
          if (route && route.sub === "pins" && req.method === "POST") {
            const payload = await readJsonBody(req);
            if (!payload || typeof payload.content !== "string" || !payload.content.trim()) {
              sendJson(res, 400, { error: "置顶记忆内容不能为空" });
              return;
            }
            try {
              const result = addPinnedEntry(paths.soulRoot, route.id, payload.content);
              sendJson(res, 201, { pins: readPinnedEntries(paths.soulRoot, route.id), ...result });
            } catch (e) {
              sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
            }
            return;
          }
          if (route && route.sub === "pins" && req.method === "DELETE" && route.key) {
            try {
              const result = removePinnedEntry(paths.soulRoot, route.id, route.key);
              if (result.removed === 0) {
                sendJson(res, 404, { error: `没有找到匹配「${route.key}」的置顶记忆` });
                return;
              }
              sendJson(res, 200, { pins: readPinnedEntries(paths.soulRoot, route.id), ...result });
            } catch (e) {
              sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
            }
            return;
          }
          if (route && route.sub === "experience" && req.method === "GET") {
            const agent = readAgent(paths.presetsRoot, route.id, currentDefaultId());
            sendJson(res, 200, {
              enabled: agent.experienceEnabled,
              categories: listExperienceCategories(paths.soulRoot, route.id),
            });
            return;
          }
          // GET /api/agents/{id}/memory：记忆快照只读视图（Phase 4）。
          // 读 assistant-soul/<profile>/memory/ 下四文件 + memory.md + summaries/ + facts.db 统计。
          // 只读：管理页不做任何记忆写入，记忆由 soul 插件全权管理（§Phase 4 任务 1）。
          if (route && route.sub === "memory" && req.method === "GET") {
            sendJson(res, 200, readMemorySnapshot(paths.soulRoot, route.id));
            return;
          }
        }

        // GET /api/model-default：全局默认模型（新会话默认）
        //
        // 【模型配置调研结论，2026-08】dsh 没有 preset 级主模型行：agent.cordis.yml
        // 是插件行列表，模型归「部署全局默认 + 会话级选择」两层管（dsh-agent-presets
        // README：模型体验是间接的，通过插件行注册的段/工具）。
        // - 会话模型三级解析：进程内选择 → 会话日志 request/header → 全局默认
        //   （dsh-host-apiproxy README）。
        // - 全局默认 = agent-default-model settings 命名空间，读取姿势：
        //   ctx.agentDefaultModel.currentSelection()（base 组合已挂载本服务）。
        // - per-agent 模型覆盖唯一路径：插件在 CreateAgentOptions.setup(agentCtx)
        //   调 installModelSelection()。需 soul 插件加 Config.model + setup 钩子，
        //   Phase 2 延后；本胶囊先只读展示全局默认。
        if (clean === "/api/model-default" && req.method === "GET") {
          const selection = ctx.agentDefaultModel?.currentSelection();
          if (!selection) {
            sendJson(res, 200, { provider: "", model: "", note: "agentDefaultModel 服务未就绪" });
            return;
          }
          sendJson(res, 200, selection);
          return;
        }

        /* ---------- 静态 ---------- */
        if (clean === "/" || clean === "") {
          serveFile(res, join(PKG_WEB, "index.html"), PKG_WEB);
          return;
        }
        if (clean.startsWith("/assets/")) {
          serveFile(res, normalize(join(PKG_ASSETS, clean.slice("/assets/".length))), PKG_ASSETS);
          return;
        }
        if (clean.startsWith("/") && extname(clean)) {
          serveFile(res, normalize(join(PKG_WEB, clean.slice(1))), PKG_WEB);
          return;
        }

        sendText(res, 404, "not found");
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  });
}

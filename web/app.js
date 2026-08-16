// dsh-assistant-manager 前端：卡片堆叠 + 新建助手 + 编辑全字段（Phase 2）+ 头像/删除/设默认/排序（Phase 3）
// + 头像裁剪（Phase 5）：选图后先裁剪，确认后才上传（canvas 裁正方形 → PNG → 现有 PUT avatar 接口）
// 编辑区还原 Hana AgentTab（§3.4-3.7）：名字 / 模型胶囊 / 元选择器 / 身份·人格 / 记忆开关+置顶 / 经验开关+分类
import {
  minScaleFor,
  dragBy,
  zoomAtCenter,
  cropRect,
  outputSizeFor,
  ZOOM_IN_FACTOR,
} from "./crop.js";

const API = "/assistant-manager/api/agents";
const USER_API = "/assistant-manager/api/user";
const ASSET = "/assistant-manager/assets";

// 四元展示信息（§3.5 yuan.types + 思考块标签；顺序 butter → hanako → ming，kong 单独横幅）
const YUANS = [
  { key: "butter", label: "butter", desc: "更富有感情", tag: "PULSE" },
  { key: "hanako", label: "hanako", desc: "均衡的助手", tag: "MOOD" },
  { key: "ming", label: "ming", desc: "更理性冷静", tag: "沉思" },
];
const KONG = { key: "kong", label: "kong", desc: "无发散思考模块（如 MOOD），和别的 Agent 一致体验。", tag: null };
const KONG_SHORT_DESC = "无思考区块，直接回答。";

const state = {
  agents: [],
  selectedId: null,
  yuan: "hanako",
  creating: false,
  saving: false,
  modelDefault: null,
  deleting: null,
};

const $ = (sel) => document.querySelector(sel);

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ---------------- 列表 & 渲染 ---------------- */
async function refresh() {
  const res = await fetch(API);
  const data = await res.json();
  state.agents = data.agents || [];
  if (!state.agents.some((a) => a.id === state.selectedId)) {
    state.selectedId = state.agents[0] ? state.agents[0].id : null;
  }
  renderStack();
  renderDetail();
}

// 头像 URL：有自定义头像走 /api/agents/{id}/avatar（Phase 3），无则按 yuan 用默认头像兜底（§3.2）
function avatarUrl(agent) {
  if (agent && agent.hasAvatar) return `${API}/${agent.id}/avatar`;
  return `${ASSET}/avatars/${(agent && agent.yuan) || "hanako"}.png`;
}

// 隐藏文件选择（点击已选中卡片 / 详情头像 / 「我」页头像触发，accept png/jpeg/webp，§3.2）
const avatarInput = document.createElement("input");
avatarInput.type = "file";
avatarInput.accept = "image/png,image/jpeg,image/webp";
avatarInput.hidden = true;
avatarInput.addEventListener("change", onAvatarFileChosen);
document.body.appendChild(avatarInput);

// 裁剪上传目标：裁剪组件（crop.js）是纯几何计算、无角色概念（Phase 5 结论），
// 角色（助手/用户）在打开裁剪框时记录，确认上传时按角色分发到不同接口。
let avatarTarget = "agent"; // "agent"（助手头像）| "user"（用户头像）

function openAvatarPicker() {
  const agent = currentAgent();
  if (!agent) return;
  avatarTarget = "agent";
  avatarInput.click();
}

function openUserAvatarPicker() {
  avatarTarget = "user";
  avatarInput.click();
}

// 选完图片：先校验格式，再打开裁剪框（Phase 5：确认后才上传）
function onAvatarFileChosen() {
  const file = avatarInput.files && avatarInput.files[0];
  avatarInput.value = "";
  if (!file) return;
  if (avatarTarget === "agent" && !currentAgent()) return;
  // file.type 个别环境可能为空，按扩展名兜底推断（与后端支持的三类格式一致）
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const ct = file.type && file.type.startsWith("image/")
    ? file.type
    : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "png"
          ? "image/png"
          : "";
  if (!ct) {
    toast("请选择 png / jpeg / webp 图片");
    return;
  }
  openCropOverlay(file, avatarTarget);
}

// 上传头像：body 直接传文件二进制（裁剪器输出 PNG，content-type 固定 image/png，后端校验魔数）
async function putAvatarBlob(agent, blob) {
  try {
    const res = await fetch(`${API}/${agent.id}/avatar`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: blob,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "上传失败");
    agent.hasAvatar = data.agent.hasAvatar;
    renderStack();
    renderDetail();
    toast("头像已更新"); // 头像落盘后 dsh 预设立即可见（即时生效，与配置类改动区分）
  } catch (e) {
    toast(e.message || "上传失败");
  }
}

/* ================================================================ */
/* Phase 5：头像裁剪器（CropOverlay）——选图后先裁剪，确认后才上传   */
/* ================================================================ */

const CROP = {
  boxSize: 280, // 裁剪框边长（CSS 像素，与 .crop-stage 尺寸一致）
  img: null, // 解码后的 <img>（naturalWidth/Height 为原图像素）
  url: "", // object URL（关闭 overlay 时 revoke）
  role: "agent", // 确认上传的目标：agent（助手头像）| user（用户头像）
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

// 选图后解码并打开裁剪框；图片加载失败给提示（不打开）
function openCropOverlay(file, role) {
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.onload = () => {
    const min = minScaleFor(probe.naturalWidth, probe.naturalHeight, CROP.boxSize);
    CROP.img = probe;
    CROP.url = url;
    CROP.role = role || "agent";
    CROP.scale = min;
    // 初始居中：图片中心对齐裁剪框中心（最小缩放下必在钳制范围内）
    const off = centerOffset(probe, min);
    CROP.offsetX = off.offsetX;
    CROP.offsetY = off.offsetY;
    showCropOverlay();
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    toast("图片加载失败，请换一张试试");
  };
  probe.src = url;
}

// 居中初始位移：(boxSize - 显示尺寸) / 2
function centerOffset(probe, scale) {
  return {
    offsetX: (CROP.boxSize - probe.naturalWidth * scale) / 2,
    offsetY: (CROP.boxSize - probe.naturalHeight * scale) / 2,
  };
}

function showCropOverlay() {
  document.body.style.overflow = "hidden"; // 阻止 overlay 内滚动穿透
  $("#crop-img").src = CROP.url;
  $("#crop-submit").disabled = false;
  $("#crop-overlay").classList.remove("hidden");
  renderCrop();
  $("#crop-overlay").focus();
}

function closeCropOverlay() {
  $("#crop-overlay").classList.add("hidden");
  document.body.style.overflow = "";
  $("#crop-img").removeAttribute("src");
  if (CROP.url) {
    URL.revokeObjectURL(CROP.url);
    CROP.url = "";
  }
  CROP.img = null;
  CROP.dragging = false;
}

// 按当前 offset/scale 刷新图片位置与文字信息（缩放比例 + 输出尺寸）
function renderCrop() {
  const img = CROP.img;
  if (!img) return;
  const dispW = img.naturalWidth * CROP.scale;
  const dispH = img.naturalHeight * CROP.scale;
  const el = $("#crop-img");
  el.style.left = `${CROP.offsetX}px`;
  el.style.top = `${CROP.offsetY}px`;
  el.style.width = `${dispW}px`;
  el.style.height = `${dispH}px`;
  const min = minScaleFor(img.naturalWidth, img.naturalHeight, CROP.boxSize);
  $("#crop-zoom-label").textContent = `${Math.round((CROP.scale / min) * 100)}%`;
  const rect = cropRect(CROP.offsetX, CROP.offsetY, CROP.scale, CROP.boxSize, img.naturalWidth, img.naturalHeight);
  const out = outputSizeFor(rect.size);
  $("#crop-size-label").textContent = `输出 ${out}×${out}`;
}

// 缩放一步（按钮 / 滚轮共用），以视口中心为锚点
function applyZoom(factor) {
  if (!CROP.img) return;
  const z = zoomAtCenter(
    CROP.offsetX, CROP.offsetY, CROP.scale, factor,
    CROP.img.naturalWidth, CROP.img.naturalHeight, CROP.boxSize,
  );
  CROP.offsetX = z.offsetX;
  CROP.offsetY = z.offsetY;
  CROP.scale = z.scale;
  renderCrop();
}

// 确认上传：canvas 按裁剪区域裁出正方形 → toBlob PNG → 按角色分发（助手 PUT avatar / 用户 POST avatar）
function confirmCropUpload() {
  const btn = $("#crop-submit");
  if (btn.disabled) return;
  const img = CROP.img;
  if (!img) return;
  btn.disabled = true;
  const rect = cropRect(CROP.offsetX, CROP.offsetY, CROP.scale, CROP.boxSize, img.naturalWidth, img.naturalHeight);
  const out = outputSizeFor(rect.size);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x, rect.y, rect.size, rect.size, 0, 0, out, out);
  canvas.toBlob(async (blob) => {
    const role = CROP.role;
    closeCropOverlay();
    if (!blob) {
      toast("图片处理失败，请重试");
      return;
    }
    if (role === "user") {
      await putUserAvatarBlob(blob);
      return;
    }
    const agent = currentAgent();
    if (!agent) {
      toast("助手不存在，请重试");
      return;
    }
    await putAvatarBlob(agent, blob);
  }, "image/png");
}

// 上传用户头像：blob → base64 PNG → POST /api/user/avatar { data }（魔数校验在后端）
async function putUserAvatarBlob(blob) {
  try {
    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.split(",")[1];
    const res = await fetch(`${USER_API}/avatar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: base64 }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "上传失败");
    await refreshUserAvatar();
    toast("头像已更新");
  } catch (e) {
    toast(e.message || "上传失败");
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片处理失败"));
    reader.readAsDataURL(blob);
  });
}

// 移除头像：恢复 yuan 默认头像兜底（Hana「移除头像」按钮）
async function removeAvatar() {
  const agent = currentAgent();
  if (!agent || !agent.hasAvatar) return;
  try {
    const res = await fetch(`${API}/${agent.id}/avatar`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "移除失败");
    agent.hasAvatar = false;
    renderStack();
    renderDetail();
    toast("已恢复默认头像");
  } catch (e) {
    toast(e.message || "移除失败");
  }
}

function currentAgent() {
  return state.agents.find((a) => a.id === state.selectedId) || null;
}

/* ================================================================ */
/* Phase 5：「我」tab（Hana 同款：头像 → 名字 → 用户档案 → 保存）          */
/* ================================================================ */

// 无头像时的 SVG 人形占位（Hana avatar-upload 的占位图标语义，描边风格）
const USER_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#6b6158" stroke-width="4" stroke-linecap="round"><circle cx="32" cy="25" r="10"/><path d="M14 53c3.5-10 10-15 18-15s14.5 5 18 15"/></svg>',
);

// 「我」页当前已保存的用户数据（loadUser 回填；保存时与输入比较，变了才提交）
let userState = { name: "", profile: "" };

// 读全局用户（user.yaml）；缺失回落空（老预设不炸）。每次进入「我」tab 都刷新。
async function loadUser() {
  try {
    const res = await fetch(USER_API);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "读取失败");
    userState = { name: data.name || "", profile: data.profile || "" };
    $("#me-name").value = userState.name;
    $("#me-profile").value = userState.profile;
  } catch (e) {
    toast(e.message || "加载失败");
  }
  refreshUserAvatar();
}

// 头像显示：有自定义头像走 GET /api/user/avatar（带时间戳破坏缓存）；无则 SVG 占位
async function refreshUserAvatar() {
  const img = $("#me-avatar");
  const removeBtn = $("#me-remove-avatar");
  const stamp = `?t=${Date.now()}`;
  try {
    const res = await fetch(`${USER_API}/avatar${stamp}`);
    if (res.ok) {
      img.src = `${USER_API}/avatar${stamp}`;
      img.classList.remove("placeholder");
      removeBtn.classList.remove("hidden");
      return;
    }
  } catch {
    /* fallthrough：兜底占位 */
  }
  img.src = USER_PLACEHOLDER;
  img.classList.add("placeholder");
  removeBtn.classList.add("hidden");
}

// 保存（照 Hana）：名字变了才提交 name、档案变了才提交 profile；都没变 toast「没有更改」
async function saveMe() {
  const btn = $("#me-save");
  if (btn.disabled) return;
  const name = $("#me-name").value.trim();
  const profile = $("#me-profile").value;
  const patch = {};
  if (name !== userState.name) patch.name = name;
  if (profile !== userState.profile) patch.profile = profile;
  if (Object.keys(patch).length === 0) {
    toast("没有更改");
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(USER_API, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "保存失败");
    toast("保存成功");
    await loadUser(); // 刷新数据（头像/输入回填）
  } catch (e) {
    toast(e.message || "保存失败");
  } finally {
    btn.disabled = false;
  }
}

// 移除用户头像（恢复 SVG 占位）
async function removeUserAvatar() {
  try {
    const res = await fetch(`${USER_API}/avatar`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "移除失败");
    await refreshUserAvatar();
    toast("已移除头像");
  } catch (e) {
    toast(e.message || "移除失败");
  }
}

// tab 切换：「我」/「助手们」；import 按钮只属于「助手们」视图
function setTab(tab) {
  const isMe = tab === "me";
  $("#tab-me").classList.toggle("hidden", !isMe);
  $("#tab-agents").classList.toggle("hidden", isMe);
  $("#import-hana-btn").classList.toggle("hidden", isMe);
  document.querySelectorAll(".page-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  if (isMe) loadUser(); // 每次进入「我」都拉最新数据（保存后回填也走这里）
}

function renderStack() {
  const stack = $("#card-stack");
  stack.innerHTML = "";

  state.agents.forEach((agent, i) => {
    const card = document.createElement("div");
    card.className = "agent-card" + (agent.id === state.selectedId ? " selected" : "");
    card.dataset.id = agent.id;
    card.title = `${agent.name}${agent.isDefault ? "（主助手）" : ""}`;

    const img = document.createElement("img");
    img.className = "thumb";
    img.src = avatarUrl(agent);
    img.alt = agent.name;

    const name = document.createElement("div");
    name.className = "cname";
    name.textContent = agent.name;

    card.append(img, name);
    if (agent.isDefault) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.title = "主助手";
      card.append(badge);
    }
    card.addEventListener("click", () => {
      // §3.2：点击未选中卡片 → 切换当前编辑对象；点击已选中卡片 → 打开头像选择
      if (agent.id === state.selectedId) {
        openAvatarPicker();
        return;
      }
      state.selectedId = agent.id;
      renderStack();
      renderDetail();
    });
    stack.append(card);
  });

  // 「+」新建卡（占位名字标签保证与其他卡片同高对齐）
  const addItem = document.createElement("div");
  addItem.className = "agent-card add-card-item";
  const plus = document.createElement("div");
  plus.className = "add-card";
  plus.textContent = "+";
  plus.title = "新建助手";
  const plusName = document.createElement("div");
  plusName.className = "cname";
  addItem.append(plus, plusName);
  addItem.addEventListener("click", openCreate);
  stack.append(addItem);
}

/* ---------------- 模型胶囊（§3.4，只读展示） ---------------- */
async function loadModelDefault() {
  try {
    const res = await fetch("/assistant-manager/api/model-default");
    const data = await res.json();
    state.modelDefault = data;
    const el = $("#model-name");
    if (data && data.provider && data.model) {
      el.textContent = `${data.provider} / ${data.model}`;
    } else {
      el.textContent = data && data.note ? data.note : "（未配置）";
    }
  } catch {
    $("#model-name").textContent = "（读取失败）";
  }
}

/* ---------------- 编辑区渲染 ---------------- */
function renderDetail() {
  const detail = $("#agent-detail");
  const agent = currentAgent();
  if (!agent) {
    detail.classList.add("hidden");
    return;
  }
  detail.classList.remove("hidden");
  $("#detail-avatar").src = avatarUrl(agent);
  $("#detail-avatar").onclick = openAvatarPicker;
  // 移除头像按钮：有自定义头像才显示
  $("#remove-avatar-btn").classList.toggle("hidden", !agent.hasAvatar);
  $("#detail-name").value = agent.name;
  const yuanMeta = [...YUANS, KONG].find((y) => y.key === agent.yuan) || YUANS[0];
  $("#detail-meta").textContent =
    `元：${yuanMeta.key} · 记忆：${agent.memoryEnabled ? "开" : "关"} · 经验：${agent.experienceEnabled ? "开" : "关"}${agent.isDefault ? " · 主助手" : ""}`;

  renderOps();

  // 身份 / 人格（切换助手时回填；保存后不重填，避免覆盖未保存输入）
  $("#identity-input").value = agent.identity || "";
  $("#persona-input").value = agent.persona || "";

  renderYuanEditor(agent.yuan);
  renderSwitch($("#memory-switch"), agent.memoryEnabled);
  renderSwitch($("#experience-switch"), agent.experienceEnabled);
  renderExperiencePaused(agent.experienceEnabled);
  loadPins(agent.id);
  loadExperience(agent.id);
  resetMemorySnapshot(); // 切换助手时重置记忆快照（展开时懒加载）
}

/* ---------- 操作按钮行（Phase 3：设主助手 / 上移 / 下移 / 删除助手，§3.2） ---------- */
function renderOps() {
  const ops = $("#agent-ops");
  const agent = currentAgent();
  ops.innerHTML = "";
  if (!agent) return;
  const n = state.agents.length;
  const idx = state.agents.findIndex((a) => a.id === agent.id);

  // 设为主助手（非默认时显示）
  if (!agent.isDefault) {
    ops.appendChild(mkOpBtn("设为主助手", setDefault, "设为默认助手，新会话默认使用 Ta"));
  }
  // 上移 / 下移（拖拽排序延后，v1 用按钮，§8 Phase 3）
  const up = mkOpBtn("↑ 上移", () => moveAgent(-1), "往前移一位");
  up.disabled = idx <= 0;
  const down = mkOpBtn("↓ 下移", () => moveAgent(1), "往后移一位");
  down.disabled = idx >= n - 1;
  ops.appendChild(up);
  ops.appendChild(down);

  // 删除助手：红色危险样式，仅当 非默认 && 助手数 ≥ 2（§3.2）
  if (!agent.isDefault && n >= 2) {
    ops.appendChild(mkOpBtn("删除助手", openDeleteConfirm, "永久删除配置、记忆和对话记录", true));
  }
}

function mkOpBtn(text, onClick, title, danger) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-ghost op-btn" + (danger ? " btn-danger" : "");
  btn.textContent = text;
  btn.title = title || "";
  btn.addEventListener("click", onClick);
  return btn;
}

// 设为主助手：写 settings 命名空间 agent-presets.default（机制见后端 defaults.ts 调研结论）
async function setDefault() {
  const agent = currentAgent();
  if (!agent || agent.isDefault) return;
  try {
    const res = await fetch(`${API}/${agent.id}/default`, { method: "PUT" });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "设置失败");
    await refresh();
    toast(`「${agent.name}」已设为主助手，新会话默认使用 Ta`);
  } catch (e) {
    toast(e.message || "设置失败");
  }
}

// 上移 / 下移：前端算好完整顺序 → PUT /api/agents/order 重写 preset.yml 的 order
async function moveAgent(delta) {
  const agent = currentAgent();
  if (!agent) return;
  const i = state.agents.findIndex((a) => a.id === agent.id);
  const j = i + delta;
  if (j < 0 || j >= state.agents.length) return;
  const ids = state.agents.map((a) => a.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    const res = await fetch(`${API}/order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "排序失败");
    state.agents = data.agents || [];
    renderStack();
    renderDetail();
  } catch (e) {
    toast(e.message || "排序失败");
  }
}

/* ---------- 删除确认框（Hana 3.3：必须输入助手名字才能删） ---------- */
function openDeleteConfirm() {
  const agent = currentAgent();
  if (!agent) return;
  state.deleting = agent;
  $("#delete-confirm-name").textContent = agent.name;
  $("#delete-name").value = "";
  updateDeleteBtn();
  $("#delete-overlay").classList.remove("hidden");
  $("#delete-name").focus();
}

function closeDeleteConfirm() {
  $("#delete-overlay").classList.add("hidden");
  state.deleting = null;
}

function updateDeleteBtn() {
  const agent = state.deleting;
  const btn = $("#delete-submit");
  btn.disabled = !agent || $("#delete-name").value.trim() !== agent.name;
}

async function confirmDelete() {
  const agent = state.deleting;
  if (!agent) return;
  const btn = $("#delete-submit");
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/${agent.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "删除失败");
    closeDeleteConfirm();
    await refresh();
    toast(`「${agent.name}」已删除`);
  } catch (e) {
    toast(e.message || "删除失败");
    updateDeleteBtn();
  }
}

function renderSwitch(btn, on) {
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

/* ---------- 元选择器（编辑区，Hana 3.5：三 chip + kong 横幅） ---------- */
function renderYuanEditor(selected) {
  const wrap = $("#yuan-editor");
  wrap.innerHTML = "";

  // 三个 chip：头像 + 键名 + 描述 + 思考块标签
  for (const y of YUANS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "yuan-chip edit-chip" + (y.key === selected ? " selected" : "");
    chip.dataset.key = y.key;
    chip.title = y.desc;

    const img = document.createElement("img");
    img.src = `${ASSET}/avatars/${y.key}.png`;
    img.alt = y.key;

    const info = document.createElement("div");
    info.className = "echip-info";
    const k = document.createElement("div");
    k.className = "ykey";
    k.textContent = y.key;
    const d = document.createElement("div");
    d.className = "ydesc";
    d.textContent = y.desc;
    info.append(k, d);

    const tag = document.createElement("span");
    tag.className = "thought-tag";
    tag.textContent = y.tag;

    chip.append(img, info, tag);
    chip.addEventListener("click", () => changeYuan(y.key));
    wrap.append(chip);
  }

  // kong 横幅（无标签）
  const banner = document.createElement("button");
  banner.type = "button";
  banner.className = "kong-banner" + (selected === "kong" ? " selected" : "");
  banner.dataset.key = "kong";
  banner.title = KONG.desc;

  const bImg = document.createElement("img");
  bImg.className = "kong-bg";
  bImg.src = `${ASSET}/kong-banner.jpg`;
  bImg.alt = "";

  const bText = document.createElement("div");
  bText.className = "kong-text";
  const bK = document.createElement("div");
  bK.className = "kong-key";
  bK.textContent = "kong";
  const bD = document.createElement("div");
  bD.className = "kong-desc";
  bD.textContent = KONG_SHORT_DESC;
  bText.append(bK, bD);

  banner.append(bImg, bText);
  banner.addEventListener("click", () => changeYuan("kong"));
  wrap.append(banner);
}

async function changeYuan(yuan) {
  const agent = currentAgent();
  if (!agent || yuan === agent.yuan) return;
  try {
    const res = await fetch(`${API}/${agent.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yuan }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "保存失败");
    // 只换 yuan，identity/persona 文本不自动替换（与 Hana 一致）→ 不重填表单
    agent.yuan = data.agent.yuan;
    agent.hasAvatar = data.agent.hasAvatar;
    renderStack();
    renderYuanEditor(agent.yuan);
    $("#detail-avatar").src = avatarUrl(agent);
    const yuanMeta = [...YUANS, KONG].find((y) => y.key === agent.yuan) || YUANS[0];
    $("#detail-meta").textContent =
      `元：${yuanMeta.key} · 记忆：${agent.memoryEnabled ? "开" : "关"} · 经验：${agent.experienceEnabled ? "开" : "关"}`;
    toast("已切换元的底色，新建会话后生效");
  } catch (e) {
    toast(e.message || "切换失败");
  }
}

/* ---------- 名字（enter 保存） ---------- */
async function saveName() {
  const agent = currentAgent();
  if (!agent) return;
  const name = $("#detail-name").value.trim();
  if (!name) {
    toast("请输入助手名字");
    $("#detail-name").focus();
    return;
  }
  if (name === agent.name) return;
  try {
    const res = await fetch(`${API}/${agent.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "保存失败");
    agent.name = data.agent.name;
    renderStack();
    toast("名字已保存，新建会话后生效");
  } catch (e) {
    toast(e.message || "保存失败");
  }
}

/* ---------- 身份 / 人格保存（Hana 3.5：一个保存按钮） ---------- */
async function saveTa() {
  const agent = currentAgent();
  if (!agent || state.saving) return;
  state.saving = true;
  const btn = $("#save-ta");
  const status = $("#save-ta-status");
  btn.disabled = true;
  status.textContent = "保存中…";
  try {
    const res = await fetch(`${API}/${agent.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity: $("#identity-input").value,
        persona: $("#persona-input").value,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "保存失败");
    agent.identity = data.agent.identity;
    agent.persona = data.agent.persona;
    status.textContent = "已保存 ✓";
    toast(`「${agent.name}」的设定已保存，新建会话后生效`);
    setTimeout(() => (status.textContent = ""), 2600);
  } catch (e) {
    status.textContent = "";
    toast(e.message || "保存失败");
  } finally {
    state.saving = false;
    btn.disabled = false;
  }
}

/* ---------- 记忆 / 经验开关 ---------- */
async function toggleSwitch(field, btn) {
  const agent = currentAgent();
  if (!agent) return;
  const next = !agent[field];
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/${agent.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: next }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "保存失败");
    agent[field] = data.agent[field];
    renderSwitch(btn, agent[field]);
    if (field === "experienceEnabled") {
      renderExperiencePaused(agent[field]);
      loadExperience(agent.id);
    }
    toast(`${field === "memoryEnabled" ? "记忆" : "经验"}已${agent[field] ? "开启" : "关闭"}，新建会话后生效`);
  } catch (e) {
    toast(e.message || "保存失败");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 置顶记忆（增删，复用 soul 数据格式） ---------- */
async function loadPins(id) {
  const list = $("#pin-list");
  try {
    const res = await fetch(`${API}/${id}/pins`);
    const data = await res.json();
    renderPins(data.pins || []);
  } catch {
    list.innerHTML = "";
  }
}

function renderPins(pins) {
  const list = $("#pin-list");
  list.innerHTML = "";
  if (pins.length === 0) {
    const empty = document.createElement("li");
    empty.className = "pin-empty";
    empty.textContent = "还没有置顶记忆";
    list.append(empty);
    return;
  }
  for (const pin of pins) {
    const li = document.createElement("li");
    li.className = "pin-item";
    const text = document.createElement("span");
    text.className = "pin-content";
    text.textContent = pin.content;
    text.title = pin.content;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "pin-del";
    del.textContent = "✕";
    del.title = "删除这条置顶记忆";
    del.addEventListener("click", () => removePin(pin.id));
    li.append(text, del);
    list.append(li);
  }
}

async function addPin() {
  const agent = currentAgent();
  if (!agent) return;
  const input = $("#pin-input");
  const content = input.value.trim();
  if (!content) {
    toast("请输入要记住的内容");
    input.focus();
    return;
  }
  try {
    const res = await fetch(`${API}/${agent.id}/pins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "添加失败");
    input.value = "";
    renderPins(data.pins || []);
    toast(data.alreadyExists ? "这条已经记住啦" : "已记住，新建会话后生效");
  } catch (e) {
    toast(e.message || "添加失败");
  }
}

async function removePin(key) {
  const agent = currentAgent();
  if (!agent) return;
  try {
    const res = await fetch(`${API}/${agent.id}/pins/${encodeURIComponent(key)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "删除失败");
    renderPins(data.pins || []);
    toast("已删除这条置顶记忆");
  } catch (e) {
    toast(e.message || "删除失败");
  }
}

/* ---------- 经验分类（只读展示，§3.7；增删条目延后） ---------- */
function renderExperiencePaused(enabled) {
  $("#experience-paused").classList.toggle("hidden", enabled);
}

async function loadExperience(id) {
  const wrap = $("#experience-categories");
  try {
    const res = await fetch(`${API}/${id}/experience`);
    const data = await res.json();
    wrap.innerHTML = "";
    const categories = data.categories || [];
    if (categories.length === 0) {
      const empty = document.createElement("div");
      empty.className = "exp-empty";
      empty.textContent = "还没有经验记录";
      wrap.append(empty);
      return;
    }
    for (const cat of categories) {
      const block = document.createElement("details");
      block.className = "exp-block";
      const summary = document.createElement("summary");
      summary.textContent = `${cat.category}（${cat.entries.length} 条）`;
      const ul = document.createElement("ul");
      ul.className = "exp-entries";
      for (const entry of cat.entries) {
        const li = document.createElement("li");
        li.textContent = entry;
        ul.append(li);
      }
      block.append(summary, ul);
      wrap.append(block);
    }
  } catch {
    wrap.innerHTML = "";
  }
}

/* ---------- 记忆快照只读展示（Phase 4，§3.6） ---------- */
// 懒加载：details 首次展开时才 fetch（切换助手时重置加载标记）
function resetMemorySnapshot() {
  const details = $("#memory-snapshot");
  details.removeAttribute("open");
  details.dataset.loaded = "";
  $("#memory-snapshot-body").innerHTML = '<div class="ms-empty">展开后加载…</div>';
}

async function loadMemorySnapshot(id) {
  const body = $("#memory-snapshot-body");
  body.innerHTML = '<div class="ms-empty">加载中…</div>';
  let data;
  try {
    const res = await fetch(`${API}/${id}/memory`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "读取失败");
  } catch (e) {
    body.innerHTML = `<div class="ms-empty">记忆快照读取失败：${e.message || e}</div>`;
    return;
  }
  renderMemorySnapshot(data);
}

// 渲染记忆快照：四文件 <pre> 块 + memory.md 快照 + summaries 列表 + facts 统计（只读，不过度设计）
function renderMemorySnapshot(data) {
  const body = $("#memory-snapshot-body");
  body.innerHTML = "";

  // 1. 四文件快照（today/week/longterm/facts）
  const sectionLabels = [
    ["today", "今天（today.md）"],
    ["week", "本周早些时候（week.md）"],
    ["longterm", "长期情况（longterm.md）"],
    ["facts", "重要事实（facts.md）"],
  ];
  for (const [key, label] of sectionLabels) {
    const text = (data.sections && data.sections[key]) || "";
    body.appendChild(mkSnapshotBlock(label, text || "（暂无）"));
  }

  // 2. 组装快照 memory.md（有内容才显示）
  if (data.memoryMd && data.memoryMd.trim()) {
    body.appendChild(mkSnapshotBlock("组装快照（memory.md）", data.memoryMd));
  }

  // 3. facts.db 统计（只显示条数，不强行可视化）
  const factsRow = document.createElement("div");
  factsRow.className = "ms-facts";
  factsRow.textContent =
    data.factsDbExists
      ? `事实库 facts.db：${data.factsCount === null ? "存在但暂不可读" : `${data.factsCount} 条`}`
      : "事实库 facts.db：尚未生成（聊几天后由 Deep Memory 自动归档）";
  body.appendChild(factsRow);

  // 4. summaries/ 滚动摘要列表（文件名 + 更新时间，内容可展开）
  const summaries = data.summaries || [];
  if (summaries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ms-empty";
    empty.textContent = "还没有滚动摘要（聊满触发轮数后由运行时插件生成）";
    body.appendChild(empty);
  } else {
    const head = document.createElement("div");
    head.className = "ms-subhead";
    head.textContent = `滚动摘要（summaries/，${summaries.length} 个会话）`;
    body.appendChild(head);
    for (const s of summaries) {
      const item = document.createElement("details");
      item.className = "ms-summary-item";
      const sum = document.createElement("summary");
      const when = new Date(s.updatedAt);
      sum.textContent = `${s.sessionId} · ${when.toLocaleString()} · ${s.size} B`;
      const pre = document.createElement("pre");
      pre.className = "ms-pre";
      pre.textContent = s.content || "（空）";
      item.append(sum, pre);
      body.appendChild(item);
    }
  }
}

// 一个快照块：标题 + 等宽文本（<pre>，别过度设计）
function mkSnapshotBlock(label, text) {
  const block = document.createElement("div");
  block.className = "ms-block";
  const h = document.createElement("div");
  h.className = "ms-block-label";
  h.textContent = label;
  const pre = document.createElement("pre");
  pre.className = "ms-pre";
  pre.textContent = text;
  block.append(h, pre);
  return block;
}

/* ---------------- 新建对话框（Phase 1 保留） ---------------- */
function openCreate() {
  $("#create-overlay").classList.remove("hidden");
  const input = $("#create-name");
  input.value = "";
  input.focus();
  state.yuan = "hanako";
  renderYuanChips();
  $("#create-submit").disabled = false;
  $("#create-submit").textContent = "创建";
}

function closeCreate() {
  $("#create-overlay").classList.add("hidden");
}

function renderYuanChips() {
  const wrap = $("#yuan-chips");
  wrap.innerHTML = "";
  for (const y of [...YUANS, KONG]) {
    const chip = document.createElement("div");
    chip.className = "yuan-chip" + (y.key === state.yuan ? " selected" : "");
    chip.dataset.key = y.key;
    const img = document.createElement("img");
    img.src = `${ASSET}/avatars/${y.key}.png`;
    img.alt = y.key;
    const k = document.createElement("div");
    k.className = "ykey";
    k.textContent = y.key;
    const d = document.createElement("div");
    d.className = "ydesc";
    d.textContent = y.desc;
    chip.append(img, k, d);
    chip.addEventListener("click", () => {
      state.yuan = y.key;
      renderYuanChips();
    });
    wrap.append(chip);
  }
}

async function createAgent() {
  const name = $("#create-name").value.trim();
  if (!name) {
    toast("请输入助手名字");
    $("#create-name").focus();
    return;
  }
  if (state.creating) return;
  state.creating = true;
  const btn = $("#create-submit");
  btn.disabled = true;
  btn.textContent = "创建中…";
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, yuan: state.yuan }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast(data.error || "创建失败");
      return;
    }
    closeCreate();
    await refresh();
    toast(`${data.agent.name} 已创建 ✿`);
  } catch (e) {
    toast("创建失败：" + (e.message || e));
  } finally {
    state.creating = false;
    btn.disabled = false;
    btn.textContent = "创建";
  }
}

/* ---------------- 事件绑定 ---------------- */
$("#create-cancel").addEventListener("click", closeCreate);
$("#create-submit").addEventListener("click", createAgent);
$("#create-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") createAgent();
});
$("#create-overlay").addEventListener("click", (e) => {
  if (e.target === $("#create-overlay")) closeCreate();
});

/* ---------------- 从 Hana 转移（本地定制 v0.9.0） ---------------- */
const IMPORT_API = "/assistant-manager/api/import";
let importSources = [];
let importing = false;
let importFinished = false;

function openImportOverlay() {
  closeCreate(); // 从「新建助手」弹窗进来：先关掉它再开转移弹窗
  importFinished = false;
  const overlay = $("#import-overlay");
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const btn = $("#import-submit");
  btn.disabled = true;
  btn.textContent = "开始转移";
  $("#import-sub").textContent = "扫描本机 Hana 助手，勾选要搬进 dsh 的；转移后新会话生效。";
  $("#import-body").innerHTML = '<div class="import-empty">正在扫描本机 Hana 助手…</div>';
  fetch(`${IMPORT_API}/preview`)
    .then((r) => r.json())
    .then((d) => {
      importSources = d.sources || [];
      if (importSources.length === 0) {
        $("#import-body").innerHTML = '<div class="import-empty">没有发现可转移的 Hana 助手（本机 ~/.hanako/agents 下需有 AGENTS.md）。</div>';
        return;
      }
      renderImportList();
    })
    .catch((err) => {
      $("#import-body").innerHTML = '<div class="import-err">扫描失败：' + (err && err.message || err) + "</div>";
    });
}

function closeImportOverlay() {
  $("#import-overlay").classList.add("hidden");
  document.body.style.overflow = "";
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderImportList() {
  const rows = importSources.map((s) => {
    const av = s.hasAvatar
      ? '<img class="import-avatar" src="' + IMPORT_API + '/avatar?source=' + encodeURIComponent(s.id) + '" alt="">'
      : '<span class="import-avatar">' + escHtml(s.name.slice(0, 1)) + "</span>";
    const badge = s.target.mode === "update"
      ? '<span class="import-badge upd">更新 dsh「' + escHtml(s.target.name || s.target.id) + "」</span>"
      : '<span class="import-badge new">将新建</span>';
    return '<label class="import-row">'
      + '<input type="checkbox" class="src-check" value="' + escHtml(s.id) + '" checked>'
      + av
      + '<span class="import-info"><span class="n">' + escHtml(s.name) + "</span>"
      + '<span class="d">' + escHtml(s.id) + " · 记忆 " + s.memory.files.length + " 文件" + (s.memory.pins ? " + " + s.memory.pins + " 条置顶" : "") + " · 经验 " + s.expFiles + " 类" + (s.expEntries ? " " + s.expEntries + " 条" : "") + "</span></span>"
      + badge + "</label>";
  }).join("");
  $("#import-body").innerHTML = '<div class="import-list">' + rows + "</div>"
    + '<div class="import-opts">'
    + '<label><input type="checkbox" id="opt-memory" checked> 转移记忆<span class="opt-tip">facts / today / week / longterm + 置顶记忆，覆盖目标同名记忆</span></label>'
    + '<label><input type="checkbox" id="opt-exp" checked> 转移经验<span class="opt-tip">全部经验分类（' + importSources.reduce((n, s) => n + s.expFiles, 0) + " 个分类文件），覆盖目标同名分类</span></label>"
    + '<label style="color:var(--text-muted)"><input type="checkbox" id="opt-soul" checked disabled> 意识（必选）<span class="opt-tip">人格身份全文 + 头像，每次转移都会写入</span></label>'
    + "</div>";
  const submit = $("#import-submit");
  submit.disabled = false;
  const cbs = document.querySelectorAll("#import-body .src-check");
  const sync = () => { submit.disabled = !Array.from(cbs).some((c) => c.checked); };
  cbs.forEach((c) => c.addEventListener("change", sync));
}

async function runImport() {
  if (importing) return;
  // 完成态：主按钮变成「关闭」，点击关闭并刷新助手列表
  if (importFinished) {
    closeImportOverlay();
    await refresh();
    return;
  }
  const sel = Array.from(document.querySelectorAll("#import-body .src-check"))
    .filter((c) => c.checked)
    .map((c) => c.value);
  if (sel.length === 0) {
    toast("请先勾选要转移的助手");
    return;
  }
  importing = true;
  const btn = $("#import-submit");
  btn.disabled = true;
  btn.textContent = "转移中…";
  $("#import-sub").textContent = "正在把勾选的助手搬进 dsh，稍等…";
  let ok = false;
  try {
    const res = await fetch(IMPORT_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: sel,
        includeMemory: $("#opt-memory").checked,
        includeExperience: $("#opt-exp").checked,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "转移失败");
    ok = true;
    importFinished = true;
    $("#import-sub").textContent = "转移完成，dsh 新会话即使用新的助手配置。";
    const list = (d.results || []).map((r) => {
      if (r.error) return '<div class="rr err">✕ ' + escHtml(r.name + "（" + r.source + "）") + "：" + escHtml(r.error) + "</div>";
      const bits = [];
      bits.push("意识 " + (r.identityBytes > 1024 ? (r.identityBytes / 1024).toFixed(1) + "KB" : r.identityBytes + "B"));
      if (r.avatar) bits.push("头像✓");
      if (r.memory) bits.push("记忆 " + r.memory.files.length + " 文件 + " + r.memory.pins + " 条置顶");
      if (r.experience) bits.push("经验 " + r.experience.files + " 类 " + r.experience.entries + " 条");
      return '<div class="rr">✓ ' + escHtml(r.name + "（" + r.source + "）") + " → " + escHtml(r.target.id) + (r.target.mode === "update" ? "（更新）" : "（新建）") + " · " + escHtml(bits.join(" · ")) + "</div>";
    }).join("");
    $("#import-body").innerHTML = '<div class="import-result">' + list + "</div>";
  } catch (e) {
    $("#import-body").insertAdjacentHTML("beforeend", '<div class="import-err">转移失败：' + (e && e.message || e) + "</div>");
  } finally {
    importing = false;
    if (ok) {
      btn.disabled = false;
      btn.textContent = "关闭";
    } else {
      btn.disabled = false;
      btn.textContent = "开始转移";
    }
  }
}

$("#import-hana-btn").addEventListener("click", openImportOverlay);
$("#import-hana-btn-modal").addEventListener("click", openImportOverlay);
$("#import-cancel").addEventListener("click", closeImportOverlay);
$("#import-submit").addEventListener("click", runImport);
$("#import-overlay").addEventListener("click", (e) => {
  if (e.target === $("#import-overlay")) closeImportOverlay();
});

// 「我」tab（Phase 5）：tab 切换 + 头像（复用裁剪器）+ 名字/档案保存
document.querySelectorAll(".page-tab").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});
$("#me-avatar-wrap").addEventListener("click", openUserAvatarPicker);
$("#me-remove-avatar").addEventListener("click", (e) => {
  e.stopPropagation(); // 防止冒泡触发头像选择
  removeUserAvatar();
});
$("#me-save").addEventListener("click", saveMe);

// 移除头像（Phase 3）
$("#remove-avatar-btn").addEventListener("click", removeAvatar);

// 删除确认框（Phase 3）
$("#delete-cancel").addEventListener("click", closeDeleteConfirm);
$("#delete-submit").addEventListener("click", confirmDelete);
$("#delete-name").addEventListener("input", updateDeleteBtn);
$("#delete-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") confirmDelete();
});
$("#delete-overlay").addEventListener("click", (e) => {
  if (e.target === $("#delete-overlay")) closeDeleteConfirm();
});

// 头像裁剪（Phase 5）
$("#crop-cancel").addEventListener("click", closeCropOverlay);
$("#crop-submit").addEventListener("click", confirmCropUpload);
$("#crop-zoom-in").addEventListener("click", () => applyZoom(ZOOM_IN_FACTOR));
$("#crop-zoom-out").addEventListener("click", () => applyZoom(1 / ZOOM_IN_FACTOR));
// 滚轮缩放（overlay 内不滚动穿透：preventDefault + body overflow hidden）
$("#crop-overlay").addEventListener("wheel", (e) => {
  if (!CROP.img) return;
  e.preventDefault();
  applyZoom(e.deltaY < 0 ? ZOOM_IN_FACTOR : 1 / ZOOM_IN_FACTOR);
}, { passive: false });
// 点遮罩背景取消（与新建/删除框交互一致）
$("#crop-overlay").addEventListener("click", (e) => {
  if (e.target === $("#crop-overlay")) closeCropOverlay();
});

// 拖动图片调整裁剪位置（pointer capture 保证移出舞台仍跟手）
const cropImgEl = $("#crop-img");
cropImgEl.addEventListener("pointerdown", (e) => {
  if (!CROP.img) return;
  CROP.dragging = true;
  CROP.lastX = e.clientX;
  CROP.lastY = e.clientY;
  $("#crop-stage").classList.add("dragging");
  cropImgEl.setPointerCapture(e.pointerId);
});
cropImgEl.addEventListener("pointermove", (e) => {
  if (!CROP.dragging) return;
  const dx = e.clientX - CROP.lastX;
  const dy = e.clientY - CROP.lastY;
  CROP.lastX = e.clientX;
  CROP.lastY = e.clientY;
  const off = dragBy(CROP.offsetX, CROP.offsetY, dx, dy, CROP.img.naturalWidth, CROP.img.naturalHeight, CROP.scale, CROP.boxSize);
  CROP.offsetX = off.offsetX;
  CROP.offsetY = off.offsetY;
  renderCrop();
});
function endCropDrag() {
  if (!CROP.dragging) return;
  CROP.dragging = false;
  $("#crop-stage").classList.remove("dragging");
}
cropImgEl.addEventListener("pointerup", endCropDrag);
cropImgEl.addEventListener("pointercancel", endCropDrag);

// Esc 取消裁剪（不关闭其他对话框）
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#crop-overlay").classList.contains("hidden")) {
    closeCropOverlay();
  }
});

// 名字：enter 保存（§3.4）
$("#detail-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveName();
});
// 关于 Ta：保存按钮
$("#save-ta").addEventListener("click", saveTa);
// 开关
$("#memory-switch").addEventListener("click", (e) => toggleSwitch("memoryEnabled", e.currentTarget));
$("#experience-switch").addEventListener("click", (e) => toggleSwitch("experienceEnabled", e.currentTarget));
// 置顶记忆
$("#pin-add").addEventListener("click", addPin);
$("#pin-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPin();
});
// 记忆快照：首次展开时懒加载（Phase 4）
$("#memory-snapshot").addEventListener("toggle", (e) => {
  if (!e.target.open || e.target.dataset.loaded) return;
  const agent = currentAgent();
  if (!agent) return;
  e.target.dataset.loaded = "1";
  loadMemorySnapshot(agent.id);
});

loadModelDefault();
refresh().catch((e) => toast("加载失败：" + (e.message || e)));

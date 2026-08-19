# 更新日志

本项目所有值得记录的变更都会列在这里。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.1] - 2026-08-19

### 修复

- **README 修正**：标题统一为「小花记忆（DeepSeek Harness）」，与仓库名一致；安装命令 / 克隆 / 本地开发命令全部从已不存在的 dsh-assistant-manager 仓库修正为 DeepSeek-Harness-Hanako-Memory（此前用户照 README 安装会失败）
- **README 互推**：新增「想让 Ta 更活泼一点？」小节，推荐搭配表情包插件（DeepSeek-Harness-biaoqingbao）使用，每位助手单独设置自动联动

## [0.4.0] - 2026-08-18

### 新增

- **拟人工具卡（Hana 风格工具标题）**：soul 装配时为常用工具注册 presenter，工具卡渲染成「{助手名} 动作短语」三态（进行中 / 完成 / 失败），灵感来自 Hana 前端的工具标题映射（"小花 正在翻阅档案" / "小花 改好了" 这种）。
  - 覆盖 45 个工具：干活组（bash/read/edit/grep/glob/web 等）+ 表情包组（search_stickers/list_stickers/express 等）+ 记忆组（pin_memory/recall_experience 等）+ 视觉组（vision_*）。
  - 混合渲染：terminal 卡（bash/pwsh）命令保留为标题、拟人句放 description（渲染在卡上方）；diff 卡（write/edit）标题换拟人句、diff 内容原样保留；generic 卡（read 等）标题换拟人句、kind/locations 保留。
  - 实现：拿全局工具定义 → spread 复制 → 只覆盖 presentCall/presentResult（包装原 presenter）→ 注册回调用 agent 的 scope 层（preset 层 shadow，近者遮蔽远者），执行逻辑与 schema 完全不动；同 ctx 幂等（WeakSet），极简 ctx（无 tools.get）退化安全。
  - 开关：soul 配置 `toolTalk`（默认 true），关闭即完全恢复原生渲染。

### 测试

- `test/soul/tool-talk.test.js`：三态短语、混合渲染（terminal/diff/generic）、失败态兜底、原 execute/schema 保留、同 ctx 幂等、未注册工具跳过、`{name}` 占位符完整性（防手滑）。

### 新增（前端对话视图）

- **拟人工具卡前端渲染（`tool.call.toolview` slot）**：对话视图里工具行直接显示 presenter 算好的拟人 title（「🎭 小花 表情包发出去了」这类），不再回落到「TOOL / 工具名+参数」的干巴行。
  - 通过官方 keyed slot 接管（不 patch 核心）：注册 TALK_TABLE 中官方未注册的 33 个 generic 工具（表情包组、记忆组、视觉组、skill/job/goal 等），官方已注册的高阶行（bash/grep/read 等）保持官方组件——多数本就会消费 presenter 的拟人信息（read 的 label / grep 的 summary / bash 的 description）。
  - 卡片视觉对齐官方工具行（DisclosureRow 打底）：running 转圈 / 完成绿勾 / 失败红点，标题直接用 emoji+拟人句；展开看 IN 参数（等宽）与 OUT 输出（错误态红色），保留 Inspect 入口。
  - 接入位置：`client/client.js`（静态 bundle），测试钩子挂 `exports.toolTalk`。

### 测试

- `test/client/tool-talk-client.test.js`：接管 key 与服务端 TALK_TABLE 的差集一致性（含官方 key 防接管、豁免清单防回归）、running/ok/error/interrupted 四态模型推导、外窗截断标题回退、输出提取。


### 新增

- **「我」页面（Hana 同款）**：管理面板页头新增「我 / 助手们」tab 导航（默认「助手们」保持现状）。
  - 全局用户**名字**（hint：Ta 怎么称呼你）：写 `assistant-soul/user.yaml`，soul 运行时优先读取（`user.yaml` 的 name > 预设 `config.userName` > 默认「用户」，老预设不炸）。
  - 全局用户**档案**（8 行 textarea）：注入系统提示词新增 `assistant:user` section（order `-50`），排在助手身份/意识**之前**，与 Hana「user.md → identity → ishiki」顺序语义一致；档案为空时整段自动消失，不留空标题。
  - 全局用户**头像**：复用现有 crop.js 裁剪组件（纯几何、无角色概念，角色在裁剪层按「助手/用户」分发），居中圆形显示，无头像时 SVG 人形占位；落盘 `assistant-soul/user-avatar.png`（PNG 魔数校验）。
  - 保存逻辑照 Hana：名字变了才提交 name、档案变了才提交 profile、都没变 toast「没有更改」、成功 toast + 刷新数据。
  - 提示条沿用 session-note 风格：用户配置修改后**新建会话生效**，当前会话不受影响（dsh 机制，不能即时重建）。

### 后端 API（/assistant-manager 前缀）

- `GET /api/user`：读 `user.yaml` → `{ name, profile }`（缺失回落空）。
- `PUT /api/user`：部分更新 `{ name?, profile? }`（至少一个字段；空串合法：名字空 = 恢复默认称呼、档案空 = 清空）。
- `GET /api/user/avatar`：读 `user-avatar.png`，无文件 404（前端兜底 SVG 占位）。
- `POST /api/user/avatar`：`{ data: base64PNG }`，content-type 判扩展名 + PNG 魔数校验。
- `DELETE /api/user/avatar`：移除头像恢复占位。

### 变更

- soul 装配新增 `assistant:user` section（order `-50`）与 `user_profile` 变量；`user_name` 变量改为全局优先解析。
- 页面样式新增部分统一引用 `--dsw-alias-*` 设计变量（iframe 独立文档，`:root` 提供兜底定义，值映射现有米色系）。

### 分享版红线

- 「我」页面只读写用户自己的 `user.yaml` 与 `user-avatar.png`，绝不触碰任何助手的身份/预设文件。

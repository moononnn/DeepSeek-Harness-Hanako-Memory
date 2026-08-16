# 更新日志

本项目所有值得记录的变更都会列在这里。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-08-16

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

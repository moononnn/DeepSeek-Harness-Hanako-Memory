# 🧠 小花记忆（DeepSeek Harness）

> 把 Hana 的记忆系统与助手配置整个搬进 DeepSeek Harness，用网页管理你的助手预设。
>
> **作者：moononnn & 小花**

## ⚠️ 先看这里

- 本插件是 **dsh 生态**插件，需要 DeepSeek Harness（dsh）环境。管理界面与人格/记忆运行时已合成一个包（soul 为内置子模块），装一次全都有。
- 会读写你 dsh home 下的 `.agent-presets/` 与 `assistant-soul/` 目录：新建、编辑、删除助手预设；`assistant-soul/user.yaml` 与 `user-avatar.png` 是你的全局用户信息（「我」页面）。
- **删除助手会永久删除它的配置、记忆和对话记录**（删除前必须输入助手名字确认，默认助手和最后一个助手会被保护）。
- 配置修改（名字/身份/人格/元/开关/**用户配置**）**只影响此后新建的会话**，当前会话不受影响，这是 dsh 的机制。

## 这是干什么的？

我很喜欢openhanako「下文有该项目的github链接哈」的记忆系统啥的，所以她搬了过来！

她有好多功能！记忆系统只是其中之一，

让你像设置自家助手一样配置 dsh 预设**——点卡片新建助手、选性格「元」、写身份和人格、换头像、管记忆和经验，后台自动落成 dsh 预设，即插即用！

而且！新建的助手**自带思考意识块**（就是那种说话前先冒一段内心小剧场的模块），选不同性格会有不同的腔调，比如：

- `hanako` → **MOOD**（Vibe / Sparks / Reflections / Will）
- `butter` → **PULSE**（Vibe / Echo / Read / Will）
- `ming` → **沉思**（Premise / Conduct / Reflection / Act）
- `kong` → 没有意识块，直接回答

嗯，具体是什么感觉，你自己开个新会话试试就知道了，我不剧透太多 ✿

## 它能做什么

- ✨ **新建助手**：选元（四性格）+ 自动模板身份/人格，后台落成预设，**即建即见**（不用重启）
- 🧬 **元选择器**：四头像 + 描述 + 思考块标签 + kong 专属横幅
- ✏️ **编辑全字段**：名字、身份简介、人格定义（双 textarea + 保存）
- 🧠 **记忆区**：记忆总开关 + 置顶记忆增删（与运行时插件同格式，重启不丢）
- 📚 **经验区**：经验开关 + 分类只读列表
- ⇄ **从 Hana 转移助手**：一键扫描本机 Hana（~/.hanako/agents）的助手，逐个勾选把「意识（人格全文+头像）/ 记忆（四件套+置顶）/ 经验」搬进 dsh；dsh 侧同名助手自动更新、无则新建（yuan 元属性跟随源）
- 🖼️ **头像上传 + 裁剪**：正方形裁剪框、拖动调整、滚轮缩放、确认上传；可移除恢复元默认头像
- 🗑️ **删除助手**：输名字确认，默认/最后一个助手有保护
- 👑 **设为主助手**：写 dsh 原生 settings，新会话默认用它
- 🔼🔽 **排序**：上移/下移，顺序落盘持久
- 📖 **记忆快照只读查看**：today/week/longterm/facts + 滚动摘要列表 + facts 统计
- 🙋 **「我」页面（Hana 同款）**：全局用户名字 + 用户档案 + 用户头像（裁剪上传，SVG 占位）。名字与档案注入系统提示词（用户档案排在助手身份/意识**之前**），所有助手共享一份，一次修改全局生效

## 想让 Ta 更活泼一点？

配上 [表情包插件](https://github.com/moononnn/DeepSeek-Harness-biaoqingbao)，你的助手开心时会发猫猫图、委屈时会发抱抱图，还能每个助手各挑各的方言口音——表情包的「每位助手单独设置」会自动列出你在这里建的助手，方言、配图频率、配图开关各配各的，互不干扰。

装了这个，你的小花会更有趣哦 ✿

## 安装

dsh 插件标准姿势，一行命令（推荐从 GitHub 装，发布到 npm 后也可用 npm 包名）：

```bash
dsh plugin --profile web add github:moononnn/DeepSeek-Harness-Hanako-Memory
```

装完重启 dsh → 侧栏底部出现 👥「助手」按钮（或直接访问 `http://127.0.0.1:3080/assistant-manager/`）。

> 也可以先装插件商店再一键安装：
> ```bash
> dsh plugin --profile web add github:Ericwong5021/deepseek-plugin-store
> ```
> 启动 Web UI 后侧栏出现「插件商店」，搜到本插件点「直接安装到 DSH」即可。

本地开发时：

```bash
# 1. 克隆仓库
$ git clone https://github.com/moononnn/DeepSeek-Harness-Hanako-Memory

# 2. 安装依赖并构建
$ cd DeepSeek-Harness-Hanako-Memory && npm install && npm run build

# 3. link 进你的 dsh profile（如 profiles/web/package.json）
$ dsh plugin --profile web add link:/绝对路径/DeepSeek-Harness-Hanako-Memory
```

> 如果安装不生效，检查包的 `package.json` 是否有 `dsh.bundle` 声明——没有它 dsh 启动会直接崩，这是 dsh 的硬性要求。

## 隐私

- 所有数据都存在**本地** dsh home（`.agent-presets/` + `assistant-soul/`），不联网、无遥测、不上传任何东西。
- 「我」页面的用户信息（名字/档案/头像）只写 `assistant-soul/user.yaml` 与 `assistant-soul/user-avatar.png`，不触碰任何助手的身份/预设文件。
- 记忆编译调用的是你自己配置的模型（默认独立配置在预设的 `memory.model`，不吃主对话模型）。

## 兼容性

- Node.js ≥ 24（记忆快照统计用了内置 `node:sqlite`，零外部依赖）
- dsh 0.x（含 web profile）
- 无 npm 运行时依赖，纯原生实现

## 开发

```bash
npm test    # node --test，150 个用例（id/模板/yml 往返/CRUD/头像/删除保护/排序/设默认/记忆只读/裁剪逻辑/记忆六件套）
```

- 类型检查 + 构建：`npm run build`（tsc）
- 代码纪律：全命名导出（dsh 插件禁 `export default`）、写文件一律原子写、预设 yml 保持插件行列表结构

## 致谢

- 界面与交互灵感来自 [HanaAgent（openhanako）](https://github.com/liliMozi/openhanako) 的助手配置页，UI 规格照抄原版，力求同款体验
- 感谢 DeepSeek Harness 官方包提供的机制（agent-presets / settings / home-paths），让我能站在巨人肩膀上
- 测试与实机验证由「审查伙伴」协助完成

## 许可

MIT

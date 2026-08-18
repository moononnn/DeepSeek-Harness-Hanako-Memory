// 助手管理插件（DSH 静态 bundle 版）Client 半
// 参照 dsh-biaoqingbao 的 client 接入模式：ModuleLoader.load 注册，
// apply 里经 ctx.slots 注册侧栏底部按钮 + shell.overlay 浮层面板，
// 面板内容用 iframe 嵌入 /assistant-manager/（路径 B 自带的单页）。
//
// 拟人工具卡（tool.call.toolview slot）：接管 TALK_TABLE 中「官方未注册」的
// generic 工具（表情包 / 记忆 / 视觉 等 33 个），渲染成 Hana 式拟人小卡片
// （[emoji] 助手名 正在/完成/失败 的 title 直接读服务端 presenter 算好的
// callView/resultView），展开可看参数与输出。官方已注册的高阶工具行
// （bash/grep/edit/read 等）保持官方组件不接管，其中多数本就会显示
// presenter 的拟人标题（read 的 label / grep 的 summary / bash 的 description）。
// CSS 走手动插 style 标签 shim，颜色全部用 --dsw-alias-* 设计变量。
window.__ModuleLoader__.load({
  id: 'dsh-assistant-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let React = require('react')

    // ── 静态模式 shim：CSS 手动插 style 标签（面板内 iframe 自包含，无需 RPC） ──
    // 多次调用各自带独立 tagId，互不覆盖（am=管理面板 / tt=拟人工具卡）。
    const styles = {
      insert(css, tagId) {
        if (typeof document === 'undefined') return
        const sid = tagId || 'dsh-assistant-manager-css'
        if (document.querySelector('style[data-plugin-css="' + sid + '"]')) return
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-assistant-manager'
        tag.dataset.pluginCss = sid
        tag.textContent = css
        document.head.appendChild(tag)
      }
    }

    // ═══════════════ 拟人工具卡（tool.call.toolview） ═══════════════
    // 注册 key = src/soul/tool-talk.ts 的 TALK_TABLE 中「官方 toolview 已注册」之外的全部
    // 工具。官方 keyed 行本就会消费 presenter 的拟人信息（见上注释），接管会替换掉
    // 官方组件（keyed 替换语义），所以只接官方不回落的 generic 工具。
    // 官方已注册 key（dsh-client-ui-tool 当前版本）：bash/edit/write/read/grep/glob/
    // web_search/web_fetch/todo_write/ask_user_question——维护时若官方增删，同步差集。
    // ★ 撞车经验 2（2026-08-17）：不只官方包，生态插件也占 key！
    //   - biaoqingbao 已注册 express（ExpressCard 表情卡片，表情包插件的核心体验，绝不能抢）
    //   - @anionex/dsh-vision-toolkit 已注册 vision_ground/detect/trace/pixel_diff/crop/
    //     long_screenshot_ocr/extract_foreground/html_screenshot/dominant_colors（专家级
    //     坐标画布/调色板视图，比通用拟人卡专业）
    //   新增接管 key 前：全库 grep "tool.call.toolview" + 该工具名，确认无任何包注册过。
    const TOOL_TALK_KEYS = [
      'read_image',
      'job_list', 'job_output', 'job_kill',
      'create_goal', 'get_goal', 'update_goal',
      'ralph', 'ralph-loop', 'report',
      'send_message', 'interrupt_agent',
      'search_stickers', 'list_stickers', 'report_bad_match', 'update_sticker_tags',
      'pin_memory', 'unpin_memory', 'recall_experience', 'record_experience',
      'vision_toolkit_activate', 'vision_glance',
    ]

    // 从冻结的 block 推导拟人卡渲染模型（纯函数，测试钩子挂 exports.toolTalk）。
    // block 形态：running = RunningToolCall（无 kind 字段，带 callView/argsRaw）；
    // settled = ToolResultNode（带 kind，含 call/resultView/content/isError/error）。
    function toolTalkModel(toolName, block) {
      const done = typeof block === 'object' && block !== null && 'kind' in block
      const state = !done
        ? 'running'
        : block.error && block.error.code === 'interrupted' ? 'stopped'
        : block.isError === true ? 'error'
        : 'ok'
      const view = !done ? (block.callView || null) : (block.resultView || null)
      const title = (view && typeof view.title === 'string' && view.title !== '') ? view.title : toolName
      const argsRaw = (done ? (block.call ? block.call.argsRaw : null) : block.argsRaw) || ''
      const output = done ? textOf(block.content) : null
      const errorMessage = done && block.error ? (block.error.message || 'error') : null
      return { title, state, argsRaw, output, errorMessage, toolName }
    }

    // 合并 text 内容块（同官方 flattenContent：跳过非 text 块）。
    function textOf(content) {
      if (!Array.isArray(content)) return null
      const text = content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
      return text === '' ? null : text
    }

    // 状态徽标：running 转圈 / ok 绿勾 / error、stopped 官方 StateDot。
    function toolTalkIcon(state) {
      if (state === 'running') return React.createElement(IconLoadingOutline16, { size: 14, className: 'tt-spin' })
      if (state === 'ok') return React.createElement(IconCheckOutline16, { size: 14, className: 'tt-ok' })
      if (state === 'error') return React.createElement(StateDot, { state: 'error' })
      if (state === 'stopped') return React.createElement(StateDot, { state: 'warning' })
      return React.createElement(IconSparkle16, { size: 14 })
    }

    function toolTalkStatusText(state) {
      switch (state) {
        case 'running': return 'running'
        case 'error': return 'failed'
        case 'stopped': return 'stopped'
        default: return null
      }
    }

    // 拟人小卡片：DisclosureRow 打底（视觉严格对齐官方工具行），
    // 标题 = presenter 拟人句，展开显示 IN 参数 / OUT 输出 / 错误 / Inspect。
    function ToolTalkRow(props) {
      const { toolName, block, inspect } = props
      const [expanded, setExpanded] = React.useState(false)
      const model = toolTalkModel(toolName, block)
      const expandable = model.argsRaw !== '' || model.output !== null || model.errorMessage !== null
      const open = expanded && expandable
      const statusText = toolTalkStatusText(model.state)

      const body = React.createElement('div', { className: 'tt-body' },
        model.errorMessage !== null && React.createElement('div', { className: 'tt-ioCard tt-ioCard-error' },
          React.createElement('span', { className: 'tt-ioLabel' }, 'ERR'),
          React.createElement('span', { className: 'tt-ioText tt-ioText-error' }, model.errorMessage)
        ),
        model.argsRaw !== '' && React.createElement('div', { className: 'tt-ioCard' },
          React.createElement('span', { className: 'tt-ioLabel' }, 'IN'),
          React.createElement('span', { className: 'tt-ioText tt-ioText-mono' }, model.argsRaw)
        ),
        model.output !== null && React.createElement('div', { className: 'tt-ioCard' },
          React.createElement('span', { className: 'tt-ioLabel' }, 'OUT'),
          React.createElement('span', { className: 'tt-ioText' }, model.output)
        ),
        inspect !== undefined && React.createElement('button', {
          type: 'button',
          className: 'tt-inspect',
          onClick: inspect
        }, React.createElement(IconInspectOutline12, {}), 'Inspect')
      )

      return React.createElement('div', { className: 'tt-root', 'data-tool': toolName, 'data-state': model.state },
        statusText !== null && React.createElement('span', { className: 'tt-sr' }, statusText),
        React.createElement(DisclosureRow, {
          icon: toolTalkIcon(model.state),
          title: model.title,
          titleClassName: 'tt-title',
          open,
          expandable,
          expandOnRowClick: true,
          keepContentWhenOpen: true,
          onToggle: () => { setExpanded((v) => !v) },
          collapsedContent: React.createElement('span', { className: 'tt-summary' }, model.toolName),
          children: body
        })
      )
    }

    // ═══════════════ 管理面板（原功能） ═══════════════
    const apply = function apply(ctx) {
      const slots = ctx.slots !== undefined ? ctx.slots : ctx.get('slots')
      if (slots === undefined) return

      styles.insert(`
.am-sidebar-btn{background:none;border:none;color:inherit;cursor:pointer;font-size:13px;padding:4px 8px;font-family:inherit}
.am-sidebar-btn:hover{color:var(--dsw-alias-label-primary)}
.am-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:900}
.am-panel{position:fixed;top:0;right:0;bottom:0;width:480px;max-width:94vw;background:var(--dsw-alias-bg-overlay);border-left:1px solid var(--dsw-alias-border-l2);z-index:901;display:flex;flex-direction:column;box-shadow:-8px 0 24px rgba(0,0,0,.18)}
.am-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.am-panel-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.am-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:13px;cursor:pointer;font-family:inherit}
.am-btn:hover{background:var(--dsw-alias-bg-layer-1)}
.am-panel-body{flex:1;min-height:0;position:relative}
.am-frame{position:absolute;inset:0;width:100%;height:100%;border:none;background:var(--dsw-alias-bg-base)}
`, 'dsh-assistant-manager-css')

      // 拟人工具卡样式（tt- 前缀，打底用官方 DisclosureRow 自带样式）
      styles.insert(`
.tt-root{border-radius:6px}
.tt-title{color:var(--dsw-alias-label-primary)}
.tt-summary{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary);padding-right:2px}
.tt-ok{color:var(--dsw-alias-state-success-primary)}
.tt-spin{animation:tt-rotate .9s linear infinite}
@keyframes tt-rotate{to{transform:rotate(360deg)}}
.tt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tt-body{display:flex;flex-direction:column;gap:6px;padding:2px 4px 8px 40px}
.tt-ioCard{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);padding:6px 8px;font-size:12px;min-width:0}
.tt-ioCard-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.tt-ioLabel{flex:none;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary);margin-top:1px;letter-spacing:.4px}
.tt-ioText{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;line-height:1.5;min-width:0}
.tt-ioText-error{color:var(--dsw-alias-state-error-primary)}
.tt-ioText-mono{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11px}
.tt-inspect{display:inline-flex;align-items:center;gap:4px;border:none;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer;padding:2px 0;font-family:inherit;align-self:flex-start}
.tt-inspect:hover{color:var(--dsw-alias-label-primary)}
`, 'dsh-assistant-manager-tt-css')

      // ── 共享状态（面板开合） ──
      const store = {
        open: false,
        listeners: new Set(),
        emit() { for (const fn of [...this.listeners]) { try { fn() } catch (e) {} } },
        subscribe(fn) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } },
      }

      function useStore() {
        const [, setTick] = React.useState(0)
        React.useEffect(() => store.subscribe(() => setTick(t => t + 1)), [])
        return store
      }

      // ═══════════════ 浮层面板（iframe 嵌入 /assistant-manager/） ═══════════════
      function OverlayPanel(props) {
        const s = useStore()
        if (!s.open) return null
        return React.createElement('div', { className: 'am-root' },
          React.createElement('div', { className: 'am-backdrop', onClick: () => { s.open = false; s.emit() } }),
          React.createElement('div', { className: 'am-panel' },
            React.createElement('div', { className: 'am-panel-header' },
              React.createElement('span', { className: 'am-panel-title' }, '助手管理'),
              React.createElement('button', { className: 'am-btn', onClick: () => { s.open = false; s.emit() } }, '✕')
            ),
            React.createElement('div', { className: 'am-panel-body' },
              React.createElement('iframe', { className: 'am-frame', src: '/assistant-manager/', title: '助手管理' })
            )
          )
        )
      }

      // ═══════════════ 侧栏入口 ═══════════════
      function SidebarButton(props) {
        const s = useStore()
        return React.createElement('button', {
          className: 'am-sidebar-btn',
          title: '助手管理',
          onClick: () => { s.open = !s.open; s.emit() }
        }, props && props.wide ? '助手' : '👥')
      }

      // ═══════════════ 注册：拟人工具卡（keyed，官方模块的 toolview slot） ═══════════════
      slots.inject('tool.call.toolview', function* () {
        for (const key of TOOL_TALK_KEYS) {
          yield slots.register(
            { name: 'tool.call.toolview', key },
            (props) => React.createElement(ToolTalkRow, props)
          )
        }
      })

      // ═══════════════ 注册：管理面板 ═══════════════
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'assistant-manager-panel' },
        (props) => React.createElement(OverlayPanel, props)
      ))
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'assistant-manager' },
        (props) => React.createElement(SidebarButton, props)
      ))
    }

    // ── primitives 组件引用（组件体内才用，node 测试 require 空对象不崩） ──
    const IconLoadingOutline16 = require('@deepseek-ai/dsh-client-ui-primitives').IconLoadingOutline16
    const IconCheckOutline16 = require('@deepseek-ai/dsh-client-ui-primitives').IconCheckOutline16
    const IconSparkle16 = require('@deepseek-ai/dsh-client-ui-primitives').IconSparkle16
    const IconInspectOutline12 = require('@deepseek-ai/dsh-client-ui-primitives').IconInspectOutline12
    const StateDot = require('@deepseek-ai/dsh-client-ui-primitives').StateDot
    const DisclosureRow = require('@deepseek-ai/dsh-client-ui-primitives').DisclosureRow

    // ── 测试/调试钩子：模型推导与 key 清单（后续实机可 console 自由调用） ──
    exports.toolTalk = { TOOL_TALK_KEYS, model: toolTalkModel }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})
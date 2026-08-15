// 助手管理插件（DSH 静态 bundle 版）Client 半
// 参照 dsh-biaoqingbao 的 client 接入模式：ModuleLoader.load 注册，
// apply 里经 ctx.slots 注册侧栏底部按钮 + shell.overlay 浮层面板，
// 面板内容用 iframe 嵌入 /assistant-manager/（路径 B 自带的单页）。
// CSS 走手动插 style 标签 shim，颜色全部用 --dsw-alias-* 设计变量。
window.__ModuleLoader__.load({
  id: 'dsh-assistant-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let React = require('react')

    // ── 静态模式 shim：CSS 手动插 style 标签（面板内 iframe 自包含，无需 RPC） ──
    const styles = {
      insert(css) {
        if (typeof document === 'undefined') return
        const tagId = 'dsh-assistant-manager-css'
        if (document.querySelector('style[data-plugin-css="' + tagId + '"]')) return
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-assistant-manager'
        tag.dataset.pluginCss = tagId
        tag.textContent = css
        document.head.appendChild(tag)
      }
    }

    // ── 组件代码 ──
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
`)

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

      // ═══════════════ 注册 ═══════════════
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'assistant-manager-panel' },
        (props) => React.createElement(OverlayPanel, props)
      ))
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'assistant-manager' },
        (props) => React.createElement(SidebarButton, props)
      ))
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})

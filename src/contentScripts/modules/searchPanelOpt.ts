import { get, onConfigChange } from '../config'

/**
 * 搜索面板优化（设置面板「界面优化」里的独立开关）
 * - 把点击顶栏搜索框弹出的「搜索历史 / 热搜」面板换成改版样式（样式在 topbar.css）
 * - 面板的「弹出 / 收回」动画绑定在本功能下：只有开启本功能、改用我们的面板样式后
 *   才会有动画（默认面板不再带任何动画）
 *
 * 这里只负责开合状态：B 站用行内 style 的 display 切换显隐（关闭时 display:none，
 * 开启时清除），而 display 的切换无法过渡。topbar.css 里已把面板强制常驻
 * display:block，于是这里读取 B 站写在行内的 display 判断开合、切换
 * .bili-elite-sp-open，由 CSS 过渡出弹出 / 收回两个方向的动画。接管的面板同时打上
 * .bili-elite-sp-managed 标记，样式里的「常驻 + 动画」只对它生效 —— 脚本没接上时
 * 退回 B 站原生行为。
 *
 * 注：「搜索历史」不再折叠。历史区固定为原来的展开高度（172px = 4 行），装不下的
 * 历史直接在区内上下滚动；B 站原生的「展开更多 / 收起」按钮由 topbar.css 隐藏，
 * 本模块也不再自绘折叠控件（原先那套是为了绕开 B 站首次打开时的测量 bug）。
 */

const ROOT_OPT = 'bili-elite-searchpanel-opt'
/** 已接管的标记：topbar.css 里「常驻 display + 动画」只对该类生效（脚本没接上就退回原生行为） */
const MANAGED_CLASS = 'bili-elite-sp-managed'
const OPEN_CLASS = 'bili-elite-sp-open'

const PANEL_SELECTOR
  = '.bili-header .center-search-container .center-search__bar .nav-search-panel'

let panel: HTMLElement | null = null
let panelObserver: MutationObserver | null = null
let docObserver: MutationObserver | null = null

/** B 站关闭面板时把行内 style.display 设为 'none'，开启时清空 */
function syncOpenClass() {
  if (!panel) return
  panel.classList.toggle(OPEN_CLASS, panel.style.display !== 'none')
}

function attach(target: HTMLElement | null) {
  if (target === panel) return
  panelObserver?.disconnect()
  panelObserver = null
  panel?.classList.remove(MANAGED_CLASS, OPEN_CLASS)
  panel = target
  if (target) {
    target.classList.add(MANAGED_CLASS)
    // 只关心 B 站写开合状态的行内 style：历史词条的增删不再影响任何逻辑
    panelObserver = new MutationObserver(() => syncOpenClass())
    panelObserver.observe(target, {
      attributes: true,
      attributeFilter: ['style'],
    })
    syncOpenClass()
  }
}

/** 面板由 B 站（Vue）动态创建 / 整块替换，需要重新查找 */
function collect() {
  const target = document.querySelector<HTMLElement>(PANEL_SELECTOR)
  if (target) attach(target)
  else if (panel) attach(null)
}

export function setupSearchPanelOpt(): () => void {
  const applyRoot = (enabled: boolean) => {
    document.documentElement.classList.toggle(ROOT_OPT, enabled)
  }
  applyRoot(get('searchPanelOpt'))

  collect()
  // 回调里只在面板缺失或已脱离文档时才重新查找，开销很小
  docObserver = new MutationObserver(() => {
    if (!panel || !panel.isConnected) collect()
  })
  docObserver.observe(document.documentElement, { childList: true, subtree: true })

  const off = onConfigChange((key) => {
    if (key !== 'searchPanelOpt') return
    applyRoot(get('searchPanelOpt'))
    collect()
  })

  return () => {
    off()
    panelObserver?.disconnect()
    docObserver?.disconnect()
    panelObserver = null
    docObserver = null
    if (panel) panel.classList.remove(MANAGED_CLASS, OPEN_CLASS)
    panel = null
    document.documentElement.classList.remove(ROOT_OPT)
  }
}

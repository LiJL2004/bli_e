/**
 * 搜索页分类标签栏（综合 / 视频 / 番剧 …）的滑动指示条 + 切换时内容淡入。
 *
 * 样式本体在 searchOptimize.css「分类标签栏」段（跟「搜索页优化」开关走）：文字标签 +
 * 底线 + 3px 蓝条，参数照用户给的 Google 风格 demo（.tabs / .tab / .tab-indicator /
 * .tab-panel.active）。纯 CSS 做不了的两件事在这里：
 *   1. **指示条跟着选中项滑**：读选中 li 的 offsetLeft / offsetWidth 写 translateX / width；
 *   2. **切换标签时结果区 fadeUp**：选中项变了就给 .search-content 挂一下 .blie-tab-fade。
 * （vui 组件库自带滑动条 .vui_tabs--nav-slider —— ul 的兄弟节点，B 站 JS 写内联 left/width，
 *   宽只有文字宽；它和新指示条会叠成一根粗条，searchOptimize.css 里把它 display:none 了。）
 *
 * 位置更新时机：
 * - 标签栏出现 / 整块被换掉（搜索页是 SPA，但 .search-tabs 节点通常不换）：盯 html 的
 *   childList，回调里只比一下 .search-tabs 是不是同一个节点，一样就直接返回；
 * - 选中项变化、指示条被页面重渲染踢掉：盯 .search-tabs 子树的 class 变化与子节点增删；
 * - **标签栏刚挂出来那一刻可能还没布局（宽 0）**——v027 修：以前这时量到 0 就把 width
 *   写死成 0，后面 .search-tabs 内部再无变动就永远是 0（用户看到「没有蓝色条」）。
 *   现在宽为 0 时不写：ResizeObserver 盯着 nav 等它有尺寸再量，另逐帧兜底最多 2 秒，
 *   字体加载完也补一次（字体晚到会改标签宽度）；
 * - 窗口尺寸变化。
 *
 * 首次定位不走过渡（`is-init` 一帧）：否则指示条会从最左边「滑」到选中项。
 */
import { get, onConfigChange } from '../config'
import { EventBag } from '../eventBag'

const HOST = 'search.bilibili.com'
const ROOT_SEL = '.search-tabs'
const NAV_SEL = '.vui_tabs--nav'
const ACTIVE_SEL = '.vui_tabs--nav-item-active'
const CONTENT_SEL = '.search-content'
/** 指示条节点（searchOptimize.css 里的 `.blie-tab-indicator`） */
const IND_CLASS = 'blie-tab-indicator'
/** 首帧无过渡的标记 */
const INIT_CLASS = 'is-init'
/** 结果区淡入的类（searchOptimize.css 里的 `.search-content.blie-tab-fade`） */
const FADE_CLASS = 'blie-tab-fade'
/** 宽为 0 时逐帧重试的上限（约 2 秒） */
const RETRY_FRAMES = 120

export function setupSearchTabs(): () => void {
  if (location.hostname !== HOST)
    return () => {}

  const bag = new EventBag()
  let root: HTMLElement | null = null
  let nav: HTMLElement | null = null
  let ind: HTMLElement | null = null
  /** 上一轮的选中项，变了才给结果区做淡入 */
  let lastActive: HTMLElement | null = null
  let retryFrame = 0

  /** 标签栏在位后，只盯它自己的子树：选中项换 class、指示条被踢掉、或它内部重渲染 */
  const watcher = new MutationObserver(() => onTabsChanged())
  bag.observe(watcher)
  /** 标签栏从「没布局」到「有布局」时重量一次 */
  const sizeWatch = new ResizeObserver(() => sync())
  bag.add(() => sizeWatch.disconnect())

  function cancelRetry(): void {
    cancelAnimationFrame(retryFrame)
    retryFrame = 0
  }

  /** 量一次。返回「量到的尺寸是否有效」—— 刚挂出来还没布局时 offsetWidth 是 0，这时不能写 width: 0 */
  function measure(): boolean {
    if (!nav || !ind)
      return false
    const active = nav.querySelector<HTMLElement>(`:scope > ${ACTIVE_SEL}`)
    if (!active || active.offsetWidth === 0)
      return false
    ind.style.width = `${active.offsetWidth}px`
    ind.style.transform = `translateX(${active.offsetLeft}px)`
    cancelRetry()
    return true
  }

  /** 宽为 0 时的兜底：逐帧重试，最多 RETRY_FRAMES 帧 */
  function retry(): void {
    if (retryFrame)
      return
    let left = RETRY_FRAMES
    const step = () => {
      retryFrame = 0
      if (!ind || measure() || --left <= 0)
        return
      retryFrame = requestAnimationFrame(step)
    }
    retryFrame = requestAnimationFrame(step)
  }

  function sync(): boolean {
    const ok = measure()
    if (!ok && ind)
      retry()
    return ok
  }

  function detach(): void {
    ind?.remove()
    ind = null
  }

  /** demo .tab-panel.active：切换标签时结果区淡入 + 上移 8px（.38s） */
  function fadeContent(): void {
    const content = document.querySelector<HTMLElement>(CONTENT_SEL)
    if (!content)
      return
    content.classList.remove(FADE_CLASS)
    void content.offsetWidth
    content.classList.add(FADE_CLASS)
  }

  /** 标签栏换了节点 / 开关变了：重新决定要不要挂指示条，并把观察器对准当前的标签栏 */
  function apply(): void {
    const nextRoot = document.querySelector<HTMLElement>(ROOT_SEL)
    const next = nextRoot?.querySelector<HTMLElement>(NAV_SEL) || null
    if (nextRoot !== root || next !== nav) {
      detach()
      root = nextRoot
      nav = next
    }
    // 指示条被页面的重渲染踢掉了：节点对象还在手里，但已经不在文档里 —— 重新挂一个
    if (ind && !ind.isConnected)
      detach()
    if (root) {
      // observe() 对同一个 observer 重复调用是「替换目标」，不会叠多个
      watcher.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    }
    if (nav) {
      sizeWatch.disconnect()
      sizeWatch.observe(nav)
    }
    if (!get('searchOptimize') || !nav) {
      detach()
      return
    }
    if (ind)
      return
    ind = document.createElement('span')
    ind.className = `${IND_CLASS} ${INIT_CLASS}`
    nav.appendChild(ind)
    sync()
    // 量完再放开过渡：下一帧去掉标记，之后的切换才会滑
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ind?.classList.remove(INIT_CLASS)
      })
    })
  }

  /** 标签栏有变动：重挂 / 对位，选中项变了再让结果区淡入 */
  function onTabsChanged(): void {
    apply()
    if (!nav)
      return
    const active = nav.querySelector<HTMLElement>(`:scope > ${ACTIVE_SEL}`)
    if (active !== lastActive) {
      // 第一次是页面刚打开，不算「切换」，不做淡入
      if (lastActive !== null)
        fadeContent()
      lastActive = active
    }
    sync()
  }

  apply()

  // 标签栏出现 / 整块被换掉：盯 html 的子节点增删（document_start 时 body 可能还没有），
  // 回调里只做一次「还是不是同一个 .search-tabs」的比较，是就直接返回
  const waiter = new MutationObserver(() => {
    if (document.querySelector(ROOT_SEL) === root)
      return
    onTabsChanged()
  })
  waiter.observe(document.documentElement, { childList: true, subtree: true })
  bag.observe(waiter)

  bag.add(onConfigChange((key) => {
    if (key === 'searchOptimize')
      onTabsChanged()
  }))
  bag.on(window, 'resize', sync)
  bag.on(window, 'load', onTabsChanged)
  if (document.fonts?.ready)
    document.fonts.ready.then(() => sync()).catch(() => {})

  return () => {
    cancelRetry()
    detach()
    bag.dispose()
  }
}

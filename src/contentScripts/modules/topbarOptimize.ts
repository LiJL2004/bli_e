import { get, onConfigChange } from '../config'
import { HOME_PANEL_GZIP_B64 } from './homePanelData'
import { getPreloadParams, onPreloadParamsChange } from './preloadConfig'
import {
  getSearchBoxParams,
  getSearchPanelParams,
  onSearchBoxParamsChange,
  onSearchPanelParamsChange,
} from './searchConfig'
import { getTopbarParams, onTopbarParamsChange } from './topbarConfig'
import topbarCss from './topbar.css?inline'

/**
 * 顶栏优化（作用范围：B 站所有页面的顶栏）
 * - 顶栏左上角统一成「bilibili logo + 首页 ∨ 动态」：
 *   保留原生「首页」，把原生的「番剧」就地改名成「动态」（沿用同一元素，
 *   因此字号 / 位置 / 行高与原生番剧完全一致），再隐藏
 *   直播 / 游戏中心 / 会员购 / 漫画 / 赛事 / 下载客户端 等按钮
 * - 给「首页」补上和迷你顶栏完全同款的 SVG 下拉箭头（改用 CSS 伪元素绘制，
 *   顶部 / 下滑切换时「首页」节点被整块替换也不会消失），并在页面顶部
 *   （大顶栏）也能展开与迷你顶栏一致的频道面板
 * - 顶栏始终 fixed 固定在页面最顶部，禁用滑入动画与过渡（下滑不闪、不变化）
 * - 例外：个人空间（space.bilibili.com 的全部子页面）、历史记录
 *   （www.bilibili.com/history）与直播站（live.bilibili.com）整条顶栏保持 B 站原版
 *   —— 本模块在这几类页面上整套不生效：不注入 topbar.css、不挂根类、不插自绘
 *   logo / 骨架栏、也不下移吸顶子栏（见 topbar.css §15），顶栏区域完全交给 B 站。
 *   直播页只保留「动效增强」里的网页全屏 / 全屏关闭动画（见 videoFullscreen.ts）
 * - 首屏骨架栏在「其它子站（游戏 / 商城 / 漫画…）的顶栏出现」后也会退场
 *   （否则它会一直盖在子站真正的顶栏上面）
 * - 页面级「吸顶子栏」（个人空间顶部的 .nav-bar.space-navbar、历史记录页的
 *   .main-breadcrumbs…）原本贴在页面最顶部，会被我们的 fixed 顶栏整条盖住；
 *   这里统一把它们下移到顶栏下方（top: 64px）—— 子栏重新可见，顶栏的毛玻璃也
 *   重新采到「正在滚动的页面内容」，而不是那块静止的子栏
 * - B 站 Vue 接管前会短暂渲染一版旧顶栏（.bili-header.fixed-header /
 *   .bili-header__bar.mini-header）：把它的内容藏起来、只留一条与新版一致的空白栏，
 *   既不会看到「旧版顶栏残留」，顶部也不会空一块显得「顶栏加载慢」
 * - 首屏另有一条由脚本即时插入的骨架栏（#bili-elite-topbar-skeleton），
 *   只画品牌 logo，等新版顶栏导航就位后自动隐藏；这样顶栏的「观感加载」
 *   不再受 B 站各处 JS 快慢影响（播放页尤其明显）
 * - 搜索栏强制水平居中
 * - 右侧图标区（大会员 / 消息…）行高统一成首页的数值，消除搜索页等
 *   （.white-bg-bar）带来的细微上下偏移
 * - 右侧精简：隐藏「大会员」与「创作中心」，其余控件自动向右补位（间隔不变）；
 *   「投稿」按钮还原成原版的白色文字 / 图标
 * - 搜索页：页面自带的搜索框并入顶栏中央（顶栏自带的搜索框在搜索页被 B 站隐藏，
 *   这里重新显示），「综合 / 视频…」分类栏上提到顶栏正下方，避免我们固定的
 *   顶栏与 B 站滚动后出现的吸顶搜索条重叠
 * - 仅首页（大顶栏）：移除大图横幅与整条分类栏（.bili-header__channel / .header-channel）
 * - 播放页右栏（弹幕列表下方）的空白占位 #slide_ad 一并收起
 * - 由「首页优化」开关额外控制：屏蔽视频卡片悬停时浮出的「稍后再看」按钮
 *   （封面右上角那枚 .bili-watch-later--wrap，以及卡片右下角操作区里的
 *   .watchlater-pip-button），并去掉推荐流里混进来的特殊卡片 —— 「番剧 / 直播 /
 *   国创 / 综艺 / 课堂 / 电影 / 电视剧 / 纪录片 / 漫画 / 赛事」等 B 站「楼层卡」
 *   （.floor-single-card）与直播间卡片（.bili-live-card）
 * - 「首页预加载」开关：把加载哨兵 .load-more-anchor 视觉上抬，让 B 站「快滚到底
 *   才加载」的判定提前触发，还没滚到就已经把下一批推荐内容取回来；上抬多少由
 *   设置面板的「预加载范围」滑块控制（preloadConfig.ts）。
 *   另外配一个保活定时器：B 站的判据只挂在 window scroll 上（节流 200ms），用户停住
 *   不动就再也不会重新判定，于是栅格尾部那批空占位骨架会一直挂着；定时补发 scroll
 *   事件把判定叫醒，内容补回来后哨兵被顶出触发范围，循环自然停下
 * - 「卡片边界」/「卡片确认」六个开关：三个页面（首页 / 搜索页 / 视频页右栏）× 两个效果，
 *   各自独立。同一个页面里，「边界」是平时那圈灰色描边，「确认」是悬停时的灰色衬底 +
 *   蓝色描边，两者也互不依赖。样式本体在 topbar.css §12，本文件只负责切 root class
 *   （见 CARD_SCOPE_CLASSES）。
 *
 * 样式本体在 topbar.css（本文件只负责开关、注入与动态补节点）。
 * 另有三种可选材质（设置面板「高级材质」里的独立开关）：
 * - 「顶栏材质」：把顶栏换成带边缘阴影的 iOS 风格毛玻璃；
 * - 「搜索框材质」：把顶栏中央的搜索框换成毛玻璃；
 * - 「搜索面板材质」：把点击搜索框弹出的「搜索历史 / 热搜」面板换成毛玻璃。
 * 该面板的改版样式与「弹出 / 收回」动画属于「界面优化 → 搜索面板优化」，
 * 由 searchPanelOpt.ts 负责（默认面板不再带任何动画）。
 * 各材质的模糊 / 遮罩强度均由设置面板滑块控制（CSS 变量写在根节点，所有页面统一取值）。
 */

const STYLE_ID = 'bili-elite-topbar-style'
const ROOT_HOME = 'bili-elite-home-opt'
/** 「首页优化」：仅首页（大顶栏）去大图横幅 / 分类栏（顶栏改造本身始终生效） */
const ROOT_HOME_ONLY = 'bili-elite-home-only'
const ROOT_GLASS = 'bili-elite-glass'
/** 「搜索框材质」——顶栏中央搜索框的毛玻璃开关 */
const ROOT_SEARCHBOX_GLASS = 'bili-elite-searchbox-glass'
/** 「搜索面板材质」——点击搜索框弹出的「搜索历史 / 热搜」面板的毛玻璃开关 */
const ROOT_SEARCHPANEL_GLASS = 'bili-elite-searchpanel-glass'
/** 「首页预加载」——提前把首页推荐流屏幕下方的下一批内容取回来 */
const ROOT_PRELOAD = 'bili-elite-preload'
/** 「播放页右栏留白收起」/「顶部提示条收起」：只切 root class，纯 CSS 生效（无需 JS 观察器） */
const ROOT_RAIL_COMPACT = 'bili-elite-rail-compact'
const ROOT_NOTICE_COMPACT = 'bili-elite-notice-compact'

/** 「奶睿顶栏图」——把左上角自绘字标换成奶睿形象 */
const ROOT_MASCOT_LOGO = 'bili-elite-mascot-logo'
/**
 * 「卡片边界」/「卡片确认」：三个页面 × 两个效果 = 六个独立开关，一个开关一个 root class。
 * 表格化是因为它们除了类名不同之外行为完全一样（都只切 class、纯 CSS 生效）。
 */
const CARD_SCOPE_CLASSES = {
  cardBorderHome: 'bili-elite-card-border-home',
  cardConfirmHome: 'bili-elite-card-confirm-home',
  cardBorderSearch: 'bili-elite-card-border-search',
  cardConfirmSearch: 'bili-elite-card-confirm-search',
  cardBorderVideo: 'bili-elite-card-border-video',
  cardConfirmVideo: 'bili-elite-card-confirm-video',
} as const satisfies Record<string, string>
const LOGO_ID = 'bili-elite-logo'
const SKELETON_ID = 'bili-elite-topbar-skeleton'
const PANEL_ID = 'bili-elite-home-panel'
const DYNAMIC_CLASS = 'bili-elite-dynamic'
/** 顶栏右侧需要隐藏的控件（如「创作中心」）由脚本就地打标记 */
const HIDDEN_RIGHT_CLASS = 'bili-elite-hidden-right'
/** 子站顶栏就位（首屏骨架栏退场）标记，见 topbar.css §1.2 */
const ROOT_TOPBAR_READY = 'bili-elite-topbar-ready'
/** 页面级「吸顶子栏」标记，由脚本就地打上，见 topbar.css §15 */
const UNDER_TOPBAR_CLASS = 'bili-elite-under-topbar'

/** 页面级容器选择器：只扫 body 往下 6 层（几十~一两百个元素），代价可忽略 */
const PAGE_LEVEL_SELECTOR
  = 'body > *, body > * > *, body > * > * > *, body > * > * > * > *, body > * > * > * > * > *, body > * > * > * > * > * > *'

/**
 * 页面级横条的「便宜前置过滤」。
 *
 * PAGE_LEVEL_SELECTOR 是「body 往下 6 层」，在首页等于整页 9000+ 个节点。对每个节点
 * 调 getComputedStyle() 会强制样式重算，而 sync() 在信息流滚动时最多每 200ms 跑一次 ——
 * 实测这一项把空闲主线程占用从 0.6% 拉到 24%。要判定的是「吸顶横条」，这类节点的
 * class 一定带 bar / nav / header / breadcrumb / tab 之类的词，先按名字过滤一遍，
 * 9000 → 一两百，剩下的才值得去问样式。
 */
const BAR_HINT = /bar|nav|header|breadcrumb|tab/i

function looksLikeBar(el: HTMLElement): boolean {
  const cls = el.className
  return typeof cls === 'string' && BAR_HINT.test(cls)
}

/**
 * 页面级横条扫描：把「子站顶栏是否就位」与「吸顶子栏下移」合成一件事，整体节流到
 * 每秒最多一次。这两件事的结果在页面内基本不变，骨架栏晚 1s 收起肉眼无感，
 * 但省掉了滚动时每 200ms 一次的全页样式重算。
 */
let layoutScanAt = 0

function scanPageBars() {
  const now = performance.now()
  if (now - layoutScanAt < 1000) return
  layoutScanAt = now
  const root = document.documentElement
  if (
    !root.classList.contains(ROOT_TOPBAR_READY)
    && !document.querySelector('.bili-header')
    && foreignTopbarReady()
  ) {
    root.classList.add(ROOT_TOPBAR_READY)
  }
  ensureUnderTopbar()
}

/**
 * 顶栏改造的适用范围：个人空间与历史记录保持 B 站原版顶栏，一行样式都不注入。
 *
 * - `space.bilibili.com` 的全部子页面（个人主页 / 收藏 / 投稿 / 动态…）：这页的顶栏
 *   与页面自带内容（个人空间横幅 + 吸顶子栏「动态 / 投稿 / 合集和系列…」）耦合得比较
 *   紧，用户明确要求整条顶栏换回原版；
 * - `www.bilibili.com/history`（含客户端跳转入口 `/account/history`）：历史记录页自带
 *   吸顶面包屑栏「历史记录 + 列表 / 网格」，同样整条换回原版；
 * - `live.bilibili.com`：直播站有自己的顶栏（.link-navbar）与自己的播放器，同样整条
 *   换回原版；直播页只保留动效增强里的网页全屏 / 全屏关闭动画。
 *
 * 「换回原版」= 整套不生效：不注入 topbar.css、不挂根类、不插自绘 logo / 骨架栏、
 * 也不下移吸顶子栏（见 topbar.css §15），顶栏区域与页面其余部分完全交给 B 站。
 * 另外这是运行时判定：B 站 /account/history 是客户端跳转到 /history 的，
 * 落到排除地址后由 sync() 把已经挂上的改造整套撤掉（见 disposeTopbarOpt）。
 */
const EXCLUDED_HOSTS = ['space.bilibili.com', 'live.bilibili.com']
const EXCLUDED_PATHS = ['/history', '/account/history']

function isTopbarOptExcluded(): boolean {
  if (EXCLUDED_HOSTS.includes(location.hostname)) return true
  if (location.hostname !== 'www.bilibili.com') return false
  const path = location.pathname.replace(/\/+$/, '') || '/'
  return EXCLUDED_PATHS.includes(path)
}

/** 运行中（客户端跳转）落到排除页时，用它把整套改造撤掉 */
let disposeTopbarOpt: (() => void) | null = null

/** 与 B 站迷你顶栏 .trigger-arrow 完全相同的箭头路径 */
const ARROW_PATH
  = 'M4.838 6.184808333333335C4.927425 6.095383333333334 5.0725750000000005 6.095383333333334 5.162 6.184808333333335L2.0928358333333335 3.115621666666667C1.7999283333333338 2.8227274999999996 1.325058333333333 2.8227274999999996 1.0321641666666668 3.115621666666667C0.7392741666666667 3.408511666666668 0.7392741666666667 3.8833858333333335 1.0321641666666668 4.176275833333334L4.101350000000001 7.2454583333333344C4.597675 7.741783333333338 5.402325 7.741783333333338 5.89865 7.2454583333333344L8.96779166666667 4.176275833333334C9.2607 3.8833858333333335 9.2607 3.408511666666668 8.96779166666667 3.115621666666667C8.674950000000004 2.8227274999999996 8.200049999999997 2.8227274999999996 7.9072083333333305 3.115621666666667L4.838 6.184808333333335z'

/**
 * 箭头改用 CSS 伪元素绘制（mask + currentColor）。
 * 原因：B 站滚动到顶 / 下滑时会把「首页」节点在 .home-page-entry 与
 * .home-page-panel-entry 之间整块替换，注入到节点里的 SVG 会随之消失，
 * 等 MutationObserver 去抖 200ms 后补回，于是箭头「闪一下不见了再出现」。
 * 改成纯 CSS 后，新旧节点只要带对应类，箭头由浏览器即时渲染，无空档。
 */
const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${ARROW_PATH}" fill="#000"/></svg>`
const ARROW_MASK = `url("data:image/svg+xml,${encodeURIComponent(ARROW_SVG)}")`

let observer: MutationObserver | null = null
let timer: number | null = null
let panelHtmlPromise: Promise<string> | null = null
/** .bili-header 是否已经出现（用于「刚接入时立即同步」） */
let headerSeen = false
/** 「首页预加载」保活定时器 id */
let keepAliveTimer: number | null = null
let preloadObserver: IntersectionObserver | null = null
let preloadAnchor: HTMLElement | null = null

function leftMain(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.bili-header__bar .left-entry .left-entry-main')
}

/** 自绘 bilibili logo（官方 logo 图做遮罩上色，与迷你顶栏同款、同尺寸） */
function ensureLogo() {
  if (document.getElementById(LOGO_ID) || !document.body) return
  const logo = document.createElement('a')
  logo.id = LOGO_ID
  logo.href = '//www.bilibili.com/'
  logo.setAttribute('aria-label', 'bilibili')
  const mark = document.createElement('span')
  mark.className = 'bili-elite-logo__mark'
  logo.appendChild(mark)
  document.body.appendChild(logo)
}

/**
 * 首屏骨架栏：document_start 立即插入，只画品牌 logo。
 * 等 B 站新版顶栏导航（.left-entry__item）出现后由 CSS 自动隐藏，
 * 因此顶栏的「观感加载」与 B 站各处 JS 的快慢解耦（播放页尤其收益）。
 */
function ensureSkeleton() {
  if (document.getElementById(SKELETON_ID)) return
  const bar = document.createElement('div')
  bar.id = SKELETON_ID
  const mark = document.createElement('span')
  mark.className = 'bili-elite-logo__mark'
  bar.appendChild(mark)
  document.documentElement.appendChild(bar)
}

/** 把原生第二个导航项（番剧）就地改名成「动态」 */
function ensureDynamicEntry() {
  const main = leftMain()
  const item = main?.children[1] as HTMLElement | undefined
  if (!item || !item.classList.contains('left-entry__item')) return
  const trigger = item.querySelector<HTMLAnchorElement>('a.left-entry__item-trigger')
  if (!trigger) return
  const isMine = item.classList.contains(DYNAMIC_CLASS)
  if (!isMine && (trigger.textContent || '').trim() !== '番剧') return

  item.classList.add(DYNAMIC_CLASS)
  if (trigger.getAttribute('href') !== '//t.bilibili.com/') {
    trigger.setAttribute('href', '//t.bilibili.com/')
  }
  const text = trigger.querySelector('.trigger-text')
  if (text) {
    if (text.textContent !== '动态') text.textContent = '动态'
  } else if (trigger.textContent !== '动态') {
    trigger.textContent = '动态'
  }
}

function loadPanelHtml(): Promise<string> {
  if (!panelHtmlPromise) {
    panelHtmlPromise = (async () => {
      const bin = atob(HOME_PANEL_GZIP_B64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      return await new Response(stream).text()
    })()
  }
  return panelHtmlPromise
}

/**
 * 面板内容按需填充：首屏不解析（避免占用起始执行时间），hover / 空闲时再补。
 * 用元素本身做标记，Vue 重建面板后仍能重新填充。
 */
const filledContent = new WeakSet<Element>()

function fillPanel() {
  const content = document.querySelector<HTMLElement>(`#${PANEL_ID} .bili-header-channel-panel`)
  if (!content || filledContent.has(content)) return
  filledContent.add(content)
  loadPanelHtml()
    .then((html) => { content.innerHTML = html })
    .catch(() => { filledContent.delete(content) })
}

/** 空闲时预取面板内容，保证首次 hover 时已经就绪 */
function prefetchPanel() {
  const g = globalThis as any
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(fillPanel, { timeout: 2000 })
  else window.setTimeout(fillPanel, 400)
}

/** 自绘首页面板：固定在 .left-entry-main 上，两种顶栏状态共用 */
function ensureHomePanel() {
  const main = leftMain()
  if (!main) return
  let panel = document.getElementById(PANEL_ID)
  if (!panel) {
    panel = document.createElement('div')
    panel.id = PANEL_ID
    const card = document.createElement('div')
    card.className = 'bili-elite-panel-card'
    const content = document.createElement('div')
    content.className = 'bili-header-channel-panel'
    card.appendChild(content)
    panel.appendChild(card)
    prefetchPanel()
  }
  // 必须始终是 .left-entry-main 的最后一个子节点（hover 用兄弟选择器匹配），
  // 且要能被 Vue 重渲染后自动补回
  if (panel.parentElement !== main || main.lastElementChild !== panel) {
    main.appendChild(panel)
  }
}

function cleanElements() {
  document.getElementById(LOGO_ID)?.remove()
  document.getElementById(SKELETON_ID)?.remove()
  document.getElementById(PANEL_ID)?.remove()
  // 兼容旧版本曾把箭头注入到 DOM 的情况（现改为 CSS 伪元素）
  document.querySelectorAll('.bili-elite-arrow').forEach(el => el.remove())
  // 去掉给「创作中心」等打的隐藏标记，恢复原样
  document.querySelectorAll<HTMLElement>(`.${HIDDEN_RIGHT_CLASS}`).forEach(el => el.classList.remove(HIDDEN_RIGHT_CLASS))
  // 去掉给「吸顶子栏」打的标记（见 §15），并撤销子站顶栏就位标记
  document.querySelectorAll<HTMLElement>(`.${UNDER_TOPBAR_CLASS}`).forEach(el => el.classList.remove(UNDER_TOPBAR_CLASS))
  document.documentElement.classList.remove(ROOT_TOPBAR_READY)
}

/**
 * 顶栏右侧精简：「创作中心」没有稳定类名，按文字就地打标记隐藏
 * （「大会员」由 CSS 直接按 .vip-entry 隐藏）。因右侧是顺序排列的 flex，
 * 隐藏后其余控件会自动向右补位，间隔不变。
 */
function ensureRightEntryHidden() {
  const main = document.querySelector('.bili-header__bar .right-entry .right-entry__main')
  if (!main) return
  for (const child of Array.from(main.children)) {
    const item = child as HTMLElement
    if (!item.classList.contains('right-entry__item')) continue
    const label = (item.querySelector('.trigger-text')?.textContent || '').trim()
    if (label === '创作中心') item.classList.add(HIDDEN_RIGHT_CLASS)
  }
}

/**
 * 子站顶栏是否就位。
 *
 * 骨架栏的退场条件写在 topbar.css §1.2：主站按通用顶栏导航项 .left-entry__item 判定；
 * 但直播 / 游戏 / 商城 / 漫画等子站各有各的顶栏，类名完全不统一。这里统一按「视口顶部
 * 出现一条 ≥40px 高、占大半屏宽的固定 / 吸顶栏」判定，成立就给 <html> 打上
 * ROOT_TOPBAR_READY，由 CSS 收起骨架栏。不判定的话，骨架栏（白色 64px + logo、
 * z-index 1002）会一直盖在子站真正的顶栏上 —— 直播页此前就是这样：顶栏看起来只有
 * 一条白条加一个 logo。
 */
function foreignTopbarReady(): boolean {
  const nodes = document.body?.querySelectorAll<HTMLElement>(PAGE_LEVEL_SELECTOR)
  if (!nodes) return false
  for (const el of nodes) {
    if (!looksLikeBar(el)) continue
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
    const rect = el.getBoundingClientRect()
    if (rect.top <= 4 && rect.height >= 40 && rect.width >= window.innerWidth * 0.6) return true
  }
  return false
}

/**
 * 页面级「吸顶子栏」下移到顶栏下方（topbar.css §15）。
 *
 * B 站各子页面自带一条 position: sticky + top: 0 的工具栏（个人空间顶部的「动态 /
 * 投稿 / 合集和系列…」栏 .nav-bar.space-navbar、历史记录页的「历史记录 + 列表 / 网格」
 * 栏 .main-breadcrumbs…）。我们的顶栏是 fixed、z-index 更高，这条子栏会钻到顶栏底下：
 * 既看不见（也点不到），又让顶栏的毛玻璃采到一块静止的白底 —— 表现就是「向下滑一小段
 * 后顶栏的实时模糊没了，变成一块不动的白」。判据：sticky + top:0 + 高度 24–200 +
 * 宽度 ≥ 视口 60%，打上 UNDER_TOPBAR_CLASS 由 CSS 统一下移。
 */
function ensureUnderTopbar() {
  if (document.hidden) return
  const nodes = document.body?.querySelectorAll<HTMLElement>(PAGE_LEVEL_SELECTOR)
  if (!nodes) return
  for (const el of nodes) {
    if (el.classList.contains(UNDER_TOPBAR_CLASS)) continue
    if (!looksLikeBar(el)) continue
    const cs = getComputedStyle(el)
    if (cs.position !== 'sticky' || cs.top !== '0px') continue
    const rect = el.getBoundingClientRect()
    if (rect.width < window.innerWidth * 0.6 || rect.height < 24 || rect.height > 200) continue
    el.classList.add(UNDER_TOPBAR_CLASS)
  }
}

/**
 * 与 B 站顶栏快慢解耦的部分：logo 与骨架栏在 document_start 就能就位，
 * 不依赖 .bili-header 是否已经渲染。
 */
function syncChrome() {
  ensureLogo()
  ensureSkeleton()
  if (document.documentElement.classList.contains(ROOT_TOPBAR_READY)) return
  // 通用顶栏出现后，骨架栏由 CSS 按 .left-entry__item 收起，这里不再插手
  if (document.querySelector('.bili-header')) return
  // 子站骨架栏的收尾判定已移到 scanPageBars()（节流），这里不再扫全页
}

function sync() {
  // 客户端跳转（/account/history → /history 等）可能让页面落到「保持原版」的地址上，
  // 这时把整套改造撤掉，恢复 B 站原版顶栏
  if (isTopbarOptExcluded()) {
    disposeTopbarOpt?.()
    return
  }
  syncChrome()
  scanPageBars()
  syncPreloadAnchor()
  if (!document.querySelector('.bili-header')) return
  ensureDynamicEntry()
  ensureHomePanel()
  ensureRightEntryHidden()
  syncSearchKeyword()
}

/**
 * 搜索页顶栏中央的搜索框由我们重新显示（见 CSS），这里顺手把 URL 里的关键词带进去，
 * 与 B 站原生「滚动后吸顶搜索条」的体验一致。非搜索页 / 输入中 / 无关键词时不动。
 */
function syncSearchKeyword() {
  if (!document.querySelector('.search-layout')) return
  const input = document.querySelector<HTMLInputElement>('.bili-header__bar .center-search-container .nav-search-input')
  if (!input || input === document.activeElement) return
  const kw = new URLSearchParams(location.search).get('keyword') || ''
  if (kw && input.value !== kw) input.value = kw
}

function schedule() {
  if (timer !== null) return
  timer = window.setTimeout(() => {
    timer = null
    sync()
  }, 200)
}

/** 判断一批 DOM 变化是否发生在顶栏左侧导航内（含新增/删除的节点） */
function touchesLeftEntry(mutations: MutationRecord[]): boolean {
  for (const m of mutations) {
    const target = m.target as Element | null
    if (target?.closest?.('.left-entry')) return true
    for (const n of Array.from(m.addedNodes)) {
      if (n instanceof Element && n.matches?.('.left-entry, .left-entry *')) return true
    }
  }
  return false
}

/** hover 顶栏「首页」区域时立即补齐面板内容（正常情况下空闲预取已填好） */
function onHover(e: Event) {
  const target = e.target as Element | null
  if (target?.closest?.(`.left-entry-main, #${PANEL_ID}`)) fillPanel()
}

function startObservers() {
  sync()
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('mouseover', onHover, { passive: true })
  if (observer) return
  observer = new MutationObserver((mutations) => {
    // 元素缺失时立即补齐，避免顶栏出现后左侧短暂空白 / 顶部状态残留。
    // 左侧导航发生变化（B 站在顶部 / 下滑之间整块替换「首页」节点）时也立即同步，
    // 保证「动态」改名、面板挂载即时到位（箭头已由 CSS 绘制，不再依赖这里）。
    // 顶栏刚接入时也立即同步一次，避免 200ms 去抖带来的可见延迟。
    const headerEl = document.querySelector('.bili-header')
    const headerJustAppeared = !!headerEl && !headerSeen
    headerSeen = !!headerEl
    if (
      !document.getElementById(LOGO_ID)
      || !document.getElementById(SKELETON_ID)
      || !document.getElementById(PANEL_ID)
      || headerJustAppeared
      || touchesLeftEntry(mutations)
    ) {
      sync()
    }
    schedule()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

function stopObservers() {
  window.removeEventListener('resize', schedule)
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('mouseover', onHover)
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  observer?.disconnect()
  observer = null
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = topbarCss
  ;(document.head || document.documentElement).appendChild(style)
}

function removeStyle() {
  document.getElementById(STYLE_ID)?.remove()
}

function restoreDynamicEntry() {
  const main = leftMain()
  const item = main?.children[1] as HTMLElement | undefined
  if (!item || !item.classList.contains(DYNAMIC_CLASS)) return
  const trigger = item.querySelector<HTMLAnchorElement>('a.left-entry__item-trigger')
  trigger?.setAttribute('href', '//www.bilibili.com/anime/')
  const text = trigger?.querySelector('.trigger-text')
  if (text && text.textContent === '动态') text.textContent = '番剧'
  item.classList.remove(DYNAMIC_CLASS)
}


function applyHome(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_HOME, enabled)
  if (enabled) {
    startObservers()
  } else {
    headerSeen = false
    restoreDynamicEntry()
    cleanElements()
    stopObservers()
  }
}

function applyGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_GLASS, enabled)
}

/** 「首页优化」：只切一个 root class，纯 CSS 生效（无需 JS 观察器） */
function applyHomeOnly(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_HOME_ONLY, enabled)
}

/** 「搜索框材质」/「搜索面板材质」：只切 root class，纯 CSS 生效（无需 JS 观察器） */
function applySearchBoxGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_SEARCHBOX_GLASS, enabled)
}

function applySearchPanelGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_SEARCHPANEL_GLASS, enabled)
}

/** 「首页预加载」：只切 root class，纯 CSS 生效（无需 JS 观察器） */
function applyPreload(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_PRELOAD, enabled)
  if (enabled) {
    syncPreloadAnchor()
  }
  else {
    stopKeepAlive()
    preloadObserver?.disconnect()
    preloadObserver = null
    preloadAnchor = null
  }
}

/**
 * 「首页预加载」保活定时器。
 *
 * B 站的加载判据（F6 内部那个 c()）只在 `window` 的 scroll 事件里跑（节流 200ms），
 * **用户手指一停就再也不会重新判定** —— 于是「停在那里等它加载」永远等不到，
 * 栅格尾部那批空占位骨架就一直挂着，看起来像预加载没生效。
 *
 * 这里在哨兵仍然落在触发范围内时，定时补发一个 scroll 事件把判定叫醒。哨兵已经被
 * 上抬过，它当前的矩形就是 B 站判据读到的那个值，所以直接用
 * `rect.bottom <= innerHeight + 200`（B 站自己的 offset）来判断。
 * 内容补回来之后哨兵会被顶出触发范围，循环自然停下，不会无限加载。
 */
function nudgePreload() {
  if (document.hidden) return
  const anchor = document.querySelector<HTMLElement>(
    '.recommended-container_floor-aside .container > .load-more-anchor',
  )
  if (!anchor || !anchor.isConnected) return
  if (anchor.getBoundingClientRect().bottom <= window.innerHeight + 200) {
    window.dispatchEvent(new Event('scroll'))
  }
}


/**
 * 「首页预加载」的哨兵监听。
 *
 * 原来不管页面滚到哪都每 800ms 查一次哨兵矩形（强制布局），静止不动也在跑。
 * 改成 IntersectionObserver：只有哨兵进入「视口底部 + 200px」（与 B 站判据同值）
 * 时才开那个补发 scroll 的定时器，离开就关 —— 用户不在底部时开销为零。
 */
function syncPreloadAnchor() {
  const anchor = document.querySelector<HTMLElement>(
    '.recommended-container_floor-aside .container > .load-more-anchor',
  )
  if (anchor === preloadAnchor) return
  preloadObserver?.disconnect()
  preloadAnchor = anchor
  if (!anchor) {
    stopKeepAlive()
    return
  }
  preloadObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) startKeepAlive()
      else stopKeepAlive()
    }
  }, { rootMargin: '0px 0px 200px 0px' })
  preloadObserver.observe(anchor)
}
function startKeepAlive() {
  if (keepAliveTimer !== null) return
  keepAliveTimer = window.setInterval(nudgePreload, 800)
}

function stopKeepAlive() {
  if (keepAliveTimer === null) return
  window.clearInterval(keepAliveTimer)
  keepAliveTimer = null
}

/** 「布局优化」两条：只切 root class，纯 CSS 生效（无需 JS 观察器） */
function applyLayoutCompact() {
  document.documentElement.classList.toggle(ROOT_RAIL_COMPACT, get('railCompact'))
  document.documentElement.classList.toggle(ROOT_NOTICE_COMPACT, get('noticeCompact'))
}

/** 「奶睿顶栏图」：只切 root class + 写一个 CSS 变量，纯 CSS 生效 */
function applyMascotLogo() {
  const root = document.documentElement
  const on = get('mascotLogo')
  root.classList.toggle(ROOT_MASCOT_LOGO, on)
  if (!on) {
    root.style.removeProperty('--bili-logo-img')
    return
  }
  // 图片在 extension/assets/ 里，manifest 的 web_accessible_resources 必须登记过
  const url = typeof chrome !== 'undefined' ? chrome.runtime.getURL?.('assets/logo-mascot.png') : undefined
  if (url) root.style.setProperty('--bili-logo-img', `url("${url}")`)
}

/** 六个卡片开关：只切 root class，纯 CSS 生效（无需 JS 观察器） */
function applyCardScopes() {
  for (const key of Object.keys(CARD_SCOPE_CLASSES) as Array<keyof typeof CARD_SCOPE_CLASSES>) {
    document.documentElement.classList.toggle(CARD_SCOPE_CLASSES[key], get(key))
  }
}

/** 把设置里的搜索框 / 搜索面板模糊、遮罩强度写入 CSS 变量，所有页面统一生效 */
function applySearchParams() {
  const box = getSearchBoxParams()
  const panel = getSearchPanelParams()
  const root = document.documentElement.style
  root.setProperty('--bili-searchbox-blur', `${box.blur}px`)
  // 遮罩是不透明度（0–1），独立于模糊：模糊拉到 0 也能靠它把白底关掉
  root.setProperty('--bili-searchbox-tint', `${Math.min(100, Math.max(0, box.tint)) / 100}`)
  root.setProperty('--bili-searchpanel-blur', `${panel.blur}px`)
  root.setProperty('--bili-searchpanel-tint', `${Math.min(100, Math.max(0, panel.tint)) / 100}`)
}

/**
 * 把「预加载范围」（百分比）写成 CSS 变量：topbar.css §11 用它做哨兵的位移。
 * 写成 vh 是因为哨兵的触发判据基于视口高度，用百分比才能随窗口大小自适应。
 */
function applyPreloadParams() {
  const { dist } = getPreloadParams()
  document.documentElement.style.setProperty('--bili-preload-dist', `${dist}vh`)
}

/** 把设置里的顶栏模糊 / 遮罩强度写入 CSS 变量，所有页面统一生效 */
function applyTopbarParams() {
  const { blur, tint } = getTopbarParams()
  const root = document.documentElement.style
  root.setProperty('--bili-topbar-blur', `${blur}px`)
  // 遮罩是不透明度（0–1），独立于模糊：模糊拉到 0 也能靠它把白底关掉
  root.setProperty('--bili-topbar-tint', `${Math.min(100, Math.max(0, tint)) / 100}`)
  root.setProperty('--bili-topbar-arrow', ARROW_MASK)
}

export function setupTopbarOptimize(): () => void {
  // 个人空间 / 历史记录：整条顶栏保持 B 站原版，直接不接
  if (isTopbarOptExcluded()) return () => {}

  // 顶栏优化对所有页面始终生效（无开关）；各「材质」才是毛玻璃的开关
  ensureStyle()
  applyHome(true)
  applyHomeOnly(get('homeOptimize'))
  applyGlass(get('topbarGlass'))
  applySearchBoxGlass(get('searchBoxGlass'))
  applySearchPanelGlass(get('searchPanelGlass'))
  applyPreload(get('preload'))
  applyCardScopes()
  applyLayoutCompact()
  applyMascotLogo()
  applyTopbarParams()
  applySearchParams()
  applyPreloadParams()

  const off = onConfigChange((key) => {
    if (key === 'topbarGlass') {
      applyGlass(get('topbarGlass'))
    } else if (key === 'homeOptimize') {
      applyHomeOnly(get('homeOptimize'))
    } else if (key === 'searchBoxGlass') {
      applySearchBoxGlass(get('searchBoxGlass'))
    } else if (key === 'searchPanelGlass') {
      applySearchPanelGlass(get('searchPanelGlass'))
    } else if (key === 'preload') {
      applyPreload(get('preload'))
    } else if (key === 'railCompact' || key === 'noticeCompact') {
      applyLayoutCompact()
    } else if (key === 'mascotLogo') {
      applyMascotLogo()
    } else if (key in CARD_SCOPE_CLASSES) {
      applyCardScopes()
    }
  })

  const offTopbarParams = onTopbarParamsChange(applyTopbarParams)
  const offSearchBoxParams = onSearchBoxParamsChange(applySearchParams)
  const offSearchPanelParams = onSearchPanelParamsChange(applySearchParams)
  const offPreloadParams = onPreloadParamsChange(applyPreloadParams)

  const dispose = () => {
    off()
    offTopbarParams()
    offSearchBoxParams()
    offSearchPanelParams()
    offPreloadParams()
    stopKeepAlive()
    preloadObserver?.disconnect()
    preloadObserver = null
    preloadAnchor = null
    stopObservers()
    removeStyle()
    restoreDynamicEntry()
    cleanElements()
    document.documentElement.classList.remove(
      ROOT_HOME,
      ROOT_GLASS,
      ROOT_HOME_ONLY,
      ROOT_SEARCHBOX_GLASS,
      ROOT_SEARCHPANEL_GLASS,
      ROOT_PRELOAD,
      ROOT_RAIL_COMPACT,
      ROOT_NOTICE_COMPACT,
      ROOT_MASCOT_LOGO,
      ...Object.values(CARD_SCOPE_CLASSES),
    )
    document.documentElement.style.removeProperty('--bili-topbar-blur')
    document.documentElement.style.removeProperty('--bili-topbar-tint')
    document.documentElement.style.removeProperty('--bili-topbar-arrow')
    document.documentElement.style.removeProperty('--bili-searchbox-blur')
    document.documentElement.style.removeProperty('--bili-searchbox-tint')
    document.documentElement.style.removeProperty('--bili-searchpanel-blur')
    document.documentElement.style.removeProperty('--bili-searchpanel-tint')
    document.documentElement.style.removeProperty('--bili-preload-dist')
    document.documentElement.style.removeProperty('--bili-logo-img')
  }
  disposeTopbarOpt = dispose
  return () => {
    disposeTopbarOpt = null
    dispose()
  }
}

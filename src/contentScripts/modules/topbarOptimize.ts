import { get, isUserEdit, onConfigChange } from '../config'
import { chromeGetURL } from '../storage'
import { getHomePanelParams, onHomePanelParamsChange } from './homePanelConfig'
import { HOME_PANEL_GZIP_B64 } from './homePanelData'
import { getPreloadParams, onPreloadParamsChange } from './preloadConfig'
import { installRipple } from './ripple'
import {
  getSearchBoxParams,
  getSearchPanelParams,
  onSearchBoxParamsChange,
  onSearchPanelParamsChange,
} from './searchConfig'
import { getTopbarParams, onTopbarParamsChange } from './topbarConfig'
import homeOptimizeCss from './homeOptimize.css?inline'
import searchOptimizeCss from './searchOptimize.css?inline'
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
 * - 首屏另有一条由脚本即时插入的「顶栏壳」（#bili-elite-topbar-skeleton）：
 *   logo + 「首页 ∨ / 动态」+ 居中搜索框 + 右侧图标占位，尺寸与真顶栏逐项对齐，
 *   等新版顶栏导航就位后整条退场。B 站自己的顶栏要等它那套 header 脚本跑完才渲染
 *   （播放页实测 1.2s，冷缓存 4~5s），这段时间的观感完全由这条壳撑着 ——
 *   学的是 BewlyCat「顶栏自己画、不等宿主」的路子
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
 * - 「卡片整体化」：整卡点击（除 UP 主名字）与「悬停标题不变蓝」，样式在 topbar.css §12.5，
 *   点击委托在 cardWholeClick.ts。悬停变灰（「卡片确认」）1.1.6 v010 起没有开关、常开，
 *   两者互不依赖。「卡片边界」三个开关 1.2.5 v014 已删（见 CARD_SCOPE_CLASSES）。
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
/** 首页内容区布局（左右留白 / 栅格列宽），跟着「首页优化」开关走 —— 见 homeOptimize.css */
const HOME_STYLE_ID = 'bili-elite-home-optimize-style'
/** 搜索页结果栅格（左右留白 / 列宽 / 间距），跟着「搜索页优化」开关走 —— 见 searchOptimize.css */
const SEARCH_STYLE_ID = 'bili-elite-search-optimize-style'
const ROOT_HOME = 'bili-elite-home-opt'
/** 「首页优化」：仅首页（大顶栏）去大图横幅 / 分类栏（顶栏改造本身始终生效） */
const ROOT_HOME_ONLY = 'bili-elite-home-only'
/**
 * 「首页滚动条常驻」（1.2.1）：`overflow-y: scroll` 只在**首页**需要（首帧防横移，
 * 见 homeOptimize.css §1）。以前它跟着 ROOT_HOME_ONLY 走，而那个类是全站挂的 ——
 * 搜索页就变成 html + body 两根滚动条并排。所以单独拆一个类，只在首页挂。
 */
const ROOT_HOME_SCROLL = 'bili-elite-home-scroll'
/** 「搜索页优化」：仅搜索结果页（search.bilibili.com）换窄栏 + auto-fill 栅格 */
const ROOT_SEARCH_ONLY = 'bili-elite-search-only'
const ROOT_GLASS = 'bili-elite-glass'
/** 「顶栏渐变」——顶栏玻璃从上实下透的竖向渐变（依附于顶栏材质，材质关掉时不生效） */
const ROOT_TOPBAR_FADE = 'bili-elite-topbar-fade'
/** 「搜索框材质」——顶栏中央搜索框的毛玻璃开关 */
const ROOT_SEARCHBOX_GLASS = 'bili-elite-searchbox-glass'
/** 「搜索面板材质」——点击搜索框弹出的「搜索历史 / 热搜」面板的毛玻璃开关 */
const ROOT_SEARCHPANEL_GLASS = 'bili-elite-searchpanel-glass'
/** 「触发面板材质」——顶栏悬停浮层（频道面板 / 右侧浮层）与卡片「⋮」菜单的毛玻璃开关 */
const ROOT_HOMEPANEL_GLASS = 'bili-elite-homepanel-glass'
/** 「首页预加载」——提前把首页推荐流屏幕下方的下一批内容取回来 */
const ROOT_PRELOAD = 'bili-elite-preload'
/** 「播放页右栏留白收起」/「顶部提示条收起」：只切 root class，纯 CSS 生效（无需 JS 观察器） */
const ROOT_RAIL_COMPACT = 'bili-elite-rail-compact'
const ROOT_NOTICE_COMPACT = 'bili-elite-notice-compact'
/** 原生浮动按钮屏蔽：「刷新（刷新内容 / 换一换）」与「返回顶部」各一个开关（见 topbar.css §17） */
const ROOT_NATIVE_REFRESH_HIDE = 'bili-elite-native-refresh-hide'
const ROOT_NATIVE_BACKTOP_HIDE = 'bili-elite-native-backtop-hide'

/** 「奶睿顶栏图」——把左上角自绘字标换成奶睿形象 */
const ROOT_MASCOT_LOGO = 'bili-elite-mascot-logo'
/**
 * 卡片相关的 root class：一个开关一个类，都只切 class、纯 CSS 生效。
 * 表格化是因为它们除了类名不同之外行为完全一样。
 *
 * 注意「卡片确认」（悬停变灰）不在这张表里 —— 1.1.6 v010 起它没有开关、常开，
 * 样式直接挂在页面作用域上（topbar.css §12.3）。
 * 「卡片边界」那三个类（-home / -search / -video）1.2.5 v014 删掉了，这里只剩一项。
 */
const CARD_SCOPE_CLASSES = {
  cardWhole: 'bili-elite-card-whole',
} as const satisfies Record<string, string>
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
/**
 * 信息流被整块换过（刷新 / 加载下一批）。
 *
 * IntersectionObserver **只在相交状态变化时**回调。而「返回顶部 → 刷新」这个组合里：
 * 返回顶部后哨兵在视口下方（不相交），刷新把信息流换成一页新的之后哨兵跑到视口上方
 * （仍然不相交）—— 状态没变，回调就不会触发，保活定时器一直不开，底部骨架挂在原地。
 * 与此同时 `syncPreloadAnchor` 看到哨兵节点被复用（B 站刷新时常常不换这个节点）
 * 就直接 return，观察器也就一直停在那份旧状态上。手动下滑会触发真实 scroll、
 * 几何连续变化产生一次相交跨越，于是「下滑后恢复」。
 *
 * 这里用脏标记：信息流一有增删，下一次 sync() 就强制重建观察器 ——
 * 重建必然带一次初始回调，按当前几何重新判定，不再依赖「是否跨过阈值」。
 */
let preloadDirty = false

export function loadHomePanelHtml(): Promise<string> {
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
 * 撤掉改造时留在原生树上的标记。
 *
 * 自绘 logo / 骨架栏 / 番剧改名 / 原生频道面板 / 右侧隐藏 这一整套已经在 1.1.6 v007 下线
 * （关掉「顶栏优化」就是 B 站原版），这里只剩「吸顶子栏下移」这一个还挂在原生节点上。
 */
function cleanElements() {
  document.querySelectorAll<HTMLElement>(`.${UNDER_TOPBAR_CLASS}`).forEach(el => el.classList.remove(UNDER_TOPBAR_CLASS))
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
 * 尾部骨架补齐。
 *
 * B 站取下一批推荐时固定插 15 个骨架格（按它自己那套「5 列 × 3 行」算）。「首页优化」
 * 把栅格换成 auto-fill 之后列数会变（1440 宽、卡片 235 时 5 列，180 时 6 列），
 * 15 个格子可能只排到两行半，下面就是一整片空白 —— 看起来像「加载动画断掉了」。
 * 卡片调得越小、列数越多，这片空白越明显。
 *
 * 这里按实际列数把骨架格克隆到视口底部：克隆的是现成的骨架卡，灰块、呼吸、圆角
 * 全都跟着走，不用再画一套。外层包一个 `display: contents` 的壳，克隆出来的格子
 * 直接成为栅格子项，壳本身不占位、也不参与 B 站那条按 nth-of-type 写的行距规则。
 *
 * 只在「尾部还是骨架」时补：这一批回来了（尾部变成真卡）就把壳整个摘掉。
 * 克隆节点不在 Vue 的 vnode 里，B 站更新时不会复用它们，所以必须自己收尾。
 */
const FILL_CLASS = 'bili-elite-skeleton-fill'
/** 最多补 8 行：够从骨架末行一直填到视口底部（卡片小、列多时要 4~5 行），
 * 页面异常时也不至于无限长 */
const FILL_MAX_ROWS = 8

/** 空壳格子：有尺寸、但图片 / 骨架 / 文字全都没有（B 站把数据还没到的 item 先渲染成空盒子） */
const BLANK_CLASS = 'bili-elite-cell-blank'

/**
 * 首屏空档补位（样式见 topbar.css §16.4）。
 *
 * 首页首屏那 10 张卡片是 SSR 直接吐出来的，B 站自己那批骨架要等前端启动完
 * （实测 ~0.9s）才插进栅格。这中间的空档里，栅格下面就是一整片白 —— 尤其
 * 「首页优化」把轮播藏掉、列数交给 auto-fill 之后，宽屏上 10 张卡只排得满两行，
 * 空档能有半屏高，看着就是「还没加载的内容没有加载动画」。
 *
 * 补的是和原生骨架卡同构的占位：类名照抄 `.bili-video-card` + `.bili-video-card__skeleton`，
 * 几何全交给 B 站自己的骨架样式（实测与原生骨架卡逐像素同高），卡底与灰块由
 * §16.1.1 / §16.3 那两条规则接管。哨兵 `.load-more-anchor` 一出现（原生骨架批已经排上）
 * 就整块撤掉 —— 那段尾巴归 syncSkeletonFill 管，两边不抢同一个位置。
 */
const GHOST_CLASS = 'bili-elite-ghost-fill'
/** 最多补 6 行：空档通常只有一两行，页面异常时也不至于补出一整屏假骨架 */
const GHOST_MAX_ROWS = 6
/** 原生骨架卡的内部结构（2026-10-22 从线上 DOM 抄的，B 站改版要跟着改） */
const GHOST_INNER = '<div class="bili-video-card__skeleton"><div class="bili-video-card__skeleton--cover"></div><div class="bili-video-card__skeleton--info"><div class="bili-video-card__skeleton--right"><p class="bili-video-card__skeleton--text"></p><p class="bili-video-card__skeleton--text short"></p><p class="bili-video-card__skeleton--light"></p></div></div></div>'

/**
 * 给空壳格子打标记（样式见 topbar.css §16.1.3）。
 *
 * 栅格里偶尔会出现一格「占着位置但什么都没有」的盒子 —— 图片没加载、骨架还没插、
 * 标题也没有。夹在一排骨架卡里就是一个纯白洞。这里只认「三样都没有」的格子，
 * 真卡片哪怕图还没到也有标题文字，不会被误标。
 */
function markBlankCells() {
  const container = document.querySelector('.recommended-container_floor-aside .container')
  if (!container)
    return
  for (const el of Array.from(container.children) as HTMLElement[]) {
    // 自己补的节点（骨架补齐 / 首屏占位）本来就没有内容，不能当空壳标
    if (
      el.offsetHeight === 0
      || el.classList.contains(FILL_CLASS)
      || el.classList.contains(GHOST_CLASS)
      || el.classList.contains('load-more-anchor')
    )
      continue
    // 顺序不能反：querySelector 命中的是绝大多数（真卡片都有 img），一步就短路；
    // textContent 要把整棵子树的文本节点串起来，对每张卡都算一遍是白花的主线程时间。
    const blank = !el.querySelector('img, picture, .bili-video-card__skeleton, .floor-skeleton, .bili-live-card__skeleton')
      && !el.textContent?.trim()
    el.classList.toggle(BLANK_CLASS, blank)
  }
}

/** 一张首屏占位卡：结构照抄原生骨架卡，封面比例靠 `--cover-radio`（缺了封面就是 0 高） */
function makeGhostCell(): HTMLElement {
  const cell = document.createElement('div')
  cell.className = `bili-video-card ${GHOST_CLASS}__cell`
  cell.style.setProperty('--cover-radio', '56.25%')
  cell.setAttribute('aria-hidden', 'true')
  cell.innerHTML = GHOST_INNER
  return cell
}

/**
 * 首屏空档补位（见 GHOST_CLASS 的注释）。
 *
 * 判据只有一条 —— `.load-more-anchor` 在不在。它在，说明原生骨架批已经插进栅格了，
 * 尾部那块交给 syncSkeletonFill；它不在，栅格下面就是空档，按实际列数补到视口底。
 * 这样既不会跟原生骨架抢位置，也不会在「整批已经加载完」的页面上凭空补出一排假骨架。
 */
function syncGhostFill() {
  const container = document.querySelector<HTMLElement>('.recommended-container_floor-aside .container')
  const shell = container?.querySelector<HTMLElement>(`:scope > .${GHOST_CLASS}`) ?? null
  if (!container) {
    shell?.remove()
    return
  }
  if (container.querySelector(':scope > .load-more-anchor')) {
    shell?.remove()
    return
  }
  const cells = Array.from(container.children).filter(
    el => !el.classList.contains(FILL_CLASS) && !el.classList.contains(GHOST_CLASS),
  ) as HTMLElement[]
  const visible = cells.filter(el => el.offsetHeight > 0)
  const last = visible[visible.length - 1]
  // 容器还没内容（SSR 那批都没到）或者尾部已经是骨架 → 不归这里管
  if (!last || last.querySelector('.bili-video-card__skeleton:not(.hide), .floor-skeleton')) {
    shell?.remove()
    return
  }
  const rect = last.getBoundingClientRect()
  // 已经排到视口底部 → 不缺东西。留 40px 容差，最后一行差一点点时不补一整排
  if (!rect.height || rect.bottom >= window.innerHeight - 40) {
    shell?.remove()
    return
  }
  const cols = getComputedStyle(container).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  const rowH = rect.height + 20
  // ① 先补满最后一行：SSR 的卡片数不一定能被列数整除（宽屏上 10 张 6 列就差两格）
  const toRowEnd = (cols - (visible.length % cols)) % cols
  // ② 再往下补到视口底部（+200 与 syncSkeletonFill 同口径，多留一点免得底边露白）
  const rows = Math.min(GHOST_MAX_ROWS, Math.max(0, Math.ceil((window.innerHeight + 200 - rect.bottom) / rowH)))
  const count = toRowEnd + rows * cols
  if (count <= 0) {
    shell?.remove()
    return
  }
  // 数量没变就不重建，免得每次 sync 都换一批新节点、占位卡闪一下
  if (shell && shell.childElementCount === count)
    return
  shell?.remove()
  const box = document.createElement('div')
  box.className = GHOST_CLASS
  box.style.display = 'contents'
  for (let i = 0; i < count; i++)
    box.appendChild(makeGhostCell())
  container.appendChild(box)
}

function syncSkeletonFill() {
  const container = document.querySelector<HTMLElement>('.recommended-container_floor-aside .container')
  const shell = container?.querySelector<HTMLElement>(`:scope > .${FILL_CLASS}`) ?? null
  if (!container) {
    shell?.remove()
    return
  }
  const cells = Array.from(container.children).filter(
    el => !el.classList.contains(FILL_CLASS) && !el.classList.contains(GHOST_CLASS) && !el.classList.contains('load-more-anchor'),
  ) as HTMLElement[]
  // 有些格子被我们自己的规则藏掉了（§5.2 的楼层卡、§5.5 的轮播、§5.3 的空壳），
  // 它们在 children 里但不占栅格位置 —— 算「最后一行还差几格」时必须剔掉，
  // 否则会少补几格，最后一行照样空着。
  const visible = cells.filter(el => el.offsetHeight > 0)
  const last = visible[visible.length - 1]
  // 尾部不是骨架 → 这一批已经回来了，或者页面根本不在加载
  if (!last || !last.querySelector('.bili-video-card__skeleton:not(.hide), .floor-skeleton')) {
    shell?.remove()
    return
  }
  // 克隆模板只取普通视频骨架卡：栅格尾部经常是楼层卡（番剧 / 直播那类）的骨架，
  // 照着它克隆会补出一整排番剧卡，反而更怪。
  // 不能要求 el 自己就是 .bili-video-card —— 骨架格有时被 .feed-card 包一层，
  // 那样 matches() 永远是 false，整段补齐就静默失效了。
  // 还要排除 display:none 的容器（首页顶部的轮播 .recommended-swipe 被 §5.5 藏了，
  // 但里面挂着骨架，光看结构会把它当成模板，克隆出来是一整块不可见的空轮播）
  const tpl = visible.find(el => el.querySelector('.bili-video-card__skeleton:not(.hide)'))
  if (!tpl) {
    shell?.remove()
    return
  }
  const rect = last.getBoundingClientRect()
  if (!rect.height)
    return
  const cols = getComputedStyle(container).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  const rowH = rect.height + 20
  // ① 补满最后一行：B 站那批骨架的格数不一定能被列数整除（15 个骨架 + 哨兵那一格），
  //    除不尽的时候最后一行右边就空出几格，看着像被挖掉了。
  const anchor = container.querySelector<HTMLElement>(':scope > .load-more-anchor')
  const slots = visible.length + (anchor && anchor.offsetHeight > 0 ? 1 : 0)
  const toRowEnd = (cols - (slots % cols)) % cols
  // ② 原生内容还不够一屏时（首屏加载中很常见）再往下补到视口底部。
  //    已经超过一屏就不补了 —— 那种情况滚到底看到的就是最后一行，再补只会变成
  //    「滚到底又冒出假骨架」的无限加载。
  const nativeBottom = rect.bottom + window.scrollY
  const rows = nativeBottom < window.innerHeight + 200
    ? Math.min(FILL_MAX_ROWS, Math.max(0, Math.ceil((window.innerHeight + 200 - rect.bottom) / rowH)))
    : 0
  const count = toRowEnd + rows * cols
  if (count <= 0) {
    shell?.remove()
    return
  }
  // 数量没变就不重建：重建会让克隆节点的呼吸动画从头开始，白闪一下
  if (shell && shell.childElementCount === count)
    return
  shell?.remove()
  const box = document.createElement('div')
  box.className = FILL_CLASS
  box.style.display = 'contents'
  for (let i = 0; i < count; i++) {
    const cell = tpl.cloneNode(true) as HTMLElement
    cell.classList.add(`${FILL_CLASS}__cell`)
    box.appendChild(cell)
  }
  container.appendChild(box)
}

function sync() {
  // 客户端跳转（/account/history → /history 等）可能让页面落到「保持原版」的地址上，
  // 这时把整套改造撤掉，恢复 B 站原版顶栏
  if (isTopbarOptExcluded()) {
    disposeTopbarOpt?.()
    return
  }
  // 先对一遍观察根：顶栏 / 栅格被整块换掉后旧节点上的观察器会哑掉（见 observeRoots）。
  // 放在最前面是因为下面「顶栏还没出现」会提前 return —— 那一支恰恰最需要重挂。
  observeRoots()
  scanPageBars()
  markFollowedTags(document)
  markBlankCells()
  syncGhostFill()
  syncSkeletonFill()
  // 信息流刚被换过就强制重建观察器（见 preloadDirty 的注释），否则沿用旧的
  syncPreloadAnchor(preloadDirty)
  preloadDirty = false
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

/**
 * 这批 DOM 变化是否动了首页信息流。
 * 「刷新」会整块重建卡片、加载下一批会往栅格里塞新卡，两种情况哨兵节点都可能被复用，
 * 所以只认「信息流区域 / 哨兵 / 卡片」相关的变化（见 preloadDirty）。
 */
function touchesFeed(mutations: MutationRecord[]): boolean {
  for (const m of mutations) {
    const target = m.target as Element | null
    if (target?.closest?.('.recommended-container_floor-aside, .load-more-anchor')) return true
    for (const n of Array.from(m.addedNodes)) {
      if (n instanceof Element && n.matches?.('.load-more-anchor, .bili-video-card, .feed-card, .floor-single-card'))
        return true
    }
  }
  return false
}

/** 卡片入场动画的类名（topbar.css §12.4） */
const CARD_ENTER_CLASS = 'bili-elite-card-in'
/** 首页推荐栅格 / 搜索结果列表：卡片入场判定与观察范围都用它 */
const FEED_HOST_SELECTOR = '.recommended-container_floor-aside, .search-page .video-list'
/**
 * 入场动画挂在「栅格那一格」上，不是挂在里面的封面卡上 —— 整格（含悬停衬底）一起淡入。
 * `.feed-card` / `.bili-feed-card` 是外层壳，`.bili-video-card` 是壳里那张卡
 * （骨架批次也是这个类名，靠下面的骨架判据排除），`.floor-single-card` 兜一下老结构。
 */
const CARD_SELECTOR = '.feed-card, .bili-feed-card, .bili-video-card, .floor-single-card'

/** 「已关注」标签的打标类（样式见 topbar.css §18） */
const FOLLOWED_CLASS = 'bili-elite-followed'

/**
 * 给卡片上的「已关注」标签打标，交给 CSS 换成 YouTube「已订阅」式胶囊。
 *
 * 为什么不能纯 CSS：`.bili-video-card__info--icon-text` 这个类**同时**被「1万点赞」
 * 这类计数标签用着 —— 两者 DOM 一模一样、只有文本不同，CSS 没有按文本匹配的手段，
 * 直接改这个类会把点赞数也一起变成胶囊。
 *
 * 只查「还没打过标的」，所以稳态下这一句返回 0 个节点，放进 sync() 里每轮跑也不贵。
 */
function markFollowedTags(scope: ParentNode) {
  const tags = scope.querySelectorAll(`.bili-video-card__info--icon-text:not(.${FOLLOWED_CLASS})`)
  for (const tag of Array.from(tags)) {
    if (tag.textContent?.trim() === '已关注')
      tag.classList.add(FOLLOWED_CLASS)
  }
}

/**
 * 给「刚插进来、且不含骨架」的卡片打上入场类（CSS 里跑一次 220ms 淡入 + 8px 上浮）。
 *
 * 为什么在 MutationObserver 回调里做、不等 sync()：sync 是去抖的，等它跑起来卡片早就
 * 画出来了，再淡入就变成「先闪一下再淡」。
 * 成本控制：绝大多数批次是改属性 / 文本（addedNodes 为空），第一行就跳过；剩下的再按
 * 最近的容器判定，非信息流位置（顶栏、评论区）一律不碰 —— 这段回调每个 DOM 批次都会跑，
 * 不能在这里做整页查询（见上面 sync 的注释）。
 *
 * 1.2.0 v008 两处变化：
 *   - 选择器扩到外层壳（`.feed-card` / `.bili-feed-card`），淡入的是**整格**；
 *   - 加了「祖先已经打过标就跳过」——否则外层壳和里面的卡会各淡一次，透明度乘起来
 *     变成 0.25 起步，看着像漏了半张卡。
 */
function markNewCards(mutations: MutationRecord[]) {
  for (const m of mutations) {
    if (!m.addedNodes.length) continue
    const target = m.target as Element | null
    if (!target?.closest?.(FEED_HOST_SELECTOR)) continue
    for (const n of Array.from(m.addedNodes)) {
      if (!(n instanceof Element)) continue
      // 关注状态跟着卡片一起渲染出来，顺手打标 —— 等 sync() 那 200ms 去抖会看到橙→蓝闪一下
      markFollowedTags(n)
      const cards = n.matches(CARD_SELECTOR) ? [n] : Array.from(n.querySelectorAll(CARD_SELECTOR))
      for (const c of cards) {
        if (c.classList.contains(CARD_ENTER_CLASS)) continue
        // 外层那一格已经在淡入了，里面的节点别再叠一层
        if (c.parentElement?.closest(`.${CARD_ENTER_CLASS}`)) continue
        // 骨架格 / 脚本自己补的占位格里也有 .bili-video-card，它们不该淡入
        if (c.querySelector('.bili-video-card__skeleton, .floor-skeleton, .bili-live-card__skeleton:not(.hide)')) continue
        c.classList.add(CARD_ENTER_CLASS)
      }
    }
  }
}

/** 正在观察的顶栏节点（播放页会同时存在「旧版隐藏顶栏」和「真顶栏」两个）与信息流栅格 */
let observedHeaders: Element[] = []
let observedFeed: Element | null = null
/** 是否已经真正挂过目标。没有它就分不清「还没挂」和「挂的就是 null」——
    首屏那两个根都还是 null，直接比会误判成「没变化」而不挂，观察器从此永远收不到回调。 */
let observing = false

function sameTargets(headers: Element[], feed: Element | null): boolean {
  if (feed !== observedFeed || headers.length !== observedHeaders.length) return false
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] !== observedHeaders[i]) return false
  }
  return true
}

/**
 * 把观察范围从「整个 document」收窄到「顶栏 + 信息流」。
 *
 * 原来 observe(document.documentElement, {subtree:true}) 等于监听整页：B 站信息流每秒都在
 * 插节点，评论区、播放器、右栏的每一次变动都会把回调叫起来。实际用到的只有两处 ——
 * 顶栏（左侧导航被整块替换 / 自绘面板被清掉）和信息流（换页 / 卡片插入 / 哨兵位置）。
 *
 * **收窄的条件是「真顶栏的导航项就位」**，不是「.bili-header 出现」：
 * 播放页在 Vue 接管之前会先渲染一版 `.bili-header.fixed-header`（被我们整块隐藏），
 * 那时候按 .bili-header 去挂会盯上一个马上就要被替换的节点，等真顶栏插进来就再也收不到
 * 回调 —— 顶栏于是永远停在半成品状态（实测过：动态改名 / 自绘面板都不出现）。
 * 所以导航项没出现之前继续观察整页，代价和以前一样；就位之后才开始收窄。
 *
 * 节点被整块换掉时（B 站在顶部与下滑之间会换「首页」节点、换一换会重建栅格），
 * 旧节点上的观察器就哑了 —— 所以 sync() 每次开头都会调这里对一遍，发现目标变了就重挂。
 */
function observeRoots() {
  if (!observer) return
  const ready = !!document.querySelector('.left-entry__item')
  const headers = ready ? Array.from(document.querySelectorAll('.bili-header')) : []
  const feed = ready ? document.querySelector(FEED_HOST_SELECTOR) : null
  if (observing && sameTargets(headers, feed)) return
  observer.disconnect()
  observing = true
  observedHeaders = headers
  observedFeed = feed
  if (!ready) {
    observer.observe(document.documentElement, { childList: true, subtree: true })
    return
  }
  for (const header of headers) observer.observe(header, { childList: true, subtree: true })
  if (feed) observer.observe(feed, { childList: true, subtree: true })
}

function startObservers() {
  sync()
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, { passive: true })
  if (observer) return
  observer = new MutationObserver((mutations) => {
    // 元素缺失时立即补齐，避免顶栏出现后左侧短暂空白 / 顶部状态残留。
    // 左侧导航发生变化（B 站在顶部 / 下滑之间整块替换「首页」节点）时也立即同步，
    // 保证「动态」改名、面板挂载即时到位（箭头已由 CSS 绘制，不再依赖这里）。
    // 顶栏刚接入时也立即同步一次，避免 200ms 去抖带来的可见延迟。
    //
    // 性能：这段回调在每个 DOM 批次上都会跑，首屏 B 站会打出成百上千批，
    // 所以这里只做最便宜的判断 ——
    // - 顶栏出现后不再每批都 querySelector('.bili-header')（一次就够了）；
    // - 预加载哨兵只有首页才有，没有哨兵时整段 touchesFeed 直接跳过
    //   （它要遍历 addedNodes 并逐个 matches，实测占首屏脚本时间的 60%）。
    let headerJustAppeared = false
    if (!headerSeen && document.querySelector('.bili-header')) {
      headerSeen = true
      headerJustAppeared = true
    }
    // 信息流换过就打个脏标记，下一次 sync() 会重建预加载观察器
    if (preloadAnchor && touchesFeed(mutations)) preloadDirty = true
    markNewCards(mutations)
    if (headerJustAppeared || (headerSeen && touchesLeftEntry(mutations)))
      sync()
    schedule()
  })
  observeRoots()
}

function stopObservers() {
  window.removeEventListener('resize', schedule)
  window.removeEventListener('scroll', schedule)
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  observer?.disconnect()
  observer = null
  observing = false
  observedHeaders = []
  observedFeed = null
}

function injectStyle(id: string, css: string) {
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  ;(document.head || document.documentElement).appendChild(style)
}

function ensureStyle() {
  injectStyle(STYLE_ID, topbarCss)
  injectStyle(HOME_STYLE_ID, homeOptimizeCss)
  injectStyle(SEARCH_STYLE_ID, searchOptimizeCss)
}

function removeStyle() {
  document.getElementById(STYLE_ID)?.remove()
  document.getElementById(HOME_STYLE_ID)?.remove()
  document.getElementById(SEARCH_STYLE_ID)?.remove()
}

function applyHome(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_HOME, enabled)
  if (enabled) {
    startObservers()
  } else {
    headerSeen = false
    cleanElements()
    stopObservers()
  }
}

function applyGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_GLASS, enabled)
}

/** 「首页优化」：只切一个 root class，纯 CSS 生效（无需 JS 观察器） */
function applyHomeOnly(enabled: boolean) {
  const root = document.documentElement.classList
  const was = root.contains(ROOT_HOME_ONLY)
  root.toggle(ROOT_HOME_ONLY, enabled)
  // 滚动条常驻只给首页（见 ROOT_HOME_SCROLL 的注释）。首页优化关掉时一并撤掉：
  // 那时连内容区留白都回到 B 站原版了，没必要再为「首帧不横移」多留一条滚动条槽。
  root.toggle(ROOT_HOME_SCROLL, enabled && isHomePage())
  // 关掉「首页优化」→ 首页整页重载**一次**（1.2.0 v007 修掉了无限循环）。
  //
  // 为什么必须重载：首页大 banner 的动画图层是 JS 建的，`guard.js` 在「首页优化开着」时
  // 把那 28 张 `/bfs/vc/*` 换成 1×1 透明图、请求根本不发。图加载失败之后
  // `<animated-banner>` 组件**整个不挂载**（实测：关掉后 DOM 里没有这个元素），
  // banner 只剩静态底图 —— 不刷新就一直是静态的。
  // 但**没有空洞也没有碎图**（实测 `broken images = 0`，底图照常显示），所以这条重载
  // 纯粹是为了把动画层找回来，不是修版。
  //
  // **为什么以前会无限刷新**：页面刚打开时 `get('homeOptimize')` 还是默认值 `true`，
  // 根类被挂上；几十毫秒后 storage 里的真实值 `false` 到达，`was && !enabled` 成立 ——
  // 和「用户刚关掉」长得一模一样 → 又 reload。现在用 `isUserEdit()` 卡住：
  // 只有设置面板里真的点了这一下才重载（storage 快照 / 跨标签页同步一律不触发）。
  //
  // 再加一道「组件真的没挂上才刷」：万一哪天 B 站换了实现、banner 还在，就不必打扰用户。
  if (
    was && !enabled
    && isUserEdit()
    && isHomePage()
    && !document.querySelector('.bili-header__banner animated-banner')
  )
    window.setTimeout(() => location.reload(), 0)
}

/** 首页判定（`/index.html` 也算，B 站两种入口都有） */
function isHomePage(): boolean {
  return location.hostname === 'www.bilibili.com'
    && (location.pathname === '/' || location.pathname === '/index.html')
}

/** 搜索页上参与涟漪的控件：排序行 + 展开「更多筛选」后的芯片 + 直播页的筛选行与排序行 +
 *  「更多筛选」本体 + 分类标签栏（样式分别在 searchOptimize.css 的「筛选按钮」与「分类标签栏」） */
const SEARCH_RIPPLE = [
  '.search-conditions .vui_button--tab', // 排序行 + 展开的日期 / 时长芯片
  '.live-condition .vui_button--tab', // 直播页的 全部 / 主播 / 直播间
  '.search-page-live .live-room .room-header .live-type-btn', // 直播页的 综合排序 / 最新开播
  '.i_button_more', // 「更多筛选」/「查看更多」本体
  '.search-tabs .vui_tabs--nav-item',
].join(',')
let offSearchRipple: (() => void) | null = null

/** 「搜索页优化」：同样只切一个 root class，纯 CSS 生效（无需 JS 观察器）。
 *  筛选按钮 / 标签的涟漪不是纯 CSS 能做的（见 ripple.ts），所以在搜索页上跟着这个开关装 / 卸。 */
function applySearchOnly(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_SEARCH_ONLY, enabled)
  if (location.hostname !== 'search.bilibili.com')
    return
  if (enabled && !offSearchRipple) {
    offSearchRipple = installRipple(document, SEARCH_RIPPLE)
  }
  else if (!enabled && offSearchRipple) {
    offSearchRipple()
    offSearchRipple = null
  }
}

/** 「搜索框材质」/「搜索面板材质」：只切 root class，纯 CSS 生效（无需 JS 观察器） */
function applySearchBoxGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_SEARCHBOX_GLASS, enabled)
}

function applySearchPanelGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_SEARCHPANEL_GLASS, enabled)
}

function applyHomePanelGlass(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_HOMEPANEL_GLASS, enabled)
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
function syncPreloadAnchor(force = false) {
  const anchor = document.querySelector<HTMLElement>(
    '.recommended-container_floor-aside .container > .load-more-anchor',
  )
  // force：节点没变也要重建观察器 —— 重建时的初始回调会按当前几何重新判定一次
  if (!force && anchor === preloadAnchor) return
  preloadObserver?.disconnect()
  preloadAnchor = anchor
  if (!anchor) {
    stopKeepAlive()
    return
  }
  preloadObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      // 哨兵被 §11 上抬了 --bili-preload-dist（默认 150vh），所以「滚到真实底部」时它
      // 反而落在视口**上方**：这时 isIntersecting 是 false，但 B 站自己的判据
      // （rect.bottom <= 视口底 + 200）依然成立 —— 保活定时器必须继续跑。
      // 漏了这一条，用户停在底部不动就再也收不到 scroll，骨架会一直挂着
      // （点「刷新」之后尤其明显：新信息流一进来，视口位置和哨兵位置全变了）。
      if (e.isIntersecting || e.boundingClientRect.bottom < 0) startKeepAlive()
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

/** 「布局优化」两条：只切 root class，纯 CSS 生效（无需 JS 观察器）。
 *  1.1.6 v011 起没有开关了 —— 两个 class 常驻（面板里那两项已删，见 features.ts）。 */
function applyLayoutCompact() {
  document.documentElement.classList.add(ROOT_RAIL_COMPACT, ROOT_NOTICE_COMPACT)
}

/** 「原生刷新 / 原生返回顶部按钮屏蔽」：只切 root class，纯 CSS 生效（见 topbar.css §17）。
 *  同样从 v011 起常驻。 */
function applyNativeHide() {
  document.documentElement.classList.add(ROOT_NATIVE_REFRESH_HIDE, ROOT_NATIVE_BACKTOP_HIDE)
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
  const url = chromeGetURL('assets/logo-mascot.png')
  if (url) root.style.setProperty('--bili-logo-img', `url("${url}")`)
}

/** 卡片相关的几个开关：只切 root class，纯 CSS 生效（无需 JS 观察器） */
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

/** 把「触发面板」的模糊 / 遮罩强度写入 CSS 变量（topbar.css §7.1 / §7.5 共用） */
function applyHomePanelParams() {
  const { blur, tint } = getHomePanelParams()
  const root = document.documentElement.style
  root.setProperty('--bili-homepanel-blur', `${blur}px`)
  root.setProperty('--bili-homepanel-tint', `${Math.min(100, Math.max(0, tint)) / 100}`)
}

/**
 * 把「预加载范围」（百分比）写成 CSS 变量：topbar.css §11 用它做哨兵的位移。
 * 写成 vh 是因为哨兵的触发判据基于视口高度，用百分比才能随窗口大小自适应。
 */
function applyPreloadParams() {
  const { dist } = getPreloadParams()
  document.documentElement.style.setProperty('--bili-preload-dist', `${dist}vh`)
}

/** 把设置里的顶栏模糊 / 遮罩强度 / 背景明暗写入 CSS 变量，所有页面统一生效 */
function applyTopbarParams() {
  const { blur, tint, bright } = getTopbarParams()
  const root = document.documentElement.style
  root.setProperty('--bili-topbar-blur', `${blur}px`)
  // 遮罩是不透明度（0–1），独立于模糊：模糊拉到 0 也能靠它把白底关掉
  root.setProperty('--bili-topbar-tint', `${Math.min(100, Math.max(0, tint)) / 100}`)
  // 背景明暗 → backdrop-filter 的 brightness()：50 是中性 1.0，55 → 1.08（与旧版写死的值一致）
  root.setProperty('--bili-topbar-bright', `${(1 + (Math.min(100, Math.max(0, bright)) - 50) * 0.016).toFixed(3)}`)
  root.setProperty('--bili-topbar-arrow', ARROW_MASK)
}

/** 「顶栏渐变」：给顶栏玻璃换成上实下透的竖向渐变（样式在 topbar.css §7.3） */
function applyTopbarFade(on: boolean) {
  document.documentElement.classList.toggle(ROOT_TOPBAR_FADE, on)
}

export function setupTopbarOptimize(): () => void {
  // 个人空间 / 历史记录：整条顶栏保持 B 站原版，直接不接
  if (isTopbarOptExcluded()) return () => {}

  // 顶栏优化对所有页面始终生效（无开关）；各「材质」才是毛玻璃的开关
  ensureStyle()
  applyHome(true)
  applyHomeOnly(get('homeOptimize'))
  applySearchOnly(get('searchOptimize'))
  applyGlass(get('topbarGlass'))
  applyTopbarFade(get('topbarFade'))
  applySearchBoxGlass(get('searchBoxGlass'))
  applySearchPanelGlass(get('searchPanelGlass'))
  applyHomePanelGlass(get('homePanelGlass'))
  applyPreload(get('preload'))
  applyCardScopes()
  applyLayoutCompact()
  applyNativeHide()
  applyMascotLogo()
  applyTopbarParams()
  applySearchParams()
  applyHomePanelParams()
  applyPreloadParams()

  const off = onConfigChange((key) => {
    if (key === 'topbarGlass') {
      applyGlass(get('topbarGlass'))
    }
    else if (key === 'topbarFade') {
      applyTopbarFade(get('topbarFade'))
    }
    else if (key === 'homeOptimize') {
      applyHomeOnly(get('homeOptimize'))
    } else if (key === 'searchOptimize') {
      applySearchOnly(get('searchOptimize'))
    } else if (key === 'searchBoxGlass') {
      applySearchBoxGlass(get('searchBoxGlass'))
    } else if (key === 'searchPanelGlass') {
      applySearchPanelGlass(get('searchPanelGlass'))
    } else if (key === 'homePanelGlass') {
      applyHomePanelGlass(get('homePanelGlass'))
    } else if (key === 'preload') {
      applyPreload(get('preload'))
    } else if (key === 'mascotLogo') {
      applyMascotLogo()
    } else if (key in CARD_SCOPE_CLASSES) {
      applyCardScopes()
    }
  })

  const offTopbarParams = onTopbarParamsChange(applyTopbarParams)
  const offSearchBoxParams = onSearchBoxParamsChange(applySearchParams)
  const offSearchPanelParams = onSearchPanelParamsChange(applySearchParams)
  const offHomePanelParams = onHomePanelParamsChange(applyHomePanelParams)
  const offPreloadParams = onPreloadParamsChange(applyPreloadParams)

  const dispose = () => {
    off()
    offSearchRipple?.()
    offSearchRipple = null
    offTopbarParams()
    offSearchBoxParams()
    offSearchPanelParams()
    offHomePanelParams()
    offPreloadParams()
    stopKeepAlive()
    preloadObserver?.disconnect()
    preloadObserver = null
    preloadAnchor = null
    stopObservers()
    document.querySelectorAll(`.${FILL_CLASS}`).forEach(el => el.remove())
    document.querySelectorAll(`.${GHOST_CLASS}`).forEach(el => el.remove())
    document.querySelectorAll(`.${BLANK_CLASS}`).forEach(el => el.classList.remove(BLANK_CLASS))
    removeStyle()
    cleanElements()
    document.documentElement.classList.remove(
      ROOT_HOME,
      ROOT_GLASS,
      ROOT_TOPBAR_FADE,
      ROOT_HOME_ONLY,
      ROOT_HOME_SCROLL,
      ROOT_SEARCH_ONLY,
      ROOT_SEARCHBOX_GLASS,
      ROOT_SEARCHPANEL_GLASS,
      ROOT_HOMEPANEL_GLASS,
      ROOT_PRELOAD,
      ROOT_RAIL_COMPACT,
      ROOT_NOTICE_COMPACT,
      ROOT_NATIVE_REFRESH_HIDE,
      ROOT_NATIVE_BACKTOP_HIDE,
      ROOT_MASCOT_LOGO,
      ...Object.values(CARD_SCOPE_CLASSES),
    )
    document.documentElement.style.removeProperty('--bili-topbar-blur')
    document.documentElement.style.removeProperty('--bili-topbar-tint')
    document.documentElement.style.removeProperty('--bili-topbar-bright')
    document.documentElement.style.removeProperty('--bili-topbar-arrow')
    document.documentElement.style.removeProperty('--bili-searchbox-blur')
    document.documentElement.style.removeProperty('--bili-searchbox-tint')
    document.documentElement.style.removeProperty('--bili-searchpanel-blur')
    document.documentElement.style.removeProperty('--bili-searchpanel-tint')
    document.documentElement.style.removeProperty('--bili-homepanel-blur')
    document.documentElement.style.removeProperty('--bili-homepanel-tint')
    document.documentElement.style.removeProperty('--bili-preload-dist')
    document.documentElement.style.removeProperty('--bili-logo-img')
  }
  disposeTopbarOpt = dispose
  return () => {
    disposeTopbarOpt = null
    dispose()
  }
}

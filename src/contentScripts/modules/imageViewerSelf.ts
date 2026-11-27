/**
 * 自绘图片查看器（1.2.5 v037）
 *
 * **为什么不再用 B 站的 PhotoSwipe**：我们在官方看图器上外挂了一整条工具栏
 * （缩放 / 旋转 / 复位）、开合 FLIP、点图不触发 —— 每一样都要绕「实例只在页面世界的
 * `window.pswp`」这道墙：缩放靠 `guard.js` 代劳、点图行为靠改 `options`、FLIP 靠轮询
 * `.pswp` 节点。功能越多，绕得越多，还动不动被 B 站自己的点击行为打断。
 *
 * 这一层完全自己画：`fixed` 全屏层 + 一张 `<img>` + 一条工具栏。缩放 / 平移 / 旋转
 * 全是本地 `transform`，没有跨世界、没有实例、没有 guard.js。
 *
 * 交互：
 *   · 滚轮 / 双指：以指针为中心缩放（0.5x ~ 8x，工具栏最右边显示当前百分比）
 *   · 放大后拖拽：平移；不放大时拖拽无效果
 *   · 双击：1x / 2.5x 切换
 *   · 工具栏：缩小 / 放大 / 向左旋转 / 向右旋转 / 复位
 *   · 键盘：Esc 关闭、←/→ 切图、+/- 缩放、0 复位
 *   · **点图片什么都不做**（用户明确要求，方便放大后拖拽）；点图片外的空白 / 关闭键才关
 *   · 多图：左右箭头 + 顶部计数
 *
 * 结构见 `imageViewerSelf.css` 的文件头。
 */

import { get } from '../config'
import { warn } from '../logger'
import { prefersReducedMotion } from './designTokens'
import { getGlassParams } from './glassConfig'
import { installRipple } from './ripple'
import { getViewerParams } from './viewerParams'
import css from './imageViewerSelf.css?inline'

const STYLE_ID = 'bili-elite-iv-style'
const ROOT_CLASS = 'blie-iv'
const BTN_CLASS = 'blie-iv__btn'
/** 缩放区间（下限 0.5 = 可以缩到一半，上限 8x）；步进见 stepFactor / wheelFactor */
const MIN_SCALE = 0.5
const MAX_SCALE = 8
/* 缩放步进读设置面板的参数（默认按钮 30%、滚轮 10%），见 viewerParams.ts */
const DBL_SCALE = 2.5
/** 横向拖拽的跟手阻尼（手指移 100px，图只移 35px） */
const SWIPE_FOLLOW = 0.35
/** 触发切图的最小横向距离（还会再和视口 12% 取小） */
const SWIPE_THRESHOLD = 120

/** 单次预加载 / 单次上屏的等待上限。**别指望一次就成**：超时的请求还在后台跑，
 *  下一次重试多半直接命中缓存（见 scheduleUpgradeRetry）—— 所以这里可以短一点，
 *  让「失败 → 重试」转得快些，而不是让用户对着糊图干等 30 秒。 */
const PRELOAD_TIMEOUT = 8000
const PRELOAD_TRIES = 2
const SWAP_TIMEOUT = 8000
/** 原图没上屏时的重试节奏（ms）。慢网 / 图太大 / 后台标签页被限速都靠这几轮兜住 */
const RETRY_DELAYS = [2000, 6000, 15000, 30000]
/** 等比缩略图那一档的宽度（`@480w`）；页面缩略图本身已经够宽就跳过这一档 */
const MID_WIDTH = 480
/** 换图时最多等解码多久（ms）：超时也照上，几何过渡先跑 */
const DECODE_WAIT = 120
/**
 * 中间档（`@480w`）先压这么久再上。
 * 原图在快网 / 命中缓存时 100ms 内就到了，中档紧跟着上只会让画面连跳两次
 * （用户要求「不要丢动画」，连跳两次的观感就是抖一下）。压一下，原图先到就整档跳过。
 */
const MID_DELAY = 220

/* 与 imageViewer.ts 的 IMAGE_DUR_OPEN / IMAGE_DUR_CLOSE / IMAGE_EASE 保持一致。
   不直接 import：imageViewer.ts 反过来要 import 本模块的 openSelfViewer，
   两边循环依赖时 `const` 会落在 TDZ 里（打开就抛 ReferenceError）。 */
const DUR_OPEN = 330
const DUR_CLOSE = 290
const EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'

export interface SelfViewerItem {
  /** 原图地址（缩略图的 `@264w_264h_1e_1c` 后缀已经去掉） */
  src: string
  /** 页面上那张缩略图：原图加载失败时回退用 */
  thumb: string
  /** 点击时那张图在屏幕上的位置，FLIP 的起点 */
  rect: DOMRect | null
  /**
   * 页面上那张缩略图元素本身。
   * 关闭时**重新量**它的位置 —— 打开期间页面可能滚动 / 动态流重排，用点击那一刻的
   * rect 会飞到一个空位置（实测连续开关时缩略图已经上移 333px）。
   */
  el?: HTMLImageElement | null
}

/** B 站缩略图 URL 的尺寸后缀（`@264w_264h_1e_1c` / `@264w_264h_1e_1c.avif`），去掉就是原图 */
const THUMB_SUFFIX = /@[^/\s,?]+$/

/**
 * 把 `?query` 摘出来单独处理。
 *
 * **后缀只能动 path 那一段**：有些图床会在地址后面挂签名（`?sign=…&t=…`），
 * 老的写法 `/@[^/\s,]+$/` 会把 `?sign=…` 一起当成后缀吃掉 —— 换出来的「原图」
 * 是个没有签名的地址，403，于是这张图永远停在低清（而且重试多少次都没用）。
 */
function splitQuery(url: string) {
  const q = url.indexOf('?')
  return q < 0
    ? { path: url, query: '' }
    : { path: url.slice(0, q), query: url.slice(q) }
}

export function toOriginalImageUrl(url: string) {
  if (!url)
    return url
  const { path, query } = splitQuery(url)
  return path.replace(THUMB_SUFFIX, '') + query
}

const zoomIcon = (glyph: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.6"/><path d="M15.3 15.3 20.2 20.2"/>${glyph}</svg>`
const ICON_OUT = zoomIcon('<path d="M6.7 10.5h7.6"/>')
const ICON_IN = zoomIcon('<path d="M6.7 10.5h7.6M10.5 6.7v7.6"/>')
const ICON_ROT_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z"/></svg>'
const ICON_ROT_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11a7.9 7.9 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"/></svg>'
const ICON_RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 12c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zm-2-9c-4.97 0-9 4.03-9 9H0l4 4 4-4H5c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z"/></svg>'
const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>'
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>'

const BUTTONS: Array<{ act: string; label: string; icon: string }> = [
  { act: 'out', label: '缩小', icon: ICON_OUT },
  { act: 'in', label: '放大', icon: ICON_IN },
  { act: 'rotL', label: '向左旋转', icon: ICON_ROT_L },
  { act: 'rotR', label: '向右旋转', icon: ICON_ROT_R },
  { act: 'reset', label: '复位', icon: ICON_RESET },
]

interface ViewerUi {
  root: HTMLElement
  backdrop: HTMLElement
  stage: HTMLElement
  img: HTMLImageElement
  prev: HTMLButtonElement
  next: HTMLButtonElement
  count: HTMLElement
  close: HTMLButtonElement
  bar: HTMLElement
  /** 工具栏最右边的缩放比例文字（`100%`） */
  zoom: HTMLElement
}

let ui: ViewerUi | null = null
let offRipple: (() => void) | null = null
let items: SelfViewerItem[] = []
let index = 0
let open = false
/** 当前这张的缩放 / 平移 / 旋转 */
let scale = 1
let tx = 0
let ty = 0
let rot = 0
/** 换图 / 关掉之后，旧那次加载的回调不许再动 DOM */
let token = 0
/** 本次打开还没跑过 FLIP（只跑一次：缩略图先顶上时跑，原图换上来时不重复跑） */
let flipPending = false
/** 页面滚动是否被我们锁住 */
let scrollLocked = false
/**
 * 本次打开里**已经真的上屏**的清晰度档位：0 = 裁剪缩略图，1 = 等比缩略图，2 = 原图。
 *
 * 它必须是「已显示」而不是「已请求」—— 之前用 `level` 表示「这一档已经拿到」，
 * 两档并发时后拿到的那档会把 `level` 推到 2，而屏幕上其实是另一档的图，
 * 于是再也不升级（用户报的「偶尔一直糊着」）。现在只在 `swapTo` 成功之后才推进。
 */
let appliedLevel = 0
/**
 * 已经在换 / 已经换上的**最高**档位（同步占位）。
 *
 * 上屏是「谁先就绪谁上」，两档并行跑，所以必须有这个同步闸门：高档一就绪就把它抬到 2，
 * 之后才就绪的低档一看 `level <= claimedLevel` 就直接丢掉 —— 既不会降级，
 * 也不会让「原图已经在路上」时再插一次更糊的中间图。
 */
let claimedLevel = 0
/** 每次上屏的序号：高档抢占时自增，在飞的低档回调据此作废（不许再动 DOM / 还原 src） */
let swapSeq = 0
/** 原图重试的定时器（同一时刻只留一个） */
let retryTimer = 0
/**
 * 打开看图器**之前**焦点在谁身上 —— 关闭时要还回去。
 *
 * 这一层是盖在整页上的遮罩：用户点缩略图那一下（mousedown）就会把原来的焦点抢到
 * 顶层文档，而**焦点一旦离开 iframe，iframe 里的键盘处理就再也收不到按键**。
 * 动态悬浮窗里的播放器正是跑在 iframe 里的：看完图回来按 ← → 没反应，就是焦点
 * 没还回去（用户报的那个）。所以要在 `pointerdown` 捕获阶段（比浏览器挪焦点还早）
 * 把它记下来，关闭时 `focus()` 回去 —— 对 `<iframe>` 调 focus 能把它的文档重新激活。
 */
let focusBack: HTMLElement | null = null

/** 指针：1 个 = 拖拽，2 个 = 缩放 */
const pointers = new Map<number, { x: number, y: number }>()
let dragging = false
let startX = 0
let startY = 0
let baseTx = 0
let baseTy = 0
let pinchStartDist = 0
let pinchStartScale = 1
let pinchStartTx = 0
let pinchStartTy = 0
let pinchStartMidX = 0
let pinchStartMidY = 0
/** 未放大时的横向拖拽（左右切图）：跟手位移 + 是否已经判定为横向 */
let swipeDx = 0
let swipeH: boolean | null = null
/** 切图动画进行中，挡住重复触发 */
let sliding = false

/** 按钮一次的缩放**增量**（用户要的是加法：100% → +30% → 130% → +30% → 160%） */
function stepDelta() {
  return getViewerParams().step / 100
}

/** 滚轮一格的缩放增量 */
function wheelDelta() {
  return getViewerParams().wheel / 100
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

/** 背景明暗：50 为中性，越低越暗（黑罩）、越高越亮（白罩）—— 与 imageGlass 同一套换算 */
function tintFor(brightness: number) {
  const mid = 50
  const maxAlpha = 0.9
  if (brightness <= mid)
    return `rgba(0, 0, 0, ${(((mid - brightness) / mid) * maxAlpha).toFixed(3)})`
  return `rgba(255, 255, 255, ${(((brightness - mid) / mid) * maxAlpha).toFixed(3)})`
}

function injectStyle() {
  if (document.getElementById(STYLE_ID))
    return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.appendChild(style)
}

/* ===== DOM ===== */

function build(): ViewerUi {
  const root = document.createElement('div')
  root.className = ROOT_CLASS
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', '图片查看器')
  root.setAttribute('aria-hidden', 'true')
  // `aria-modal` **只在真的打开时挂**（见 openSelfViewer）：一个藏起来的层永远标着
  // 「我是模态对话框」，别的脚本（含页面自己的）按这个判断就会以为页面上一直开着弹窗。
  root.innerHTML = [
    '<div class="blie-iv__backdrop"></div>',
    '<div class="blie-iv__stage"><img class="blie-iv__img" alt=""></div>',
    `<button class="blie-iv__nav is-prev" type="button" aria-label="上一张">${ICON_PREV}</button>`,
    `<button class="blie-iv__nav is-next" type="button" aria-label="下一张">${ICON_NEXT}</button>`,
    '<div class="blie-iv__count"></div>',
    `<button class="blie-iv__close" type="button" aria-label="关闭">${ICON_CLOSE}</button>`,
    `<div class="blie-iv__bar" role="toolbar" aria-label="图片工具">${BUTTONS
      .map(b => `<button class="${BTN_CLASS}" type="button" data-act="${b.act}" title="${b.label}" aria-label="${b.label}">${b.icon}</button>`)
      .join('')}<span class="blie-iv__zoom">100%</span></div>`,
  ].join('')

  document.documentElement.appendChild(root)

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel) as T
  const viewer: ViewerUi = {
    root,
    backdrop: q<HTMLElement>('.blie-iv__backdrop'),
    stage: q<HTMLElement>('.blie-iv__stage'),
    img: q<HTMLImageElement>('.blie-iv__img'),
    prev: q<HTMLButtonElement>('.blie-iv__nav.is-prev'),
    next: q<HTMLButtonElement>('.blie-iv__nav.is-next'),
    count: q<HTMLElement>('.blie-iv__count'),
    close: q<HTMLButtonElement>('.blie-iv__close'),
    bar: q<HTMLElement>('.blie-iv__bar'),
    zoom: q<HTMLElement>('.blie-iv__zoom'),
  }
  viewer.img.draggable = false
  bind(viewer)
  offRipple = installRipple(document, `.${BTN_CLASS}`)
  return viewer
}

function ensureUi(): ViewerUi | null {
  if (!ui)
    ui = build()
  return ui
}

/* ===== 变换 ===== */

function apply() {
  const u = ui
  if (!u)
    return
  u.img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rot}deg)`
  u.root.classList.toggle('is-zoomed', scale > 1.01)
  // 工具栏上的比例：100% = 这张图刚好铺满视口（contain）时的尺寸
  u.zoom.textContent = `${Math.round(scale * 100)}%`
}

/** 图片比视口大时，把平移量收回边界内（不然能拖到完全看不见） */
function clampPan() {
  const u = ui
  if (!u)
    return
  const r = u.img.getBoundingClientRect()
  const overX = Math.max(0, (r.width - window.innerWidth) / 2)
  const overY = Math.max(0, (r.height - window.innerHeight) / 2)
  const nx = clamp(tx, -overX, overX)
  const ny = clamp(ty, -overY, overY)
  if (nx !== tx || ny !== ty) {
    tx = nx
    ty = ny
    apply()
  }
}

/**
 * 以视口里某个点为中心缩放。
 *
 * 元素未变换时的中心就在视口中心（stage 是铺满视口的 flex 居中），
 * 变换后的中心 = 视口中心 + (tx, ty)。要让指针下面那一点不动，推出来是：
 *   t' = (p - center)(1 - k) + k·t,  k = z' / z
 * 旋转不参与推导 —— 均匀缩放和旋转可交换，绕中心转不改变中心。
 */
function zoomAt(next: number, cx: number, cy: number) {
  const z = clamp(next, MIN_SCALE, MAX_SCALE)
  if (Math.abs(z - scale) < 0.001)
    return
  const k = z / scale
  const centerX = window.innerWidth / 2
  const centerY = window.innerHeight / 2
  tx = (cx - centerX) * (1 - k) + k * tx
  ty = (cy - centerY) * (1 - k) + k * ty
  scale = z
  apply()
  clampPan()
}

/** 以视口中心为基准做一次**增量**缩放（加法，不是乘法） */
function zoomBy(delta: number) {
  zoomAt(scale + delta, window.innerWidth / 2, window.innerHeight / 2)
}

/** 旋转 90° 后外接矩形变成 (h, w)，超出视口就缩到装得下 */
function fitRotated() {
  const u = ui
  if (!u)
    return
  const bw = u.img.clientWidth
  const bh = u.img.clientHeight
  if (!bw || !bh)
    return
  const quarter = rot % 180 !== 0
  const w = quarter ? bh : bw
  const h = quarter ? bw : bh
  const fit = Math.min(window.innerWidth / w, window.innerHeight / h, 1)
  if (fit < 1) {
    scale = fit
    tx = 0
    ty = 0
    apply()
  }
}

function reset() {
  rot = 0
  scale = 1
  tx = 0
  ty = 0
  apply()
}

/**
 * 关掉之后把大图从 `<img>` 上摘下来。
 *
 * 图层虽然 `display: none`，但 `<img>` 解码后的位图还挂在元素上 —— 一张 4K 图解码后
 * 是 30~50MB，看几张图之后标签页常驻内存就是这么涨上去的（而且再也掉不下来，
 * 除非换 src 或整页刷新）。下次打开由 `show()` 重新赋 src，命中 HTTP 缓存，不会变慢。
 */
function releaseImage() {
  const u = ui
  if (!u)
    return
  u.img.removeAttribute('src')
  u.img.style.left = '0'
  u.img.style.top = '0'
  u.img.style.width = '0'
  u.img.style.height = '0'
  // 档位标记也清掉：关掉之后还挂着 `L2` 会误导排查（`data-iv-*` 是给人看的）
  delete u.root.dataset.ivLevel
  delete u.root.dataset.ivNat
}

/* ===== 打开 / 关闭 / 切图 ===== */

/** 按这张图的原始比例，算出它在视口里 contain 之后的位置和尺寸 */
function containRect(nw: number, nh: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const s = Math.min(vw / nw, vh / nh)
  const w = nw * s
  const h = nh * s
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
}

/**
 * 把图片摆到「当前这张图 contain 之后」的位置。
 *
 * 几何由 JS 写死（`left/top/width/height`），不走 `max-width: 100%` 让浏览器自己算 ——
 * 裁剪缩略图 / 等比缩略图 / 原图三者的比例各不相同，只有我们知道目标 rect，才能让
 * 这三者之间的切换走 CSS transition 平滑过渡（见 imageViewerSelf.css 的 `.blie-iv__img`）。
 *
 * `animate = false` 用于首帧和换图前那一次定位：必须瞬时，否则会看到图片从 0×0 长出来。
 */
function placeImg(animate: boolean) {
  const u = ui
  if (!u)
    return
  const nw = u.img.naturalWidth
  const nh = u.img.naturalHeight
  if (!nw || !nh)
    return
  const r = containRect(nw, nh)
  if (!animate)
    u.img.classList.add('is-snap')
  u.img.style.left = `${r.x}px`
  u.img.style.top = `${r.y}px`
  u.img.style.width = `${r.w}px`
  u.img.style.height = `${r.h}px`
  if (!animate) {
    // 强制一次布局，让 transition 从这一帧重新计时
    void u.img.offsetWidth
    u.img.classList.remove('is-snap')
  }
}

/**
 * 裁剪缩略图 → **等比缩略图**的地址。
 *
 * B 站图床的后缀：`@264w_264h_1e_1c` 是「宽 264、高 264、居中裁剪」，被裁成正方形；
 * 只写 `@480w` 就是「宽 480、高度按比例」（实测 264×264 的方形图变成 480×778 的完整图）。
 * 480 宽比 264 清楚一截、又比原图小得多，拿来做中间那一档正好。
 */
export function toMidThumbUrl(url: string) {
  if (!url)
    return ''
  const { path, query } = splitQuery(url)
  if (!/@[^/]+$/.test(path))
    return ''
  const ext = /\.(avif|webp|jpe?g|png)$/i.exec(path)?.[0] ?? ''
  const next = path.replace(/@[^/]+$/, `@480w${ext}`)
  return next === path ? '' : next + query
}

/** 在飞的预加载（切图 / 关闭时要能掐掉，别让旧图继续抢带宽） */
const inflight = new Set<HTMLImageElement>()
/** 预加载的代次：中止后自增，`preloadWithRetry` 据此不再重试（否则掐完又发一轮新的） */
let preloadGen = 0

function abortPreloads() {
  preloadGen++
  if (!inflight.size)
    return
  inflight.forEach((im) => {
    // 摘 src 会中止请求（切走的那张不该继续占着连接，用户真正要看的那张才该快）
    im.onload = null
    im.onerror = null
    im.src = ''
  })
  inflight.clear()
}

/** 预加载一张图（只为了塞进 HTTP 缓存 + 确认能解码），不碰页面上的 `<img>` */
function preloadUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false)
      return
    }
    const im = new Image()
    let done = false
    const finish = (ok: boolean) => {
      if (done)
        return
      done = true
      inflight.delete(im)
      // 摘掉回调，让这个离屏 img 尽早变成垃圾（它那份解码后的位图不该一直挂着）
      im.onload = null
      im.onerror = null
      resolve(ok)
    }
    inflight.add(im)
    im.onload = () => finish(!!im.naturalWidth)
    im.onerror = () => finish(false)
    // **必须是 high**：离屏 `new Image()` 在 Chrome 里默认按 low 优先级发请求，
    // 页面正在刷缩略图 / 视频时会被排到后面，原图就干等好几秒 —— 网络没变却「很慢」
    // 多半就是这条。`fetchPriority` 要在赋 `src` 之前设。
    im.fetchPriority = 'high'
    im.src = url
    if (im.complete && im.naturalWidth)
      finish(true)
    // 兜底：一直不回调就当失败（不然 upgrade 会永远挂着，停在缩略图上）。
    // **注意**：这里只是「我们不等了」，请求还在后台跑 —— 下一次重试多半直接命中缓存。
    window.setTimeout(() => finish(false), PRELOAD_TIMEOUT)
  })
}

/** 带重试的预加载：网络抖一下不该让这张图永远停在模糊的缩略图（用户报的「有概率模糊」） */
async function preloadWithRetry(url: string, tries = PRELOAD_TRIES): Promise<boolean> {
  const gen = preloadGen
  for (let i = 0; i < tries; i++) {
    if (await preloadUrl(url))
      return true
    // 已经被中止（切图 / 关闭）：别再发下一轮，否则掐掉的请求又活过来
    if (gen !== preloadGen)
      return false
    if (i < tries - 1)
      await new Promise(r => window.setTimeout(r, 400))
  }
  return false
}

/**
 * 把 `url` 换到查看器那张 `<img>` 上，并等它**真的能显示**（load + decode）。
 *
 * 返回 false 时旧图原样留着 —— 绝不能出现「换了 src 但没加载出来」的白板，
 * 那比糊着更糟。`decode()` 可能永远不 settle（个别 AVIF），所以整段都有超时兜底：
 * 超时那一刻只要 `naturalWidth > 0` 就按成功算（图已经在了，只是解码慢）。
 *
 * `seq` 是这次上屏的序号：更高一档抢占时 `swapSeq` 会自增，这里所有回调先对一次
 * `mine()` —— 被抢占的那次**一个 DOM 都不要碰**（尤其不能把 src 还原成低档，
 * 那会把刚上屏的原图又打回去）。
 */
function swapTo(url: string, t: number, seq: number): Promise<boolean> {
  const u = ui
  if (!u)
    return Promise.resolve(false)
  const mine = () => t === token && open && seq === swapSeq
  return new Promise<boolean>((resolve) => {
    let settled = false
    const prev = u.img.getAttribute('src') || ''
    const finish = (ok: boolean) => {
      if (settled)
        return
      settled = true
      window.clearTimeout(timer)
      if (!mine()) {
        // 被更高档抢了（或已经关掉 / 切图）：什么都不许动，包括 onload / onerror
        resolve(false)
        return
      }
      u.img.onload = null
      u.img.onerror = null
      // 换失败了要把上一档**放回去**：src 一改元素就空了，不还原的话屏幕上是一块
      // 空白 —— 比糊着难看得多（CDN 不走缓存时就会走到这条）。
      if (!ok && prev && prev !== url)
        u.img.src = prev
      resolve(ok)
    }
    const timer = window.setTimeout(
      () => finish(u.img.complete && u.img.naturalWidth > 0),
      SWAP_TIMEOUT,
    )
    u.img.onload = () => {
      if (!mine()) {
        finish(false)
        return
      }
      // **一 load 就重摆几何**：`naturalWidth` 这时候已经有了，再等 decode 才摆的话，
      // 会有 100ms 左右把原图塞进缩略图那个方框里（`object-fit: cover` 直接裁一刀），
      // 看起来就是「先跳一下再展开」。decode 完 applyLevel 还会再摆一次（值相同，无感）。
      placeImg(true)
      // **不等完整解码**：大图 `decode()` 是纯 CPU，实测 100~300ms，用户要的是
      // 「加载好就换」。这里最多等 `DECODE_WAIT`，超时也照上（图已经在了，
      // 几何过渡先跑，解码完自然画出来）。
      const dec = u.img.decode().then(() => true, () => u.img.naturalWidth > 0)
      Promise.race([
        dec,
        new Promise<boolean>(r => window.setTimeout(() => r(true), DECODE_WAIT)),
      ]).then(ok => finish(ok))
    }
    u.img.onerror = () => finish(false)
    // **不要先 removeAttribute('src')**：那会让元素空白一帧（屏幕上正显示着上一档的图，
    // 会闪一下空舞台）。ladder 里每一档的地址都互不相同，直接赋值一定会触发 load；
    // 真撞上同一个地址（浏览器归一化后相等）就当已经在屏上了。
    if (u.img.src === url) {
      finish(u.img.complete && u.img.naturalWidth > 0)
      return
    }
    // 换图这一下也走 high：万一缓存没接住要重新下，别再排到队尾
    u.img.fetchPriority = 'high'
    u.img.src = url
    if (u.img.complete && u.img.naturalWidth > 0)
      finish(true)
  })
}

/**
 * 上屏一档：**就绪即上**，高档抢占低档。
 *
 * 这是 v047 改的核心。v046 是「两档并行下载、串行上屏」，原图必须等中档那次
 * 260ms 过渡 + 解码跑完才轮到 —— 用户体感就是「高清图替换很慢」。现在谁先就绪谁先上：
 * 中档先到就当中档过渡，原图先到就直接上原图、中间档根本不出现。
 * 不降级由 `claimedLevel` 同步闸门保证（不是靠排队）。
 */
async function applyLevel(url: string, level: number, t: number) {
  const u = ui
  if (!u || t !== token || !open)
    return false
  if (level <= claimedLevel)
    return false
  claimedLevel = level
  const seq = ++swapSeq
  const ok = await swapTo(url, t, seq)
  if (t !== token || !open || seq !== swapSeq)
    return false
  if (!ok) {
    // 这一档没换上去：把占位让回去，别把更低的一档也一起挡死
    if (claimedLevel === level)
      claimedLevel = appliedLevel
    return false
  }
  if (level > appliedLevel) {
    appliedLevel = level
    placeImg(true)
  }
  return true
}

function show(i: number, flip: boolean) {
  const u = ui
  if (!u)
    return
  const item = items[i]
  if (!item)
    return
  const t = ++token
  const multi = items.length > 1
  u.prev.style.display = multi ? '' : 'none'
  u.next.style.display = multi ? '' : 'none'
  u.count.textContent = multi ? `${i + 1} / ${items.length}` : ''
  u.img.classList.remove('is-ready')
  // **必须先清掉上一张的 src**：同一张图第二次打开时 `src` 没变化，浏览器不会再触发
  // load，首帧永远不摆 → 图片停在 opacity:0，看起来就是「第二次打不开」。
  u.img.removeAttribute('src')
  // 换图 = 清晰度重新从最低档算起（旧那张的档位不能带过来，否则新图会跳过升级）；
  // `swapSeq` 自增把上一张还在飞的 swap 全部作废，免得它回头改这一张的 src
  appliedLevel = 0
  claimedLevel = 0
  swapSeq++
  cancelUpgradeRetry()

  // **下载立刻起跑**（不等首帧缩略图）：用户要的是「高清图加载好了就换」，
  // 那它的请求就不该排在占位图后面。上屏仍然等 `onFirst`（要先摆好首帧、跑完 FLIP）。
  abortPreloads()
  const steps = buildSteps(item)
  const ready = startPreloads(steps)

  // 起点用**缩略图元素现量**（`item.rect` 是点击那一刻的快照，中间可能已经重排）
  const el = item.el
  const start = el && el.isConnected ? el.getBoundingClientRect() : item.rect

  /* ---- 阶段 1：裁剪缩略图 ----
     页面上刚显示过，基本都在 HTTP 缓存里，几乎瞬间可用 —— 先把「点开有东西」解决掉，
     不让用户对着空白背景等原图（用户反馈的就是这个）。 */
  // **必须幂等**：`complete` 兜底和 `onload` 会各触发一次，不挡就会跑两遍 `loadHigher`，
  // 两组 upgrade 各带一份 `level`，原图上来之后又被等比缩略图盖回去（实测 src 来回跳）。
  let firstDone = false
  const onFirst = () => {
    if (firstDone || t !== token || !open)
      return
    firstDone = true
    // 首帧的 load / error 回调到此为止，后面换图由 swapTo 自己挂 —— 留着旧 handler
    // 会在高档加载失败时把 src 改回去（那正是「越修越糊」的另一条路）
    u.img.onload = null
    u.img.onerror = null
    placeImg(false)
    u.img.classList.add('is-ready')
    // 打开动画：从缩略图原位放大到当前尺寸
    if (flip && flipPending && start && start.width > 8 && !prefersReducedMotion()) {
      flipPending = false
      const r = u.img.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        const sx = start.width / r.width
        const sy = start.height / r.height
        // 和关闭同一套公式（见 closeSelfViewer）：stage 以自身中心为原点
        const cx = window.innerWidth / 2
        const cy = window.innerHeight / 2
        const dx = start.left + start.width / 2 - cx - sx * (r.left + r.width / 2 - cx)
        const dy = start.top + start.height / 2 - cy - sy * (r.top + r.height / 2 - cy)
        u.stage.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: 'none' },
        ], { duration: DUR_OPEN, easing: EASE })
      }
    }
    loadHigher(t, item, steps, ready)
  }

  const first = item.thumb || item.src
  // 首帧就是原图（页面那张缩略图本来就没有尺寸后缀）：已经是最清晰的一档，
  // 别再去预加载、更别让 `@480w` 把原图盖下去
  if (first && first === item.src) {
    appliedLevel = 2
    claimedLevel = 2
  }
  u.img.onload = onFirst
  u.img.onerror = () => {
    // 裁剪缩略图都取不到：直接换原图碰运气。**顺手把档位标成 2** —— 屏幕上马上就是
    // 原图了，不标的话 ladder 会把 `@480w` 盖上来（一次没必要的降级 + 再升级）
    if (t !== token || !item.src || item.src === first)
      return
    u.img.onerror = null
    appliedLevel = 2
    claimedLevel = 2
    u.img.src = item.src
  }
  u.img.src = first
  if (u.img.complete && u.img.naturalWidth)
    onFirst()
}

/**
 * 阶段 2 / 3：**等比缩略图 → 原图**，两档**并行下载、就绪即上**。
 *
 * 为什么不是排队上屏（v046 的做法，用户反馈「高清图替换很慢」）：排队时原图必须等
 * 中档那次 260ms 几何过渡 + 解码跑完，明明原图早就下载好了，却要多等半秒。
 * 现在每一档自己一就绪就调 `applyLevel()`，谁快谁上；不降级靠 `claimedLevel`
 * 同步闸门（高档一就绪立刻占位，之后到的低档直接丢）。
 *
 * 换上去都走 `placeImg(true)`（260ms 几何过渡）—— 左右切图时**首帧是瞬时的**
 * （`show()` 里那次 `placeImg(false)`），但「裁剪缩略图 → 完整图」这一步该有动画：
 * 用户明确要求「切过去如果是缩略图，缩略图变成大图的过程要有动画」。
 */
type LadderStep = { url: string, level: number }

/** 算出这张图要走的阶梯（0 → 1 → 2） */
function buildSteps(item: SelfViewerItem): LadderStep[] {
  const steps: LadderStep[] = []
  // 中档只在「页面缩略图比它更糊」时才值得加：`pswpTakeover` 里那张页面图常常已经是
  // `@1000w`，再拿 `@480w` 去换就是先降级再升级，肉眼看到的是一次「糊一下又清」。
  const thumbW = pageThumbWidth(item)
  const mid = toMidThumbUrl(item.thumb)
  if (mid && mid !== item.thumb && mid !== item.src && thumbW < MID_WIDTH)
    steps.push({ url: mid, level: 1 })
  if (item.src && item.src !== item.thumb && item.src !== mid)
    steps.push({ url: item.src, level: 2 })
  return steps
}

/**
 * **在 `show()` 里就起跑**：两档的下载立刻发出去，不等占位缩略图 load 完。
 *
 * 冷页面（缩略图也要现下）时这一步能省掉一整个缩略图往返 —— 用户要的是
 * 「高清图加载好了就换」，那它的请求就不该排在占位图后面。
 */
function startPreloads(steps: LadderStep[]) {
  return steps.map(step => preloadWithRetry(step.url))
}

/** 阶梯的上屏阶段：每一档就绪就上（`applyLevel` 负责不降级） */
function loadHigher(t: number, item: SelfViewerItem, steps: LadderStep[], ready: Array<Promise<boolean>>) {
  if (!steps.length)
    return
  const run = async (step: LadderStep, i: number) => {
    const ok = await ready[i]
    if (!ok)
      return
    if (t !== token || !open)
      return
    // 中间档压一下再上（见 MID_DELAY）：原图先到的话，`claimedLevel` 会让这一档自动作废
    if (step.level === 1)
      await new Promise(r => window.setTimeout(r, MID_DELAY))
    await applyLevel(step.url, step.level, t)
  }

  // 两档都收场（成功或失败）后还没到原图 → 排队重试，别就这么糊着
  void Promise.all(steps.map(run)).then(() => {
    if (t !== token || !open || appliedLevel >= 2)
      return
    if (item.src && item.src !== item.thumb)
      scheduleUpgradeRetry(t, item)
  })
}

/**
 * 页面那张缩略图到底有多宽（用来判断要不要插「等比缩略图」这一档）。
 *
 * 优先问元素本身（`naturalWidth` 才是真像素），拿不到再解析地址里的 `@123w`，
 * 都拿不到就当 0（宁可多升一档，也别漏）。
 */
function pageThumbWidth(item: SelfViewerItem) {
  const nat = item.el?.naturalWidth
  if (nat && nat > 0)
    return nat
  const m = /@(\d+)w/i.exec(item.thumb || '')
  return m ? Number(m[1]) : 0
}

function cancelUpgradeRetry() {
  if (!retryTimer)
    return
  window.clearTimeout(retryTimer)
  retryTimer = 0
}

/**
 * 原图没上屏时的兜底重试。
 *
 * 为什么值得单独做一轮：`preloadUrl` 超时只是「我们不等了」，请求还在后台跑，
 * 所以下一轮重试**多半直接命中缓存**、几十毫秒就上屏。真正没救的情况（原图 404）
 * 也只是白试几次，比让用户永远看着糊图强。
 */
function scheduleUpgradeRetry(t: number, item: SelfViewerItem) {
  cancelUpgradeRetry()
  let attempt = 0
  const run = () => {
    retryTimer = 0
    if (t !== token || !open || appliedLevel >= 2)
      return
    const url = item.src
    void preloadWithRetry(url, 1).then(async (ok) => {
      if (t !== token || !open || appliedLevel >= 2)
        return
      // 走同一条 `applyLevel`：重试成功也会走 `placeImg(true)` 的过渡，不会硬切
      if (ok && await applyLevel(url, 2, t))
        return
      attempt++
      if (attempt < RETRY_DELAYS.length)
        retryTimer = window.setTimeout(run, RETRY_DELAYS[attempt])
      else
        warn('[iv] 原图重试全部失败，停在低清', url.slice(-56), `L${appliedLevel}`)
    })
  }
  retryTimer = window.setTimeout(run, RETRY_DELAYS[0])
}

/**
 * 只切数据 + 换图，**不做过渡动画**（`slideTo` 内部用）。
 * 非循环：已经在最左 / 最右就返回 false（用户要的是回弹，不是绕回去）。
 */
function stepSilent(delta: number) {
  if (!open)
    return false
  const target = index + delta
  if (target < 0 || target >= items.length)
    return false
  index = target
  // 切图重置缩放 / 平移，旋转跟着整次会话走（和 B 站看图器一致）
  scale = 1
  tx = 0
  ty = 0
  apply()
  // 切图本身瞬时（首帧 `placeImg(false)`）；切过去若是裁剪缩略图，
  // 「缩略图 → 大图」那一步仍走 `loadHigher` 的动画
  show(index, false)
  fitRotated()
  return true
}

/**
 * 带「手机桌面」式滑动的切图：旧图滑出 → 换图（瞬时）→ 新图滑入。
 *
 * 滑动作用在 `stage` 的 `transform` 上，目标图的「缩略图 → 完整图」走 `img` 的
 * `left/top/width/height` 过渡 —— 两者管的属性不同，可以同时进行、不会打架。
 * `fromX` 是松手时跟手留下的偏移，动画从那里接着走，不会跳一下。
 */
async function slideTo(dir: 1 | -1, fromX = 0) {
  const u = ui
  if (!u || !open || sliding)
    return
  const target = index + dir
  if (target < 0 || target >= items.length) {
    bounceBack(fromX)
    return
  }
  sliding = true
  const reduced = prefersReducedMotion()
  const dist = Math.min(window.innerWidth * 0.32, 380)
  // 先把跟手留在 style 上的偏移、以及任何残留动画清掉，交给下面两段 WAAPI 接管
  u.stage.style.transform = ''
  u.stage.getAnimations().forEach(a => a.cancel())
  try {
    if (!reduced) {
      await u.stage.animate([
        { transform: `translateX(${fromX}px)`, opacity: 1 },
        { transform: `translateX(${-dir * dist}px)`, opacity: 0 },
      ], { duration: 150, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished.catch(() => {})
    }
    if (!open)
      return
    stepSilent(dir)
    if (!reduced) {
      await u.stage.animate([
        { transform: `translateX(${dir * dist}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { duration: 220, easing: 'cubic-bezier(0, 0, 0.2, 1)', fill: 'forwards' }).finished.catch(() => {})
    }
  }
  finally {
    // **必须清掉**：两段动画都带 `fill: forwards`，不清的话 stage 会一直停在
    // `translateX(-dist)` —— 后面的拖拽和 FLIP 全在错位的坐标系里（实测就是
    // 「切一张之后图片跑到屏幕左边、再点哪都没反应」）。
    if (open) {
      u.stage.getAnimations().forEach(a => a.cancel())
      u.stage.style.transform = ''
    }
    sliding = false
  }
}

/** 没切成功（没超过阈值 / 已经在最左最右）：从当前偏移弹回去 */
function bounceBack(fromX = 0) {
  const u = ui
  if (!u)
    return
  u.stage.style.transform = ''
  if (prefersReducedMotion() || Math.abs(fromX) < 1)
    return
  u.stage.animate([
    { transform: `translateX(${fromX}px)` },
    { transform: 'translateX(0)' },
  ], { duration: 280, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' })
}

function applyGlass() {
  const u = ui
  if (!u)
    return
  const bd = u.backdrop
  if (get('imageGlass')) {
    const p = getGlassParams()
    const bf = `blur(${p.blur}px) saturate(180%) brightness(1.02)`
    bd.style.backdropFilter = bf
    bd.style.setProperty('-webkit-backdrop-filter', bf)
    bd.style.background = tintFor(p.brightness)
  }
  else {
    bd.style.backdropFilter = 'none'
    bd.style.setProperty('-webkit-backdrop-filter', 'none')
    bd.style.background = 'rgba(0, 0, 0, 0.9)'
  }
}

/**
 * 打开时把设置键 / 浮钮 / 轮盘宿主藏起来。
 *
 * 它们挂在 `<html>` 下（`videoLayer.ts` 管的 fixed 宿主），z-index 跟这一层一样是
 * 2147483647 —— 光靠层级压不住（同值时 DOM 靠后的赢，而那几个宿主是页面早期就挂上的，
 * 我们这一层是首次打开才建的，反而在后面……但设置键会在面板重建时被重新 append）。
 * 看图时本来也用不到它们，直接藏掉最省事，关掉再恢复。
 */
const HIDDEN_HOSTS = ['bili-elite-settings-host', 'bili-elite-float-host', 'bili-elite-wheel-host']

function setHostsHidden(hidden: boolean) {
  for (const id of HIDDEN_HOSTS) {
    const el = document.getElementById(id)
    if (el)
      el.style.visibility = hidden ? 'hidden' : ''
  }
}

/**
 * 打开时锁页面滚动。右侧滚动条会消失，用 padding 把宽度补回来 ——
 * 不补的话整页会向右横移 17px，关闭时再弹回去，看着像抖了一下。
 */
function lockScroll() {
  if (scrollLocked)
    return
  scrollLocked = true
  const root = document.documentElement
  const sw = window.innerWidth - root.clientWidth
  if (sw > 0)
    root.style.paddingRight = `${sw}px`
  root.style.overflow = 'hidden'
}

function unlockScroll() {
  if (!scrollLocked)
    return
  scrollLocked = false
  const root = document.documentElement
  root.style.overflow = ''
  root.style.paddingRight = ''
}

export function openSelfViewer(list: SelfViewerItem[], i: number) {
  const u = ensureUi()
  if (!u || !list.length)
    return
  items = list
  index = clamp(i, 0, list.length - 1)
  scale = 1
  tx = 0
  ty = 0
  rot = 0
  open = true
  flipPending = true
  // 上次关闭时被显式藏掉了（见 closeSelfViewer），这里恢复
  u.root.style.display = ''
  applyGlass()
  lockScroll()
  setHostsHidden(true)
  // 上一次关闭的 FLIP 可能还挂着 `fill: forwards`（动画没跑完又打开了）——
  // 不清掉的话新图会停在「缩回去」那一帧
  u.stage.getAnimations().forEach(a => a.cancel())
  u.root.classList.add('is-open')
  u.root.setAttribute('aria-hidden', 'false')
  u.root.setAttribute('aria-modal', 'true')
  u.img.style.transform = ''
  apply()
  show(index, true)
}

export function closeSelfViewer() {
  const u = ui
  if (!u || !open)
    return
  open = false
  token++
  // 关掉就别再排队重试 / 下载了（否则关了之后还在偷偷下原图）
  cancelUpgradeRetry()
  abortPreloads()
  u.root.classList.remove('is-open')
  u.root.setAttribute('aria-hidden', 'true')
  u.root.removeAttribute('aria-modal')
  u.root.classList.remove('is-dragging', 'is-zoomed')
  // 切图滑动可能还在跑（或跟手留了 inline transform），先清干净再算关闭的 FLIP
  u.stage.style.transform = ''
  u.stage.getAnimations().forEach(a => a.cancel())

  const item = items[index]
  // **关闭时重新量缩略图**：打开期间页面可能滚动 / 动态流重排（实测连续开关时
  // 缩略图上移了 333px），用点击那一刻的 rect 会飞到空位置。
  const live = item?.el && item.el.isConnected ? item.el.getBoundingClientRect() : null
  const rect = live && live.width > 8 && live.height > 8 ? live : item?.rect
  const r = u.img.getBoundingClientRect()
  const canFlip = !!(rect && rect.width > 8 && r.width > 8 && !prefersReducedMotion())
  if (canFlip && rect) {
    const sx = rect.width / r.width
    const sy = rect.height / r.height
    // stage 的变换以**stage 中心**为原点，而图片放大 / 平移后视觉中心早就不在那儿了：
    //   c' = center + T + S·(c - center)
    // 要让图片中心落到缩略图中心，得 T = c_thumb - center - S·(c_img - center)。
    // 原来直接写 `c_thumb - c_img`，只在「图片恰好居中」时成立 —— 放大 / 拖过之后
    // 关闭就飞不到原来的缩略图框（用户报的就是这个）。
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const dx = rect.left + rect.width / 2 - cx - sx * (r.left + r.width / 2 - cx)
    const dy = rect.top + rect.height / 2 - cy - sy * (r.top + r.height / 2 - cy)
    u.stage.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.15 },
    ], { duration: DUR_CLOSE, easing: EASE, fill: 'forwards' })
  }
  else if (!prefersReducedMotion()) {
    // 没有对应的缩略图（左右切过图之后，页面上那张缩略图已经不是当前这张了）：
    // 至少给一个「缩小 + 淡出」，不能直接消失 —— 用户报的「切图后关闭没有动画」。
    u.stage.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'scale(0.92)', opacity: 0 },
    ], { duration: DUR_CLOSE, easing: EASE, fill: 'forwards' })
  }

  // 动画跑完再清，否则下次打开会停在「缩回去」那一帧；
  // 滚动也等动画结束再解锁（提前解锁会让页面横移，FLIP 终点就偏了）
  window.setTimeout(() => {
    if (open)
      return
    u.stage.getAnimations().forEach(a => a.cancel())
    u.img.classList.remove('is-ready')
    // 双保险：除了 `visibility: hidden` 再显式藏掉整层、并清掉遮罩的 `backdrop-filter`。
    // `opacity: 0` **不会**关掉 backdrop-filter，元素只要还在渲染就会继续糊后面的页面 ——
    // 万一 visibility 的延迟 transition 被打断，用户看到的就是「关了图整页还是模糊」。
    u.root.style.display = 'none'
    const bd = u.root.querySelector<HTMLElement>('.blie-iv__backdrop')
    if (bd) {
      bd.style.backdropFilter = 'none'
      bd.style.setProperty('-webkit-backdrop-filter', 'none')
    }
    releaseImage()
    dropStalePhotoSwipe()
    // 关掉之后，页面上任何「photoSwipe 的 keydown」都已经是孤儿（我们这层取代了它）——
    // 提前摘掉，免得用户下一次按 ←→ 先被吃掉一下
    document.dispatchEvent(new Event(KILL_PSWP_EVENT))
    // 焦点还给打开前那个元素（iframe / 输入框 / 播放器容器）——
    // 不还的话，iframe 里的播放器永远收不到 ← →（见 focusBack 的注释）
    const back = focusBack
    focusBack = null
    if (back && back.isConnected) {
      try { back.focus({ preventScroll: true }) }
      catch { /* 已经不可聚焦了就算了 */ }
    }
    // 图都关了，这一组数据（含页面上的 img 引用）没必要留着
    items = []
    appliedLevel = 0
    claimedLevel = 0
    swapSeq++
    unlockScroll()
    setHostsHidden(false)
  }, (prefersReducedMotion() ? 0 : DUR_CLOSE) + 40)
}

export function isSelfViewerOpen() {
  return open
}

/* ===== 事件 ===== */

function onWheel(e: WheelEvent) {
  if (!open)
    return
  e.preventDefault()
  const d = wheelDelta()
  zoomAt(scale + (e.deltaY < 0 ? d : -d), e.clientX, e.clientY)
}

function onPointerDown(e: PointerEvent) {
  if (!open)
    return
  if (e.pointerType === 'mouse' && e.button !== 0)
    return
  const u = ui
  if (!u)
    return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try { u.img.setPointerCapture(e.pointerId) }
  catch { /* 合成事件没有真实 pointerId */ }

  if (pointers.size === 1) {
    dragging = true
    startX = e.clientX
    startY = e.clientY
    baseTx = tx
    baseTy = ty
    swipeDx = 0
    swipeH = null
    u.root.classList.add('is-dragging')
  }
  else if (pointers.size === 2) {
    dragging = false
    const [a, b] = [...pointers.values()]
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y)
    pinchStartScale = scale
    pinchStartTx = tx
    pinchStartTy = ty
    pinchStartMidX = (a.x + b.x) / 2
    pinchStartMidY = (a.y + b.y) / 2
  }
}

function onPointerMove(e: PointerEvent) {
  const u = ui
  if (!u || !open || !pointers.has(e.pointerId))
    return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size >= 2) {
    if (!pinchStartDist)
      return
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    scale = clamp(pinchStartScale * (dist / pinchStartDist), MIN_SCALE, MAX_SCALE)
    tx = pinchStartTx + ((a.x + b.x) / 2 - pinchStartMidX)
    ty = pinchStartTy + ((a.y + b.y) / 2 - pinchStartMidY)
    apply()
    return
  }

  if (!dragging)
    return
  const dx = e.clientX - startX
  const dy = e.clientY - startY

  if (scale > 1.01) {
    // 放大后：平移
    tx = baseTx + dx
    ty = baseTy + dy
    apply()
    return
  }

  // 未放大：横向拖拽 = 跟手「要切图了」的反馈（松手再决定切不切）
  if (swipeH === null) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6)
      return
    // 横向为主才算滑动（斜着拖不要误触发）
    swipeH = Math.abs(dx) > Math.abs(dy) * 1.2
  }
  if (!swipeH)
    return
  swipeDx = dx
  u.stage.style.transform = `translateX(${dx * SWIPE_FOLLOW}px)`
}

function onPointerUp(e: PointerEvent) {
  const u = ui
  pointers.delete(e.pointerId)
  if (!u)
    return
  try { u.img.releasePointerCapture(e.pointerId) }
  catch { /* 没捕获过 */ }
  if (pointers.size < 2)
    pinchStartDist = 0
  if (pointers.size === 0) {
    dragging = false
    u.root.classList.remove('is-dragging')
    if (scale <= 1.01 && swipeH && swipeDx !== 0) {
      const dx = swipeDx
      swipeDx = 0
      swipeH = null
      // 阈值取「120px 或视口的 12%」里更小的那个 —— 用户要求不要太敏感
      const threshold = Math.min(SWIPE_THRESHOLD, window.innerWidth * 0.12)
      if (Math.abs(dx) >= threshold) {
        const dir: 1 | -1 = dx < 0 ? 1 : -1 // 左滑 = 下一张
        if (index + dir >= 0 && index + dir < items.length)
          slideTo(dir, dx * SWIPE_FOLLOW)
        else
          bounceBack(dx * SWIPE_FOLLOW) // 已经在最左 / 最右：回弹
      }
      else {
        bounceBack(dx * SWIPE_FOLLOW)
      }
      return
    }
    swipeDx = 0
    swipeH = null
    clampPan()
  }
}

function onDblClick(e: MouseEvent) {
  if (!open)
    return
  if (scale > 1.01)
    reset()
  else
    zoomAt(DBL_SCALE, e.clientX, e.clientY)
}

function onAction(act: string) {
  if (act === 'in')
    zoomBy(stepDelta())
  else if (act === 'out')
    zoomBy(-stepDelta())
  else if (act === 'rotL' || act === 'rotR') {
    rot = (rot + (act === 'rotL' ? 270 : 90)) % 360
    scale = 1
    tx = 0
    ty = 0
    apply()
    fitRotated()
  }
  else if (act === 'reset') {
    reset()
  }
}

/**
 * B站 评论区的图片查看器是自定义元素 `<bili-photoswipe>`，它挂了一条 document keydown：
 *
 *   addEventListener(document, 'keydown', (t) => {
 *     if (this.isOpen) switch (t.key) {
 *       case 'ArrowLeft':  this.prev(); t.stopPropagation(); t.preventDefault()
 *       case 'ArrowRight': this.next(); t.stopPropagation(); t.preventDefault()
 *     }
 *   })
 *
 * `isOpen` 只在它自己的 `close()` 跑完、或者元素被移除（`disconnectedCallback`）时才复位。
 * 只要有一次没收尾（关到一半抛错、关闭时缩略图已被信息流重渲染掉、被我们接管……），
 * 它就永远停在 `isOpen === true` —— **整页的 ← → 被永久吞掉**，而用户看到的是
 * 「图早就关了，视频却按不动」。这就是用户报的那个 bug。
 *
 * 兜底：把「还连着、但已经不可见（没有 `visible` 属性）」的 `bili-photoswipe` 摘掉。
 * 断开连接会跑它的 `disconnectedCallback`（`isOpen = false` + 监听全部 dispose），
 * 而它的 disposables 只是个普通数组，下次 `open()` 重新挂回 DOM 时会重新注册 —— 不会把组件搞坏。
 */
/** 我们这一层是不是真的在屏幕上（不是「以为开着、其实被藏了」） */
function isLayerVisible() {
  const u = ui
  if (!u || !u.root.classList.contains('is-open'))
    return false
  const cv = (u.root as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (typeof cv === 'function')
    return u.root.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  const cs = getComputedStyle(u.root)
  return cs.display !== 'none' && cs.visibility !== 'hidden'
}

/**
 * 「以为开着、其实看不见」：`open` 还是 true，但整层已经被藏起来了（关闭动画半路被打断
 * 之类的异常路径）。这种状态下 `onKey` 会**一直**把 ←→ 吃掉 —— 用户看到的就是
 * 「图早就关了，视频按不动，按多少下都没反应」。发现就按正常关闭流程收尾、把状态复位。
 */
function healStuckViewer() {
  if (!open || isLayerVisible())
    return false
  closeSelfViewer()
  // closeSelfViewer 在 ui 为空 / open 已复位时会早退，这里再兜一次底
  open = false
  token++
  return true
}

/**
 * 「这个查看器是不是真的在给用户看图」。
 *
 * **不能只看 `visible` 属性，也不能只看元素有没有尺寸** —— 卡死的那个往往两者都还在
 * （`visible` 没被摘、宿主是 `position:fixed;inset:0`，照样铺满全屏），
 * 唯一可靠的区别是：真开着的时候里面有一张**铺开的图**，卡死的那个图早就没了。
 */
function isLiveViewer(el: Element) {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2)
    return false
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)
    return false
  const img = el.shadowRoot?.querySelector('img')
  if (!img)
    return false
  const ir = img.getBoundingClientRect()
  return ir.width > 40 && ir.height > 40
}

function dropStalePhotoSwipe() {
  const nodes = document.querySelectorAll('bili-photoswipe')
  if (!nodes.length)
    return
  let n = 0
  nodes.forEach((el) => {
    if (isLiveViewer(el))
      return
    el.remove()
    n++
  })

}

/** 补刀命令（`guard.js` §13）：把「DOM 已经没了、实例还活着」的 PhotoSwipe 收掉 */
const KILL_PSWP_EVENT = 'blie-elite:kill-pswp'
let killSentAt = 0

let staleTimer = 0

function scheduleStaleCheck(delay: number) {
  if (staleTimer)
    return
  staleTimer = window.setTimeout(() => {
    staleTimer = 0
    dropStalePhotoSwipe()
  }, delay)
}

/**
 * 只要 ←/→ 被**别人**吃掉了（派发完还是 `defaultPrevented`），就说明页面上有残留的
 * 查看器。等一小会儿（别把正在正常回缩的动画剪掉）再清一次。
 *
 * **必须 `setTimeout(0)` 再看**：我们这个监听挂在 document 冒泡，但注册得比页面早
 * （`document_start`），当场看 `defaultPrevented` 永远是 false —— 页面那个吞事件的
 * 监听还没跑呢。
 */
const STALE_KEYS = new Set(['Escape', 'ArrowLeft', 'ArrowRight'])

/**
 * 最近一次**真实**按键的命运。
 *
 * 合成事件（`new KeyboardEvent(...)`）是 `isTrusted: false`，如果吞键的那个处理器判了
 * `isTrusted`（或者只在真实交互里生效），合成探针永远是「没被吞」—— 那就会得出
 * 「没人吃键」的错误结论。所以这里记真实事件：
 *   · `prevented`：有人 `preventDefault` 了
 *   · `docBubble`：事件有没有走到 document 冒泡（false = 有人 `stopPropagation` 截在半路）
 *   · 两者都 false = 事件干净走完、页面自己没反应（问题在播放器，不在按键）
 */
function onKeySettled(e: KeyboardEvent) {
  // 按住不放会一直重复 keydown，第一次处理过就够了
  if (e.repeat || !STALE_KEYS.has(e.key))
    return
  const ev = e
  window.setTimeout(() => {
    // 我们这层真的开着时，按键本来就该归我们（不会走到这儿，capture 已经 stopImmediate）
    if (!ev.defaultPrevented || (open && isLayerVisible()))
      return
    // 被吞 = 页面上有东西在吃 ←/→：先把「没在图」的查看器摘掉
    dropStalePhotoSwipe()
    // 真实按键被吞还有一种情况：PhotoSwipe 实例还活着、DOM 已经被摘掉了
    // （它的 destroy() 只调 close() 就 return，监听没摘）。让页面世界补一刀。
    if (performance.now() - killSentAt > 1500) {
      killSentAt = performance.now()
      document.dispatchEvent(new Event(KILL_PSWP_EVENT))
    }
    scheduleStaleCheck(700)
  }, 0)
}

/**
 * 点击之后也查一次：用户「点背景关掉评论图」正是产生残留的那一下。
 * 没有 `bili-photoswipe` 时直接返回（绝大多数页面、绝大多数点击都是一次空查询）。
 */
function onAnyPointerUp() {
  if (staleTimer || !document.querySelector('bili-photoswipe'))
    return
  scheduleStaleCheck(800)
}

/**
 * 这一层只认这 7 个键（Esc / ← / → / + / = / − / 0），**且只在真的开着的时候**。
 * 其它键一个都不碰 —— 播放器的空格 / ↑↓ / M 之类永远是页面自己的。
 */
function onKey(e: KeyboardEvent) {
  // **只有这一层真的开着才接管**。`open` 是模块变量，万一它和 DOM 状态错开（异常路径 /
  // 半路被打断），这里也不能把播放器的 ←→ 吃掉 —— 「按了没反应」最难查的就是这种：
  // 监听还在、事件被 preventDefault 了，但界面上什么都看不到。
  if (!open || !ui)
    return
  // 层被藏起来了却还挂着 is-open（异常路径）：先复位，别吃键
  if (!ui.root.classList.contains('is-open') || !isLayerVisible()) {
    healStuckViewer()
    return
  }
  // 页面会自己 `dispatchEvent(new Event('keydown'))`，那种事件没有 `key`
  if (typeof e.key !== 'string')
    return

  const consume = () => {
    e.preventDefault()
    // 看图器是模态的：这一下别再让页面（播放器）同时处理一遍。
    // 只 preventDefault 的话，按 ← 切上一张的同时**视频也会往后退 5 秒**。
    e.stopImmediatePropagation()
  }

  if (e.key === 'Escape') {
    consume()
    closeSelfViewer()
  }
  else if (e.key === 'ArrowLeft') {
    consume()
    void slideTo(-1)
  }
  else if (e.key === 'ArrowRight') {
    consume()
    void slideTo(1)
  }
  else if (e.key === '+' || e.key === '=') {
    consume()
    zoomBy(stepDelta())
  }
  else if (e.key === '-') {
    consume()
    zoomBy(-stepDelta())
  }
  else if (e.key === '0') {
    consume()
    reset()
  }
}

function bind(u: ViewerUi) {
  // 遮罩负责关闭；舞台是 `pointer-events: none`，点图片外的空白会穿透到这里
  u.backdrop.addEventListener('click', () => closeSelfViewer())
  u.close.addEventListener('click', () => closeSelfViewer())
  u.prev.addEventListener('click', () => { void slideTo(-1) })
  u.next.addEventListener('click', () => { void slideTo(1) })
  u.bar.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.(`.${BTN_CLASS}`)
    if (btn)
      onAction(btn.getAttribute('data-act') || '')
  })

  u.root.addEventListener('wheel', onWheel, { passive: false })
  u.img.addEventListener('pointerdown', onPointerDown)
  u.img.addEventListener('pointermove', onPointerMove)
  u.img.addEventListener('pointerup', onPointerUp)
  u.img.addEventListener('pointercancel', onPointerUp)
  u.img.addEventListener('dblclick', onDblClick)
  // 图片自己的 click 不做事（用户要求：放大后拖拽最怕误触关闭）
  u.img.addEventListener('click', e => e.stopPropagation())
}

export function setupSelfViewer(): () => void {
  injectStyle()
  document.addEventListener('keydown', onKey, true)
  /**
   * 记下「点这一下之前焦点在谁身上」。
   *
   * **必须在 pointerdown 捕获阶段记**：浏览器在 mousedown 时就把焦点挪到点击目标
   * （或 body）了，等 `click` 再读 `document.activeElement` 已经晚了 —— 读到的是 body。
   * 点在自己这层上的（关图 / 切图 / 工具栏）不算「打开前的焦点」。
   */
  const rememberFocus = (e: PointerEvent) => {
    if (open)
      return
    const t = e.target as Element | null
    if (t?.closest?.('.blie-iv'))
      return
    const ae = document.activeElement
    focusBack = ae instanceof HTMLElement && ae !== document.body ? ae : null
  }
  document.addEventListener('pointerdown', rememberFocus, true)
  // **冒泡阶段**：页面上的查看器（bili-photoswipe）挂在 document 冒泡，
  // 我们挂同一个节点、注册得更晚，所以能在它吞完之后看到 defaultPrevented。
  document.addEventListener('keydown', onKeySettled)
  document.addEventListener('pointerup', onAnyPointerUp, true)
  // 窗口尺寸变了要重算 contain（rect 是按打开那一刻的视口算的），否则图片会偏到一边
  const onResize = () => {
    if (open)
      placeImg(false)
  }
  window.addEventListener('resize', onResize)

  /**
   * 网络刚恢复 / 标签页刚回到前台：这时「卡在低清」的原因多半已经消失，立刻再试一次，
   * 不用等重试队列里那个 30s 的尾巴。后台标签页会被浏览器限速，`visibilitychange`
   * 这一下尤其有用（用户切回来一眼看到的应该就是原图）。
   */
  const retryNow = () => {
    if (!open || appliedLevel >= 2)
      return
    const item = items[index]
    if (item?.src && item.src !== item.thumb)
      scheduleUpgradeRetry(token, item)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible')
      retryNow()
  }
  window.addEventListener('online', retryNow)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', rememberFocus, true)
    document.removeEventListener('keydown', onKeySettled)
    document.removeEventListener('pointerup', onAnyPointerUp, true)
    if (staleTimer) {
      window.clearTimeout(staleTimer)
      staleTimer = 0
    }
    window.removeEventListener('resize', onResize)
    window.removeEventListener('online', retryNow)
    document.removeEventListener('visibilitychange', onVisible)
    cancelUpgradeRetry()
    offRipple?.()
    offRipple = null
    ui?.root.remove()
    ui = null
    open = false
    items = []
    appliedLevel = 0
    claimedLevel = 0
    swapSeq++
    pointers.clear()
    unlockScroll()
    setHostsHidden(false)
    document.getElementById(STYLE_ID)?.remove()
  }
}

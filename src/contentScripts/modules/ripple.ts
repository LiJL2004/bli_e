/**
 * Material 涟漪（Ripple）。
 *
 * 为什么纯 CSS 做不出来：
 * 1) `::after` + `:active` 的伪元素只能从**元素中心**扩散 —— 点哪儿都一样，
 *    宽胶囊上尤其假（点击点在左端，波纹却从正中炸开）；
 * 2) 更致命的是动画挂在 `:active` 上：鼠标一松，选择器失配，伪元素立刻回到
 *    `scale(0)`，正在扩散的涟漪当场腰斩。纯 CSS 无解。
 *
 * 所以改成 JS：pointerdown 时按点击坐标造一个临时节点，动画挂在**节点自己**身上，
 * 松手照常播完。
 *
 * 参数按用户给的参考页（Google 风格 demo）重制，比 M3 规范那套更醒目：
 * - 直径 = `max(宽, 高) × 2.2`（不是「到最远角 ×2」，整体更大一圈）；
 * - 单段 0.55s `cubic-bezier(.2,0,0,1)`：`scale(0)→1` 同时 `opacity .3→0`；
 * - 颜色 = `currentColor` 的实色圆（不是径向渐变）—— 白底按钮上按下就是一片
 *   明显的蓝色波纹，视觉上像「白按钮变成蓝按钮」，这正是用户要的那个过渡。
 *
 * 节点几何 / 动画在 ripple.css（全仓库唯一一份），由 installRipple() 注入到调用方给的根。
 */

import rippleCss from './ripple.css?inline'

/**
 * 设置面板里参与涟漪的控件。
 * 新增可点控件忘了加进来不会报错，只是那一颗没有涟漪 —— 加控件时顺手对一下。
 */
export const RIPPLE_TARGETS = [
  '.btn', // 右下角 ⚙
  '.close', // 面板 / 弹窗的关闭键
  '.nav-item', // 左侧分类
  '.text-btn', // 胶囊文字按钮（含「开始测速」「查看」「开始」「管理」）
  '.confirm-btn', // 确认弹窗按钮
  '.key-cap', // 快捷键胶囊
  '.we-chip-icon', // 轮盘上的圆形图标（36px 的圆自己裁切）
  '.we-tile', // 轮盘的功能格
  '.range-val', // 数值胶囊
  '.cdn-row', // 节点列表的一行（含「自动（用测速最快）」与手动指定）
].join(',')

/** 同一颗控件上最多同时存在的涟漪数：连点时把最早的顶掉，免得堆一层半透明圆 */
const MAX_PER_HOST = 3

/**
 * 每个根上的涟漪样式表 + 引用计数。
 * 设置面板的 shadow root 一份；document 上顶栏 / 看图器 / 搜索页共用一份（同一个 document
 * 装几次都只注入一次，最后一个卸载时才摘掉）。
 */
const styleRef = new WeakMap<EventTarget, { style: HTMLStyleElement, count: number }>()

/** 把 ripple.css 注入 `root`（shadow root 或 document），返回释放函数 */
function injectRippleCss(root: EventTarget): () => void {
  const existing = styleRef.get(root)
  if (existing) {
    existing.count++
    return () => releaseStyle(root)
  }
  const style = document.createElement('style')
  style.textContent = rippleCss
  if (root === document)
    (document.head || document.documentElement).appendChild(style)
  else
    // 这里只会是设置面板的 ShadowRoot（installRipple 的另一个调用方都传 document）
    (root as ShadowRoot).appendChild(style)
  styleRef.set(root, { style, count: 1 })
  return () => releaseStyle(root)
}

function releaseStyle(root: EventTarget): void {
  const rec = styleRef.get(root)
  if (!rec)
    return
  if (--rec.count <= 0) {
    rec.style.remove()
    styleRef.delete(root)
  }
}

/**
 * 在 `root` 上装涟漪。返回清理函数。
 *
 * @param root 事件委托的根：设置面板传 shadow root，顶栏传 `document`
 * @param selector 命中哪些元素；默认是设置面板那套 `RIPPLE_TARGETS`
 */
export function installRipple(root: EventTarget, selector: string = RIPPLE_TARGETS): () => void {
  // 系统开了「减弱动态效果」就整个不装：宁可没有涟漪，也不违背可访问性设置
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return () => {}

  // 样式跟着监听走：装到哪个根，ripple.css 就注入到哪个根（shadow 里的页面 CSS 进不来，反之亦然）
  const releaseCss = injectRippleCss(root)

  /** 从事件目标往上找最近的涟漪控件；点的是纯文字 / 空白就返回 null */
  const pick = (target: EventTarget | null): HTMLElement | null => {
    const el = target as Element | null
    // 同源 iframe / 另一个 realm 的元素不能用 instanceof Element 判，
    // 鸭子类型最稳（仓库里同源 iframe 踩过这个坑）
    if (!el || typeof el.closest !== 'function')
      return null
    return el.closest(selector) as HTMLElement | null
  }

  /** 在 host 的 (clientX, clientY) 处放一颗涟漪 */
  const spawn = (host: HTMLElement, clientX: number, clientY: number) => {
    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0)
      return

    // 面板整体有 transform: scale(var(--bili-panel-scale))：getBoundingClientRect 拿到的是
    // **缩放后**的框，offsetWidth / offsetHeight 才是布局尺寸。两者相除得到「屏幕像素 →
    // 元素像素」的换算比；不除的话 130% 缩放下涟漪会整体偏向左上，越靠右下偏得越多。
    const kx = host.offsetWidth / rect.width
    const ky = host.offsetHeight / rect.height
    const x = (clientX - rect.left) * kx
    const y = (clientY - rect.top) * ky
    // 参考页的算法：最大边 × 2.2，任何位置按下都能盖满控件（比「到最远角 ×2」更饱满）
    const size = Math.max(host.offsetWidth, host.offsetHeight) * 2.2

    const alive = host.querySelectorAll(':scope > .blie-ripple')
    if (alive.length >= MAX_PER_HOST)
      alive[0].remove()

    const dot = document.createElement('span')
    dot.className = 'blie-ripple'
    // 位置 / 尺寸都走 CSS 变量，让 CSS 只负责「怎么画」，JS 只负责「画在哪儿」
    dot.style.setProperty('--rp-x', `${x}px`)
    dot.style.setProperty('--rp-y', `${y}px`)
    dot.style.setProperty('--rp-size', `${size}px`)
    // animationcancel 也要摘：控件被 display:none / 面板关掉时动画会被取消，不会触发 end
    dot.addEventListener('animationend', () => dot.remove(), { once: true })
    dot.addEventListener('animationcancel', () => dot.remove(), { once: true })
    host.appendChild(dot)
  }

  const onDown = (e: Event) => {
    const pe = e as PointerEvent
    // 只认主键：右键 / 中键不画涟漪（右键菜单那一下不该有按下反馈）
    if (pe.button !== 0)
      return
    const host = pick(pe.target)
    if (host)
      spawn(host, pe.clientX, pe.clientY)
  }

  /**
   * 键盘（Enter / 空格）触发时没有 pointerdown，补一颗从中心扩散的。
   * 用 `detail === 0` 区分：真实指针点击的 detail 恒为 1，上面已经画过了；
   * 脚本里 `el.click()` 的 detail 也是 0，顺手也能有反馈。
   */
  const onClick = (e: Event) => {
    const me = e as MouseEvent
    if (me.detail !== 0)
      return
    const host = pick(me.target)
    if (!host)
      return
    const rect = host.getBoundingClientRect()
    spawn(host, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  // 捕获阶段：面板自己的 click 处理里有 stopPropagation，冒泡阶段可能收不到
  root.addEventListener('pointerdown', onDown, true)
  root.addEventListener('click', onClick, true)

  return () => {
    root.removeEventListener('pointerdown', onDown, true)
    root.removeEventListener('click', onClick, true)
    releaseCss()
  }
}

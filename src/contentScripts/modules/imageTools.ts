/**
 * 图片查看器（B 站用的是 PhotoSwipe 5）底部工具栏：
 * 缩小 / 放大 / 向左旋转 / 向右旋转 / 复位（参考百度贴吧的看图器，不做下载）。
 *
 * **缩放为什么要绕到 guard.js**：PhotoSwipe 实例挂在页面的 `window.pswp` 上，
 * 但内容脚本跑在**隔离世界** —— 同一份 DOM、两套 JS 包装对象，页面的 `window.*`
 * 在这里读不到（`window.pswp` 恒为 undefined）。所以缩放命令走项目里那条老通道
 * 「属性当数据 + 事件当敲门砖」：给 `.pswp` 挂 `data-blie-pswp-cmd` 再 dispatch 一个
 * 普通 Event，`guard.js`（MAIN world，全站 document_start）收到后调 `pswp.zoomTo()`。
 * 走官方 zoomTo 是因为它会自己算尺寸、平移和边界；注意它是**改 img 的 width/height**
 * 实现缩放的（zoom=1 → 原图 2048px、zoom=2 → 4096px），不是 transform: scale。
 * `currZoomLevel` 初始是 `null`（B 站配的 fit 模式），guard.js 那边以 `zoomLevels.min`
 * （实测 0.777）当当前值，否则 `null * 1.4` 会算出 0。
 *
 * **旋转不需要实例**（纯 CSS 属性），在本文件里直接做：用独立变换属性 `rotate`
 * 写在 `<img>` 上 —— 它和 `transform` 是两个属性，按规范叠加而不是互相覆盖，
 * 所以 pswp 缩放、拖动之后旋转不会丢。写哪个元素有讲究，见 applyRotate 的注释。
 */

import { EventBag } from '../eventBag'
import { installRipple } from './ripple'
import css from './imageTools.css?inline'

const STYLE_ID = 'bili-elite-imgtools-style'
const BAR_CLASS = 'blie-img-tools'
const BTN_CLASS = 'blie-img-tool'
/** 缩放命令的事件名（guard.js §9 那一侧监听同名事件） */
const CMD_EVENT = 'blie-elite:pswp-cmd'
const CMD_ATTR = 'data-blie-pswp-cmd'
const DEG = 90

const ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z"/></svg>'
const ICON_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 7h-1v2H9v1h2v2h1v-2h2V9h-2z"/></svg>'
const ICON_ROT_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z"/></svg>'
const ICON_ROT_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11a7.9 7.9 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"/></svg>'
const ICON_RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 12c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zm-2-9c-4.97 0-9 4.03-9 9H0l4 4 4-4H5c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z"/></svg>'

const BUTTONS: Array<{ act: string; label: string; icon: string }> = [
  { act: 'out', label: '缩小', icon: ICON_OUT },
  { act: 'in', label: '放大', icon: ICON_IN },
  { act: 'rotL', label: '向左旋转', icon: ICON_ROT_L },
  { act: 'rotR', label: '向右旋转', icon: ICON_ROT_R },
  { act: 'reset', label: '复位', icon: ICON_RESET },
]

/** 工具栏会拦这些事件，否则点按钮会被 pswp 当成「拖动 / 点击缩放 / 关闭」 */
const BLOCKED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel']

function injectStyle() {
  if (document.getElementById(STYLE_ID))
    return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.appendChild(style)
}

export function setupImageTools(): () => void {
  injectStyle()
  const bag = new EventBag()
  const offRipple = installRipple(document, `.${BTN_CLASS}`)

  /** 旋转角度（0 / 90 / 180 / 270），每次打开看图器都从 0 开始 */
  let deg = 0
  let bar: HTMLElement | null = null
  let slideObserver: MutationObserver | null = null

  /** 当前这一张的 `<img>`：只认 DOM，不碰 pswp 实例（隔离世界拿不到） */
  function currentImg(): HTMLElement | null {
    const pswp = document.querySelector<HTMLElement>('.pswp')
    if (!pswp)
      return null
    return pswp.querySelector<HTMLElement>('.pswp__item[aria-hidden="false"] .pswp__img')
      || pswp.querySelector<HTMLElement>('.pswp__img')
  }

  /**
   * 旋转写在 `<img>` 上，**不能写在 `.pswp__zoom-wrap` 上**：后者被 pswp 设了
   * `transform-origin: 0 0`（它要按左上角原点做平移），rotate 绕左上角一转，
   * 图片整张甩出视口（实测只剩左下角一块）。`<img>` 的 transform-origin 是默认的
   * 50% 50%（实测 795.5px 447.5px），绕自己中心转才是想要的效果；
   * 而且 pswp 靠改 img 的 width/height 缩放、不写它的 transform，两者互不干扰。
   */
  function applyRotate() {
    const img = currentImg()
    if (img)
      img.style.rotate = deg ? `${deg}deg` : ''
  }

  /** 缩放交给 guard.js：属性带命令，事件当敲门砖（普通 Event，detail 跨世界会被抹掉） */
  function sendZoom(cmd: 'in' | 'out' | 'reset') {
    const pswp = document.querySelector<HTMLElement>('.pswp')
    if (!pswp)
      return
    pswp.setAttribute(CMD_ATTR, cmd)
    pswp.dispatchEvent(new Event(CMD_EVENT))
  }

  function onAction(act: string) {
    if (act === 'in') {
      sendZoom('in')
    }
    else if (act === 'out') {
      sendZoom('out')
    }
    else if (act === 'rotL') {
      deg = (deg + 360 - DEG) % 360
      applyRotate()
    }
    else if (act === 'rotR') {
      deg = (deg + DEG) % 360
      applyRotate()
    }
    else if (act === 'reset') {
      deg = 0
      applyRotate()
      sendZoom('reset')
    }
  }

  /**
   * pswp 切到下一张时会改 `.pswp__item` 的 `aria-hidden` —— 新的 `<img>` 上没有 rotate，
   * 靠这个观察器补上（旋转状态是整次看图会话共享的，和贴吧一致）。
   */
  function watchSlide(pswpEl: HTMLElement) {
    slideObserver?.disconnect()
    slideObserver = new MutationObserver(() => applyRotate())
    slideObserver.observe(pswpEl, { attributes: true, attributeFilter: ['aria-hidden'], subtree: true })
  }

  function attach(pswpEl: HTMLElement) {
    if (pswpEl.querySelector(`.${BAR_CLASS}`))
      return

    deg = 0
    const el = document.createElement('div')
    el.className = BAR_CLASS
    el.setAttribute('role', 'toolbar')
    el.setAttribute('aria-label', '图片工具')
    el.innerHTML = BUTTONS
      .map(b => `<button class="${BTN_CLASS}" type="button" data-act="${b.act}" title="${b.label}" aria-label="${b.label}">${b.icon}</button>`)
      .join('')

    // pswp 的拖动 / 点击缩放 / 关闭监听都挂在 `.pswp` 上（冒泡阶段），
    // 在工具栏这一层 stopPropagation 就能断掉，按钮点击不会被当成看图器操作。
    for (const type of BLOCKED_EVENTS)
      el.addEventListener(type, e => e.stopPropagation())

    el.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest?.(`.${BTN_CLASS}`)
      if (!btn)
        return
      onAction(btn.getAttribute('data-act') || '')
    })

    pswpEl.appendChild(el)
    bar = el
    watchSlide(pswpEl)
  }

  function detach() {
    slideObserver?.disconnect()
    slideObserver = null
    bar?.remove()
    bar = null
  }

  // pswp 是 body 的直接子元素（实测），只盯 body 的 childList 就够，
  // 不用 subtree —— 那个开销按整页 DOM 算。
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node instanceof HTMLElement && node.classList?.contains('pswp'))
          attach(node)
      }
      for (const node of Array.from(m.removedNodes)) {
        if (node instanceof HTMLElement && node.classList?.contains('pswp'))
          detach()
      }
    }
  })
  observer.observe(document.body, { childList: true })

  // 扩展重载时可能正好有一张图开着
  const opened = document.querySelector<HTMLElement>('.pswp')
  if (opened)
    attach(opened)

  bag.on(window, 'beforeunload', detach)

  return () => {
    observer.disconnect()
    detach()
    offRipple()
    bag.dispose()
    document.getElementById(STYLE_ID)?.remove()
  }
}

import { hasWebFullscreenClass } from '~/shared/bilibiliDom'
import { get } from '../config'
import { prefersReducedMotion } from './designTokens'
import { EventBag } from '../eventBag'
import { onBodyClassChange } from './bodyClass'
import { getPlayerScreen, onPlayerScreenChange } from './playerMode'

/**
 * 全屏切换动画（「动效增强」里的网页全屏动画 / 宽屏模式动画）
 *
 * 用 FLIP（先量旧位置，再让元素从旧位置补间到新位置）给播放器容器加一段动画：
 * - 网页全屏：进入 / 退出各一段（开关 webscreenAnim）
 * - 宽屏：进入 / 退出各一段（开关 wideAnim）
 *
 * 两个站点各有一套播放器，这里都覆盖：
 * - 主站（www.bilibili.com/video…）：容器 .bpx-player-container，网页全屏时
 *   B 站给 <body> 加 .webscreen-fix；
 * - 直播站（live.bilibili.com）：容器 #fullscreen-container —— B 站自己把它的
 *   position 从 absolute 改成 fixed 来铺满，网页全屏时给 <body> 加 .player-full-win。
 *   注意直播站「全屏」加的是 body.fullscreen-fix，那是原生全屏那条路，别当成网页全屏
 *   （两站的类名不一样，别合并）。
 *
 * 1.1.6 v015：原来还有一条「全屏（F）退出时一段」（开关 fullscreenAnim），整项删掉了 ——
 * 浏览器自己退出原生全屏本来就有一段过渡，再叠一层 FLIP 只在「按 F 退出」这一种动作上生效，
 * 命中面太窄，反而让「开关到底是管哪个全屏」变成理解成本。
 */

/** 播放器容器：主站播放页与直播站各一套，取第一个命中的 */
const CONTAINER_SELECTORS = [
  '.bpx-player-container',
  '#fullscreen-container',
]
const SNAP_DEBOUNCE = 250
const VIDEO_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
/**
 * 进出全屏的动画时长。v001 从 280 / 240 收到 200 / 180。
 *
 * 「点击 → 动画开始」之间还有 B 站自己 100~200ms 的重排（实测，见 videoBeta 的
 * scheduleAfterSwitch），280ms 的动画叠上去之后整段切换接近半秒 —— 用户报的
 * 「切换速度慢」主要就是这一段。200ms 已经能看清「从哪儿来、到哪儿去」，
 * 再短就开始显得生硬了。
 */
const VIDEO_DUR_OPEN = 200
const VIDEO_DUR_CLOSE = 180

export function setupVideoFullscreen(): () => void {
  const bag = new EventBag()

  let container: HTMLElement | null = null
  let lastNonFsRect: DOMRect | null = null
  let lastNonFsScroll = 0
  let webFsRect: DOMRect | null = null
  /** 进宽屏那一刻量到的 rect：退出宽屏时「从哪儿开始缩」靠它 */
  let wideRect: DOMRect | null = null
  let isWebFs = false
  let currentAnim: Animation | null = null
  let snapDebounce: number | null = null

  function getContainer(): HTMLElement | null {
    if (container && document.contains(container)) return container
    container = null
    for (const selector of CONTAINER_SELECTORS) {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) { container = el; break }
    }
    return container
  }

  /** 是否处于 B 站的「网页全屏」（主站 / 直播站的 body 类名不同，见 shared/bilibiliDom） */
  function inWebFullscreen(): boolean {
    return hasWebFullscreenClass()
  }

  function snapshotVideo() {
    if (inWebFullscreen()) return
    if (document.fullscreenElement) return
    const el = getContainer()
    if (!el) return
    const rect = el.getBoundingClientRect()
    lastNonFsRect = rect
    // 宽屏期间也照记一份：退出宽屏时它就是「从哪儿开始缩」的起点。
    // 中途滚了页面 / 缩放了窗口 rect 会变，别拿进宽屏那一刻的旧值去收尾。
    if (getPlayerScreen() === 'wide') wideRect = rect
    lastNonFsScroll = window.scrollY || window.pageYOffset || 0
  }

  function scheduleSnapshot() {
    if (snapDebounce) return
    snapDebounce = window.setTimeout(() => {
      snapDebounce = null
      snapshotVideo()
    }, SNAP_DEBOUNCE)
  }

  function flipVideo(el: HTMLElement, fromRect: DOMRect, targetRect: DOMRect, duration: number) {
    if (!fromRect || !targetRect || !targetRect.width || !targetRect.height) return
    // 系统开了「减少动态效果」：全屏开合是整块播放器的位移 + 缩放，直接跳过动画，
    // 进 / 出全屏变成瞬切
    if (prefersReducedMotion()) return
    if (currentAnim) { currentAnim.cancel(); currentAnim = null }

    el.style.transformOrigin = 'top left'
    const anim = el.animate(
      [
        { transform: `translate(${fromRect.left - targetRect.left}px, ${fromRect.top - targetRect.top}px) scale(${fromRect.width / targetRect.width}, ${fromRect.height / targetRect.height})` },
        { transform: 'translate(0, 0) scale(1, 1)' },
      ],
      { duration, easing: VIDEO_EASE, fill: 'none' },
    )
    currentAnim = anim
    const done = () => {
      if (currentAnim === anim) {
        el.style.transformOrigin = ''
        currentAnim = null
      }
    }
    anim.onfinish = done
    anim.oncancel = done
  }

  bag.on(document, 'pointerdown', (e) => {
    // 宽屏动画也要用这份快照：点「宽屏」按钮的那一刻，先把普通模式的 rect 量下来
    if (!get('webscreenAnim') && !get('wideAnim')) return
    if (inWebFullscreen()) return
    if (document.fullscreenElement) return
    const ev = e as PointerEvent
    const el = getContainer()
    if (!el) return
    const r = el.getBoundingClientRect()
    if (ev.clientX >= r.left - 60 && ev.clientX <= r.right + 60
      && ev.clientY >= r.top - 60 && ev.clientY <= r.bottom + 60) {
      lastNonFsRect = r
      lastNonFsScroll = window.scrollY || window.pageYOffset || 0
    }
  }, true)

  bag.on(document, 'keydown', (e) => {
    if (!get('webscreenAnim')) return
    // 页面自己（和别的扩展）会 dispatch 合成的 keydown，那种事件是普通 Event、没有 key。
    // 直接 key.toLowerCase() 会抛 TypeError（首页控制台那串报错就是它），
    // 而且一抛就把这次事件上后续的所有 keydown 处理一起带断，所以先判类型再取值。
    const k = (e as KeyboardEvent).key
    if (typeof k !== 'string') return
    if (k.toLowerCase() === 'w') snapshotVideo()
  }, true)

  // body 的 class 由 bodyClass.ts 统一观察（全页只有一个 MutationObserver）
  bag.add(onBodyClassChange(() => {
    const nowWebFs = inWebFullscreen()
    if (nowWebFs === isWebFs) return
    const el = getContainer()
    if (!el) { isWebFs = nowWebFs; return }

    if (nowWebFs) {
      if (!get('webscreenAnim')) { isWebFs = nowWebFs; return }
      const targetRect = el.getBoundingClientRect()
      const fromRect = lastNonFsRect || targetRect
      flipVideo(el, fromRect, targetRect, VIDEO_DUR_OPEN)
      webFsRect = targetRect
    } else {
      if (!get('webscreenAnim')) { isWebFs = nowWebFs; return }
      const savedScroll = lastNonFsScroll
      if (Math.abs((window.scrollY || 0) - savedScroll) > 1) {
        // 下面那句 getBoundingClientRect 就会把这次滚动一并刷进布局，
        // 不必再额外读一次 offsetHeight（那是一次多余的同步排版，全算在切换那一帧上）。
        window.scrollTo(0, savedScroll)
      }
      const targetRect = el.getBoundingClientRect()
      const fromRect = webFsRect || ({
        top: 0, left: 0, width: window.innerWidth, height: window.innerHeight,
      } as DOMRect)
      flipVideo(el, fromRect, targetRect, VIDEO_DUR_CLOSE)
      webFsRect = null
      requestAnimationFrame(snapshotVideo)
    }
    isWebFs = nowWebFs
  }))

  /**
   * 宽屏（播放器右下角那个「宽屏」按钮）：进出各一段 FLIP。
   *
   * 触发点只能靠 data-screen 的变化 —— B 站切宽屏没有可以拦的事件，容器尺寸是在属性改完
   * 之后的那一次布局里直接变掉的（2026-10-26 实测：MutationObserver 回调里量到的已经是
   * 终态 1218×728），所以「从哪儿开始」只能用切之前快照下来的 rect。
   *
   * 只处理 normal ↔ wide：进出网页全屏有自己那一段，两边都插手会互相 cancel，
   * 最后只剩半段动画。
   */
  const offScreen = onPlayerScreenChange((next, prev) => {
    if (!get('wideAnim')) return
    if (next !== 'normal' && next !== 'wide') return
    if (prev !== 'normal' && prev !== 'wide') return
    const el = getContainer()
    if (!el) return
    const targetRect = el.getBoundingClientRect()
    if (next === 'wide') {
      flipVideo(el, lastNonFsRect || targetRect, targetRect, VIDEO_DUR_OPEN)
      wideRect = targetRect
      return
    }
    flipVideo(el, wideRect || targetRect, targetRect, VIDEO_DUR_CLOSE)
    wideRect = null
    // 收回普通布局之后重新快照：下一次进宽屏的起点就是它
    requestAnimationFrame(snapshotVideo)
  })
  bag.add(offScreen)

  isWebFs = inWebFullscreen()
  snapshotVideo()
  bag.on(window, 'scroll', scheduleSnapshot, { passive: true })
  bag.on(window, 'resize', scheduleSnapshot, { passive: true })

  return () => {
    if (currentAnim) currentAnim.cancel()
    if (snapDebounce) clearTimeout(snapDebounce)
    bag.dispose()
  }
}
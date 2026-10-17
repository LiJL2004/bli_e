import { get } from '../config'
import { EventBag } from '../eventBag'

/**
 * 全屏切换动画（「动效增强」里的网页全屏动画 / 全屏关闭动画）
 *
 * 用 FLIP（先量旧位置，再让元素从旧位置补间到新位置）给播放器容器加一段动画：
 * - 网页全屏：进入 / 退出各一段（开关 webscreenAnim）
 * - 全屏（F）：退出时一段（开关 fullscreenAnim）
 *
 * 两个站点各有一套播放器，这里都覆盖：
 * - 主站（www.bilibili.com/video…）：容器 .bpx-player-container，网页全屏时
 *   B 站给 <body> 加 .webscreen-fix；
 * - 直播站（live.bilibili.com）：容器 #fullscreen-container —— B 站自己把它的
 *   position 从 absolute 改成 fixed 来铺满，全屏（F）时它同时也是
 *   document.fullscreenElement；网页全屏时给 <body> 加 .player-full-win。
 *   注意直播站「全屏」加的是 body.fullscreen-fix，那是原生全屏那条路，靠
 *   fullscreenchange 判定，别当成网页全屏（两站的类名不一样，别合并）。
 */

/** 两个 rect 是否基本重合（1px 容差） */
function sameRect(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.left - b.left) <= 1 && Math.abs(a.top - b.top) <= 1
    && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1
}

/** 播放器容器：主站播放页与直播站各一套，取第一个命中的 */
const CONTAINER_SELECTORS = [
  '.bpx-player-container',
  '#fullscreen-container',
]
/** 网页全屏时 B 站加在 <body> 上的类：主站 webscreen-fix / 直播站 player-full-win */
const WEB_FS_CLASSES = ['webscreen-fix', 'player-full-win']
const SNAP_DEBOUNCE = 250
const VIDEO_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
const VIDEO_DUR_OPEN = 280
const VIDEO_DUR_CLOSE = 240

export function setupVideoFullscreen(): () => void {
  const bag = new EventBag()

  let container: HTMLElement | null = null
  let lastNonFsRect: DOMRect | null = null
  let lastNonFsScroll = 0
  let webFsRect: DOMRect | null = null
  let isWebFs = false
  let wasFullscreen = false
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

  /** 是否处于 B 站的「网页全屏」（主站 / 直播站的 body 类名不同，见文件头） */
  function inWebFullscreen(): boolean {
    return WEB_FS_CLASSES.some(cls => document.body.classList.contains(cls))
  }

  function snapshotVideo() {
    if (inWebFullscreen()) return
    if (document.fullscreenElement) return
    const el = getContainer()
    if (!el) return
    lastNonFsRect = el.getBoundingClientRect()
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
    if (!get('webscreenAnim')) return
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
    if (!get('webscreenAnim') && !get('fullscreenAnim')) return
    const k = (e as KeyboardEvent).key.toLowerCase()
    if (k === 'w' || k === 'f') snapshotVideo()
  }, true)

  const bodyObserver = new MutationObserver(() => {
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
        window.scrollTo(0, savedScroll)
        void document.documentElement.offsetHeight
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
  })
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  bag.observe(bodyObserver)

  bag.on(document, 'fullscreenchange', () => {
    if (!get('fullscreenAnim')) return
    const el = getContainer()
    if (!el) return
    const nowFullscreen = document.fullscreenElement !== null
    if (nowFullscreen) { wasFullscreen = true; return }
    if (!wasFullscreen) return
    wasFullscreen = false
    const fromRect = { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight } as DOMRect
    // 退出全屏这一刻，B 站自己的布局 / 滚动不一定已经恢复：直播站的 #fullscreen-container
    // 要过几帧才回到原位（实测同步量到 [0,578,1028,900]，最终是 [50,126,1028,578]），
    // 拿没恢复的 rect 当目标，动画会飞错地方、结束时再跳一下。
    // 进全屏前那一刻量到的 rect（lastNonFsRect，由 pointerdown / keydown / scroll 快照）
    // 才是它该回到的地方，所以两者不一致时以它为准。主站播放页量到的本来就是最终位置
    // （与 lastNonFsRect 一致），走的还是原来那条路径，行为不变。
    const current = el.getBoundingClientRect()
    const settled = lastNonFsRect && !sameRect(current, lastNonFsRect) ? lastNonFsRect : current
    flipVideo(el, fromRect, settled, VIDEO_DUR_CLOSE)
  }, true)

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
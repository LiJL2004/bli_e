/**
 * 播放器现在处在哪种「屏幕模式」：普通 / 宽屏 / 网页全屏 / 全屏 / 小窗。
 *
 * 判定全部读 B 站自己写在 DOM 上的状态，不猜尺寸（2026-10-26 在真实播放页实测）：
 * - `.bpx-player-container[data-screen]`：`normal` / `wide` / `web` / `full` / `mini`。
 *   点右下角「宽屏」后它从 `normal` 变成 `wide`，容器矩形 963×588 → 1218×728；
 *   网页全屏是 `web`（同时 body 加 `.webscreen-fix`），全屏是 `full`。
 * - 网页全屏还有一条 body 类名兜底：直播站是 `player-full-win`，而且直播站没有 data-screen。
 * - 原生全屏以 `document.fullscreenElement` 为准 —— 那一刻只有全屏元素会渲染。
 *
 * 为什么单独一个模块：轮盘要知道「现在能不能接管呼出键」，宽屏动画要知道「是不是刚切了
 * 宽屏」，两边各写一份判断迟早会对不上。这里只做判定与通知，不碰 DOM。
 */

import { hasWebFullscreenClass } from '~/shared/bilibiliDom'
import { observeBody, onBodyClassChange } from './bodyClass'

const CONTAINER_SELECTOR = '.bpx-player-container'

export type PlayerScreen = 'normal' | 'wide' | 'web' | 'full' | 'mini'

/** 播放器容器；页面还没渲染出播放器时是 null */
export function getPlayerContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CONTAINER_SELECTOR)
}

export function getPlayerScreen(): PlayerScreen {
  // 原生全屏优先：进全屏时 body 上可能还留着网页全屏的类，fullscreenElement 才是真相
  if (document.fullscreenElement) return 'full'
  const screen = getPlayerContainer()?.dataset.screen
  if (screen === 'wide' || screen === 'web' || screen === 'full' || screen === 'mini') return screen
  if (hasWebFullscreenClass()) return 'web'
  return 'normal'
}

/**
 * 沉浸式：宽屏 / 网页全屏 / 全屏。
 *
 * 这三种模式下播放器已经铺满版面（或整屏），轮盘不该再抢呼出键 —— 见 quickWheel.ts。
 * 判定是「现算」的，所以退出全屏 / 宽屏之后下一次按键自然就恢复了，不需要额外的状态机。
 */
export function isPlayerImmersive(): boolean {
  const screen = getPlayerScreen()
  return screen === 'wide' || screen === 'web' || screen === 'full'
}

/**
 * 网页全屏 / 全屏：这两种模式下 B 站自己就把弹幕发送栏塞进控制栏中间（729×34 那条），
 * 样式、尺寸都归它，videoBeta 的发送栏规则一条都不许生效（见 videoBeta.css §9）。
 *
 * **宽屏不算**：宽屏只是把播放器拉宽，B 站照样把发送栏挂在播放器下面那 56px 里 ——
 * 我们把它搬进控制栏之后，得套窗口态那套（深色半透明）尺寸，否则会露出浅色的原版皮肤。
 */
export function isPlayerFullscreen(): boolean {
  const screen = getPlayerScreen()
  return screen === 'web' || screen === 'full'
}

type ScreenListener = (screen: PlayerScreen, prev: PlayerScreen) => void

const listeners = new Set<ScreenListener>()
let screenObserver: MutationObserver | null = null
/** 退订 body 类名观察（观察器由 bodyClass.ts 统一持有，三个模块共用） */
let offBody: (() => void) | null = null
let current: PlayerScreen = 'normal'

function emit() {
  const next = getPlayerScreen()
  if (next === current) return
  const prev = current
  current = next
  listeners.forEach((fn) => {
    try { fn(next, prev) }
    catch { /* 单个订阅者出错不影响其它人 */ }
  })
}

function ensureWatch() {
  if (screenObserver) return
  // 重新订阅时先对齐一次当前状态，否则「上次退订 → 这次订阅」之间发生的变化会被吞掉
  current = getPlayerScreen()

  // data-screen 挂在播放器容器上，而容器是播放器脚本自己建的、还可能被整个换掉，
  // 所以只能观察 body 的子树。属性名过滤到只剩 data-screen —— 别的属性变化都不会进回调
  // （B 站页面上 class 的变化极其频繁，别把它也加进这个观察器）。
  screenObserver = new MutationObserver(emit)
  observeBody(screenObserver, { attributes: true, subtree: true, attributeFilter: ['data-screen'] })

  // body 自己的 class 不递归：网页全屏的类只加在 body 上。
  // 回调里先做一次廉价预判：既不在网页全屏、当前结论也不是网页全屏时，body 改类名
  // 不可能改变结果（data-screen 与原生全屏各有自己的触发源），直接跳过那次全文档
  // querySelector —— B 站给 body 改类名很频繁，而首页上根本没有播放器。
  offBody = onBodyClassChange(() => {
    if (!hasWebFullscreenClass() && current !== 'web') return
    emit()
  })

  document.addEventListener('fullscreenchange', emit, true)
}

/**
 * 订阅「屏幕模式变了」。
 *
 * **不会在订阅时立刻回调一次**（与 videoLayer 的 `onWebFullscreenChange` 不同）：
 * 两个订阅者都只关心「变化」，初始状态自己读 `getPlayerScreen()`。
 */
export function onPlayerScreenChange(cb: ScreenListener): () => void {
  ensureWatch()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size > 0) return
    screenObserver?.disconnect()
    offBody?.()
    screenObserver = null
    offBody = null
    document.removeEventListener('fullscreenchange', emit, true)
  }
}

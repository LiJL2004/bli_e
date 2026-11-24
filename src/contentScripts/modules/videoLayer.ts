import { hasWebFullscreenClass } from '~/shared/bilibiliDom'
import { onBodyClassChange } from './bodyClass'

/**
 * 网页全屏时把我们的浮层收起来（视觉上就是「被视频盖住」）。
 *
 * 我们的宿主（设置键 / 返回顶部 / 刷新）挂在 `<html>` 下，是 `position: fixed` +
 * `z-index: 2147483647`，不处理的话进网页全屏后会浮在视频上面。
 * B 站进网页全屏时给 `<body>` 加类：主站 `webscreen-fix`、直播站 `player-full-win`
 * —— 判定与类名统一在 `~/shared/bilibiliDom`，三处不再各抄一份。
 *
 * **为什么不能靠「压低 z-index 让视频盖住」（2026-10-18 在真实播放页实测，别再试回去）**：
 * 进网页全屏后 B 站给 body 加的是 `position: fixed`（z-index: auto），而 fixed 本身就会
 * 生成层叠上下文 —— 播放器那套 `#bilibili-player.mode-webscreen { position: fixed;
 * z-index: 100000 }` / `.bpx-player-container { position: relative; z-index: 100000 }`
 * 全被关在 body 这个 0 级上下文里，整棵 body 子树按 0 级绘制。我们的宿主是 `<html>` 的
 * 直接子元素，只要 z-index 是正数就落在「正 z-index」那一层，永远压在 body 子树之上：
 * 实测压到 1000 甚至 1 都还在视频上面，压成负数才会沉到 body 的背景后面。
 * 所以隐藏是唯一与层级无关的确定做法，视觉上也就是「被视频盖住」。
 *
 * 只在 `<body>` 的 class 变化时算一次：进 / 出全屏各触发一次，不轮询、不读布局。
 */

/** 平时：设置键压过页面一切（含 B 站自己的浮层） */
export const LAYER_SETTINGS = '2147483647'
/** 平时：浮动键比设置键低一级 */
export const LAYER_FLOATS = '2147483646'
/**
 * 平时：功能轮盘与设置键同级 —— 它比设置键晚挂到 DOM 上（首次呼出才建），
 * 同层级下后出现的在上，所以轮盘能盖住 ⚙；两者本来也不会同时出现
 * （面板开着时轮盘不接管键盘，见 quickWheel.ts 的 settingsPanelOpen）。
 */
export const LAYER_WHEEL = '2147483647'

type Listener = (inWebFullscreen: boolean) => void

const listeners = new Set<Listener>()
/** 退订 body 类名观察（观察器本身由 bodyClass.ts 统一持有，三个模块共用） */
let offBody: (() => void) | null = null
let current = false

function detect() {
  return hasWebFullscreenClass()
}

function notify() {
  const next = detect()
  if (next === current) return
  current = next
  listeners.forEach((fn) => {
    try {
      fn(next)
    }
    catch { /* 单个订阅者出错不影响其它人 */ }
  })
}

/** 订阅「进 / 出网页全屏」；订阅时立刻回调一次当前状态，返回退订函数 */
export function onWebFullscreenChange(cb: Listener): () => void {
  if (!offBody) {
    current = detect()
    offBody = onBodyClassChange(notify)
  }
  listeners.add(cb)
  cb(current)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      offBody?.()
      offBody = null
    }
  }
}

/**
 * 让一个 fixed 宿主跟随网页全屏：**进全屏直接隐藏**，退出恢复。
 *
 * 恢复时必须 `removeProperty` 而不是写回某个值：宿主原本的层级来自这里第一次
 * `setProperty(..., 'important')`，多写一次只会把 `!important` 的旧声明留在行内；
 * `display` 同理 —— 宿主的 `cssText` 里没有 `display`，删掉就回到默认的 block。
 */
export function bindLayerToWebFullscreen(host: HTMLElement, frontZ: string): () => void {
  host.style.setProperty('z-index', frontZ, 'important')
  return onWebFullscreenChange((inFs) => {
    if (inFs) {
      host.style.setProperty('display', 'none', 'important')
      return
    }
    host.style.removeProperty('display')
    host.style.setProperty('z-index', frontZ, 'important')
  })
}

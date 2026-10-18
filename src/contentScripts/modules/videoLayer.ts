/**
 * 网页全屏时把我们的浮层压到播放器**下面**。
 *
 * 我们的宿主（设置键 / 返回顶部 / 刷新）是 `position: fixed` + `z-index: 2147483647`，
 * 不处理的话进网页全屏后会浮在视频上面 —— 要的是「被视频盖住」。
 * B 站进网页全屏时给 `<body>` 加类：主站 `webscreen-fix`、直播站 `player-full-win`
 * （和 videoFullscreen.ts 里的判定同源，两站类名不同，别合并）。
 *
 * 只在 `<body>` 的 class 变化时算一次：进 / 出全屏各触发一次，不轮询、不读布局。
 */
const WEB_FS_CLASSES = ['webscreen-fix', 'player-full-win']

/** 平时：设置键压过页面一切（含 B 站自己的浮层） */
export const LAYER_SETTINGS = '2147483647'
/** 平时：浮动键比设置键低一级 */
export const LAYER_FLOATS = '2147483646'
/** 网页全屏：低于播放器（B 站播放器容器 z-index 1002 左右），视频铺满时把按钮盖住 */
const LAYER_BEHIND_VIDEO = '1000'

type Listener = (inWebFullscreen: boolean) => void

const listeners = new Set<Listener>()
let observer: MutationObserver | null = null
let current = false

function detect() {
  return WEB_FS_CLASSES.some(cls => document.body.classList.contains(cls))
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
  if (!observer) {
    current = detect()
    observer = new MutationObserver(notify)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }
  listeners.add(cb)
  cb(current)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      observer?.disconnect()
      observer = null
    }
  }
}

/**
 * 让一个 fixed 宿主跟随网页全屏切换层级：平时 `frontZ`，进全屏降到视频下面。
 * 用 `setProperty(..., 'important')` 是因为宿主上原本就带 `!important` 的内联层级，
 * 普通赋值会被它压住。
 */
export function bindLayerToWebFullscreen(host: HTMLElement, frontZ: string): () => void {
  host.style.setProperty('z-index', frontZ, 'important')
  return onWebFullscreenChange((inFs) => {
    host.style.setProperty('z-index', inFs ? LAYER_BEHIND_VIDEO : frontZ, 'important')
  })
}

/**
 * 把 B 站**所有**图片查看接管到自绘查看器（1.2.5 v041）
 *
 * 背景：自绘那层（`imageViewerSelf.ts`）最早只接动态页相册，其它入口（评论区、专栏、
 * 空间页、动态单图……）点开还是 B 站的 PhotoSwipe。逐个识别图片容器既认不全也容易漏。
 *
 * 这里换个方向：B 站所有图片查看最终都走 PhotoSwipe —— 那就在它**建好的那一瞬间**
 * 把数据要过来（`window.pswp.options.dataSource` 只在页面世界，由 `guard.js` §11 代读），
 * 然后 destroy 掉、换成我们自己的层。
 *
 * FLIP 起点靠 document 捕获阶段的 `pointerdown` 记下来：等 `.pswp` 出现时，
 * 已经查不到「用户点的是哪张图」了。
 */

import { EventBag } from '../eventBag'
import { openSelfViewer, toMidThumbUrl, toOriginalImageUrl, type SelfViewerItem } from './imageViewerSelf'

const TAKEOVER_ATTR = 'data-blie-pswp-takeover'
const JSON_ATTR = 'data-blie-pswp-json'
const TAKEOVER_EVENT = 'blie-elite:pswp-takeover'

interface PswpPayload {
  index: number
  items: Array<{ src: string, thumb: string, w: number, h: number }>
}

export function setupPswpTakeover(): () => void {
  const bag = new EventBag()
  let busy = false
  let lastRect: DOMRect | null = null
  let lastEl: HTMLImageElement | null = null

  // 「用户点的是哪张图」—— pswp 出现时已经查不到点击目标了，只能提前记。
  // **必须用 composedPath**：评论区是 `bili-comments` web component，shadow 内点图时
  // `e.target` 会被重定向成宿主元素，`closest('img')` 什么都拿不到 —— 没有这张图，
  // 关闭时就没有 FLIP 终点（用户报的「丢动画」），缩略图也只能退回 pswp 的占位小图
  // （放大后是一团马赛克，用户截图那个）。
  bag.on(document, 'pointerdown', (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : []
    for (const node of path) {
      const el = node as Element | null
      if (!el || typeof el.tagName !== 'string' || el.tagName !== 'IMG')
        continue
      // 我们自己那层、以及官方看图器里的图都不算「页面上的缩略图」
      if (typeof el.closest === 'function' && el.closest('.blie-iv, .pswp'))
        return
      const img = el as HTMLImageElement
      const r = img.getBoundingClientRect()
      if (r.width < 8 || r.height < 8)
        return
      lastEl = img
      lastRect = r
      return
    }
  }, true)

  const takeOver = () => {
    if (busy)
      return
    const pswpEl = document.querySelector<HTMLElement>('.pswp')
    if (!pswpEl)
      return
    busy = true
    try {
      const root = document.documentElement
      root.setAttribute(TAKEOVER_ATTR, '')
      document.dispatchEvent(new Event(TAKEOVER_EVENT))
      const raw = root.getAttribute(JSON_ATTR)
      root.removeAttribute(JSON_ATTR)

      // guard.js 没接住（实例还没挂到 `window.pswp`、或者 dataSource 是空的）：
      // 保留 B 站那套，别把用户点开的图弄没了
      if (!raw)
        return

      // 能解析就一定摘掉 B 站这层，否则会和自绘那层叠在一起。
      // **先把 `pswp--open` 摘掉再移除元素**：imageGlass 的观察器靠 class 变化判断
      // 「该淡出了」，我们直接 remove 它收不到；而且它的全局 childList 观察器**比我们
      // 后跑**，拿到的还是那个已经 detached、却仍带着 `pswp--open` 的节点 —— 会再建一层
      // 毛玻璃 overlay 出来（`#bili-elite-glass-overlay`），那层 blur 永远没人淡出，
      // 关掉图片后整页还是糊的（用户报的「视频 / 动态评论区都有」）。
      pswpEl.classList.remove('pswp--open')
      pswpEl.remove()
      document.getElementById('bili-elite-glass-overlay')?.remove()
      // 兜底：万一 imageGlass 的观察器还是抢在前面建了一层，过一会儿再清一次
      // （我们自己那层有独立的 backdrop，不需要它）
      window.setTimeout(() => {
        document.getElementById('bili-elite-glass-overlay')?.remove()
      }, 500)

      const data = JSON.parse(raw) as PswpPayload

      // **找页面上这一组图的元素**：切图之后关闭要靠它们做 FLIP 终点，否则「切过图再关」
      // 就没有回缩动画了（用户报的那个）。从被点的那张往上找「img 数量刚好等于
      // dataSource 数量」的容器，里面的 img 按顺序对应 dataSource —— 比猜类名稳。
      let group: HTMLImageElement[] = []
      if (lastEl) {
        let box: Element | null = lastEl
        for (let depth = 0; depth < 5 && box; depth++) {
          const imgs = [...box.querySelectorAll('img')].filter((im) => {
            const r = im.getBoundingClientRect()
            return r.width > 8 && r.height > 8
          }) as HTMLImageElement[]
          if (imgs.length === data.items.length) {
            group = imgs
            break
          }
          box = box.parentElement
        }
      }

      const list: SelfViewerItem[] = []
      for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i]
        const isCurrent = i === data.index
        const el = group[i] ?? (isCurrent ? lastEl : null)
        const liveRect = el && el.isConnected ? el.getBoundingClientRect() : null
        // 当前这张优先用**页面上那张缩略图**（已经在缓存里、比例就是用户看到的那个）；
        // 其它张用 `@480w` 现造一张等比缩略图。
        // **绝不能用 pswp 的 `msrc`**：那是它自己的占位小图（常常只有几十像素），
        // 铺满全屏就是一坨马赛克 —— 用户截图报的就是这个。
        const pageThumb = el ? (el.currentSrc || el.src || '') : ''
        list.push({
          src: toOriginalImageUrl(it.src),
          thumb: pageThumb || toMidThumbUrl(it.src) || it.src,
          rect: liveRect && liveRect.width > 8 ? liveRect : (isCurrent ? lastRect : null),
          el,
        })
      }
      if (list.length) {
        openSelfViewer(list, Math.max(0, Math.min(data.index, list.length - 1)))
        // 我们取代了它，但 PS5 实例的 `document` keydown 可能因为 destroy() 只调 close()
        // 而留在页面上（它会无条件 preventDefault 掉 ←/→）。这里立刻让页面世界补一刀。
        document.dispatchEvent(new Event('blie-elite:kill-pswp'))
      }
    }
    catch { /* 解析失败就当没接管 */ }
    finally { busy = false }
  }

  const start = () => {
    const obs = new MutationObserver(takeOver)
    obs.observe(document.body, { childList: true })
    bag.observe(obs)
  }

  // `document_start` 时 body 还是 null
  if (document.body) {
    start()
  }
  else {
    const wait = new MutationObserver(() => {
      if (!document.body)
        return
      wait.disconnect()
      start()
    })
    wait.observe(document.documentElement, { childList: true })
    bag.observe(wait)
  }

  return () => bag.dispose()
}

import { get } from '../config'
import { EventBag } from '../eventBag'
import { prefersReducedMotion } from './designTokens'
import { openSelfViewer, toOriginalImageUrl, type SelfViewerItem } from './imageViewerSelf'

const DRAG_THRESHOLD = 10
const POLL_TIMEOUT = 800
const IMG_WAIT_TIMEOUT = 500
export const IMAGE_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
export const IMAGE_DUR_OPEN = 330
export const IMAGE_DUR_CLOSE = 290

// 动态页（t.bilibili.com）的相册组件 `bili-album` 原生是「两步」打开大图的：
//   ① 点缩略图 → 卡片内联展开（`.bili-album__watch` 显示，自带一条
//      「收起 / 查看大图 / 向左旋转 / 向右旋转」工具栏），此时**还没有** PhotoSwipe；
//   ② 点工具栏「查看大图」→ 才创建 `.pswp`。
// ① 那层中间态是纯多余的：用户点图就是想看大图。现在①被接管 —— 拦住缩略图那一下，
// 直接把整个相册丢给**自绘查看器**（`imageViewerSelf.ts`，见 openAlbumSelf），
// 内联态一次都不出现，也不再借官方 PhotoSwipe。
//
// ② 那一下仍然要认：内联态已经展开（从别的入口进来的）时点「查看大图」，点击目标是个
// <div>，composedPath 里根本没有 <img>，原来那套「点到的图片当 FLIP 起点」的逻辑会直接
// return，打开 / 关闭都变成硬切。所以按钮点击时把相册内联展示的那张大图当起点，
// 关闭时再回到同一张图（这条路仍是官方 pswp + 我们的 FLIP）。
const ALBUM = '.bili-album'
const ALBUM_WATCH = '.bili-album__watch'
const ALBUM_BIG_BTN = '.bili-album__watch__control__option.full-screen'
const ALBUM_INLINE_IMG = '.bili-album__watch__content img'
const ALBUM_PIC = '.bili-album__preview__picture'

export function setupImageViewer(): () => void {
  const bag = new EventBag()

  let lastThumbUrl: string | null = null
  let lastImgRect: DOMRect | null = null
  let pollTimer: number | null = null
  let lockUntil = 0
  let dragStartX = 0
  let dragStartY = 0
  let isDragging = false

  function lockFor(ms: number) {
    const until = performance.now() + ms
    if (until > lockUntil) lockUntil = until
  }
  function isLocked() { return performance.now() < lockUntil }

  function paintPlaceholders(pswp: Element) {
    if (!lastThumbUrl) return
    const phs = pswp.querySelectorAll<HTMLElement>('.pswp__img--placeholder')
    phs.forEach((ph) => {
      if (ph.dataset.biliThumbApplied === '1') return
      ph.dataset.biliThumbApplied = '1'
      ph.style.backgroundImage = `url("${lastThumbUrl}")`
      ph.style.backgroundSize = 'contain'
      ph.style.backgroundPosition = 'center'
      ph.style.backgroundRepeat = 'no-repeat'
      ph.style.backgroundColor = 'transparent'
    })
  }

  function getActiveImg(pswp: Element): HTMLElement | null {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const els = pswp.querySelectorAll<HTMLElement>('.pswp__img')
    let best: HTMLElement | null = null
    let bestScore = -1
    els.forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
      const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      const area = visW * visH
      if (area <= 0) return
      const isImgTag = el.tagName === 'IMG'
      const score = area + (isImgTag ? 1000000 : 0)
      if (score > bestScore) { bestScore = score; best = el }
    })
    return best
  }

  function computeFlip(swRect: DOMRect, imgRect: DOMRect, targetRect: DOMRect) {
    if (!imgRect.width || !imgRect.height) return null
    const sx = targetRect.width / imgRect.width
    const sy = targetRect.height / imgRect.height
    const TX = targetRect.left - swRect.left - (imgRect.left - swRect.left) * sx
    const TY = targetRect.top - swRect.top - (imgRect.top - swRect.top) * sy
    if (!isFinite(TX) || !isFinite(TY) || !isFinite(sx) || !isFinite(sy)) return null
    return { TX, TY, sx, sy }
  }

  function startPollingForPswp() {
    if (pollTimer) return
    const start = performance.now()
    const check = () => {
      const pswp = document.querySelector('.pswp.pswp--open')
      if (pswp) { pollTimer = null; playOpen(pswp); return }
      if (performance.now() - start > POLL_TIMEOUT) { pollTimer = null; return }
      pollTimer = window.requestAnimationFrame(check)
    }
    check()
  }

  function waitForImgReady(pswp: Element, cb: (el: HTMLElement | null, rect: DOMRect | null) => void) {
    let attempts = 0
    const tryOnce = () => {
      const el = getActiveImg(pswp)
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width > 20 && r.height > 20) { cb(el, r); return }
      }
      if (attempts++ > IMG_WAIT_TIMEOUT / 10) { cb(null, null); return }
      setTimeout(tryOnce, 10)
    }
    tryOnce()
  }

  function playOpen(pswp: Element) {
    if (!lastImgRect) return
    const rect = lastImgRect
    const inner = pswp.querySelector<HTMLElement>('.pswp__scroll-wrap')
    if (!inner) return

    waitForImgReady(pswp, (el, elRect) => {
      if (!el || !elRect) return
      if (!pswp.parentNode) return

      const swRect = inner.getBoundingClientRect()
      const flip = computeFlip(swRect, elRect, rect)
      if (!flip) return

      // 系统开了「减少动态效果」：不做跨屏 FLIP —— 那是整张图从缩略图飞到大图，
      // 位移 + 缩放都很大，正是这类用户最难受的一类动画。开合都直接显示，
      // 连下面的「关闭时反向飞回」观察器也一并跳过。
      if (prefersReducedMotion()) return

      lockFor(IMAGE_DUR_OPEN)
      inner.style.transformOrigin = 'top left'
      paintPlaceholders(pswp)

      const anim = inner.animate(
        [
          { transform: `translate(${flip.TX}px, ${flip.TY}px) scale(${flip.sx}, ${flip.sy})` },
          { transform: 'translate(0, 0) scale(1, 1)' },
        ],
        { duration: IMAGE_DUR_OPEN, easing: IMAGE_EASE, fill: 'none' },
      )
      anim.onfinish = () => { inner.style.transformOrigin = '' }
      anim.oncancel = anim.onfinish

      const classObs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.attributeName !== 'class') continue
          const wasVisible = m.oldValue && m.oldValue.includes('pswp--ui-visible')
          const nowVisible = pswp.classList.contains('pswp--ui-visible')
          if (wasVisible && !nowVisible) {
            lockFor(IMAGE_DUR_CLOSE)
            const animTarget = pswp.querySelector<HTMLElement>('.pswp__scroll-wrap')
              || pswp.querySelector<HTMLElement>('.pswp__container')
            const el2 = getActiveImg(pswp)
            if (animTarget && el2) {
              const swRect2 = animTarget.getBoundingClientRect()
              const elRect2 = el2.getBoundingClientRect()
              if (elRect2.width > 0 && elRect2.height > 0) {
                const flip2 = computeFlip(swRect2, elRect2, rect)
                if (flip2) {
                  pswp.classList.add('bili-closing-anim')
                  animTarget.style.transform = 'translate(0, 0) scale(1, 1)'
                  void animTarget.offsetHeight
                  animTarget.style.transform = `translate(${flip2.TX}px, ${flip2.TY}px) scale(${flip2.sx}, ${flip2.sy})`
                }
              }
            }
            classObs.disconnect()
            return
          }
        }
      })
      classObs.observe(pswp, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    })
  }

  /**
   * 点在「相册缩略图」上吗 —— 是就返回这张图、它所在的相册和屏幕位置。
   *
   * 只认 `.bili-album__preview` 那层缩略图（内联态展开后这一层被盖住，点不到）。
   * 拿不到「查看大图」按钮就返回 null（组件换版 / 别的站点也用这套相册）——
   * 交回 B 站，免得把图点成「点了没反应」。
   */
  function albumThumbOf(target: HTMLElement | null) {
    const pic = target?.closest?.(ALBUM_PIC)
    if (!pic) return null
    const album = pic.closest(ALBUM)
    if (!album || !album.querySelector(ALBUM_BIG_BTN)) return null
    const img = pic.querySelector<HTMLImageElement>('img')
    if (!img) return null
    const rect = img.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 20) return null
    return { album, img, rect }
  }

  /**
   * 相册 → **自绘查看器**（v037）。
   *
   * v035 那版是「替用户点掉 B 站的『查看大图』」，借官方 PhotoSwipe 显示；现在整套换成
   * `imageViewerSelf.ts` 自己画的一层 —— 缩放 / 旋转 / 点图不触发都在本地 `transform`
   * 里做，不用再绕 `window.pswp`、不用 guard.js 代劳。
   *
   * 相册里每张图都带上**点击那一刻的屏幕位置**：只有被点的那张有意义，其余为 null，
   * 打开 / 关闭的 FLIP 起点就取它。
   */
  function openAlbumSelf(t: { album: Element; img: HTMLImageElement; rect: DOMRect }) {
    const list: SelfViewerItem[] = []
    for (const pic of Array.from(t.album.querySelectorAll(ALBUM_PIC))) {
      const im = pic.querySelector<HTMLImageElement>('img')
      const raw = im ? (im.currentSrc || im.src || '') : ''
      if (!raw) continue
      const r = im?.getBoundingClientRect()
      list.push({
        src: toOriginalImageUrl(raw),
        thumb: raw,
        rect: r && r.width > 8 && r.height > 8 ? r : null,
        el: im,
      })
    }
    if (!list.length) return
    // 序号用原图地址对齐（缩略图可能带不同尺寸后缀，统一先转原图再比）
    const clicked = toOriginalImageUrl(t.img.currentSrc || t.img.src || '')
    openSelfViewer(list, Math.max(0, list.findIndex(it => it.src === clicked)))
  }

  // 动态页「查看大图」：按钮不是图片，FLIP 起点取相册内联展示的那张大图
  function albumSource(target: HTMLElement | null): HTMLImageElement | null {
    const btn = target?.closest?.(ALBUM_BIG_BTN)
    if (!btn) return null
    return btn.closest(ALBUM_WATCH)?.querySelector<HTMLImageElement>(ALBUM_INLINE_IMG) ?? null
  }

  bag.on(document, 'pointerdown', (e) => {
    if (!get('imageAnim')) return
    const ev = e as PointerEvent
    dragStartX = ev.clientX
    dragStartY = ev.clientY
    isDragging = false
  }, true)

  bag.on(document, 'pointermove', (e) => {
    if (!get('imageAnim')) return
    if (isDragging) return
    const ev = e as PointerEvent
    if (Math.abs(ev.clientX - dragStartX) > DRAG_THRESHOLD
      || Math.abs(ev.clientY - dragStartY) > DRAG_THRESHOLD) {
      isDragging = true
    }
  }, true)

  bag.on(document, 'click', (e) => {
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.pswp') || target?.closest?.('.blie-iv')) return

    // 拖动结束那一下不算「点击」（只有开着动画时才会记录拖动）
    if (isDragging) {
      isDragging = false
      return
    }
    if (isLocked()) {
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }

    // 相册缩略图 → 直接开**自绘**查看器。**不受 imageAnim 开关管**：这是「点图看大图」
    // 的语义，不是开合动画，关掉动画的用户也该一步到位。
    //
    // **只在 click 这一层拦**，别去动 pointerdown / pointerup：B 站的相册在
    // pointerdown / pointerup 上挂了状态（按下了谁、是不是一次有效点击）。把这两下
    // 截掉之后，它 click 时走「兜底展开内联态」那条路（实测：内联态展开了、图没开）。
    // 让指针事件原样过去，只截 click 就正好 —— 我们的监听挂在 document 捕获阶段，
    // 比 B 站元素上的 click 早。
    const thumb = albumThumbOf(target)
    if (thumb) {
      e.preventDefault()
      e.stopPropagation()
      openAlbumSelf(thumb)
      return
    }

    if (!get('imageAnim')) return

    const albumImg = albumSource(target)
    if (albumImg) {
      const r = albumImg.getBoundingClientRect()
      if (r.width > 20 && r.height > 20) {
        lockFor(IMAGE_DUR_OPEN)
        lastThumbUrl = albumImg.currentSrc || albumImg.src
        lastImgRect = r
        startPollingForPswp()
      }
      return
    }

    const path = (typeof e.composedPath === 'function') ? e.composedPath() : [target as Node]
    for (const node of path) {
      if (!node || (node as Node).nodeType !== 1) continue
      const el = node as HTMLElement
      if (el.tagName === 'IMG') {
        const r = el.getBoundingClientRect()
        if (r.width > 20 && r.height > 20) {
          lockFor(IMAGE_DUR_OPEN)
          lastThumbUrl = (el as HTMLImageElement).src
          lastImgRect = r
          startPollingForPswp()
        }
        return
      }
    }
  }, true)

  return () => {
    if (pollTimer) cancelAnimationFrame(pollTimer)
    bag.dispose()
  }
}

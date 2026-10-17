import { get } from '../config'
import { EventBag } from '../eventBag'

const DRAG_THRESHOLD = 10
const POLL_TIMEOUT = 800
const IMG_WAIT_TIMEOUT = 500
const IMAGE_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
export const IMAGE_DUR_OPEN = 330
export const IMAGE_DUR_CLOSE = 290

// 动态页（t.bilibili.com）的相册组件 `bili-album` 是「两步」打开大图的：
//   ① 点缩略图 → 卡片内联展开（`.bili-album__watch` 显示，自带一条
//      「收起 / 查看大图 / 向左旋转 / 向右旋转」工具栏），此时**还没有** PhotoSwipe；
//   ② 点工具栏「查看大图」→ 才创建 `.pswp`。
// 第二步的点击目标是个 <div>，composedPath 里根本没有 <img>，原来那套
// 「点到的图片当 FLIP 起点」的逻辑会直接 return，于是打开 / 关闭都是硬切。
// 这里补上相册这一路：按钮点击时把相册内联展示的那张大图当起点，
// 关闭时再回到同一张图（关掉大图后内联态仍在，位置不变）。
const ALBUM = '.bili-album'
const ALBUM_WATCH = '.bili-album__watch'
const ALBUM_PREVIEW = '.bili-album__preview'
const ALBUM_BIG_BTN = '.bili-album__watch__control__option.full-screen'
const ALBUM_INLINE_IMG = '.bili-album__watch__content img'

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

  // 相册缩略图点击只是卡片内联展开（不创建 PhotoSwipe），
  // 所以既不记 rect 也不上锁——否则紧跟着点「查看大图」会被锁吞掉。
  function isAlbumPreviewClick(target: HTMLElement | null) {
    const preview = target?.closest?.(ALBUM_PREVIEW)
    if (!preview) return false
    return !!preview.closest(ALBUM)?.querySelector(ALBUM_WATCH)
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
    if (!get('imageAnim')) return
    if (isDragging) { isDragging = false; return }
    if (isLocked()) {
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.pswp')) return

    if (isAlbumPreviewClick(target)) return

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

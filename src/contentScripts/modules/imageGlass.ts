import { get, onConfigChange } from '../config'
import { EventBag } from '../eventBag'
import { getGlassParams, onGlassParamsChange } from './glassConfig'
import { IMAGE_DUR_CLOSE, IMAGE_DUR_OPEN } from './imageViewer'

const STYLE_ID = 'bili-elite-glass-style'
const OVERLAY_ID = 'bili-elite-glass-overlay'
const GLASS_CLASS = 'bili-glass'
const EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'

export function setupImageGlass(): () => void {
  const bag = new EventBag()
  const bound = new WeakSet<Element>()
  let overlay: HTMLElement | null = null
  let overlayAnim: Animation | null = null
  let overlayTarget = -1

  const enabled = () => get('imageGlass')

  function ensureStyle() {
    const existing = document.getElementById(STYLE_ID)
    const on = enabled()
    if (on && !existing) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `.pswp.${GLASS_CLASS} .pswp__bg{background:transparent!important;}`
      document.head.appendChild(style)
    } else if (!on && existing) {
      existing.remove()
    }
  }

  function overlayTint(brightness: number): string {
    const mid = 50
    const maxAlpha = 0.9
    // 50 为中性：越低越暗（黑罩），越高越亮（白罩）
    if (brightness <= mid) {
      const a = ((mid - brightness) / mid) * maxAlpha
      return `rgba(0, 0, 0, ${a.toFixed(3)})`
    }
    const a = ((brightness - mid) / mid) * maxAlpha
    return `rgba(255, 255, 255, ${a.toFixed(3)})`
  }

  function applyOverlayStyle(el: HTMLElement) {
    const p = getGlassParams()
    // iOS 风格材质：模糊 + 饱和度提升，让透过来的图片保持鲜活（而非发灰）
    const bf = `blur(${p.blur}px) saturate(180%) brightness(1.02)`
    el.style.setProperty('backdrop-filter', bf)
    el.style.setProperty('-webkit-backdrop-filter', bf)
    el.style.background = overlayTint(p.brightness)
  }

  function ensureOverlay(): HTMLElement {
    if (overlay && document.body.contains(overlay)) return overlay
    const el = document.createElement('div')
    el.id = OVERLAY_ID
    el.style.position = 'fixed'
    el.style.left = '0'
    el.style.top = '0'
    el.style.right = '0'
    el.style.bottom = '0'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '0'
    el.style.opacity = '0'
    el.style.display = 'none'
    applyOverlayStyle(el)
    document.body.appendChild(el)
    overlay = el
    return el
  }

  function fade(to: number, dur: number) {
    if (!overlay) return
    // 已经朝目标状态过渡时不要重复触发，避免淡出被再次 cancel 而瞬间消失
    if (overlayTarget === to) return
    // 先读当前实际透明度（可能正处于某段动画中途），再取消旧动画，实现平滑反向
    const from = parseFloat(getComputedStyle(overlay).opacity) || 0
    if (overlayAnim) { overlayAnim.cancel(); overlayAnim = null }
    if (to > 0) overlay.style.display = 'block'
    overlay.style.opacity = String(from)
    overlayAnim = overlay.animate(
      [{ opacity: from }, { opacity: to }],
      { duration: dur, easing: EASE, fill: 'forwards' },
    )
    overlayTarget = to
    overlayAnim.onfinish = () => {
      if (!overlay) return
      overlay.style.opacity = String(to)
      if (to === 0) overlay.style.display = 'none'
      if (overlayAnim) { overlayAnim.cancel(); overlayAnim = null }
    }
  }

  function placeOverlay(pswp: Element): HTMLElement {
    const el = ensureOverlay()
    const parent = pswp.parentNode
    if (parent && el.parentNode !== parent) parent.appendChild(el)
    const pe = pswp as HTMLElement
    let z = parseInt(getComputedStyle(pswp).zIndex, 10)
    if (Number.isNaN(z)) {
      if (pe.dataset.biliGlassZ !== '1') {
        pe.dataset.biliGlassZ = '1'
        pe.style.setProperty('z-index', '2147483647', 'important')
      }
      z = 2147483647
    }
    el.style.zIndex = String(Math.max(0, z - 1))
    return el
  }

  function fadeIn(pswp: Element) {
    const el = placeOverlay(pswp)
    applyOverlayStyle(el)
    fade(1, IMAGE_DUR_OPEN)
  }

  function fadeOut() {
    // 与图片开关动画（imageViewer）保持同步
    fade(0, IMAGE_DUR_CLOSE)
  }

  function syncPswp(pswp: Element) {
    pswp.classList.toggle(GLASS_CLASS, enabled())
  }

  function bindPswp(pswp: Element) {
    if (bound.has(pswp)) return
    bound.add(pswp)
    syncPswp(pswp)
    // PhotoSwipe 会在同一个同步任务里 append `.pswp` 并加上 `pswp--open`，
    // 等到 document 的 MutationObserver 回调执行时，节点已经是打开状态，
    // 下面这个基于 class 变化的观察器就再也收不到 `pswp--open` 的变化了。
    // 因此这里必须主动补一次淡入，否则 overlay 永远不会创建/显示。
    if (enabled() && pswp.classList.contains('pswp--open')) fadeIn(pswp)
    const obs = new MutationObserver((muts) => {
      if (!enabled()) return
      for (const m of muts) {
        if (m.attributeName !== 'class') continue
        const oldV = m.oldValue || ''
        const wasOpen = oldV.includes('pswp--open')
        const nowOpen = pswp.classList.contains('pswp--open')
        const wasUi = oldV.includes('pswp--ui-visible')
        const nowUi = pswp.classList.contains('pswp--ui-visible')
        if (!wasOpen && nowOpen) {
          fadeIn(pswp)
        } else if ((wasUi && !nowUi) || (wasOpen && !nowOpen)) {
          fadeOut()
        }
      }
    })
    obs.observe(pswp, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    bag.observe(obs)
  }

  function scan(root: Node) {
    if (root.nodeType !== 1) return
    const el = root as Element
    if (el.classList && el.classList.contains('pswp')) bindPswp(el)
    el.querySelectorAll?.('.pswp').forEach(bindPswp)
  }

  ensureStyle()
  document.querySelectorAll('.pswp').forEach(bindPswp)

  const mo = new MutationObserver((muts) => {
    if (!enabled()) return
    for (const m of muts) m.addedNodes.forEach(scan)
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })
  bag.observe(mo)

  bag.add(onConfigChange((key) => {
    if (key !== 'imageGlass') return
    ensureStyle()
    document.querySelectorAll('.pswp').forEach((p) => {
      syncPswp(p)
      if (enabled() && p.classList.contains('pswp--open')) fadeIn(p)
    })
    if (!enabled() && overlay) {
      if (overlayAnim) { overlayAnim.cancel(); overlayAnim = null }
      overlayTarget = 0
      overlay.style.opacity = '0'
      overlay.style.display = 'none'
    }
  }))

  bag.add(onGlassParamsChange(() => {
    if (overlay) applyOverlayStyle(overlay)
  }))

  return () => {
    bag.dispose()
    document.getElementById(STYLE_ID)?.remove()
    overlay?.remove()
    overlay = null
  }
}

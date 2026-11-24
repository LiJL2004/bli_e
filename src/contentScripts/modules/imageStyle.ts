import { get, onConfigChange } from '../config'
import { IMAGE_DUR_CLOSE, IMAGE_EASE } from './imageViewer'

const STYLE_ID = 'bili-elite-anim-style'

function applyStyle() {
  const existing = document.getElementById(STYLE_ID)
  const should = get('imageAnim')
  if (should && !existing) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .pswp.bili-closing-anim .pswp__scroll-wrap,
      .pswp.bili-closing-anim .pswp__container {
        transition: transform ${IMAGE_DUR_CLOSE}ms ${IMAGE_EASE} !important;
        transform-origin: top left !important;
      }
    `
    document.head.appendChild(style)
  } else if (!should && existing) {
    existing.remove()
  }
}

export function setupImageStyle(): () => void {
  applyStyle()
  const off = onConfigChange((key) => {
    if (key === 'imageAnim') applyStyle()
  })
  return () => {
    off()
    document.getElementById(STYLE_ID)?.remove()
  }
}

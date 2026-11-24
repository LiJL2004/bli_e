/**
 * 悬浮窗里的「详情页分栏」—— 只在窗口够宽时开。
 *
 * 目标布局（对标 bili_cat 的动态详情弹窗）：
 *
 *   纯文字：  ┌──────────────┬────────┐        有图：  ┌──────────────┬────────┐
 *            │ 正文（作者 / │ 评论区 │                │              │ 作者 + │
 *            │ 标题 / 文字）│        │                │   图片舞台   │ 正文   │
 *            │              │        │                │              ├────────┤
 *            └──────────────┴────────┘                └──────────────┴────────┘
 *
 * **为什么是搬 DOM，不是纯 CSS**：详情页的树是
 *   `.card > [.bili-dyn-item（正文）, .bili-tabs（评论）]`，
 * 而「图片」藏在正文内部（`.dyn-card-opus__pics`），要让它和评论同列就得跨子树移动 ——
 * CSS Grid 挪不了跨层级的节点，`display: contents` 又要连着压平 7 层 B 站包装盒
 * （每层都有自己的 padding / 背景，压平后全得重写），B 站一改类名就整块塌。
 * 搬 3 个节点只有 3 个前提（`.card` / `.bili-dyn-item` / `.bili-tabs`），任何一个
 * 找不到就原地放弃、退回单栏，不会出现「半个分栏」。
 *
 * **谁调用**：`dynamicOverlay.ts` 的 decorateFrame / iframe 的 resize。
 * 判宽在调用方做（`SPLIT_MIN_WIDTH`），这里只负责「搬」和「还原」。
 */

/** 挂在 `<html>` 上，给 EMBED_CSS 里的分栏样式用 */
export const SPLIT_ON_CLASS = 'bili-elite-dyn-split'

/** 图库换了张图 / 原图加载完 → 让外层按新的宽高比重算窗口宽度 */
export const RELAYOUT_EVENT = 'blie-elite:dyn-relayout'

/**
 * 窄于这个宽度就保持单栏。
 * 右栏最窄 510（评论列，见 EMBED_CSS 的 grid-template-columns），窗口 1080 时左栏还剩 570 ——
 * 再窄下去正文/图片就被挤成一条了，不如退回单栏。
 */
export const SPLIT_MIN_WIDTH = 1080

/** 窗口太矮也别分：右栏要同时放「文字 + 评论」，低于这个高度一屏看不到东西 */
export const SPLIT_MIN_HEIGHT = 480

interface Anchor {
  parent: Node
  next: Node | null
}

interface SplitRecord {
  split: HTMLElement
  item: HTMLElement
  itemAt: Anchor
  tabs: HTMLElement
  tabsAt: Anchor
  pics: HTMLElement | null
  picsAt: Anchor | null
}

/** 一份 iframe 文档一条记录：还原时要放回原位，重新加载后是新文档、自然重来 */
const records = new WeakMap<Document, SplitRecord>()

function anchorOf(el: Node): Anchor {
  return { parent: el.parentNode!, next: el.nextSibling }
}

function putBack(el: Node, at: Anchor) {
  // 原位那个「下一个兄弟」可能已经被 B 站重渲染换掉了，换掉了就直接追加
  const next = at.next && at.next.parentNode === at.parent ? at.next : null
  at.parent.insertBefore(el, next)
}

function countPics(pics: HTMLElement) {
  return pics.querySelectorAll('.bili-album__preview__picture').length
}

const CHEV_LEFT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>'
const CHEV_RIGHT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>'

/**
 * 图片舞台：一次只显示一张，左右箭头 + 底部缩略图切换（对标 bili_cat 的 opus 图库）。
 *
 * **为什么是「切显隐」而不是自己重建一个图库**：B 站那套 `.bili-album` 上挂着它自己的
 * 点击 → 看图器（缩放 / 旋转 / 全屏），重建一套就得把那些交互全丢了。这里只给当前那张
 * 挂 `is-active`、其余 `display:none`，点图仍然是 B 站原版看图器。
 *
 * **为什么要换回原图**：B 站相册里放的是 `@264w_264h_1e_1c` 这种**方形裁切**的缩略图
 * （长条漫画只剩中间一小块），原尺寸放大就是「一截残图」。切到哪张就把那张的 `@...` 后缀
 * 去掉换原图（只换当前这张，不会一次性拉全部），顺带把 `<source>` 的 srcset 去掉 ——
 * 否则浏览器还是按 srcset 挑缩略图。
 *
 * 原图很长的（长条漫画 / 长截图，高宽比 > 1.5）改成「宽度铺满、纵向滚动」，
 * 硬塞进 contain 会缩成一根细条。
 */
function setupGallery(doc: Document, pics: HTMLElement) {
  const items = [...pics.querySelectorAll<HTMLElement>('.bili-album__preview__picture')]
  if (!items.length) return

  let index = 0
  const thumbEls: HTMLElement[] = []
  let countEl: HTMLElement | null = null

  const ui = doc.createElement('div')
  ui.className = items.length > 1 ? 'blie-gallery' : 'blie-gallery is-single'
  ui.innerHTML = `<button type="button" class="blie-gallery__nav is-prev" aria-label="上一张">${CHEV_LEFT}</button>
    <button type="button" class="blie-gallery__nav is-next" aria-label="下一张">${CHEV_RIGHT}</button>
    <div class="blie-gallery__thumbs"></div>
    <span class="blie-gallery__count"></span>`
  pics.appendChild(ui)

  /** 长图：宽度铺满、纵向滚动，别缩成一根细条 */
  const syncTall = (el: HTMLElement) => {
    const img = el.querySelector<HTMLImageElement>('img')
    if (!img || !img.naturalWidth) return
    // 挂在 pics 上而不是控件容器上：相册是它的兄弟节点，挂控件容器上 CSS 选不中
    pics.classList.toggle('is-tall', img.naturalHeight / img.naturalWidth > 1.5)
  }

  /** B 站图片 URL 的尺寸后缀（`@264w_264h_1e_1c.avif`）去掉就是原图 */
  const toOriginal = (u: string) => u.replace(/@[^/\s,]+$/, '')

  /** 当前这张换成原图（只做一次） */
  const loadOriginal = (el: HTMLElement) => {
    const img = el.querySelector<HTMLImageElement>('img')
    if (!img) return
    syncTall(el)
    if (el.dataset.blieHd) return
    el.dataset.blieHd = '1'
    const src = img.currentSrc || img.src
    const original = toOriginal(src)
    if (!original || original === src) return
    // **只改 URL，不删 <source>**：删节点会把 B 站图片懒加载那边持有的引用搞坏
    // （实测会抛 IntersectionObserver.unobserve 的 TypeError）
    el.querySelectorAll('source').forEach((s) => {
      const set = s.getAttribute('srcset')
      if (set)
        s.setAttribute('srcset', set.split(',').map(p => toOriginal(p.trim())).join(', '))
    })
    img.removeAttribute('srcset')
    img.src = original
    img.addEventListener('load', () => {
      syncTall(el)
      // 原图的宽高比和缩略图不一样（长条漫画尤其），窗口宽度要按新比例重算
      doc.dispatchEvent(new Event(RELAYOUT_EVENT))
    }, { once: true })
  }

  const apply = (next: number) => {
    index = (next + items.length) % items.length
    items.forEach((el, i) => el.classList.toggle('is-active', i === index))
    thumbEls.forEach((el, i) => el.classList.toggle('is-active', i === index))
    if (countEl) countEl.textContent = `${index + 1} / ${items.length}`
    loadOriginal(items[index])
  }

  if (items.length > 1) {
    const thumbs = ui.querySelector('.blie-gallery__thumbs') as HTMLElement
    countEl = ui.querySelector('.blie-gallery__count') as HTMLElement

    items.forEach((el, i) => {
      const img = el.querySelector('img')
      const thumb = doc.createElement('button')
      thumb.type = 'button'
      thumb.className = 'blie-gallery__thumb'
      thumb.setAttribute('aria-label', `第 ${i + 1} 张`)
      const thumbImg = doc.createElement('img')
      thumbImg.src = img ? (img.currentSrc || img.src) : ''
      thumbImg.alt = ''
      thumb.appendChild(thumbImg)
      thumb.addEventListener('click', () => apply(i))
      thumbs.appendChild(thumb)
      thumbEls.push(thumb)
    })

    ui.querySelector('.is-prev')!.addEventListener('click', () => apply(index - 1))
    ui.querySelector('.is-next')!.addEventListener('click', () => apply(index + 1))

    // 方向键切换。文档一换监听自然消失；分栏被拆掉时靠「还有没有 .blie-gallery」自我关掉。
    doc.addEventListener('keydown', (e) => {
      if (!pics.isConnected || !pics.querySelector('.blie-gallery')) return
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, textarea, [contenteditable]')) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        apply(index - 1)
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault()
        apply(index + 1)
      }
    }, true)
  }

  apply(0)
}

/**
 * 把详情页搬成两栏。返回本次用的是哪种布局：
 *   'media' —— 图片在左、正文+评论在右
 *   'text'  —— 正文在左、评论在右
 *   null    —— 还没渲染出来（调用方可以过一会儿再试）
 */
export function applyOpusSplit(doc: Document): 'media' | 'text' | null {
  const live = records.get(doc)
  if (live && live.split.isConnected) return live.split.classList.contains('is-media') ? 'media' : 'text'

  const card = doc.querySelector<HTMLElement>('#app .content > .card')
  const item = card?.querySelector<HTMLElement>('.bili-dyn-item')
  const tabs = card?.querySelector<HTMLElement>('.bili-tabs')
  if (!card || !item || !tabs) return null

  // 图片区块：只有真的挂了图才走「图片左 / 文字右」，视频卡 / 专栏 / 纯转发都算纯文字
  const pics = item.querySelector<HTMLElement>('.dyn-card-opus__pics')
  const n = pics ? countPics(pics) : 0
  const hasPics = n > 0

  const split = doc.createElement('div')
  split.className = hasPics ? 'blie-split is-media' : 'blie-split is-text'
  const left = doc.createElement('div')
  left.className = 'blie-split__left'
  const right = doc.createElement('div')
  right.className = 'blie-split__right'
  split.append(left, right)

  const record: SplitRecord = {
    split,
    item,
    itemAt: anchorOf(item),
    tabs,
    tabsAt: anchorOf(tabs),
    pics: null,
    picsAt: null,
  }

  if (hasPics && pics) {
    record.pics = pics
    record.picsAt = anchorOf(pics)
    // 图片列：一次一张 + 箭头 / 缩略图切换，见 setupGallery
    left.appendChild(pics)
    right.append(item, tabs)
    setupGallery(doc, pics)
  }
  else {
    left.appendChild(item)
    right.appendChild(tabs)
  }

  card.appendChild(split)
  doc.documentElement.classList.add(SPLIT_ON_CLASS)
  records.set(doc, record)
  return hasPics ? 'media' : 'text'
}

/** 拆回单栏（窗口变窄 / 关闭悬浮窗）。没分过栏就什么都不做。 */
export function resetOpusSplit(doc: Document) {
  const record = records.get(doc)
  doc.documentElement.classList.remove(SPLIT_ON_CLASS)
  if (!record) return

  // 先把图片放回正文里（正文那时还在右栏，位置无所谓，最后统一放回 .card）
  if (record.pics) {
    // 图库是我们建的，跟着回原页面会把箭头/缩略图带进原版相册
    record.pics.querySelector('.blie-gallery')?.remove()
    record.pics.classList.remove('is-tall')
    record.pics.querySelectorAll('.bili-album__preview__picture.is-active')
      .forEach(el => el.classList.remove('is-active'))
    if (record.picsAt)
      putBack(record.pics, record.picsAt)
  }
  putBack(record.item, record.itemAt)
  putBack(record.tabs, record.tabsAt)
  record.split.remove()
  records.delete(doc)
}

import { get, onConfigChange } from '../config'
import dynamicCss from './dynamic.css?inline'

/**
 * 动态页 · 入口收纳（界面优化 → 动态页优化）。
 *
 * 只做一件事：把右侧「社区中心」横幅和顶部「发动态」编辑器收成左栏用户卡片里的
 * 两个竖排按钮。**不动** B 站的三栏布局、动态流列数和卡片外观。
 *
 * 两个原入口不搬 DOM：只加 .bili-elite-dyn-hidden 隐藏，按钮点击时把事件代理到它 ——
 * B 站改结构时最多是代理失效，不会把节点搬丢。
 */

const STYLE_ID = 'bili-elite-dynamic-style'
const ROOT = 'bili-elite-dynamic-opt'
const HIDE = 'bili-elite-dyn-hidden'
const ACTIONS = 'bili-elite-dyn-actions'

const HOME_SELECTOR = '.bili-dyn-home--member, .bili-dyn-home--visitor'
/** 发动态编辑器：登录态才有，class 名带 publish */
const PUBLISH_SELECTOR = '[class*="bili-dyn-publish"]'
/** 右侧「社区中心」横幅：文字是图片，只能靠 class（实测 .bili-dyn-banner） */
const BANNER_SELECTOR = '.right .bili-dyn-banner'

let waitObserver: MutationObserver | null = null
let colObserver: MutationObserver | null = null
let actionsBox: HTMLElement | null = null
let hiddenEls: HTMLElement[] = []
let started = false

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = dynamicCss
  ;(document.head || document.documentElement).appendChild(style)
}

function hide(el: HTMLElement) {
  if (el.classList.contains(HIDE)) return
  el.classList.add(HIDE)
  hiddenEls.push(el)
}

/** 横幅外面还包着一层无 class 的 section，隐藏时要连它一起，否则会留 160px 空白 */
function bannerHost(): HTMLElement | null {
  const banner = document.querySelector<HTMLElement>(BANNER_SELECTOR)
  if (!banner) return null
  const host = banner.closest('section')
  return (host || banner) as HTMLElement
}

function openCommunity() {
  const target = document.querySelector<HTMLElement>('.right .bili-dyn-banner__img')
    || document.querySelector<HTMLElement>(BANNER_SELECTOR)
  target?.click()
}

function openPublish() {
  const box = document.querySelector<HTMLElement>(PUBLISH_SELECTOR)
  if (!box) return
  const target = box.querySelector<HTMLElement>('textarea, [contenteditable="true"]')
  ;(target || box).click()
}

function ensureActions() {
  if (actionsBox && actionsBox.isConnected) return

  const card = document.querySelector<HTMLElement>('.left > section')
  if (!card) return

  const box = document.createElement('div')
  box.className = ACTIONS
  box.innerHTML = `
    <button type="button" data-act="community">社区中心</button>
    <button type="button" data-act="publish">＋ 发动态</button>`
  box.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!btn) return
    e.stopPropagation()
    if (btn.dataset.act === 'community')
      openCommunity()
    else
      openPublish()
  })

  card.appendChild(box)
  actionsBox = box
}

function hideOriginals() {
  // 顶部「发动态」编辑器：搬成按钮后不再占版面
  const publish = document.querySelector<HTMLElement>(PUBLISH_SELECTOR)
  if (publish) hide(publish)
  // 右侧「社区中心」横幅（连它那层无 class 的 section 一起收掉）
  const banner = bannerHost()
  if (banner) hide(banner)
}

/** 左栏用户卡片、发动态编辑器、社区中心横幅都是异步渲染的：三列各自盯一下 */
function observeColumns() {
  colObserver?.disconnect()
  colObserver = new MutationObserver(() => {
    ensureActions()
    hideOriginals()
  })
  for (const sel of ['.left', 'main', '.right']) {
    const col = document.querySelector(sel)
    if (col) colObserver.observe(col, { childList: true })
  }
}

function sync() {
  ensureActions()
  hideOriginals()
  observeColumns()
}

function start() {
  if (started) return
  started = true

  if (document.querySelector(HOME_SELECTOR)) {
    sync()
    return
  }

  // 动态流是异步渲染的：等它出现再接线（15s 后放弃，避免在别的页面白等）
  waitObserver = new MutationObserver(() => {
    if (!document.querySelector(HOME_SELECTOR)) return
    waitObserver?.disconnect()
    waitObserver = null
    sync()
  })
  waitObserver.observe(document.documentElement, { childList: true, subtree: true })
  window.setTimeout(() => {
    waitObserver?.disconnect()
    waitObserver = null
  }, 15000)
}

function stop() {
  started = false
  waitObserver?.disconnect()
  waitObserver = null
  colObserver?.disconnect()
  colObserver = null

  actionsBox?.remove()
  actionsBox = null
  for (const el of hiddenEls) el.classList.remove(HIDE)
  hiddenEls = []
}

function apply() {
  const on = !!get('dynamicOptimize')
  // 默认关闭：没开过就别注入这份样式（t.bilibili.com 上的每条规则都只作用在我们的类上，
  // 注入本身无害，但省一次样式解析）
  if (on) ensureStyle()
  document.documentElement.classList.toggle(ROOT, on)
  if (on) start()
  else stop()
}

export function setupDynamicOptimize(): () => void {
  // 只在动态页干活（其它页面没有 .bili-dyn-home--*）
  if (location.hostname !== 't.bilibili.com') {
    return () => {}
  }
  apply()

  const off = onConfigChange((key) => {
    if (key === 'dynamicOptimize') apply()
  })

  return () => {
    off()
    document.documentElement.classList.remove(ROOT)
    stop()
    document.getElementById(STYLE_ID)?.remove()
  }
}

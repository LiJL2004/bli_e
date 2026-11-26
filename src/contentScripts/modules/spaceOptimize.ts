/**
 * 空间页优化（1.2.5 v034）：把个人空间（space.bilibili.com）的三类控件换成
 * 设置面板同一套 Google 观感 —— 侧边分类、排序 / 筛选胶囊、「播放全部」。
 *
 * 样式本体在 spaceOptimize.css；这里只做三件事：
 *   1. 尽早注入样式（document_start，避免先看到 B 站原版再跳一下）；
 *   2. 按开关切 `<html>` 上的 root 类（关掉 = 一个字节都不改）；
 *   3. 给这三类控件装涟漪（与面板 / 搜索页同一套 installRipple）。
 *
 * **v032 改过顶部导航 tab，v033 已回退**：那处 B 站自己的布局太紧（导航指示条
 * .nav-tab-cursor 的 left / width 由 B 站 JS 写，字号 / 内边距一动就和文字错位）。
 * 别再改回去。
 */
import { get, onConfigChange } from '../config'
import { installRipple } from './ripple'
import spaceOptimizeCss from './spaceOptimize.css?inline'

const HOST = 'space.bilibili.com'
/** root 类：所有规则都挂在它下面 */
const ROOT = 'bili-elite-space'
const STYLE_ID = 'bili-elite-space-style'
/** 侧边分类、排序胶囊、「播放全部」——空间页里这三类独立摆放的控件 */
const RIPPLE_TARGETS = '.side-nav__item, .radio-filter__item, .playall-btn'

let offRipple: (() => void) | null = null

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID))
    return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = spaceOptimizeCss
  // document_start 时 <head> 可能还没解析出来，退到 <html> 上也能生效
  ;(document.head || document.documentElement).appendChild(style)
}

export function setupSpaceOptimize(): () => void {
  if (location.hostname !== HOST)
    return () => {}

  ensureStyle()

  const apply = (on: boolean) => {
    document.documentElement.classList.toggle(ROOT, on)
    if (on && !offRipple)
      offRipple = installRipple(document, RIPPLE_TARGETS)
    else if (!on && offRipple) {
      offRipple()
      offRipple = null
    }
  }

  apply(!!get('spaceOptimize'))

  const off = onConfigChange((key) => {
    if (key === 'spaceOptimize')
      apply(!!get(key))
  })

  return () => {
    off()
    apply(false)
    document.getElementById(STYLE_ID)?.remove()
  }
}

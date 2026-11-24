/**
 * 两个「整页级」动作：刷新 / 回到顶部。
 *
 * 单独抽一份是因为有两个调用方 —— 右下角那列操作浮钮（floatingButtons.ts）和
 * 键盘快捷键（quickKeys.ts）。两份实现迟早会漂移：改了一边忘了另一边，表现就是
 * 「点按钮会保留滚动位置、按快捷键却整页重载」。
 */

/** 首页（`/` 或 `/index.html`）—— 只有这里 B 站自己提供了「只刷推荐流」的按钮 */
function isHomePage() {
  return location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname)
}

/**
 * 刷新当前页。
 *
 * 首页优先复用 B 站自己的「刷新内容」：它只重取推荐流、不重载整页（实测：按一下发一次
 * `wbi/index/top/feed/rcmd`，URL 与文档实例都不变）。**但滚动位置保不住** —— 推荐流是
 * 整块替换的，换完之后 B 站自己就把位置夹回顶部了，这也是它那个按钮原本的行为。
 * **必须点内层的 `.flexible-roll-btn-inner`**：外层 `.flexible-roll-btn` 上没有处理器，
 * 点它等于什么都没发生（实测：点内层会发请求，点外层零请求）。
 * 节点被「原生刷新按钮屏蔽」藏成 display:none 不影响 click() 派发，事件照常进它自己的处理器。
 *
 * 其它页面没有这个按钮，只能整页重载 —— 视频页会因此丢掉播放进度，这是「刷新」的固有代价，
 * 面板里的说明写清楚了。
 */
export function refreshPage() {
  if (isHomePage()) {
    const nativeInner = document.querySelector<HTMLElement>('.flexible-roll-btn.refresh .flexible-roll-btn-inner')
    if (nativeInner) {
      nativeInner.click()
      return
    }
  }
  location.reload()
}

/**
 * 平滑回到页面顶部。
 *
 * 系统开了「减少动态效果」时直接跳 —— `scroll-behavior: smooth` 不会自己降级，
 * 对前庭敏感的人来说那段滚动很难受。
 */
export function scrollToTop() {
  let reduce = false
  try {
    reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  }
  catch { /* 极老浏览器没有 matchMedia */ }
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

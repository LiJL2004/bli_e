import adBlockCss from './adBlock.css?inline'

/**
 * 广告卡屏蔽 —— **默认生效，设置面板里没有开关**。
 *
 * 只干一件事：把 `adBlock.css` 注入到文档里。规则本身是纯 CSS（`:has()` + 类名），
 * 不需要观察器：B 站的运营推荐卡是 Vue 渲染进推荐流的，样式一注入就即时生效，
 * 之后每次重新插入也一样命中。
 *
 * 为什么不在 videoBeta 里做：那是「界面优化」里的布局开关，关掉就整页退回原版；
 * 广告卡跟布局无关，任何模式下都该屏蔽掉。所以它独立成一个模块、无条件注入。
 *
 * 注入时机放在 document_start（index.ts 里紧跟设计 token 之后）：右栏的卡片是
 * 水合之后才渲染的，样式先就位，卡片画出来时就已经是隐藏状态，不会先闪一下再消失。
 */

const STYLE_ID = 'bili-elite-adblock-style'

function ensureStyle() {
  if (document.getElementById(STYLE_ID))
    return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = adBlockCss
  // document_start 时 <head> 可能还没解析出来，退到 <html> 上也能生效
  ;(document.head || document.documentElement).appendChild(style)
}

export function setupAdBlock(): () => void {
  ensureStyle()
  return () => document.getElementById(STYLE_ID)?.remove()
}

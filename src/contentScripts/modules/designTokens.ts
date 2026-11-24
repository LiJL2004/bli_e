import tokensCss from './designTokens.css?inline'

const STYLE_ID = 'bili-elite-design-tokens'

/**
 * 注入设计 token（动效三档 + 两条曲线、圆角三档，定义见 designTokens.css），
 * 以及全站的「减少动态效果」降级规则。
 *
 * 必须最先调用：后面所有样式表都从这几个变量取值，晚一步就会先按「无过渡」渲染一帧。
 * 也不能并进别的样式表 —— topbar.css 在个人空间 / 历史 / 直播站整块不注入，
 * 而那些页面上的设置面板、浮动键照样要动。
 */
export function injectDesignTokens() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = tokensCss
  ;(document.head || document.documentElement).appendChild(style)
}

/**
 * 系统是否要求「减少动态效果」。
 * 这类用户对大面积位移 / 缩放敏感（会晕），JS 侧那几段 WAAPI 动画（图片 FLIP、全屏开合）
 * 拿到 true 就直接跳过，不要只把时长调短 —— 位移本身才是问题。
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

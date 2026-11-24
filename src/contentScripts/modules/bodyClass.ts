/**
 * `<body>` 的 class 变化：全页只挂**一个** MutationObserver，订阅者共享。
 *
 * 为什么单独一个模块：进 / 出网页全屏、原生全屏这几件事都靠 body 的类名判断，
 * 而 videoLayer、videoFullscreen、playerMode 三个模块原来各挂了一个
 * `MutationObserver(body, { attributeFilter: ['class'] })` —— 每次 body 改类名
 * 三个回调依次跑一遍，还要各自 `classList.contains`。B 站给 body 改类名很频繁
 * （滚动锁、夜间、播放器状态都会动），合并成一个观察器再分发，成本就只剩一次。
 *
 * 订阅者自己判断「这次变化跟我有没有关系」，这里不做任何过滤 —— 过滤器写在这里
 * 迟早会漏掉某个订阅者需要的类名。
 */

type Listener = () => void

const listeners = new Set<Listener>()
let observer: MutationObserver | null = null

/** 订阅 body 的 class 变化；返回退订函数（最后一个退订时观察器一起断开） */
export function onBodyClassChange(cb: Listener): () => void {
  if (!observer) {
    observer = new MutationObserver(() => {
      listeners.forEach((fn) => {
        try {
          fn()
        }
        catch { /* 单个订阅者出错不影响其它人 */ }
      })
    })
    observeBody(observer, { attributes: true, attributeFilter: ['class'] })
  }
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      observer?.disconnect()
      observer = null
    }
  }
}

/**
 * 把观察器挂到 `<body>` 上 —— **document_start 时 `<body>` 还不存在**（只有 documentElement）。
 * 直接 observe 会抛「parameter 1 is not of type 'Node'」，而这个异常会把调用方整段初始化
 * 打断（监听器加不上、后面的代码也一起没了），表现就是「网页全屏时浮动键不隐藏」这类
 * 依赖 body 类名的功能静默失效。这里等 body 解析出来再挂，最多等 2s。
 */
export function observeBody(mo: MutationObserver, init: MutationObserverInit, tries = 0) {
  if (document.body) {
    mo.observe(document.body, init)
    return
  }
  if (tries > 100) return
  window.setTimeout(() => observeBody(mo, init, tries + 1), 20)
}

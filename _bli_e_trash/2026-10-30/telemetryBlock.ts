/**
 * 掐掉 B 站自己的埋点上报（`data.bilibili.com/log/web`）。
 *
 * **为什么值得做**（2026-10-30 在真实 Chrome 里数出来的，都是打开一次页面就发生的）：
 *
 *   | 页面 | 总请求 | 其中 data.bilibili.com/log |
 *   | --- | --- | --- |
 *   | 播放页 | 204 | **59**（29%） |
 *   | 首页 | 177 | **29**（16%） |
 *
 * 它们全是纯上报（埋点 / 曝光 / 心跳里的行为事件），页面不读回包、也不等它。
 * 但每一个都要走一遍请求构造 → 排队 → 响应 → 回调，而首屏那 1s 里主线程本来就被
 * B 站自己的水合占满 —— 少 59 个请求是实打实的负载下降，功能上一个字节都不少。
 *
 * **只认 `data.bilibili.com` 且路径里有 `/log/` 的**，其它一律原样透传。
 * 特别注意别误伤这两个（它们长得像上报、其实是功能）：
 *   · `api.bilibili.com/x/click-interface/web/heartbeat` —— 播放心跳，观看进度 / 历史靠它；
 *   · `api.bilibili.com/x/click-interface/click/web/h5` —— 播放计数。
 * 所以判据写死成「域名 + /log/」，不要图省事按 `log` 关键字全网匹配。
 *
 * **为什么必须注入页面世界**：内容脚本跑在隔离世界里，`navigator.sendBeacon` / `fetch` /
 * `XMLHttpRequest` 都是另一个副本，改它不影响页面自己的调用。所以这里往文档里塞一段
 * inline `<script>`（document_start 时页面脚本还没跑，能抢在前面）。
 * 万一哪天 B 站加了 CSP 挡住 inline 脚本，这段就静默失效 —— 只是回到「上报照发」，
 * 不会报错、不会影响任何功能，这也是选这条路而不是加 `declarativeNetRequest` 权限的原因
 * （商店对「不必要的权限」是直接拒的，见 manifest.ts 里 permissions 的注释）。
 */

/** 埋点域名 + 路径特征：两个都命中才拦 */
const LOG_HOST = 'data.bilibili.com'
const LOG_PATH = '/log/'

/**
 * 注入页面的补丁。**刻意写成 ES5 + 全程 try/catch**：它在页面世界、抢在所有页面脚本之前跑，
 * 一旦抛错就等于给整站埋了个雷。每个 API 各自 try，某个不存在（老内核 / 被别的东西占了）
 * 就跳过那一个，不影响另外两个。
 *
 * 三个通道都要堵：实测同一批埋点里 beacon 35 个、XHR 18 个、fetch 6 个 —— 只堵 beacon
 * 等于没堵。
 */
const PATCH = `(function () {
  var HOST = '${LOG_HOST}', PATH = '${LOG_PATH}'
  function hit(u) {
    if (!u) return false
    var s = typeof u === 'string' ? u : (u && u.url) || ''
    return s.indexOf(HOST) > -1 && s.indexOf(PATH) > -1
  }
  try {
    var beacon = navigator.sendBeacon
    if (beacon) {
      navigator.sendBeacon = function (url) {
        // 返回 true = 「已排队」，调用方不会重试也不会报错
        return hit(url) ? true : beacon.apply(navigator, arguments)
      }
    }
  } catch (e) {}
  try {
    var rawFetch = window.fetch
    if (rawFetch) {
      window.fetch = function (input, init) {
        // 给一个 200 + 空 JSON：万一调用方读了 body 也不会炸（埋点 SDK 大多只看 ok）
        if (hit(input))
          return Promise.resolve(new Response('{"code":0}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
        return rawFetch.apply(this, arguments)
      }
    }
  } catch (e) {}
  try {
    var rawOpen = XMLHttpRequest.prototype.open
    var rawSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url) {
      // 记在实例上，send 时才知道该不该真的发
      this.__blieLog = hit(url)
      return rawOpen.apply(this, arguments)
    }
    XMLHttpRequest.prototype.send = function () {
      if (this.__blieLog) return
      return rawSend.apply(this, arguments)
    }
  } catch (e) {}
})();`

/**
 * 装补丁。必须在 `document_start` 的最前面调用 —— 晚于页面脚本就抢不到那几个 API。
 *
 * 节点插进 `documentElement` 而不是 `head`：document_start 时 `<head>` 还不一定存在。
 * 执行完立刻摘掉，别在 DOM 里留垃圾（B 站的 SSR 树我们一贯不碰，插完即删）。
 */
export function setupTelemetryBlock() {
  try {
    const script = document.createElement('script')
    script.textContent = PATCH
    ;(document.head || document.documentElement).appendChild(script)
    script.remove()
  }
  catch {
    // 注入失败（CSP / 极端时序）：当作没这回事，不影响任何功能
  }
}

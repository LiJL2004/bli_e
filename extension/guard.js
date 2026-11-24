/**
 * 页面世界的「请求闸门」—— 掐掉 B 站的埋点与广告投放请求。
 *
 * **为什么这个文件是手写在 `extension/` 里、不走构建**：
 * 它必须跑在**页面世界**（MAIN world）才有效。内容脚本跑在隔离世界，`navigator.sendBeacon`
 * / `fetch` / `XMLHttpRequest` 都是另一份副本，改它不影响页面自己的调用。而往页面里塞
 * 一段 inline `<script>` 会被**扩展自己的 CSP**（`script-src 'self'`）挡掉 —— 实测控制台报
 * `Executing inline script violates the following Content Security Policy directive`，
 * 补丁一次都没装上。所以只能靠 manifest 里 `"world": "MAIN"` 的独立 content script 条目，
 * 而 MAIN world 的脚本不能调用 `chrome.*`，也就没法用构建产物那套（那个 bundle 一进来就
 * 访问 chrome.storage）。它是一个自包含的小文件，手写在这里、由 `pack-edge.mjs` 原样带走
 * （`pnpm clear` 只删 `extension/dist` 和 `extension/manifest.json`，不会碰它）。
 *
 * **拦什么**（判据写死成「主机名 + 路径」，不做关键字泛匹配，免得误伤）：
 *   1. `data.bilibili.com/log/*`  —— 埋点上报。实测播放页一次打开 59 个请求、首页 29 个
 *      （占全部请求的 16~29%），全是纯上报，页面不读回包。
 *   2. `cm.bilibili.com/*`       —— 广告投放与计费（`cm/api/receive/content/pc` 取广告内容、
 *      `cm/api/fees/pc` 计费上报）。我们本来就 CSS 藏了所有广告位，内容根本用不到。
 *   3. `api.bilibili.com/x/vip/ads/*` —— 大会员广告素材。
 *
 * **千万别碰这两个**（长得像上报、其实是功能）：
 *   `x/click-interface/web/heartbeat`（播放心跳，观看进度 / 历史靠它）、
 *   `x/click-interface/click/web/h5`（播放计数）。
 *
 * **为什么不是「让请求失败」而是「给一个假的成功响应」**：
 * 直接让请求报错，B 站那边的代码可能停在 `loading` 状态 —— 广告位的骨架 / 空槽就是这么来的。
 * 这里统一回一个**它本来就会处理的分支**：
 *   · 埋点：`{"code":0}`（上报 SDK 不看 body）；
 *   · 广告：`{"code":-400,"message":"no ad"}` —— 就是「这个位置没有广告」时广告平台给的东西，
 *     B 站对这条分支是天天在走的（广告有频次控制、经常空），不会留空槽。
 *
 * XHR 用 `blob:` URL 重定向而不是伪造 `readyState`：blob 是同源的，原生事件流、status、
 * responseText 全都正常走一遍，比自己 defineProperty + 手动 dispatch 稳得多。
 * **但 blob 只认 GET** —— 实测 `open('POST', blobUrl)` 直接走 onerror（广告接口正好都是 POST），
 * 所以重定向时把 method 一并改成 GET（`send(body)` 对 GET 是忽略的，不会报错）。
 * blob URL **故意不 revoke**：请求还在飞的时候 revoke 会把这次请求掐成 error，而一个页面
 * 生命周期里也就几十个、每个几十字节，随文档卸载一起回收，不值得为它引入时序风险。
 */
(function () {
  'use strict'

  var w = window
  if (w.__blieGuard) return
  w.__blieGuard = true

  var LOG_BODY = '{"code":0}'
  var AD_BODY = '{"code":-400,"message":"no ad"}'

  /** 主机名 + 路径片段 → 假响应体。路径片段为空串表示「该主机下全拦」。 */
  var RULES = [
    ['data.bilibili.com', '/log/', LOG_BODY],
    ['cm.bilibili.com', '', AD_BODY],
    ['api.bilibili.com', '/x/vip/ads/', AD_BODY],
    // 播放器的「播放质量上报」（pbp = playback performance）。纯上报，播放不读回包。
    ['bvc.bilivideo.com', '/pbp/', LOG_BODY]
  ]

  /** 只从 URL 里取「主机 + 路径」，不看 query（query 里出现别的域名不算命中） */
  function parse(u) {
    if (!u) return null
    var s = typeof u === 'string' ? u : (u && u.url) || ''
    var m = /^(?:https?:)?\/\/([^/?#]*)([^?#]*)/i.exec(s)
    if (!m) return null
    return { host: m[1].toLowerCase(), path: m[2] || '/' }
  }

  /** 命中就返回要伪造的响应体，否则 null */
  function hit(u) {
    var p = parse(u)
    if (!p) return null
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i]
      if (p.host !== r[0]) continue
      if (r[1] && p.path.indexOf(r[1]) === -1) continue
      return r[2]
    }
    return null
  }

  /**
   * 这张图是不是「首页优化把它藏起来了」的那块。
   *
   * 判据三道一起卡，尽量别误伤：
   *   1. 必须在 www.bilibili.com 的首页（`/bfs/vc/` 只在首页出现，但别赌）；
   *   2. 「首页优化」开着（`html.bili-elite-home-only`，由 topbarOptimize 挂）；
   *   3. 地址里带 `/bfs/vc/`（banner 动画图层的路径）。
   *
   * 关掉首页优化会整页重载（topbarOptimize 的 applyHomeOnly），所以第 2 条一旦不成立，
   * 页面就是全新加载的，这些图会正常拉。
   */
  function isHiddenHomeImage(u) {
    var s = typeof u === 'string' ? u : (u && u.url) || ''
    if (!s || s.indexOf('/bfs/vc/') === -1) return false
    if (location.hostname !== 'www.bilibili.com') return false
    if (location.pathname !== '/' && location.pathname !== '/index.html') return false
    return document.documentElement.classList.contains('bili-elite-home-only')
  }

  /* 1) sendBeacon：返回 true = 已排队，调用方不会重试也不会报错 */
  try {
    var rawBeacon = navigator.sendBeacon
    if (rawBeacon) {
      navigator.sendBeacon = function (url) {
        return hit(url) ? true : rawBeacon.apply(navigator, arguments)
      }
    }
  }
  catch (e) {}

  /* 2) fetch：回一个 200 + JSON，body 是上面那两句 */
  try {
    var rawFetch = w.fetch
    if (rawFetch) {
      w.fetch = function (input, init) {
        var body = hit(input)
        if (body === null) return rawFetch.apply(this, arguments)
        return Promise.resolve(new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
    }
  }
  catch (e) {}

  /* 3) XHR：把 URL 换成本地 blob，原生走完一遍（同源，不报错） */
  try {
    var rawOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      var body = hit(url)
      var args = Array.prototype.slice.call(arguments)
      if (body !== null) {
        try {
          args[0] = 'GET' // blob 只支持 GET，POST 会直接 onerror
          args[1] = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
        }
        catch (e) {
          // 建不出 blob（极老内核 / 被别的脚本改过）→ 这一条原样放行，别把请求搞坏
          args[0] = method
          args[1] = url
        }
      }
      return rawOpen.apply(this, args)
    }
  }
  catch (e) {}

  /* 4) 首页 header 大 banner 的动画图层（28 张 `/bfs/vc/*`）。
   *
   * 那 28 张图是 laputa-home 那个 Vue 应用建出来的（实测 bundle 里 `setAttribute("src"`
   * 出现 0 次、`.src=` 出现 24 次），所以换掉 `HTMLImageElement.prototype.src` 的 setter
   * 就能在请求发出**之前**把地址换成 1×1 透明图 —— 网络里根本不会有这 28 个请求
   * （每个实测 7.3KB，合计约 200KB）。
   *
   * **只在「首页优化」开着时跳过**：那一刻 `.bili-header__banner` 被 CSS 藏了
   * （topbar.css §1），图本来就看不着。关掉「首页优化」时 topbarOptimize.ts 会
   * `location.reload()` 整页重载，所以永远不会出现「banner 回来了、图层图却是空的」碎图。
   *
   * 为什么只拦这一块：轮播（`.recommended-swipe`）和大 banner 底图是 **SSR 在 HTML 里**的
   * `<img src>`，浏览器解析到就发请求，任何 JS 都够不着（`display:none` /
   * `content-visibility` 都不阻止图片下载）。
   */
  try {
    var SRC_DESC = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    if (SRC_DESC && SRC_DESC.set) {
      var BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: SRC_DESC.enumerable,
        get: SRC_DESC.get,
        set: function (v) {
          if (isHiddenHomeImage(v)) return SRC_DESC.set.call(this, BLANK_IMG)
          return SRC_DESC.set.call(this, v)
        }
      })
    }
  }
  catch (e) {}

  /* 5) 把播放页封面地址镜像到 DOM 上 —— 给隔离世界的内容脚本用（1.2.0 v011）。
   *
   * 播放页首帧前是**纯黑**（B 站不做 poster，`.bpx-player-video-poster` 是空元素 0×0），
   * videoBeta 要拿封面顶上，而封面地址只在页面世界的 `__INITIAL_STATE__.videoData.pic` 里。
   * 内容脚本跑在隔离世界：DOM 共享、JS 全局不共享，`window.__INITIAL_STATE__` 那边读不到；
   * 而 DOM 里也**没有**那个内联状态脚本（实测 `document.scripts` 里 0 个含 `"videoData"`，
   * 状态是外部脚本赋上去的），所以只能从这边（MAIN world）取一次、写到属性上。
   *
   * 写 `<html data-blie-pic>` 而不是别的通道：属性跨世界可见；这个属性不参与任何选择器，
   * 写它不会让样式失效（写 CSS 变量才会，见 videoBeta 里「写变量后别紧接读几何」那条）。
   * 每 50ms 看一次、最多 6s：状态在首屏 HTML 里就有，实测 ~600ms 就能读到。
   */
  try {
    var picTries = 0
    var picTimer = setInterval(function () {
      picTries++
      var st = w.__INITIAL_STATE__
      var pic = st && st.videoData && st.videoData.pic
      if (typeof pic === 'string' && pic && document.documentElement) {
        clearInterval(picTimer)
        document.documentElement.setAttribute('data-blie-pic', pic)
        return
      }
      if (picTries > 120)
        clearInterval(picTimer)
    }, 50)
  }
  catch (e) {}

  /* 6) 编码偏好的收尾（1.2.3 v011：「4K 流畅加速」已删除）
   *
   * v004~v010 那个开关会把 B 站自己的 `bilibili_player_codec_prefer_type` 改成 `1`（HEVC），
   * 原值存在 `bili-elite-codec-prev`。功能删了，但用户机器上的键还在 —— 不还回去，
   * 他就永远停在 HEVC（码率只有 AVC 的 38%，画质更低），而面板里已经没有任何开关能改回来。
   * 所以这里只做一件事：**发现是我们改的，就还原**，然后把三个键清干净。
   * 没改过（没有 `-prev`）就什么都不做 —— 用户自己在播放器里选的编码不碰。
   */
  try {
    var CODEC_KEY = 'bilibili_player_codec_prefer_type'
    var CODEC_PREV = 'bili-elite-codec-prev'
    var prevCodec = localStorage.getItem(CODEC_PREV)
    if (prevCodec !== null) {
      if (prevCodec === '')
        localStorage.removeItem(CODEC_KEY)
      else
        localStorage.setItem(CODEC_KEY, prevCodec)
      localStorage.removeItem(CODEC_PREV)
    }
    localStorage.removeItem('bili-elite-codec')
  }
  catch (e) {}

  /* 7) 播放页节点：当前节点 + 手动切换 + 节点测速（1.2.5 v020 重做）
   *
   * **这一节现在只做两件事**：
   *   1. 记下「这一页实际在用的 CDN 节点」，给设置面板的「当前节点」看；
   *   2. 用户在「节点测速」列表里点了某个节点 → 把**这一页后续的视频分片请求**换到
   *      那个主机上，**只对当前这个视频、这一次播放生效**（换视频 / 关标签页即失效）。
   *
   * **1.2.5 v020 按要求删掉的**（原来的「播放节点优选」）：
   *   · 设置里的 `cdnBoost` 开关和它的镜像键 `bili-elite-cdn`；
   *   · 长期节点表 `bili-elite-cdn-rank` / `-rank-ts`（跨视频记住每个节点多快）；
   *   · 打开播放页时按分数 / 长期表**自动重排 baseUrl**（自动分支、40% 门槛、
   *     起播后台测速），以及节点表的「重测全部节点 / 节点管理 / 删除」和它们的
   *     签名地址存档。
   * 所以打开视频**不再测速、不再改流**：一字节探测流量都不花，节点怎么用完全由用户点。
   *
   * **为什么手动选择放 sessionStorage**：sessionStorage 每个标签页一份，天然就是
   * 「这一次播放」的粒度；再带一个 `page` 字段，站内切视频（pathname 变了）自动不认。
   * 旧的 `bili-elite-cdn-force` 是 localStorage（跨视频、跨会话都生效），语义正好相反，
   * 装上时直接清掉。
   *
   * **为什么改写挂在 XHR / fetch 的 open 上**：播放器的分片是逐段发的，在请求这一层
   * 换主机，用户点完列表**下一段就换过去了**，不用刷新（刷新反而把这次播放打断）。
   *
   * 签名与主机无关：同一串 query 换到另一个 upos 主机上仍然是 206（实测）。
   */
  try {
    // **无条件装上**：即使不选节点，也要把「当前播放实际用的节点」记下来给面板看。
    installCdnPick()
  }
  catch (e) {}

  function installCdnPick() {
    var HOSTS = 'bili-elite-cdn-hosts'
    var SCORES = 'bili-elite-cdn-scores'
    var APPLIED = 'bili-elite-cdn-applied'
    var STATE = 'bili-elite-cdn-probe-state'
    var PICK = 'bili-elite-cdn-pick'
    var PROBE_EVT = 'bili-elite-cdn-probe'
    var PICK_EVT = 'bili-elite-cdn-picked'
    var PROBE_BYTES = 131072

    /* 老版本留下的键：长期节点表、全局手动指定、开关镜像、重测次数 / 参考地址 ——
     * 功能已经删了，留着只占地方（排查时还会误导）。装上就清一次，之后是空操作。
     * 顺带清掉早期写在 localStorage 的四个「每页」键（现在只在 sessionStorage）。 */
    try {
      var legacy = ['bili-elite-cdn-rank', 'bili-elite-cdn-rank-ts', 'bili-elite-cdn-force',
        'bili-elite-cdn', 'bili-elite-cdn-retest-times', 'bili-elite-cdn-retest-ref',
        SCORES, HOSTS, APPLIED, STATE]
      for (var li = 0; li < legacy.length; li++) {
        // 只在真有值时才写一次：空转的 removeItem 会白给同源标签页发 storage 事件
        if (localStorage.getItem(legacy[li]) !== null) localStorage.removeItem(legacy[li])
      }
    }
    catch (e) {}

    function readTab(key) {
      try {
        var raw = JSON.parse(sessionStorage.getItem(key) || 'null')
        return raw && typeof raw === 'object' ? raw : null
      }
      catch (e) { return null }
    }

    function writeTab(key, v) {
      try { sessionStorage.setItem(key, JSON.stringify(v)) } catch (e) {}
    }

    /** 自己发的测速请求要跳过「记录当前节点」那个钩子 */
    var probing = 0
    var lastHost = ''
    var lastPage = ''
    /** `readPick()` 的缓存：每个分片请求都要问一次，不能每次都 JSON.parse。
     *  `page` 对不上就返回空 —— 站内切视频后自动失效，不需要监听路由。 */
    var pickCache = null

    /** 只认 B 站的媒体分片（`/upgcxcode/`），别的请求一概不碰 */
    function isMedia(u) {
      return typeof u === 'string' && u.indexOf('/upgcxcode/') !== -1
    }

    /** 是不是「播放页」——**测速与换节点只在这些页面上做**。
     *  站内切回首页 / 搜索页时 `window.__playinfo__` 还留着上一个视频的对象，光靠
     *  `currentTarget()` 拦不住：在首页点「开始测速」会真的去测那个旧视频的节点。
     *  **判定必须和 `src/contentScripts/modules/cdnBoost.ts` 的 `isCdnPlayPage()` 一致。** */
    function isPlayPage() {
      var p = location.pathname
      return p.indexOf('/video/') !== -1
        || p.indexOf('/bangumi/play/') !== -1
        || p.indexOf('/medialist/play/') !== -1
        || p.indexOf('/cheese/play/') !== -1
        || p.indexOf('/list/') === 0
    }

    function hostOf(u) {
      var m = /^https?:\/\/([^/?#]+)/.exec(typeof u === 'string' ? u : '')
      return m ? m[1] : ''
    }

    /** 只认 B 站自己的 CDN 镜像。playinfo 里还混着 P2P（`*.mcdn.bilivideo.cn:8082`、
     *  `*.edge.mountaintoys.cn` 之类），那些不是「节点快慢」而是打洞成没成功。 */
    function isCdnHost(h) {
      return /\.bilivideo\.com$/.test(h) || /\.akamaized\.net$/.test(h)
    }

    function swapHost(u, host) {
      return u.replace(/^https?:\/\/[^/?#]+/, 'https://' + host)
    }

    /** 这一页手动选的节点（空串 = 用 B 站给的默认节点）。
     *  只看 sessionStorage，并且要求 `page` 与当前地址一致 —— 这就是「只对这个视频」的
     *  全部实现：换个视频 pathname 变了，读出来就是空。 */
    function readPick() {
      if (!pickCache) {
        var p = readTab(PICK)
        pickCache = { page: (p && p.page) || '', host: (p && p.host) || '' }
      }
      if (pickCache.page !== location.pathname) return ''
      return isCdnHost(pickCache.host) ? pickCache.host : ''
    }

    function videoStreams() {
      var d = w.__playinfo__ && w.__playinfo__.data
      var v = d && d.dash && d.dash.video
      return v && v.length ? v : null
    }

    /** 测速/换节点都盯着**同一条流**：AVC、清晰度最高。
     *  没有 AVC（少数稿件只转码了 HEVC/AV1）→ 退回清晰度最高的那条。 */
    function targetStream() {
      var list = videoStreams()
      if (!list) return null
      var best = null
      for (var i = 0; i < list.length; i++) {
        var it = list[i]
        if (!it || !isMedia(it.baseUrl)) continue
        if (it.codecid !== 7) continue
        if (!best || it.id > best.id) best = it
      }
      if (best) return best
      for (var j = 0; j < list.length; j++) {
        var o = list[j]
        if (!o || !isMedia(o.baseUrl)) continue
        if (!best || o.id > best.id) best = o
      }
      return best
    }

    function urlsOf(stream) {
      return [stream.baseUrl].concat(stream.backupUrl || [])
    }

    /** 当前这一页真正要测的那条流。
     *  **站内切视频时 `__playinfo__` 不会更新**（B 站走 XHR 重拉 playurl），所以优先用
     *  刚截下来的 playurl 结果（`bili-elite-cdn-hosts`，带 page），没有才退回 playinfo。 */
    function currentTarget() {
      var h = readTab(HOSTS)
      if (h && h.page === location.pathname && h.urls && Object.keys(h.urls).length)
        return { quality: h.quality, codecid: h.codecid, bw: h.bw, dur: h.dur, urls: h.urls }

      var st = targetStream()
      if (!st) return null
      var urls = {}
      var all = urlsOf(st)
      for (var i = 0; i < all.length; i++) {
        var hh = hostOf(all[i])
        // **不过滤 P2P**：dash 里除了 CDN 镜像还有 P2P 主机，播放器有时真的就在用它们。
        // 列表要「当前视频的全部节点」，过滤掉就会出现「当前节点不在列表里」。
        if (hh && !urls[hh] && isMedia(all[i])) urls[hh] = all[i]
      }
      var d = w.__playinfo__ && w.__playinfo__.data
      return {
        quality: st.id,
        codecid: st.codecid,
        bw: st.bandwidth,
        dur: (d && d.dash && d.dash.duration) || 0,
        urls: urls
      }
    }

    /** 从 playurl 的响应里截出「AVC 最高清晰度」那条流的全部节点地址。
     *  SPA 切视频只有这条路能拿到新视频的节点列表 —— `__playinfo__` 是首屏 SSR 的，不会变。 */
    function capturePlayurl(text) {
      if (!text || text.length < 32) return
      var j = JSON.parse(text)
      var d = j && j.data
      var list = d && d.dash && d.dash.video
      if (!list || !list.length) return

      var best = null
      for (var i = 0; i < list.length; i++) {
        var it = list[i]
        if (!it || !isMedia(it.baseUrl) || it.codecid !== 7) continue
        if (!best || it.id > best.id) best = it
      }
      if (!best) {
        for (var j2 = 0; j2 < list.length; j2++) {
          var o = list[j2]
          if (!o || !isMedia(o.baseUrl)) continue
          if (!best || o.id > best.id) best = o
        }
      }
      if (!best) return

      var urls = {}
      var all = urlsOf(best)
      for (var k = 0; k < all.length; k++) {
        var h = hostOf(all[k])
        // 同上：不过滤 P2P，列表要的是「这条流的全部节点」
        if (h && !urls[h]) urls[h] = all[k]
      }
      if (!Object.keys(urls).length) return

      writeTab(HOSTS, {
        ts: Date.now(),
        page: location.pathname,
        quality: best.id,
        codecid: best.codecid,
        bw: best.bandwidth,
        dur: (d.dash && d.dash.duration) || 0,
        urls: urls
      })
    }

    /** 首屏 SSR 的 `__playinfo__` 里也有完整节点列表 —— 写一份给设置面板。
     *  **不写的话**：首屏没有 playurl 请求，`HOSTS` 是空的，面板就只能列出「当前节点」一个。
     *  SPA 切视频时 playinfo 不会更新，那条路仍由 `capturePlayurl` 负责。 */
    function capturePlayinfo() {
      var st = targetStream()
      if (!st) return
      var old = readTab(HOSTS)
      // 已经有这一页的记录（playurl 截的更新）就别覆盖
      if (old && old.page === location.pathname && old.urls && Object.keys(old.urls).length) return

      var urls = {}
      var all = urlsOf(st)
      for (var i = 0; i < all.length; i++) {
        var h = hostOf(all[i])
        if (h && !urls[h] && isMedia(all[i])) urls[h] = all[i]
      }
      if (!Object.keys(urls).length) return
      var d = w.__playinfo__ && w.__playinfo__.data
      writeTab(HOSTS, {
        ts: Date.now(),
        page: location.pathname,
        quality: st.id,
        codecid: st.codecid,
        bw: st.bandwidth,
        dur: (d && d.dash && d.dash.duration) || 0,
        urls: urls
      })
    }

    /** 按「这一页手动选的节点」重排每条流的 baseUrl。
     *  **不做任何自动挑选**（v020 删掉）：没选就原样不动。
     *  选中的主机不在这个视频的节点列表里（换清晰度后 B 站换了一批）就不动，
     *  由 `noteApplied` 如实记下「实际用的还是哪个」，面板据此说清楚。 */
    function applyPick() {
      var host = readPick()
      var list = videoStreams()
      if (!list) return
      var changed = 0

      if (host) {
        for (var i = 0; i < list.length; i++) {
          var it = list[i]
          if (!it || !isMedia(it.baseUrl)) continue
          var all = urlsOf(it)
          var best = null
          for (var f = 0; f < all.length; f++) {
            if (hostOf(all[f]) === host) { best = all[f]; break }
          }
          if (!best || best === it.baseUrl) continue

          var rest = []
          for (var k = 0; k < all.length; k++) {
            if (all[k] !== best && rest.indexOf(all[k]) === -1) rest.push(all[k])
          }
          it.baseUrl = best
          it.backupUrl = rest
          changed++
        }
      }

      var t = targetStream()
      if (!t) return
      noteApplied(hostOf(t.baseUrl), { managed: changed > 0, quality: t.id, codecid: t.codecid })
    }

    /** 把 `/upgcxcode/` 的视频分片换到手动选的节点；音频（30216/30232/30280）不动。
     *  没选节点就原样返回 —— 这就是「不改流」的全部含义。 */
    function rewriteMediaUrl(u) {
      if (probing || !isMedia(u) || !isPlayPage()) return u
      var host = readPick()
      if (!host) return u
      var m = /-1-(\d+)\.m4s/.exec(u)
      if (!m) return u
      var q = m[1]
      if (q === '30216' || q === '30232' || q === '30280') return u
      if (hostOf(u) === host) return u
      return swapHost(u, host)
    }

    /** 记下「这一页实际用的是哪个节点」—— 面板的「当前节点」和「是否生效」都靠它 */
    function noteApplied(host, extra) {
      var rec = {
        ts: Date.now(),
        page: location.pathname,
        host: host,
        managed: !!(extra && extra.managed)
      }
      if (extra && extra.quality) {
        rec.quality = extra.quality
        rec.codecid = extra.codecid
      }
      writeTab(APPLIED, rec)
      // 通知设置面板重画「当前节点」—— 站内切视频时播放器不会重载页面，
      // 面板要是开着的就一直是旧值（DOM 事件跨世界可见）
      try { document.dispatchEvent(new CustomEvent('bili-elite-cdn-applied')) } catch (e) {}
    }

    /** 取样区间：**本轮所有节点取同一段**，且每次运行随机换（躲开浏览器 HTTP 缓存），
     *  只在文件开头 8MB 内（那才是起播真正读的地方）。 */
    function sampleOffset(t, bytes) {
      var need = bytes || PROBE_BYTES
      var size = t.dur && t.bw ? Math.floor(t.bw * t.dur / 8) : 0
      var span = Math.min(8388608, Math.floor(size * 0.05) || 0)
      var off = span > need
        ? Math.floor(Math.random() * (span - need))
        : 0
      return off - (off % 4096)
    }

    /** 一次 Range 请求，回调毫秒数（0 = 失败）。
     *
     *  **为什么用 fetch + `cache: 'no-store'`，不用 XHR**：B 站的分片响应带很长的
     *  max-age，XHR 会把每次探测的 206 片段写进 HTTP 磁盘缓存 —— 每测一个视频就多
     *  两三份 128KB「永远用不到」的缓存条目，纯属占地方。`no-store` 既不读也不写。
     *
     *  **必须读完 body 再计时**：fetch 的 then 在响应头到达时就 resolve，
     *  只等 then 量到的是 TTFB，不是传输时间。
     */
    var netFetch = w.fetch
    function fetchRange(url, off, len, cb) {
      var started = Date.now()
      var finished = false
      var ac = null
      var timer = 0
      probing++
      function fin(ok) {
        if (finished) return
        finished = true
        probing--
        if (timer) clearTimeout(timer)
        /* 成功读数**至少算 1ms**：`0` 专门留给「失败」。
         * 同一毫秒内下完就是 0，而所有调用方都用 `if (ms)` 判成功，会被当成测不通。 */
        cb(ok ? Math.max(1, Date.now() - started) : 0)
      }
      try {
        ac = new AbortController()
        timer = setTimeout(function () { try { ac.abort() } catch (e) {} }, 8000)
        netFetch.call(w, url, {
          cache: 'no-store',
          signal: ac.signal,
          headers: { Range: 'bytes=' + off + '-' + (off + len - 1) }
        }).then(function (r) {
          if (!(r.status === 206 || (len === 1 && r.status === 200))) {
            fin(false)
            return null
          }
          return r.arrayBuffer().then(function () { fin(true) }, function () { fin(false) })
        }).catch(function () { fin(false) })
      }
      catch (e) { fin(false) }
    }

    /** 手动测速：只测这一页这条流的节点，串行、每个节点先 1 字节建连接再量 128KB。
     *  **只在用户点「开始测速」时跑**（v020 删掉了起播后的自动测速）。 */
    function probe(done) {
      // 不在播放页一律不测（防止 SPA 回到首页后拿残留的 `__playinfo__` 测旧视频）
      var t = isPlayPage() ? currentTarget() : null
      if (!t || !t.urls) {
        writeTab(STATE, { ts: Date.now(), state: 'no-stream' })
        if (done) done(false)
        return
      }

      var urls = t.urls
      var names = Object.keys(urls)
      // **只有一个节点也要能测**（有些稿件 B 站只给一个 CDN）
      if (!names.length) {
        writeTab(STATE, { ts: Date.now(), state: 'one-host', n: 0 })
        if (done) done(false)
        return
      }

      var off = sampleOffset(t, PROBE_BYTES)
      var out = {}
      var idx = 0
      writeTab(STATE, { ts: Date.now(), state: 'running', n: names.length, done: 0, total: names.length, host: '' })

      function next() {
        if (idx >= names.length) {
          var n = Object.keys(out).length
          if (n >= 1) {
            writeTab(SCORES, {
              ts: Date.now(),
              page: location.pathname,
              quality: t.quality,
              codecid: t.codecid,
              hosts: out
            })
          }
          writeTab(STATE, { ts: Date.now(), state: n >= 1 ? 'done' : 'failed', n: n })
          if (done) done(n >= 1)
          return
        }
        var h = names[idx++]
        // 每开始测一个节点都写一次：面板 400ms 轮询这个键，它就是「实时进度」
        writeTab(STATE, {
          ts: Date.now(),
          state: 'running',
          n: names.length,
          done: idx - 1,
          total: names.length,
          host: h
        })
        // 先 1 字节把 DNS / TCP / TLS 建起来，不然第一个测的节点白背一次握手
        fetchRange(urls[h], 0, 1, function () {
          fetchRange(urls[h], off, PROBE_BYTES, function (ms) {
            if (ms) out[h] = ms
            next()
          })
        })
      }

      next()
    }

    /** 站内切视频时 `__playinfo__` **不会更新**（B 站走 XHR 重新拉 playurl），
     *  所以「当前节点」不能只靠 playinfo —— 直接看**实际发出去的分片请求**。
     *  这是唯一在 SPA 换视频后还知道真相的地方。 */
    function noteMedia(u) {
      if (probing) return
      if (!isMedia(u)) return
      var m = /-1-(\d+)\.m4s/.exec(u)
      if (!m) return
      var q = m[1]
      // 30216 / 30232 / 30280 是音频，音频和视频不一定同一个节点
      if (q === '30216' || q === '30232' || q === '30280') return
      var h = hostOf(u)
      if (!h) return
      if (h === lastHost && location.pathname === lastPage) return
      lastHost = h
      lastPage = location.pathname
      noteApplied(h, null)
    }

    function isPlayurl(u) {
      return typeof u === 'string' && u.indexOf('/x/player') !== -1 && u.indexOf('playurl') !== -1
    }

    try {
      var rawOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function (method, url) {
        // 先按手动选择换节点，再记「实际用的是哪个」——顺序不能反，
        // 不然面板会把 B 站默认的慢节点当成功效
        var u = url
        try { u = rewriteMediaUrl(url) } catch (e) {}
        try { noteMedia(u) } catch (e) {}
        // 站内切视频时 B 站会重新请求 playurl —— 这是唯一能拿到「新视频节点列表」的地方
        if (isPlayurl(url)) {
          var x = this
          try {
            x.addEventListener('load', function () {
              try { capturePlayurl(x.responseText) } catch (e) {}
            })
          }
          catch (e) {}
        }
        if (u === url)
          return rawOpen.apply(this, arguments)
        var args = Array.prototype.slice.call(arguments)
        args[1] = u
        return rawOpen.apply(this, args)
      }
    }
    catch (e) {}

    // 有些版本走 fetch，两条都挂上（重复触发没关系，capturePlayurl 是幂等的）
    try {
      var rawFetch2 = w.fetch
      if (rawFetch2) {
        w.fetch = function (input, init) {
          var url = typeof input === 'string' ? input : (input && input.url) || ''
          // 分片也走 fetch 的版本同样要换节点（只处理字符串 URL；Request 对象不拆）
          var target = url
          if (typeof input === 'string') {
            try { target = rewriteMediaUrl(url) } catch (e) {}
          }
          try { noteMedia(target) } catch (e) {}
          var p = target === url
            ? rawFetch2.apply(this, arguments)
            : rawFetch2.call(this, target, init)
          if (isPlayurl(url)) {
            try {
              p.then(function (r) {
                try { r.clone().text().then(capturePlayurl).catch(function () {}) } catch (e) {}
              }).catch(function () {})
            }
            catch (e) {}
          }
          return p
        }
      }
    }
    catch (e) {}

    /** 设置面板通过 DOM 事件过来（内容脚本读不到页面世界的 `__playinfo__`，
     *  而 CDN 是跨域，内容脚本那边发 XHR 会被 CORS 挡掉）。
     *  选了节点用 sessionStorage 传（`CustomEvent.detail` 跨世界不保证拿得到）。 */
    try {
      document.addEventListener(PROBE_EVT, function () { probe() }, false)
      document.addEventListener(PICK_EVT, function () {
        // 面板刚写过 sessionStorage：丢掉缓存重新读，再把这一页的流立刻排过去
        pickCache = null
        try { applyPick() } catch (e) {}
      }, false)
    }
    catch (e) {}

    /** 等 `__playinfo__` 出现（B 站先内联赋值、再异步加载播放器，20ms 一次足够早） */
    var tries = 0
    var timer = setInterval(function () {
      tries++
      if (!videoStreams()) {
        if (tries > 300) clearInterval(timer)
        return
      }
      clearInterval(timer)
      // 先把「这条流有哪些节点」写给面板（不选节点也要能显示列表）
      try { capturePlayinfo() } catch (e) {}
      // 不是播放页就到此为止：不改 `__playinfo__`（首页上残留的是上一个视频的对象）
      if (!isPlayPage()) return
      // 只有用户手动选过节点才会动流；没选就一个字节都不改
      try { applyPick() } catch (e) {}
    }, 20)
  }

  /* 8) 动态卡片的详情地址 —— 镜像给隔离世界（1.2.4 v006）
   *
   * 「动态悬浮打开beta」要知道「这一条动态的详情页是哪一页」。这个地址**只有页面世界有**：
   * `.bili-dyn-time` 上的 v-log 指令把 `$log.click.url`（形如 `//t.bilibili.com/{id}`）
   * 挂成了 **JS expando**。内容脚本跑在隔离世界，同一份 DOM 是两套 JS 包装对象，
   * expando 不跨世界 —— 实测在内容脚本里 `el.__test__` 直接是 `undefined`，
   * 所以 1.2.4 v005 那版「点一下弹悬浮窗」在真机上一次都没生效，点下去还是 B 站原版的跳转。
   *
   * 通道沿用 §5 / §7 那套：**属性当数据、事件当敲门砖**。
   *   · 内容脚本在真正要用地址的那一刻，给那条动态挂 `data-blie-dyn-ask`，再
   *     `dispatchEvent` 一个**不带 detail** 的普通 Event（`CustomEvent.detail` 跨世界
   *     会被抹成 `null`，§7 那条注释已经踩过）；
   *   · 这边同步把地址写回同一个元素的 `data-blie-dyn-url`（属性跨世界可见）；
   *   · 解析不出就删掉这个属性，内容脚本读到空 = 交给 B 站原本的行为。
   *
   * 为什么不做 MutationObserver 预先把整屏卡片都标一遍：动态流是虚拟列表，滚动时会
   * 不断插新节点，常驻观察器要一直盯着整个 `#app`；而点击是**一次**事件，按需解析
   * 只多一次 `querySelector`。只在 `t.bilibili.com` 挂，别的页面一个监听都不加。
   */
  try {
    if (location.hostname === 't.bilibili.com') {
      document.addEventListener('blie-elite:dyn-url', function () {
        var item = document.querySelector('[data-blie-dyn-ask]')
        if (!item) return
        var url = ''
        var time = null
        try { time = item.querySelector('.bili-dyn-time') } catch (e) {}
        // v-log 指令挂的地址：B 站自己点击时用的就是它，最准
        try {
          var log = time && time.$log
          if (log && log.click && typeof log.click.url === 'string')
            url = log.click.url
        } catch (e) {}
        // 兜底：同一个元素上的组件实例 id
        if (!url) {
          try {
            var vue = time && time.__vue__
            if (vue && vue.id) url = 'https://t.bilibili.com/' + vue.id
          } catch (e) {}
        }
        try {
          if (url) item.setAttribute('data-blie-dyn-url', url)
          else item.removeAttribute('data-blie-dyn-url')
        } catch (e) {}
      }, true)
    }
  }
  catch (e) {}

  /* 9) 看图器工具栏的缩放命令（1.2.5 v023）
   *
   * 工具栏在内容脚本里（隔离世界），但 PhotoSwipe 实例只存在于页面的 `window.pswp` ——
   * 隔离世界读不到（同一份 DOM、两套 JS 包装对象），所以缩放只能由这边代劳。
   * 通道和 §8 同一套：**属性当数据、事件当敲门砖**（`CustomEvent.detail` 跨世界会被
   * 抹成 null，只传普通 Event）。
   *
   * 为什么用官方 `zoomTo()` 而不是改 img 的 width/height：pswp 的尺寸、平移、边界
   * 全是它自己算的，硬改尺寸会让拖动范围对不上。注意 `currZoomLevel` 初始是 `null`
   * （B 站配的 fit 模式），这时要用 `zoomLevels.min`（实测 0.777）当当前值，
   * 否则 `null * 1.4` 会算出 0、直接跳到最小。
   */
  try {
    document.addEventListener('blie-elite:pswp-cmd', function (e) {
      var el = e.target
      if (!el || !el.classList || !el.classList.contains('pswp')) return
      var cmd = el.getAttribute('data-blie-pswp-cmd')
      if (!cmd) return
      var p = window.pswp
      if (!p || p.element !== el) return
      var slide = p.currSlide
      if (!slide) return
      var levels = slide.zoomLevels || {}
      var min = typeof levels.min === 'number' ? levels.min : 1
      var max = typeof levels.max === 'number' ? levels.max : 4
      var cur = typeof slide.currZoomLevel === 'number' && slide.currZoomLevel > 0
        ? slide.currZoomLevel
        : min
      if (cmd === 'reset') {
        p.zoomTo(min)
        return
      }
      var k = cmd === 'in' ? 1.4 : 1 / 1.4
      var next = Math.min(max, Math.max(min, cur * k))
      if (Math.abs(next - cur) < 0.001) return
      p.zoomTo(next)
    }, true)
  }
  catch (e) {}
})()

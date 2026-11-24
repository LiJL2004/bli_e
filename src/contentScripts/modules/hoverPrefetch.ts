/**
 * 悬停预取：指针在某张视频卡上停住 80ms，就把那张卡的地址 `<link rel="prefetch" as="document">` 一下。
 *
 * 为什么有用（实测，chromium 1105，同机同网络，连开两个 profile 各跑两轮）：
 *
 *   | | TTFB | FCP | DOMContentLoaded |
 *   | --- | --- | --- | --- |
 *   | 直接导航 | 386 / 329ms | 830 / 721ms | 843 / 749ms |
 *   | 先 prefetch 再导航 | **1 / 1ms** | **371ms** | 398 / 383ms |
 *
 * 导航时 `transferSize` 是 0 —— 文档是直接从 Chrome 的 prefetch 缓存里拿的。
 * 关键点：B 站的 HTML **没有 Cache-Control / Last-Modified**，所以它进不了普通 HTTP 缓存
 * （第二轮直接导航照样 329ms），但 `rel=prefetch` 的响应走的是单独那份 prefetch 缓存，
 * 紧接着的那次同地址导航会直接命中。
 *
 * ## 一个开关：`playBoost`「播放页开启加速」（界面优化，默认开）
 *
 * v026 把原来「预取命中修复」+「首屏空闲预取」两个开关合成一个 —— 它们本来就是一条链上的，
 * 拆开只会出现「只开一半、白花流量」的组合。1.2.1 v028 从「实验室」转正到「界面优化」并
 * 默认开启（关掉时行为和以前完全一致，一个字节都不预取）。
 * 打开后三件事一起生效：
 *
 * ① **地址规范化**：预取地址和真实落点对不上，上面那 1ms 其实很难拿到。B 站点击时会自己
 *    拼埋点参数，右栏的 `trackid` 里还带时间戳（每次刷新都变），而 `/video/BVxxx` 还会
 *    **301** 到 `/video/BVxxx/`；prefetch 缓存按完整 URL 精确匹配，一错就全不命中。
 *    实测「直接点」和「悬停 700ms 再点」的 TTFB 是 1287 / 427 / 475 / 544ms，**没有任何
 *    差别**。所以预取和点击都走 `canonicalVideoUrl()`（去掉 `spm_id_from` / `vd_source` /
 *    `trackid` 等，视频页补尾部斜杠，**番剧页不能补** —— `/bangumi/play/epX/` 会 308 回来）。
 * ② **点击接管**：点击时如果这条地址**确实预取过**，就在捕获阶段接管、直接导航过去
 *    （顺带省掉那次 301）。只接管 `target="_blank"` 的链接（首页 / 搜索页）；
 *    同页的（播放页右栏）不碰。实测：悬停再点 17ms、直接点 29ms、`redirectCount = 0`。
 * ③ **首屏空闲预取**：悬停只救「先看再点」，手快直接点 / 键盘回车 / 触屏点根本没给预取
 *    留时间 —— 那几次就是 400~1300ms。打开后在 `load` 之后 1.5 秒、浏览器空闲时，把
 *    **最前面 3 张卡**的播放页也预取掉（约 200KB/页），慢的那次就追平了。
 *
 * 上限：关着 6 个地址 / 8 张封面（原行为）；开着 8 个地址（首屏 3 + 悬停补充）。
 *
 * ## 绝不跟正在播的视频抢带宽（1.2.3 v003）
 *
 * 这个模块和 `commentPreload.ts` 是全扩展仅有的两处会「为了以后方便而现在发请求」的地方，
 * 而 4K 那种码率下缓冲本来就只有十几秒的余量，任何一条额外请求都是在跟播放器抢。
 * 所以三条硬规矩：
 *
 * ① **本页在放视频**（播放页右栏悬停预览、直播页）：不做首屏预取，封面预取也只在
 *    缓冲 ≥ 10s 时才做（见 `playingVideo()` / `POSTER_BUFFER_MIN`）。
 * ② **链路太细**（`downlink` < 5Mbps，`saveData` / 2g 原来就跳过）：一律不预取 ——
 *    这种链路上预取省不下那 300ms，只会把别处的请求往后挤（见 `shouldSkip()`）。
 * ③ **播放页 / 番剧页直接收工**：那里没有「列表」，右栏是同页 SPA 跳转，预取了也用不上。
 *
 * 代价是「4K 视频 + 同时刷首页」这种组合下预取会少一些 —— 这是有意的取舍：加速是
 * 「锦上添花」，卡住正在看的画面是「事故」。
 */

import { get } from '../config'

/** 一次会话里最多预取几个地址（滑过一屏 20 张卡也不至于发 20 个请求） */
const PREFETCH_MAX = 6
/** 打开「播放页开启加速」后的上限：首屏 3 张 + 悬停补充 */
const PREFETCH_MAX_IDLE = 8
/** 停住多久才预取：扫过去就换卡的话不会触发 */
const PREFETCH_DELAY = 80
/** 首屏空闲时预取几张卡（每张一个播放页文档，实测 250KB 上下） */
const IDLE_PREFETCH = 3
/** load 之后等多久再做首屏预取（右栏 / 首屏卡片是水合之后才有的） */
const IDLE_DELAY = 1500
/**
 * 本页正在放视频、缓冲又不到这么多秒时，连 20KB 的封面也不预取（1.2.3 v003）。
 *
 * 这条只对播放页有意义（首页 / 搜索页根本没有 `<video>`）：缓冲掉到 10s 以下说明链路
 * 已经在打满，此刻任何一条额外请求都是从播放器嘴里抢带宽。而封面预取换来的只是
 * 「下一次跳转时早 200ms 出图」—— 不值得拿正在播的画面去换。
 */
const POSTER_BUFFER_MIN = 10
/** 链路低于这个估计速率（Mbps）就什么都不预取，见 shouldSkip */
const MIN_DOWNLINK = 5

const prefetched = new Set<string>()
let timer = 0
let idleTimer = 0
let pending = ''
let pendingAnchor: HTMLAnchorElement | null = null

/**
 * 播放页首帧前铺的那张封面用的尺寸后缀（和 `videoBeta.ts` 的 `posterUrl()` 必须一致）。
 * 悬停时顺手把「点进去之后要铺的那张图」也预取下来：20.6KB，`as=image` 是浏览器最低优先级，
 * 不会跟当前页抢带宽；落到播放页时 `--bili-vb-poster` 一写上去，图已经在内存缓存里，
 * 黑屏那段的封面能早 200~300ms 出现。
 */
const POSTER_SUFFIX = '@672w_378h_1c.webp'
const posters = new Set<string>()
const POSTER_MAX = 8

/**
 * 埋点参数：留着它们只会让预取地址和真实地址对不上（`trackid` 里还有时间戳，
 * 每次刷新都变）。只有打开「播放页开启加速」时才删。
 */
const TRACK_PARAMS = [
  'spm_id_from',
  'vd_source',
  'track_id',
  'trackid',
  'from',
  'from_source',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  'share_tag',
  'timestamp',
  'unique_k',
]

/**
 * 本页有没有正在播的 `<video>`（有就返回它）。
 *
 * 首页 / 搜索页没有视频元素，恒为 null，所以下面的判断对原有行为零影响；只有播放页的
 * 「右栏悬停预览」和「同页一边看视频一边滑右栏」两种情况会命中 —— 而这两种正是
 * 4K 那种码率下最经不起抢带宽的时刻。
 *
 * `readyState >= 2`：只认「真的有画面」的那种，刚创建还没数据的空壳不算（B 站会在
 * 右栏预先建一批隐藏的 video 给悬停预览用，那些 paused 是 true，本来也不会命中）。
 */
function playingVideo(): HTMLVideoElement | null {
  const videos = document.querySelectorAll<HTMLVideoElement>('video')
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]
    if (!v.paused && !v.ended && v.readyState >= 2)
      return v
  }
  return null
}

/** 播放器还缓冲着多少秒；读不到（媒体源还没就绪 / 没有 buffered）时按 0 算 */
function bufferAhead(video: HTMLVideoElement): number {
  const b = video.buffered
  if (!b || !b.length)
    return 0
  return b.end(b.length - 1) - video.currentTime
}

/** 关掉「播放页开启加速」时用的老判据：只认 www.bilibili.com 的稿件 / 番剧页，地址原样 */
function plainUrl(href: string): string {
  try {
    const url = new URL(href, location.href)
    if (url.hostname !== 'www.bilibili.com')
      return ''
    if (!/^\/(?:video\/BV[0-9A-Za-z]+|bangumi\/play\/(?:ep|ss)\d+)/.test(url.pathname))
      return ''
    return url.href
  }
  catch {
    return ''
  }
}

/**
 * 卡片地址 → 「真正会打开的那个地址」。
 *
 * 只认 `www.bilibili.com` 的稿件页 / 番剧页；直播、空间、专栏一律返回空串（不预取、不接管）。
 * 视频页补尾部斜杠（不补会吃一次 301）；番剧页**不能**补（补了会 308 回来）。
 */
export function canonicalVideoUrl(href: string): string {
  try {
    const url = new URL(href, location.href)
    if (url.hostname !== 'www.bilibili.com')
      return ''
    const isVideo = /^\/video\/BV[0-9A-Za-z]+\/?$/.test(url.pathname)
    const isBangumi = /^\/bangumi\/play\/(?:ep|ss)\d+\/?$/.test(url.pathname)
    if (!isVideo && !isBangumi)
      return ''
    for (const key of TRACK_PARAMS) url.searchParams.delete(key)
    if (isVideo && !url.pathname.endsWith('/'))
      url.pathname += '/'
    if (isBangumi && url.pathname.endsWith('/'))
      url.pathname = url.pathname.slice(0, -1)
    url.hash = ''
    return url.href
  }
  catch {
    return ''
  }
}

/** 当前配置下该预取哪个地址 */
function targetUrl(href: string): string {
  return get('playBoost') ? canonicalVideoUrl(href) : plainUrl(href)
}

/**
 * 本页自己的规范化地址，按 `location.href` 缓存。
 *
 * `onPointerOver` 每划过一张卡都要问一次「这是不是当前页」，而规范化要 `new URL()` +
 * 一串正则 + 逐个删参数。指针扫过一屏 20 张卡就是 20 次，其中 20 次算的都是同一个值。
 * 按 href 缓存而不是算一次就不变：站内 SPA 换页（播放页右栏点下一个视频）会改
 * `location.href` 但**不重跑内容脚本**，只缓存值的话从第二个视频开始就全判错了。
 */
let selfUrlCache: { href: string, url: string } | null = null
function selfUrl(): string {
  if (selfUrlCache && selfUrlCache.href === location.href)
    return selfUrlCache.url
  selfUrlCache = { href: location.href, url: targetUrl(location.href) }
  return selfUrlCache.url
}

/** 卡片封面 → 播放页封面：同一个 jpg，只换尺寸后缀（B 站图床的规则） */
function prefetchPoster(anchor: HTMLAnchorElement) {
  if (posters.size >= POSTER_MAX)
    return
  // 本页正在放视频、缓冲又不厚：这 20KB 不值得跟播放器抢（见 POSTER_BUFFER_MIN）
  const playing = playingVideo()
  if (playing && bufferAhead(playing) < POSTER_BUFFER_MIN)
    return
  const img = anchor.querySelector('img')
  const src = img?.currentSrc || img?.src || ''
  const base = src.split('@')[0]
  if (!base || !/hdslb\.com\/bfs\//.test(base))
    return
  const url = base + POSTER_SUFFIX
  if (posters.has(url))
    return
  posters.add(url)
  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.as = 'image'
  link.href = url
  document.head.appendChild(link)
}

/** 真的插了一条预取就返回 true。调用方靠它数「这一轮到底预取成了几张」 */
function prefetch(url: string): boolean {
  const max = get('playBoost') ? PREFETCH_MAX_IDLE : PREFETCH_MAX
  if (prefetched.size >= max || prefetched.has(url))
    return false
  prefetched.add(url)
  const link = document.createElement('link')
  link.rel = 'prefetch'
  // as=document 让 Chrome 按「导航请求」的优先级和凭据模式去取，命中率才对得上实测
  link.as = 'document'
  link.href = url
  document.head.appendChild(link)
  return true
}

/** 省流量 / 弱网下什么都不预取：这类网络下多一个请求反而更慢 */
function shouldSkip(): boolean {
  if (document.hidden)
    return true
  const conn = (navigator as any).connection
  if (!conn)
    return false
  if (conn.saveData || /^(?:slow-2g|2g)$/.test(conn.effectiveType || ''))
    return true
  // `downlink`（Mbps 估计值）比 `effectiveType` 细一档：8Mbps 的链路照样报 '4g'，
  // 而一条 ~250KB 的文档预取在这种链路上要占 250ms 以上、还得和别的请求排队。
  // 低于 5Mbps 时预取省不下那 300ms，反而会拖住同机在播的视频 —— 直接不做。
  // `downlink` 缺失（Firefox / 老内核）时是 undefined，不参与判断。
  return typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < MIN_DOWNLINK
}

function onPointerOver(event: Event) {
  if (shouldSkip())
    return
  const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor)
    return
  const url = targetUrl(anchor.href)
  if (!url || url === selfUrl())
    return
  // 同一张卡里从封面移到标题不算换目标，别把计时器一直重置
  if (url === pending)
    return
  pending = url
  pendingAnchor = anchor
  // 同页链接（播放页右栏）走 B 站自己的 SPA 路由，文档根本不会重新加载 —— 预取了也用不上，
  // 点击接管那边也只认 `target="_blank"`。只在「播放页开启加速」打开时收紧：关着时保持
  // v005 的原有行为（那一版本来就没区分）。封面照旧预取 —— 同页换视频时播放器要用到那张图。
  const skipDoc = !!get('playBoost') && anchor.target !== '_blank'
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = 0
    if (pending && !skipDoc)
      prefetch(pending)
    if (pendingAnchor)
      prefetchPoster(pendingAnchor)
    pendingAnchor = null
  }, PREFETCH_DELAY)
}

/**
 * 首屏空闲预取：把最前面几张卡的播放页也预取掉（只在「播放页开启加速」打开时生效）。
 *
 * 为什么需要它：悬停预取只救「先看再点」。手快直接点、键盘回车、触屏点一下 —— 这几条路径
 * 根本没给预取留时间，落到播放页就还是 300~1300ms 的 TTFB。这就是「有些视频打开很快、
 * 有些很慢」的来源。首屏那几张是**最可能被点**的，先把它们预取掉，慢的那次就追平了。
 */
function prefetchFirstScreen() {
  if (!get('playBoost') || shouldSkip())
    return
  // 播放页 / 番剧页没有「列表」可预取：右栏那几张卡是同页 SPA 跳转（`target` 为空），
  // 预取了也用不上（点击接管那边同样只认 `target="_blank"`）。这里直接收工 ——
  // 省掉一次全文档 querySelectorAll，也堵掉「以后右栏改成新标签页时突然开始抢带宽」。
  if (canonicalVideoUrl(location.href))
    return
  // 本页正在放视频（右栏悬停预览）：预取会跟它抢带宽，宁可不做
  if (playingVideo())
    return
  // Array.from：tsconfig 只开了 `lib: DOM`（没有 DOM.Iterable），NodeList 不能直接 for...of
  // 只取 `target="_blank"` 的（首页 / 搜索页）：同页 SPA 的那种预取了也用不上
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(
    '.bili-video-card a[target="_blank"][href*="/video/"], .floor-single-card a[target="_blank"][href*="/video/"]',
  ))
  let done = 0
  for (const anchor of anchors) {
    if (done >= IDLE_PREFETCH)
      break
    // 一张卡里有封面 + 标题两个链接，同一个地址只算一张
    const url = canonicalVideoUrl(anchor.href)
    if (!url || prefetched.has(url))
      continue
    // 计数只认「真的插进去了」的那几张：上限已经满了的时候 prefetch 会原样返回 false，
    // 以前这里照样 done++，于是「首屏 3 张」实际上一张都没预取还把额度算掉了。
    if (prefetch(url))
      done++
  }
}

/**
 * 点击接管：**只在这条地址确实预取过、而且它本来就是 `target="_blank"`** 时才接管；
 * 其余一律放行。同页的（播放页右栏）交给 B 站自己的路由。
 *
 * 为什么必须接管：B 站自己的点击处理会把埋点参数拼到地址上，于是实际导航的 URL 和预取的
 * URL 对不上，prefetch 缓存精确匹配不到 —— 白预取。这里改成「预取过就直接去那个地址」，
 * 顺带省掉 `/video/BVxxx` → `/video/BVxxx/` 的 301。
 *
 * 捕获阶段 + stopPropagation：B 站的处理器挂在卡片 / 链接上，不拦住它就会自己再跳一次。
 * 带修饰键（Ctrl / Cmd / Shift / Alt）一律放行，那是用户明确要「新窗口 / 新标签」。
 */
function onClickCapture(event: MouseEvent) {
  if (!get('playBoost'))
    return
  if (event.button !== 0 || event.defaultPrevented)
    return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return
  const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor || anchor.target !== '_blank')
    return
  const url = canonicalVideoUrl(anchor.href)
  if (!url || !prefetched.has(url))
    return
  event.preventDefault()
  event.stopPropagation()
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * 首屏空闲预取：`load` + 1.5s 之后再等**浏览器真的空闲**，才把那几张卡预取掉。
 *
 * 为什么要多这一层 `requestIdleCallback`：这个模块跑在 `document_start`，首页水合期间
 * 主线程本来就很紧；`setTimeout` 只是「时间到了」，不代表「这帧没事干」。rIC 会等到
 * 当前帧收尾，最多再等 1s（timeout 兜底，页面一直忙也不会漏掉）。
 */
function scheduleIdlePrefetch() {
  const run = () => {
    idleTimer = window.setTimeout(() => {
      idleTimer = 0
      if (typeof window.requestIdleCallback === 'function')
        window.requestIdleCallback(prefetchFirstScreen, { timeout: 1000 })
      else
        prefetchFirstScreen()
    }, IDLE_DELAY)
  }
  if (document.readyState === 'complete')
    run()
  else
    window.addEventListener('load', run, { once: true })
}

export function setupHoverPrefetch(): () => void {
  document.addEventListener('pointerover', onPointerOver, { passive: true })
  document.addEventListener('click', onClickCapture, true)
  scheduleIdlePrefetch()
  return () => {
    document.removeEventListener('pointerover', onPointerOver)
    document.removeEventListener('click', onClickCapture, true)
    window.clearTimeout(timer)
    window.clearTimeout(idleTimer)
    timer = 0
    idleTimer = 0
    pending = ''
    pendingAnchor = null
    prefetched.clear()
    posters.clear()
  }
}

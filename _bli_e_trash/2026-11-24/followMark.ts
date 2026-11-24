/**
 * 搜索页 / 播放页右栏的卡片上补一个「已关注」胶囊。
 *
 * 首页卡片 B 站自己会渲染 `.bili-video-card__info--icon-text`（文本「已关注」），
 * 但**搜索结果卡片和播放页右栏的推荐卡片没有这个节点** —— 这两处要标出来，
 * 只能自己判断「当前用户有没有关注这个 UP」。
 *
 * 关注状态从关注列表接口一次拉全量（`/x/relation/followings`，不需要 wbi 签名，
 * 只要登录 cookie 就够），按 mid 存进 localStorage 缓存 24 小时；卡片上的 mid 直接读
 * `a[href*="space.bilibili.com/"]`，本地匹配，零额外请求。
 *
 * **为什么不是「每张卡片单查 `/x/relation?fid=`」**：单查确实能用（实测 attribute=2），
 * 但搜索页一屏 40 多张卡、右栏 20 多张，每次换页 / 滚动都要重新查一轮，请求量比
 * 「一次拉全量几百个 mid、缓存一天」大一个数量级。
 *
 * 胶囊的样式复用 topbar.css §18（`.bili-elite-followed`），注入的节点特意带上
 * `bili-video-card__info--icon-text` 这个类 —— 一条规则同时覆盖首页原生标签和这里补的，
 * 不用维护第二套几何。
 */

const CACHE_KEY = 'bili-elite-following'
const CACHE_TTL = 24 * 60 * 60 * 1000
/** 关注上限是 2000，ps=50 → 最多 40 页；正常用户 400 关注是 8 页 */
const MAX_PAGES = 40

/** 列表容器（观察范围）与两处卡片的信息区 */
const HOST_SELECTOR = '.search-page .video-list, .recommend-list-v1'
const SEARCH_CARD = '.search-page .video-list .bili-video-card__info--bottom'
const RAIL_CARD = '.recommend-list-v1 .video-page-card-small .upname > a'

const TAG_CLASS = 'bili-video-card__info--icon-text bili-elite-followed'
const TAG_TEXT = '已关注'

/** 关注的 mid 集合；null = 还没拉到（或未登录 / 拉取失败） */
let followed: Set<string> | null = null
let loading = false
let observer: MutationObserver | null = null
let observed: Element[] = []
let timer: number | null = null
let pageTimer: number | null = null
let lastUrl = ''
let disposed = false

/** 只在搜索页 / 播放页右栏补标签 —— 首页交给 B 站自己（它本来就有） */
function isTargetPage(): boolean {
  return location.hostname === 'search.bilibili.com'
    || (location.hostname === 'www.bilibili.com' && location.pathname.startsWith('/video/'))
}

function midOf(el: Element): string | null {
  const href = el.getAttribute('href') || ''
  const m = /space\.bilibili\.com\/(\d+)/.exec(href)
  return m ? m[1] : null
}

function makeTag(): HTMLElement {
  const tag = document.createElement('div')
  tag.className = TAG_CLASS
  tag.textContent = TAG_TEXT
  return tag
}

/** 已经有一个「已关注」标签了就不重复插（首页原生标签 / 同一张卡被扫了两次） */
function hasTag(host: Element): boolean {
  if (host.querySelector('.bili-elite-followed'))
    return true
  // 首页原生标签在 topbarOptimize 的 markFollowedTags 打标之前，只有文本可认
  const icons = host.querySelectorAll('.bili-video-card__info--icon-text')
  for (const icon of Array.from(icons)) {
    if (icon.textContent?.trim() === TAG_TEXT)
      return true
  }
  return false
}

function mark() {
  if (!followed || disposed)
    return

  for (const bottom of Array.from(document.querySelectorAll(SEARCH_CARD))) {
    if (hasTag(bottom))
      continue
    const owner = bottom.querySelector('a[href*="space.bilibili.com/"]')
    const mid = owner ? midOf(owner) : null
    if (!mid || !followed.has(mid))
      continue
    // 和首页原生标签同一个位置：作者名链接之前
    bottom.insertBefore(makeTag(), owner)
  }

  for (const upname of Array.from(document.querySelectorAll(RAIL_CARD))) {
    if (hasTag(upname))
      continue
    const mid = midOf(upname)
    if (!mid || !followed.has(mid))
      continue
    // 插在 UP 名之前、头像 svg 之后，和名字同一行
    const name = upname.querySelector('.name')
    upname.insertBefore(makeTag(), name)
  }
}

function schedule() {
  if (timer !== null || disposed)
    return
  timer = window.setTimeout(() => {
    timer = null
    observeHosts()
    mark()
  }, 200)
}

function sameHosts(list: Element[]): boolean {
  if (list.length !== observed.length)
    return false
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== observed[i])
      return false
  }
  return true
}

/**
 * 只在搜索页 / 播放页观察列表容器。
 *
 * **不盯整页**：首页那种一屏几千批 DOM 变动的地方，subtree 观察器的记录成本是实打实的
 * （topbarOptimize 就是因为这个把 document 收窄到了顶栏 + 信息流）。这里宁可等
 * `pageTimer` 那 800ms 的轮询把容器等出来，也不在首页挂一个整页观察器。
 */
function observeHosts() {
  if (!observer || disposed)
    return
  if (!isTargetPage()) {
    if (observed.length) {
      observer.disconnect()
      observed = []
    }
    return
  }
  const hosts = Array.from(document.querySelectorAll(HOST_SELECTOR))
  if (sameHosts(hosts))
    return
  observer.disconnect()
  observed = hosts
  for (const host of hosts)
    observer.observe(host, { childList: true, subtree: true })
}

/**
 * 站内跳转（首页 → 播放页）不会重新执行内容脚本，也没有事件可听，
 * 只能轻量轮询 URL。800ms 一次字符串比较，开销可以忽略。
 */
function checkPage() {
  if (disposed)
    return
  if (location.href !== lastUrl) {
    lastUrl = location.href
    // URL 变了 = 容器整块换掉，旧节点上的观察器已经哑了，强制重挂
    observed = []
    observeHosts()
    schedule()
    return
  }
  // 页面没变但容器还没渲染出来（首屏 / 懒加载），继续等
  if (isTargetPage() && !observed.length) {
    observeHosts()
    schedule()
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { credentials: 'include' })
  return res.json()
}

/** 拉全量关注列表（带 24h 缓存）。失败 / 未登录一律返回空集合，功能静默不生效。 */
async function loadFollowings(): Promise<Set<string>> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const cache = JSON.parse(raw)
      if (cache && Array.isArray(cache.mids) && Date.now() - Number(cache.ts) < CACHE_TTL)
        return new Set(cache.mids.map(String))
    }
  }
  catch {}

  const empty = new Set<string>()
  try {
    const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav')
    const self = nav?.data?.mid
    if (!nav?.data?.isLogin || !self)
      return empty

    const out = new Set<string>()
    let total = Infinity
    for (let pn = 1; pn <= MAX_PAGES && out.size < total; pn++) {
      const page = await fetchJson(`https://api.bilibili.com/x/relation/followings?vmid=${self}&pn=${pn}&ps=50&order=desc&order_type=attention`)
      if (page?.code !== 0 || !page.data)
        break
      total = Number(page.data.total) || 0
      const list = Array.isArray(page.data.list) ? page.data.list : []
      for (const user of list)
        out.add(String(user.mid))
      if (list.length < 50)
        break
    }
    if (out.size) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), mids: Array.from(out) }))
      }
      catch {}
    }
    return out
  }
  catch {
    return empty
  }
}

export function setupFollowMark(): () => void {
  disposed = false
  observer = new MutationObserver(() => schedule())
  lastUrl = location.href
  observeHosts()
  schedule()
  pageTimer = window.setInterval(checkPage, 800)

  if (!loading) {
    loading = true
    loadFollowings()
      .then((set) => {
        followed = set
        loading = false
        if (set.size)
          schedule()
      })
      .catch(() => { loading = false })
  }

  return () => {
    disposed = true
    if (timer !== null)
      window.clearTimeout(timer)
    if (pageTimer !== null)
      window.clearInterval(pageTimer)
    observer?.disconnect()
    observer = null
    observed = []
  }
}

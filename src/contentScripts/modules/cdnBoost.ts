/**
 * 「节点测速」的工具层（1.2.5 v020 起只剩这一个用途）。
 *
 * 真正干活的是 `extension/guard.js` §7：拿 `__playinfo__` 里那条流的签名地址给每个
 * CDN 节点测速，并按用户选的那个节点改写后续分片请求。
 *
 * 这里做两件事：
 *   1. 给设置面板提供读写那几个 sessionStorage 键的小工具；
 *   2. 把「选了哪个节点」写进 sessionStorage 并敲一下页面世界（guard.js 立刻生效）。
 *
 * **测速为什么不在这一侧跑**：CDN 是 `*.bilivideo.com`，扩展的 host 权限只有
 * `*.bilibili.com`，内容脚本发 XHR 会被 CORS 挡掉；而 `__playinfo__` 在页面世界，
 * 内容脚本也读不到。所以测速按钮只往 document 上派一个事件，由 guard.js 那边执行。
 *
 * **手动选择只对当前视频、这一次播放生效**（1.2.5 v020 用户要求）：
 * 选择存在 sessionStorage（每个标签页一份）并带上 `page`，站内换视频后自动失效；
 * 以前那个全局的 `bili-elite-cdn-force`（localStorage，跨视频跨会话）已经删掉。
 */

/* **全部用 sessionStorage**（每标签页独立、刷新仍在）：
 * 同时开好几个播放页时，localStorage 是全站共享的，后写的会盖掉前一个 ——
 * 面板读到的就是**另一个视频**的节点列表，「当前节点」和列表对不上。
 */

/** 测速分数：`{ ts, page, quality, codecid, hosts: { host: 毫秒 } }` —— 每页，只用于显示 */
export const CDN_SCORES = 'bili-elite-cdn-scores'
/** guard.js 实际写进 baseUrl 的节点：`{ ts, page, host, managed }` —— 每页 */
export const CDN_APPLIED = 'bili-elite-cdn-applied'
/** 测速过程状态：`{ ts, state, n, done, total, host }` —— 每页 */
export const CDN_STATE = 'bili-elite-cdn-probe-state'
/** 当前这一页那条流的节点地址表（由 guard.js 从 playurl 响应里截出来）—— 每页 */
export const CDN_HOSTS = 'bili-elite-cdn-hosts'
/** 这一页手动选的节点：`{ page, host }` —— 每页（换视频 / 关标签页即失效） */
export const CDN_PICK = 'bili-elite-cdn-pick'

/** guard.js 记完「当前节点」会派这个 DOM 事件，面板据此重画（站内切视频时用） */
export const CDN_APPLIED_EVENT = 'bili-elite-cdn-applied'
/** 与 guard.js 里那个 `PROBE_EVT` 同名 */
export const CDN_PROBE_EVENT = 'bili-elite-cdn-probe'
/** 与 guard.js 里那个 `PICK_EVT` 同名：选完节点敲一下，让当前这一页立刻换过去 */
export const CDN_PICK_EVENT = 'bili-elite-cdn-picked'

export interface CdnScores {
  ts: number
  /** 测速时所在的页面 —— 站内切视频后靠它判断这份分数是不是「当前这个视频」的 */
  page?: string
  quality: number
  codecid: number
  hosts: Record<string, number>
}

/** `guard.js` 从 playurl 响应里截出来的「这一页那条流的节点地址」 */
export interface CdnHosts {
  ts: number
  page: string
  quality: number
  codecid: number
  bw?: number
  dur?: number
  urls: Record<string, string>
}

export interface CdnApplied {
  ts: number
  /** 写入时所在页面的 pathname —— 换视频 / 换页面后靠它判断这条记录是不是「当前这一页」的 */
  page?: string
  quality?: number
  codecid?: number
  host: string
  /** 这一页到底有没有被我们改写（false = 没选节点，或选中的主机不在这个视频的列表里） */
  managed?: boolean
}

export type CdnProbeState = 'running' | 'done' | 'failed' | 'no-stream' | 'one-host'

export interface CdnState {
  ts: number
  state: CdnProbeState
  n?: number
  /** 测速进度：已测完几个 / 一共几个 */
  done?: number
  total?: number
  /** 正在测的那个节点（面板显示用） */
  host?: string
}

function parse<T>(raw: string | null): T | null {
  if (!raw)
    return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v as T : null
  }
  catch {
    return null
  }
}

/** 这一页（每个标签页独立）—— 见文件开头那段说明 */
function readTab<T>(key: string): T | null {
  try {
    return parse<T>(sessionStorage.getItem(key))
  }
  catch {
    return null
  }
}

export function readCdnScores() {
  return readTab<CdnScores>(CDN_SCORES)
}

/** 当前这一页那条流的节点地址（SPA 切视频后 `__playinfo__` 不会更新，只有这个会变） */
export function readCdnHosts() {
  return readTab<CdnHosts>(CDN_HOSTS)
}

export function readCdnApplied() {
  return readTab<CdnApplied>(CDN_APPLIED)
}

export function readCdnState() {
  return readTab<CdnState>(CDN_STATE)
}

/** 这一页手动选的节点；空串 = 用 B 站给的默认节点。
 *  `page` 对不上就当没选（站内换视频后 pathname 会变）。 */
export function getCdnPick(): string {
  const p = readTab<{ page?: string, host?: string }>(CDN_PICK)
  if (!p || !p.host || p.page !== location.pathname)
    return ''
  return p.host
}

/** 选节点 / 取消选择。传空串 = 回到 B 站默认。
 *  写完就敲一下 document，guard.js 那边会立刻把这一页后续的分片换过去 —— 不用刷新。 */
export function setCdnPick(host: string) {
  try {
    if (host)
      sessionStorage.setItem(CDN_PICK, JSON.stringify({ page: location.pathname, host }))
    else
      sessionStorage.removeItem(CDN_PICK)
  }
  catch {
    /* 隐私模式：这一次不生效 */
    return
  }
  try {
    document.dispatchEvent(new CustomEvent(CDN_PICK_EVENT))
  }
  catch {
    /* noop */
  }
}

/** 让 guard.js 那边立刻测一轮（它挂在 document 上，跨世界可见） */
export function requestCdnProbe() {
  try {
    document.dispatchEvent(new CustomEvent(CDN_PROBE_EVENT))
  }
  catch {
    /* noop */
  }
}

/**
 * 是不是「播放页」—— 「开始测速」只在这些页面上可用。
 *
 * 主站普通播放页 / 番剧 / 合集 / 课堂，以及稍后再看、收藏夹那种 `/list/` 播放页。
 * **和 `extension/guard.js` 里的 `isPlayPage()` 必须一致**：面板禁用按钮只是挡住点击，
 * 真正兜底的是 guard.js —— SPA 回到首页后 `__playinfo__` 还留着上一个视频，不按地址
 * 拦一下会真的去测那个旧视频的节点。
 */
export function isCdnPlayPage(): boolean {
  const p = location.pathname
  return p.includes('/video/')
    || p.includes('/bangumi/play/')
    || p.includes('/medialist/play/')
    || p.includes('/cheese/play/')
    || p.startsWith('/list/')
}

/** 节点主机名太长，列表里只显示有区分度的那一段：upos-sz-mirrorhwb → mirrorhwb */
export function shortHost(host: string) {
  return host
    .replace(/:\d+$/, '')
    .replace(/^upos-[a-z0-9]+-/, '')
    .replace(/\.bilivideo\.com$/, '')
    .replace(/\.bilivideo\.cn$/, '')
    .replace(/\.akamaized\.net$/, '')
}

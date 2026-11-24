import { get, onConfigChange } from '../config'
import { error, warn } from '../logger'
import { chromeApi } from '../storage'
import { loadHomePanelHtml } from './topbarOptimize'
import { installRipple } from './ripple'
import selfTopbarCss from './selfTopbar.css?inline'

/**
 * 「顶栏优化」：整条顶栏由扩展自己画，不再等 B 站那套 header 脚本。
 *
 * 为什么要自己画：B 站顶栏的渲染时机完全由它的 `bili-header.umd.js` 决定 —— 实测播放页
 * 1.2s、冷缓存 4~5s（把扩展整个关掉更慢，5.0s+，所以不是我们拖慢的）。这期间原生顶栏
 * 要么是空的、要么是一版旧结构，用户看到的就是「顶栏半天长不出来」。BewlyCat 的做法是
 * 整条顶栏自己渲染（`#bewly` + Shadow DOM），这里学同一件事，只是沿用本项目「页面级 DOM
 * + 前缀类名 + 一套 CSS」的路子：能直接复用已有的频道面板 / 材质 / 夜间样式，不用再写一套。
 *
 * 与原生顶栏的关系（关键）：
 * - 原生 `.bili-header__bar` **只是 `visibility: hidden`**（见 topbar.css §1.0），它仍然占着
 *   文档流里那 64px —— 隐藏它不会让页面往上跳，我们的 bar 正好盖在它上面。
 * - 原生顶栏的 JS 补丁（骨架栏 / 自绘 logo / 番剧改名「动态」/ 原生频道面板 / 右侧隐藏 /
 *   搜索页关键词）在开关打开时全部停手，见 topbarOptimize.ts 的 `syncChrome` / `sync`。
 * - 功能与原生那版保持一致：首页（含频道面板）/ 动态 / 搜索框 / 消息 / 动态 / 收藏 / 历史 /
 *   投稿 / 头像（未登录是「登录」）。链接指向与原生完全一致，右侧四个图标直接用 B 站顶栏
 *   那套 SVG（动态是四瓣风车），不是自己拼的形状。
 * - 右侧五项都带悬停浮层（头像 / 消息 / 动态 / 收藏 / 历史），做法参考 BewlyCat 的 pops
 *   （上游是 BewlyBewly 的 `components/TopBar/components/*Pop.vue`；出处与许可见 THIRD-PARTY-NOTICES.md）。
 *
 * 数据：nav（头像 / mid）、msgfeed/unread（消息未读）、search/square（热搜）、
 * main/suggest（联想）、feed/nav（动态）、fav/folder（收藏夹）、history/cursor（历史）。
 * 都在页面里直接 fetch —— 页面就是 *.bilibili.com，接口的 CORS 本来就允许自家站点，
 * 带上 credentials 就能拿到登录态，不必绕后台。
 */

const HOST_ID = 'bili-elite-tb'
const STYLE_ID = 'bili-elite-tb-style'
const ROOT_ON = 'bili-elite-tb-on'
/** 「投稿按钮移除」：整颗收掉右侧那颗粉色胶囊（样式在 selfTopbar.css §4） */
const ROOT_NO_UPLOAD = 'bili-elite-tb-no-upload'
/**
 * 「顶栏左右边距跟页面内容对齐」（1.2.1）：首页 / 搜索页 / 播放页三种页面的内容区左右留白
 * 都是 `--bili-edge`，顶栏跟着取同一个数（样式在 selfTopbar.css §1.1）。
 * 动态页（t.bilibili.com）没有这么一条边（内容是居中三栏），但按用户要求也取同一个数。
 *
 * 为什么用 location 判定、挂一个类，而不是 CSS 里的 `:has(main.bili-feed4-layout)`：
 * 边距在**首帧**就得是对的，而 `:has()` 要等 feed 节点出现才匹配 —— 那一下顶栏会从 24px
 * 横跳到 10px。`location` 在 document_start 就是最终值，没有这个中间态。
 */
const ROOT_EDGE = 'bili-elite-tb-edge'
const HISTORY_KEY = 'bili-elite-search-history'
/**
 * 历史最多存多少条（1.2.4 v013：10 → 100）。
 *
 * 10 条的时候，搜过十一次就会把最早那条顶掉 —— 用户报的就是这个「旧词被挤没了」。
 * 面板本身已经能展开 + 滚动（见 `.tb-sp-fold`），所以存储层没必要再卡这么紧。
 * 100 条按每条 30 字算也就 3KB 左右，`chrome.storage.local` 的 5MB 配额远远够。
 */
const HISTORY_MAX = 100
const HOME_URL = '//www.bilibili.com/'
const SEARCH_URL = '//search.bilibili.com/all'
const UPLOAD_URL = '//member.bilibili.com/platform/upload/video/frame'
const LOGIN_URL = '//passport.bilibili.com/login'

/** 20px 图标，全部照 B 站顶栏那套 SVG 原样搬（viewBox / 线宽 / 路径都不改），
 *  只有「动态」那个是 20×21 —— 四段圆弧拼的四瓣风车，自己拼形状很难对上。 */
const ICON_MSG = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15.435 17.7717H4.567C2.60143 17.7717 1 16.1723 1 14.2047V5.76702C1 3.80144 2.59942 2.20001 4.567 2.20001H15.433C17.3986 2.20001 19 3.79943 19 5.76702V14.2047C19.002 16.1703 17.4006 17.7717 15.435 17.7717ZM4.567 4.00062C3.59327 4.00062 2.8006 4.79328 2.8006 5.76702V14.2047C2.8006 15.1784 3.59327 15.9711 4.567 15.9711H15.433C16.4067 15.9711 17.1994 15.1784 17.1994 14.2047V5.76702C17.1994 4.79328 16.4067 4.00062 15.433 4.00062H4.567Z" fill="currentColor"/><path d="M9.99943 11.2C9.51188 11.2 9.02238 11.0667 8.59748 10.8019L8.5407 10.7635L4.3329 7.65675C3.95304 7.37731 3.88842 6.86226 4.18996 6.50976C4.48954 6.15544 5.0417 6.09699 5.4196 6.37643L9.59412 9.45943C9.84279 9.60189 10.1561 9.60189 10.4067 9.45943L14.5812 6.37643C14.9591 6.09699 15.5113 6.15544 15.8109 6.50976C16.1104 6.86409 16.0478 7.37731 15.6679 7.65675L11.4014 10.8019C10.9765 11.0667 10.487 11.2 9.99943 11.2Z" fill="currentColor"/></svg>'
const ICON_DYN = '<svg viewBox="0 0 20 21" fill="none" aria-hidden="true"><path d="M10 10.743C7.69883 10.743 5.83333 8.87747 5.83333 6.5763C5.83333 4.27512 7.69883 2.40964 10 2.40964V10.743Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 10.743C10 13.0441 8.1345 14.9096 5.83333 14.9096C3.53217 14.9096 1.66667 13.0441 1.66667 10.743H10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 10.743C10 8.44182 11.8655 6.57632 14.1667 6.57632C16.4679 6.57632 18.3333 8.44182 18.3333 10.743H10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.99999 10.743C12.3012 10.743 14.1667 12.6085 14.1667 14.9096C14.1667 17.2108 12.3012 19.0763 9.99999 19.0763V10.743Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
const ICON_FAV = '<svg viewBox="0 0 20 21" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.0505 3.16759L12.7915 6.69573C12.954 7.02647 13.2702 7.25612 13.6349 7.30949L17.5294 7.87474C18.448 8.00817 18.8159 9.13785 18.1504 9.78639L15.3331 12.5334C15.0686 12.7905 14.9481 13.1609 15.0104 13.5256L15.6759 17.4031C15.8328 18.3184 14.8721 19.0171 14.0497 18.5845L10.5661 16.7537C10.2402 16.5823 9.85042 16.5823 9.52373 16.7537L6.04087 18.5845C5.21848 19.0171 4.2578 18.3184 4.41468 17.4031L5.07939 13.5256C5.14166 13.1609 5.02198 12.7905 4.75755 12.5334L1.9394 9.78639C1.27469 9.13785 1.64182 8.00817 2.56126 7.87474L6.4549 7.30949C6.82041 7.25612 7.13578 7.02647 7.29832 6.69573L9.04015 3.16759C9.45095 2.33468 10.6389 2.33468 11.0505 3.16759Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.603 11.8739C11.413 12.5556 10.7871 13.0554 10.0447 13.0554C9.29592 13.0554 8.66679 12.5467 8.48242 11.8569" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_HIS = '<svg viewBox="0 0 20 21" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.74286C5.02955 1.74286 1 5.7724 1 10.7429C1 15.7133 5.02955 19.7429 10 19.7429C14.9705 19.7429 19 15.7133 19 10.7429C19 5.7724 14.9705 1.74286 10 1.74286ZM10.0006 3.379C14.0612 3.379 17.3642 6.68282 17.3642 10.7426C17.3642 14.8033 14.0612 18.1063 10.0006 18.1063C5.93996 18.1063 2.63696 14.8033 2.63696 10.7426C2.63696 6.68282 5.93996 3.379 10.0006 3.379Z" fill="currentColor"/><path d="M9.99985 6.6521V10.743" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12.4545 10.7427H10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
const ICON_UPLOAD = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12.0824 10H14.1412C15.0508 10 15.7882 10.7374 15.7882 11.6471V12.8824C15.7882 13.792 15.0508 14.5294 14.1412 14.5294H3.84707C2.93743 14.5294 2.20001 13.792 2.20001 12.8824V11.6471C2.20001 10.7374 2.93743 10 3.84707 10H5.90589" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.99413 11.2353L8.99413 3.82353" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.0823 6.29413L8.9941 3.20589L5.90587 6.29413" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.2" r="3.5"/><path d="M5 20.2c.6-3.4 3.5-5.3 7-5.3s6.4 1.9 7 5.3"/></svg>'

/** 头像浮层里那几行的小图标：照原生头像面板的 SVG 搬，`fill="var(--text2)"` 换成 currentColor */
const ICON_ME = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M12.1146 9.48983C13.2763 8.63331 14.0299 7.2548 14.0299 5.7035C14.0299 3.11005 11.9198 1 9.32636 1C6.73291 1 4.62286 3.11005 4.62286 5.7035C4.62286 7.2548 5.37829 8.63331 6.53808 9.48983C3.87662 10.589 2 13.2118 2 16.2648C2 16.671 2.32901 17 2.73521 17C3.14141 17 3.47042 16.671 3.47042 16.2648C3.47042 13.0335 6.09879 10.407 9.3282 10.407C12.5576 10.407 15.186 13.0354 15.186 16.2648C15.186 16.671 15.515 17 15.9212 17C16.3274 17 16.6564 16.671 16.6564 16.2648C16.6546 13.2118 14.7761 10.589 12.1146 9.48983ZM6.09144 5.7035C6.09144 3.91878 7.54348 2.46858 9.32636 2.46858C11.1092 2.46858 12.5613 3.92062 12.5613 5.7035C12.5613 7.48639 11.1092 8.93843 9.32636 8.93843C7.54348 8.93843 6.09144 7.48639 6.09144 5.7035Z" fill="currentColor"/></svg>'
const ICON_MANAGE = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.375 1.875H10.875C12.739 1.875 14.25 3.38604 14.25 5.25V7.875V8.625C14.25 9.03921 14.5858 9.375 15 9.375C15.4142 9.375 15.75 9.03921 15.75 8.625V7.875V5.25C15.75 2.55761 13.5674 0.375 10.875 0.375H3.375C2.33947 0.375 1.5 1.21447 1.5 2.25V15C1.5 16.0355 2.33947 16.875 3.375 16.875H6.75H7.5C7.91421 16.875 8.25 16.5392 8.25 16.125C8.25 15.7108 7.91421 15.375 7.5 15.375H6.75H3.375C3.16789 15.375 3 15.2071 3 15V2.25C3 2.04289 3.16789 1.875 3.375 1.875ZM10.4 8.51962C10.8 8.28868 10.8 7.71132 10.4 7.48038L7.7 5.92154C7.3 5.6906 6.8 5.97927 6.8 6.44115V9.55885C6.8 10.0207 7.3 10.3094 7.7 10.0785L10.4 8.51962ZM15.518 14.2511L14.3215 16.3234H11.9285L10.7321 14.2511L11.9285 12.1787H14.3215L15.518 14.2511ZM16.817 13.5011C17.0849 13.9652 17.0849 14.537 16.817 15.0011L15.6205 17.0734C15.3526 17.5375 14.8574 17.8234 14.3215 17.8234H11.9285C11.3926 17.8234 10.8974 17.5375 10.6295 17.0734L9.43302 15.0011C9.16507 14.537 9.16507 13.9652 9.43302 13.5011L10.6295 11.4287C10.8974 10.9646 11.3926 10.6787 11.9285 10.6787H14.3215C14.8574 10.6787 15.3526 10.9646 15.6205 11.4287L16.817 13.5011ZM13.125 13.3125C12.6072 13.3125 12.1875 13.7322 12.1875 14.25C12.1875 14.7678 12.6072 15.1875 13.125 15.1875C13.6428 15.1875 14.0625 14.7678 14.0625 14.25C14.0625 13.7322 13.6428 13.3125 13.125 13.3125Z" fill="currentColor"/></svg>'
const ICON_LOGOUT = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.6137 9.30115C17.6932 9.10837 17.6932 8.89282 17.6137 8.70004C17.5743 8.60393 17.5165 8.51726 17.4443 8.44504L15.2221 6.22282C14.9148 5.9156 14.4176 5.91615 14.111 6.22282C13.8043 6.52948 13.8037 7.02671 14.111 7.33393L14.9921 8.21504L7.99985 8.21504C7.56596 8.21448 7.21429 8.56615 7.21429 9.00059C7.21429 9.21726 7.30207 9.41393 7.44429 9.55615C7.58651 9.69837 7.78318 9.78615 7.99985 9.78615L14.9921 9.78615L14.111 10.6673C13.8043 10.9739 13.8037 11.4712 14.111 11.7784C14.4182 12.0856 14.9154 12.085 15.2221 11.7784L17.4443 9.55615C17.5165 9.48393 17.5743 9.39726 17.6137 9.30115" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.8889 5.11111C9.74127 2.96349 6.25873 2.96349 4.11111 5.11111C1.96349 7.25873 1.96349 10.7413 4.11111 12.8889C6.25873 15.0365 9.74127 15.0365 11.8889 12.8889C12.1957 12.5821 12.6932 12.5821 13 12.8889C13.3068 13.1957 13.3068 13.6932 13 14C10.2387 16.7613 5.76127 16.7613 3 14C0.238731 11.2387 0.23873 6.76127 3 4C5.76127 1.23873 10.2387 1.23873 13 4C13.3068 4.30683 13.3068 4.80429 13 5.11111C12.6932 5.41794 12.1957 5.41794 11.8889 5.11111Z" fill="currentColor"/></svg>'

/** 右侧图标：与改造后的原生顶栏完全一致的一组（大会员 / 创作中心本来就被隐藏） */
const RIGHT_ICONS = [
  { key: 'msg', label: '消息', icon: ICON_MSG, href: '//message.bilibili.com/' },
  { key: 'dyn', label: '动态', icon: ICON_DYN, href: '//t.bilibili.com/' },
  { key: 'fav', label: '收藏', icon: ICON_FAV, href: '//www.bilibili.com/account/favlist' },
  { key: 'his', label: '历史', icon: ICON_HIS, href: '//www.bilibili.com/account/history' },
] as const

/** 顶栏用到的用户信息（nav 接口里那几个字段，浮层里也要用） */
interface UserInfo {
  mid: number
  uname: string
  face: string
  level: number
  money: number
  /** 大会员的昵称色（nav 的 vip_nickname_color），非大会员是空串 */
  nameColor: string
  /** nav 的 vipStatus：0 不是大会员（面板里就不显示那个「大会员」徽章） */
  vip: number
}

interface BarEls {
  host: HTMLElement
  search: HTMLElement
  form: HTMLFormElement
  input: HTMLInputElement
  panel: HTMLElement
  history: HTMLElement
  /** 历史区的滚动容器（4 行 / 展开后两种高度都在它身上，见 selfTopbar.css §3.2） */
  histories: HTMLElement
  historyList: HTMLElement
  /** 「展开 / 收起」按钮：只在内容超过 4 行时出现 */
  fold: HTMLButtonElement
  hot: HTMLElement
  hotCols: HTMLElement[]
  suggest: HTMLElement
  suggestList: HTMLElement
  avatar: HTMLAnchorElement
  avatarImg: HTMLImageElement
  login: HTMLAnchorElement
  badge: HTMLElement
  favLink: HTMLAnchorElement
}

let els: BarEls | null = null
let user: UserInfo | null = null
let hotWords: string[] | null = null
let historyWords: string[] | null = null
/** 历史写失败只提示一次（扩展上下文失效后每次搜索都会失败，别刷屏） */
let historyWriteWarned = false
let panelHtmlPromise: Promise<string> | null = null
let panelFilled = false
let suggestTimer: number | null = null
let suggestSeq = 0
let unreadTimer: number | null = null
let userLoaded = false
let activeRow = -1
let docBound = false

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = selfTopbarCss
  ;(document.head || document.documentElement).appendChild(style)
}

function removeStyle() {
  document.getElementById(STYLE_ID)?.remove()
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] || c))
}

/** 把命中的那几个字包成 <em>（自己拼，不用接口返回的 HTML —— 那段里除了 <em> 什么都不认） */
function highlight(text: string, keyword: string): string {
  const safe = escapeHtml(text)
  const kw = keyword.trim()
  if (!kw) return safe
  const at = text.toLowerCase().indexOf(kw.toLowerCase())
  if (at < 0) return safe
  return `${escapeHtml(text.slice(0, at))}<em>${escapeHtml(text.slice(at, at + kw.length))}</em>${escapeHtml(text.slice(at + kw.length))}`
}

/** 一个右侧项 + 它的悬停浮层。浮层必须挂在同一层 wrapper 里 ——
 *  这样从图标移进卡片算「没离开」，`mouseleave` 不会响，浮层就不会闪。 */
function popItem(key: string, inner: string): string {
  return `<div class="tb-item tb-item-${key}" data-pop="${key}">${inner}<div class="tb-pop"><div class="tb-pop-card"><div class="tb-pop-body"></div></div></div></div>`
}

function markup(): string {
  // 顶栏的导航一律 `target="_blank"`（用户 1.2.0 v012 要求）：动态 / 消息 / 收藏 / 历史 /
  // 头像 点下去都在右侧开新标签页，当前页（可能在播放 / 在信息流里）不被打断。
  // **例外是 logo 和「首页」（1.2.1）**：这两个是「回家」的动作，用户要的是在本页打开首页；
  // 本页本来就是首页时就刷新（见 onHomeClick）。所以它们没有 target，靠 `data-home-link` 认领。
  const NEW_TAB = 'target="_blank" rel="noreferrer"'
  const icons = RIGHT_ICONS.map(item => popItem(item.key, `<a class="tb-icon" data-key="${item.key}" href="${item.href}" ${NEW_TAB}>${item.icon}<span class="tb-icon-text">${item.label}</span><i class="tb-badge" hidden></i></a>`)).join('')
  return `<div class="tb-bar">
  <a class="tb-logo" href="${HOME_URL}" data-home-link aria-label="bilibili"><span class="bili-elite-logo__mark"></span></a>
  <div class="tb-nav">
    <div class="tb-entry tb-home">
      <a href="${HOME_URL}" data-home-link>首页<i class="tb-arrow"></i></a>
      <div id="bili-elite-home-panel"><div class="bili-elite-panel-card"><div class="bili-header-channel-panel"></div></div></div>
    </div>
    <div class="tb-entry"><a href="//t.bilibili.com/" ${NEW_TAB}>动态</a></div>
  </div>
  <div class="tb-search">
    <form class="tb-search-form" action="${SEARCH_URL}" method="get" role="search">
      <input class="tb-search-input" type="text" name="keyword" autocomplete="off" placeholder="搜索">
      <button class="tb-search-btn" type="submit" aria-label="搜索"></button>
    </form>
    <div class="tb-sp">
      <div class="tb-sp-history" hidden>
        <div class="tb-sp-head"><span class="tb-sp-title">搜索历史</span><button class="tb-sp-clear" type="button">清空</button></div>
        <div class="tb-sp-histories"><div class="tb-sp-history-list"></div></div>
        <button class="tb-sp-fold" type="button" hidden><span class="tb-sp-fold-text">展开</span><i class="tb-sp-fold-ic"></i></button>
      </div>
      <div class="tb-sp-hot" hidden>
        <div class="tb-sp-head"><span class="tb-sp-title">bilibili热搜</span></div>
        <div class="tb-sp-hot-cols">
          <div class="tb-sp-hot-col"></div>
          <div class="tb-sp-hot-col"></div>
        </div>
      </div>
      <div class="tb-sp-suggest" hidden>
        <div class="tb-sp-suggest-list"></div>
      </div>
    </div>
  </div>
  <div class="tb-right">
    ${popItem('avatar', `<a class="tb-avatar" href="//www.bilibili.com/" ${NEW_TAB} hidden><img class="tb-avatar-img" alt="" loading="lazy"></a>`)}
    <a class="tb-login" href="${LOGIN_URL}" target="_blank" rel="noreferrer"><span class="tb-login-mark">${ICON_USER}</span><span class="tb-icon-text">登录</span></a>
    ${icons}
    <a class="tb-upload" href="${UPLOAD_URL}" target="_blank" rel="noreferrer">${ICON_UPLOAD}<span>投稿</span></a>
  </div>
</div>`
}

/** ===== 频道面板（首页 ∨）===== */

function loadPanelHtml(): Promise<string> {
  if (!panelHtmlPromise) {
    // 失败就丢掉缓存。不丢的话这个 rejected promise 会一直被复用，之后每次 hover
    // 都立刻走进 catch —— 面板从此永远是空的（v017 起 prefetch 先于用户操作触发，
    // 一次网络抖动就能把面板废掉，所以这里必须自愈）。
    panelHtmlPromise = loadHomePanelHtml().catch((e) => {
      panelHtmlPromise = null
      throw e
    })
  }
  return panelHtmlPromise
}

function fillHomePanel() {
  if (panelFilled || !els) return
  const box = els.host.querySelector<HTMLElement>('#bili-elite-home-panel .bili-header-channel-panel')
  if (!box) return
  panelFilled = true
  loadPanelHtml()
    .then((html) => {
      if (els) box.innerHTML = html
    })
    .catch(() => { panelFilled = false })
}

/**
 * 首屏空闲时只**把频道面板的 HTML 取回来缓存**，不插进 DOM（1.2.5 v017）。
 *
 * 以前这里直接 `fillHomePanel()`，等于替一个「可能整场都不会被打开」的浮层提前建好
 * 389 个节点（B 站频道列表 + 分区，实测 `#bili-elite-home-panel` 子树 389 个）。
 * 那些节点从建好到页面关掉一直藏着，白占内存、白算一遍样式 —— 和「隐藏的东西不该跑」
 * 是同一个道理（参考 bilibili-margin 的 native-guard 思路）。
 *
 * 现在分两段：这里只 warm 字符串（网络提前，`panelHtmlPromise` 复用），真正 innerHTML
 * 交给 `mouseenter` / `focusin`（见 bindEvents）。那时 promise 早已 resolve，
 * 插入是同步的，用户感觉不到差别。
 */
function prefetchHomePanel() {
  const g = globalThis as any
  const warm = () => {
    loadPanelHtml().catch(() => {})
  }
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(warm, { timeout: 2500 })
  else window.setTimeout(warm, 600)
}

/** ===== 搜索历史（chrome.storage.local，跨 www / search / t 三个子站共用一份） ===== */

/**
 * 拿 `chrome.storage.local`，拿不到 / 上下文已失效就返回 null。
 *
 * 为什么整个包一层 try：内容脚本和扩展的连接会因为「在 chrome://extensions 点了重新加载 /
 * 扩展自动更新」而断掉，断掉之后这一页里的 `chrome.*` 不但用不了，**调用还会同步抛**
 * 「Extension context invalidated」。而这页的顶栏是断连之前画好的 —— 看起来一切正常，
 * 只有一碰存储才会炸（见 go()）。
 */
function localStore(): any | null {
  // 统一走 storage.ts 的 chromeApi：扩展重载 / 自动更新之后上下文会失效，
  // 那时候 `chrome.storage.local.set` 是**同步抛**的（判据与兜底都在那边）
  try {
    return chromeApi()?.storage?.local ?? null
  }
  catch {
    return null
  }
}

function readHistory(): Promise<string[]> {
  if (historyWords) return Promise.resolve(historyWords)
  return new Promise((resolve) => {
    const store = localStore()
    if (!store?.get) {
      resolve([])
      return
    }
    try {
      store.get([HISTORY_KEY], (all: Record<string, unknown>) => {
        const list = all?.[HISTORY_KEY]
        historyWords = Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []
        resolve(historyWords)
      })
    }
    catch {
      // 上下文已失效：这次就当没有历史，别把整条链路挂在这里
      resolve([])
    }
  })
}

/** 写历史是「顺手记一笔」，失败只能影响这条记录本身，绝不能影响搜索 */
function writeHistory(list: string[]) {
  historyWords = list.slice(0, HISTORY_MAX)
  try {
    localStore()?.set?.({ [HISTORY_KEY]: historyWords })
  }
  catch {
    if (!historyWriteWarned) {
      historyWriteWarned = true
      // 同 storage.ts：上下文失效是「扩展被重新加载」的预期结果，不是故障，
      // 用 error 会被 Chrome 收进扩展错误页 —— 改成 warn（默认静默，?blie-debug 才输出）
      warn('搜索历史写入失败（扩展上下文可能已失效，刷新页面可恢复）')
    }
  }
}

function pushHistory(keyword: string) {
  const kw = keyword.trim()
  if (!kw) return
  const list = (historyWords || []).filter(v => v !== kw)
  list.unshift(kw)
  writeHistory(list)
}

/** ===== 搜索面板 ===== */

/** 一行可被方向键选中的条目。`.tb-sp-row` 是「可选中」的唯一标记（见 visibleRows），
 *  三种形态（历史药丸 / 热搜两栏 / 联想单列）各自再挂一个类做排版。 */
function rowHtml(keyword: string, opts: { rank?: number, hot?: boolean, keywordForHighlight?: string } = {}): string {
  const rank = opts.rank ? `<span class="tb-sp-rank">${opts.rank}</span>` : ''
  const cls = opts.hot ? 'tb-sp-row is-hot' : 'tb-sp-row'
  return `<a class="${cls}" href="${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}" data-kw="${escapeHtml(keyword)}">${rank}<span class="tb-sp-text">${highlight(keyword, opts.keywordForHighlight || '')}</span></a>`
}

/** 历史词条：药丸标签，悬停时右上角浮出删除按钮（原版是 absolute 挂在右上角外侧，
 *  不占词条宽度，所以这里也照做 —— 布局不会因为悬停而抖） */
function chipHtml(keyword: string): string {
  return `<a class="tb-sp-row tb-sp-chip" href="${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}" data-kw="${escapeHtml(keyword)}"><span class="tb-sp-chip-text">${escapeHtml(keyword)}</span><i class="tb-sp-chip-del" role="button" aria-label="删除" title="删除"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M5.6 5.6 10.4 10.4M10.4 5.6 5.6 10.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg></i></a>`
}

function setActive(index: number) {
  if (!els) return
  const rows = Array.from(els.panel.querySelectorAll<HTMLElement>('.tb-sp-row'))
  rows.forEach(r => r.classList.remove('is-active'))
  activeRow = index
  const row = rows[index]
  if (!row) return
  row.classList.add('is-active')
  // 自己算滚动位置，不用 scrollIntoView —— 它会把祖先（含页面本身）一起滚，
  // 顶栏是 fixed，页面被滚一下用户会明显看到内容跳。
  // 历史区自己就是一个滚动容器（172px 封顶），所以要逐层往上把每个可滚动的祖先都照顾到。
  let box: HTMLElement | null = row.parentElement
  while (box) {
    if (box.scrollHeight > box.clientHeight + 1) {
      const rect = row.getBoundingClientRect()
      const top = rect.top - box.getBoundingClientRect().top + box.scrollTop
      const bottom = top + rect.height
      if (top < box.scrollTop) box.scrollTop = top
      else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
    }
    if (box === els.panel) break
    box = box.parentElement
  }
}

function visibleRows(): HTMLElement[] {
  if (!els) return []
  // 三块（历史 / 热搜 / 联想）是同时留在 DOM 里的，只是用 hidden 收起 ——
  // 不筛掉的话方向键会在看不见的行里空转（实测 rows=20、按一下跳到第 2 行）
  return Array.from(els.panel.querySelectorAll<HTMLElement>('.tb-sp-row'))
    .filter(row => !row.closest('[hidden]'))
}

/**
 * 历史区收起时的高度（px）——**必须和 selfTopbar.css §3.2 的 `max-height` 一致**。
 * 4 行 = 12（列表上边距）+ 4 × 40（药丸高度）。
 */
const HISTORY_COLLAPSED_H = 172
/** 列表自己的 `margin-top`（不计进 `offsetHeight`），算「需要多高」时要补上 */
const HISTORY_TOP_GAP = 12

/** 展开 / 收起历史区。CSS 靠 `.tb-sp-history.is-expanded` 切高度，这里只负责类与文案 */
function setHistoryExpanded(on: boolean) {
  if (!els) return
  els.history.classList.toggle('is-expanded', on)
  els.fold.classList.toggle('is-expanded', on)
  const text = els.fold.querySelector<HTMLElement>('.tb-sp-fold-text')
  if (text) text.textContent = on ? '收起' : '展开'
}

function renderHistory() {
  if (!els) return
  const list = historyWords || []
  els.history.hidden = list.length === 0
  els.historyList.innerHTML = list.map(chipHtml).join('')
  /* 「展开」按钮只在内容超过 4 行时出现（1.2.4 v013）。
   *
   * 判据用**列表自身的高度**，不用 `histories.clientHeight`：后者在展开状态下已经变大，
   * 拿它比永远「不超出」，按钮会在展开的那一刻自己消失、再也收不回来。
   * `offsetHeight` 只受内容影响，收起 / 展开两种状态下是同一个值。
   *
   * 历史区被 `hidden` 时（没有词 / 正在显示联想）`offsetHeight` 是 0，此时一律不显示按钮。 */
  const needed = els.historyList.offsetHeight + HISTORY_TOP_GAP
  const foldable = !els.history.hidden && needed > HISTORY_COLLAPSED_H + 1
  els.fold.hidden = !foldable
  // 清空 / 删到 4 行以内之后，展开态要跟着退回去，不然高度会留在「最大」上
  if (!foldable)
    setHistoryExpanded(false)
}

/**
 * 热搜分两栏：原版是「左栏 1/3/5/7/9、右栏 2/4/6/8/10」的按列填充，
 * 所以这里手动按奇偶分发，而不是靠 CSS 多列 —— 多列会把 DOM 顺序和视觉顺序拆开，
 * 方向键上下就会在左右栏之间乱跳。
 */
function fillHot(list: string[]) {
  if (!els) return
  const cols = els.hotCols
  cols.forEach((col) => {
    col.innerHTML = ''
  })
  list.forEach((kw, i) => {
    const col = cols[Math.min(i % cols.length, cols.length - 1)]
    col.insertAdjacentHTML('beforeend', rowHtml(kw, { rank: i + 1, hot: true }))
  })
}

async function renderHot() {
  if (!els) return
  if (hotWords) {
    els.hot.hidden = !!els.input.value.trim() || hotWords.length === 0
    fillHot(hotWords)
    return
  }
  els.hot.hidden = false
  // 「加载中」只放在左栏：两栏各放一份会并排出现两条一样的提示
  els.hotCols.forEach((col, i) => {
    col.innerHTML = i === 0 ? '<div class="tb-sp-empty">热搜加载中…</div>' : ''
  })
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/search/square?limit=10&platform=web', { credentials: 'include' })
    const json = await res.json()
    const list = json?.data?.trending?.list
    hotWords = Array.isArray(list)
      ? list.map((item: any) => String(item?.show_name || item?.keyword || '')).filter(Boolean).slice(0, 10)
      : []
  }
  catch {
    hotWords = []
  }
  if (!els) return
  fillHot(hotWords || [])
  // 热搜是异步回来的：等它落地时用户可能已经在输入了。这时只能把内容填进去、
  // **不能**把热搜重新露出来 —— 否则「联想 + 热搜」两段同时可见，
  // 方向键会跑到看不见的那一段里去（实测按一下选中了热搜第一条）
  els.hot.hidden = !!els.input.value.trim() || (hotWords || []).length === 0
}

/**
 * 空输入时该显示什么：搜索历史 + 热搜。
 *
 * **必须真的渲染一遍，不能只切 `hidden`**（1.2.3 v011 用户报的 bug）：
 * 原来这里只写 `history.hidden = ...` / `hot.hidden = false`，内容靠「上一次」留在 DOM 里。
 * 只要这个页面打开时输入框里本来就有字（比如搜索页会回填关键词），
 * 首次 `openPanel()` 走的是联想分支 —— 历史从没渲染过、热搜也从没请求过；
 * 用户把字删空后就只剩两个空标题条（截图里那样）。
 * 统一走这里，历史重画、热搜按需拉。
 */
function renderDefaultPanel() {
  if (!els) return
  els.suggest.hidden = true
  renderHistory()
  void renderHot()
}

function renderSuggest(keyword: string) {
  if (!els) return
  const kw = keyword.trim()
  if (!kw) {
    renderDefaultPanel()
    return
  }
  els.suggest.hidden = false
  els.history.hidden = true
  els.hot.hidden = true
  els.suggestList.innerHTML = '<div class="tb-sp-empty">搜索中…</div>'
  const seq = ++suggestSeq
  fetch(`https://s.search.bilibili.com/main/suggest?term=${encodeURIComponent(kw)}&main_ver=v1`, { credentials: 'include' })
    .then(res => res.json())
    .then((json) => {
      if (!els || seq !== suggestSeq) return
      const tags = json?.result?.tag
      const words: string[] = Array.isArray(tags)
        ? tags.map((t: any) => String(t?.value || t?.term || '')).filter(Boolean).slice(0, 10)
        : []
      els.suggestList.innerHTML = words.length
        ? words.map(w => rowHtml(w, { keywordForHighlight: kw })).join('')
        : '<div class="tb-sp-empty">没有找到相关结果</div>'
    })
    .catch(() => {
      if (els && seq === suggestSeq) els.suggestList.innerHTML = ''
    })
}

function openPanel() {
  if (!els) return
  els.search.classList.add('is-open')
  const kw = els.input.value.trim()
  if (kw) renderSuggest(kw)
  else renderDefaultPanel()
  setActive(-1)
}

function closePanel() {
  if (!els) return
  els.search.classList.remove('is-open')
  // 展开态不跨次保留：下次点开搜索框应该还是 4 行的默认样子（1.2.4 v013）
  setHistoryExpanded(false)
  setActive(-1)
}

/**
 * 打开搜索结果页。回车 / 点联想行 / 点热搜 / 点历史，四条路都走这里。
 *
 * 1.2.1 v005（用户要求）：**在新标签页打开**。搜索页不是「当前这页的下一页」——
 * 用户搜完还要回到原来那篇稿子 / 那个列表接着看，本页跳走就等于丢了位置。
 *
 * 为什么不用 `window.open(url, '_blank', 'noopener')`：带 noopener 时规范规定返回 null，
 * 就没法判断「是不是被弹窗拦截了」（拦了要退回本页跳转，否则用户看到的是点了没反应）。
 * 所以先不带 noopener 拿句柄，拿到再把 `opener` 掐掉（效果等价于 noopener），
 * 拿不到才退回本页跳转。触发点全是用户手势（submit / keydown / click），不会被拦。
 *
 * **这个函数不许抛错**（1.2.4 v010 用户报的 bug）：三个调用点（submit / keydown / 面板点击）
 * 都是先 `preventDefault()` 再进来的 —— 一旦这里抛出去，浏览器原生的表单提交也被掐掉了，
 * 用户看到的就是「回车 / 点了热搜，一点反应都没有」。
 * 实测最容易抛的就是 `pushHistory()` 里的 `chrome.storage`：页面开久了之后在
 * chrome://extensions 重新加载过扩展（或扩展自动更新），这页的内容脚本就和扩展断连了，
 * 此时 `chrome.storage.local.set` **同步抛** `Extension context invalidated`，
 * 而顶栏是断连之前画好的、面板也还能弹（热搜 / 联想都是页面世界的 fetch），
 * 于是只有「搜索」这一件事坏掉，别的看起来都正常。
 * 现在历史写失败只吞掉那一笔记录；跳转本身再兜一层「弹窗被拦 → 本页跳转 → 同址刷新」，
 * 保证每次触发都一定有反应。
 */
function go(keyword: string) {
  const kw = keyword.trim()
  if (!kw) return
  closePanel()
  // 历史是顺手记的一笔，写不进去（上下文失效 / 存储异常）也不能连搜索一起废掉
  try {
    pushHistory(kw)
  }
  catch {
    // writeHistory 内部已经兜过一次，这里是最后一道：绝不让它冒到调用点
  }
  const url = `${SEARCH_URL}?keyword=${encodeURIComponent(kw)}`
  let win: Window | null = null
  try {
    win = window.open(url, '_blank')
  }
  catch {
    win = null
  }
  if (win) {
    // 新页面不该能反过来操作我们这页（同源时 window.opener 是可读的）
    try {
      win.opener = null
    }
    catch {
      // 跨源时个别实现会拒绝写，写不上也不影响「已经开出去了」
    }
    return
  }
  // 弹窗被拦：退回本页跳转。**同址不能直接赋 href** —— 那是空操作，等于没反应
  try {
    const target = new URL(url, location.href).href
    if (target === location.href)
      location.reload()
    else
      location.href = target
  }
  catch {
    // 连 URL 都拼不出来（about:blank 之类）：交给调用点的兜底
  }
}

/** ===== 用户信息 / 未读 ===== */

function setBadge(count: number) {
  if (!els) return
  if (!count) {
    els.badge.hidden = true
    els.badge.textContent = ''
    return
  }
  els.badge.hidden = false
  els.badge.textContent = count > 99 ? '99+' : String(count)
}

function faceUrl(face: string): string {
  if (!face) return ''
  if (face.includes('@')) return face
  return `${face}@96w_96h_1c.webp`
}

/**
 * 登录态 / 头像（`nav` 接口）。**顶栏一挂上就拉**：头像和「登录」入口都靠它，
 * 晚一帧用户就会看到顶栏右边先空着再冒出来。
 */
async function loadNav(): Promise<UserInfo | null> {
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
    const nav = await res.json()
    if (!els) return null
    const data = nav?.data
    if (nav?.code === 0 && data?.isLogin) {
      const mid = Number(data.mid) || 0
      user = {
        mid,
        uname: String(data.uname || ''),
        face: String(data.face || ''),
        level: Number(data.level_info?.current_level) || 0,
        money: Number(data.money) || 0,
        nameColor: String(data.vip_nickname_color || ''),
        vip: Number(data.vipStatus) || 0,
      }
      els.avatar.hidden = false
      els.login.hidden = true
      els.avatar.href = `//space.bilibili.com/${mid}`
      els.avatarImg.src = faceUrl(user.face)
      els.avatarImg.alt = user.uname
      if (mid) els.favLink.href = `//space.bilibili.com/${mid}/favlist`
      userLoaded = true
    }
    else {
      user = null
      els.avatar.hidden = true
      els.login.hidden = false
    }
    return user
  }
  catch {
    // 没登录 / 网络失败：保持「登录」入口，不报错也不重试
    if (els && !userLoaded) {
      els.avatar.hidden = true
      els.login.hidden = false
    }
    return user
  }
}

/**
 * 消息未读数（`msgfeed/unread`）。
 *
 * **刻意不跟 `nav` 一起在首屏拉**（1.2.0 v003）：它只决定消息图标上那颗红点，
 * 晚几百毫秒没人看得出来；而首屏那 1s 里每多一个请求都在跟播放器 / 封面的关键请求
 * 抢连接。所以推到浏览器空闲再发 —— `nav` 仍然立即发（头像看得见）。
 */
async function loadUnread() {
  if (!els) return
  try {
    const res = await fetch('https://api.bilibili.com/x/msgfeed/unread?build=0&mobi_app=web', { credentials: 'include' })
    const json = await res.json()
    const d = json?.data
    if (!els || !d || typeof d !== 'object') return
    setBadge(['at', 'reply', 'like', 'sys_msg'].reduce((sum, k) => sum + (Number((d as any)[k]) || 0), 0))
  }
  catch {
    // 红点拉不到就算了，下次切回标签页还会再试（见 onVisible）
  }
}

/** 等浏览器空闲再跑（首屏不要它抢连接）；不支持 requestIdleCallback 就退化成 800ms 后 */
function whenIdle(fn: () => void) {
  const g = globalThis as any
  if (typeof g.requestIdleCallback === 'function')
    g.requestIdleCallback(fn, { timeout: 2500 })
  else
    window.setTimeout(fn, 800)
}

/** 切回标签页时刷一次未读（60s 节流；头像 / 登录态不重复拉） */
function onVisible() {
  if (document.hidden || unreadTimer !== null) return
  unreadTimer = window.setTimeout(() => {
    unreadTimer = null
    if (!els) return
    void loadUnread()
  }, 1200)
}

/** ===== 右侧悬停浮层 =====
 *  头像 / 消息照原生顶栏那两个面板的样子做（原生：头像 300 宽、消息 144 宽）；
 *  动态 / 收藏 / 历史照 BewlyCat 的 `TopBar/components/pops` 移植（380 / 450 / 380 宽，
 *  header + 列表 / 左侧收藏夹栏 + 右侧列表）。数据都在页面里直接 fetch，不绕后台。 */

const POP_TTL = 60_000
const POP_OPEN_DELAY = 120
const POP_CLOSE_DELAY = 200
/** 列表最多渲染几条（原生也是「最近 N 条 + 查看全部」） */
const POP_LIST_MAX = 8

/** 内容浮层的当前视图：切 tab / 切收藏夹之后按新视图重渲染 */
const popView = {
  dynTab: 'video' as 'video' | 'live',
  hisTab: 'archive' as 'archive' | 'live' | 'article',
  favId: 0,
}

const popCache = new Map<string, { at: number, html: string }>()
const popPending = new Set<string>()
let openPop: string | null = null
let popOpenTimer: number | null = null
let popCloseTimer: number | null = null

function apiJson(url: string, init?: RequestInit): Promise<any> {
  return fetch(url, { credentials: 'include', ...init }).then(res => res.json())
}

function getCookie(name: string): string {
  const hit = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : ''
}

/** B 站图片服务认 `@` 后缀；已经带了的不重复加 */
function thumb(url: string, size = '240w_135h_1c'): string {
  const src = String(url || '')
  if (!src) return ''
  return src.includes('@') ? src : `${src}@${size}`
}

function num(value: any): string {
  const n = Number(value) || 0
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

/** 秒 → 12:03 / 1:02:03 */
function fmtDuration(value: any): string {
  const total = Math.max(0, Math.round(Number(value) || 0))
  const pad = (n: number) => String(n).padStart(2, '0')
  const hour = Math.floor(total / 3600)
  const min = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return hour > 0 ? `${hour}:${pad(min)}:${pad(sec)}` : `${pad(min)}:${pad(sec)}`
}

/** 秒级时间戳 → 2026-10-29 14:32:50（历史面板里原生就是这么显示的） */
function fmtDateTime(ts: any): string {
  const time = Number(ts) || 0
  if (!time) return ''
  const d = new Date(time * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 接口给的跳转地址（jump_url / uri）只认 http(s) 与协议相对写法，别的当空处理 */
function safeHref(url: string): string {
  const v = String(url || '').trim()
  return /^(?:https?:)?\/\//.test(v) ? v : '#'
}

function needLogin(): string {
  return `<div class="tb-pop-empty">登录后查看<a href="${LOGIN_URL}" target="_blank" rel="noreferrer">去登录</a></div>`
}

function emptyTip(text: string): string {
  return `<div class="tb-pop-empty">${escapeHtml(text)}</div>`
}

/** 横向媒体卡（动态 / 收藏 / 历史共用）：16:9 封面在左 + 标题 + 作者行 */
function mediaCard(opts: {
  href: string
  cover: string
  title: string
  badge?: string
  progress?: number
  byline?: string
  meta?: string
  face?: string
  narrow?: boolean
  contain?: boolean
  kid?: string
}): string {
  const badge = opts.badge ? `<i class="tb-media-badge">${escapeHtml(opts.badge)}</i>` : ''
  const bar = opts.progress && opts.progress > 0
    ? `<span class="tb-media-bar"><i style="width:${Math.min(100, Math.round(opts.progress))}%"></i></span>`
    : ''
  // 删除按钮故意用 span：卡本身是 <a>，再套一个 button 就是交互元素嵌套
  const del = opts.kid
    ? `<span class="tb-media-del" role="button" data-pop-act="his-del" data-value="${escapeHtml(opts.kid)}" aria-label="删除这条记录">×</span>`
    : ''
  const byline = opts.face
    ? `<span class="tb-media-byline"><img class="tb-media-face" src="${thumb(opts.face, '48w_48h_1c')}" alt=""><span class="tb-media-author">${escapeHtml(opts.byline || '')}</span>${opts.meta ? `<span class="tb-media-time">${escapeHtml(opts.meta)}</span>` : ''}</span>`
    : `<span class="tb-media-author">${escapeHtml(opts.byline || '')}</span>`
  const meta = !opts.face && opts.meta ? `<span class="tb-media-meta">${escapeHtml(opts.meta)}</span>` : ''
  return `<a class="tb-media${opts.narrow ? ' is-narrow' : ''}" href="${safeHref(opts.href)}" target="_blank" rel="noreferrer"><span class="tb-media-col"><span class="tb-media-frame"><img src="${thumb(opts.cover)}" alt="" loading="lazy"${opts.contain ? ' class="is-contain"' : ''}>${badge}</span>${bar}${del}</span><span class="tb-media-copy"><span class="tb-media-title">${escapeHtml(opts.title)}</span>${byline}${meta}</span></a>`
}

async function ensureUser(): Promise<UserInfo | null> {
  if (user) return user
  return loadNav()
}

/** ===== 头像面板（照原生：去掉「尊贵的大会员」横幅，其余一样） ===== */

async function buildAvatarPop(): Promise<string> {
  const info = await ensureUser()
  if (!info) return needLogin()
  const mid = info.mid
  const [rel, up] = await Promise.all([
    apiJson(`https://api.bilibili.com/x/relation/stat?vmid=${mid}`).catch(() => null),
    apiJson(`https://api.bilibili.com/x/space/upstat?mid=${mid}`).catch(() => null),
  ])
  const d = rel?.data || {}
  // 原生第三格是「动态数」，那个数只在 B 站自己的页面状态里（接口要 wbi 签名），
  // 这里换成同样能拿到的「获赞」，三个数照样是「关注 / 粉丝 / 获赞」
  const likes = up?.data?.likes
  // 大会员的昵称色跟着 B 站给的值走（非大会员是空串，退回正文色）
  const nameColor = /^#[\da-f]{3,8}$/i.test(info.nameColor) ? info.nameColor : ''
  return `<div class="tb-user">
  <a class="tb-user-face-link" href="//space.bilibili.com/${mid}" target="_blank" rel="noreferrer"><img class="tb-user-face" src="${thumb(info.face, '96w_96h_1c')}" alt=""></a>
  <a class="tb-user-name"${nameColor ? ` style="color:${nameColor}"` : ''} href="//space.bilibili.com/${mid}" target="_blank" rel="noreferrer">${escapeHtml(info.uname)}</a>
  <div class="tb-user-badges">${info.vip ? '<span class="tb-user-vip">大会员</span>' : ''}<span class="tb-user-level">LV${info.level}</span></div>
  <div class="tb-user-coins"><a href="//account.bilibili.com/site/coin" target="_blank" rel="noreferrer"><span>硬币:</span><b>${info.money}</b></a><a href="//pay.bilibili.com/pay-v2-web/bcoin_index" target="_blank" rel="noreferrer"><span>B币:</span><b>0</b></a></div>
  <div class="tb-user-counts">
    <a href="//space.bilibili.com/${mid}/fans/follow" target="_blank" rel="noreferrer"><b>${num(d.following)}</b><span>关注</span></a>
    <a href="//space.bilibili.com/${mid}/fans/fans" target="_blank" rel="noreferrer"><b>${num(d.follower)}</b><span>粉丝</span></a>
    <a href="//space.bilibili.com/${mid}/dynamic" target="_blank" rel="noreferrer"><b>${num(likes)}</b><span>获赞</span></a>
  </div>
  <div class="tb-user-links">
    <a class="tb-user-link" href="https://account.bilibili.com/account/home" target="_blank" rel="noreferrer">${ICON_ME}<span>个人中心</span></a>
    <a class="tb-user-link" href="https://member.bilibili.com/platform/upload-manager/article" target="_blank" rel="noreferrer">${ICON_MANAGE}<span>投稿管理</span></a>
  </div>
  <div class="tb-user-split"></div>
  <button class="tb-user-link is-logout" type="button" data-pop-act="logout">${ICON_LOGOUT}<span>退出登录</span></button>
</div>`
}

/** ===== 消息面板（照原生：144 宽、五行文字、未读跟在文字后面） ===== */

async function buildMsgPop(): Promise<string> {
  if (!await ensureUser()) return needLogin()
  const [feed, dm] = await Promise.all([
    apiJson('https://api.bilibili.com/x/msgfeed/unread?build=0&mobi_app=web').catch(() => null),
    // 私信在另一个域名（vc），失败就按 0 处理，不影响其它几行
    apiJson('https://api.vc.bilibili.com/session_svr/v1/session_svr/single_unread?build=0&mobi_app=web&unread_type=0').catch(() => null),
  ])
  const d = feed?.data || {}
  const dmCount = dm?.data
    ? (Number(dm.data.follow_unread) || 0) + (Number(dm.data.unfollow_unread) || 0)
    : 0
  const rows: Array<[string, string, number]> = [
    ['回复我的', '//message.bilibili.com/#/reply', Number(d.reply) || 0],
    ['@我的', '//message.bilibili.com/#/at', Number(d.at) || 0],
    ['收到的赞', '//message.bilibili.com/#/love', Number(d.like) || 0],
    ['系统消息', '//message.bilibili.com/#/system', Number(d.sys_msg) || 0],
    ['我的消息', '//message.bilibili.com/#/whisper', dmCount],
  ]
  return `<div class="tb-msg-list">${rows.map(([label, href, count]) => `<a class="tb-msg-item" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(label)}${count > 0 ? `<i class="tb-msg-count">${count > 99 ? '99+' : count}</i>` : ''}</a>`).join('')}</div>`
}

/** ===== 动态面板（BewlyCat MomentsPop：视频 / 直播两个 tab） ===== */

async function buildDynPop(): Promise<string> {
  if (!await ensureUser()) return needLogin()
  const tab = popView.dynTab
  const items: any[] = tab === 'live'
    ? (await apiJson('https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/FeedList?page=1&pagesize=10').catch(() => null))?.data?.list || []
    : (await apiJson('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/nav?type=video').catch(() => null))?.data?.items || []

  const cards = items.slice(0, POP_LIST_MAX).map((item: any) => tab === 'live'
    ? mediaCard({
        href: `//live.bilibili.com/${item.roomid}`,
        cover: String(item.cover || item.pic || ''),
        title: String(item.title || ''),
        byline: String(item.uname || ''),
        face: String(item.face || ''),
        meta: '直播中',
        narrow: true,
      })
    : mediaCard({
        href: String(item.jump_url || '//t.bilibili.com/'),
        cover: String(item.cover || ''),
        title: String(item.title || ''),
        byline: String(item.author?.name || ''),
        face: String(item.author?.face || ''),
        meta: String(item.pub_time || ''),
        narrow: true,
      })).join('')

  return `<header class="tb-pop-head"><div class="tb-pop-tabs"><button class="tb-pop-tab${tab === 'video' ? ' is-active' : ''}" type="button" data-pop-act="dyn-tab" data-value="video">视频</button><button class="tb-pop-tab${tab === 'live' ? ' is-active' : ''}" type="button" data-pop-act="dyn-tab" data-value="live">直播</button></div><a class="tb-pop-action" href="//t.bilibili.com/" target="_blank" rel="noreferrer">查看全部</a></header>
<div class="tb-pop-list">${cards || emptyTip('最近还没有新内容')}</div>`
}

/** ===== 收藏面板（BewlyCat FavoritesPop：左收藏夹栏 + 右内容） ===== */

async function buildFavPop(): Promise<string> {
  const info = await ensureUser()
  if (!info) return needLogin()
  const mid = info.mid
  const catRes = await apiJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}&web_location=333.1387`).catch(() => null)
  const cats: any[] = Array.isArray(catRes?.data?.list) ? catRes.data.list : []
  if (!cats.length) return emptyTip('还没有收藏夹')

  // 选中的收藏夹可能被删了 / 第一次打开：落到第一个
  if (!popView.favId || !cats.some(item => Number(item.id) === popView.favId))
    popView.favId = Number(cats[0].id)
  const active = cats.find(item => Number(item.id) === popView.favId) || cats[0]

  const listRes = await apiJson(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${popView.favId}&pn=1&ps=${POP_LIST_MAX}&platform=web`).catch(() => null)
  const medias: any[] = Array.isArray(listRes?.data?.medias) ? listRes.data.medias.filter(Boolean) : []
  const cards = medias.map(item => mediaCard({
    href: item.bvid ? `//www.bilibili.com/video/${item.bvid}` : `//www.bilibili.com/audio/au${item.id}`,
    cover: String(item.cover || ''),
    title: String(item.title || ''),
    badge: fmtDuration(item.duration),
    byline: String(item.upper?.name || ''),
    narrow: true,
  })).join('')

  return `<header class="tb-pop-head"><h3 class="tb-pop-title" title="${escapeHtml(String(active.title || ''))}">${escapeHtml(String(active.title || ''))}</h3><div class="tb-pop-actions"><a class="tb-pop-action" href="//www.bilibili.com/list/ml${popView.favId}" target="_blank" rel="noreferrer">播放全部</a><a class="tb-pop-action" href="//space.bilibili.com/${mid}/favlist?fid=${popView.favId}&ftype=create" target="_blank" rel="noreferrer">查看全部</a></div></header>
<div class="tb-pop-split"><aside class="tb-fav-side">${cats.map(item => `<button class="tb-fav-cat${Number(item.id) === popView.favId ? ' is-active' : ''}" type="button" title="${escapeHtml(String(item.title || ''))}" data-pop-act="fav-cat" data-value="${item.id}">${escapeHtml(String(item.title || ''))}</button>`).join('')}</aside><div class="tb-pop-list">${cards || emptyTip('这个收藏夹还是空的')}</div></div>`
}

/** ===== 历史面板（BewlyCat HistoryPop：视频 / 直播 / 专栏三个 tab） ===== */

async function buildHisPop(): Promise<string> {
  if (!await ensureUser()) return needLogin()
  const tab = popView.hisTab
  const query = `ps=${POP_LIST_MAX}&type=${tab === 'archive' ? '' : tab}&view_at=0`
  const res = await apiJson(`https://api.bilibili.com/x/web-interface/history/cursor?${query}`).catch(() => null)
  const list: any[] = Array.isArray(res?.data?.list) ? res.data.list : []

  const cards = list.map((item: any) => {
    const business = String(item?.history?.business || 'archive')
    const kid = `${business}_${item?.history?.oid ?? item?.kid ?? ''}`
    if (tab === 'article') {
      return mediaCard({
        href: `//www.bilibili.com/read/cv${item?.history?.oid || item?.kid || ''}`,
        cover: String(Array.isArray(item?.covers) ? item.covers[0] : ''),
        title: String(item?.title || ''),
        byline: String(item?.author_name || ''),
        meta: fmtDateTime(item?.view_at),
        contain: true,
      })
    }
    if (tab === 'live') {
      return mediaCard({
        href: String(item?.uri || `//live.bilibili.com/${item?.history?.oid || ''}`),
        cover: String(item?.cover || ''),
        title: String(item?.title || ''),
        badge: Number(item?.live_status) === 1 ? 'LIVE' : 'OFFLINE',
        byline: String(item?.author_name || ''),
        meta: fmtDateTime(item?.view_at),
        kid,
      })
    }
    const progress = Number(item?.progress) || 0
    const duration = Number(item?.duration) || 0
    return mediaCard({
      href: String(item?.uri || `//www.bilibili.com/video/${item?.history?.bvid || ''}`),
      cover: String(item?.cover || ''),
      title: String(item?.title || ''),
      // progress = -1 表示看完了，和原生一样直接显示总时长
      badge: duration > 0 ? `${fmtDuration(progress === -1 ? duration : progress)} / ${fmtDuration(duration)}` : '',
      progress: duration > 0 ? (Math.max(0, progress) / duration) * 100 : 0,
      byline: String(item?.author_name || ''),
      meta: fmtDateTime(item?.view_at),
      kid,
    })
  }).join('')

  const tabs: Array<[string, string]> = [['archive', '视频'], ['live', '直播'], ['article', '专栏']]
  return `<header class="tb-pop-head"><div class="tb-pop-tabs">${tabs.map(([value, label]) => `<button class="tb-pop-tab${tab === value ? ' is-active' : ''}" type="button" data-pop-act="his-tab" data-value="${value}">${label}</button>`).join('')}</div><a class="tb-pop-action" href="//www.bilibili.com/history" target="_blank" rel="noreferrer">查看全部</a></header>
<div class="tb-pop-list">${cards || emptyTip('这里还没有记录')}</div>`
}

function buildPop(key: string): Promise<string> {
  switch (key) {
    case 'avatar': return buildAvatarPop()
    case 'msg': return buildMsgPop()
    case 'dyn': return buildDynPop()
    case 'fav': return buildFavPop()
    case 'his': return buildHisPop()
    default: return Promise.resolve('')
  }
}

/** 内容随视图变（tab / 收藏夹），缓存键要把视图带进去 */
function popCacheKey(key: string): string {
  if (key === 'dyn') return `dyn:${popView.dynTab}`
  if (key === 'his') return `his:${popView.hisTab}`
  if (key === 'fav') return `fav:${popView.favId}`
  return key
}

function itemEl(key: string): HTMLElement | null {
  return els?.host.querySelector<HTMLElement>(`.tb-item[data-pop="${key}"]`) || null
}

/**
 * 只换列表、不动头部（切 tab / 换收藏夹时用）。
 *
 * 为什么：`body.innerHTML = html` 会把 tab 节点一起换掉，那圈淡蓝擦除刚长到一半
 * 就连节点一起没了（接口快的时候只看得见几十毫秒，看起来就像「没有动效」）。
 * 所以只把新 HTML 里的 `.tb-pop-list` 抠出来替换 —— 头部保持原节点，动画能跑完。
 * 新 HTML 里没有列表（未登录 / 空收藏夹这类空态）时返回 false，退回整块替换。
 */
function patchPopList(body: HTMLElement, html: string): boolean {
  const cur = body.querySelector<HTMLElement>('.tb-pop-list')
  if (!cur) return false
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const next = tpl.content.querySelector<HTMLElement>('.tb-pop-list')
  if (!next) return false
  cur.replaceWith(next)
  return true
}

function fillPop(key: string, force = false, focusToken = '', soft = false) {
  const body = itemEl(key)?.querySelector<HTMLElement>('.tb-pop-body')
  if (!body) return
  const cacheKey = popCacheKey(key)
  const cached = popCache.get(cacheKey)
  if (!force && cached && Date.now() - cached.at < POP_TTL) {
    if (!body.innerHTML) body.innerHTML = cached.html
    return
  }
  if (popPending.has(key)) return
  popPending.add(key)
  if (!body.innerHTML) body.innerHTML = emptyTip('加载中…')
  buildPop(key)
    .then((html) => {
      // buildFavPop 可能改了 popView.favId，缓存键要按构建后的视图再算一次
      popCache.set(popCacheKey(key), { at: Date.now(), html })
      if (!body.isConnected) return
      // soft：切 tab / 换收藏夹，头部节点不能重建（见 patchPopList 的注释）
      if (!(soft && patchPopList(body, html))) body.innerHTML = html
      // 键盘 / 鼠标点过的那个控件在新内容里还在的话，把焦点还给它
      // （不然按 Enter 切完 tab 焦点就掉到 body 上，下一次 Tab 从页面开头开始）
      if (focusToken) {
        const [action, value] = focusToken.split('|')
        const next = body.querySelector<HTMLElement>(`[data-pop-act="${action}"][data-value="${value}"]`)
          || body.querySelector<HTMLElement>(`[data-pop-act="${action}"]`)
        next?.focus({ preventScroll: true })
      }
    })
    .catch(() => {
      if (body.isConnected) body.innerHTML = emptyTip('加载失败，稍后再试')
    })
    .finally(() => popPending.delete(key))
}

function setPopOpen(key: string | null) {
  if (!els) return
  els.host.querySelectorAll<HTMLElement>('.tb-item.is-open').forEach((item) => {
    if (item.dataset.pop !== key) item.classList.remove('is-open')
  })
  openPop = key
  if (!key) return
  const item = itemEl(key)
  if (!item) return
  item.classList.add('is-open')
  fillPop(key)
}

function closePopNow() {
  if (popOpenTimer !== null) {
    window.clearTimeout(popOpenTimer)
    popOpenTimer = null
  }
  if (popCloseTimer !== null) {
    window.clearTimeout(popCloseTimer)
    popCloseTimer = null
  }
  setPopOpen(null)
}

function openPopNow(key: string) {
  if (popOpenTimer !== null) {
    window.clearTimeout(popOpenTimer)
    popOpenTimer = null
  }
  if (popCloseTimer !== null) {
    window.clearTimeout(popCloseTimer)
    popCloseTimer = null
  }
  setPopOpen(key)
}

function schedulePop(key: string) {
  if (popCloseTimer !== null) {
    window.clearTimeout(popCloseTimer)
    popCloseTimer = null
  }
  if (openPop === key) return
  if (popOpenTimer !== null) window.clearTimeout(popOpenTimer)
  // 已经有一块浮层开着 = 用户正在这几个图标之间来回看。这时不该再等那 120ms 的
  // 「悬停意图确认」（那是为了防「扫过去顺手带开」），否则每挪一格都要顿一下，
  // 连着挪三个图标就像卡住了。直接换。
  if (openPop) {
    popOpenTimer = null
    setPopOpen(key)
    return
  }
  popOpenTimer = window.setTimeout(() => {
    popOpenTimer = null
    setPopOpen(key)
  }, POP_OPEN_DELAY)
}

function schedulePopClose(key: string) {
  if (popOpenTimer !== null) {
    window.clearTimeout(popOpenTimer)
    popOpenTimer = null
  }
  if (openPop !== key) return
  if (popCloseTimer !== null) window.clearTimeout(popCloseTimer)
  popCloseTimer = window.setTimeout(() => {
    popCloseTimer = null
    // 指针还在这一项里就别关。切 tab / 换收藏夹会把浮层内容整块重渲染，
    // 被移除的那个按钮如果正握着焦点，会甩出一个 focusout —— 那不是「用户离开了浮层」，
    // 以前就是被这一下关掉的（点了「直播」浮层直接消失）。
    if (openPop === key && !itemEl(key)?.matches(':hover')) setPopOpen(null)
  }, POP_CLOSE_DELAY)
}

/** 退出登录：和 B 站一样 POST 一次 passport，成功后跳它给的地址 */
async function logout() {
  try {
    const body = new URLSearchParams({ biliCSRF: getCookie('bili_jct'), gourl: 'https://www.bilibili.com/' }).toString()
    const res = await fetch('https://passport.bilibili.com/login/exit/v2', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const json = await res.json()
    location.href = json?.data?.redirectUrl || json?.data?.redirect_url || 'https://www.bilibili.com/'
  }
  catch {
    location.href = 'https://www.bilibili.com/'
  }
}

/** 删一条历史记录（历史面板封面右上角那个 ×） */
async function removeHistoryItem(node: HTMLElement, kid: string) {
  if (!kid) return
  try {
    const body = new URLSearchParams({ kid, csrf: getCookie('bili_jct') }).toString()
    const json = await apiJson('https://api.bilibili.com/x/v2/history/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (json?.code !== 0) return
    node.closest('.tb-media')?.remove()
    popCache.delete(popCacheKey('his'))
  }
  catch {}
}

function refreshPop(key: string) {
  // 记住当前焦点落在哪个控件上，重渲染后还回去（见 fillPop 的 focusToken）
  const active = document.activeElement as HTMLElement | null
  const inPop = active?.closest?.('.tb-pop-body')
  const focusToken = inPop ? `${active?.dataset.popAct || ''}|${active?.dataset.value || ''}` : ''
  popCache.delete(popCacheKey(key))
  // soft = 只换列表，头部（tab / 收藏夹栏）留着 —— 切过去的擦除动画才跑得完
  fillPop(key, true, focusToken, true)
}

/**
 * 点下去的当下就把选中态挪过去。
 *
 * 为什么不能只靠重渲染：切 tab / 换收藏夹都要等接口回来（几百毫秒），而
 * `refreshPop` 是 `body.innerHTML = html` **整块重建** —— 新节点一出生就是
 * `background-size: 100%`，CSS transition 没有「变化」可补间，那圈淡蓝擦除永远看不见。
 * 所以先在当前 DOM 上切类（同一个节点从 0% 长到 100%，动画才成立），
 * 数据回来重渲染时新节点的 is-active 本来就在，两边不会闪。
 *
 * `scope` 取按钮的父级：tab 在 .tb-pop-tabs 里、收藏夹在 .tb-fav-side 里，
 * 各自互不干扰（历史浮层同时有 tab 与列表，别跨容器找）。
 */
function activateNow(node: HTMLElement, selector: string) {
  const scope = node.parentElement
  if (!scope) return
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(selector)))
    el.classList.toggle('is-active', el === node)
}

/** 浮层里的交互（tab / 收藏夹 / 退出登录 / 删历史）统一走事件委托 */
function onPopClick(event: Event) {
  const node = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-pop-act]')
  if (!node) return
  const action = node.dataset.popAct
  const value = node.dataset.value || ''
  if (action === 'dyn-tab') {
    event.preventDefault()
    if (popView.dynTab === value) return
    popView.dynTab = value as 'video' | 'live'
    activateNow(node, '.tb-pop-tab')
    refreshPop('dyn')
    return
  }
  if (action === 'his-tab') {
    event.preventDefault()
    if (popView.hisTab === value) return
    popView.hisTab = value as 'archive' | 'live' | 'article'
    activateNow(node, '.tb-pop-tab')
    refreshPop('his')
    return
  }
  if (action === 'fav-cat') {
    event.preventDefault()
    const id = Number(value) || 0
    if (!id || popView.favId === id) return
    popView.favId = id
    activateNow(node, '.tb-fav-cat')
    refreshPop('fav')
    return
  }
  if (action === 'logout') {
    event.preventDefault()
    void logout()
    return
  }
  if (action === 'his-del') {
    // 卡片是 <a>，不拦默认动作就会顺手跳走
    event.preventDefault()
    event.stopPropagation()
    void removeHistoryItem(node, value)
  }
}

/** ===== 事件 ===== */

/** 本页是不是 B 站首页（`/index.html` 也算，两种入口都有；带 ?spm_id_from 之类仍是 `/`） */
function isHomePage(): boolean {
  return location.hostname === 'www.bilibili.com'
    && (location.pathname === '/' || location.pathname === '/index.html')
}

/** 顶栏左右边距要跟内容对齐的页面（见 ROOT_EDGE 的注释） */
function isEdgePage(): boolean {
  const host = location.hostname
  // 动态页（1.2.1 v002）：内容区是居中的三栏，跟内容本身没有「一条边」可对，
  // 但用户要求顶栏和视频页保持同一条边 —— 顶栏是全局导航，不跟着某一栏走。
  if (host === 't.bilibili.com') return true
  if (host === 'search.bilibili.com') return true
  if (host !== 'www.bilibili.com') return false
  const path = location.pathname
  return path === '/' || path === '/index.html' || path.startsWith('/video/')
}

/**
 * logo / 「首页」：在本页打开首页，本页就是首页时刷新（1.2.1 用户要求）。
 *
 * 以前这两个是 `target="_blank"`，点一下在右边多开一个首页标签 —— 用户从播放页「回家」
 * 会留下一个还在播的旧标签。现在改成同页导航。
 *
 * 带修饰键（Ctrl / Cmd / Shift / Alt）时**不拦**：那是用户明确要新开一个标签页，
 * 浏览器对同页链接照样会新开，交给它就行。
 */
function onHomeClick(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  closePopNow()
  closePanel()
  if (isHomePage()) location.reload()
  else location.href = HOME_URL
}

function onDocPointerDown(event: Event) {
  if (!els) return
  const target = event.target as Node | null
  if (target && !els.search.contains(target)) closePanel()
  // 点顶栏以外的地方：浮层立即收（浮层自己挂在 .tb-item 里，点它不算外面）
  const node = target as HTMLElement | null
  if (openPop && (!node || !node.closest?.('.tb-item'))) closePopNow()
}

function onKeyDown(event: KeyboardEvent) {
  if (!els) return
  const open = els.search.classList.contains('is-open')
  if (event.key === 'Escape') {
    if (open) {
      closePanel()
      els.input.blur()
      event.stopPropagation()
    }
    return
  }
  if (!open) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const rows = visibleRows()
    if (!rows.length) return
    event.preventDefault()
    const next = event.key === 'ArrowDown'
      ? (activeRow + 1) % rows.length
      : (activeRow - 1 + rows.length) % rows.length
    setActive(next)
  }
  else if (event.key === 'Enter' && activeRow >= 0) {
    const row = visibleRows()[activeRow]
    // 选中行可能已经过期（输入变了、列表重画过）。**拿不到关键词就不拦这一下** ——
    // 拦了却没跳，回车就变成「点了没反应」；放行则走表单提交，照样能搜
    const kw = row?.dataset.kw || ''
    if (kw) {
      event.preventDefault()
      go(kw)
    }
  }
}

function onPanelClick(event: Event) {
  if (!els) return
  const node = event.target as HTMLElement | null
  // 历史区的「展开 / 收起」（1.2.4 v013）：只切一个类，高度交给 CSS
  if (node?.closest('.tb-sp-fold')) {
    event.preventDefault()
    setHistoryExpanded(!els.history.classList.contains('is-expanded'))
    return
  }
  // 「清空」与单条删除都在面板里，统一走这里的事件委托
  if (node?.closest('.tb-sp-clear')) {
    event.preventDefault()
    writeHistory([])
    renderHistory()
    return
  }
  const del = node?.closest<HTMLElement>('.tb-sp-chip-del')
  if (del) {
    event.preventDefault()
    event.stopPropagation()
    const kw = del.closest<HTMLElement>('.tb-sp-chip')?.dataset.kw || ''
    writeHistory((historyWords || []).filter(v => v !== kw))
    renderHistory()
    return
  }
  const target = node?.closest<HTMLElement>('.tb-sp-row')
  if (!target) return
  event.preventDefault()
  go(target.dataset.kw || '')
}

function onScroll() {
  // 页面滚动**不再关闭搜索面板**（1.2.1 v029，用户要求）。
  // 面板里的历史区本身就是 172px 的滚动容器，热搜 / 联想也可能要滚 —— 滚轮一动就把
  // 面板收掉，等于「想滚列表反而把它关了」。关面板的入口还有三个，够用：
  // 点面板外（pointerdown 捕获）、Esc、选词或点「取消」之后。
  // 悬停浮层仍然照关：它是鼠标悬停出来的，页面滚走了本来就该收。
  if (openPop) closePopNow()
}

/**
 * 面板内的滚轮：面板里滚不动的时候，别让它顺着滚动链把页面滚走。
 *
 * 1.2.1 v029 起滚轮不再关闭面板（见 onScroll），但面板自己没得滚时，滚轮会带动页面 ——
 * 面板钉在顶栏下面不动、页面内容却在跳，看着像「面板卡住了」。所以这里只拦「滚不动」
 * 的那种：历史区（172px 封顶）与联想列表还能滚的时候一律放行，交给浏览器自己滚。
 */
function onPanelWheel(event: WheelEvent) {
  if (!els || !event.deltaY) return
  let node = event.target as HTMLElement | null
  while (node) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const canDown = event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1
      const canUp = event.deltaY < 0 && node.scrollTop > 0
      if (canDown || canUp) return
    }
    if (node === els.panel) break
    node = node.parentElement
  }
  event.preventDefault()
}

function bind() {
  if (!els || docBound) return
  docBound = true
  const { form, input, search, panel } = els

  input.addEventListener('focus', () => {
    closePopNow()
    search.classList.add('is-focus')
    openPanel()
  })
  input.addEventListener('blur', () => {
    search.classList.remove('is-focus')
  })
  input.addEventListener('input', () => {
    if (!els) return
    // 只负责「把面板打开」，内容交给防抖 —— openPanel 会立刻渲染一次，
    // 紧接着防抖再渲染一次，等于一次输入打两次联想接口
    els.search.classList.add('is-open')
    if (suggestTimer !== null) window.clearTimeout(suggestTimer)
    suggestTimer = window.setTimeout(() => {
      suggestTimer = null
      if (els) renderSuggest(els.input.value)
    }, 220)
  })
  form.addEventListener('submit', (event) => {
    // 先掐掉原生提交（我们自己开新标签页），但**必须留一条兜底**：
    // 万一 go() 里出了意料之外的错，这一下就彻底没反应了。交回浏览器原生 GET
    // （form 本身 action=搜索页 + method=get），代价只是本页跳转，但一定搜得出来
    event.preventDefault()
    try {
      go(input.value)
    }
    catch (e) {
      error('搜索跳转失败，退回本页提交', e)
      try {
        form.submit()
      }
      catch {
        // 连原生提交都失败（表单被拆掉之类），无能为力
      }
    }
  })
  panel.addEventListener('click', onPanelClick)
  // non-passive：滚不动的时候要 preventDefault 拦住滚动链（见 onPanelWheel）
  panel.addEventListener('wheel', onPanelWheel, { passive: false })
  document.addEventListener('pointerdown', onDocPointerDown, true)
  // 键盘事件挂在输入框自己身上，不挂 document / window：
  // B 站在 window 上有一批捕获阶段的快捷键监听（播放器空格、方向键），
  // 实测挂在 document 捕获阶段的处理函数根本收不到 ArrowDown / Escape。
  input.addEventListener('keydown', onKeyDown)
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', onVisible)

  els.host.querySelector('.tb-home')?.addEventListener('mouseenter', fillHomePanel)
  els.host.querySelector('.tb-home')?.addEventListener('focusin', fillHomePanel)

  // logo + 「首页」：本页打开首页 / 本页是首页则刷新（见 onHomeClick）
  els.host.querySelectorAll<HTMLAnchorElement>('a[data-home-link]').forEach((link) => {
    link.addEventListener('click', onHomeClick)
  })

  // 右侧五个项的悬停浮层。监听挂在 .tb-item 上（浮层是它的子节点），
  // 所以「图标 → 卡片」这一段不会触发 mouseleave。
  els.host.querySelectorAll<HTMLElement>('.tb-item[data-pop]').forEach((item) => {
    const key = item.dataset.pop || ''
    if (!key) return
    item.addEventListener('mouseenter', () => schedulePop(key))
    item.addEventListener('mouseleave', () => schedulePopClose(key))
    item.addEventListener('focusin', () => openPopNow(key))
    item.addEventListener('focusout', () => {
      // 正在重渲染（切 tab / 换收藏夹）时焦点是「跟着被删掉的那个按钮一起没的」，
      // 不是用户离开了浮层 —— 这时候排一次关闭，浮层就会自己消失
      if (popPending.has(key)) return
      schedulePopClose(key)
    })
  })
  // 浮层内部（tab / 收藏夹 / 主题 / 退出登录 / 删历史）走事件委托：
  // 浮层内容每次重渲染都换掉，逐个子节点绑定不现实
  els.host.addEventListener('click', onPopClick)
}

function unbind() {
  if (!docBound) return
  docBound = false
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  els?.input.removeEventListener('keydown', onKeyDown)
  els?.panel.removeEventListener('wheel', onPanelWheel)
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('visibilitychange', onVisible)
  if (suggestTimer !== null) window.clearTimeout(suggestTimer)
  if (unreadTimer !== null) window.clearTimeout(unreadTimer)
  suggestTimer = null
  unreadTimer = null
  if (popOpenTimer !== null) window.clearTimeout(popOpenTimer)
  if (popCloseTimer !== null) window.clearTimeout(popCloseTimer)
  popOpenTimer = null
  popCloseTimer = null
  openPop = null
}

/** ===== 生命周期 ===== */

function mount() {
  if (els) return
  const host = document.createElement('div')
  host.id = HOST_ID
  host.innerHTML = markup()
  document.documentElement.appendChild(host)

  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)
  els = {
    host,
    search: q<HTMLElement>('.tb-search')!,
    form: q<HTMLFormElement>('.tb-search-form')!,
    input: q<HTMLInputElement>('.tb-search-input')!,
    panel: q<HTMLElement>('.tb-sp')!,
    history: q<HTMLElement>('.tb-sp-history')!,
    histories: q<HTMLElement>('.tb-sp-histories')!,
    historyList: q<HTMLElement>('.tb-sp-history-list')!,
    fold: q<HTMLButtonElement>('.tb-sp-fold')!,
    hot: q<HTMLElement>('.tb-sp-hot')!,
    hotCols: Array.from(host.querySelectorAll<HTMLElement>('.tb-sp-hot-col')),
    suggest: q<HTMLElement>('.tb-sp-suggest')!,
    suggestList: q<HTMLElement>('.tb-sp-suggest-list')!,
    avatar: q<HTMLAnchorElement>('.tb-avatar')!,
    avatarImg: q<HTMLImageElement>('.tb-avatar-img')!,
    login: q<HTMLAnchorElement>('.tb-login')!,
    badge: q<HTMLElement>('.tb-icon[data-key="msg"] .tb-badge')!,
    favLink: q<HTMLAnchorElement>('.tb-icon[data-key="fav"]')!,
  }

  bind()
  prefetchHomePanel()
  syncKeywordFromUrl()
  void loadNav()
  // 未读红点不占首屏：等空闲（见 loadUnread 的注释）
  whenIdle(() => { void loadUnread() })
  void readHistory().then(() => {
    if (els && els.search.classList.contains('is-open') && !els.input.value.trim()) renderHistory()
  })
}

function unmount() {
  unbind()
  els?.host.remove()
  els = null
  user = null
  panelFilled = false
  hotWords = null
  activeRow = -1
  userLoaded = false
  openPop = null
  popCache.clear()
  popPending.clear()
}

/** 搜索页：把地址栏里的关键词回填到我们自己的搜索框（原生顶栏那版也有这一步） */
function syncKeywordFromUrl() {
  if (!els) return
  if (location.hostname !== 'search.bilibili.com') return
  const kw = new URLSearchParams(location.search).get('keyword') || ''
  if (kw && document.activeElement !== els.input) els.input.value = kw
}

/** 「投稿按钮移除」：只切一个 root class，纯 CSS 生效（见 selfTopbar.css §4） */
function applyUploadHide(on: boolean) {
  document.documentElement.classList.toggle(ROOT_NO_UPLOAD, on)
}

function apply(enabled: boolean) {
  document.documentElement.classList.toggle(ROOT_ON, enabled)
  // 边距类跟顶栏一起挂：顶栏不在时它不命中任何元素，但留着会让「关掉再打开」少一次重排
  document.documentElement.classList.toggle(ROOT_EDGE, enabled && isEdgePage())
  if (enabled) {
    injectStyle()
    mount()
    applyUploadHide(get('uploadBtnHide'))
  }
  else {
    unmount()
    removeStyle()
    applyUploadHide(false)
  }
}

/** 参与涟漪的控件（浮层 + 顶栏本体 + 搜索面板词条，1.2.5 v029 扩）。
 *  设置面板那套选择器在这边一个都不命中，所以单独给一份。
 *  顶栏关掉时这些选择器一个都不命中，监听留着没有副作用（见 setupSelfTopbar 的注释）。 */
const TOPBAR_RIPPLE = [
  '.tb-pop-tab', // 视频 / 直播 / 番剧 等分类
  '.tb-pop-action', // 「查看全部」「播放全部」
  '.tb-fav-cat', // 收藏夹侧栏
  '.tb-media', // 动态 / 历史 / 收藏的内容卡
  '.tb-media-del', // 历史卡的删除按钮
  '.tb-pop-empty a', // 空态里的「去登录」
  '.tb-entry > a', // 首页 / 动态（顶栏按钮，v029）
  '.tb-icon', // 右侧 消息 / 动态 / 收藏 / 历史 图标（v029）
  '.tb-login', // 未登录的人像按钮（v029）
  '.tb-upload', // 投稿胶囊（v029）
  '.tb-sp-chip', // 搜索面板的搜索历史药丸（v029）
  '.tb-sp-hot-col .tb-sp-row', // 搜索面板的热搜词条（不含联想行，v029）
].join(',')

export function setupSelfTopbar(): () => void {
  // 个人空间 / 历史 / 直播站：整条顶栏保持 B 站原版（与顶栏改造同一套排除）
  if (isExcluded()) return () => {}

  const off = onConfigChange((key) => {
    if (key === 'customTopbar') apply(get('customTopbar'))
    // 投稿按钮只在自绘顶栏里存在，顶栏关着时这个类挂不挂都没影响
    else if (key === 'uploadBtnHide')
      applyUploadHide(get('uploadBtnHide'))
  })
  apply(get('customTopbar'))

  /**
   * 浮层里的按钮走和设置面板同一套涟漪（见 ripple.ts / selfTopbar.css §4.1.6）；
   * v029 起顶栏按钮（首页 / 动态 / 右侧图标 / 登录 / 投稿）和搜索面板的
   * 历史药丸 / 热搜词条也进同一份选择器。
   * 挂 document：浮层是 hover 时动态渲染的，事件委托才不用每次重建监听。
   * 顶栏关掉时这些选择器一个都不命中，监听留着没有副作用。
   */
  const offRipple = installRipple(document, TOPBAR_RIPPLE)

  return () => {
    off()
    offRipple()
    apply(false)
  }
}

function isExcluded(): boolean {
  const host = location.hostname
  if (host === 'space.bilibili.com' || host === 'live.bilibili.com') return true
  const path = location.pathname
  return path === '/history' || path === '/account/history'
}

import { get, onConfigChange } from '../config'
import { prefersReducedMotion } from './designTokens'
import { applyOpusSplit, RELAYOUT_EVENT, resetOpusSplit, SPLIT_MIN_HEIGHT, SPLIT_MIN_WIDTH, SPLIT_ON_CLASS } from './dynamicOpusLayout'
import { getGlassParams } from './glassConfig'
import { canonicalVideoUrl } from './hoverPrefetch'
import { IMAGE_DUR_CLOSE, IMAGE_DUR_OPEN, IMAGE_EASE } from './imageViewer'
import { EMBED_REVEAL_MSG } from './videoBeta'
import dynamicOverlayCss from './dynamicOverlay.css?inline'

/**
 * 实验室 ·「动态悬浮打开beta」
 *
 * 在动态页（`t.bilibili.com`）点一条动态的内容，不再跳到详情，而是在当前页
 * 弹一个悬浮窗，用 iframe 打开这条动态的详情页。交互与 bili_cat（BewlyCat）的
 * 「动态详情弹窗」一致：没有标题栏，窗口本身就是一整页详情；「新标签页」和关闭键
 * 浮在窗口右下角外面；点遮罩 / 按 Esc 收起。
 *
 * B 站自己已经让动态卡整体可点（点内容开 opus 页，而且**开在新标签页**）。这里在
 * document 捕获阶段把那一下接过来：`preventDefault` + `stopPropagation` 掉 B 站原生的
 * 处理，改成同页悬浮窗 —— 浏览连续时不会一屏开出一排标签页。
 *
 * **为什么用 iframe，而不是自己重绘详情**：
 *   B 站的动态详情包含转发、投票、预约、直播、番剧、专栏、评论分页 … 每种卡片的
 *   交互都不一样，而且会随站点版本变。自己重绘要么缺功能，要么半年后全烂；
 *   iframe 里跑的就是 B 站原版页面，登录态 / 评论 / 图片查看器都是现成的。
 *
 * **为什么只做 `t.bilibili.com`**：
 *   动态详情页和动态流是同源的，父页面能读 `contentDocument`，于是可以在 iframe 里
 *   补一份「去掉 B 站顶栏 / 背景图 / 右侧栏，内容居中」的样式，让悬浮窗里外是一套观感。
 *   个人空间（`space.bilibili.com/xxx/dynamic`）是跨源的，同样的清理做不了，硬开会
 *   露出一整条 B 站顶栏，所以那里不接管（保持原版整页跳转）。
 *
 * **详情地址要绕道 guard.js**：地址在 `.bili-dyn-time` 的 `$log.click.url` 上，那是
 * B 站 Vue 指令挂的 **JS expando** —— 内容脚本在隔离世界读不到（同一份 DOM 两套包装
 * 对象）。1.2.4 v005 直接读它，真机上永远读到空，功能等于没装。现在改成让页面世界的
 * `guard.js` §8 解析，走「属性 + 事件」同步拿回来，见 resolveDetailUrl 的注释。
 */

const HOST_ID = 'bili-elite-dynamic-host'
const EMBED_CLASS = 'bili-elite-dyn-embed'
const EMBED_DARK_CLASS = 'bili-elite-dyn-dark'
const EMBED_STYLE_ID = 'bili-elite-dyn-embed-style'

/** 问 guard.js（页面世界）要地址：属性当数据、事件当敲门砖（见 resolveDetailUrl） */
const ASK_ATTR = 'data-blie-dyn-ask'
const URL_ATTR = 'data-blie-dyn-url'
const RESOLVE_EVENT = 'blie-elite:dyn-url'

/** 动态详情页（`t.bilibili.com/{动态 id}`）：在详情页里再点动态开悬浮窗只会套娃，不接管 */
const DETAIL_PATH = /^\/\d+\/?$/

/** 视频页跨源，父页面读不到它的文档 —— 标记写在 URL 上，由 iframe 里的自己认（见 index.ts） */
const EMBED_PARAM = 'blie_embed'

/**
 * 视频页的 sandbox：**不能带 `allow-top-navigation`**。
 *
 * B 站视频页有反 iframe 嵌入的代码（`top.location = 自己`），不带这个 token 时浏览器会
 * 静默拦掉那次跳转，页面留在悬浮窗里；带上它（或者干脆不加 sandbox）整个动态页会被
 * 导航到视频页去 —— 实测就是这样。
 *
 * `allow-same-origin` 必须留：没有它 iframe 变成 opaque origin，登录态 / localStorage
 * 全丢，视频页会退化到未登录。其余几个是播放器（自动播放、全屏、画中画）和页面里的
 * 链接（新标签页打开）需要的。
 */
const VIDEO_SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-downloads',
].join(' ')

/**
 * 点击这些节点时保持页面 / B 站原本的行为，不弹悬浮窗。
 *
 * 转发出来的那条**正文**（`.bili-dyn-content__orig` 里的文字）不在此列：B 站自己也会
 * 让整张卡可点（正文点下去开的是**这条转发**的 opus 页），我们只是把同一个目标改成
 * 在悬浮窗里打开。转发里真正有去处的东西（原动态里的图片、视频卡、外链卡、话题）
 * 逐条列在下面，仍然交给 B 站。
 */
const SKIP_SELECTOR = [
  // 真正的链接与表单控件
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'video',
  'audio',
  'img',
  'picture',
  // 作者 / 时间 / 关注 / 更多菜单 / 点赞转评论
  '.bili-dyn-avatar',
  '.bili-dyn-item__avatar',
  '.bili-dyn-title',
  '.bili-dyn-item__desc',
  '.bili-dyn-time',
  '.bili-dyn-item__following',
  '.bili-dyn-follow-btn',
  '.bili-dyn-item__tag',
  '.bili-dyn-item__more',
  '.bili-dyn-more',
  '.bili-dyn-item__footer',
  '.bili-dyn-item__action',
  '.bili-dyn-action',
  // 图片 / 相册 / 视频 / 直播 / 番剧 / 专栏 / 外链卡等有自己点击目标的卡片
  '.bili-album',
  '.dyn-card-opus__pics',
  '.bili-video-card',
  '.bili-dyn-card-video',
  '.bili-dyn-card-live',
  '.bili-dyn-card-pgc',
  '.bili-dyn-card-article',
  '.bili-dyn-card-medialist',
  '.dyn-ugc__wrap',
  '.bili-dyn-card-reserve',
  '.bili-dyn-card-vote',
  '.bili-dyn-card-match',
  '.bili-dyn-card-lottery',
  '.bili-dyn-card-link-common',
].join(',')

/** B 站动态详情页里那套「顶栏 + 背景 + 侧栏」在悬浮窗里全是噪音，收掉并让内容居中 */
const EMBED_CSS = `
  html.${EMBED_CLASS},
  html.${EMBED_CLASS} body {
    overflow-x: hidden !important;
    background: #FFFFFF !important;
  }
  html.${EMBED_CLASS} #bili-header-container,
  html.${EMBED_CLASS} .z-top-container,
  html.${EMBED_CLASS} .bgc,
  html.${EMBED_CLASS} .bg,
  html.${EMBED_CLASS} .sidebar-wrap,
  html.${EMBED_CLASS} .side-toolbar,
  html.${EMBED_CLASS} .right-sidebar-wrap,
  html.${EMBED_CLASS} .bili-dyn-sidebar,
  html.${EMBED_CLASS} .bili-dyn-ads {
    display: none !important;
  }
  html.${EMBED_CLASS} #app .content {
    width: 100% !important;
    max-width: 820px !important;
    margin: 0 auto !important;
    padding: 20px 16px 48px !important;
    box-sizing: border-box !important;
  }
  html.${EMBED_CLASS} #app .content .card {
    background: #ffffff !important;
    border: 1px solid rgba(131, 131, 145, 0.18) !important;
    border-radius: 16px !important;
    box-shadow: none !important;
    overflow: hidden !important;
  }
  html.${EMBED_CLASS} .bili-dyn-item {
    margin: 0 !important;
  }
  /* 详情页自己的滚动条：color-scheme: dark 下 Chrome 给的仍是**浅灰轨道**
     （实测 rgb(138,138,138)），压在深色窗口右边缘上就是一条亮线。
     只挑根滚动条，别用后代选择器 —— 评论列表 / 图片画廊的滚动条是 B 站自己画的，
     一起改会和它们的配色打架。 */
  html.${EMBED_CLASS}::-webkit-scrollbar,
  html.${EMBED_CLASS} body::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  html.${EMBED_CLASS}::-webkit-scrollbar-track,
  html.${EMBED_CLASS} body::-webkit-scrollbar-track {
    background: transparent;
  }
  html.${EMBED_CLASS}::-webkit-scrollbar-thumb,
  html.${EMBED_CLASS} body::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: rgba(131, 131, 145, 0.38);
    background-clip: content-box;
  }
  html.${EMBED_CLASS}::-webkit-scrollbar-thumb:hover,
  html.${EMBED_CLASS} body::-webkit-scrollbar-thumb:hover {
    background: rgba(131, 131, 145, 0.58);
    background-clip: content-box;
  }
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS},
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS} body {
    background: #1F2125 !important;
    color-scheme: dark;
  }
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS} #app .content .card {
    background: #2A2D32 !important;
    border-color: rgba(131, 131, 145, 0.16) !important;
  }
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS} .bili-dyn-item {
    --bg1: #2A2D32;
  }

  /* ===== 两栏布局（窗口够宽时由 dynamicOpusLayout.ts 挂 ${SPLIT_ON_CLASS}） =====
     左栏 / 右栏各自滚动，右栏固定给评论区；有图时左栏换成图片舞台。
     这里只管「搬完之后长什么样」，搬节点的事在 JS 里（跨子树，CSS 挪不了）。 */
  html.${SPLIT_ON_CLASS},
  html.${SPLIT_ON_CLASS} body {
    height: 100% !important;
    overflow: hidden !important;
  }
  html.${SPLIT_ON_CLASS} #app,
  html.${SPLIT_ON_CLASS} #app .content {
    height: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  html.${SPLIT_ON_CLASS} #app .content > .card {
    height: 100% !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    overflow: hidden !important;
  }
  .blie-split {
    display: grid;
    /* 右栏 = 评论列。原来是 clamp(340, 36%, 430)，430 里塞一条 430 的评论列读起来很挤
       （每条评论的正文只剩三四个字就换行）—— 现在是 1.5 倍：clamp(510, 54%, 645)。
       数值改这里要同步下面的 syncMediaWidth → rightAt()。 */
    grid-template-columns: minmax(0, 1fr) clamp(510px, 54%, 645px);
    height: 100%;
    min-height: 0;
  }
  .blie-split__left,
  .blie-split__right {
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .blie-split__right {
    border-left: 1px solid rgba(131, 131, 145, 0.18);
  }
  /* 两栏自己的滚动条：跟页面根滚动条同一套细条（原生那条在深色窗口上是一条亮线） */
  .blie-split__left,
  .blie-split__right {
    scrollbar-width: thin;
    scrollbar-color: rgba(131, 131, 145, 0.4) transparent;
  }
  .blie-split__left::-webkit-scrollbar,
  .blie-split__right::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  .blie-split__left::-webkit-scrollbar-track,
  .blie-split__right::-webkit-scrollbar-track {
    background: transparent;
  }
  .blie-split__left::-webkit-scrollbar-thumb,
  .blie-split__right::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: rgba(131, 131, 145, 0.38);
    background-clip: content-box;
  }
  .blie-split__left::-webkit-scrollbar-thumb:hover,
  .blie-split__right::-webkit-scrollbar-thumb:hover {
    background: rgba(131, 131, 145, 0.58);
    background-clip: content-box;
  }
  /* 正文卡自带 min-width: 556px（动态流那边的定宽），搬进窄栏会横向溢出被裁掉 */
  .blie-split .bili-dyn-item {
    width: 100% !important;
    min-width: 0 !important;
  }
  /* 纯文字：左栏就是正文，收一下宽度别贴着边 */
  .blie-split.is-text .blie-split__left {
    padding: 24px 26px 48px;
  }
  .blie-split.is-text .blie-split__left > .bili-dyn-item {
    max-width: 720px;
    margin: 0 auto;
  }
  /* 有图：右栏上半是正文（作者 + 文字），下半是评论。
     头像列 88 收到 68、右侧内边距收到 0 —— 窄栏里这 40px 直接决定一行能放几个字 */
  .blie-split__right > .bili-dyn-item {
    padding: 18px 14px 4px !important;
  }
  .blie-split__right .bili-dyn-item__main {
    padding-left: 68px !important;
    padding-right: 0 !important;
  }
  .blie-split__right .bili-dyn-item__avatar {
    width: 56px !important;
    height: 56px !important;
  }
  .blie-split__right .bili-dyn-item__desc {
    padding-right: 72px !important;
  }
  /* 长话题 / 长链接不换行会把整段顶宽，允许在任意位置断 */
  .blie-split .dyn-card-opus__summary {
    overflow-wrap: anywhere;
  }
  /* 评论区的「评论 / 转发」标签栏在右栏里吸顶，滚评论时不会滑走 */
  .blie-split__right .bili-tabs__header {
    position: sticky;
    top: 0;
    z-index: 3;
    background: #FFFFFF;
  }
  /* 评论区左右留白：B 站原版就是 24px，之前为了塞进窄栏收到 16，读起来贴边 */
  .blie-split .bili-comment-container {
    padding: 0 24px;
  }

  /* ===== 图片舞台（只有 has-media 才有左栏图片） ===== */
  .blie-split.is-media .blie-split__left {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    overflow: hidden;
    background: #F6F7F8;
  }
  .blie-split.is-media .dyn-card-opus__pics {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 !important;
  }
  .blie-split.is-media .bili-album,
  .blie-split.is-media .bili-album__preview {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    display: block;
  }
  /* ===== 图片舞台：一次只显示一张（对标 bili_cat 的 opus 图库）=====
     其余张 display:none，当前那张挂 is-active。整块舞台当画布（contain 等比放大）——
     B 站给的图常常只有 480x640（实测请求 @1280w 也只是回原图，服务端不放大），
     按原尺寸摆在大舞台上就是「中间一小条 + 四周一大片空白」。
     点图片本身仍然是 B 站原版看图器（我们只切显隐，没动它的节点）。 */
  .blie-split .bili-album__preview__picture {
    display: none !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    min-width: 0 !important;
    min-height: 0 !important;
  }
  .blie-split .bili-album__preview__picture.is-active {
    display: block !important;
  }
  .blie-split .bili-album__preview__picture__img,
  .blie-split .bili-album__preview__picture__img picture,
  .blie-split .bili-album__preview__picture img {
    display: block;
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
  }

  /* 长图（长条漫画 / 长截图）：宽度铺满、纵向滚动，别缩成一根细条 */
  .blie-split .dyn-card-opus__pics.is-tall .bili-album__preview__picture.is-active .bili-album__preview__picture__img {
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }
  .blie-split .dyn-card-opus__pics.is-tall .bili-album__preview__picture.is-active picture,
  .blie-split .dyn-card-opus__pics.is-tall .bili-album__preview__picture.is-active img {
    height: auto !important;
    max-height: none !important;
  }

  /* 只有一张图时不显示切换控件 */
  .blie-gallery.is-single .blie-gallery__nav,
  .blie-gallery.is-single .blie-gallery__thumbs,
  .blie-gallery.is-single .blie-gallery__count {
    display: none;
  }

  /* 图库控件：左右箭头 / 底部缩略图 / 右下角计数，尺寸照 bili_cat */
  .blie-gallery {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .blie-gallery__nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    cursor: pointer;
    pointer-events: auto;
    transition: background 0.15s ease, transform 0.15s ease;
  }
  .blie-gallery__nav:hover {
    background: rgba(0, 0, 0, 0.72);
  }
  .blie-gallery__nav:active {
    transform: translateY(-50%) scale(0.94);
  }
  .blie-gallery__nav.is-prev {
    left: 12px;
  }
  .blie-gallery__nav.is-next {
    right: 12px;
  }
  .blie-gallery__nav svg {
    display: block;
  }
  .blie-gallery__thumbs {
    position: absolute;
    left: 12px;
    right: 72px;
    bottom: 10px;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px 0 4px;
    pointer-events: auto;
    scrollbar-width: none;
  }
  .blie-gallery__thumbs::-webkit-scrollbar {
    height: 0;
  }
  .blie-gallery__thumb {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 2px solid rgba(255, 255, 255, 0.55);
    border-radius: 8px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.25);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
    cursor: pointer;
    opacity: 0.88;
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  .blie-gallery__thumb.is-active {
    opacity: 1;
    border-color: #0a6cff;
    box-shadow: 0 0 0 1px #0a6cff, 0 2px 10px rgba(0, 0, 0, 0.3);
  }
  .blie-gallery__thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .blie-gallery__count {
    position: absolute;
    right: 12px;
    bottom: 12px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
  }

  /* 两栏的夜间配色：舞台底色 / 吸顶标签栏 / 分栏线 */
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS}.${SPLIT_ON_CLASS} .blie-split__right {
    border-left-color: rgba(131, 131, 145, 0.16);
  }
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS}.${SPLIT_ON_CLASS} .blie-split.is-media .blie-split__left {
    background: #26282D;
  }
  html.${EMBED_CLASS}.${EMBED_DARK_CLASS}.${SPLIT_ON_CLASS} .blie-split__right .bili-tabs__header {
    background: #1F2125;
  }
`

const EXTERNAL_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 7.5 8.5"/></svg>`
const CLOSE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>`
const ARROW_ICON = (dir: 'left' | 'right') => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}"/></svg>`

interface ViewerItem {
  /** 原图地址（B 站缩略图的 `@264w_264h` 后缀已经去掉） */
  src: string
  /** 页面上那张图的原始地址：原图取不到（评论图偶尔只有缩略图）时回退用 */
  thumb: string
  /** 点击时那张图在**屏幕**上的位置（iframe 内 rect + iframe 偏移），FLIP 的起点 */
  rect: DOMRect | null
}

interface ViewerUi {
  root: HTMLElement
  backdrop: HTMLElement
  img: HTMLImageElement
  prev: HTMLButtonElement
  next: HTMLButtonElement
  count: HTMLElement
  close: HTMLButtonElement
}

interface OverlayUi {
  host: HTMLDivElement
  root: HTMLElement
  openLink: HTMLAnchorElement
  closeBtn: HTMLButtonElement
  body: HTMLElement
  frame: HTMLIFrameElement
  viewer: ViewerUi
}

/** 能接管点击的页面：动态流（不是 `t.bilibili.com/{id}` 这种详情页本身） */
function isSupportedPage() {
  return location.hostname === 't.bilibili.com' && !DETAIL_PATH.test(location.pathname)
}

/**
 * 从一条动态里取详情地址；取不到就返回 null（交给 B 站原本的点击行为）。
 *
 * 地址挂在 `.bili-dyn-time` 的 `$log.click.url` 上，是页面世界的 JS expando ——
 * 隔离世界读不到，只能让 `guard.js`（MAIN world，§8）代读：
 *
 *   1. 给这条动态挂 `data-blie-dyn-ask`，当作「问的是哪一个元素」；
 *   2. 派发一个**不带 detail** 的普通 Event 当敲门砖（`CustomEvent.detail` 跨世界
 *      会被抹成 null，仓库里 §7 已经踩过这个坑）；
 *   3. guard.js 的监听同步跑完，把地址写在同一个元素的 `data-blie-dyn-url` 上；
 *   4. 读出来、擦掉两个属性 —— 属性跨世界可见，且这两个属性不参与任何选择器，
 *      不会引起样式失效（同 guard.js §5 的 `data-blie-pic`）。
 *
 * 全程同步，所以能在同一个 click 里决定「拦不拦」。guard.js 没装上（理论上不会）
 * 就读到空，退回 B 站原本的跳转。
 */
function resolveDetailUrl(item: HTMLElement): string | null {
  item.setAttribute(ASK_ATTR, '')
  document.dispatchEvent(new Event(RESOLVE_EVENT))
  const raw = item.getAttribute(URL_ATTR)
  item.removeAttribute(ASK_ATTR)
  item.removeAttribute(URL_ATTR)
  if (!raw) return null

  try {
    const url = new URL(raw, location.href)
    if (url.hostname === 't.bilibili.com' || url.hostname === 'www.bilibili.com')
      return url.href
  }
  catch {
    // 不是合法 URL 就当没取到
  }
  return null
}

/**
 * 点的是不是视频卡 → 返回要在悬浮窗里打开的视频地址（已带 `blie_embed=1`）。
 *
 * 视频卡本身就是 `<a href="//www.bilibili.com/video/BV…">`，而 `SKIP_SELECTOR` 第一条就是
 * `a` —— 所以视频这条**必须在 SKIP_SELECTOR 之前判**，否则永远轮不到。
 * 卡片里非链接的地方（封面下方的标题区）也一并接管：`cardWholeClick` 让整卡可点，
 * 用户点哪儿都应该开同一个视频。
 */
function resolveVideoUrl(target: Element): string | null {
  const direct = target.closest<HTMLAnchorElement>('a[href*="/video/BV"]')
  const card = target.closest('.bili-video-card, .bili-dyn-card-video, .dyn-ugc__wrap')
  const href = direct?.href || card?.querySelector<HTMLAnchorElement>('a[href*="/video/BV"]')?.href
  if (!href) return null
  // 走 hoverPrefetch 的规范化：去掉 spm_id_from / trackid 那串追踪参数，视频页补尾斜杠
  const canonical = canonicalVideoUrl(href)
  if (!canonical) return null
  const url = new URL(canonical)
  url.searchParams.set(EMBED_PARAM, '1')
  return url.href
}

/**
 * 这条动态是不是直播间 / 直播回放 —— 是的话整条交回 B 站，不弹悬浮窗。
 *
 * 直播卡在动态流里不止一种写法：
 *   · 直播间是 `.bili-dyn-card-live`（SKIP_SELECTOR 里已经列了，但那只挡「点在卡片里」，
 *     点卡片外面那一圈仍会走到动态详情）；
 *   · 直播回放 / 预约用的是 `.bili-dyn-card-video` 那一套皮肤，里面链到
 *     `live.bilibili.com/{roomid}`，类名和普通视频卡一模一样。
 * 直播站是独立站点：悬浮窗的 iframe 里没有正常播放器，还会被登录态 /
 * X-Frame-Options 挡成一张 404，所以这里按「整条动态」判，命中就完全不接管。
 */
function isLiveItem(item: HTMLElement | null) {
  if (!item) return false
  if (item.querySelector('.bili-dyn-card-live')) return true
  const card = item.querySelector<HTMLElement>('.bili-dyn-card-video, .bili-dyn-card-medialist, .dyn-ugc__wrap')
  if (!card) return false
  return card.matches('a[href*="live.bilibili.com/"]')
    || !!card.querySelector('a[href*="live.bilibili.com/"]')
}

export function setupDynamicOverlay(): () => void {  let ui: OverlayUi | null = null
  let isOpen = false
  let currentUrl = ''
  let loadTimer: number | null = null
  /** 「等正文真的画出来再揭开 loading」的轮询（见 waitFrameContent） */
  let revealTimer: number | null = null
  let revealTries = 0
  /** 分栏的「等 .card 渲染出来」轮询（见 scheduleFrameLayout） */
  let layoutTimer: number | null = null
  let layoutTries = 0
  /** 图片分栏宽度已经算过（见 syncMediaWidth）：只算一次，避免窗口来回摆 */
  let mediaWidthLocked = false
  /** iframe 里的 bili_dark 是我们自己加的（关灯时只删自己加的那个） */
  let frameDarkAdded = false
  /** 打开悬浮窗前 <html> 的行内 overflow，关闭后原样还回去 */
  let savedOverflow: string | null = null
  /** 上一次真的揭开过的那份文档地址（用来挡「重开时上一条文档晚到的 load」） */
  let lastDocHref = ''
  /** 这一轮打开的是跨源文档（视频页）：读不到 location / document，只能信 load 事件 */
  let crossNav = false
  /** 揭幕消息的重试定时器（见 notifyFrameReveal）：close / 下一轮 open 时要收掉 */
  let revealTimers: number[] = []
  /** 全屏看图器：开着的时候 Esc / ←→ 归它 */
  let viewerOpen = false
  let viewerItems: ViewerItem[] = []
  let viewerIndex = 0

  function lockScroll() {
    if (savedOverflow !== null) return
    const root = document.documentElement
    savedOverflow = root.style.overflow
    root.style.overflow = 'hidden'
  }

  function unlockScroll() {
    if (savedOverflow === null) return
    document.documentElement.style.overflow = savedOverflow
    savedOverflow = null
  }

  /**
   * 图片分栏的窗口宽度按「图片有多宽」算，而不是给一个死值。
   *
   * 竖图（常见的长截图 / 海报）在宽舞台里只能按高度缩放，舞台再宽也只是两侧多两块空白 ——
   * 正是「屏幕很宽、内容却挤在中间一小条」的观感。这里按首图宽高比反推：
   *   舞台宽 = 右栏宽 + 图高 x 宽高比 + 左右留白
   * 再夹到 [1088, 90vw] 之间（横图/多图就自然吃满宽度）。
   */
  /**
   * 图片分栏的窗口宽度：右栏 + 图高 × 宽高比 + 左右留白，夹到 [1088, 90vw]。
   * `syncMediaWidth`（详情页加载完）和 `open`（打开那一刻预判）用的是同一份公式 ——
   * 两边算出来的值一样，窗口才不会「先小一圈再变大」。
   */
  function mediaWidthFor(ratio: number, stageH: number, stageW: number) {
    // 32 = 图片舞台左右各 16 的留白
    // 长图（长条漫画 / 长截图）是按「宽度铺满 + 纵向滚动」显示的，没有自然宽度可依 ——
    // 给一个 3:4 上下的阅读列宽（560~900），别让它缩成 1088 窗口里的一条细缝
    const mediaW = ratio < 0.7
      ? Math.min(900, Math.max(560, stageH * 0.75))
      : stageH * ratio
    // 右栏是窗口的 54%（clamp 510~645，和 EMBED_CSS 里 grid-template-columns 同一组数）。
    // 拿当前实测的右栏宽来算，窗口一变宽右栏又跟着变 —— 会先到位再回摆十几像素。
    // 按「目标宽度」把右栏再算一遍，迭代两步一次落到位。
    const rightAt = (w: number) => Math.min(645, Math.max(510, w * 0.54))
    const want = rightAt(rightAt(stageW) + mediaW + 32) + mediaW + 32
    const max = Math.min(window.innerWidth * 0.9, 1800)
    return Math.round(Math.max(1088, Math.min(want, max)))
  }

  /**
   * 视频悬浮窗的宽度。
   *
   * 视频页在 iframe 里，父页面读不到它的文档 —— 但窗口宽度必须由父页面定。两栏布局的
   * 宽度分配是：左边 16:9 播放器（按窗口高度反推）+ 右边信息栏（标题 / UP / 评论）。
   * 这组数字**必须和 videoBeta.ts 的 SPLIT_* 一致**，否则会出现「父页面按两栏给宽、
   * iframe 里却退回单栏」——单栏播放器会按整宽算 16:9，直接顶满窗口高度。
   *
   * 如果算出来的宽度连「播放器下限 + 信息栏」都放不下，就退回 v016 那套单栏公式
   * （高度反推、给播放器下面留 140px 信息区），窗口不要为了两栏白变宽。
   */
  function videoWidthFor() {
    const maxW = Math.max(760, window.innerWidth - 64)
    const vh = Math.min(window.innerHeight - 64, window.innerHeight * 0.88)
    const infoAt = (w: number) => Math.min(620, Math.max(440, w * 0.28))
    const twoCol = ((vh - 20) * 16) / 9 + infoAt(maxW) + 30
    let width = Math.min(maxW, Math.max(760, twoCol))
    // iframe 里用的是 documentElement.clientWidth（扣掉纵向滚动条），这里留 20px 余量
    const splitMin = 600 + 30 + infoAt(width) + 20
    if (width < splitMin)
      width = Math.min(maxW, Math.max(760, ((vh - 140) * 16) / 9))
    return Math.round(width)
  }

  /** 把视频窗宽写进 `--dyn-video-w`（打开时一次到位，改窗口大小时重算） */
  function syncVideoWidth() {
    if (!ui) return
    ui.host.style.setProperty('--dyn-video-w', `${videoWidthFor()}px`)
  }

  function syncMediaWidth() {
    const doc = ui?.frame.contentDocument
    if (!ui || !doc) return
    if (ui.root.dataset.dynLayout !== 'media') return
    // **算一次就锁住**。宽度一变 iframe 就 resize，再算一次又会得到另一个值
    // （右栏是 36% 的百分比、图库可能刚把缩略图换成原图）—— 实测窗口会
    // 1088 → 1244 → 1088 来回摆两趟。用户主动换图 / 改浏览器窗口大小时再解锁。
    if (mediaWidthLocked) return

    const img = doc.querySelector<HTMLImageElement>('.blie-split .bili-album__preview__picture.is-active img')
    if (!img) return
    // 图库里是 `@264w_264h_1e_1c` 这种方形裁切缩略图，换成原图之后才是真实宽高比。
    // 两个条件都满足才算：
    //   1. `img.src` 没有 `@…` 后缀 —— 图库已经把这张换成原图了；
    //   2. `currentSrc` 已经跟上 `src` —— 原图**真的解码完了**。只判 src 的话，
    //      新图还在加载时 `naturalWidth` 还是缩略图那个 264x264（方形），
    //      算出来的窗口宽度是错的，等原图 load 又得再摆一次（实测 1088 → 1244 → 1088）。
    const src = img.src || ''
    if (/@\d+[wh]/.test(src)) return
    if (img.currentSrc && img.currentSrc !== src) return
    if (!img.naturalWidth || !img.naturalHeight) {
      // 图还没解码完（懒加载）：等它 load 再算一次，别让窗口一直停在默认宽度
      if (!img.dataset.blieWatched) {
        img.dataset.blieWatched = '1'
        img.addEventListener('load', () => layoutFrame(), { once: true })
      }
      return
    }

    const stageH = ui.frame.clientHeight || 0
    if (!stageH) return
    const width = mediaWidthFor(img.naturalWidth / img.naturalHeight, stageH, ui.frame.clientWidth || 1088)
    const current = parseInt(ui.host.style.getPropertyValue('--dyn-media-w'), 10)
    if (!Number.isNaN(current) && Math.abs(current - width) < 2) {
      mediaWidthLocked = true
      return
    }
    ui.host.style.setProperty('--dyn-media-w', `${width}px`)
    mediaWidthLocked = true
  }

  /**
   * 按当前 iframe 宽度决定「单栏 / 两栏」。返回 true = 已经定下来了（分好了，
   * 或者本来就不该分），调用方不用再等。
   */
  function layoutFrame(): boolean {
    const doc = ui?.frame.contentDocument
    if (!ui || !doc || !isOpen) return true

    const width = ui.frame.clientWidth || doc.documentElement.clientWidth || 0
    const height = ui.frame.clientHeight || doc.documentElement.clientHeight || 0
    if (width < SPLIT_MIN_WIDTH || height < SPLIT_MIN_HEIGHT) {
      resetOpusSplit(doc)
      // 不分栏就回到基础宽度：留着 media 档位会让窄窗口再被 90vw 压一道
      delete ui.root.dataset.dynLayout
      return true
    }

    const mode = applyOpusSplit(doc)
    // 窗口宽度跟着布局走（图片舞台要宽、纯文字 1240 就够），这里以详情页真实结构为准，
    // 纠正「动态流卡片里判错」的情况（比如卡片里没图、详情页里其实有图）
    if (mode) {
      ui.root.dataset.dynLayout = mode
      if (mode === 'media') syncMediaWidth()
    }
    return mode !== null
  }

  /**
   * 等详情页把 `.card` 渲染出来再分栏。
   * 150ms × 26 次 ≈ 4s 上限：详情页首屏一般 600~1200ms 就有内容了，
   * 超过 4s 还没出来基本是卡在登录 / 风控页，保持单栏就好，别再空转。
   */
  function scheduleFrameLayout() {
    if (layoutTimer !== null) {
      window.clearTimeout(layoutTimer)
      layoutTimer = null
    }
    layoutTries = 0
    const step = () => {
      layoutTimer = null
      if (layoutFrame()) return
      if (++layoutTries > 26) return
      layoutTimer = window.setTimeout(step, 150)
    }
    step()
  }

  /** iframe 自己的 resize：拖窗口 / 缩放时会变宽变窄，跟着换栏 */
  function onFrameResize() {
    if (layoutTimer === null) scheduleFrameLayout()
  }

  /** 图库换了图（宽高比可能变了）：解锁宽度重算一次 */
  function onRelayout() {
    mediaWidthLocked = false
    onFrameResize()
  }

  /** 浏览器窗口改大小：图片分栏的宽度按窗口高算，重新量一次 */
  function onWindowResize() {
    if (!isOpen) return
    // 视频窗宽按「左播放器 + 右信息栏」算，和图片分栏不是一套；视频模式直接重写变量
    if (ui?.root.dataset.dynMode === 'video') {
      syncVideoWidth()
      return
    }
    mediaWidthLocked = false
    scheduleFrameLayout()
  }

  /**
   * iframe 是不是已经落在目标文档上了。
   *
   * 首次打开时 iframe 被插进文档就会加载一次 `about:blank`，它的 `load` 在 `open()`
   * 之后才异步到达 —— 不判这一下，那次 load 会被当成「详情页加载完了」，把 loading
   * 提前收掉，用户先看到一帧空白 iframe 才看到占位。
   */
  function frameReady() {
    // 跨源（视频页）：location 读不到，只能信 load 事件。`about:blank` 那一次在 open()
    // 之前（那时 isOpen 还是 false）就被早退挡掉了，所以这里等到的 load 就是目标文档。
    if (crossNav) return true
    try {
      const loc = ui?.frame.contentWindow?.location
      if (!loc || !loc.href || loc.href === 'about:blank') return false
      // 重开另一条动态时，上一条文档的 load 可能晚到 —— 它和 lastDocHref 一致，挡掉
      if (loc.href === lastDocHref) return false
      return loc.origin === new URL(currentUrl).origin
    }
    catch {
      // 跨源读不到 location（理论上不会，这里只接管 t.bilibili.com 的动态详情）
      return false
    }
  }

  /**
   * 详情正文真的画出来了没。
   * B 站是 Vue 后渲染，`load` 那一刻 `.card` 里往往还是空壳 —— 这时就揭开 loading，
   * 看到的是白底，内容再「跳」出来。空壳高度是 0，所以按高度判。
   */
  function frameHasContent() {
    const doc = ui?.frame.contentDocument
    if (!doc) return false
    const item = doc.querySelector('#app .content .bili-dyn-item') || doc.querySelector('.bili-dyn-item')
    return !!item && item.getBoundingClientRect().height > 40
  }

  /** 收掉 loading：占位淡出、iframe 淡入（时长全在 CSS 里） */
  function finishLoad() {
    if (!ui || !isOpen) return
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer)
      loadTimer = null
    }
    if (revealTimer !== null) {
      window.clearTimeout(revealTimer)
      revealTimer = null
    }
    // 先发揭幕消息再揭开：iframe 里扣住的自动播放正好在转圈还盖着的时候放行，
    // 用户看到的就是「从第一帧开始播」（见 videoBeta.ts 的 holdEmbedAutoplay）。
    notifyFrameReveal()
    ui.body.classList.add('is-loaded')
  }

  /**
   * 告诉 iframe 里的视频页「悬浮窗已经揭开」。
   *
   * 悬浮窗要等视频页的 load 才揭开，而 B 站播放器的自动播放赶在 load 之前就开始了 ——
   * 转圈那一两秒视频在底下已经走过一小段（用户报的「开头被跳过」）。iframe 里的
   * videoBeta（跨源只能由它自己改）把起播扣住，等这条消息再放行。
   *
   * 发三发（0 / 400 / 1200ms）：内容脚本 document_start 就挂好了监听，第一发理论上必中；
   * 后两发兜「消息恰好在导航提交边缘被吞」「监听挂晚了」的意外。iframe 侧按类型幂等，
   * 收多发没有副作用。
   */
  function notifyFrameReveal() {
    if (!ui || !isOpen || !crossNav) return
    const win = ui.frame.contentWindow
    if (!win) return
    try {
      win.postMessage({ type: EMBED_REVEAL_MSG }, '*')
    }
    catch {
      // iframe 正换文档 / 已被释放：还有两发重试，都失败就靠 iframe 自己的 30s 兜底
    }
  }

  function scheduleFrameReveal() {
    for (const timer of revealTimers)
      window.clearTimeout(timer)
    revealTimers = [0, 400, 1200].map(delay => window.setTimeout(notifyFrameReveal, delay))
  }

  function clearRevealTimers() {
    for (const timer of revealTimers)
      window.clearTimeout(timer)
    revealTimers = []
  }

  /**
   * 等正文渲染出来再揭开（80ms × 15 ≈ 1.2s 上限）。
   * 超时也揭开：登录页 / 风控页 / 空动态永远不会有 `.bili-dyn-item`，
   * 不能让转圈一直转 —— 至少让用户看到 iframe 里的提示，或者点「新标签页」。
   */
  function waitFrameContent() {
    if (revealTimer !== null) {
      window.clearTimeout(revealTimer)
      revealTimer = null
    }
    revealTries = 0
    const step = () => {
      revealTimer = null
      if (!ui || !isOpen) return
      // 跨源（视频页）：读不到文档，`load` 已到就揭开 —— 留 160ms 让首屏先画出来
      if (crossNav) {
        revealTimer = window.setTimeout(finishLoad, 160)
        return
      }
      if (frameHasContent() || ++revealTries > 15) {
        finishLoad()
        return
      }
      revealTimer = window.setTimeout(step, 80)
    }
    step()
  }

  /* ===== 全屏看图器 =====
     动态悬浮窗里的图片在 iframe 里，B 站自己的 PhotoSwipe 只能铺满 iframe（也就是悬浮窗那一块），
     不是「全屏」。这里由父页面自己画一层：覆盖整个浏览器窗口、从点击位置 FLIP 放大、
     背景用「高级材质 → 材质（评论区图片背景）」那套参数（模糊强度 + 背景明暗）。
     和评论区点图的效果对齐，只是换成我们自己的实现。 */

  /** B 站缩略图 URL 的尺寸后缀（`@264w_264h_1e_1c`），去掉就是原图 */
  const THUMB_SUFFIX = /@[^/\s,]+$/

  function toOriginal(url: string) {
    return url.replace(THUMB_SUFFIX, '')
  }

  /** 背景明暗：50 为中性，越低越暗（黑罩）、越高越亮（白罩）—— 与 imageGlass 同一套换算 */
  function tintFor(brightness: number) {
    const mid = 50
    const maxAlpha = 0.9
    if (brightness <= mid)
      return `rgba(0, 0, 0, ${(((mid - brightness) / mid) * maxAlpha).toFixed(3)})`
    return `rgba(255, 255, 255, ${(((brightness - mid) / mid) * maxAlpha).toFixed(3)})`
  }

  function applyViewerGlass() {
    if (!ui) return
    const bd = ui.viewer.backdrop
    if (get('imageGlass')) {
      const p = getGlassParams()
      const bf = `blur(${p.blur}px) saturate(180%) brightness(1.02)`
      bd.style.backdropFilter = bf
      bd.style.setProperty('-webkit-backdrop-filter', bf)
      bd.style.background = tintFor(p.brightness)
    }
    else {
      bd.style.backdropFilter = 'none'
      bd.style.setProperty('-webkit-backdrop-filter', 'none')
      // 没开材质时退回 B 站 PhotoSwipe 那层深色底
      bd.style.background = 'rgba(0, 0, 0, 0.86)'
    }
  }

  /** 图片铺满视口（留 48px 呼吸）后的位置 */
  function containRect(nw: number, nh: number) {
    const pad = 48
    const vw = Math.max(120, window.innerWidth - pad * 2)
    const vh = Math.max(120, window.innerHeight - pad * 2)
    const scale = Math.min(vw / nw, vh / nh)
    const w = nw * scale
    const h = nh * scale
    return { x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2, w, h }
  }

  /** 从相册里收集所有图片（原图地址 + 可见那张的屏幕位置），FLIP 起点只对可见的那张有意义 */
  function collectAlbumItems(clicked: HTMLImageElement): ViewerItem[] {
    const frameRect = ui?.frame.getBoundingClientRect()
    if (!frameRect) return []
    const album = clicked.closest('.bili-album')
    const imgs = album
      ? Array.from(album.querySelectorAll<HTMLImageElement>('.bili-album__preview__picture img'))
      : [clicked]
    return imgs
      .map((im) => {
        const r = im.getBoundingClientRect()
        const visible = r.width > 8 && r.height > 8
        const raw = im.currentSrc || im.src || ''
        return {
          src: toOriginal(raw),
          thumb: raw,
          rect: visible
            ? new DOMRect(frameRect.left + r.left, frameRect.top + r.top, r.width, r.height)
            : null,
        }
      })
      .filter(it => !!it.src)
  }

  /** 换图序号：连续切图 / 关掉之后，旧那次加载的回调不许再动 DOM */
  let viewerToken = 0

  function showViewer(index: number, flip: boolean) {
    if (!ui) return
    const v = ui.viewer
    const item = viewerItems[index]
    if (!item) return
    const start = flip ? item.rect : null
    const token = ++viewerToken

    // **先把上一张彻底清掉**。`<img>` 改 `src` 时浏览器会继续显示旧图、`naturalWidth`
    // 也还是旧图的尺寸，直到新图解码完 —— 直接读就会「按上一张的比例摆好、再闪成新图」
    // （用户报的「第一次打开比例错 + 闪上一张」）。视频评论区的 PhotoSwipe 没这个问题，
    // 因为它从头到尾挂的是占位图，从来不读旧图尺寸。
    v.img.style.opacity = '0'
    v.img.removeAttribute('src')
    v.img.removeAttribute('srcset')

    const place = () => {
      if (!ui || !viewerOpen || token !== viewerToken) return
      const nw = v.img.naturalWidth
      const nh = v.img.naturalHeight
      // 尺寸真的有了才摆：宁可多等一帧，也别拿 0 / 旧值去算 contain
      if (!nw || !nh) return
      const target = containRect(nw, nh)
      v.img.style.width = `${target.w}px`
      v.img.style.height = `${target.h}px`
      v.img.style.left = `${target.x}px`
      v.img.style.top = `${target.y}px`
      v.img.style.opacity = '1'
      if (start && start.width > 8 && !prefersReducedMotion()) {
        // FLIP：从点击那张图的位置 / 尺寸放大到铺满视口
        const dx = start.left + start.width / 2 - (target.x + target.w / 2)
        const dy = start.top + start.height / 2 - (target.y + target.h / 2)
        const sx = start.width / target.w
        const sy = start.height / target.h
        v.img.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: 'none' },
        ], { duration: IMAGE_DUR_OPEN, easing: IMAGE_EASE })
      }
    }

    /** 换 src 并等它**真的能画出来**（缓存命中时 `complete` 已经是 true，不用等事件） */
    const load = (url: string) => new Promise<boolean>((resolve) => {
      if (!url) {
        resolve(false)
        return
      }
      v.img.onload = () => resolve(!!v.img.naturalWidth)
      v.img.onerror = () => resolve(false)
      v.img.src = url
      if (v.img.complete && v.img.naturalWidth)
        resolve(true)
    })

    load(item.src).then((ok) => {
      if (token !== viewerToken || !viewerOpen) return
      if (ok) {
        place()
        return
      }
      // 原图地址取不到（评论图偶尔只给了 `@96w_96h` 缩略图）：退回页面上那张
      if (item.thumb && item.thumb !== item.src) {
        load(item.thumb).then((ok2) => {
          if (ok2)
            place()
        })
      }
    })
  }

  function openViewer(items: ViewerItem[], index: number) {
    if (!ui || !items.length) return
    viewerItems = items
    viewerIndex = Math.max(0, Math.min(index, items.length - 1))
    viewerOpen = true
    const v = ui.viewer
    applyViewerGlass()
    v.root.classList.add('is-open')
    v.root.setAttribute('aria-hidden', 'false')
    const multi = items.length > 1
    v.prev.style.display = multi ? '' : 'none'
    v.next.style.display = multi ? '' : 'none'
    v.count.textContent = multi ? `${viewerIndex + 1} / ${items.length}` : ''
    showViewer(viewerIndex, true)
  }

  function stepViewer(delta: number) {
    if (!ui || !viewerOpen || viewerItems.length < 2) return
    viewerIndex = (viewerIndex + delta + viewerItems.length) % viewerItems.length
    ui.viewer.count.textContent = `${viewerIndex + 1} / ${viewerItems.length}`
    showViewer(viewerIndex, false)
  }

  function closeViewer() {
    if (!ui || !viewerOpen) return
    viewerOpen = false
    // 还在路上的图片加载不许再把图摆出来
    viewerToken++
    const v = ui.viewer
    v.root.classList.remove('is-open')
    v.root.setAttribute('aria-hidden', 'true')
    const start = viewerItems[viewerIndex]?.rect
    if (start && start.width > 8 && !prefersReducedMotion()) {
      const r = v.img.getBoundingClientRect()
      if (r.width > 8 && r.height > 8) {
        const dx = start.left + start.width / 2 - (r.left + r.width / 2)
        const dy = start.top + start.height / 2 - (r.top + r.height / 2)
        const sx = start.width / r.width
        const sy = start.height / r.height
        v.img.animate([
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.15 },
        ], { duration: IMAGE_DUR_CLOSE, easing: IMAGE_EASE, fill: 'forwards' })
      }
    }
    else {
      v.img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: IMAGE_DUR_CLOSE, fill: 'forwards' })
    }
    // 动画跑完再清 fill，否则下次打开会停在「缩回去」那一帧
    window.setTimeout(() => {
      if (!ui || viewerOpen) return
      ui.viewer.img.getAnimations().forEach(a => a.cancel())
      ui.viewer.img.style.opacity = '0'
    }, IMAGE_DUR_CLOSE + 60)
  }

  /**
   * iframe 里点图 → 父页面全屏看图器。
   * 拦的是「相册缩略图 / 图库里当前那张 / 内联展开的大图」，工具栏上的按钮（查看大图 / 旋转）
   * 不拦 —— 那是内联态里的操作，我们这一层根本不会出现那个工具栏。
   */
  /**
   * 事件目标转成元素 —— **不能用 `instanceof Element`**。
   *
   * iframe 里的元素来自**另一个 realm**（那个 document 自己的 window），和父页面隔离世界里的
   * `Element` 是两个构造器，`instanceof` 恒为 false。1.2.4 v017 第一版就是这么写的，结果
   * 点击被直接 return 掉、B 站照常展开它自己的内联大图（用户截图里那条
   * 「收起 / 查看大图 / 向左旋转 / 向右旋转」工具栏）。
   */
  function asElement(target: EventTarget | null): Element | null {
    const el = target as Element | null
    return el && typeof el.closest === 'function' ? el : null
  }

  /**
   * 事件里真正被点的那张图。
   *
   * **必须走 `composedPath()`**：评论区的图片在 `<bili-comments>` 这个 web component 的
   * shadow root 里，document 捕获阶段 `event.target` 已经被重定向成 host 元素，
   * `target.closest('img')` 永远找不到它。composedPath 是唯一能穿进 shadow 的通道。
   */
  function imageFromEvent(event: Event): HTMLImageElement | null {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    for (const node of path) {
      const el = asElement(node as EventTarget)
      if (!el || el.tagName !== 'IMG') continue
      return isZoomableImage(el as HTMLImageElement) ? (el as HTMLImageElement) : null
    }
    return null
  }

  /**
   * 这张图点下去该不该走全屏看图器。
   * 排除头像 / 表情 / 图标 / 小图 —— 评论区里的图至少 100 宽，头像 48、表情更小。
   * 视频 / 直播 / 番剧 / 专栏卡的封面也排除：那几类点下去应该是「进内容」，
   * 不是「看封面大图」。
   */
  function isZoomableImage(im: HTMLImageElement) {
    if (im.closest('.bili-album__watch__control')) return false
    if (im.closest('.bili-avatar, .b-avatar, .bili-dyn-avatar, .bili-dyn-item__avatar, .emoji, .emoticon')) return false
    if (im.closest('.bili-video-card, .bili-dyn-card-video, .bili-dyn-card-live, .bili-dyn-card-pgc, .bili-dyn-card-article, .dyn-ugc__wrap')) return false
    const r = im.getBoundingClientRect()
    return r.width >= 80 && r.height >= 80
  }

  /**
   * B 站的相册在 **pointerdown / pointerup** 这一层就开始展开内联态（不等 click），
   * 只拦 click 会晚一步：用户先看到那条「收起 / 查看大图 / 向左旋转 / 向右旋转」工具栏，
   * 然后才轮到我们的全屏看图器。按下 / 抬起时就把事件截住 —— 只 `stopPropagation`，
   * 不 `preventDefault`（图片本身的拖拽、文本选择不受影响）。
   */
  function onFramePointerDown(event: PointerEvent) {
    if (!ui || !isOpen || event.button !== 0) return
    if (!imageFromEvent(event)) return
    event.stopPropagation()
  }

  function onFrameImageClick(event: MouseEvent) {
    if (!ui || !isOpen || event.button !== 0) return
    const img = imageFromEvent(event)
    if (!img) return
    const items = collectAlbumItems(img)
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    openViewer(items, Math.max(0, items.findIndex(it => !!it.rect)))
  }

  /**
   * 给 iframe 里的同源页面补样式。
   * `fresh` 表示这是一次新的文档加载 —— 新文档里是否已有 bili_dark 要重新判断，
   * 不能沿用上一份文档「是我们加的」这个标记。
   */
  function decorateFrame(fresh: boolean) {
    if (!ui) return
    const doc = ui.frame.contentDocument
    if (!doc) return

    if (fresh) frameDarkAdded = false

    doc.documentElement.classList.add(EMBED_CLASS)

    const wantDark = !!get('nightMode')
    const hasDark = doc.documentElement.classList.contains('bili_dark')
    if (wantDark && !hasDark) {
      doc.documentElement.classList.add('bili_dark')
      frameDarkAdded = true
    }
    else if (!wantDark && frameDarkAdded) {
      doc.documentElement.classList.remove('bili_dark')
      frameDarkAdded = false
    }

    // B 站自己开着夜间（cookie / 账户设置）时，悬浮窗也跟着深色，别一边深一边浅
    const dark = doc.documentElement.classList.contains('bili_dark')
    doc.documentElement.classList.toggle(EMBED_DARK_CLASS, dark)
    ui.root.classList.toggle('is-night', dark)

    let style = doc.getElementById(EMBED_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = doc.createElement('style')
      style.id = EMBED_STYLE_ID
      ;(doc.head || doc.documentElement).appendChild(style)
    }
    style.textContent = EMBED_CSS

    // 分栏：宽窗口才搬成「文字左 / 评论右」或「图片左 / 文字+评论右」。
    // 详情内容是 Vue 后渲染的，`load` 那一刻 `.card` 里往往还是空的 —— 交给轮询。
    scheduleFrameLayout()
    ui.frame.contentWindow?.addEventListener('resize', onFrameResize)
    // 图库切到原图 / 用户换图 → 宽高比变了，窗口宽度要重算
    doc.addEventListener(RELAYOUT_EVENT, onRelayout)

    // 焦点在 iframe 里时，Esc 事件到不了外层的 window —— 每次加载完在同一份文档上
    // 再挂一个。文档一换监听自然消失，不会重复累积。
    ui.frame.contentWindow?.addEventListener('keydown', onFrameKeydown, true)
    // 图库里的图片点击 → 父页面的全屏看图器（见 onFrameImageClick）。
    // pointerdown / pointerup 也要挂：B 站的相册不等 click 就展开内联态了。
    doc.addEventListener('pointerdown', onFramePointerDown, true)
    doc.addEventListener('pointerup', onFramePointerDown, true)
    doc.addEventListener('click', onFrameImageClick, true)
  }

  function syncNight() {
    if (!ui) return
    ui.root.classList.toggle('is-night', !!get('nightMode'))
    if (ui.frame.contentDocument)
      decorateFrame(false)
  }
  function ensureUi(): OverlayUi {
    if (ui) return ui

    const host = document.createElement('div')
    host.id = HOST_ID
    host.style.cssText = [
      'position: fixed !important',
      'inset: 0 !important',
      'z-index: 2147483646 !important',
      'pointer-events: none !important',
    ].join(';')
    document.documentElement.appendChild(host)

    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>${dynamicOverlayCss}</style>
      <div class="dyn-root" role="dialog" aria-modal="true" aria-label="动态详情" aria-hidden="true">
        <div class="dyn-scrim" data-close="scrim"></div>
        <div class="dyn-stage">
          <section class="dyn-window">
            <div class="dyn-body">
              <div class="dyn-loading" aria-hidden="true">
                <span class="dyn-spinner"></span>
                <span class="dyn-loading__text">正在打开动态…</span>
              </div>
              <iframe class="dyn-frame" title="动态详情" allow="autoplay; fullscreen; clipboard-write" referrerpolicy="no-referrer-when-downgrade"></iframe>
            </div>
          </section>
          <div class="dyn-actions">
            <a class="dyn-open" target="_blank" rel="noopener noreferrer" title="在新标签页打开">
              <span>新标签页</span>${EXTERNAL_ICON}
            </a>
            <button class="dyn-close" type="button" title="关闭（Esc）" aria-label="关闭">${CLOSE_ICON}</button>
          </div>
        </div>
        <div class="dyn-viewer" aria-hidden="true">
          <div class="dyn-viewer__backdrop" data-close="viewer"></div>
          <img class="dyn-viewer__img" alt="">
          <button class="dyn-viewer__nav is-prev" type="button" aria-label="上一张">${ARROW_ICON('left')}</button>
          <button class="dyn-viewer__nav is-next" type="button" aria-label="下一张">${ARROW_ICON('right')}</button>
          <span class="dyn-viewer__count"></span>
          <button class="dyn-viewer__close" type="button" aria-label="关闭">${CLOSE_ICON}</button>
        </div>
      </div>
    `

    const root = shadow.querySelector('.dyn-root') as HTMLElement
    const openLink = shadow.querySelector('.dyn-open') as HTMLAnchorElement
    const closeBtn = shadow.querySelector('.dyn-close') as HTMLButtonElement
    const body = shadow.querySelector('.dyn-body') as HTMLElement
    const frame = shadow.querySelector('.dyn-frame') as HTMLIFrameElement
    const viewer: ViewerUi = {
      root: shadow.querySelector('.dyn-viewer') as HTMLElement,
      backdrop: shadow.querySelector('.dyn-viewer__backdrop') as HTMLElement,
      img: shadow.querySelector('.dyn-viewer__img') as HTMLImageElement,
      prev: shadow.querySelector('.dyn-viewer__nav.is-prev') as HTMLButtonElement,
      next: shadow.querySelector('.dyn-viewer__nav.is-next') as HTMLButtonElement,
      count: shadow.querySelector('.dyn-viewer__count') as HTMLElement,
      close: shadow.querySelector('.dyn-viewer__close') as HTMLButtonElement,
    }

    ui = { host, root, openLink, closeBtn, body, frame, viewer }

    shadow.querySelector('[data-close="scrim"]')!.addEventListener('click', close)
    closeBtn.addEventListener('click', close)
    viewer.backdrop.addEventListener('click', closeViewer)
    viewer.close.addEventListener('click', closeViewer)
    viewer.prev.addEventListener('click', () => stepViewer(-1))
    viewer.next.addEventListener('click', () => stepViewer(1))
    openLink.addEventListener('click', () => {
      // 让浏览器先把新标签页开出来，再收起悬浮窗
      window.setTimeout(close, 0)
    })

    frame.addEventListener('load', () => {
      if (!ui || !isOpen || !currentUrl) return
      // about:blank 那一次 load / 上一条文档晚到的那次都不算（见 frameReady）
      if (!frameReady()) return
      try {
        lastDocHref = ui.frame.contentWindow?.location.href || ''
      }
      catch {
        // 跨源（视频页）读不到 location —— 不影响，跨源那条判断本来就不看它
        lastDocHref = ''
      }
      decorateFrame(true)
      waitFrameContent()
    })

    // 让浏览器先把「关闭态」算一次样式。不读这一下，首次 open() 在同一帧里加 is-open
    // 会被当成初始渲染 —— 淡入 / 放大整个跳过（实测 opacity 从 0 一帧就到 1）。
    void (shadow.querySelector('.dyn-stage') as HTMLElement).getBoundingClientRect()

    return ui
  }

  /**
   * @param mode `dynamic` = 动态详情（同源，能注入样式、能分栏）；
   *   `video` = 播放页（**跨源**，父页面读不到文档，排版交给 iframe 里的 videoBeta）。
   * @param hasMedia 这条动态在流里有没有图 —— 决定窗口一开始多宽。
   *   详情页真实结构要等 iframe 渲染出来才知道，但窗口宽度不能等（会先窄后宽地跳一下），
   *   所以先按流里的卡片判一次，`layoutFrame` 之后会按详情页纠正。
   */
  function open(url: string, mode: 'dynamic' | 'video', hasMedia = false, mediaRatio = 0) {
    const u = ensureUi()

    if (isOpen && currentUrl === url) {
      u.closeBtn.focus({ preventScroll: true })
      return
    }

    currentUrl = url
    crossNav = mode === 'video'
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer)
      loadTimer = null
    }
    clearRevealTimers()

    u.root.dataset.dynMode = mode
    if (mode === 'video') {
      // 跨源：分栏、宽度估算一个都做不了（读不到文档）—— 窗口宽度由 `--dyn-video-w`
      // 按「左播放器 + 右信息栏」算好（见 videoWidthFor），iframe 里的 videoBeta
      // 再按同一组参数决定单栏 / 两栏
      delete u.root.dataset.dynLayout
      u.host.style.removeProperty('--dyn-media-w')
      mediaWidthLocked = true
      syncVideoWidth()
      // **必须在设 src 之前**：sandbox 属性一变 iframe 就会重新加载
      u.frame.setAttribute('sandbox', VIDEO_SANDBOX)
    }
    else {
      u.frame.removeAttribute('sandbox')
      u.root.dataset.dynLayout = hasMedia ? 'media' : 'text'
      // 宽度按上一条动态算出来的值不能带过来，等详情页的图出来再重算
      u.host.style.removeProperty('--dyn-media-w')
      u.host.style.removeProperty('--dyn-video-w')
      mediaWidthLocked = false
    }
    // 「新标签页」打开的是干净地址：`blie_embed` 是给 iframe 自己认的标记
    const external = new URL(url)
    external.searchParams.delete(EMBED_PARAM)
    u.openLink.href = external.href
    u.root.classList.add('is-open')
    u.root.setAttribute('aria-hidden', 'false')
    u.body.classList.remove('is-loaded')
    isOpen = true
    lockScroll()
    syncNight()

    // **窗口宽度打开那一刻就是最终宽度**：用动态流卡片里那张已经加载好的图、按
    // `syncMediaWidth` 同一套公式算一遍，并锁住 —— 不等 iframe 加载完再算。
    // 否则用户看到的是「先按 1088 出现，等内容出来再变宽」的那一下（用户报的「大小变换过程」）。
    if (mode === 'dynamic' && hasMedia && mediaRatio > 0) {
      const stageH = u.frame.clientHeight
      if (stageH > 0) {
        u.host.style.setProperty('--dyn-media-w', `${mediaWidthFor(mediaRatio, stageH, u.frame.clientWidth || 1088)}px`)
        mediaWidthLocked = true
      }
    }
    // **先让「窗口 + 正在加载」画出来，等入场动画跑完再开始导航**。
    // 两件事：
    //   1. 同一帧里设 src 的话，iframe 的首次绘制会和窗口淡入抢同一帧，打开时先闪一下空窗；
    //   2. B 站详情页和动态流同站同进程，iframe 一导航就占住主线程 —— 实测入场动画会被
    //      冻在半路，opacity 从 0 直接跳到 1（等于没有动画）。
    const navUrl = url
    const startNav = () => {
      if (!isOpen || currentUrl !== navUrl) return
      u.frame.src = navUrl
    }
    window.requestAnimationFrame(() => {
      window.setTimeout(() => window.requestAnimationFrame(startNav), prefersReducedMotion() ? 0 : 200)
    })

    // 详情页偶尔会卡在登录 / 风控页：20s 后无论如何把 loading 收掉，用户还能看到
    // iframe 里的提示，或者直接点「新标签页」。
    loadTimer = window.setTimeout(() => {
      loadTimer = null
      if (!isOpen || currentUrl !== url) return
      decorateFrame(true)
      finishLoad()
    }, 20000)

    window.requestAnimationFrame(() => {
      if (isOpen) u.closeBtn.focus({ preventScroll: true })
    })
  }

  function close() {
    if (!ui || !isOpen) return
    const u = ui
    // 看图器开着时直接收掉（不播缩回动画：窗口本身也在淡出，两条动画叠在一起反而乱）
    if (viewerOpen) {
      viewerOpen = false
      u.viewer.root.classList.remove('is-open')
      u.viewer.root.setAttribute('aria-hidden', 'true')
    }
    isOpen = false
    currentUrl = ''
    crossNav = false
    u.root.classList.remove('is-open')
    u.root.setAttribute('aria-hidden', 'true')
    unlockScroll()
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer)
      loadTimer = null
    }
    if (layoutTimer !== null) {
      window.clearTimeout(layoutTimer)
      layoutTimer = null
    }
    if (revealTimer !== null) {
      window.clearTimeout(revealTimer)
      revealTimer = null
    }
    clearRevealTimers()
    mediaWidthLocked = false

    const delay = prefersReducedMotion() ? 0 : 280
    window.setTimeout(() => {
      if (!ui || isOpen) return
      ui.body.classList.remove('is-loaded')
      // 释放之后 lastDocHref 也要清掉：否则重新打开同一条动态时，
      // 新文档的地址和它一模一样，会被当成「上一条晚到的 load」挡掉
      lastDocHref = ''
      // about:blank 会让 iframe 里的视频 / 直播立刻停下，也把整棵详情 DOM 释放掉
      ui.frame.src = 'about:blank'
    }, delay)
  }

  function onClick(event: MouseEvent) {
    if (!get('dynamicFloatBeta')) return
    // 每次点击都判一次页面：从动态流点进详情页如果是站内跳转（不整页重载），
    // 模块仍然活着 —— 在详情页里再接管就会一层套一层。
    if (!isSupportedPage()) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

    const target = event.target
    if (!(target instanceof Element)) return
    // 悬浮窗自己在 Shadow DOM 里，到 document 这一层 target 会被重定向成宿主；
    // 这里再排除一次，避免将来有人把宿主挪进动态列表里。
    if (target.closest(`#${HOST_ID}`)) return

    // 正在选字（拖选 / 双击选词）时不要抢走鼠标松开那一下
    if (window.getSelection()?.toString()) return

    const item = target.closest<HTMLElement>('.bili-dyn-item')
    // 直播 / 直播回放整条不接管：让 B 站原生跳转去直播站（见 isLiveItem 的注释）
    if (isLiveItem(item)) return

    // 视频卡：整卡（或卡里的链接）都在悬浮窗里开播放页。
    // **必须排在 SKIP_SELECTOR 之前** —— 视频卡本身就是 `<a>`，先判 `a` 就永远轮不到这里。
    const video = resolveVideoUrl(target)
    if (video) {
      // 下属开关关掉：视频这一路交回 B 站原本的行为（新标签页打开播放页）
      if (!get('dynamicFloatVideo')) return
      event.preventDefault()
      event.stopPropagation()
      open(video, 'video')
      return
    }

    if (!item || !item.querySelector('.bili-dyn-time')) return
    if (target.closest(SKIP_SELECTOR)) return

    const url = resolveDetailUrl(item)
    if (!url) return

    event.preventDefault()
    event.stopPropagation()
    // 窗口宽度按卡片里的图预判（见 open 里那段注释）：
    //   · 单图：卡片的 src 是 `@420w_560h` 这种**按原比例**缩的，naturalWidth 可信；
    //   · 多图：卡片全是 `@264w_264h` 方形裁切，比例没用 —— 按 3:4 竖图估一个
    //     （算出来正好是之前实测的 1264，竖图 / 横图都不至于两侧一大片空白）；
    //   · 没图：走 text 档，宽度由 CSS 定死，本来就是一步到位。
    const pics = item.querySelectorAll('.dyn-card-opus__pics .bili-album__preview__picture')
    const onlyImg = pics.length === 1 ? pics[0].querySelector('img') : null
    const ratio = onlyImg && onlyImg.naturalWidth && onlyImg.naturalHeight
      ? onlyImg.naturalWidth / onlyImg.naturalHeight
      : (pics.length ? 0.75 : 0)
    open(url, 'dynamic', pics.length > 0, ratio)
  }

  /** iframe 内部按 Esc 也要能关（同源文档上单独挂的监听，见 decorateFrame） */
  function onFrameKeydown(event: KeyboardEvent) {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      // 看图器开着时先收看图器，别一下子把整个悬浮窗关掉
      if (viewerOpen) closeViewer()
      else close()
      return
    }
    if (viewerOpen && event.key === 'ArrowLeft') {
      event.preventDefault()
      stepViewer(-1)
    }
    else if (viewerOpen && event.key === 'ArrowRight') {
      event.preventDefault()
      stepViewer(1)
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (!isOpen) return
    if (event.repeat || event.isComposing || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (viewerOpen) closeViewer()
      else close()
      return
    }
    if (viewerOpen && event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      stepViewer(-1)
    }
    else if (viewerOpen && event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      stepViewer(1)
    }
  }

  document.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', onWindowResize)

  const offConfig = onConfigChange((key) => {
    if (key === 'dynamicFloatBeta') {
      if (!get('dynamicFloatBeta')) close()
      return
    }
    if (key === 'nightMode') syncNight()
  })

  return () => {
    offConfig()
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('resize', onWindowResize)
    close()
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer)
      loadTimer = null
    }
    if (revealTimer !== null) {
      window.clearTimeout(revealTimer)
      revealTimer = null
    }
    clearRevealTimers()
    unlockScroll()
    ui?.host.remove()
    ui = null
  }
}

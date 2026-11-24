/**
 * 「卡片整体化」：把 B 站那套「只有封面 + 标题能点」换成 BewlyCat 的整卡点击。
 *
 * 上游出处：BewlyBewly `components/VideoCard/VideoCard.vue`（封面 + 信息区整体包在一个
 * `<ALink :href="videoUrl">` 里）。我们不改 DOM，只借这个「整卡是一个点击目标」的结论；
 * 出处与许可见 THIRD-PARTY-NOTICES.md。
 *
 * B 站首页 / 搜索页 / 视频页右栏的卡片，可点区域只有两块：封面那层
 * `a.bili-video-card__image--link` 和标题那个链接；标题下面那段空白、UP 主那一行的
 * 右侧、播放量那一排，全都是死的 —— 鼠标明明在卡片上，点了却什么也不发生。
 * BewlyCat 的做法是把「封面 + 信息区」整体包进一个 `<a>`，于是整张卡都是链接。
 *
 * 这里不去搬 DOM（B 站是 Vue 渲染的，搬节点会在下一次 diff 时被冲掉，还会打乱它自己的
 * 事件），改用一个 document 级的点击委托：点在卡片里、又没落在任何链接 / 按钮上时，
 * 自己去打开那个视频。
 *
 * 三条判据：
 * 1. **落在 `a[href]` 上就完全不管** —— 封面 / 标题本来就能跳视频，UP 主名字要跳空间。
 *    这一条同时就是「除了 UP 主名字之外都跳视频」的实现：UP 主名字本身就是链接，
 *    走原生；其余链接也都是视频地址，走原生，结果一致。
 * 2. 落在按钮类控件上不管：稍后再看、不感兴趣、⋮ 菜单、以及那些浮层的本体。
 * 3. 剩下的一律当「点卡片」：从卡片里找一个视频链接，拿它的地址新开一个标签页。
 *    新标签页是照 B 站 / BewlyCat 的默认行为（`target="_blank"`、
 *    BewlyCat 的 `videoCardLinkOpenMode` 默认 `newTab`），不打断当前页面。
 *
 * 样式（光标 + 悬停标题不变蓝）在 topbar.css §12.5，根类 `bili-elite-card-whole`
 * 由 topbarOptimize.ts 的 applyCardScopes 统一切。
 */

import { get } from '../config'

/** 三种卡片：首页 / 搜索页的大卡、播放页右栏的小横卡、首页的楼层卡 */
const CARD_SELECTOR = '.bili-video-card, .video-page-card-small, .floor-single-card'

/**
 * 点这些地方不算「点卡片」。
 *
 * `a[href]` 放在第一个：卡片里绝大多数可点区域都是链接，先短路掉它们既省事又保行为。
 * 后面几个都是「卡片上的控件」，点了要么弹菜单、要么收卡片，跳走反而是 bug。
 * 选择器故意写得宽（`.vui_popover` 整个算）—— 少判一个的代价是「点菜单跳走了」，
 * 比「点菜单点不动」难受得多。
 */
const EXEMPT_SELECTOR = [
  'a[href]',
  'button',
  '[role="button"]',
  '.bili-watch-later--wrap', // 首页 / 搜索页封面右上角「稍后再看」
  '.watch-later-video', // 播放页右栏小卡的「稍后再看」
  '.bili-video-card__no-interest', // 整卡「不感兴趣」浮层（含撤销按钮）
  '.bili-video-card__info--no-interest', // 卡片右下角那颗 ⋮
  '.vui_popover', // 上面那颗 ⋮ 弹出的菜单本体
].join(', ')

/**
 * 「这张卡点了会去哪」。用完整地址而不是 `a.pathname` 判：
 * 直播间卡片（首页 / 搜索页都会混进来）的地址是 `live.bilibili.com/1920457881`，
 * pathname 只有 `/1920457881`，而 UP 主空间的 pathname 也长这样 —— 只看 pathname
 * 分不出这两者，得连 host 一起判。
 */
const TARGET_HREF = /^https?:\/\/(?:www\.bilibili\.com\/(?:video\/|bangumi\/play\/)|live\.bilibili\.com\/\d+)/

/** 卡片对应的目标地址：第一个指向播放页 / 直播间的链接，且不属于 UP 主 */
function videoUrlOf(card: Element): string {
  for (const a of card.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    // UP 主 / 关注按钮指向 space.bilibili.com，靠 TARGET_HREF 已经能排掉；
    // 这里再判一次结构，防止 B 站以后把某个视频链接塞进 UP 主那一行里
    if (a.closest('.bili-video-card__info--owner, .upname'))
      continue
    if (TARGET_HREF.test(a.href))
      return a.href
  }
  return ''
}

function onClick(event: MouseEvent) {
  if (!get('cardWhole'))
    return
  // 只接主键。中键 / 右键本来就不该由我们处理（浏览器会走 auxclick / 菜单）
  if (event.button !== 0)
    return
  // 别人已经处理过这一下（菜单项自己 preventDefault）就别抢
  if (event.defaultPrevented)
    return
  const target = event.target as Element | null
  if (!target?.closest)
    return
  const card = target.closest(CARD_SELECTOR)
  if (!card)
    return
  if (target.closest(EXEMPT_SELECTOR))
    return
  const url = videoUrlOf(card)
  if (!url)
    return
  event.preventDefault()
  // noopener：新页面拿不到 window.opener，也不用把当前页留在新标签的 history 里
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function setupCardWholeClick(): () => void {
  // 不判断开关、直接常挂：每次点击现读 get('cardWhole')，省掉一个监听和一次重建
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}

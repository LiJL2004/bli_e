import { get, onConfigChange } from '../config'
import floatCss from './floatingButtons.css?inline'
import { LAYER_FLOATS, bindLayerToWebFullscreen } from './videoLayer'

/**
 * 右下角两枚浮动键：返回顶部 / 刷新（挂在设置键 ⚙ 上方，白底黑图标）。
 *
 * 为什么自己画而不是留 B 站原生的：原生那几枚分散在不同容器里、样式各不相同
 * （首页是 `.palette-button-wrap` 里的一列，搜索页是 `.side-buttons`，视频页是
 * `.fixed-sidenav-storage`，动态页是 `.bili-dyn-sidebar`），而且各自带一堆无关按钮
 * （三点菜单 / 客服 / 小窗）。这里统一成一套「返回顶部 + 刷新」，原生那批由
 * 「界面优化 → 原生刷新按钮屏蔽 / 原生返回顶部按钮屏蔽」两个开关收掉（见 topbar.css §17）。
 *
 * 可用性按页面类型决定，**没有的键直接不渲染**（不留空位，剩下的键自然贴到设置键上方）：
 * - 返回顶部：所有页面；
 * - 刷新：只给首页 —— 搜索页 / 视频页刷新等于重载，会丢滚动位置和播放进度，没有意义。
 * 返回顶部在页面顶部时不显示（与 B 站原生同款行为：滚到 200px 以下才出现）。
 *
 * 宿主固定 `right:24px; bottom:234px`（= 设置键的 180px + 44px 高 + 10px 间距），
 * 影子根里的 `.stack` 是纵向 flex —— 少一个键时整列自然下移补位。
 */
const HOST_ID = 'bili-elite-float-host'
/** 滚过这个距离才显示「返回顶部」，页面在顶部时它没有意义 */
const SHOW_TOP_AFTER = 200
/** 刷新图标的旋转动画时长，和 floatingButtons.css 里的 .6s 对齐 */
const SPIN_MS = 620

/** 首页（`/` 或 `/index.html`）：只有这里给「刷新」 */
function isHomePage() {
  return location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname)
}

/** 返回顶部：顶栏横线 + 向上箭头（和 B 站原生那枚同一个语义，不描边、纯线条） */
const BACK_TOP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 4.5h14" />
            <path d="M12 19.5V8.6" />
            <path d="m6.6 13 5.4-5.4 5.4 5.4" />
          </svg>`

/** 刷新：顺时针圆弧 + 右上角的转角箭头 */
const REFRESH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
            <path d="M23 4v6h-6" />
          </svg>`

export function setupFloatingButtons(): () => void {
  if (document.getElementById(HOST_ID)) return () => {}

  const showRefresh = isHomePage()

  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = [
    'position:fixed!important',
    'top:auto!important',
    'left:auto!important',
    'right:24px!important',
    'bottom:234px!important',
    'pointer-events:none',
  ].join(';')
  ;(document.documentElement || document.body).appendChild(host)
  // 和设置键同一套层级规则：网页全屏时一起降到视频下面
  const offLayer = bindLayerToWebFullscreen(host, LAYER_FLOATS)

  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>${floatCss}</style>
    <div class="stack">
      <button class="fab" id="backtop" type="button" title="返回顶部" aria-label="返回顶部">${BACK_TOP_ICON}</button>
      ${showRefresh
        ? `<button class="fab" id="refresh" type="button" title="刷新" aria-label="刷新">${REFRESH_ICON}</button>`
        : ''}
    </div>
  `

  const backtopBtn = shadow.getElementById('backtop') as HTMLButtonElement
  const refreshBtn = shadow.getElementById('refresh') as HTMLButtonElement | null

  /** 两个来源都要看：开关（用户设置）+ 滚动位置（返回顶部只在滚下去之后才有用） */
  function sync() {
    backtopBtn.classList.toggle('is-hidden', !get('backTopBtn') || window.scrollY <= SHOW_TOP_AFTER)
    refreshBtn?.classList.toggle('is-hidden', !get('refreshBtn'))
  }

  // 滚动用 rAF 合帧：passive 监听 + 每帧最多一次 class 切换，滚动时零布局读取
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      sync()
    })
  }

  const onBackTop = (e: Event) => {
    e.stopPropagation()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onRefresh = (e: Event) => {
    e.stopPropagation()
    refreshBtn?.classList.add('is-spinning')
    window.setTimeout(() => refreshBtn?.classList.remove('is-spinning'), SPIN_MS)
    // 优先复用 B 站自己的「刷新内容」：它只重取推荐流、不重载整页，滚动位置也保得住。
    // **必须点内层的 `.flexible-roll-btn-inner`**：外层 `.flexible-roll-btn` 上没有处理器，
    // 点它等于什么都没发生（实测：点内层会发一次 `wbi/index/top/feed/rcmd`，点外层零请求）。
    // 节点被「原生刷新按钮屏蔽」藏成 display:none 不影响 click() 派发，事件照常进它自己的处理器。
    const nativeInner = document.querySelector<HTMLElement>('.flexible-roll-btn.refresh .flexible-roll-btn-inner')
    if (nativeInner) nativeInner.click()
    else location.reload()
  }

  backtopBtn.addEventListener('click', onBackTop)
  refreshBtn?.addEventListener('click', onRefresh)
  window.addEventListener('scroll', onScroll, { passive: true })
  const offConfig = onConfigChange((key) => {
    if (key === 'backTopBtn' || key === 'refreshBtn') sync()
  })

  sync()

  return () => {
    backtopBtn.removeEventListener('click', onBackTop)
    refreshBtn?.removeEventListener('click', onRefresh)
    window.removeEventListener('scroll', onScroll)
    offConfig()
    offLayer()
    host.remove()
  }
}

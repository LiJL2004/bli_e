import { get, onConfigChange } from '../config'
import floatCss from './floatingButtons.css?inline'
import { registerFloatDock } from './floatDock'
import { setNightMode } from './labFeatures'
import { refreshPage } from './pageActions'
import { LAYER_FLOATS, bindLayerToWebFullscreen } from './videoLayer'

/**
 * 右下角那列浮动键：返回顶部 / 刷新 / 夜间模式（挂在设置键 ⚙ 上方）。
 *
 * 为什么自己画而不是留 B 站原生的：原生那几枚分散在不同容器里、样式各不相同
 * （首页是 `.palette-button-wrap` 里的一列，搜索页是 `.side-buttons`，视频页是
 * `.fixed-sidenav-storage`，动态页是 `.bili-dyn-sidebar`），而且各自带一堆无关按钮
 * （三点菜单 / 客服 / 小窗）。这里统一成一套「返回顶部 + 刷新」，原生那批常驻隐藏
 * （见 topbar.css §17）—— 1.1.6 v011 起前两枚键本身没有开关，始终在。
 *
 * 可用性按页面类型决定，**没有的键直接不渲染**（不留空位，剩下的键自然贴到设置键上方）：
 * - 返回顶部：所有页面；
 * - 刷新：只给首页 —— 搜索页 / 视频页刷新等于重载，会丢滚动位置和播放进度，没有意义。
 * 返回顶部在页面顶部时不显示（与 B 站原生同款行为：滚到 200px 以下才出现）。
 *
 * 夜间模式键（1.2.4 v001）是**常驻**的，默认显示（`fabNightMode`，可在面板里关掉）：
 * 白天白底月亮、夜间深底太阳，点一下切换夜间模式。切换本身由 labFeatures 的
 * `setNightMode()` 负责 —— 它用 View Transitions 做「以按钮为圆心」的整页过渡。
 *
 * 宿主固定 `right:24px; bottom:234px`（= 设置键的 180px + 44px 高 + 10px 间距），
 * 影子根里的 `.stack` 是纵向 flex —— 少一个键时整列自然下移补位。
 */
const HOST_ID = 'bili-elite-float-host'
/** 滚过这个距离才显示「返回顶部」，页面在顶部时它没有意义 */
const SHOW_TOP_AFTER = 200
/** 刷新图标的旋转动画时长，和 floatingButtons.css 里的 .6s 对齐 */
const SPIN_MS = 620
/** 进度环的周长（r = 21，按钮 44px、描边 2px 压在内侧），和 css 的 stroke-dasharray 对齐 */
const RING_LEN = 2 * Math.PI * 21

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

/**
 * 夜间模式的两枚图标叠在同一个 20×20 盒子里，靠 class 互斥（见 floatingButtons.css）：
 * 白天显示月亮（点一下进入夜间），夜间显示太阳（点一下回到白天）。
 * 两个同时存在是为了能交叉淡化 + 反向旋转，而不是硬换一个图标。
 */
const MOON_ICON = `<svg class="fab-ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6 8.6 8.6 0 1 0 20.4 14.6Z" />
          </svg>`
const SUN_ICON = `<svg class="fab-ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4.1" />
            <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
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
  // 和设置键同一套规则：进网页全屏一起收起，别压在视频上
  const offLayer = bindLayerToWebFullscreen(host, LAYER_FLOATS)

  const shadow = host.attachShadow({ mode: 'open' })
  // 胶囊化（实验室 → 浮动键胶囊化）时，圆键向左展开成「图标 + 文字」的长条。
  // 文字默认就在 DOM 里（display:none），展开时只是把宽度从 44px 撑开，
  // 因为整列是靠右对齐的，宽度一长就是向左展开。
  shadow.innerHTML = `
    <style>${floatCss}</style>
    <div class="stack" id="stack">
      <button class="fab fab-backtop" id="backtop" type="button" title="返回顶部" aria-label="返回顶部">${BACK_TOP_ICON}<span class="fab-label">返回顶部</span><svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="21" /></svg></button>
      ${showRefresh
        ? `<button class="fab fab-refresh" id="refresh" type="button" title="刷新" aria-label="刷新">${REFRESH_ICON}<span class="fab-label">刷新</span></button>`
        : ''}
      <button class="fab fab-night" id="night" type="button" title="夜间模式" aria-label="夜间模式" aria-pressed="false"><span class="fab-ic" aria-hidden="true">${MOON_ICON}${SUN_ICON}</span><span class="fab-label">夜间模式</span></button>
    </div>
  `

  const stack = shadow.getElementById('stack') as HTMLElement
  const backtopBtn = shadow.getElementById('backtop') as HTMLButtonElement
  const refreshBtn = shadow.getElementById('refresh') as HTMLButtonElement | null
  const nightBtn = shadow.getElementById('night') as HTMLButtonElement
  const nightLabel = nightBtn.querySelector<HTMLElement>('.fab-label')
  const ringCircle = backtopBtn.querySelector<SVGCircleElement>('.ring circle')

  // 「操作浮钮」的收纳（界面优化 → 自动隐藏 / 半隐藏）：这一列登记成「操作键」，
  // 和设置键一起由 floatDock 整体滑出 / 半隐藏。位移写在 .stack 上（宿主的宽度随内容变，
  // 拿它算 100% 不稳），收鼠标事件的则是两枚按钮本身 —— 宿主是 pointer-events:none。
  const offDock = registerFloatDock({
    role: 'actions',
    host,
    animEl: stack,
    hoverEls: refreshBtn ? [backtopBtn, refreshBtn, nightBtn] : [backtopBtn, nightBtn],
  })

  /** 页面滚动进度（0 = 顶部，1 = 底部） */
  function scrollProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  }

  /** 进度环：dashoffset 从「整圈」到 0 —— 越接近顶部，环画得越少 */
  function paintRing(p: number) {
    if (!ringCircle) return
    ringCircle.style.strokeDashoffset = String(RING_LEN * (1 - p))
  }

  let ringTimer: number | null = null

  /** 收掉进度环：延迟一点，让「到顶」那一帧的环还能看见 */
  function endRing(delay = 220) {
    if (ringTimer !== null) window.clearTimeout(ringTimer)
    ringTimer = window.setTimeout(() => {
      ringTimer = null
      backtopBtn.classList.remove('is-ringing')
      paintRing(0)
      sync()
    }, delay)
  }

  /**
   * 夜间模式键的三种状态都由它刷新：开关关掉（整颗不渲染）、当前昼夜（图标 / 悬停
   * 文字的朝向）、以及整列的夜间配色（`.stack.is-night`，三枚键一起换深色底）。
   * 夜间模式的真实状态只看 config —— 另一标签页 / 设置面板改了也会走到这里。
   */
  function syncNight() {
    const on = !!get('nightMode')
    stack.classList.toggle('is-night', on)
    nightBtn.classList.toggle('is-hidden', !get('fabNightMode'))
    const label = on ? '日间模式' : '夜间模式'
    nightBtn.title = label
    nightBtn.setAttribute('aria-label', label)
    nightBtn.setAttribute('aria-pressed', String(on))
    if (nightLabel) nightLabel.textContent = label
  }

  /** 只剩「滚动位置」一个来源了：前两枚键本身常驻（1.1.6 v011 起没有开关） */
  function sync() {
    const ringing = backtopBtn.classList.contains('is-ringing')
    if (ringing) {
      const p = scrollProgress()
      paintRing(p)
      // 到顶就收环；收完 sync 会把按钮一起藏掉
      if (p <= 0.001) endRing()
    }
    stack.classList.toggle('is-capsule', !!get('fabCapsule'))
    // 环还在画的时候按钮必须留着 —— 否则滚到 200px 以下它会先消失，环就断在半路
    backtopBtn.classList.toggle('is-hidden', !ringing && window.scrollY <= SHOW_TOP_AFTER)
    syncNight()
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
    // 胶囊化打开时，点一下先在按钮边缘画一圈滚动进度，滚到顶它自然收掉
    if (get('fabCapsule') && ringCircle) {
      backtopBtn.classList.add('is-ringing')
      paintRing(scrollProgress())
      sync()
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onRefresh = (e: Event) => {
    e.stopPropagation()
    refreshBtn?.classList.add('is-spinning')
    window.setTimeout(() => refreshBtn?.classList.remove('is-spinning'), SPIN_MS)
    // 具体刷新哪一块（首页只刷推荐流、其它页整页重载）在 pageActions.ts ——
    // 键盘快捷键（quickKeys.ts）走的是同一个函数，两处行为不会漂移
    refreshPage()
  }

  /**
   * 点这颗键 = 切换夜间模式。动画圆心取鼠标位置（不是按钮中心）——
   * 和 BewlyCat 那套「从你点的地方铺开」一致，指针落在哪儿就从哪儿长出来。
   * 键盘触发（回车 / 空格）没有坐标，退回按钮中心。
   */
  const onNight = (e: Event) => {
    e.stopPropagation()
    const me = e as MouseEvent
    const rect = nightBtn.getBoundingClientRect()
    const hasPoint = me.clientX > 0 || me.clientY > 0
    setNightMode(!get('nightMode'), {
      x: hasPoint ? me.clientX : rect.left + rect.width / 2,
      y: hasPoint ? me.clientY : rect.top + rect.height / 2,
    })
  }

  backtopBtn.addEventListener('click', onBackTop)
  refreshBtn?.addEventListener('click', onRefresh)
  nightBtn.addEventListener('click', onNight)
  const offConfig = onConfigChange((key) => {
    if (key === 'fabCapsule' || key === 'nightMode' || key === 'fabNightMode') sync()
  })

  // 首屏加载期间 B 站自己会打出大量 scroll 事件，而每次 sync() 都要读 window.scrollY ——
  // 页面布局还没算完时读它会把待处理的布局强制 flush 掉（实测搜索页因此多花 75ms、
  // 首页 50ms，占我们首屏脚本时间的 3/4）。所以滚动监听等 load 之后再挂，
  // 挂上时补一次 sync 对齐当前位置（浏览器恢复滚动位置的情况）。
  let scrollBound = false
  const bindScroll = () => {
    if (scrollBound) return
    scrollBound = true
    window.addEventListener('scroll', onScroll, { passive: true })
    sync()
  }
  sync()
  if (document.readyState === 'complete') bindScroll()
  else window.addEventListener('load', bindScroll, { once: true })

  return () => {
    if (ringTimer !== null) window.clearTimeout(ringTimer)
    backtopBtn.removeEventListener('click', onBackTop)
    refreshBtn?.removeEventListener('click', onRefresh)
    nightBtn.removeEventListener('click', onNight)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('load', bindScroll)
    offConfig()
    offDock()
    offLayer()
    host.remove()
  }
}

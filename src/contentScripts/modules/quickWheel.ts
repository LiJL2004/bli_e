import { MSG_OPEN_TAB } from '~/shared/messages'
import { get, onConfigChange } from '../config'
import { chromeApi } from '../storage'
import { getPanelHotkey } from './panelHotkeyConfig'
import {
  getWheelConfig,
  getWheelEntryAt,
  getWheelSlots,
  isWheelKeyCapturing,
  onWheelConfigChange,
  type WheelEntry,
} from './quickWheelConfig'
import {
  WHEEL_HUB,
  WHEEL_OUTER,
  WHEEL_SLOTS,
  chipOffset,
  indexFromPoint,
  sectorPath,
} from './quickWheelLayout'

import { markReturnPoint } from './returnRestore'
import { LAYER_WHEEL, bindLayerToWebFullscreen } from './videoLayer'
import { isPlayerImmersive, onPlayerScreenChange } from './playerMode'
import wheelCss from './quickWheel.css?inline'

/**
 * 功能轮盘：按住呼出键 → 圆盘从屏幕中央展开 → 移动鼠标选一格 → 松开前往。
 *
 * **八个方向是固定的**（每 45° 一个，与参考图一致），槽位里装什么由配置决定；
 * 空槽也占着位置，只是不可选 —— 所以卸下之后圆盘不会「缩一圈重新排」。
 *
 * 为什么是「按住 + 松开」而不是点一下切换：这是轮盘类交互的通用手感（游戏里都是这么用的），
 * 中途不想去了把指针停回中心空档再松手就行，不用再点一次取消。也正因为如此，
 * **中心空档必须保留**：指针停在正中时方向没有意义，这时候不替用户选任何东西。
 *
 * 生效页面由 `pageAllowed` 一处决定：首页、动态页、视频页（含番剧播放页）。
 * 其它页面上 Tab 是浏览器的焦点导航键，抢过来会直接毁掉键盘操作，所以先不接。
 *
 * 播放器处于**宽屏 / 网页全屏 / 全屏**时不接管呼出键（见 playerMode.ts）：
 * 这三种模式下画面已经铺满版面或整屏，轮盘盖上去没有意义，全屏里的 Tab 也该还给浏览器。
 * 判定是每次按键现算的，所以退出全屏 / 宽屏之后下一次按键就恢复了。
 *
 * 选中之后**默认在新标签页打开并切过去**（设置面板 → 快捷功能 →「当前标签页打开」打开时
 * 才回到当前标签页）：视频看到一半用轮盘跳走，把当前这个视频顶掉太可惜了。

 *
 * 圆盘固定在视口正中而不是跟着鼠标走：轮盘一旦跟着指针跑，指针相对圆心的方向就永远是
 * 「刚才那个方向」，选不出新格子。固定居中之后，指针在哪都只是「相对中心的方向」。
 */

const HOST_ID = 'bili-elite-wheel-host'

/** 首页（`/` 或 `/index.html`）：与 floatingButtons.ts 的判定同源 */
function isHomePage() {
  return location.hostname === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(location.pathname)
}

/** 动态页是独立域名 */
function isDynamicPage() {
  return location.hostname === 't.bilibili.com'
}

/** 视频页（`/video/BVxxx`）与番剧播放页（`/bangumi/play/xxx`） */
function isVideoPage() {
  return location.hostname === 'www.bilibili.com' && /^\/(?:video|bangumi\/play)\//.test(location.pathname)
}

/**
 * 哪些页面允许呼出轮盘。
 *
 * 只覆盖「内容页」这一批：首页、动态页、视频页（含番剧播放页）。Tab 在这些页面上的
 * 默认行为是切焦点，我们按住时才接管、松开就还回去，冲突可接受；而搜索页 / 个人空间 /
 * 消息中心那些页面本身就是表单和列表操作的重灾区，先不接。
 * 以后要扩就加到这里，别在别处散着判断。
 */
function pageAllowed() {
  return isHomePage() || isDynamicPage() || isVideoPage()
}

/** 设置面板开着时不接管键盘：面板里 Tab 要能正常切换焦点 */
function settingsPanelOpen() {
  const host = document.getElementById('bili-elite-settings-host')
  return !!host?.shadowRoot?.querySelector('.panel.show')
}

/** 输入框里打字时不能抢键（评论区、搜索框、动态发布框都算） */
function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  return /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

const ICON_TPL = (icon: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`

/**
 * 在**新标签页**打开，并切到那个标签页。
 *
 * 为什么不用 `window.open`：这条路径大多是从 `keyup`（松开呼出键）里走出来的，而浏览器
 * 只认 keydown / mousedown 这类「激活触发事件」—— 按住超过 5 秒再松手就超出了 transient
 * activation 窗口，window.open 会被弹窗拦截器默默吃掉，用户看到的就是「轮盘没反应」。
 * 内容脚本又拿不到 chrome.tabs（它不在内容脚本的 API 集合里），所以把建标签页这件事
 * 转给后台（见 background/main.ts）：`active: true` 就是「并前往这个新标签页」。
 *
 * 没有扩展环境时（本地注入调试、或后台还是老版本没有这个 handler）退回 window.open，
 * 再不行才退到当前页打开 —— 总比什么都不做强。
 */
function openInNewTab(url: string) {
  // chromeApi：扩展重载 / 自动更新之后上下文失效，sendMessage 会同步抛（见 storage.ts）
  const g = chromeApi()
  const fallback = () => {
    if (!window.open(url, '_blank'))
      location.assign(url)
  }
  if (!g?.runtime?.sendMessage) {
    fallback()
    return
  }
  try {
    g.runtime.sendMessage({ type: MSG_OPEN_TAB, url }, () => {
      // 后台没接住（扩展刚重载 / 没有这个 handler）：别让轮盘静悄悄地什么都不做
      if (g.runtime.lastError) fallback()
    })
  }
  catch {
    fallback()
  }
}

export function setupQuickWheel(): () => void {
  let host: HTMLElement | null = null
  let shadow: ShadowRoot | null = null
  let stage: HTMLElement | null = null
  let wedgeBox: SVGGElement | null = null
  let chipBox: HTMLElement | null = null
  let hubName: HTMLElement | null = null
  let hubDesc: HTMLElement | null = null
  let wedges: SVGPathElement[] = []
  let chips: HTMLElement[] = []
  let offLayer: (() => void) | null = null

  let open = false
  /** 卸载后不要再有任何异步回调去建 DOM */
  let disposed = false

  /** 展开时按下的那个键：中途改配置也不会让松手判定错乱 */
  let openedKey = ''
  let selected = -1

  /**
   * 搭出轮盘的 DOM。由 `warmUp` 在空闲时先调一次，`openWheel` 里再兜一次底 ——
   * 不再等到按键那一刻才建：建 DOM、解析样式、首次光栅化加起来够掉一帧，
   * 而「按下呼出键」正是最不能卡的那一帧。
   */
  function build() {

    if (host) return
    host = document.createElement('div')
    host.id = HOST_ID
    host.style.cssText = [
      'position:fixed!important',
      'inset:0!important',
      'width:100%!important',
      'height:100%!important',
      'pointer-events:none',
    ].join(';')
    ;(document.documentElement || document.body).appendChild(host)
    // 网页全屏时跟着一起收起（和设置键 / 浮动键同一套规则）
    offLayer = bindLayerToWebFullscreen(host, LAYER_WHEEL)

    shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>${wheelCss}</style>
      <div class="stage" id="stage">
        <div class="scrim" id="scrim"></div>
        <div class="wheel" id="wheel">
          <svg class="ring" viewBox="0 0 440 440" aria-hidden="true">
            <defs>
              <!-- 花瓣填充：**内实外虚，外三分之一就化开**。
                   原来到 0.9 还有 0.64 的白，结果八片花瓣一直到外缘都是实心的，
                   缝隙就是八条硬邦邦的深色「辐条」；现在 0.74 之后一路掉到 0，
                   花瓣的外缘和缝隙一起融进背景，才像八片浮着的花瓣。 -->
              <radialGradient id="petal-fill" gradientUnits="userSpaceOnUse" cx="220" cy="220" r="210">
                <stop offset="0.49" stop-color="#ffffff" stop-opacity="0.8" />
                <stop offset="0.86" stop-color="#ffffff" stop-opacity="0.66" />
                <stop offset="0.96" stop-color="#ffffff" stop-opacity="0.16" />
                <stop offset="1" stop-color="#ffffff" stop-opacity="0" />

              </radialGradient>
              <radialGradient id="petal-fill-on" gradientUnits="userSpaceOnUse" cx="220" cy="220" r="210">
                <stop offset="0.49" stop-color="#5C9EFF" stop-opacity="0.74" />
                <stop offset="0.86" stop-color="#2F7BFF" stop-opacity="0.56" />
                <stop offset="0.96" stop-color="#2F7BFF" stop-opacity="0.14" />
                <stop offset="1" stop-color="#2F7BFF" stop-opacity="0" />

              </radialGradient>
              <radialGradient id="petal-fill-night" gradientUnits="userSpaceOnUse" cx="220" cy="220" r="210">
                <stop offset="0.49" stop-color="#ffffff" stop-opacity="0.19" />
                <stop offset="0.64" stop-color="#ffffff" stop-opacity="0.17" />
                <stop offset="0.78" stop-color="#ffffff" stop-opacity="0.12" />
                <stop offset="0.9" stop-color="#ffffff" stop-opacity="0.05" />
                <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
              </radialGradient>
              <radialGradient id="petal-fill-on-night" gradientUnits="userSpaceOnUse" cx="220" cy="220" r="210">
                <stop offset="0.49" stop-color="#6FB0FF" stop-opacity="0.48" />
                <stop offset="0.64" stop-color="#6FB0FF" stop-opacity="0.42" />
                <stop offset="0.8" stop-color="#6FB0FF" stop-opacity="0.26" />
                <stop offset="0.92" stop-color="#6FB0FF" stop-opacity="0.1" />
                <stop offset="1" stop-color="#6FB0FF" stop-opacity="0" />
              </radialGradient>

            </defs>

            <g id="wedges"></g>
          </svg>
          <div class="hub">
            <div class="hub-name is-idle" id="hub-name">功能轮盘</div>
            <div class="hub-desc" id="hub-desc">移动鼠标选择</div>
          </div>
          <div class="chips" id="chips"></div>
        </div>
      </div>`
    stage = shadow.getElementById('stage') as HTMLElement
    // SVG 组不能用 getElementById（它按 HTMLElement 推断类型），用 querySelector 更直接
    wedgeBox = shadow.querySelector<SVGGElement>('#wedges')

    chipBox = shadow.getElementById('chips') as HTMLElement
    hubName = shadow.getElementById('hub-name') as HTMLElement
    hubDesc = shadow.getElementById('hub-desc') as HTMLElement
  }

  /**
   * 空闲时把轮盘建好，并把全屏毛玻璃「预渲染」一遍。
   *
   * 不预热的话**第一次**呼出会掉两帧：full-screen backdrop-filter 的 shader 要到
   * 第一次真正上屏时才编译，加上 19px 模糊的首帧光栅化 —— 实测 1280×800 上第一帧
   * 掉了 60ms，之后每次都是 7ms 一帧。预热时遮罩只给 1% 不透明度
   * （1% × 16% 暗色 = 0.16%，肉眼看不见），但足够让浏览器把 shader 编译完、
   * 把模糊光栅化一次，于是第一次真正呼出也是顺的。
   */
  function warmUp() {
    if (disposed) return
    const fresh = !host
    if (fresh) build()
    if (!stage) return
    // build() 只搭空壳：花瓣和图标是 render() 填进去的。不填一遍，
    // 预热时画的是个空盘子，第一次呼出照样要为它们付光栅化的钱。
    if (fresh) render()
    stage.classList.add('is-glass', 'is-warm')
    void stage.offsetWidth
    requestAnimationFrame(() => {
      requestAnimationFrame(() => stage?.classList.remove('is-warm'))
    })
  }

  /** 按当前配置重画圆盘。只在展开时调 —— 关着的时候它长什么样没人看 */

  function render() {
    if (!shadow || !wedgeBox || !chipBox) return
    const slots = getWheelSlots()

    // 八片花瓣永远都在（空槽也画），高亮只落在有功能的槽上。
    // 花瓣之间靠 path 自己让出的角缝隙分开，不再画分隔线。
    wedgeBox.innerHTML = Array.from({ length: WHEEL_SLOTS }, (_, i) => `<path class="wedge" data-i="${i}" d="${sectorPath(i)}"></path>`).join('')

    // --i 给展开时的逐个弹出用（见 quickWheel.css 的 chip-in）
    chipBox.innerHTML = slots.map((id, i) => {
      const entry = id ? getWheelEntryAt(i) : null
      const { x, y } = chipOffset(i)
      const pos = `--x:${x.toFixed(2)}%;--y:${y.toFixed(2)}%;--i:${i}`
      if (!entry) {
        // 空槽：一个虚线占位圈，说明「这个方向还在，只是没装东西」，下面不写名字
        return `<div class="chip is-empty" data-i="${i}" style="${pos}"><span class="chip-icon"></span></div>`
      }
      return `<div class="chip" data-i="${i}" style="${pos}">
        <span class="chip-icon">${ICON_TPL(entry.icon)}</span>
        <span class="chip-label">${entry.label}</span>
      </div>`
    }).join('')

    wedges = Array.from(wedgeBox.querySelectorAll<SVGPathElement>('.wedge'))
    chips = Array.from(chipBox.querySelectorAll<HTMLElement>('.chip'))
  }

  /** 把选中态刷到 DOM 上（指针每动一下都会走这里，只切类名，不读布局） */
  function paint() {
    wedges.forEach((el, i) => el.classList.toggle('is-on', i === selected))
    chips.forEach((el, i) => el.classList.toggle('is-on', i === selected))
    if (!hubName || !hubDesc) return
    const entry: WheelEntry | null = selected >= 0 ? getWheelEntryAt(selected) : null
    if (!entry) {
      hubName.textContent = '功能轮盘'
      hubName.classList.add('is-idle')
      hubDesc.textContent = '移动鼠标选择'
      return
    }
    hubName.textContent = entry.label
    hubName.classList.remove('is-idle')
    // 已经在目标页上时，松手什么也不会发生 —— 提前说清楚，别让人以为是没生效。
    // 新标签页模式更要说：松手之后当前这一页纹丝不动，不提示一句会以为轮盘没生效。
    if (entry.isCurrent())
      hubDesc.textContent = '已在当前页'
    else
      hubDesc.textContent = get('wheelCurrentTab') ? '松开前往' : '在新标签页打开'

  }

  /** 有任何一个槽装上了东西才值得展开 */
  function hasAnyEntry() {
    return getWheelSlots().some(Boolean)
  }

  function openWheel() {
    if (!hasAnyEntry()) return
    build()
    if (!stage) return
    render()
    selected = -1
    openedKey = getWheelConfig().key
    stage.classList.toggle('is-night', document.documentElement.classList.contains('bili-elite-night'))
    // 「高级材质 → 轮盘背景」关掉时用实色圆盘（模糊 / 遮罩都撤掉）
    stage.classList.toggle('is-glass', !!get('wheelGlass'))
    paint()
    // 首次呼出时这套 DOM 是这一帧刚建的：不先强制一次样式计算就直接加 .show，
    // 浏览器只看到「终态」，缩放动画整个丢掉（第二次起才正常）。读一次 offsetWidth
    // 让「起始态」先落地 —— 代价是展开时的一次同步布局。
    void stage.offsetWidth
    stage.classList.add('show')
    open = true
    bindStage()
  }

  /** commit = true：松手 / 点击，按当前选中项前往；false：Esc、切页面、关开关 */
  function closeWheel(commit: boolean) {
    if (!open) return
    open = false
    unbindStage()
    stage?.classList.remove('show')

    const entry = commit && selected >= 0 ? getWheelEntryAt(selected) : null
    selected = -1
    if (!entry) return
    // 已经在那一页：只收起，不跳转（用户明确要求的「保持不变」）
    if (entry.isCurrent()) return
    // 默认开在新标签页并切过去；「当前标签页打开」开着时才是 1.1.3 之前的行为
    if (get('wheelCurrentTab')) {
      // 当前标签页这条路后退回来必然要整页重载（B 站自己关掉了 bfcache），
      // 只能先记下位置、回来时按回去，见 returnRestore.ts
      markReturnPoint()
      location.assign(entry.url)
    }
    else {
      openInNewTab(entry.url)
    }
  }

  /** 指针方向 → 槽位。中心空档 / 空槽都返回 -1（选中态跟着清掉，回到「什么都没选」） */
  function trackPointer(x: number, y: number) {
    if (!open) return
    // 轮盘按 min(440px, 74vmin) 渲染；中心圆的像素半径按几何比例换算出来，
    // 不读 getBoundingClientRect —— 指针每动一下都读布局太亏。
    // 居中基准用 clientWidth / clientHeight：宿主是 fixed + inset:0，它的视口**不含**
    // 滚动条，而 innerWidth 含 —— 差那 7~8px 会让角度分界整体偏一点。
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = document.documentElement.clientHeight || window.innerHeight
    const size = Math.min(440, 0.74 * Math.min(vw, vh))
    const hubRadius = (size / 2) * (WHEEL_HUB / WHEEL_OUTER)
    const idx = indexFromPoint(x - vw / 2, y - vh / 2, hubRadius)

    // 指到空槽上等于「没指到东西」：取消高亮，免得让人以为那一格能去
    const next = idx >= 0 && getWheelEntryAt(idx) ? idx : -1
    if (next === selected) return
    selected = next
    paint()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // 设置面板正在等一个键绑定：这一次按键归它，轮盘别插手
    if (isWheelKeyCapturing()) return

    if (open) {
      if (e.code === openedKey) {
        // 按住不放会一直重复 keydown，别让它把焦点导航带出来
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeWheel(false)
        return
      }
      // 轮盘开着时按了「设置面板」的呼出键：先把轮盘收掉，再把这一下放过去 ——
      // document 那边的面板监听会接手，等于从轮盘直接切到设置面板，而不是两层叠着。
      if (e.code === getPanelHotkey()) {
        closeWheel(false)
        return
      }
      // 数字键直接选第 N 格（键盘党不用摸鼠标）；空槽跳过
      const digit = /^Digit([1-8])$/.exec(e.code)
      if (digit) {
        const i = Number(digit[1]) - 1
        if (i < WHEEL_SLOTS) {
          e.preventDefault()
          e.stopPropagation()
          selected = getWheelEntryAt(i) ? i : -1
          paint()
        }
      }
      return
    }

    if (!get('quickWheel') || !pageAllowed()) return
    // 宽屏 / 网页全屏 / 全屏：不呼出，也不吃这次按键
    if (isPlayerImmersive()) return
    if (e.code !== getWheelConfig().key) return
    // 带修饰键的组合（Ctrl+Tab 之类）留给浏览器 / B 站自己
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    if (isEditableTarget(e.target) || settingsPanelOpen()) return
    e.preventDefault()
    e.stopPropagation()
    openWheel()
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (!open || e.code !== openedKey) return
    e.preventDefault()
    e.stopPropagation()
    closeWheel(true)
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!open) return
    trackPointer(e.clientX, e.clientY)
  }

  // 按住呼出键时点一下鼠标 = 选中并前往；这一下也不许穿透到页面
  const onMouseDown = (e: MouseEvent) => {
    if (!open) return
    e.preventDefault()
    e.stopPropagation()
    trackPointer(e.clientX, e.clientY)
    closeWheel(true)
  }

  const onContextMenu = (e: Event) => {
    if (!open) return
    e.preventDefault()
    e.stopPropagation()
  }

  // 开着轮盘时滚轮会把页面滚走，观感很怪 —— 吃掉
  const onWheelEvent = (e: Event) => {
    if (!open) return
    e.preventDefault()
  }

  // 切标签页 / 窗口失焦：当作放弃，别把轮盘留在屏幕上
  const onBlur = () => closeWheel(false)
  const onVisibility = () => {
    if (document.hidden) closeWheel(false)
  }

  /**
   * 只在展开期间挂上的四个监听。
   *
   * 为什么不在 setup 时一次性挂好：`wheel` 必须 `passive: false` 才能 preventDefault，
   * 而一个非被动的 wheel 监听会让整页滚动走不了浏览器优化过的快路径（首页要滚一整天）。
   * 鼠标那三个同理 —— 它们要在页面之前吃掉点击，常驻等于给每次点击都加一道拦截。
   * 展开 / 收起各一次增删，成本远低于常驻。
   */
  const stageOpts: AddEventListenerOptions = { capture: true }
  const stageWheelOpts: AddEventListenerOptions = { capture: true, passive: false }
  let stageBound = false

  function bindStage() {
    if (stageBound) return
    stageBound = true
    window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })
    window.addEventListener('mousedown', onMouseDown, stageOpts)
    window.addEventListener('contextmenu', onContextMenu, stageOpts)
    window.addEventListener('wheel', onWheelEvent, stageWheelOpts)
  }

  function unbindStage() {
    if (!stageBound) return
    stageBound = false
    window.removeEventListener('mousemove', onMouseMove, { capture: true })
    window.removeEventListener('mousedown', onMouseDown, stageOpts)
    window.removeEventListener('contextmenu', onContextMenu, stageOpts)
    window.removeEventListener('wheel', onWheelEvent, stageWheelOpts)
  }

  // 常驻的只有键盘与失焦：松手判定必须随时在
  const opts: AddEventListenerOptions = { capture: true }
  window.addEventListener('keydown', onKeyDown, opts)
  window.addEventListener('keyup', onKeyUp, opts)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibility)

  // 空闲时预热（见 warmUp 的注释）。只在「允许呼出的页面 + 开关打开」时才做，
  // 否则建一套 DOM 再跑一次全屏模糊是纯浪费。
  let warmTimer: ReturnType<typeof setTimeout> | null = null
  if (get('quickWheel') && pageAllowed()) {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number)
    // 有 requestIdleCallback 就等真空闲；没有就退一步用定时器（首次交互后页面才不忙）
    if (ric)
      ric(warmUp, { timeout: 4000 })
    else
      warmTimer = setTimeout(warmUp, 1500)
  }

  // 轮盘开着的时候进了宽屏 / 全屏：直接收掉。挂在那儿的轮盘既点不到也选不了，
  // 而指针一动还会选格，很容易误触。
  const offScreen = onPlayerScreenChange(() => {
    if (isPlayerImmersive()) closeWheel(false)
  })

  const offConfig = onConfigChange((key) => {

    if (key === 'quickWheel' && !get('quickWheel')) closeWheel(false)
  })
  // 改了轮盘内容 / 呼出键：关掉正开着的轮盘，下次呼出就是新的
  const offWheel = onWheelConfigChange(() => closeWheel(false))

  return () => {
    disposed = true
    if (warmTimer) clearTimeout(warmTimer)
    offConfig()
    offWheel()
    offScreen()

    unbindStage()
    window.removeEventListener('keydown', onKeyDown, opts)
    window.removeEventListener('keyup', onKeyUp, opts)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    offLayer?.()
    host?.remove()
    host = null
    shadow = null
    stage = null
  }
}

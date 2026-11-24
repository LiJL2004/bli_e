import { get, onConfigChange, persist } from '../config'
import { prefersReducedMotion } from './designTokens'
import nightCss from './night.css?inline'

/**
 * 页面级「纯 CSS」的功能：只在 <html> 上挂一个类名，样式自己按类名生效。
 * 现在只剩夜间模式一份。
 *
 * 为什么不塞进 topbarOptimize：那个模块在个人空间 / 历史记录页会整块不接
 * （见 isTopbarOptExcluded），而夜间模式跟「顶栏改造」无关，在那些页面上也该照常工作。
 *
 * 设置面板自己的同类效果（面板配色、卡片级联）在 panel.css，由 settingsPanel 自己切类。
 *
 * 1.1.6 v016：原来还有第二份 lab.css（材质开关过渡 `bili-elite-material-fade`），
 * 跟着开关一起删了 —— 材质开关一年点不了几次，为那一次不硬切常驻一整套
 * 「顶栏 ::before 叠层 + 四块浮层颜色补间」的样式不划算。
 */

const NIGHT_STYLE_ID = 'bili-elite-night-style'

const ROOT_NIGHT = 'bili-elite-night'
/** B 站原生夜间模式的根类：首页 / 动态页那套深色样式挂在它上面（实测 html.bili_dark） */
const BILI_DARK = 'bili_dark'

/**
 * 但**大部分页面并不看这个类**。B 站有两套主题机制，按页面走：
 *   - 首页 / 动态页：`html.bili_dark` 类，加类即生效（页面自己的 CSS 里写了深色规则）；
 *   - 视频页 / 搜索页 / 历史记录 / 个人空间：靠一张主题样式表（`#__css-map__`），
 *     亮色时 href 是 `bili-theme/light.css`（个人空间是 `laputa-css/light.css`），
 *     夜间就是把 href 换成同目录的 `dark.css` —— 这些页面里**一条 bili_dark 规则都没有**，
 *     只加类完全没反应，这正是「开了夜间模式，换到别的界面又变回白色」的原因。
 * `light_u.css`（基础色板）不参与切换，`dark_u.css` 根本不存在，别去动它。
 */
const THEME_LIGHT_RE = /(?:bili-theme|laputa-css)\/light\.css$/
const THEME_DARK_RE = /(?:bili-theme|laputa-css)\/dark\.css$/

/**
 * View Transitions API 的最小类型。TS 的 DOM lib 版本不一定带 `startViewTransition`
 * （它到 2024 年底才进标准），这里自己声明，避免为了一个类型把 lib 升上去。
 */
interface ViewTransitionLike {
  ready: Promise<void>
  finished: Promise<void>
}
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike
}

/** 切换动画时长：与 BewlyCat `useDark` 同一档（300ms / ease-in-out），参考时的手感一致 */
const NIGHT_VT_MS = 300
/** 等主题表换上的上限 —— 换不上（离线 / 404）也要让切换继续，不能把整个动画卡住 */
const THEME_WAIT_MS = 300

/** 是不是我们加上去的 —— 用户自己开着原生夜间时，关掉我们的开关不能把它一起关掉 */
let darkAddedByUs = false
/**
 * 被我们换成 dark.css 的 <link>：只还原自己动过的，用户自己开着的夜间不动。
 *
 * 1.1.6 v015 从 WeakSet 换成 Set：关灯时要判断「还有没有欠账没还」（见 reconcile 的
 * 快路径），WeakSet 数不出来。还完一个删一个，不会攒住已经离开文档的节点。
 */
const swappedLinks = new Set<HTMLLinkElement>()

let nightOn = false
let disposeWatch: (() => void) | null = null
let queued = false

function ensureStyle(id: string, css: string) {
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  ;(document.head || document.documentElement).appendChild(style)
}

/** 当前页面上的主题样式表（按 href 找，`#__css-map__` 只是它顺手带的 id，个人空间那份也带） */
function themeLinks(): HTMLLinkElement[] {
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>(
      'link[href*="bili-theme/"], link[href*="laputa-css/"]',
    ),
  )
}

/** 把原生夜间切到 on/off。on 时类名和主题表一起上，因为不同页面认的不是同一个。 */
function syncNativeDark(on: boolean) {
  const root = document.documentElement.classList

  if (on) {
    if (!root.contains(BILI_DARK)) {
      root.add(BILI_DARK)
      darkAddedByUs = true
    }
    for (const link of themeLinks()) {
      const href = link.getAttribute('href') || ''
      if (!THEME_LIGHT_RE.test(href)) continue
      swappedLinks.add(link)
      link.setAttribute('href', href.replace(/light\.css$/, 'dark.css'))
    }
    return
  }

  if (darkAddedByUs) {
    root.remove(BILI_DARK)
    darkAddedByUs = false
  }
  for (const link of swappedLinks) {
    // 站内换页会把整张主题表换掉，旧节点已经不在文档里了 —— 顺手清出集合，
    // 免得 reconcile 的快路径永远觉得「还有欠账」而每次都去查一遍 <link>
    if (!link.isConnected) {
      swappedLinks.delete(link)
      continue
    }
    const href = link.getAttribute('href') || ''
    if (!THEME_DARK_RE.test(href)) {
      swappedLinks.delete(link)
      continue
    }
    link.setAttribute('href', href.replace(/dark\.css$/, 'light.css'))
    swappedLinks.delete(link)
  }
}

function apply() {
  const root = document.documentElement.classList
  nightOn = !!get('nightMode')
  root.toggle(ROOT_NIGHT, nightOn)
  // **样式表和观察器都只在「真的要开灯」时才上**（1.2.0 v005）。
  // 夜间模式默认关着，而 night.css 有 14.5KB、两个观察器还分别盯着 <head> 整棵子树
  // 和 <html> 的 class —— B 站首屏往 <head> 里插几十个节点，那两个回调白跑一整个加载期。
  // 关灯时把观察器摘掉，下次打开再挂（watchTheme 自己幂等）。
  if (nightOn) {
    ensureStyle(NIGHT_STYLE_ID, nightCss)
    watchTheme()
  }
  else {
    disposeWatch?.()
  }
  syncNativeDark(nightOn)
}

/** 当前是不是夜间（浮钮与设置面板共用；只读 config，不猜类名） */
export function isNightMode(): boolean {
  return !!get('nightMode')
}

/**
 * 等主题样式表换好。
 *
 * `links` 是**换之前**那批 `light.css` / `dark.css` 的节点（apply 会把同一个 `<link>`
 * 的 href 改掉），所以要在 `persist()` 之前取、之后监听。首页 / 动态页没有这类
 * `<link>`（它们只认 `bili_dark` 类），传进来是空数组，立刻返回。
 *
 * 为什么必须等：换表是异步的（实测 20~50ms）。View Transition 的「新」快照在回调
 * 返回后立刻拍，抢在换表完成前就会拍到一个亮色页面 —— 圆铺开以后里面还是白的，
 * 等 300ms 动画结束才突然变黑，比没有动画还难看。
 */
function waitForTheme(links: HTMLLinkElement[]): Promise<void> {
  if (!links.length) return Promise.resolve()
  const loads = links.map(link => new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      link.removeEventListener('load', done)
      link.removeEventListener('error', done)
      resolve()
    }
    link.addEventListener('load', done)
    link.addEventListener('error', done)
  }))
  return Promise.race([
    Promise.all(loads).then(() => {}),
    new Promise<void>(resolve => window.setTimeout(resolve, THEME_WAIT_MS)),
  ])
}

/**
 * 切换夜间模式（浮钮 / 设置面板都走这里，别自己 `persist({ nightMode })`）。
 *
 * 整页过渡参考 `bili_cat` 的 `useDark`：用 View Transitions API 做「以点击处为圆心」
 * 的圆形揭示 —— 开灯时新一帧从圆心铺开，关灯时旧一帧向圆心收拢。
 * 不支持 View Transitions（Firefox）或系统开了「减少动态效果」时直接切，不留半截动画。
 *
 * 三个顺序上的硬约束：
 *   1. **`persist()` 必须写在 startViewTransition 的回调里**。新旧两帧是回调
 *      前后的快照，回调外的类名变化根本进不了「新」那一帧。
 *   2. **必须在回调里等主题表换上**，理由见 waitForTheme()。
 *   3. 过渡期间给页面盖一层 `transition:none`：快照是静态图，底下的颜色补间只会让
 *      扩散边缘两侧对不上。浮钮在自己的 Shadow DOM 里，不受这条影响，照常做图标切换。
 */
export function setNightMode(on: boolean, origin?: { x: number, y: number }) {
  if (isNightMode() === on) return

  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    persist({ nightMode: on })
    return
  }

  const x = Math.round(origin?.x ?? window.innerWidth / 2)
  const y = Math.round(origin?.y ?? window.innerHeight / 2)
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const clip = [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]

  // 换表前先记下要等的节点（apply 会改写它们的 href，之后就认不出来了）
  const themeTargets = themeLinks().filter((link) => {
    const href = link.getAttribute('href') || ''
    return on ? THEME_LIGHT_RE.test(href) : THEME_DARK_RE.test(href)
  })

  const killTransitions = document.createElement('style')
  killTransitions.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(killTransitions)

  // startViewTransition 在文档不是 fully active（正在卸载 / 后台快照）时会抛错。
  // 抛了就当成「不支持」处理：清掉那层 transition:none，再直接切 —— 否则它会永远
  // 留在 <head> 里，整页的过渡动画从此全没了。
  let transition: ViewTransitionLike
  try {
    transition = doc.startViewTransition(async () => {
      persist({ nightMode: on })
      await waitForTheme(themeTargets)
    })
  }
  catch {
    killTransitions.remove()
    persist({ nightMode: on })
    return
  }

  void transition.ready.then(() => {
    // 开灯：新的（夜间）那层压在上面，圆从点击处铺开；
    // 关灯：旧的（夜间）那层压在上面，圆向点击处收拢、露出下面的亮色页面。
    const zStyle = document.createElement('style')
    zStyle.textContent = on
      ? '::view-transition-old(root){z-index:1}::view-transition-new(root){z-index:9999}'
      : '::view-transition-old(root){z-index:9999}::view-transition-new(root){z-index:1}'
    document.head.appendChild(zStyle)

    const clear = () => zStyle.remove()
    try {
      const anim = document.documentElement.animate(
        { clipPath: on ? clip : [...clip].reverse() },
        {
          duration: NIGHT_VT_MS,
          easing: 'ease-in-out',
          pseudoElement: on ? '::view-transition-new(root)' : '::view-transition-old(root)',
        } as KeyframeAnimationOptions & { pseudoElement: string },
      )
      void anim.finished.then(clear, clear)
    }
    catch {
      clear()
    }
  }).catch(() => {})

  const done = () => killTransitions.remove()
  void transition.finished.then(done, done)
}

/**
 * 站内换页有两副面孔：
 *   - 整页跳转（点 logo / 地址栏）：内容脚本重跑一遍，天然没问题；
 *   - 站内路由（首页点视频、顶栏切页）：不重载文档，B 站会**换掉那张主题表**
 *     （删掉旧的、插一张 light.css，或者把 href 改回去），`<html>` 上的类也可能被清掉。
 *     所以挂两个观察器：head 里 link 增删 / href 变化、html 的 class 变化，命中就补一次。
 * 白天（开关关着）直接返回，不产生任何查询。
 */
function watchTheme() {
  if (disposeWatch) return

  const schedule = () => {
    if (queued || !nightOn) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      // **不能在这里无脑 `syncNativeDark(true)`**（1.1.6 v015 的跨标签页 bug）：
      // rAF 在隐藏标签页里是**停摆**的，排队的那条回调要等用户切回来才执行。
      // 排队的这一刻夜间还开着，执行的那一刻用户可能早就关了 —— 再补一次「打开」
      // 就会把 B 站原生夜间（bili_dark 类 / dark.css）又挂回去：顶栏是我们自己的类
      // （bili-elite-night）管的、已经恢复了，页面主体却还是黑的。
      // 所以回调里一律按**当前**开关重算，而不是重放排队时的动作。
      apply()
    })
  }

  const head = document.head || document.documentElement
  const headObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        schedule()
        return
      }
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeName === 'LINK') {
          schedule()
          return
        }
      }
    }
  })
  headObserver.observe(head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  })

  const rootObserver = new MutationObserver(schedule)
  rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  /**
   * 切回这个标签页时再对一遍状态。
   *
   * 隐藏标签页里 rAF 停摆：上面那条排队回调可能压了很久，而「用户关掉夜间」这件事
   * 是在别的标签页发生的（storage.onChanged 会到，apply 也会跑），两条路谁先谁后
   * 不确定。切回来是唯一一个「用户一定在看着这一页」的时刻，在这里以当前开关为准
   * 再算一次，就能保证「打开 / 关闭，所有标签页完美响应」。
   */
  const onVisibility = () => {
    if (document.visibilityState === 'visible') apply()
  }
  document.addEventListener('visibilitychange', onVisibility)

  disposeWatch = () => {
    headObserver.disconnect()
    rootObserver.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    disposeWatch = null
  }
}

export function setupLabFeatures(): () => void {
  // 注意：这里**不再无条件 ensureStyle**（1.2.0 v005）。夜间模式默认关着，
  // 关着的时候这份 14.5KB 样式一条都匹配不上，白占一次解析；apply() 里按开关决定。
  apply()

  const off = onConfigChange((key) => {
    if (key === 'nightMode') apply()
  })

  return () => {
    off()
    document.documentElement.classList.remove(ROOT_NIGHT)
    nightOn = false
    syncNativeDark(false)
    disposeWatch?.()
    document.getElementById(NIGHT_STYLE_ID)?.remove()
  }
}

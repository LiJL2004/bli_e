import type { FeatureKey } from '~/shared/features'
import { get, onConfigChange, persist } from '../config'

/**
 * 右下角那列「操作浮钮」（返回顶部 / 刷新 / 设置键）的收纳控制。
 *
 * 三个开关（界面优化 → 操作浮钮那张小卡）：
 *   · 自动隐藏 —— 鼠标不靠近屏幕右边缘时整列滑出屏幕，移回边缘再滑出来；
 *   · 自动隐藏时始终显示操作按钮 —— 收起只收走设置键，返回顶部 / 刷新 留在原位；
 *   · 半隐藏 —— 平时只露右半边并压暗，鼠标移上去才完全展开。
 * 「自动隐藏」与「半隐藏」互斥：后打开的那个赢，另一个自动关掉（与 BewlyCat 一致）。
 * 收纳行为的上游出处：BewlyBewly `components/Dock/Dock.vue`（`autoHideDock` / `halfHideDock`，
 * 100% / 50% 位移 + opacity .6 + 14px 边缘热区），出处与许可见 THIRD-PARTY-NOTICES.md。
 *
 * 为什么单独一个模块：这列按钮分属两个模块、两个 Shadow DOM（⚙ 在 settingsPanel.ts，
 * 返回顶部 / 刷新 在 floatingButtons.ts），但收起时必须像一列一样整体动。
 * 所以两边只负责「登记自己是哪一颗」，位移 / 透明度统一由这里写 —— 定时器、边缘热区、
 * 悬停计数只有一份，不会出现「⚙ 收起了、浮键还在」这种错位。
 *
 * 两个实现上的硬约束（都是踩过的）：
 *   1. **动的必须是影子根里那颗按钮，不能是宿主 div**。设置面板和 ⚙ 在同一个影子根里，
 *      宿主一旦有 translate / transform，面板的 position:fixed 就会改以宿主为参照系，
 *      整块面板会缩进 44×44 的角落里。
 *   2. **用 `translate` 而不是 `transform` 做位移**。⚙ 和浮键的悬停放大 / 按下挤压
 *      都写在 `transform` 上（还带弹性曲线），行内再写 transform 会把它们整个盖掉；
 *      `translate` 是独立属性，两者可以各动各的，也各走各的 transition。
 */

/** 登记一颗浮钮 */
export interface FloatDockTarget {
  /** 影子根里真正要位移的元素（⚙ 那颗按钮 / 浮键那一列） */
  animEl: HTMLElement
  /** 宿主 div：只用来量「离视口右边多远」（= CSS 里的 right），不参与动画 */
  host: HTMLElement
  /** 收鼠标事件的元素：宿主是 pointer-events:none，真正接得到事件的是里面的按钮 */
  hoverEls: HTMLElement[]
  /**
   * panel = 设置键（「收起时保留操作键」时被单独收走的那一颗）
   * actions = 返回顶部 / 刷新（那一项开着时它们始终留在原位）
   */
  role: 'panel' | 'actions'
}

/** 一颗浮钮当前被画成的样子：展开 / 半隐藏 / 完全收起 */
type DockState = 'open' | 'half' | 'full'

interface DockEntry extends FloatDockTarget {
  /** 与宿主 right 一致的距离（px）：半隐藏要把它一起补上才是「露出右半边」 */
  gap: number
  /** 上一次画上去的状态 —— 没变就不写行内样式（这段会被 mousemove 间接触发） */
  state: DockState
}

/** 鼠标进到「距右边缘这么近」的一条带子里就把整列滑出来 */
const EDGE = 20
/** 滑出的延迟：只是路过右边缘（去拖滚动条）不该把浮钮弹出来 */
const REVEAL_DELAY = 100
/** 收回的延迟：从浮钮挪到旁边、或者短暂离开时留一点容错 */
const HIDE_DELAY = 600
/** 半隐藏时压暗到多少 */
const HALF_OPACITY = '0.6'

const entries = new Set<DockEntry>()

/** 整列当前是否展开（自动隐藏 / 半隐藏共用一份） */
let revealed = false
/** 设置面板开着时暂停收纳 —— ⚙ 滑走了、面板还杵在那儿会很怪 */
let paused = false
/** 鼠标当前压着几颗浮钮（⚙ 与浮键各算各的，跨按钮时不会闪一下收起） */
let hoverCount = 0
let revealTimer: number | null = null
let hideTimer: number | null = null
/** mousemove 合帧用：一帧最多算一次，且只读 clientX（不读布局） */
let ticking = false
let listening = false
/** 「上一次是否处于收纳模式」，用来判断开关是刚打开还是刚关掉 */
let wasOn = false
let offConfig: (() => void) | null = null

function clearTimer(t: number | null): null {
  if (t !== null) window.clearTimeout(t)
  return null
}

/** 把状态写到某一颗浮钮上 */
function write(e: DockEntry, state: DockState) {
  if (e.state === state) return
  e.state = state
  const s = e.animEl.style
  if (state === 'open') {
    s.removeProperty('translate')
    s.removeProperty('opacity')
    s.removeProperty('pointer-events')
    e.host.style.removeProperty('pointer-events')
    return
  }
  // 按钮挪走以后，宿主那个 44×44 的空框还留在原地 —— 它是 pointer-events:auto 的，
  // 会替页面挡下一整块点不到的区域（实测点在空框上命中的是宿主自己）。
  // 所以收起 / 半隐藏时把宿主让开，只让按钮自己收事件（浮键那列本来就是 none，不受影响）。
  e.host.style.setProperty('pointer-events', 'none', 'important')
  s.setProperty('pointer-events', 'auto', 'important')
  // 收起 = 自身宽度 + 离边缘那一段，整颗真正移出视口（多补 8px 让投影也一起出去）；
  // 半隐藏 = 自身一半 + 离边缘那一段，于是正好露出右半边。
  // **半隐藏得把滚动条宽度减掉**：视口最右那十几像素是滚动条，不透明、也接不到鼠标事件，
  // 露在它后面等于没露（Windows 上 44px 的圆只剩 7px 能看、能点）。
  // 只在画半隐藏时读一次 clientWidth —— 这个状态只在悬停进出时切，代价可以忽略。
  const sbw = state === 'half' ? Math.max(0, window.innerWidth - document.documentElement.clientWidth) : 0
  const offset = state === 'half' ? `calc(50% + ${e.gap - sbw}px)` : `calc(100% + ${e.gap + 8}px)`
  s.setProperty('translate', `${offset} 0`, 'important')
  s.setProperty('opacity', state === 'half' ? HALF_OPACITY : '0', 'important')
}

/** 按当前开关 + 展开状态重画一遍。只在真的变了的时候写样式 */
function paint() {
  const auto = !!get('fabAutoHide')
  const half = !auto && !!get('fabHalfHide')
  const keep = !!get('fabKeepActions')
  // 两个收纳开关都关掉、或者面板开着 → 永远是展开态
  const collapsed = (auto || half) && !revealed && !paused
  for (const e of entries) {
    // 「收起时保留操作键」：只收设置键，返回顶部 / 刷新 不跟着走。
    // 只在自动隐藏下生效 —— 它是自动隐藏的子项，切到半隐藏后残留在存储里的 true 不该继续起作用
    const exempt = collapsed && auto && keep && e.role === 'actions'
    write(e, !collapsed || exempt ? 'open' : half ? 'half' : 'full')
  }
}

function reveal() {
  revealTimer = clearTimer(revealTimer)
  if (revealed) return
  revealed = true
  paint()
}

function collapse() {
  hideTimer = clearTimer(hideTimer)
  if (!revealed) return
  revealed = false
  paint()
}

/**
 * 边缘热区：只有「自动隐藏」开着时才挂。
 *
 * 用 window 的 mousemove 而不是在右边缘放一条命中区 —— 后者会盖住滚动条，
 * 拖不动滚动条比看不见浮钮严重得多。监听是被动的、每帧最多算一次、不读布局。
 */
function onMove(e: MouseEvent) {
  if (ticking) return
  ticking = true
  const x = e.clientX
  requestAnimationFrame(() => {
    ticking = false
    if (paused || !get('fabAutoHide')) return
    if (x >= window.innerWidth - EDGE) {
      hideTimer = clearTimer(hideTimer)
      if (!revealed && revealTimer === null) revealTimer = window.setTimeout(reveal, REVEAL_DELAY)
      return
    }
    revealTimer = clearTimer(revealTimer)
    // 鼠标压在浮钮上时不要收；刚滑出来还没挪走的那一下也别急着收
    if (revealed && hideTimer === null && hoverCount === 0) hideTimer = window.setTimeout(collapse, HIDE_DELAY)
  })
}

function bindMove(on: boolean) {
  if (on === listening) return
  listening = on
  if (on) window.addEventListener('mousemove', onMove, { passive: true })
  else window.removeEventListener('mousemove', onMove)
}

/** 开关 / 面板状态变化后统一收口：决定要不要听 mousemove，然后重画 */
function sync() {
  const on = (!!get('fabAutoHide') || !!get('fabHalfHide')) && !paused
  if (!on) {
    revealTimer = clearTimer(revealTimer)
    hideTimer = clearTimer(hideTimer)
    revealed = true
  }
  bindMove(!!get('fabAutoHide') && !paused)
  paint()
}

function onCfg(key: FeatureKey) {
  if (key !== 'fabAutoHide' && key !== 'fabHalfHide' && key !== 'fabKeepActions') return
  // 两条互斥：后打开的那个赢（persist 会再回到这里一次，那一趟两个不会同时为真，不会循环）
  if (get('fabAutoHide') && get('fabHalfHide')) persist(key === 'fabAutoHide' ? { fabHalfHide: false } : { fabAutoHide: false })
  const on = !!get('fabAutoHide') || !!get('fabHalfHide')
  // 刚打开收纳就立刻收起来 —— 不然用户会以为开关没生效（这时鼠标通常不在右边缘）
  if (on && !wasOn) revealed = false
  wasOn = on
  sync()
}

/**
 * 登记一颗浮钮，返回注销函数。
 * 两颗是先后登记的（⚙ 在首屏、浮键在空闲时），所以登记后要立刻按当前开关画一次。
 */
export function registerFloatDock(t: FloatDockTarget): () => void {
  // 位移量要补上宿主离右边的那一段，读一次就存起来（之后不再读布局）
  const gap = Number.parseFloat(getComputedStyle(t.host).right) || 24
  const entry: DockEntry = { ...t, gap, state: 'open' }

  const offs: Array<() => void> = []
  for (const el of t.hoverEls) {
    const enter = () => {
      hoverCount++
      hideTimer = clearTimer(hideTimer)
      // 「收起时保留操作键」：操作键本来就常显，鼠标落在它上面时别把设置键也拉出来
      if (t.role === 'actions' && get('fabAutoHide') && get('fabKeepActions')) return
      reveal()
    }
    const leave = () => {
      hoverCount = Math.max(0, hoverCount - 1)
      if (hoverCount > 0 || paused) return
      if (get('fabAutoHide') || get('fabHalfHide')) hideTimer = window.setTimeout(collapse, HIDE_DELAY)
    }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    offs.push(() => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
    })
  }

  entries.add(entry)
  offConfig ??= onConfigChange(onCfg)
  wasOn = !!get('fabAutoHide') || !!get('fabHalfHide')
  // 首次登记时若收纳本来就是开着的，先按「收起」起手（页面刚打开，鼠标不该在浮钮上）。
  // 第二颗（浮键在空闲时才登记）不能再重置一次：那会把用户已经滑出来的整列又收回去
  if (wasOn && entries.size === 1) revealed = false
  sync()

  return () => {
    offs.forEach(fn => fn())
    entries.delete(entry)
    if (entries.size === 0) {
      offConfig?.()
      offConfig = null
      bindMove(false)
    }
  }
}

/** 设置面板开合时暂停 / 恢复收纳（开着时整列常显，关掉后按原状态收起） */
export function setFloatDockPaused(v: boolean) {
  if (paused === v) return
  paused = v
  if (v) revealed = true
  else if (hoverCount === 0 && (get('fabAutoHide') || get('fabHalfHide'))) hideTimer = window.setTimeout(collapse, HIDE_DELAY)
  sync()
}

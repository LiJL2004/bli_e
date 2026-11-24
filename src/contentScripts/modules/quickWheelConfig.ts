/**
 * 「功能轮盘」的配置：呼出按键 + 8 个固定槽位上分别装了什么。
 *
 * 和材质那几组不一样 —— 这里存的不是数字，而是一个「按键 code + 槽位数组」的对象，
 * 所以没走 paramStore（那是给数值滑块用的），单独一份读写。
 *
 * **槽位是固定的 8 个**（与参考图一致，每 45° 一个），数组长度恒为 `WHEEL_SLOTS`，
 * 元素为功能 id 或 `null`（该方向空着）。卸下 = 把某格写成 null，位置本身不会消失。
 *
 * 存储 key：bili-elite-wheel（chrome.storage.sync，无 chrome 时回落 localStorage）。
 * 与开关（bili-elite-settings）、数值参数（bili-elite-*-params）互不干扰。
 */

import { registerSyncKey, syncSet } from '../storage'
import { WHEEL_SLOTS } from './quickWheelLayout'

/** 轮盘上的一个可选项 */
export interface WheelEntry {
  /** 存储用的稳定 id，别改（改了用户已存的槽位就找不到它） */
  id: string
  label: string
  /** 轮盘中心 / 编辑器里那行说明 */
  desc: string
  url: string
  /** 已经在目标页上时返回 true：此时只收起轮盘，不做跳转（用户明确要求的「保持不变」） */
  isCurrent: () => boolean
  /** 24×24 线性图标（描边 currentColor），与设置面板左导航同一套画法 */
  icon: string
}

function hostIs(host: string) {
  return () => location.hostname === host
}

function pathIs(host: string, test: (p: string) => boolean) {
  return () => location.hostname === host && test(location.pathname)
}

/** 首页：`/` 与 `/index.html` 都算（B 站两种入口都有） */
const isHomeNow = pathIs('www.bilibili.com', p => p === '/' || p === '/index.html')

/**
 * 可配置的八个去处。顺序只决定编辑器里「功能入口」的排布，不再决定轮盘位置 ——
 * 位置由槽位决定（见 DEFAULT_WHEEL_CONFIG）。

 *
 * 只做「跳转」这一件事，不模拟站内路由：首页与动态分属两个域名，跨域跳转本来就要整页
 * 加载；用 location.assign 比猜 B 站的 SPA 路由可靠得多（个人空间 / 消息中心更是独立的
 * 子应用，站内路由根本不通）。
 */
export const WHEEL_ENTRIES: WheelEntry[] = [
  {
    id: 'home',
    label: '首页',
    desc: '回到推荐首页',
    url: 'https://www.bilibili.com/',
    isCurrent: isHomeNow,
    icon: '<path d="M4 10.6 12 4l8 6.6V19a1 1 0 0 1-1 1h-4.3v-5.1H9.3V20H5a1 1 0 0 1-1-1z"/>',
  },
  {
    id: 'anime',
    label: '番剧',
    desc: '追番与番剧推荐',
    url: 'https://www.bilibili.com/anime/?spm_id_from=333.1007.0.0',
    isCurrent: pathIs('www.bilibili.com', p => p.startsWith('/anime')),
    // 电视机 + 天线 + 播放三角：和顶栏「番剧」入口同一个意象
    icon: '<rect x="3.4" y="7" width="17.2" height="12.4" rx="2.8"/><path d="M8.6 3.6 12 7l3.4-3.4"/><path d="M10.6 11.2v4.2l3.6-2.1z"/>',
  },
  {
    id: 'dynamic',
    label: '动态',
    desc: '关注的人的最新动态',
    url: 'https://t.bilibili.com/',
    isCurrent: hostIs('t.bilibili.com'),
    // 四叶风车：与顶栏「动态」入口同一枚图标（四片叶子绕中心各转 90°）
    icon: '<g><path d="M12 12C12 9 10 6.6 7.6 6.6 6 6.6 4.9 7.7 4.9 9.1 4.9 10.9 6.9 12 12 12Z"/><path d="M12 12C12 9 10 6.6 7.6 6.6 6 6.6 4.9 7.7 4.9 9.1 4.9 10.9 6.9 12 12 12Z" transform="rotate(90 12 12)"/><path d="M12 12C12 9 10 6.6 7.6 6.6 6 6.6 4.9 7.7 4.9 9.1 4.9 10.9 6.9 12 12 12Z" transform="rotate(180 12 12)"/><path d="M12 12C12 9 10 6.6 7.6 6.6 6 6.6 4.9 7.7 4.9 9.1 4.9 10.9 6.9 12 12 12Z" transform="rotate(270 12 12)"/></g>',
  },
  {
    id: 'message',
    label: '消息',
    desc: '私信与回复 / @ 通知',
    url: 'https://message.bilibili.com/?spm_id_from=333.1007.0.0#/whisper',
    isCurrent: hostIs('message.bilibili.com'),
    // 信封：圆角矩形 + 封口折线，和顶栏「消息」同一枚
    icon: '<rect x="3.4" y="5.6" width="17.2" height="12.8" rx="3"/><path d="M4.9 8.2 12 13.4l7.1-5.2"/>',
  },
  {
    id: 'fav',
    label: '收藏',
    desc: '你的收藏夹',
    url: 'https://space.bilibili.com/476907513/favlist?fid=745462713&ftype=create',
    isCurrent: pathIs('space.bilibili.com', p => p.includes('/favlist')),
    // 星星 + 笑脸：顶栏「收藏」那枚就是带笑的星星
    icon: '<path d="M12 3.9l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z"/><path d="M10.3 11.5h.01M13.7 11.5h.01"/><path d="M10.7 13.5c.4.6.9.9 1.3.9s.9-.3 1.3-.9"/>',
  },
  {
    id: 'history',
    label: '历史',
    desc: '最近看过的视频',
    url: 'https://www.bilibili.com/history?spm_id_from=333.1387.0.0',
    isCurrent: pathIs('www.bilibili.com', p => p.startsWith('/history')),
    // 时钟：顶栏「历史」同一枚
    icon: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.2V12l3.2 1.9"/>',
  },

  {
    id: 'space',
    label: '个人主页',
    desc: '你自己的空间主页',
    url: 'https://space.bilibili.com/476907513?spm_id_from=333.1387.0.0',
    isCurrent: pathIs('space.bilibili.com', p => p.startsWith('/476907513') && !p.includes('/favlist')),
    icon: '<circle cx="12" cy="8.4" r="3.4"/><path d="M5.4 20c1.4-3.5 3.9-5.2 6.6-5.2s5.2 1.7 6.6 5.2"/>',
  },
  {
    id: 'live',
    label: '直播',
    desc: '正在直播的推荐',
    url: 'https://live.bilibili.com/?spm_id_from=333.1007.0.0',
    isCurrent: hostIs('live.bilibili.com'),
    icon: '<circle cx="12" cy="12" r="2.3"/><path d="M8 8a5.6 5.6 0 0 0 0 8M16 16a5.6 5.6 0 0 0 0-8"/><path d="M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 18.8a9.6 9.6 0 0 0 0-13.6"/>',
  },
]

export const WHEEL_STORAGE_KEY = 'bili-elite-wheel'

export interface WheelConfig {
  /** KeyboardEvent.code —— 存物理键位而不是 key，换输入法 / 大小写都不会失效 */
  key: string
  /** 长度恒为 WHEEL_SLOTS：下标 = 槽位（0 是正上方，顺时针），值 = 功能 id 或 null */
  slots: (string | null)[]
}

/**
 * 默认排布（与参考图一致：正上方是首页、正下方是动态），八格正好装满八项、左右各三：
 *   0 顶部 首页   1 右上 番剧   2 右 消息    3 右下 收藏
 *   4 底部 动态   5 左下 历史   6 左 个人主页 7 左上 直播
 * 卸下任意一格之后才会出现空位（空位画成虚线占位圈，位置本身不会消失）。
 */
export const DEFAULT_WHEEL_CONFIG: WheelConfig = {
  key: 'Tab',
  slots: ['home', 'anime', 'message', 'fav', 'dynamic', 'history', 'space', 'live'],
}


/** 按键的中文名。查不到就退化成 code 本身，至少不会显示成空白 */
const KEY_LABELS: Record<string, string> = {
  Tab: 'Tab',
  Space: '空格',
  Enter: '回车',
  Backspace: '退格',
  CapsLock: 'Caps',
  Escape: 'Esc',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  Insert: 'Ins',
  Delete: 'Del',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  MetaLeft: '左 ⌘',
  MetaRight: '右 ⌘',
}

export function keyLabel(code: string): string {
  const known = KEY_LABELS[code]
  if (known) return known
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `小键盘 ${code.slice(6)}`
  return code
}

/** 只按修饰键不能当呼出键：按住它本来就是为了组合，单按没意义，也容易误触 */
export function isModifierCode(code: string): boolean {
  return /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(code)
}

function cloneSlots(list: (string | null)[]) {
  return [...list]
}

function clone(cfg: WheelConfig): WheelConfig {
  return { key: cfg.key, slots: cloneSlots(cfg.slots) }
}

let config: WheelConfig = clone(DEFAULT_WHEEL_CONFIG)
const listeners = new Set<() => void>()

/**
 * 只保留已知 id、去重、并固定成长度 WHEEL_SLOTS —— 存储里的脏数据不该让轮盘画崩。
 * 位置本身是有意义的（0 必须是最上方），所以逐位处理，不做「压缩」。
 */
function sanitizeSlots(list: unknown): (string | null)[] {
  const out: (string | null)[] = new Array(WHEEL_SLOTS).fill(null)
  if (!Array.isArray(list)) return cloneSlots(DEFAULT_WHEEL_CONFIG.slots)
  const seen = new Set<string>()
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    const id = list[i]
    if (typeof id !== 'string' || seen.has(id)) continue
    if (!WHEEL_ENTRIES.some(e => e.id === id)) continue
    seen.add(id)
    out[i] = id
  }
  return out
}

function notify() {
  listeners.forEach((cb) => {
    try {
      cb()
    }
    catch { /* 单个订阅者出错不影响其它人 */ }
  })
}

function applyValues(patch: Partial<WheelConfig>) {
  let changed = false
  if (typeof patch.key === 'string' && patch.key && patch.key !== config.key) {
    config.key = patch.key
    changed = true
  }
  if (Array.isArray(patch.slots)) {
    const next = sanitizeSlots(patch.slots)
    if (next.join('|') !== config.slots.join('|')) {
      config.slots = next
      changed = true
    }
  }
  if (changed) notify()
}

/** 整份写回：配置本来就小，分字段合并只会多一处可能写漏的地方 */
function write() {
  // 扩展重载后 chrome.storage 会同步抛错，统一走 storage.ts 的入口（见 chromeApi）
  if (syncSet({ [WHEEL_STORAGE_KEY]: clone(config) }))
    return
  try {
    localStorage.setItem(WHEEL_STORAGE_KEY, JSON.stringify(config))
  }
  catch { /* 存储写不进去不该影响功能 */ }
}

export function getWheelConfig(): WheelConfig {
  return clone(config)
}

/** 8 个槽位上分别装了什么（null = 空着），长度恒为 WHEEL_SLOTS */
export function getWheelSlots(): (string | null)[] {
  return cloneSlots(config.slots)
}

/** 取某个槽位上的功能；空槽返回 null */
export function getWheelEntryAt(slot: number): WheelEntry | null {
  const id = config.slots[slot]
  if (!id) return null
  return WHEEL_ENTRIES.find(e => e.id === id) ?? null
}

export function setWheelKey(code: string) {
  if (!code || code === config.key) return
  config.key = code
  notify()
  write()
}

export function setWheelSlots(slots: (string | null)[]) {
  const next = sanitizeSlots(slots)
  if (next.join('|') === config.slots.join('|')) return
  config.slots = next
  notify()
  write()
}

export function onWheelConfigChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 登记到统一存储入口（见 storage.ts）；读取在 index.ts 的 startStorageSync() 里发起 */
export function bootstrapWheelConfig() {
  registerSyncKey(WHEEL_STORAGE_KEY, (raw) => {
    if (raw && typeof raw === 'object') applyValues(raw as Partial<WheelConfig>)
  })
}

/** 「恢复默认设置」：按键与八个槽位一起回到出厂状态 */
export function resetWheelConfig() {
  config = clone(DEFAULT_WHEEL_CONFIG)
  notify()
  write()
}

/**
 * 设置面板正在「按一个键来绑定」时置位。
 * 轮盘自己的 keydown 先看这个标志 —— 否则用户在面板里按下 Tab 绑定，轮盘会同时弹出来，
 * 而且 Tab 的默认行为也被我们吃掉了，绑定框永远等不到那次按键。
 */
let capturing = false

export function setWheelKeyCapturing(on: boolean) {
  capturing = on
}

export function isWheelKeyCapturing(): boolean {
  return capturing
}

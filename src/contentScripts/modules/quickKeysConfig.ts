/**
 * 「页面快捷键」：快速刷新 / 快速回到顶部 各自绑的那颗键。
 *
 * 与另外两份按键配置互不相干：
 * - 功能轮盘的呼出键在 quickWheelConfig.ts（`bili-elite-wheel`）
 * - 设置面板的呼出键在 panelHotkeyConfig.ts（`bili-elite-panel-hotkey`）
 * 三者都是「一个动作一颗键」，但语义不同（按住出圆盘 / 开关面板 / 按一下执行），
 * 合并成一份结构只会让以后加一个动作就要迁移一次存储。
 *
 * 存的是 `KeyboardEvent.code`（物理键位）：默认的 X / Z 都是字母键，用 `key` 的话
 * 中文输入法下拿到的是「x」、Shift 按下是「X」，判定会莫名其妙失效。
 *
 * 存储 key：bili-elite-quick-keys（chrome.storage.sync，无 chrome 时回落 localStorage）。
 */

import { registerSyncKey, syncSet } from '../storage'

export type QuickKeyAction = 'refresh' | 'backtop'

export const QUICK_KEYS_STORAGE_KEY = 'bili-elite-quick-keys'

/** 默认：X 刷新、Z 回到顶部（用户指定） */
export const DEFAULT_QUICK_KEYS: Record<QuickKeyAction, string> = {
  refresh: 'KeyX',
  backtop: 'KeyZ',
}

const ACTIONS: QuickKeyAction[] = ['refresh', 'backtop']

let keys: Record<QuickKeyAction, string> = { ...DEFAULT_QUICK_KEYS }
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((cb) => {
    try {
      cb()
    }
    catch { /* 单个订阅者出错不影响其它人 */ }
  })
}

function write() {
  // 扩展重载后 chrome.storage 会同步抛错，统一走 storage.ts 的入口（见 chromeApi）
  if (syncSet({ [QUICK_KEYS_STORAGE_KEY]: { ...keys } }))
    return
  try {
    localStorage.setItem(QUICK_KEYS_STORAGE_KEY, JSON.stringify(keys))
  }
  catch { /* 存储写不进去不该影响功能 */ }
}

/** 存储里的脏数据（空串 / 非字符串）一律跳过，保留当前值 —— 坏一份不该让键全失效 */
function apply(raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const src = raw as Partial<Record<QuickKeyAction, unknown>>
  let changed = false
  for (const action of ACTIONS) {
    const next = src[action]
    if (typeof next !== 'string' || !next || next === keys[action]) continue
    keys[action] = next
    changed = true
  }
  if (changed) notify()
}

export function getQuickKeys(): Record<QuickKeyAction, string> {
  return { ...keys }
}

export function getQuickKey(action: QuickKeyAction): string {
  return keys[action]
}

export function setQuickKey(action: QuickKeyAction, code: string) {
  if (!code || code === keys[action]) return
  keys[action] = code
  notify()
  write()
}

export function onQuickKeysChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 登记到统一存储入口（见 storage.ts）；读取在 index.ts 的 startStorageSync() 里发起 */
export function bootstrapQuickKeysConfig() {
  registerSyncKey(QUICK_KEYS_STORAGE_KEY, apply)
}

/** 「恢复默认设置」：回到 X / Z */
export function resetQuickKeys() {
  if (keys.refresh === DEFAULT_QUICK_KEYS.refresh && keys.backtop === DEFAULT_QUICK_KEYS.backtop) return
  keys = { ...DEFAULT_QUICK_KEYS }
  notify()
  write()
}

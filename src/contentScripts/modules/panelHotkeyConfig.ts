/**
 * 「快速使用设置面板」的呼出按键。
 *
 * 与功能轮盘（quickWheelConfig.ts）是两份独立的配置：轮盘的呼出键决定「弹不弹圆盘」，
 * 这个键决定「开不开右下角那块设置面板」，两者可以各自换成任意物理键、互不牵连。
 * 之所以不并进 `bili-elite-wheel`：那个对象里的 `slots` 是八个槽位，语义完全不同，
 * 混在一起以后加一个键就要迁移一次结构。
 *
 * 存的是 `KeyboardEvent.code`（物理键位）而不是 `key`：`` ` `` 和 `~` 是同一个键的
 * 两种状态，`code` 恒为 `Backquote`，中英文输入法、Shift 状态都不会让判定失效。
 *
 * 存储 key：bili-elite-panel-hotkey（chrome.storage.sync，无 chrome 时回落 localStorage）。
 */

import { registerSyncKey, syncSet } from '../storage'

export const PANEL_HOTKEY_STORAGE_KEY = 'bili-elite-panel-hotkey'

/** 默认就是键盘左上角那颗 `` ` ``（Esc 下面、Tab 上面），code 恒为 Backquote */
export const DEFAULT_PANEL_HOTKEY = 'Backquote'

let hotkey = DEFAULT_PANEL_HOTKEY
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
  if (syncSet({ [PANEL_HOTKEY_STORAGE_KEY]: { key: hotkey } }))
    return
  try {
    localStorage.setItem(PANEL_HOTKEY_STORAGE_KEY, JSON.stringify({ key: hotkey }))
  }
  catch { /* 存储写不进去不该影响功能 */ }
}

function apply(raw: unknown) {
  const next = (raw as { key?: unknown } | null)?.key
  if (typeof next !== 'string' || !next || next === hotkey) return
  hotkey = next
  notify()
}

export function getPanelHotkey(): string {
  return hotkey
}

export function setPanelHotkey(code: string) {
  if (!code || code === hotkey) return
  hotkey = code
  notify()
  write()
}

export function onPanelHotkeyChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 登记到统一存储入口（见 storage.ts）；读取在 index.ts 的 startStorageSync() 里发起 */
export function bootstrapPanelHotkeyConfig() {
  registerSyncKey(PANEL_HOTKEY_STORAGE_KEY, apply)
}

/** 「恢复默认设置」：回到 `` ` `` */
export function resetPanelHotkey() {
  if (hotkey === DEFAULT_PANEL_HOTKEY) return
  hotkey = DEFAULT_PANEL_HOTKEY
  notify()
  write()
}

/**
 * 通用「数值参数」存储。
 *
 * 毛玻璃、顶栏材质、设置面板材质原本各自维护一份几乎相同的
 * bootstrap / clamp / notify / persist 样板。这里收敛成一个工厂，
 * 三处参数（glass / topbar / panel）共用同一套读写与同步逻辑。
 *
 * 存储：chrome.storage.sync（无 chrome 时回落 localStorage），
 * 监听 onChanged 实现跨标签页 / 跨页面同步。
 */

import { registerSyncKey, syncSet } from '../storage'

export interface NumberParamDef<K extends string = string> {
  key: K
  label: string
  min: number
  max: number
  step: number
  default: number
  fmt: (v: number) => string
  /** 可选：滑块下方的小字说明，用来解释这个数值代表什么 */
  hint?: string
  /**
   * 可选：胶囊上显示的不是原始值本身时（如「偏暗 6」），用它把原始值换算成
   * 「用户看到的那个数字」，提交时再换回去 —— 保证点开输入框看到的就是胶囊上那个数。
   */
  edit?: {
    to: (v: number) => number
    from: (n: number) => number
  }
}

export interface NumberParamStore<K extends string> {
  defs: NumberParamDef<K>[]
  storageKey: string
  defaults: Record<K, number>
  get: () => Record<K, number>
  set: (key: K, value: number) => void
  /** 全部回到 defaults（「恢复默认设置」用），并写回存储 */
  reset: () => void
  /** 只应用一份原始数据（统一存储分发时用，不读存储、不挂监听） */
  apply: (raw: unknown) => void
  onChange: (cb: () => void) => () => void
  bootstrap: () => void
}

export function createNumberParamStore<K extends string>(
  storageKey: string,
  defs: NumberParamDef<K>[],
): NumberParamStore<K> {
  const params = {} as Record<K, number>
  for (const def of defs) {
    params[def.key] = def.default
  }
  const defaults = { ...params }
  const listeners = new Set<() => void>()

  const clamp = (def: NumberParamDef<K>, v: number): number =>
    Math.min(def.max, Math.max(def.min, v))

  function notify() {
    listeners.forEach((cb) => {
      try {
        cb()
      }
      catch {
        /* noop */
      }
    })
  }

  function applyValues(values: Partial<Record<K, number>>) {
    let changed = false
    for (const def of defs) {
      const v = values[def.key]
      if (typeof v !== 'number' || Number.isNaN(v))
        continue
      const clamped = clamp(def, v)
      if (params[def.key] !== clamped) {
        params[def.key] = clamped
        changed = true
      }
    }
    if (changed)
      notify()
  }

  function persist() {
    // 扩展重载后 chrome.storage 会同步抛错，统一走 storage.ts 的入口（见 chromeApi）
    if (syncSet({ [storageKey]: params }))
      return
    try {
      const raw = localStorage.getItem(storageKey)
      const cur = raw ? JSON.parse(raw) : {}
      localStorage.setItem(storageKey, JSON.stringify({ ...cur, ...params }))
    }
    catch {
      /* noop */
    }
  }

  function set(key: K, value: number) {
    const def = defs.find(d => d.key === key)
    if (!def)
      return
    const v = clamp(def, Math.round(value / def.step) * def.step)
    if (params[key] === v)
      return
    params[key] = v
    notify()
    persist()
  }

  function reset() {
    let changed = false
    for (const def of defs) {
      if (params[def.key] === defaults[def.key])
        continue
      params[def.key] = defaults[def.key]
      changed = true
    }
    // 即使内存里已经是默认值，也要写一次存储：另一个标签页 / 上一次会话可能存着非默认值
    persist()
    if (changed)
      notify()
  }

  /**
   * 只应用一份原始数据：不读存储、不挂监听。
   * 读取由 storage.ts 统一发起（一次 get(null) + 一个 onChanged 分发给所有 store），
   * 这里只负责「这份数据该怎么落到 params 上」。
   */
  function apply(raw: unknown) {
    if (raw && typeof raw === 'object')
      applyValues(raw as Partial<Record<K, number>>)
  }

  /** 登记到统一存储入口；真正的读取在 index.ts 的 startStorageSync() 里发起 */
  function bootstrap() {
    registerSyncKey(storageKey, apply)
  }

  return {
    defs,
    storageKey,
    defaults,
    get: () => ({ ...params }),
    set,
    reset,
    onChange: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    apply,
    bootstrap,
  }
}

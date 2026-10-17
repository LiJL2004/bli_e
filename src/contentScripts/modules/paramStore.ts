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
}

export interface NumberParamStore<K extends string> {
  defs: NumberParamDef<K>[]
  storageKey: string
  defaults: Record<K, number>
  get: () => Record<K, number>
  set: (key: K, value: number) => void
  /** 全部回到 defaults（「恢复默认设置」用），并写回存储 */
  reset: () => void
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
    const g: any = (globalThis as any).chrome
    if (g?.storage?.sync) {
      g.storage.sync.set({ [storageKey]: params })
      return
    }
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

  function bootstrap() {
    const g: any = (globalThis as any).chrome
    if (g?.storage?.sync) {
      g.storage.sync.get(storageKey, (s: any) => {
        applyValues((s && s[storageKey]) || {})
      })
      g.storage.onChanged.addListener((changes: any, ns: string) => {
        if (ns !== 'sync' || !changes[storageKey])
          return
        applyValues(changes[storageKey].newValue || {})
      })
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw)
        applyValues(JSON.parse(raw))
    }
    catch {
      /* noop */
    }
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
    bootstrap,
  }
}

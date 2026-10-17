import type { FeatureConfig, FeatureKey } from '~/shared/features'
import { DEFAULT_CONFIG, STORAGE_KEY } from '~/shared/features'
import { error, log } from './logger'

const config: FeatureConfig = { ...DEFAULT_CONFIG }

type Listener = (key: FeatureKey, value: boolean) => void
const listeners = new Set<Listener>()

export function get<K extends FeatureKey>(key: K): FeatureConfig[K] {
  return config[key]
}

export function getAll(): FeatureConfig {
  return { ...config }
}

export function onConfigChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function notify(key: FeatureKey, value: boolean) {
  listeners.forEach((cb) => {
    try { cb(key, value) } catch (e) { error('config listener threw', e) }
  })
}

function applyValues(values: Partial<FeatureConfig>) {
  for (const k of Object.keys(DEFAULT_CONFIG) as FeatureKey[]) {
    const v = values[k]
    if (v === undefined) continue
    const b = !!v
    if (config[k] === b) continue
    config[k] = b
    notify(k, b)
  }
}

export function bootstrapConfig() {
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.get(DEFAULT_CONFIG, (s) => {
      applyValues(s as Partial<FeatureConfig>)
      log('config loaded', getAll())
    })

    chrome.storage.onChanged.addListener((changes, ns) => {
      if (ns !== 'sync' || !changes[STORAGE_KEY]) return
      applyValues((changes[STORAGE_KEY].newValue || {}) as Partial<FeatureConfig>)
    })
    return
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) applyValues(JSON.parse(raw))
  } catch (e) {
    error('localStorage read failed', e)
  }
}

export function persist(patch: Partial<FeatureConfig>) {
  applyValues(patch)
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.set(patch, () => {
      if (chrome.runtime.lastError) error('persist failed', chrome.runtime.lastError)
    })
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const cur = raw ? JSON.parse(raw) : {}
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }))
    } catch (e) {
      error('localStorage write failed', e)
    }
  }
}

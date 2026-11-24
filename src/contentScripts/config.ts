import type { FeatureConfig, FeatureKey } from '~/shared/features'
import { DEFAULT_CONFIG, STORAGE_KEY } from '~/shared/features'
import { error, log } from './logger'
import { registerSyncKey, syncSet } from './storage'

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

/**
 * 只登记「开关存在哪个 key、拿到之后怎么应用」；读取由 storage.ts 统一发起
 * （一次 get(null) 把整包读回来，只挂一个 onChanged）。
 * 没存过的 key 走 applyValues 的 undefined 分支 —— 内存里本来就已经是默认值。
 */
export function bootstrapConfig() {
  registerSyncKey(STORAGE_KEY, (raw) => {
    if (!raw || typeof raw !== 'object') return
    applyValues(raw as Partial<FeatureConfig>)
    log('config loaded', getAll())
  })
}

/**
 * 这次 `applyValues()` 是不是**用户刚改的开关**（来自 `persist()`），而不是
 * 「storage 快照 / 另一个标签页同步过来」。
 *
 * 为什么要区分（1.2.0 v007 修的无限刷新）：
 * 页面刚打开时 config 里全是**默认值**，`applyHomeOnly(get('homeOptimize'))` 会先把
 * 「首页优化」的根类挂上；几十毫秒后 storage 里的真实值 `false` 到达，`onConfigChange`
 * 回调看到的是「类在、值是 false」—— 和「用户刚把开关关掉」一模一样。谁要是拿这个
 * 差异去触发 `location.reload()`，首页就会无限刷新。
 *
 * 所以「副作用型的开关响应」（比如重载页面）必须用 `isUserEdit()` 卡一道：
 * 只有真正来自设置面板的点击才算用户意图。
 */
let userEditing = false

export function isUserEdit(): boolean {
  return userEditing
}

export function persist(patch: Partial<FeatureConfig>) {
  // 包一层：同步通知里 `isUserEdit()` 为 true；storage 快照那条路径永远为 false
  userEditing = true
  try {
    applyValues(patch)
  }
  finally {
    userEditing = false
  }
  // **整包写回 `{ [STORAGE_KEY]: config }`**，不能写成平铺的 `set(patch)`。
  // 读那边（bootstrapConfig + storage.ts 的分发）取的是 `snapshot[STORAGE_KEY]`，
  // 平铺写进去的 `{ videoBeta: true }` 谁也不会去读 —— 于是所有开关都只在当前这个
  // 页面里生效，刷新 / 新开标签页就退回默认值（「播放页优化 刷新后自动关闭」就是它）。
  // 25 个布尔约 300 字节，远低于 storage.sync 的单项上限，整包写没有代价。
  const next = { ...config }
  // 走 storage.ts 的统一入口：扩展重载之后 chrome.storage 会同步抛
  // `Extension context invalidated`，这里不能直接调（见 chromeApi 的注释）
  if (syncSet({ [STORAGE_KEY]: next }))
    return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  catch (e) {
    error('localStorage write failed', e)
  }
}

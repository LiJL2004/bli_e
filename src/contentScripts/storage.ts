import { warn } from './logger'

/**
 * chrome.storage.sync 的统一入口。
 *
 * 以前每个 store 各做一次 `get` + 挂一个 `onChanged`：十个数值参数 store，加上开关、
 * 面板呼出键、轮盘、面板缩放、轮盘背景，页面一启动就是 15 次 IPC、15 个监听，
 * 而且各自的回调什么时候回来不确定（同一份配置可能被应用两次、顺序也随机）。
 *
 * 现在只读一次 `get(null)`（一次把整包拿回来）、只挂一个 onChanged，按 key 分发。
 * 各 store 的 `bootstrap()` 退化成「登记 key + 拿到值之后怎么应用」，真正的读取由
 * index.ts 在所有 bootstrap 之后调 `startStorageSync()` 统一发起 —— 晚于登记就会漏掉那份。
 *
 * 没有 chrome 扩展环境时（本地注入调试）走 localStorage，语义保持一致：key 即存储键、
 * 值是 JSON。
 *
 * 1.2.4 v011 起这里同时是**内容脚本里唯一碰 `chrome.*` 的地方**（`chromeApi` / `syncSet` /
 * `syncGetAll` / `chromeGetURL`）。原因见 `chromeApi()` 的注释：扩展重载之后这些调用会
 * 同步抛错，散在各个模块里逐处 try 一定会漏。
 */

export type SyncApplier = (
  value: unknown,
  /** 只有首次 `get(null)` 那一次会给：整包快照，供需要跨 key 判断的迁移用（如 epoch 记号） */
  snapshot?: Record<string, unknown>,
) => void

const appliers = new Map<string, SyncApplier>()

/** 「上下文已失效」只提示一次，别让每次写存储都刷一行 */
let contextDeadLogged = false

/**
 * 拿 `chrome` 本体，**上下文已失效就返回 null**。
 *
 * 为什么需要这一层：页面开着的时候在 chrome://extensions 点了重新加载、或者商店版自动
 * 更新了扩展，这一页的内容脚本就和扩展断连了。断连之后 `chrome.*` 的**方法调用会同步抛**
 * `Error: Extension context invalidated.` —— 而调用点大多在事件处理里（点开关、按轮盘键、
 * 搜索），一抛就是一条「Uncaught」红字，功能还静悄悄地没生效。
 *
 * 判据用 `chrome.runtime.id`：断连之后它变成 `undefined`，而**读属性本身不抛**
 * （抛的是方法调用）。所以这里读一次就够，不需要 try 兜住每个调用点。
 */
export function chromeApi(): any | null {
  try {
    const g: any = (globalThis as any).chrome
    if (!g?.runtime?.id) {
      // 有 chrome 但 id 没了 = 上下文失效。**只记一次，而且用 warn 不用 error**：
      // 这不是我们坏了，是用户在 chrome://extensions 点了重新加载 / 商店版自动更新，
      // 刷新页面就好。用 error 的话 Chrome 会把它收进扩展的错误页（`console.error`
      // 会被记成一条 Uncaught 级别的错误），用户打开错误页看到的是一屏红字 ——
      // 1.2.4 v018 之前就是这么报的，用户截图来问「存在报错」。
      if (g && !contextDeadLogged) {
        contextDeadLogged = true
        warn('扩展上下文已失效（扩展被重载 / 更新过），刷新页面可恢复')
      }
      return null
    }
    return g
  }
  catch {
    return null
  }
}

/** 写 `storage.sync`。没有扩展环境 / 上下文已失效都返回 false，让调用方走 localStorage 回落 */
export function syncSet(patch: Record<string, unknown>): boolean {
  const store = chromeApi()?.storage?.sync
  if (!store?.set)
    return false
  try {
    store.set(patch)
    return true
  }
  catch {
    // 上下文失效：写不进去就退回 localStorage，别让调用点炸掉
    return false
  }
}

/**
 * 读 `storage.sync` 整包。成功（回调已挂上）返回 true；没有扩展环境 / 已断连返回 false。
 * 断连时**不能**退化成 localStorage 快照 —— 那会把所有开关按默认值重新应用一遍，
 * 用户看到的是一次莫名其妙的「设置被重置」。保持当前内存里的配置就好。
 */
export function syncGetAll(cb: (all: Record<string, unknown>) => void): boolean {
  const store = chromeApi()?.storage?.sync
  if (!store?.get)
    return false
  try {
    store.get(null, (all: any) => {
      cb(all && typeof all === 'object' ? all : {})
    })
    return true
  }
  catch {
    return false
  }
}

/** `chrome.runtime.getURL`，断连时返回空串（调用方按「没有图」处理） */
export function chromeGetURL(path: string): string {
  const g = chromeApi()
  if (!g?.runtime?.getURL)
    return ''
  try {
    return String(g.runtime.getURL(path) || '')
  }
  catch {
    return ''
  }
}

/** 登记一个 key；同一个 key 重复登记时后者覆盖前者 */
export function registerSyncKey(key: string, apply: SyncApplier) {
  appliers.set(key, apply)
}

function applySafely(apply: SyncApplier, value: unknown, snapshot?: Record<string, unknown>) {
  try {
    apply(value, snapshot)
  }
  catch {
    /* 某一份数据坏了不该拖垮其它 store */
  }
}

/**
 * 读一次存储并分发给所有已登记的 store，同时挂上唯一的 onChanged。
 * 必须在所有 `bootstrapXxx()` 之后调用。
 */
export function startStorageSync() {
  // 读整包并分发。**成功就不走回落**；失败时只有「压根没有扩展环境」才退 localStorage，
  // 上下文失效的情况保持现状（见 syncGetAll 的注释）
  if (syncGetAll((snapshot) => {
    appliers.forEach((apply, key) => applySafely(apply, snapshot[key], snapshot))
  })) {
    const g = chromeApi()
    try {
      g?.storage?.onChanged?.addListener?.((changes: any, ns: string) => {
        if (ns !== 'sync' || !changes) return
        for (const key of Object.keys(changes)) {
          const apply = appliers.get(key)
          if (apply) applySafely(apply, changes[key]?.newValue)
        }
      })
    }
    catch {
      // 读和挂监听之间上下文刚好失效：没有监听就没有跨标签页同步，不影响本页
    }
    return
  }

  // 有 chrome 但已经断连（扩展重载 / 更新）：**什么都别做**，
  // 否则下面那份「空快照」会把所有开关按默认值重新应用一遍
  if (typeof (globalThis as any).chrome !== 'undefined')
    return

  // 没有扩展环境：把 localStorage 整个读成一份快照，语义与 get(null) 一致
  // （epoch 迁移要跨 key 看记号，只给单个 key 的值不够）
  const snapshot: Record<string, unknown> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        snapshot[key] = JSON.parse(raw)
      }
      catch {
        /* 页面自己的非 JSON 键，跳过 */
      }
    }
  }
  catch {
    /* noop */
  }
  appliers.forEach((apply, key) => applySafely(apply, snapshot[key], snapshot))
}

/** 写回若干个 key（迁移用）。没有扩展环境时写 localStorage */
export function writeSync(patch: Record<string, unknown>) {
  if (syncSet(patch))
    return
  try {
    for (const [key, value] of Object.entries(patch))
      localStorage.setItem(key, JSON.stringify(value))
  }
  catch {
    /* noop */
  }
}

/**
 * 统一的日志出口（整个扩展只此一处 console）。
 *
 * 规则只有一条：**error 永远输出，log / warn 默认静默**。
 * 以前 DEBUG 写死成 `import.meta.env.DEV`，正式包里等于一行日志都没有 —— 用户反馈问题时
 * 拿不到任何线索。现在多一个运行时开关：地址栏加 `?blie-debug` 刷新即可（控制台里
 * `__blieDebug(true/false)` 也能临时切），不用重新打包。
 *
 * 别在热路径（滚动 / 观察器回调）里直接调 log：参数会先被求值，静默也白算。
 */
const PREFIX = '[奶睿pro]'

function verboseFromUrl(): boolean {
  try {
    const q = new URLSearchParams(location.search)
    if (!q.has('blie-debug'))
      return false
    return q.get('blie-debug') !== 'off'
  }
  catch {
    // 没有 location（service worker / 非浏览器环境）
    return false
  }
}

let verbose = import.meta.env.DEV || verboseFromUrl()

export function setVerbose(on: boolean) {
  verbose = on
}

export function log(...args: unknown[]) {
  if (!verbose)
    return
  // eslint-disable-next-line no-console
  console.log(PREFIX, ...args)
}

export function warn(...args: unknown[]) {
  if (!verbose)
    return
  console.warn(PREFIX, ...args)
}

/** 错误始终输出：它代表功能坏了，不是调试信息 */
export function error(...args: unknown[]) {
  console.error(PREFIX, ...args)
}

// 控制台里 `__blieDebug(true)` 打开日志、`__blieDebug(false)` 关掉
;(globalThis as any).__blieDebug = setVerbose

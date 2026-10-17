const PREFIX = '[奶睿pro]'
const DEBUG = import.meta.env.DEV

export function log(...args: unknown[]) {
  if (DEBUG) console.log(PREFIX, ...args)
}
export function warn(...args: unknown[]) {
  if (DEBUG) console.warn(PREFIX, ...args)
}
export function error(...args: unknown[]) {
  console.error(PREFIX, ...args)
}

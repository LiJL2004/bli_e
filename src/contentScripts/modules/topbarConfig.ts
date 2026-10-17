/**
 * 顶栏毛玻璃参数
 *
 * 「顶栏材质」原来把模糊强度写死成 24px，不同类型的页面（首页大顶栏、
 * 播放页、搜索页…）看起来会有差异。这里把模糊强度抽成一个可调参数，
 * 并统一作用在所有页面的顶栏上。
 *
 * 「顶栏遮罩强度」控制白色填充层的不透明度（0 = 完全透明）：白色遮罩是
 * 独立于模糊的，模糊拉到 0 也仍会有一层白，用它单独调节。
 * 发丝描边与投影也随遮罩一起淡出。
 *
 * 存储 key：bili-elite-topbar-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type TopbarParamKey = 'blur' | 'tint'

export type TopbarParams = Record<TopbarParamKey, number>

export type TopbarParamDef = NumberParamDef<TopbarParamKey>

export const TOPBAR_PARAM_DEFS: TopbarParamDef[] = [
  { key: 'blur', label: '顶栏模糊强度', min: 0, max: 60, step: 1, default: 8, fmt: v => `${v}px` },
  { key: 'tint', label: '顶栏遮罩强度', min: 0, max: 100, step: 1, default: 7, fmt: v => `${v}%` },
]

export const TOPBAR_STORAGE_KEY = 'bili-elite-topbar-params'

const store = createNumberParamStore(TOPBAR_STORAGE_KEY, TOPBAR_PARAM_DEFS)

export const DEFAULT_TOPBAR: TopbarParams = store.defaults

export function getTopbarParams(): TopbarParams {
  return store.get()
}

export function setTopbarParam(key: TopbarParamKey, value: number) {
  store.set(key, value)
}

export function onTopbarParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

export function bootstrapTopbarConfig() {
  store.bootstrap()
}

/** 「恢复默认设置」：回到 TOPBAR_PARAM_DEFS 里的 default */
export function resetTopbarParams() {
  store.reset()
}

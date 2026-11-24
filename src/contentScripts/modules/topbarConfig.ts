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

export type TopbarParamKey = 'blur' | 'tint' | 'bright'

export type TopbarParams = Record<TopbarParamKey, number>

export type TopbarParamDef = NumberParamDef<TopbarParamKey>

export const TOPBAR_PARAM_DEFS: TopbarParamDef[] = [
  { key: 'blur', label: '模糊强度', min: 0, max: 60, step: 1, default: 8, fmt: v => `${v}px` },
  { key: 'tint', label: '遮罩强度', min: 0, max: 100, step: 1, default: 32, fmt: v => `${v}%` },
  // 背景明暗：50 为中性，<50 压暗（深色页面更沉），>50 提亮。
  // 写进 CSS 时换算成 backdrop-filter 的 brightness()：1 + (v - 50) × 0.016，
  // 默认 50 → 1.0（不动），配上 32% 遮罩正好是「顶栏渐变」想要的观感。
  {
    key: 'bright',
    label: '背景明暗',
    min: 0,
    max: 100,
    step: 1,
    default: 50,
    fmt: v => (v < 50 ? `偏暗 ${50 - v}` : v > 50 ? `偏亮 ${v - 50}` : '适中'),
    edit: { to: v => v - 50, from: n => n + 50 },
  },
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

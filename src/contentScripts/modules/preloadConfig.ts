/**
 * 「首页预加载」范围参数：控制把加载哨兵 .load-more-anchor 视觉上抬多少。
 *
 * 值是一个百分比，**100% = 上抬一整屏（视口高度）**，也就是「提前预加载下方约 1 屏内容」。
 * 由 topbarOptimize.ts 写进 CSS 变量 --bili-preload-dist（换算成 vh），
 * topbar.css §11 用它做 transform。0 表示不上抬，等价于 B 站原生行为（快滚到底才加载）。
 *
 * 上抬量是相对**当前滚动位置**的常量：滑到哪里，哨兵都只被抬高同样一段距离，
 * 所以「预加载下方多少屏」永远以你此刻的位置为基准，而不是首页刚打开时的位置。
 * 上限 300%（3 屏）—— 最多预加载下方 3 页内容。
 *
 * 存储 key：bili-elite-preload（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type PreloadParamKey = 'dist'

export type PreloadParams = Record<PreloadParamKey, number>

export type PreloadParamDef = NumberParamDef<PreloadParamKey>

/** 预加载范围上限（%）：100% = 1 屏，300% = 最多预加载下方 3 屏（3 页）内容 */
export const PRELOAD_MAX_DIST = 300

export const PRELOAD_PARAM_DEFS: PreloadParamDef[] = [
  {
    key: 'dist',
    label: '预加载范围',
    min: 0,
    max: PRELOAD_MAX_DIST,
    step: 10,
    default: 150,
    fmt: v => `${v}%`,
    hint: '百分比 = 提前预加载下方多少屏内容，100% ≈ 1 屏；以当前滚动位置为基准，最多 3 屏（3 页）。',
  },
]

export const PRELOAD_STORAGE_KEY = 'bili-elite-preload'

const store = createNumberParamStore(PRELOAD_STORAGE_KEY, PRELOAD_PARAM_DEFS)

export const DEFAULT_PRELOAD_PARAMS: PreloadParams = store.defaults

export function getPreloadParams(): PreloadParams {
  return store.get()
}

export function setPreloadParam(key: PreloadParamKey, value: number) {
  store.set(key, value)
}

export function onPreloadParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

export function bootstrapPreloadConfig() {
  store.bootstrap()
}

/** 「恢复默认设置」：回到 PRELOAD_PARAM_DEFS 里的 default */
export function resetPreloadParams() {
  store.reset()
}

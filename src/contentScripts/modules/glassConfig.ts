/**
 * 评论区图片背景（PhotoSwipe 浮层）的毛玻璃参数：
 * 模糊强度与背景明暗。存储与同步由 paramStore 统一处理。
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type GlassParamKey = 'blur' | 'brightness'

export type GlassParams = Record<GlassParamKey, number>

export type GlassParamDef = NumberParamDef<GlassParamKey>

export const GLASS_PARAM_DEFS: GlassParamDef[] = [
  { key: 'blur', label: '模糊强度', min: 0, max: 60, step: 1, default: 31, fmt: v => `${v}px` },
  // 背景明暗：50 为中性，<50 越暗，>50 越亮
  {
    key: 'brightness',
    label: '背景明暗',
    min: 0,
    max: 100,
    step: 2,
    default: 44,
    fmt: v => (v < 50 ? `偏暗 ${50 - v}` : v > 50 ? `偏亮 ${v - 50}` : '适中'),
  },
]

export const GLASS_STORAGE_KEY = 'bili-elite-glass-params'

const store = createNumberParamStore(GLASS_STORAGE_KEY, GLASS_PARAM_DEFS)

export const DEFAULT_GLASS: GlassParams = store.defaults

export function getGlassParams(): GlassParams {
  return store.get()
}

export function setGlassParam(key: GlassParamKey, value: number) {
  store.set(key, value)
}

export function onGlassParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

export function bootstrapGlassConfig() {
  store.bootstrap()
}

/** 「恢复默认设置」：回到 GLASS_PARAM_DEFS 里的 default */
export function resetGlassParams() {
  store.reset()
}

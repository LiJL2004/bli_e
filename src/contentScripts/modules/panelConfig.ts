/**
 * 「设置面板材质」参数（页面右下角设置弹窗自身的毛玻璃）。
 *
 * 与顶栏材质一致：模糊强度 + 白色遮罩强度两个可调参数，
 * 遮罩为 0 时面板完全透明（发丝描边与投影一并淡出）。
 *
 * 存储 key：bili-elite-panel-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type PanelParamKey = 'blur' | 'tint'

export type PanelParams = Record<PanelParamKey, number>

export type PanelParamDef = NumberParamDef<PanelParamKey>

export const PANEL_PARAM_DEFS: PanelParamDef[] = [
  { key: 'blur', label: '面板模糊强度', min: 0, max: 60, step: 1, default: 28, fmt: v => `${v}px` },
  { key: 'tint', label: '面板遮罩强度', min: 0, max: 100, step: 1, default: 31, fmt: v => `${v}%` },
]

export const PANEL_STORAGE_KEY = 'bili-elite-panel-params'

const store = createNumberParamStore(PANEL_STORAGE_KEY, PANEL_PARAM_DEFS)

export const DEFAULT_PANEL: PanelParams = store.defaults

export function getPanelParams(): PanelParams {
  return store.get()
}

export function setPanelParam(key: PanelParamKey, value: number) {
  store.set(key, value)
}

export function onPanelParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

export function bootstrapPanelConfig() {
  store.bootstrap()
}

/** 「恢复默认设置」：回到 PANEL_PARAM_DEFS 里的 default */
export function resetPanelParams() {
  store.reset()
}

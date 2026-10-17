/**
 * 「设置面板缩放」参数：把整个设置面板（面板尺寸、文字、开关、滑块）等比放大 / 缩小。
 *
 * 值是一个百分比（100 = 原尺寸），由 settingsPanel.ts 写进 CSS 变量
 * --bili-panel-scale（换算成 1 = 100% 的倍数），panel.css 的 .panel 用
 * transform: scale() 整体缩放，并按缩放反算基准宽高，保证放大后仍装得进视口。
 *
 * 存储 key：bili-elite-panel-scale（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type PanelScaleParamKey = 'scale'

export type PanelScaleParams = Record<PanelScaleParamKey, number>

export type PanelScaleParamDef = NumberParamDef<PanelScaleParamKey>

export const PANEL_SCALE_PARAM_DEFS: PanelScaleParamDef[] = [
  { key: 'scale', label: '设置面板缩放', min: 80, max: 140, step: 5, default: 130, fmt: v => `${v}%` },
]

export const PANEL_SCALE_STORAGE_KEY = 'bili-elite-panel-scale'

const store = createNumberParamStore(PANEL_SCALE_STORAGE_KEY, PANEL_SCALE_PARAM_DEFS)

export const DEFAULT_PANEL_SCALE: PanelScaleParams = store.defaults

export function getPanelScale(): PanelScaleParams {
  return store.get()
}

export function setPanelScale(key: PanelScaleParamKey, value: number) {
  store.set(key, value)
}

export function onPanelScaleChange(cb: () => void): () => void {
  return store.onChange(cb)
}

export function bootstrapPanelScaleConfig() {
  store.bootstrap()
}

/** 「恢复默认设置」：回到 PANEL_SCALE_PARAM_DEFS 里的 default */
export function resetPanelScale() {
  store.reset()
}

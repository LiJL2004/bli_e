/**
 * 「设置面板缩放」参数：把整个设置面板（面板尺寸、文字、开关、滑块）等比放大 / 缩小。
 *
 * 值是一个百分比（100 = 基准尺寸），由 settingsPanel.ts 写进 CSS 变量
 * --bili-panel-scale（换算成倍数），panel.css 的 .panel 用 transform: scale() 整体缩放，
 * 尺寸按视口比例给，保证任何窗口下占屏比例一致。
 *
 * 100% 对应 1.2 倍基准（SCALE_BASE）：滑块上的 120% 才是 1.2 倍的老观感，
 * 这里把 1.2 定为「100%」，滑块数值整体重标定了一次。
 *
 * 存储 key：bili-elite-panel-scale（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { registerSyncKey, writeSync } from '../storage'
import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type PanelScaleParamKey = 'scale'

export type PanelScaleParams = Record<PanelScaleParamKey, number>

export type PanelScaleParamDef = NumberParamDef<PanelScaleParamKey>

/** 滑块 100% 对应的实际缩放倍数（1.2 = 旧版滑块上的 120%） */
export const SCALE_BASE = 1.2

export const PANEL_SCALE_PARAM_DEFS: PanelScaleParamDef[] = [
  { key: 'scale', label: '设置面板缩放', min: 80, max: 140, step: 5, default: 100, fmt: v => `${v}%` },
]

export const PANEL_SCALE_STORAGE_KEY = 'bili-elite-panel-scale'

/**
 * 刻度换过一次基准，老数据不能直接读：旧版 100% = 1.0 倍、120% = 1.2 倍，
 * 现在 100% = 1.2 倍。存着的 130 若不换算就成了 1.56 倍（面板几乎铺满屏幕）。
 * 用单独的 epoch key 标记「已换算过」，否则每次启动都会再除一遍 1.2。
 */
const SCALE_EPOCH_KEY = 'bili-elite-panel-scale-epoch'
const SCALE_EPOCH = 2

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

/** 旧刻度的值换算到新刻度，再对齐到滑块的 5 的倍数：130 → 108 → 110 */
function remapLegacyScale(v: number): number {
  const def = PANEL_SCALE_PARAM_DEFS[0]
  const next = Math.round(v / SCALE_BASE / def.step) * def.step
  return Math.min(def.max, Math.max(def.min, next))
}

export function bootstrapPanelScaleConfig() {
  registerSyncKey(PANEL_SCALE_STORAGE_KEY, (value, snapshot) => {
    // 只有首次启动（get(null) 那一次会给整包快照）才判断刻度版本：之后来自其它标签页的
    // 变化直接应用，不再换算 —— 否则每次同步都会再除一遍 1.2
    if (snapshot && snapshot[SCALE_EPOCH_KEY] !== SCALE_EPOCH) {
      const stored = value as { scale?: number } | undefined
      // 全新安装没有旧值可换算，但也要打上 epoch —— 否则用户自己设的值下次会被当成旧刻度
      const patch: Record<string, unknown> = { [SCALE_EPOCH_KEY]: SCALE_EPOCH }
      let next = stored
      if (typeof stored?.scale === 'number') {
        next = { ...stored, scale: remapLegacyScale(stored.scale) }
        patch[PANEL_SCALE_STORAGE_KEY] = next
      }
      // 换算后的值直接应用，同时写回存储（不必再读一次）
      writeSync(patch)
      store.apply(next)
      return
    }
    store.apply(value)
  })
}

/** 「恢复默认设置」：回到 PANEL_SCALE_PARAM_DEFS 里的 default */
export function resetPanelScale() {
  store.reset()
}

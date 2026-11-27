/**
 * 「图片查看器」的两个数值参数（1.2.5 v041）：
 *
 *   · `step`  —— 工具栏「放大 / 缩小」每点一次的幅度（百分比，默认 30）
 *   · `wheel` —— 滚轮滚一格的幅度（百分比，默认 10）
 *
 * 这一组**没有开关**（自绘查看器是全站常开的），所以在设置面板里不走
 * `FEATURES` / `PARAM_GROUPS`，而是像「设置面板缩放」那样在「功能增强」页末尾
 * 单独占一张卡（见 settingsPanel.ts 的 BOOST_GROUP 分支）。
 *
 * 存储 key：bili-elite-viewer（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { registerSyncKey } from '../storage'
import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type ViewerParamKey = 'step' | 'wheel'

export type ViewerParams = Record<ViewerParamKey, number>

export type ViewerParamDef = NumberParamDef<ViewerParamKey>

export const VIEWER_PARAM_DEFS: ViewerParamDef[] = [
  {
    key: 'step',
    label: '按钮缩放步进',
    min: 5,
    max: 100,
    step: 5,
    default: 30,
    fmt: v => `${v}%`,
    hint: '工具栏「放大 / 缩小」每点一次的幅度。30% 就是每点一下放大到当前的 1.3 倍（缩小则是 1/1.3）',
  },
  {
    key: 'wheel',
    label: '滚轮缩放步进',
    min: 1,
    max: 50,
    step: 1,
    default: 10,
    fmt: v => `${v}%`,
    hint: '滚轮滚一格的幅度。10% 就是每格放大到当前的 1.1 倍',
  },
]

export const VIEWER_STORAGE_KEY = 'bili-elite-viewer'

const store = createNumberParamStore(VIEWER_STORAGE_KEY, VIEWER_PARAM_DEFS)

export function getViewerParams(): ViewerParams {
  return store.get()
}

export function setViewerParam(key: ViewerParamKey, value: number) {
  store.set(key, value)
}

export function onViewerParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

/** 「恢复默认设置」：回到 VIEWER_PARAM_DEFS 里的 default */
export function resetViewerParams() {
  store.reset()
}

export function bootstrapViewerConfig() {
  registerSyncKey(VIEWER_STORAGE_KEY, value => store.apply(value))
}

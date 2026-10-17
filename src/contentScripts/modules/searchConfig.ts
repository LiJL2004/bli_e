/**
 * 「搜索框材质」与「搜索面板材质」的毛玻璃参数。
 *
 * 顶栏中央的搜索框（#nav-searchform）与点击后弹出的「搜索历史 / 热搜」面板
 * （.nav-search-panel > .search-panel）各自独立成一种材质，互不影响：
 *   - 搜索框：模糊强度 + 白色遮罩强度
 *   - 搜索面板：模糊强度 + 白色遮罩强度
 * 遮罩强度为 0 时即完全透明，发丝描边与投影也一并淡出。
 *
 * 两者的读写 / 同步都交给 paramStore，存储 key 分别如下（chrome.storage.sync，
 * 无 chrome 时回落 localStorage）。
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

/* ===== 搜索框材质 ===== */

export type SearchBoxParamKey = 'blur' | 'tint'

export type SearchBoxParams = Record<SearchBoxParamKey, number>

export type SearchBoxParamDef = NumberParamDef<SearchBoxParamKey>

export const SEARCH_BOX_PARAM_DEFS: SearchBoxParamDef[] = [
  { key: 'blur', label: '搜索框模糊强度', min: 0, max: 60, step: 1, default: 15, fmt: v => `${v}px` },
  { key: 'tint', label: '搜索框遮罩强度', min: 0, max: 100, step: 1, default: 47, fmt: v => `${v}%` },
]

export const SEARCH_BOX_STORAGE_KEY = 'bili-elite-searchbox-params'

const boxStore = createNumberParamStore(SEARCH_BOX_STORAGE_KEY, SEARCH_BOX_PARAM_DEFS)

export const DEFAULT_SEARCH_BOX: SearchBoxParams = boxStore.defaults

export function getSearchBoxParams(): SearchBoxParams {
  return boxStore.get()
}

export function setSearchBoxParam(key: SearchBoxParamKey, value: number) {
  boxStore.set(key, value)
}

export function onSearchBoxParamsChange(cb: () => void): () => void {
  return boxStore.onChange(cb)
}

/* ===== 搜索面板材质 ===== */

export type SearchPanelParamKey = 'blur' | 'tint'

export type SearchPanelParams = Record<SearchPanelParamKey, number>

export type SearchPanelParamDef = NumberParamDef<SearchPanelParamKey>

export const SEARCH_PANEL_PARAM_DEFS: SearchPanelParamDef[] = [
  { key: 'blur', label: '搜索面板模糊强度', min: 0, max: 60, step: 1, default: 38, fmt: v => `${v}px` },
  { key: 'tint', label: '搜索面板遮罩强度', min: 0, max: 100, step: 1, default: 61, fmt: v => `${v}%` },
]

export const SEARCH_PANEL_STORAGE_KEY = 'bili-elite-searchpanel-params'

const panelStore = createNumberParamStore(SEARCH_PANEL_STORAGE_KEY, SEARCH_PANEL_PARAM_DEFS)

export const DEFAULT_SEARCH_PANEL: SearchPanelParams = panelStore.defaults

export function getSearchPanelParams(): SearchPanelParams {
  return panelStore.get()
}

export function setSearchPanelParam(key: SearchPanelParamKey, value: number) {
  panelStore.set(key, value)
}

export function onSearchPanelParamsChange(cb: () => void): () => void {
  return panelStore.onChange(cb)
}

/* ===== 启动 ===== */

export function bootstrapSearchConfig() {
  boxStore.bootstrap()
  panelStore.bootstrap()
}

/** 「恢复默认设置」：搜索框 / 搜索面板各自回到 defs 里的 default */
export function resetSearchBoxParams() {
  boxStore.reset()
}

export function resetSearchPanelParams() {
  panelStore.reset()
}

/**
 * 「触发面板材质」参数 —— 三处共用同一组模糊 / 遮罩：
 *   1. 悬停顶栏「首页」时展开的频道面板（`#bili-elite-home-panel` 里那张 `.bili-elite-panel-card`）；
 *   2. 顶栏右侧头像 / 消息 / 动态 / 收藏 / 历史的悬停浮层 —— **两套顶栏都算**：
 *      原生顶栏那几个 `.v-popover`（topbar.css §7.2），以及「顶栏优化」自绘顶栏的
 *      `.tb-pop-card`（selfTopbar.css §5.1，1.2.4 v004 补上）；
 *   3. 首页卡片右下角「⋮」的悬停菜单（topbar.css §7.5）。
 *
 * 它和「搜索面板材质」是两种独立材质：都是弹出来的面板，观感一致，
 * 所以默认值直接对齐搜索面板（38px / 61%），但两边互不影响 —— 改这里不会动搜索面板。
 *
 * 存储 key：bili-elite-homepanel-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type HomePanelParamKey = 'blur' | 'tint'

export type HomePanelParams = Record<HomePanelParamKey, number>

export type HomePanelParamDef = NumberParamDef<HomePanelParamKey>

export const HOME_PANEL_PARAM_DEFS: HomePanelParamDef[] = [
  { key: 'blur', label: '模糊强度', min: 0, max: 60, step: 1, default: 38, fmt: v => `${v}px` },
  { key: 'tint', label: '遮罩强度', min: 0, max: 100, step: 1, default: 61, fmt: v => `${v}%` },
]

export const HOME_PANEL_STORAGE_KEY = 'bili-elite-homepanel-params'

const store = createNumberParamStore(HOME_PANEL_STORAGE_KEY, HOME_PANEL_PARAM_DEFS)

export const DEFAULT_HOME_PANEL: HomePanelParams = store.defaults

export function getHomePanelParams(): HomePanelParams {
  return store.get()
}

export function setHomePanelParam(key: HomePanelParamKey, value: number) {
  store.set(key, value)
}

export function onHomePanelParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

export function bootstrapHomePanelConfig() {
  store.bootstrap()
}

/** 「恢复默认设置」：回到 HOME_PANEL_PARAM_DEFS 里的 default */
export function resetHomePanelParams() {
  store.reset()
}

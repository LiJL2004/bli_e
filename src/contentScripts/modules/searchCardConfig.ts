/**
 * 「搜索页优化」的参数：卡片大小。
 *
 * 搜索页（search.bilibili.com）的结果栅格是 bootstrap 的 12 列
 * （`.col_3` / `.col_xl_1_7` …），列数是**按断点写死的**：1920 下固定 7 列、
 * 卡片只有 275px，比首页（5 列 332px）小一大截；而窗口再宽卡片也只是变胖。
 * 搜索页优化把栅格换成 auto-fill 之后，列数由「卡片最小宽度」决定 —— 这个滑块
 * 就是那个最小宽度，与首页的「卡片大小」是同一个语义（见 homeCardConfig.ts）。
 *
 * 它是**下限**不是定值：auto-fill 会把剩余宽度均分给各列，实际卡片会比它略宽
 * （1920 下给 350，实际排出来是 355 上下）。所以拖滑块看到的是「卡片突然变多变少」的
 * 阶梯式变化，而不是像素级平滑 —— 这是 CSS 栅格本身的特性。
 *
 * 与首页那一组参数**分开存**：两个页面的卡片内容不一样（搜索页标题固定两行、
 * 底下还有 UP 主与播放量），有人就喜欢搜索页更紧凑一点。
 * 默认值与首页一致（350px），所以「默认卡片大小与首页一致」。
 *
 * 值写进 CSS 变量 --bili-search-card（见 searchOptimize.css），由本模块自己负责应用，
 * 不依赖设置面板 —— 面板没打开、页面刚刷新时也要生效。
 *
 * 存储 key：bili-elite-search-card-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type SearchCardParamKey = 'cardSize'

export type SearchCardParams = Record<SearchCardParamKey, number>

export type SearchCardParamDef = NumberParamDef<SearchCardParamKey>

export const SEARCH_CARD_PARAM_DEFS: SearchCardParamDef[] = [
  {
    key: 'cardSize',
    label: '卡片大小',
    min: 220,
    max: 380,
    step: 10,
    // 350：与首页「卡片大小」的默认值一致 —— 1920 下排 5 列（每列约 355），
    // 两个页面的卡片宽度基本对齐；2560 下 6 列
    default: 350,
    fmt: v => `${v}px`,
    hint: '卡片的最小宽度；窗口越宽会多排一列，实际宽度可能略大于这个值',
  },
]

export const SEARCH_CARD_STORAGE_KEY = 'bili-elite-search-card-params'

const store = createNumberParamStore(SEARCH_CARD_STORAGE_KEY, SEARCH_CARD_PARAM_DEFS)

export const DEFAULT_SEARCH_CARD_PARAMS: SearchCardParams = store.defaults

export function getSearchCardParams(): SearchCardParams {
  return store.get()
}

export function setSearchCardParam(key: SearchCardParamKey, value: number) {
  store.set(key, value)
}

export function onSearchCardParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

function applySearchCardParams() {
  const { cardSize } = store.get()
  document.documentElement.style.setProperty('--bili-search-card', `${cardSize}px`)
}

export function bootstrapSearchCardConfig() {
  // 先挂监听再读存储：bootstrap 是异步回调，值到了要立刻应用
  store.onChange(applySearchCardParams)
  store.bootstrap()
  applySearchCardParams()
}

/** 「恢复默认设置」：回到 SEARCH_CARD_PARAM_DEFS 里的 default */
export function resetSearchCardParams() {
  store.reset()
}

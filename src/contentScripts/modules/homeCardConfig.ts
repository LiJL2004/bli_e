/**
 * 「首页优化」的参数：卡片大小。
 *
 * B 站首页的栅格是固定列数（≥1440 是 5 列），窗口一宽卡片就跟着变胖；首页优化把栅格
 * 换成 auto-fill 之后，列数由「卡片最小宽度」决定 —— 这个滑块就是那个最小宽度。
 * 它是**下限**不是定值：auto-fill 会把剩余宽度均分给各列，实际卡片会比它略宽
 * （1920 下给 350，实际排出来是 360 上下）。所以拖滑块看到的是「卡片突然变多变少」的
 * 阶梯式变化，而不是像素级平滑 —— 这是 CSS 栅格本身的特性。
 *
 * 值写进 CSS 变量 --bili-home-card（见 homeOptimize.css），由本模块自己负责应用，
 * 不依赖设置面板 —— 面板没打开、页面刚刷新时也要生效。
 *
 * 存储 key：bili-elite-home-card-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type HomeCardParamKey = 'cardSize'

export type HomeCardParams = Record<HomeCardParamKey, number>

export type HomeCardParamDef = NumberParamDef<HomeCardParamKey>

export const HOME_CARD_PARAM_DEFS: HomeCardParamDef[] = [
  {
    key: 'cardSize',
    label: '卡片大小',
    min: 220,
    max: 380,
    step: 10,
    // 350：1920 下仍是 5 列、2560 下 6 列。比 B 站原本的 312 大一档，
    // 卡片标题两行排得开，又不会因为太大而少排一列
    default: 350,
    fmt: v => `${v}px`,
    hint: '卡片的最小宽度；窗口越宽会多排一列，实际宽度可能略大于这个值',
  },
]

export const HOME_CARD_STORAGE_KEY = 'bili-elite-home-card-params'

const store = createNumberParamStore(HOME_CARD_STORAGE_KEY, HOME_CARD_PARAM_DEFS)

export const DEFAULT_HOME_CARD_PARAMS: HomeCardParams = store.defaults

export function getHomeCardParams(): HomeCardParams {
  return store.get()
}

export function setHomeCardParam(key: HomeCardParamKey, value: number) {
  store.set(key, value)
}

export function onHomeCardParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

function applyHomeCardParams() {
  const { cardSize } = store.get()
  document.documentElement.style.setProperty('--bili-home-card', `${cardSize}px`)
}

export function bootstrapHomeCardConfig() {
  // 先挂监听再读存储：bootstrap 是异步回调，值到了要立刻应用
  store.onChange(applyHomeCardParams)
  store.bootstrap()
  applyHomeCardParams()
}

/** 「恢复默认设置」：回到 HOME_CARD_PARAM_DEFS 里的 default */
export function resetHomeCardParams() {
  store.reset()
}

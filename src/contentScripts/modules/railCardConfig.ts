/**
 * 「播放页优化」的参数：右侧推荐视频封面大小。
 *
 * 封面尺寸原本是 videoBeta.css §3 里写死的 `clamp(190px, 58%, 320px)` ——
 * 下限 190、跟随右栏宽度的 58%、上限 320。这个滑块就是给那个 clamp **整体乘一个倍率**：
 *
 *     width: calc(clamp(190px, 58%, 320px) * var(--bili-vb-cover-scale, 1))
 *
 * 之所以是「倍率」而不是直接写 px：那三个数分别负责「窄窗口别太小 / 跟着右栏走 / 宽窗口封顶」，
 * 只改上限的话，窄窗口拖滑块根本看不出变化（58% 才是实际生效的那个）。乘倍率是唯一
 * 既保住三段响应式、又能整体放大缩小的写法。
 *
 * 卡片高度不用管：`.pic-box` 上有 `aspect-ratio: 141 / 80`，宽度变了高度自己跟。
 *
 * **只在播放页优化打开时生效** —— CSS 整段挂在 `html.bili-elite-video-beta` 上，
 * 面板里这条滑块也用 `feature: 'videoBeta'`，开关关掉时整行变灰不可点。
 *
 * 存储 key：bili-elite-rail-card-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type RailCardParamKey = 'coverSize'

export type RailCardParams = Record<RailCardParamKey, number>

export type RailCardParamDef = NumberParamDef<RailCardParamKey>

/** clamp 上限的基准值：CSS 里写死的 320px。滑块值是「这个上限应该是多少」，换算成倍率要除以它 */
const COVER_BASE = 320

export const RAIL_CARD_PARAM_DEFS: RailCardParamDef[] = [
  {
    key: 'coverSize',
    label: '封面大小',
    // 140 = 0.4375 倍。右栏 400 宽时封面约 100×57，属于「只想看标题、封面只要认得出来」
    // 的那一档。再往下（试过 100）封面缩到 70px 上下，连内容都分辨不出，
    // 而且 B 站的封面图最小尺寸是 @336w，再小就是纯浪费带宽。
    min: 140,
    // 400 = 1.25 倍。再往上（试过 420）在 1440 这种窄右栏下文字那侧只剩 124px，
    // 标题被挤成一列单字，封面也顶到卡片边 —— 上限收到这里
    max: 400,
    step: 10,
    // 220：比 CSS 里那个 320 的封顶收窄一档。右栏推荐卡本来就是「顺带看一眼」的东西，
    // 320 的封面在宽窗口下把标题挤到只剩一行半；220 之后标题基本能排满两行。
    // （这一项以前是 320 = 与改动前逐像素一致，1.1.6 v010 按需求改成 220。）
    default: 220,
    fmt: v => `${v}px`,
    hint: '右侧推荐视频的封面宽度上限；窄窗口下会按右栏宽度等比缩，卡片高度跟着封面走',
  },
]

export const RAIL_CARD_STORAGE_KEY = 'bili-elite-rail-card-params'

const store = createNumberParamStore(RAIL_CARD_STORAGE_KEY, RAIL_CARD_PARAM_DEFS)

export const DEFAULT_RAIL_CARD_PARAMS: RailCardParams = store.defaults

export function getRailCardParams(): RailCardParams {
  return store.get()
}

export function setRailCardParam(key: RailCardParamKey, value: number) {
  store.set(key, value)
}

export function onRailCardParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

function applyRailCardParams() {
  const { coverSize } = store.get()
  document.documentElement.style.setProperty('--bili-vb-cover-scale', String(coverSize / COVER_BASE))
}

export function bootstrapRailCardConfig() {
  // 先挂监听再读存储：bootstrap 是异步回调，值到了要立刻应用
  store.onChange(applyRailCardParams)
  store.bootstrap()
  applyRailCardParams()
}

/** 「恢复默认设置」：回到 RAIL_CARD_PARAM_DEFS 里的 default */
export function resetRailCardParams() {
  store.reset()
}

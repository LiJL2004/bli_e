/**
 * 「轮盘背景」材质参数 —— **只控制轮盘外那层全屏虚化**（模糊 + 压暗）。
 *
 * 轮盘本体（八片功能区 + 中心圆）用的是写死的一套材质（见 quickWheel.css 的
 * `.wedge` / `.hub`）：那里要保证「任何页面底色上都好看、名字都读得清」，
 * 交给滑块调只会调坏 —— 遮罩一拉高就糊成一片白，拉低字就看不清。
 * 所以这里只留背景的两个参数，和轮盘自身的观感解耦。
 *
 * 参数写成 CSS 变量挂在 `:root` 上（`--bili-wheel-blur` / `--bili-wheel-dim`），
 * 轮盘在 Shadow DOM 里也能取到 —— 自定义属性会穿过 shadow 边界继承。
 *
 * 存储 key：bili-elite-wheelglass-params（chrome.storage.sync，无 chrome 时回落 localStorage）
 */

import { registerSyncKey, writeSync } from '../storage'
import { type NumberParamDef, createNumberParamStore } from './paramStore'

export type WheelGlassParamKey = 'blur' | 'dim'

export type WheelGlassParams = Record<WheelGlassParamKey, number>

export type WheelGlassParamDef = NumberParamDef<WheelGlassParamKey>

export const WHEEL_GLASS_PARAM_DEFS: WheelGlassParamDef[] = [
  { key: 'blur', label: '模糊强度', min: 0, max: 60, step: 1, default: 19, fmt: v => `${v}px` },
  // 压暗：0 = 完全不压，30 以上就是「除了轮盘全黑」了
  { key: 'dim', label: '背景暗度', min: 0, max: 60, step: 1, default: 16, fmt: v => `${v}%` },
]

export const WHEEL_GLASS_STORAGE_KEY = 'bili-elite-wheelglass-params'

/**
 * 参数模型换过一次（原来 tint 同时管圆盘遮罩，现在只管背景压暗），用 epoch 记号
 * 把「还是旧默认值」的那份数据换掉；自己调过的不动。
 */
const EPOCH_KEY = 'bili-elite-wheelglass-epoch'
const EPOCH = 3

const store = createNumberParamStore(WHEEL_GLASS_STORAGE_KEY, WHEEL_GLASS_PARAM_DEFS)

export const DEFAULT_WHEEL_GLASS: WheelGlassParams = store.defaults

export function getWheelGlassParams(): WheelGlassParams {
  return store.get()
}

export function setWheelGlassParam(key: WheelGlassParamKey, value: number) {
  store.set(key, value)
}

export function onWheelGlassParamsChange(cb: () => void): () => void {
  return store.onChange(cb)
}

/** 把当前参数写进 CSS 变量（`.scrim` 用它们画全屏虚化） */
export function applyWheelGlassVars() {
  const { blur, dim } = store.get()
  const root = document.documentElement.style
  root.setProperty('--bili-wheel-blur', `${blur}px`)
  root.setProperty('--bili-wheel-dim', String(Math.min(100, Math.max(0, dim)) / 100))
}

export function bootstrapWheelGlassConfig() {
  // 先按默认值写一次变量：存储读回来之前（异步）轮盘也该是完整的
  applyWheelGlassVars()
  store.onChange(applyWheelGlassVars)

  registerSyncKey(WHEEL_GLASS_STORAGE_KEY, (value, snapshot) => {
    // 只有首次启动（带整包快照）才判断 epoch；之后的变化直接应用
    if (snapshot && snapshot[EPOCH_KEY] !== EPOCH) {
      const stored = value as { blur?: number, tint?: number } | undefined
      // 旧模型是 { blur, tint }（tint 还管圆盘遮罩）：只有「没动过」的那份才换成新默认
      const next = stored && stored.blur === 24 && stored.tint === 61 ? { blur: 19, dim: 16 } : stored
      const patch: Record<string, unknown> = { [EPOCH_KEY]: EPOCH }
      if (next !== stored) patch[WHEEL_GLASS_STORAGE_KEY] = next
      writeSync(patch)
      store.apply(next)
      return
    }
    store.apply(value)
  })
}

/** 「恢复默认设置」：回到 WHEEL_GLASS_PARAM_DEFS 里的 default */
export function resetWheelGlassParams() {
  store.reset()
}

import type { FeatureKey } from '~/shared/features'
import type { NumberParamDef } from './paramStore'
import { DEFAULT_CONFIG, groupFeatures } from '~/shared/features'
import { getAll, onConfigChange, persist } from '../config'
import {
  GLASS_PARAM_DEFS,
  getGlassParams,
  onGlassParamsChange,
  resetGlassParams,
  setGlassParam,
  type GlassParamKey,
} from './glassConfig'
import {
  PANEL_PARAM_DEFS,
  getPanelParams,
  onPanelParamsChange,
  resetPanelParams,
  setPanelParam,
  type PanelParamKey,
} from './panelConfig'
import {
  PANEL_SCALE_PARAM_DEFS,
  getPanelScale,
  onPanelScaleChange,
  resetPanelScale,
  setPanelScale,
} from './panelScaleConfig'
import {
  PRELOAD_PARAM_DEFS,
  getPreloadParams,
  onPreloadParamsChange,
  resetPreloadParams,
  setPreloadParam,
  type PreloadParamKey,
} from './preloadConfig'
import {
  SEARCH_BOX_PARAM_DEFS,
  SEARCH_PANEL_PARAM_DEFS,
  getSearchBoxParams,
  getSearchPanelParams,
  onSearchBoxParamsChange,
  onSearchPanelParamsChange,
  resetSearchBoxParams,
  resetSearchPanelParams,
  setSearchBoxParam,
  setSearchPanelParam,
  type SearchBoxParamKey,
  type SearchPanelParamKey,
} from './searchConfig'
import {
  TOPBAR_PARAM_DEFS,
  getTopbarParams,
  onTopbarParamsChange,
  resetTopbarParams,
  setTopbarParam,
  type TopbarParamKey,
} from './topbarConfig'
import panelCss from './panel.css?inline'

/**
 * 一个「材质」功能对应的数值参数组。
 * - kind 决定 DOM 里的 data 属性后缀：input[data-<kind>] / span[data-<kind>-val]
 * - feature 是它所属的功能开关：开关关闭时该组滑块变灰、不可拖动
 * - afterChange 是参数变化后需要额外执行的动作（如把面板强度写回 CSS 变量）
 */
interface ParamGroup {
  kind: string
  defs: NumberParamDef<string>[]
  get: () => Record<string, number>
  set: (key: string, value: number) => void
  onChange: (cb: () => void) => () => void
  feature: FeatureKey
  afterChange?: () => void
  /** 该功能卡是否横跨整行（默认只占栅格的一列），如「首页预加载」 */
  wide?: boolean
}

interface WiredGroup {
  feature: FeatureKey
  inputs: HTMLInputElement[]
  sync: () => void
}

/** 面板材质的模糊 / 遮罩写入 CSS 变量（供 panel.css 使用） */
function applyPanelParams() {
  const { blur, tint } = getPanelParams()
  const root = document.documentElement.style
  root.setProperty('--bili-panel-blur', `${blur}px`)
  root.setProperty('--bili-panel-tint', `${Math.min(100, Math.max(0, tint)) / 100}`)
}

/** 「设置面板缩放」写入 CSS 变量（panel.css 用 --z 反算基准尺寸并整体 scale） */
function applyPanelScale() {
  const { scale } = getPanelScale()
  document.documentElement.style.setProperty('--bili-panel-scale', String(scale / 100))
}

/** 新增一种「材质」时，只需在这里加一项：卡片、滑块、同步、开关联动都会自动生效 */
const PARAM_GROUPS: ParamGroup[] = [
  {
    kind: 'glass',
    defs: GLASS_PARAM_DEFS,
    get: getGlassParams,
    set: (k, v) => setGlassParam(k as GlassParamKey, v),
    onChange: onGlassParamsChange,
    feature: 'imageGlass',
  },
  {
    kind: 'topbar',
    defs: TOPBAR_PARAM_DEFS,
    get: getTopbarParams,
    set: (k, v) => setTopbarParam(k as TopbarParamKey, v),
    onChange: onTopbarParamsChange,
    feature: 'topbarGlass',
  },
  {
    kind: 'searchbox',
    defs: SEARCH_BOX_PARAM_DEFS,
    get: getSearchBoxParams,
    set: (k, v) => setSearchBoxParam(k as SearchBoxParamKey, v),
    onChange: onSearchBoxParamsChange,
    feature: 'searchBoxGlass',
  },
  {
    kind: 'searchpanel',
    defs: SEARCH_PANEL_PARAM_DEFS,
    get: getSearchPanelParams,
    set: (k, v) => setSearchPanelParam(k as SearchPanelParamKey, v),
    onChange: onSearchPanelParamsChange,
    feature: 'searchPanelGlass',
  },
  {
    kind: 'panel',
    defs: PANEL_PARAM_DEFS,
    get: getPanelParams,
    set: (k, v) => setPanelParam(k as PanelParamKey, v),
    onChange: onPanelParamsChange,
    feature: 'panelGlass',
    afterChange: applyPanelParams,
  },
  {
    kind: 'preload',
    defs: PRELOAD_PARAM_DEFS,
    get: getPreloadParams,
    set: (k, v) => setPreloadParam(k as PreloadParamKey, v),
    onChange: onPreloadParamsChange,
    feature: 'preload',
    // 这一组里只有它带滑块，独占一列会显得孤零零；横跨整行，与「设置面板缩放」同宽
    wide: true,
  },
]

/**
 * 「设置面板缩放」滑块挂在哪个分类下（分组名取自 features.ts 的 group）。
 * 它不是一个功能开关，所以单独渲染、单独接线。
 */
const SCALE_GROUP = '界面优化'
const SCALE_DEF = PANEL_SCALE_PARAM_DEFS[0]

/**
 * 设置面板底部展示的「开发版本」标记。
 *
 * 商店版本号（`package.json` 的 version）只在发版时变，开发期改代码它不动，导致
 * 「用户装的是哪一次构建」在界面上看不出来。这里单独维护一个开发序号：
 * 每改一次代码把 v 后面 +1（v001 → v002 …），正式版本号升级时才重置回 v001。
 * 规则写在 `.opencode/skills/bili-elite/SKILL.md` 的「版本、发布与图标」一节。
 */
const DEV_VERSION = '1.0.1 v005'

export function setupSettingsPanel(): () => void {
  if ((window as any).__biliEliteSettingsInjected__) return () => {}
  ;(window as any).__biliEliteSettingsInjected__ = true

  const host = document.createElement('div')
  host.id = 'bili-elite-settings-host'
  host.style.cssText = [
    'position:fixed!important',
    'top:auto!important',
    'left:auto!important',
    'bottom:180px!important',
    'right:24px!important',
    'z-index:2147483647!important',
    'width:44px',
    'height:44px',
    'pointer-events:auto',
  ].join(';')
  ;(document.documentElement || document.body).appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const groups = groupFeatures()
  const groupNames = Object.keys(groups)

  const rangeRowHtml = (kind: string, d: NumberParamDef<string>) => {
    // 可选的滑块说明：用小字写清这个数值代表什么（如「100% ≈ 1 屏」）
    const hint = d.hint ? `\n        <div class="range-hint">${d.hint}</div>` : ''
    return `
      <div class="item item-range">
        <div class="range-head">
          <span class="label">${d.label}</span>
          <span class="range-val" data-${kind}-val="${d.key}"></span>
        </div>
        <div class="range-wrap">
          <input type="range" class="range" min="${d.min}" max="${d.max}" step="${d.step}" data-${kind}="${d.key}">
        </div>${hint}
      </div>`
  }

  const toggleRowHtml = (f: { key: string, label: string }) => `
          <div class="item">
            <span class="label">${f.label}</span>
            <label class="switch">
              <input type="checkbox" data-key="${f.key}">
              <div class="track"><div class="thumb"></div></div>
            </label>
          </div>`

  // 「设置管理」：不是开关也不是滑块，单独一张带标题的卡片，靠 id 接线
  const manageBlockHtml = `
          <div class="setting-block is-plain">
            <div class="block-head">设置管理</div>
            <div class="item">
              <span class="label">恢复默认设置</span>
              <button class="text-btn" id="reset-btn" type="button">重置</button>
            </div>
          </div>`

  // 带滑块的功能 → 该功能的滑块 HTML（决定它是否独占一张卡片）；
  // 不带滑块的连续功能合并进同一张卡片，横跨整行；
  // 标记为 wide 的功能卡同样横跨整行（与「设置面板缩放」同宽）
  const SLIDER_KEYS: Record<string, string> = {}
  const SLIDER_WIDE: Record<string, boolean> = {}
  for (const g of PARAM_GROUPS) {
    SLIDER_KEYS[g.feature] = g.defs.map(d => rangeRowHtml(g.kind, d)).join('')
    if (g.wide) SLIDER_WIDE[g.feature] = true
  }

  // 左侧分类按钮：一个分类一个按钮，默认选中第一个
  const navHtml = groupNames.map((name, i) => `
        <button class="nav-item${i === 0 ? ' is-active' : ''}" type="button" data-group="${name}">${name}</button>`).join('')

  // 右侧：一个分类一页，同一时刻只显示选中页
  const pagesHtml = groupNames.map((groupName, i) => {
    const blocks: string[] = []
    let plain = ''
    const flushPlain = () => {
      if (plain) {
        blocks.push(`\n          <div class="setting-block is-plain">${plain}\n          </div>`)
        plain = ''
      }
    }
    for (const f of groups[groupName] as Array<{ key: string, label: string, cardBreak?: boolean }>) {
      const sliders = SLIDER_KEYS[f.key]
      if (sliders) {
        flushPlain()
        blocks.push(`\n          <div class="setting-block${SLIDER_WIDE[f.key] ? ' is-wide' : ''}">${toggleRowHtml(f)}${sliders}\n          </div>`)
      }
      else {
        // cardBreak：在这一项之前断开合并卡片，让它另起一张（见 features.ts 的 FeatureDef）
        if (f.cardBreak) flushPlain()
        plain += toggleRowHtml(f)
      }
    }
    flushPlain()
    // 「界面优化」页末尾追加「设置面板缩放」——它不是一个开关，单独占一张整行卡片
    if (groupName === SCALE_GROUP) {
      blocks.push(`\n          <div class="setting-block is-plain">${rangeRowHtml('scale', SCALE_DEF)}\n          </div>`)
      blocks.push(manageBlockHtml)
      // 最末一行：开发版本标记，用来确认当前装的是哪一次构建
      blocks.push(`\n          <div class="dev-version">开发版本 ${DEV_VERSION}</div>`)
    }
    return `
        <div class="page${i === 0 ? ' is-active' : ''}" data-page="${groupName}">
          <div class="group">${blocks.join('')}
          </div>
        </div>`
  }).join('')

  shadow.innerHTML = `
    <style>${panelCss}</style>
    <div class="overlay" id="overlay"></div>
    <div class="panel" id="panel">
      <div class="panel-head">
        <div class="title">设置面板</div>
        <button class="close" id="close" type="button" aria-label="关闭">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.7 3.7 12.3 12.3M12.3 3.7 3.7 12.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
      <div class="panel-main">
        <nav class="nav" id="nav">${navHtml}
        </nav>
        <div class="panel-body" id="panel-body">${pagesHtml}
        </div>
      </div>
    </div>
    <div class="confirm-mask" id="confirm-mask">
      <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
        <div class="confirm-title" id="confirm-title">是否恢复默认设置</div>
        <div class="confirm-desc" id="confirm-desc">所有开关与材质参数都会回到初始状态，此操作不可撤销。</div>
        <div class="confirm-actions">
          <button class="confirm-btn" id="confirm-cancel" type="button">取消</button>
          <button class="confirm-btn is-primary" id="confirm-ok" type="button">确定</button>
        </div>
      </div>
    </div>
    <div class="btn" id="btn">⚙</div>
  `

  const overlay = shadow.getElementById('overlay')!
  const panel = shadow.getElementById('panel')!
  const panelBody = shadow.getElementById('panel-body')!
  const btn = shadow.getElementById('btn')!
  const closeBtn = shadow.getElementById('close')!
  const resetBtn = shadow.getElementById('reset-btn')!
  const confirmMask = shadow.getElementById('confirm-mask')!
  const confirmCancel = shadow.getElementById('confirm-cancel')!
  const confirmOk = shadow.getElementById('confirm-ok')!
  const navItems = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.nav-item'))
  const pages = Array.from(shadow.querySelectorAll<HTMLElement>('.page'))
  const inputs = shadow.querySelectorAll<HTMLInputElement>('input[data-key]')

  // 面板尺寸由 panel.css 固定（宽高都是 min(固定值, 视口)），无需 JS 计算

  /** 「设置面板材质」开关：开启时套用毛玻璃，关闭时用不透明卡片 */
  function applyPanelGlass() {
    const glass = !!getAll().panelGlass
    panel.classList.toggle('is-glass', glass)
    // 确认弹窗与面板是同一种材质，跟着一起切
    confirmMask.classList.toggle('is-glass', glass)
  }

  /** 「奶睿设置键」：把右下角的 ⚙ 换成奶睿形象（默认关闭，见 features.ts 的 mascotButton） */
  function applyMascotButton() {
    const on = !!getAll().mascotButton
    btn.classList.toggle('is-mascot', on)
    if (!on) {
      btn.style.removeProperty('--bili-mascot-img')
      return
    }
    // 图片在 extension/assets/ 里，manifest 的 web_accessible_resources 必须登记过，
    // 否则页面上下文加载 chrome-extension:// 资源会被拒
    const url = typeof chrome !== 'undefined' ? chrome.runtime.getURL?.('assets/panel-mascot.png') : undefined
    if (url) btn.style.setProperty('--bili-mascot-img', `url("${url}")`)
  }

  function updateRangeFill(input: HTMLInputElement) {
    const min = Number.parseFloat(input.min)
    const max = Number.parseFloat(input.max)
    const val = Number.parseFloat(input.value)
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0
    input.style.setProperty('--p', `${pct}%`)
    // 蓝色液体填充由 .range-wrap 绘制，变量需要写到它的父级
    input.parentElement?.style.setProperty('--p', `${pct}%`)
  }

  const cleanups: Array<() => void> = []
  const wired: WiredGroup[] = []

  // 统一接线：每个参数组负责自己的滑块渲染、同步与回写
  for (const g of PARAM_GROUPS) {
    const gInputs = Array.from(shadow.querySelectorAll<HTMLInputElement>(`input[data-${g.kind}]`))
    const fmt = (key: string) => {
      const def = g.defs.find(d => d.key === key)
      return def ? def.fmt(g.get()[key]) : ''
    }
    const valEl = (key: string) => shadow.querySelector(`[data-${g.kind}-val="${key}"]`)

    const sync = () => {
      const params = g.get()
      for (const input of gInputs) {
        const key = input.dataset[g.kind] as string
        input.value = String(params[key])
        updateRangeFill(input)
        const el = valEl(key)
        if (el) el.textContent = fmt(key)
      }
    }

    for (const input of gInputs) {
      const key = input.dataset[g.kind] as string
      const handler = () => {
        g.set(key, Number.parseFloat(input.value))
        updateRangeFill(input)
        const el = valEl(key)
        if (el) el.textContent = fmt(key)
      }
      input.addEventListener('input', handler)
      cleanups.push(() => input.removeEventListener('input', handler))
    }

    cleanups.push(g.onChange(() => {
      g.afterChange?.()
      sync()
    }))

    wired.push({ feature: g.feature, inputs: gInputs, sync })
  }

  // 左侧分类切换：只切 class，不重建 DOM，也不触发重新布局之外的额外开销
  function selectGroup(name: string) {
    for (const item of navItems) {
      item.classList.toggle('is-active', item.dataset.group === name)
    }
    for (const page of pages) {
      page.classList.toggle('is-active', page.dataset.page === name)
    }
    panelBody.scrollTop = 0
  }

  for (const item of navItems) {
    const handler = () => selectGroup(item.dataset.group as string)
    item.addEventListener('click', handler)
    cleanups.push(() => item.removeEventListener('click', handler))
  }

  // 所属开关关闭时，对应的滑块变灰且不可拖动
  function setRangesEnabled(list: HTMLInputElement[], enabled: boolean) {
    for (const input of list) {
      input.disabled = !enabled
      input.closest<HTMLElement>('.item-range')?.classList.toggle('is-disabled', !enabled)
    }
  }

  function syncUI() {
    const cfg = getAll()
    inputs.forEach((input) => {
      const key = input.dataset.key as FeatureKey
      input.checked = !!cfg[key]
    })
    for (const g of wired) {
      g.sync()
      setRangesEnabled(g.inputs, !!cfg[g.feature])
    }
    applyPanelGlass()
    applyMascotButton()
  }

  // 「设置面板缩放」：不属于任何功能开关，单独渲染与接线
  const scaleInput = shadow.querySelector<HTMLInputElement>('input[data-scale]')!
  const scaleValEl = shadow.querySelector('[data-scale-val]')

  function syncScale() {
    const v = getPanelScale().scale
    scaleInput.value = String(v)
    updateRangeFill(scaleInput)
    if (scaleValEl) scaleValEl.textContent = SCALE_DEF.fmt(v)
  }

  const onScaleInput = () => setPanelScale('scale', Number.parseFloat(scaleInput.value))
  scaleInput.addEventListener('input', onScaleInput)
  cleanups.push(() => scaleInput.removeEventListener('input', onScaleInput))
  cleanups.push(onPanelScaleChange(() => {
    applyPanelScale()
    syncScale()
  }))

  applyPanelParams()
  applyPanelScale()
  syncScale()
  syncUI()

  inputs.forEach((input) => {
    const handler = () => {
      const key = input.dataset.key as FeatureKey
      persist({ [key]: input.checked } as any)
    }
    input.addEventListener('change', handler)
    cleanups.push(() => input.removeEventListener('change', handler))
  })

  cleanups.push(onConfigChange(() => syncUI()))

  /* ===== 设置管理：恢复默认设置 ===== */

  /**
   * 把「默认设置」整体写回去：
   * - 功能开关：persist(DEFAULT_CONFIG) 一次写全量 key（含 chrome.storage.sync 同步）
   * - 数值参数：各 store.reset() 回 defs 里的 default，并写回各自的存储 key
   * - 最后重新应用 CSS 变量与面板 UI，保证滑块 / 开关 / 数值立刻对齐
   */
  function restoreDefaults() {
    persist({ ...DEFAULT_CONFIG })
    resetGlassParams()
    resetTopbarParams()
    resetSearchBoxParams()
    resetSearchPanelParams()
    resetPanelParams()
    resetPreloadParams()
    resetPanelScale()
    applyPanelParams()
    applyPanelScale()
    syncUI()
    syncScale()
  }

  /** 「是否恢复默认设置」确认弹窗：与面板共用一套开合手感（淡入 + 轻微放大） */
  function setConfirmOpen(open: boolean) {
    confirmMask.classList.toggle('show', open)
  }

  const onResetClick = (e: Event) => {
    e.stopPropagation()
    setConfirmOpen(true)
  }
  const onConfirmCancel = (e: Event) => {
    e.stopPropagation()
    setConfirmOpen(false)
  }
  const onConfirmOk = (e: Event) => {
    e.stopPropagation()
    restoreDefaults()
    setConfirmOpen(false)
  }
  // 点弹窗外的暗色区域 = 取消
  const onConfirmMaskClick = (e: Event) => {
    e.stopPropagation()
    if (e.target === confirmMask) setConfirmOpen(false)
  }
  const onConfirmKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !confirmMask.classList.contains('show')) return
    e.stopPropagation()
    setConfirmOpen(false)
  }

  resetBtn.addEventListener('click', onResetClick)
  confirmCancel.addEventListener('click', onConfirmCancel)
  confirmOk.addEventListener('click', onConfirmOk)
  confirmMask.addEventListener('click', onConfirmMaskClick)
  document.addEventListener('keydown', onConfirmKeydown, true)
  cleanups.push(() => {
    resetBtn.removeEventListener('click', onResetClick)
    confirmCancel.removeEventListener('click', onConfirmCancel)
    confirmOk.removeEventListener('click', onConfirmOk)
    confirmMask.removeEventListener('click', onConfirmMaskClick)
    document.removeEventListener('keydown', onConfirmKeydown, true)
  })

  /**
   * 面板开合。
   * 打开时让透明遮罩接管 pointer-events：面板外的任何点击都落在遮罩上，
   * 既不会穿透到页面（不会误触视频卡片 / 链接），同时关闭面板。
   */
  function setOpen(open: boolean) {
    if (open) panelBody.scrollTop = 0
    // 关面板时顺手关掉确认弹窗，避免下次打开面板时它还挂着
    else setConfirmOpen(false)
    panel.classList.toggle('show', open)
    overlay.classList.toggle('show', open)
  }

  const onBtnClick = (e: Event) => {
    e.stopPropagation()
    setOpen(!panel.classList.contains('show'))
  }
  const onCloseClick = (e: Event) => {
    e.stopPropagation()
    setOpen(false)
  }
  const onOverlayClick = (e: Event) => {
    e.stopPropagation()
    setOpen(false)
  }
  // 兜底：万一有事件绕过遮罩（如键盘触发），也按原设定关闭
  const onDocClick = () => setOpen(false)
  const onPanelClick = (e: Event) => e.stopPropagation()

  btn.addEventListener('click', onBtnClick)
  closeBtn.addEventListener('click', onCloseClick)
  overlay.addEventListener('click', onOverlayClick)
  document.addEventListener('click', onDocClick)
  panel.addEventListener('click', onPanelClick)
  cleanups.push(() => {
    btn.removeEventListener('click', onBtnClick)
    closeBtn.removeEventListener('click', onCloseClick)
    overlay.removeEventListener('click', onOverlayClick)
    document.removeEventListener('click', onDocClick)
    panel.removeEventListener('click', onPanelClick)
  })

  return () => {
    cleanups.forEach((fn) => { try { fn() } catch { /* noop */ } })
    host.remove()
    document.documentElement.style.removeProperty('--bili-panel-blur')
    document.documentElement.style.removeProperty('--bili-panel-tint')
    document.documentElement.style.removeProperty('--bili-panel-scale')
    ;(window as any).__biliEliteSettingsInjected__ = false
  }
}

import type { FeatureKey } from '~/shared/features'
import type { NumberParamDef } from './paramStore'
import { DEFAULT_CONFIG, groupFeatures } from '~/shared/features'
import { get, getAll, onConfigChange, persist } from '../config'
import { chromeGetURL } from '../storage'
import {
  CDN_APPLIED_EVENT,
  getCdnPick,
  isCdnPlayPage,
  readCdnApplied,
  readCdnHosts,
  readCdnScores,
  readCdnState,
  requestCdnProbe,
  setCdnPick,
  shortHost,
  type CdnState,
} from './cdnBoost'
import { registerFloatDock, setFloatDockPaused } from './floatDock'
import { LAYER_SETTINGS, bindLayerToWebFullscreen } from './videoLayer'
import {
  GLASS_PARAM_DEFS,
  getGlassParams,
  onGlassParamsChange,
  resetGlassParams,
  setGlassParam,
  type GlassParamKey,
} from './glassConfig'
import {
  HOME_CARD_PARAM_DEFS,
  getHomeCardParams,
  onHomeCardParamsChange,
  resetHomeCardParams,
  setHomeCardParam,
  type HomeCardParamKey,
} from './homeCardConfig'
import {
  HOME_PANEL_PARAM_DEFS,
  getHomePanelParams,
  onHomePanelParamsChange,
  resetHomePanelParams,
  setHomePanelParam,
  type HomePanelParamKey,
} from './homePanelConfig'
import { setNightMode } from './labFeatures'
import {
  PANEL_PARAM_DEFS,
  getPanelParams,
  onPanelParamsChange,
  resetPanelParams,
  setPanelParam,
  type PanelParamKey,
} from './panelConfig'
import {
  getPanelHotkey,
  onPanelHotkeyChange,
  resetPanelHotkey,
  setPanelHotkey,
} from './panelHotkeyConfig'
import {
  PANEL_SCALE_PARAM_DEFS,
  SCALE_BASE,
  getPanelScale,
  onPanelScaleChange,
  resetPanelScale,
  setPanelScale,
} from './panelScaleConfig'
import {
  VIEWER_PARAM_DEFS,
  type ViewerParamKey,
  getViewerParams,
  onViewerParamsChange,
  resetViewerParams,
  setViewerParam,
} from './viewerParams'
import {
  PRELOAD_PARAM_DEFS,
  getPreloadParams,
  onPreloadParamsChange,
  resetPreloadParams,
  setPreloadParam,
  type PreloadParamKey,
} from './preloadConfig'
import {
  getQuickKeys,
  onQuickKeysChange,
  resetQuickKeys,
  setQuickKey,
} from './quickKeysConfig'
import {
  WHEEL_ENTRIES,
  getWheelConfig,
  getWheelSlots,
  isModifierCode,
  keyLabel,
  onWheelConfigChange,
  resetWheelConfig,
  setWheelKey,
  setWheelKeyCapturing,
  setWheelSlots,
} from './quickWheelConfig'
import { WHEEL_SLOTS, chipOffset, sectorPath } from './quickWheelLayout'


import {
  RAIL_CARD_PARAM_DEFS,
  getRailCardParams,
  onRailCardParamsChange,
  resetRailCardParams,
  setRailCardParam,
  type RailCardParamKey,
} from './railCardConfig'
import { installRipple } from './ripple'
import {
  SEARCH_CARD_PARAM_DEFS,
  getSearchCardParams,
  onSearchCardParamsChange,
  resetSearchCardParams,
  setSearchCardParam,
  type SearchCardParamKey,
} from './searchCardConfig'
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
  WHEEL_GLASS_PARAM_DEFS,
  applyWheelGlassVars,
  getWheelGlassParams,
  onWheelGlassParamsChange,
  resetWheelGlassParams,
  setWheelGlassParam,
  type WheelGlassParamKey,
} from './wheelGlassConfig'
import {
  TOPBAR_PARAM_DEFS,

  getTopbarParams,
  onTopbarParamsChange,
  resetTopbarParams,
  setTopbarParam,
  type TopbarParamKey,
} from './topbarConfig'
import {
  WHATS_NEW_DATE,
  WHATS_NEW_INTRO,
  WHATS_NEW_SECTIONS,
  WHATS_NEW_VERSION,
} from './whatsNew'
import panelButtonCss from './panelButton.css?inline'
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

/** 「设置面板缩放」写入 CSS 变量（panel.css 用它整体 scale；100% = SCALE_BASE 倍基准） */
function applyPanelScale() {
  const { scale } = getPanelScale()
  document.documentElement.style.setProperty('--bili-panel-scale', String((scale / 100) * SCALE_BASE))
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
    kind: 'homepanel',
    defs: HOME_PANEL_PARAM_DEFS,
    get: getHomePanelParams,
    set: (k, v) => setHomePanelParam(k as HomePanelParamKey, v),
    onChange: onHomePanelParamsChange,
    feature: 'homePanelGlass',
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
    kind: 'wheelglass',
    defs: WHEEL_GLASS_PARAM_DEFS,
    get: getWheelGlassParams,
    set: (k, v) => setWheelGlassParam(k as WheelGlassParamKey, v),
    onChange: onWheelGlassParamsChange,
    feature: 'wheelGlass',
    afterChange: applyWheelGlassVars,
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
  {
    kind: 'homecard',
    defs: HOME_CARD_PARAM_DEFS,
    get: getHomeCardParams,
    set: (k, v) => setHomeCardParam(k as HomeCardParamKey, v),
    onChange: onHomeCardParamsChange,
    feature: 'homeOptimize',
    // 滑块挂在「首页优化」那张卡里，独占一列太窄，跟预加载一样横跨整行
    wide: true,
  },
  {
    kind: 'searchcard',
    defs: SEARCH_CARD_PARAM_DEFS,
    get: getSearchCardParams,
    set: (k, v) => setSearchCardParam(k as SearchCardParamKey, v),
    onChange: onSearchCardParamsChange,
    feature: 'searchOptimize',
    // 与「首页优化」那张卡同款：开关 + 一条「卡片大小」，横跨整行
    wide: true,
  },
  {
    kind: 'railcard',
    defs: RAIL_CARD_PARAM_DEFS,
    get: getRailCardParams,
    set: (k, v) => setRailCardParam(k as RailCardParamKey, v),
    onChange: onRailCardParamsChange,
    // 挂在「播放页优化」那张卡里 —— 开关关掉时整行变灰，CSS 也整段失效，
    // 这就是需求里的「仅在播放页优化打开时生效」
    feature: 'videoBeta',
    wide: true,
  },
]

/**
 * 「设置面板缩放」滑块挂在哪个分类下（分组名取自 features.ts 的 group）。
 * 它不是一个功能开关，所以单独渲染、单独接线。
 */
const SCALE_GROUP = '界面优化'

/**
 * 「快捷功能」这一页不走通用渲染：除了开关，还要两行自定义控件（呼出按键 / 轮盘项目），
 * 所以整页单独拼。开关那一行仍复用 toggleRowHtml，接线照旧走 input[data-key]。
 */
const QUICK_GROUP = '快捷功能'

/**
 * 「功能增强」这一页末尾要挂一张「节点测速」卡（1.2.3 v006）：它不是开关，
 * 而是一个按钮 + 一张结果列表 + 一个手动指定，所以单独渲染、单独接线。
 * 1.2.5 v020：「播放节点优选」开关已删除，这张卡是这一页里唯一和节点有关的东西。
 */
const BOOST_GROUP = '功能增强'


/**
 * 「呼出功能轮盘」右边那颗灰色感叹号里的说明。
 *
 * 这行字原来是铺在卡片上方的一整行灰字（.block-note）：每次打开面板都要先读一遍，
 * 还白占一行高度。现在收进悬停提示 —— 只在「不明白为什么没生效」的时候看一眼。
 * 内容一字未改：怎么用 / 三个页面 / 三种播放器模式不接管，四条限制都还在。
 */
const WHEEL_HINT = '按住呼出键弹出轮盘，移动鼠标选择、松开前往；只在首页、动态页与视频页生效，视频进入全屏 / 网页全屏 / 宽屏时不接管'

/**
 * 「快速使用设置面板」右边那颗感叹号里的说明。
 * 用需求里的原话当文案：光看「快速使用设置面板」这七个字，只知道自己是个开关，
 * 看不出「开了之后要按一个键」—— 这句补的就是那一步。
 */
const PANEL_HINT = '使用快捷键打开或关闭设置面板'

/**
 * 说明感叹号 + 悬停提示。用在「呼出功能轮盘」「卡片大小」「预加载范围」三处 ——
 * 这三行原来各有一段灰字说明，现在统一收进汉字右边这颗感叹号：不占行高、不打断读标签。
 *
 * 只做悬停：不设 tabindex、不绑 click，光标是 help 而不是 pointer（点它没用）。
 * 提示卡朝**下**弹（这些行都在内容区里，往上弹容易被 .panel-body 的滚动裁掉），
 * 并且从感叹号向**右**展开 —— 感叹号紧跟在汉字后面，往左展开会压到左边的分类栏。
 * 缩放只作用在圆圈（__ring）上：提示卡是它的兄弟节点，挂在同一父级上会跟着 transform 变形。
 */
/** 提示文案要进 aria-label：只需要转义 & 与双引号 */
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/**
 * 说明感叹号 + 悬停提示。
 *
 * `tabindex="0"` + `aria-label`：原来只做鼠标悬停，键盘和读屏用户拿不到这段说明
 * （`visibility: hidden` 的提示卡不在无障碍树里）。现在 Tab 能聚焦、聚焦时提示卡
 * 同样弹出（panel.css 里 `:focus-visible` 与 `:hover` 并排写），读屏则直接念 aria-label。
 */
const hintDot = (text: string) => `<span class="hint-dot" tabindex="0" role="note" aria-label="${escapeAttr(text)}">
                    <span class="hint-dot__ring" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <path d="M8 4.2v4.5"></path>
                        <circle cx="8" cy="11.7" r="0.95" fill="currentColor" stroke="none"></circle>
                      </svg>
                    </span>
                    <span class="hint-tip" role="note">${text}</span>
                  </span>`

/**
 * 「新版本改动」：左侧导航的最后一项，右侧一页读完「这个版本改了什么」。
 *
 * 它不来自 features.ts（没有开关、没有参数），导航项与页面都单独拼。
 * **正文一个字都不在这个文件里**：全部在 modules/whatsNew.ts，发版只改那一个文件。
 * 这里只负责把它排版成「版本标题 + 分节列表」。
 */
const WHATS_NEW_GROUP = '新版本改动'
const SCALE_DEF = PANEL_SCALE_PARAM_DEFS[0]

/**
 * 左侧分类的线性图标（16×16，描边走 currentColor）。
 *
 * 常显（早期跟着已删的「控制面板 beta」一起隐藏，那个开关删掉后图标就固定显示）。
 * 图标一挂上去整列会宽出一截、也会改变行高，所以尺寸与 .nav-text 的收缩都要卡死。
 * 用 data-* 的方式存成字符串而不是 Vue 组件：整个面板是一段 innerHTML，
 * 这里保持同一套写法，切分类时零开销。
 */
const NAV_ICONS: Record<string, string> = {
  动效增强: '<path d="M8 2.4 9.7 6.3 13.6 8 9.7 9.7 8 13.6 6.3 9.7 2.4 8 6.3 6.3Z"/>',
  高级材质: '<rect x="2.4" y="2.4" width="6.2" height="6.2" rx="1.6"/><rect x="7.4" y="7.4" width="6.2" height="6.2" rx="1.6"/>',
  界面优化: '<path d="M2.6 5.2h10.8M2.6 10.8h10.8"/><circle cx="6.2" cy="5.2" r="1.7"/><circle cx="9.8" cy="10.8" r="1.7"/>',
  // 功能增强：一道闪电，代表「更快」—— 这一页放的都是打开播放页时的速度类功能
  功能增强: '<path d="M9.1 2.2 4.4 8.8h2.7L6.7 14l4.9-6.8H8.9l.2-5Z"/>',
  // 轮盘：外圈 + 内点 + 四个方向的刻度，比齿轮更像「转盘」
  快捷功能: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.6"/><path d="M8 2.8v1.4M8 11.8v1.4M2.8 8h1.4M11.8 8h1.4"/>',

  个性设置: '<circle cx="8" cy="5.6" r="2.5"/><path d="M3.1 13.3c.9-2.3 2.7-3.5 4.9-3.5s4 1.2 4.9 3.5"/>',
  实验室: '<path d="M6.3 2.6v4.1L3.2 11.8a1.3 1.3 0 0 0 1.1 2h7.4a1.3 1.3 0 0 0 1.1-2L9.7 6.7V2.6"/><path d="M5.2 2.6h5.6"/>',
  // 「更新」：一个圈 + 向上的箭头，比文档 / 星形更直白（这一页讲的是「变了什么」）
  新版本改动: '<circle cx="8" cy="8" r="5.4"/><path d="M8 10.9V5.2M5.8 7.4 8 5.2l2.2 2.2"/>',
  // GitHub 的 octocat 是实心图形（其它分类都是线性图标）：子路径自己声明 fill / stroke，
  // 盖掉父级 svg 的 fill:none / stroke:currentColor；24 单位的路径缩到 16
  开源地址: '<path transform="scale(0.6667)" fill="currentColor" stroke="none" d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/>',
}

/**
 * 设置面板底部展示的「开发版本」标记。
 *
 * 商店版本号（`package.json` 的 version）只在发版时变，开发期改代码它不动，导致
 * 「用户装的是哪一次构建」在界面上看不出来。这里单独维护一个开发序号：
 * 每改一次代码把 v 后面 +1（v001 → v002 …），正式版本号升级时才重置回 v001。
 * 规则写在 `.opencode/skills/bili-elite/SKILL.md` 的「版本、发布与图标」一节。
 */
const DEV_VERSION = '1.2.5 v061'









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
    'width:44px',
    'height:44px',
    'pointer-events:auto',
  ].join(';')
  ;(document.documentElement || document.body).appendChild(host)
  // 层级交给 videoLayer：平时压过页面一切，进网页全屏降到播放器下面被视频盖住
  const offLayer = bindLayerToWebFullscreen(host, LAYER_SETTINGS)

  const shadow = host.attachShadow({ mode: 'open' })

  /**
   * 面板样式（panel.css，近千行、7 处 backdrop-filter）延迟到第一次打开才注入。
   * 首屏只注入 panelButton.css 那几十行 —— ⚙ 按钮是唯一入口，它得第一时间是对的。
   * 注入是同步的（append 之后同一帧就生效），所以 setOpen(true) 里先调它、再挂 .show。
   * 注入之前 `.panel` / `.confirm-mask` 是「无样式的裸 DOM」，靠 panelButton.css 里
   * 那两条 display:none 藏住；panel.css 里两者都有显式 display，注入后自然覆盖。
   */
  let panelCssInjected = false
  function ensurePanelCss() {
    if (panelCssInjected) return
    panelCssInjected = true
    const style = document.createElement('style')
    style.textContent = panelCss
    shadow.appendChild(style)
  }

  /** 材质实时预览：把当前模糊 / 遮罩写进 24×24 小方块的 CSS 变量（见 panel.css） */
  function syncPreview(g: ParamGroup, params: Record<string, number>) {
    const el = shadow.querySelector<HTMLElement>(`[data-preview="${g.kind}"]`)
    if (!el) return
    const blur = typeof params.blur === 'number' ? params.blur : 0
    // 没有「遮罩强度」的组（评论区图片材质只有模糊 + 明暗、轮盘背景只有模糊 + 暗度）
    // 给个能看清的中间值：轮盘背景用「暗度」反推，其它组直接给 45%
    const tint = typeof params.tint === 'number'
      ? params.tint
      : typeof params.dim === 'number' ? 100 - params.dim : 45

    el.style.setProperty('--p-blur', `${blur}px`)
    el.style.setProperty('--p-tint', String(Math.min(100, Math.max(0, tint)) / 100))
  }

  const groups = groupFeatures()
  const groupNames = Object.keys(groups)

  const rangeRowHtml = (kind: string, d: NumberParamDef<string>, withPreview = false) => {
    // 可选的滑块说明：不再铺在滑块下面（那会白占一行高度），而是收进标签右边的感叹号
    const dot = d.hint ? hintDot(d.hint) : ''
    // 材质实时预览：24×24 的小方块，底下一张彩色小图，上面盖一层跟当前滑块同步的
    // 毛玻璃（blur + 白色遮罩），不用来回开关面板也能看出调到什么程度。
    // 只挂在每组第一行（模糊强度那行）上，一组一个。
    const preview = withPreview
      ? `<span class="mat-preview" data-preview="${kind}" aria-hidden="true"><span class="mat-preview__bg"></span><span class="mat-preview__glass"></span></span>`
      : ''
    // 数值本身是 <button>：外观是胶囊，点一下就地输入（见 startValueEdit）
    return `
      <div class="item item-range">
        <div class="range-head">
          <span class="range-head__left">${preview}<span class="label-wrap"><span class="label">${d.label}</span>${dot}</span></span>
          <button class="range-val" type="button" data-${kind}-val="${d.key}"></button>
        </div>
        <div class="range-wrap">
          <input type="range" class="range" min="${d.min}" max="${d.max}" step="${d.step}" data-${kind}="${d.key}">
        </div>
      </div>`
  }

  /**
   * 「节点测速」这张卡（1.2.5 v020 起是「功能增强」页里唯一和节点有关的东西）。
   *
   * 三块：一行「当前节点」、一行标题 + 「开始测速」按钮、一张结果列表（点一行 = 切到
   * 那个节点，只对当前这个视频生效）。列表和状态都是渲染后再填，因为数据在
   * sessionStorage 里、而且要随测速进度刷新（见 paintCdnCard）。
   */
  const cdnCardHtml = () => `
      <div class="item">
        <span class="label-wrap"><span class="label">当前节点</span>${hintDot('当前播放页实际在用的 CDN 节点。只在播放页显示，其它页面留空。站内切视频后靠实际分片请求重新识别，不会停在旧值上')}</span>
        <span class="cdn-now" id="cdn-now"></span>
      </div>
      <div class="item">
        <span class="label-wrap"><span class="label">节点测速</span>${hintDot('对当前播放页那条流的每个 CDN 节点测一次速（每个取 128KB）。点列表里的一行就切到那个节点 —— 只对当前这个视频、这一次播放生效，换视频或关掉标签页就回到 B 站默认节点；不点就不会动流')}</span>
        <button class="text-btn" id="cdn-test" type="button">开始测速</button>
      </div>
      <div class="cdn-list" id="cdn-list"></div>
      <div class="cdn-note" id="cdn-note"></div>`

  /**
   * 一行「标签 + 开关」。
   * 标签右边可以挂一颗说明感叹号（FeatureDef.hint）—— 得包一层 .label-wrap，
   * 否则 .item 的 space-between 会把感叹号推到中间，离汉字十万八千里。
   */
  const toggleRowHtml = (f: { key: string, label: string, under?: string, hint?: string }) => `
          <div class="item${f.under ? ' is-sub' : ''}"${f.under ? ` data-under="${f.under}"` : ''}>
            ${f.hint
              ? `<span class="label-wrap"><span class="label">${f.label}</span>${hintDot(f.hint)}</span>`
              : `<span class="label">${f.label}</span>`}
            <label class="switch">
              <input type="checkbox" data-key="${f.key}">
              <div class="track"><div class="thumb"></div></div>
            </label>
          </div>`

  // 带滑块的功能 → 该功能的滑块 HTML（决定它是否独占一张卡片）；
  // 不带滑块的连续功能合并进同一张卡片，横跨整行；
  // 标记为 wide 的功能卡同样横跨整行（与「设置面板缩放」同宽）
  const SLIDER_KEYS: Record<string, string> = {}
  const SLIDER_WIDE: Record<string, boolean> = {}
  for (const g of PARAM_GROUPS) {
    // 预览只给「有模糊参数」的组：预加载（dist）/ 面板缩放这些没有材质可言
    const hasGlass = g.defs.some(d => d.key === 'blur')
    SLIDER_KEYS[g.feature] = g.defs
      .map((d, i) => rangeRowHtml(g.kind, d, i === 0 && hasGlass))
      .join('')
    if (g.wide) SLIDER_WIDE[g.feature] = true
  }

  // 依附于别的功能的开关（FeatureDef.under）：不单独成卡，而是塞进父项那张卡里，
  // 排在父项那一行下面、滑块上面；父项关掉时整行变灰（见 syncUI 的 applyToggleDeps）
  const UNDER: Record<string, Array<{ key: string, label: string, under?: string }>> = {}
  for (const list of Object.values(groups) as Array<Array<{ key: string, label: string, under?: string }>>) {
    for (const f of list) {
      if (f.under) (UNDER[f.under] ||= []).push(f)
    }
  }
  const SUB_KEYS = new Set(Object.values(UNDER).flat().map(f => f.key))

  // 「高级材质」页每张卡整行铺满：材质类每一项都是「开关 + 三条滑块」，
  // 两两并排会把滑块压得太窄，数值也顶不到最右边
  const STACK_GROUPS = new Set(['高级材质'])

  // 左侧分类按钮：一个分类一个按钮，默认选中第一个。
  // 图标随按钮一起渲染（常显，见 NAV_ICONS 的注释），切分类只切选中态类名，
  // 不用重建导航（重建会丢掉选中态与正在进行的背景擦除动画）。
  // 「新版本改动」固定在最后（内容类分类，不参与功能分组）。
  const navHtml = [...groupNames, WHATS_NEW_GROUP].map((name, i) => `
        <button class="nav-item${i === 0 ? ' is-active' : ''}" type="button" data-group="${name}">
          <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${NAV_ICONS[name] ?? ''}</svg></span>
          <span class="nav-text">${name}</span>
        </button>`).join('')

  // 右侧：一个分类一页，同一时刻只显示选中页
  const pagesHtml = groupNames.map((groupName, i) => {
    // 「快捷功能」整页单独拼：开关 + 呼出按键 + 轮盘项目（见 QUICK_GROUP 的注释）。
    // 开关那一行仍由 toggleRowHtml 生成，所以接线（input[data-key]）不用特殊处理。
    if (groupName === QUICK_GROUP) {
      // 顺序就是 FEATURES 里的顺序：第一项「呼出功能轮盘」，第二项「更改默认值为当前标签页打开」
      // （后者 under: quickWheel，轮盘关掉时整行变灰，由 syncUI 的 applyToggleDeps 负责）
      const list = groups[groupName] as Array<{ key: string, label: string, under?: string, hint?: string }>
      const wheelRow = list[0]
      const tabRow = list.find(f => f.key === 'wheelCurrentTab')
      // 第二张卡：设置面板自己的呼出键。兜底对象是为了 features.ts 里哪天把这一项删掉时
      // 面板不至于渲染成「undefined」—— 那个键不存在时 get() 恒为 undefined，开关也就永远打不开。
      const hotkeyRow = list.find(f => f.key === 'panelHotkey') ?? { key: 'panelHotkey', label: '快速使用设置面板' }
      // 第三张卡（1.2.3）：页面快捷键。两项都是「开关 + 一颗按键胶囊」的同构行，
      // 所以用 toggleRowHtml 生成开关行、按键行手写（与第二张卡的「呼出按键」完全一样）。
      // 找不到就不渲染这张卡 —— 宁缺，也不要拼出 data-key 不存在的空开关。
      const refreshRow = list.find(f => f.key === 'quickRefresh')
      const backtopRow = list.find(f => f.key === 'quickBackTop')
      const quickKeysCard = refreshRow && backtopRow
        ? `
          <div class="setting-block is-plain">
            ${toggleRowHtml(refreshRow)}
            <div class="item is-sub" data-under="${refreshRow.key}">
              <span class="label">快捷键</span>
              <button class="key-cap" id="refresh-key" type="button" title="点击后按任意键修改">${keyLabel(getQuickKeys().refresh)}</button>
            </div>
            ${toggleRowHtml(backtopRow)}
            <div class="item is-sub" data-under="${backtopRow.key}">
              <span class="label">快捷键</span>
              <button class="key-cap" id="backtop-key" type="button" title="点击后按任意键修改">${keyLabel(getQuickKeys().backtop)}</button>
            </div>
          </div>`
        : ''
      // 呼出功能轮盘这一行不用 toggleRowHtml：标签后面要夹一颗说明感叹号（hintDot）。
      // 开关本身仍是 input[data-key]，所以接线、切换动效、指针离开摘类这些既有逻辑不用改。
      // 第二张卡同理（含感叹号），「呼出按键」那行挂 data-under，开关关掉时整行变灰。
      return `
        <div class="page${i === 0 ? ' is-active' : ''}" data-page="${groupName}">
          <div class="group">
          <div class="setting-block is-plain">
            <div class="item">
              <span class="label-wrap"><span class="label">${wheelRow.label}</span>${hintDot(WHEEL_HINT)}</span>
              <label class="switch">
                <input type="checkbox" data-key="${wheelRow.key}">
                <div class="track"><div class="thumb"></div></div>
              </label>
            </div>
            ${tabRow ? toggleRowHtml(tabRow) : ''}
            <div class="item">
              <span class="label">呼出按键</span>
              <button class="key-cap" id="wheel-key" type="button" title="点击后按任意键修改">${keyLabel(getWheelConfig().key)}</button>
            </div>
            <div class="item">
              <span class="label">轮盘项目</span>
              <button class="text-btn" id="wheel-edit" type="button">编辑</button>
            </div>
          </div>
          <div class="setting-block is-plain">
            <div class="item">
              <span class="label-wrap"><span class="label">${hotkeyRow.label}</span>${hintDot(PANEL_HINT)}</span>
              <label class="switch">
                <input type="checkbox" data-key="${hotkeyRow.key}">
                <div class="track"><div class="thumb"></div></div>
              </label>
            </div>
            <div class="item is-sub" data-under="${hotkeyRow.key}">
              <span class="label">呼出按键</span>
              <button class="key-cap" id="panel-key" type="button" title="点击后按任意键修改">${keyLabel(getPanelHotkey())}</button>
            </div>
          </div>${quickKeysCard}
          </div>
        </div>`
    }
    const blocks: string[] = []

    let plain = ''
    // 这张合并卡片上方那行灰字（取这一串开关里第一项的 note）：给一组开关起个小标题，
    // 界面优化末尾那张「操作浮钮」就靠它
    let plainNote = ''
    const flushPlain = () => {
      if (plain) {
        if (plainNote) blocks.push(`\n          <div class="block-note">${plainNote}</div>`)
        blocks.push(`\n          <div class="setting-block is-plain">${plain}\n          </div>`)
        plain = ''
        plainNote = ''
      }
    }
    for (const f of groups[groupName] as Array<{ key: string, label: string, cardBreak?: boolean, under?: string, note?: string, hint?: string }>) {
      if (SUB_KEYS.has(f.key)) continue
      const sliders = SLIDER_KEYS[f.key]
      if (sliders) {
        flushPlain()
        // 卡片上方那行小字：开关都叫「材质」了，靠它说明这张卡管的是哪一块
        if (f.note) blocks.push(`\n          <div class="block-note">${f.note}</div>`)
        // 子开关排在父项那一行下面、滑块上面
        const subs = (UNDER[f.key] ?? []).map(toggleRowHtml).join('')
        blocks.push(`\n          <div class="setting-block${SLIDER_WIDE[f.key] ? ' is-wide' : ''}">${toggleRowHtml(f)}${subs}${sliders}\n          </div>`)
      }
      else {
        // cardBreak：在这一项之前断开合并卡片，让它另起一张（见 features.ts 的 FeatureDef）
        if (f.cardBreak) flushPlain()
        if (!plain) plainNote = f.note ?? ''
        // 依附在纯开关下面的项（under）也排在父项下面、同一张卡里 —— 带滑块那条分支
        // 本来就有同样的处理，这里补一份，否则 under 挂在无滑块的父项上会整个不渲染
        plain += toggleRowHtml(f) + (UNDER[f.key] ?? []).map(toggleRowHtml).join('')
      }
    }
    flushPlain()
    // 「界面优化」页末尾追加「设置面板缩放」——它不是一个开关，单独占一张整行卡片
    if (groupName === SCALE_GROUP) {
      blocks.push(`\n          <div class="setting-block is-plain">${rangeRowHtml('scale', SCALE_DEF)}\n          </div>`)
    }
    // 「功能增强」页末尾追加「节点测速」——同样不是开关，单独一张卡
    if (groupName === BOOST_GROUP) {
      blocks.push(`\n          <div class="block-note">节点测速</div>`)
      blocks.push(`\n          <div class="setting-block is-plain cdn-card">${cdnCardHtml()}\n          </div>`)
      // 图片查看器：自绘的那一层是全站常开的，**没有开关**，只暴露两个数值
      blocks.push(`\n          <div class="block-note">图片查看器</div>`)
      blocks.push(`\n          <div class="setting-block is-plain">${VIEWER_PARAM_DEFS.map(d => rangeRowHtml('viewer', d)).join('')}\n          </div>`)
    }
    return `
        <div class="page${i === 0 ? ' is-active' : ''}${STACK_GROUPS.has(groupName) ? ' is-stack' : ''}" data-page="${groupName}">
          <div class="group">${blocks.join('')}
          </div>
        </div>`
  }).join('')

  // 「新版本改动」页：顶部一张版本卡（版本号 / 日期 / 一句话概览），下面按「新增 / 优化 /
  // 修复」分节，每节一行小标题 + 一张列表卡。**文案全在 whatsNew.ts**，这里只管排版。
  // 不用 .item（那是「左右两端对齐」的开关行），长句子需要自己的一套 .wn-*（panel.css §24）。
  const whatsNewPageHtml = `
        <div class="page" data-page="${WHATS_NEW_GROUP}">
          <div class="group wn-group">
            <div class="setting-block is-plain wn-head">
              <div class="wn-head__ver">版本 ${WHATS_NEW_VERSION}</div>
              <div class="wn-head__date">${WHATS_NEW_DATE}</div>
              <div class="wn-head__desc">${WHATS_NEW_INTRO}</div>
            </div>
            ${WHATS_NEW_SECTIONS.map(s => `
            <div class="block-note">${s.title}</div>
            <div class="setting-block is-plain wn-list">${s.items.map(t => `
              <div class="wn-item">${t}</div>`).join('')}
            </div>`).join('')}
          </div>
        </div>`

  // 「开源地址」页：两张卡，每行都是「标签 + 前往」，按钮是 <a>，点开就是 GitHub 新标签
  const pagesAll = pagesHtml + whatsNewPageHtml

  shadow.innerHTML = `
    <style>${panelButtonCss}</style>
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
        <div class="panel-body" id="panel-body">${pagesAll}
        </div>
      </div>
      <div class="panel-foot" id="panel-foot">
        <span class="dev-version">开发版本 ${DEV_VERSION}</span>
        <button class="text-btn" id="reset-btn-foot" type="button">恢复默认</button>
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
    <div class="wheel-editor" id="wheel-editor">
      <div class="we-card" role="dialog" aria-modal="true" aria-labelledby="we-title">
        <div class="we-head">
          <div class="we-title" id="we-title">功能轮盘</div>
          <button class="close" id="we-close" type="button" aria-label="关闭">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3.7 3.7 12.3 12.3M12.3 3.7 3.7 12.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
        <div class="we-body">
          <div class="we-left">
            <div class="we-wheel" id="we-wheel">
              <svg class="we-ring" viewBox="0 0 440 440" aria-hidden="true">
                <circle class="we-disc" cx="220" cy="220" r="210"></circle>
                <g id="we-wedges"></g>
                <circle class="we-hub" cx="220" cy="220" r="92"></circle>

              </svg>
              <div class="we-chips" id="we-chips"></div>
              <div class="we-center">
                <div class="we-center-name" id="we-center-name">功能轮盘</div>
                <div class="we-center-desc" id="we-center-desc">选择一个位置</div>
              </div>
            </div>
            <div class="we-legend">按住 <b id="we-key">Tab</b> 呼出</div>
          </div>
          <div class="we-right">
            <div class="we-right-head">
              <span class="we-right-title">功能入口</span>
              <span class="we-right-count" id="we-count"></span>
            </div>
            <div class="we-grid" id="we-grid"></div>
            <div class="we-actions">
              <span class="we-hint" id="we-hint"></span>
              <button class="text-btn" id="we-remove" type="button">卸下</button>

            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="btn" id="btn">⚙</div>
  `

  /**
   * Material 涟漪：pointerdown 时按点击坐标建临时节点，动画挂在节点自己身上。
   * 纯 CSS 的 `:active::after` 只能从中心扩散、且一松手动画就被腰斩（见 ripple.ts）。
   *
   * **必须放在上面那句 innerHTML 之后**（1.2.5 v025）：installRipple 会把 ripple.css
   * 注入到这个 shadow root，先注入的 `<style>` 会被 `shadow.innerHTML = …` 整块冲掉 ——
   * 涟漪就静默失效了。监听本来就是 shadow root 上的事件委托，放后面不影响任何控件。
   */
  const offRipple = installRipple(shadow)


  const overlay = shadow.getElementById('overlay')!
  const panel = shadow.getElementById('panel')!
  const panelBody = shadow.getElementById('panel-body')!
  const btn = shadow.getElementById('btn')!
  // 右下角那列「操作浮钮」的收纳（界面优化 → 自动隐藏 / 半隐藏）：⚙ 只是其中一颗，
  // 收起时得和上面那列浮键一起动，所以交给 floatDock 统一管 —— 这里只登记「我是设置键」。
  // 动的元素是影子根里的 #btn 而不是宿主：设置面板也在这个影子根里，
  // 宿主一旦有位移，面板的 position:fixed 就会以宿主为参照系。
  const offDock = registerFloatDock({ role: 'panel', host, animEl: btn, hoverEls: [btn] })
  const closeBtn = shadow.getElementById('close')!
  const resetBtn = shadow.getElementById('reset-btn-foot')!
  const confirmMask = shadow.getElementById('confirm-mask')!
  const confirmCancel = shadow.getElementById('confirm-cancel')!
  const confirmOk = shadow.getElementById('confirm-ok')!
  const navItems = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.nav-item'))
  const pages = Array.from(shadow.querySelectorAll<HTMLElement>('.page'))
  // 卡片默认 overflow:hidden（为了裁圆角），而悬停提示要能从卡片边界探出去。
  // 这里按「有没有感叹号」统一打标（见 panel.css 的 .setting-block.is-tip），
  // 省得每个拼 HTML 的地方各自记一遍。
  for (const dot of Array.from(shadow.querySelectorAll('.hint-dot')))
    dot.closest('.setting-block')?.classList.add('is-tip')
  const inputs = shadow.querySelectorAll<HTMLInputElement>('input[data-key]')

  // ===== 快捷功能 · 功能轮盘 =====
  const wheelKeyBtn = shadow.getElementById('wheel-key') as HTMLButtonElement
  const wheelEditBtn = shadow.getElementById('wheel-edit') as HTMLButtonElement
  const panelKeyBtn = shadow.getElementById('panel-key') as HTMLButtonElement
  // 页面快捷键（1.2.3）：快速刷新 / 快速回到顶部 各一颗胶囊
  const refreshKeyBtn = shadow.getElementById('refresh-key') as HTMLButtonElement
  const backtopKeyBtn = shadow.getElementById('backtop-key') as HTMLButtonElement

  /**
   * 「快捷功能」里的四颗按键胶囊：轮盘呼出键 / 面板呼出键 / 刷新 / 回到顶部。
   *
   * 四颗胶囊的行为完全同构 —— 点一下进入绑定态、再按任意键写入、Esc 取消，同一时刻
   * 只有一颗在等按键。所以这里用一张表驱动，而不是四组 `listeningXxx` 布尔：后者每加
   * 一颗就要在绑定处理、syncUI、卸载清理里各补一处，漏一处就是「按了键没反应」或者
   * 「绑定态永远退不出去」。
   */
  type KeyTarget = 'wheel' | 'panel' | 'refresh' | 'backtop'
  const KEY_TARGETS: KeyTarget[] = ['wheel', 'panel', 'refresh', 'backtop']
  // 允许为 null：卡片是跟着 FEATURES 渲染的，哪天把某一项删掉，对应胶囊就不在 DOM 里 ——
  // 那不该让整个面板初始化崩掉（后面的开关接线全都等着这段跑完）。
  const KEY_CAPS: Record<KeyTarget, HTMLButtonElement | null> = {
    wheel: wheelKeyBtn,
    panel: panelKeyBtn,
    refresh: refreshKeyBtn,
    backtop: backtopKeyBtn,
  }
  const KEY_SOURCES: Record<KeyTarget, { get: () => string, set: (code: string) => void }> = {
    wheel: { get: () => getWheelConfig().key, set: setWheelKey },
    panel: { get: () => getPanelHotkey(), set: setPanelHotkey },
    refresh: { get: () => getQuickKeys().refresh, set: code => setQuickKey('refresh', code) },
    backtop: { get: () => getQuickKeys().backtop, set: code => setQuickKey('backtop', code) },
  }

  /** 面板里正在等一次按键的那颗胶囊（null = 没有在等） */
  let listening: KeyTarget | null = null

  /** 把四颗胶囊的文字 / 绑定态刷成当前配置（正在等按键的那颗显示「请按键…」） */
  function paintKeyCaps() {
    for (const t of KEY_TARGETS) {
      const btn = KEY_CAPS[t]
      if (!btn) continue
      const on = listening === t
      btn.classList.toggle('is-listening', on)
      btn.textContent = on ? '请按键…' : keyLabel(KEY_SOURCES[t].get())
    }
  }

  /**
   * 进入 / 退出绑定态，传 null = 全部退出。
   *
   * `setWheelKeyCapturing()` 是给轮盘看的全局标志：轮盘挂在 window 捕获，比这里的
   * document 捕获更早拿到按键，只能靠标志主动让路（见 quickWheel.ts 的 onKeyDown 第一行）。
   * 只要有一颗胶囊在等按键就要置位，全部退出才放下。
   */
  function setListening(target: KeyTarget | null) {
    listening = target
    setWheelKeyCapturing(target !== null)
    paintKeyCaps()
  }

  /**
   * 给某个动作换键。撞上别的动作时两边**互换**：四颗键设成同一个的话，排在前面的那个
   * 会永远先吃掉按键，另一颗等于失效 —— 换开之后两边都还能用，不会出现「设完没反应」。
   */
  function assignKey(target: KeyTarget, code: string) {
    const prev = KEY_SOURCES[target].get()
    if (code === prev) return
    for (const t of KEY_TARGETS) {
      if (t !== target && KEY_SOURCES[t].get() === code) KEY_SOURCES[t].set(prev)
    }
    KEY_SOURCES[target].set(code)
  }
  const wheelEditor = shadow.getElementById('wheel-editor') as HTMLElement
  const weClose = shadow.getElementById('we-close') as HTMLButtonElement
  const weWheel = shadow.getElementById('we-wheel') as HTMLElement
  const weWedges = shadow.querySelector<SVGGElement>('#we-wedges')!


  const weChips = shadow.getElementById('we-chips') as HTMLElement
  const weName = shadow.getElementById('we-center-name') as HTMLElement
  const weDesc = shadow.getElementById('we-center-desc') as HTMLElement
  const weGrid = shadow.getElementById('we-grid') as HTMLElement
  const weCount = shadow.getElementById('we-count') as HTMLElement
  const weHint = shadow.getElementById('we-hint') as HTMLElement
  const weRemove = shadow.getElementById('we-remove') as HTMLButtonElement
  const weKey = shadow.getElementById('we-key') as HTMLElement


  // 卡片级联的序号：每页各自从 0 开始，CSS 用 --i × 18ms 做递增延迟。
  // 放在这里算一次，切分类时不用重算（每页的卡片数是固定的）。
  for (const page of pages) {
    Array.from(page.querySelectorAll<HTMLElement>('.setting-block'))
      .forEach((el, i) => el.style.setProperty('--i', String(i)))
  }

  /**
   * 就地编辑数值。
   *
   * 点一下灰字 / 胶囊，就地换成一个数字输入框；回车或失焦提交，Esc 放弃。
   * 输入框是胶囊的**兄弟节点**而不是子节点：`<button>` 里塞 `<input>` 属于
   * 「交互元素嵌套」，点进去定位光标时点击会被按钮吃掉。
   */
  let editing: { el: HTMLElement, finish: (apply: boolean) => void } | null = null

  function startValueEdit(opts: {
    el: HTMLElement
    value: number
    min: number
    max: number
    step: number
    commit: (v: number) => void
    restore: () => void
  }) {
    if (editing) return
    const { el, value, min, max, step, commit, restore } = opts
    const input = document.createElement('input')
    input.type = 'number'
    input.className = 'val-input'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    // 就地编辑：**胶囊自己**变成输入框（见 panel.css 的 .range-val.is-editing）——
    // 底色从浅蓝转白、补一圈蓝描边、文字淡出；输入框是透明底、无描边，只负责把文字
    // 错开淡进来。两层几何完全重合，所以没有任何位移，也不会看到两个盒子交叉淡入。
    // 宽度取胶囊的**布局**宽度（offsetWidth）—— 不能用 getBoundingClientRect，
    // 那个值会被面板的 scale(var(--z)) 一起放大，写进 style.width 就会宽出 z 倍，
    // 输入框往左探出一截（默认 130% 缩放下差 14px，非常明显）。
    const w = el.offsetWidth
    if (w) input.style.width = `${w}px`
    input.classList.add('is-entering')
    el.classList.add('is-editing')
    el.insertAdjacentElement('afterend', input)
    // 双 rAF：先让浏览器把初始态（透明 + 略大）画出来，下一帧再切到终态才会有过渡
    requestAnimationFrame(() => requestAnimationFrame(() => input.classList.remove('is-entering')))

    const finish = (apply: boolean) => {
      if (!editing) return
      editing = null
      const v = Number.parseFloat(input.value)
      // 反向再交叉一次：输入框先淡出，胶囊晚 60ms 再把文字淡回来 ——
      // 两段文字错开，不会在同一帧叠成两层；淡完再把节点摘掉
      input.classList.add('is-leaving')
      window.setTimeout(() => {
        // 60ms 内可能已经在**另一个**胶囊上开了新编辑，那就别去动它的类；
        // 只清自己这一颗（否则旧胶囊会一直停在白底 + 透明文字的编辑态）
        if (editing?.el !== el) el.classList.remove('is-editing')
      }, 60)
      window.setTimeout(() => input.remove(), 180)
      if (apply && Number.isFinite(v)) {
        commit(v)
        return
      }
      restore()
    }
    editing = { el, finish }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      }
      else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true))
    input.focus()
    // 全选会在第一帧就画出蓝底高亮，跟淡入打架。等淡入过半再选；
    // 这期间用户要是已经开始敲字，就不选了（否则会把刚敲进去的字全选掉）。
    const initialValue = input.value
    window.setTimeout(() => {
      if (editing && input.isConnected && input.value === initialValue)
        input.select()
    }, 120)
  }

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
    const url = chromeGetURL('assets/panel-mascot.png')
    if (url) btn.style.setProperty('--bili-mascot-img', `url("${url}")`)
  }

  function updateRangeFill(input: HTMLInputElement) {
    const min = Number.parseFloat(input.min)
    const max = Number.parseFloat(input.max)
    const val = Number.parseFloat(input.value)
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0
    // 蓝色填充由 .range-wrap 绘制，变量需要写到它的父级。
    // 填充宽度是「比例 × (轨道宽 - 滑块) + 滑块 + 留边」，百分比当不了乘数，
    // 所以给的是 0~1 的无单位比例
    input.parentElement?.style.setProperty('--pf', `${pct / 100}`)
  }

  /**
   * 开关切换时让拇指鼓一下（动画在 panel.css 的 switch-toggle-pop）。
   *
   * 为什么用 JS 挂类名而不是纯 CSS：`:checked` 只能覆盖「打开」那一次，关掉时那条规则
   * 直接被移除、等于没有动画；类名两个方向都播。
   * 重播靠「先摘类 → 强制一次样式计算 → 再挂回去」—— 少了中间那步，连点第二下时类名
   * 一直在，动画不会重新开始（看上去就是「只有第一下有效」）。
   *
   * 摘类交给 pointerleave（接线见下面 inputs.forEach），不用定时器：点击时鼠标必然停在
   * 开关上，动画播完就把类摘掉的话，悬停动画会因为「重新命中」而从头再播一遍 ——
   * 观感是连弹两下。等指针离开再摘，两条动画各自只播一次。
   */
  function popThumb(input: HTMLInputElement) {
    const sw = input.closest<HTMLElement>('.switch')
    if (!sw) return
    sw.classList.remove('is-toggle')
    void sw.offsetWidth
    sw.classList.add('is-toggle')
  }

  const cleanups: Array<() => void> = [offLayer, offRipple]
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
      syncPreview(g, params)
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

    // 数值胶囊：点一下就地编辑。所属开关关掉时那一行是 disabled 状态，不允许改。
    for (const el of Array.from(shadow.querySelectorAll<HTMLElement>(`[data-${g.kind}-val]`))) {
      const key = el.dataset[`${g.kind}Val`] as string
      const onValClick = (e: Event) => {
        e.stopPropagation()
        const def = g.defs.find(d => d.key === key)
        if (!def) return
        if (el.closest('.item-range')?.classList.contains('is-disabled')) return
        // 胶囊上显示的可能不是原始值（如「偏暗 6」），edit 负责两边换算，
        // 保证「点开看到的数字」=「胶囊上那个数字」
        const ed = def.edit
        startValueEdit({
          el,
          value: ed ? ed.to(g.get()[key]) : g.get()[key],
          min: ed ? ed.to(def.min) : def.min,
          max: ed ? ed.to(def.max) : def.max,
          step: def.step,
          commit: v => g.set(key, ed ? ed.from(v) : v),
          // Esc / 非法输入：重新渲染一遍，把胶囊上的文字恢复回来
          restore: () => syncUI(),
        })
      }
      el.addEventListener('click', onValClick)
      cleanups.push(() => el.removeEventListener('click', onValClick))
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

  /** 依附于父项的开关（顶栏渐变 ← 顶栏材质）：父项关掉时整行变灰、不可点 */
  function applyToggleDeps(cfg: Record<string, boolean>) {
    for (const el of Array.from(shadow.querySelectorAll<HTMLElement>('.item[data-under]'))) {
      const on = !!cfg[el.dataset.under as string]
      el.classList.toggle('is-disabled', !on)
      const box = el.querySelector<HTMLInputElement>('input')
      if (box) box.disabled = !on
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
    applyToggleDeps(cfg)
    applyPanelGlass()
    applyMascotButton()
    // 快捷功能：按键胶囊的文字 + 编辑器的配色。编辑器是 .panel 的兄弟节点，
    // 拿不到 .panel.is-night / .is-glass，所以这两个类得自己切一份
    paintKeyCaps()
    wheelEditor.classList.toggle('is-night', !!cfg.nightMode)
    wheelEditor.classList.toggle('is-glass', !!cfg.panelGlass)
    if (wheelEditor.classList.contains('show')) renderEditor()

    // 「动效增强」里的开关只切面板自己的类名，样式全在 panel.css：
    //   is-night      夜间模式配色（个性设置）
    //   is-cascade    卡片级联（动效增强）
    panel.classList.toggle('is-night', !!cfg.nightMode)
    panel.classList.toggle('is-cascade', !!cfg.panelCascade)
    // 夜间模式 / 设置变化后，节点测速卡也要跟着换配色与状态
    paintCdnCard()
  }

  /* ===== 功能增强 → 节点测速 ===== */

  /**
   * 这张卡只读写 localStorage，不碰网络：
   *   · 测速本身在页面世界（guard.js）跑 —— CDN 是跨域、`__playinfo__` 也在那边；
   *   · 这里点「开始测速」只是派一个 DOM 事件过去，然后轮询它写回来的状态。
   *
   * 三种状态要分清（用户最容易在这里困惑）：
   *   1. 测出来了，但还没指定 → 显示分数，标签写「自动」；
   *   2. 手动指定了，但页面还没重载 → guard.js 没跑过，`applied` 还是旧的；
   *   3. 指定了且 `applied.host` 对得上 → 才是真的「已生效」。
   */
  const cdnTestBtn = shadow.querySelector<HTMLButtonElement>('#cdn-test')
  const cdnListEl = shadow.querySelector<HTMLElement>('#cdn-list')
  const cdnNoteEl = shadow.querySelector<HTMLElement>('#cdn-note')
  const cdnNowEl = shadow.querySelector<HTMLElement>('#cdn-now')

  /** 测速期间每隔 400ms 重画一次，直到 guard.js 写回 done/failed 或超时 */
  let cdnTimer = 0
  let cdnDeadline = 0

  function stopCdnPoll() {
    if (cdnTimer) {
      clearInterval(cdnTimer)
      cdnTimer = 0
    }
  }

  /** 测速期间每隔 400ms 重画一次。节点多、节点慢的时候一次能跑十几秒，
   *  所以只要 guard.js 还在刷新 state 就不断往后推截止时间，别半路把「测速中…」停掉。 */
  function startCdnPoll(ms: number) {
    cdnDeadline = Date.now() + ms
    stopCdnPoll()
    cdnTimer = window.setInterval(() => {
      const st = readCdnState()
      if (st && st.state === 'running' && Date.now() - st.ts < 25000)
        cdnDeadline = Math.max(cdnDeadline, Date.now() + 25000)

      // 先收定时器再画：非播放页的「测速中…」就是靠 cdnTimer 判断的，反了会一直停在测速中
      const done = (!!st && st.state !== 'running') || Date.now() > cdnDeadline
      if (done)
        stopCdnPoll()
      paintCdnCard()
    }, 400)
    // 先挂上定时器再画：非播放页的「测速中…」状态就是靠 cdnTimer 判断的（见 paintCdnCard）
    paintCdnCard()
  }

  /** 测速进度文案：「2/3 · mirrorhwb」—— 只给一根进度条的话看不出卡在哪一步 */
  function probeProgressText(state: CdnState | null) {
    if (!state || state.state !== 'running')
      return ''
    const total = state.total || state.n || 0
    const host = state.host ? `（${shortHost(state.host)}）` : ''
    return `测速中：${Math.min((state.done || 0) + 1, total)}/${total}${host}`
  }

  function paintCdnCard() {
    if (!cdnListEl || !cdnNoteEl || !cdnTestBtn)
      return

    // 和 guard.js 的 TTL 一致：超过 30 分钟的分数不再当「本页测过」用（数值会过期）
    const scoresRaw = readCdnScores()
    const scores = scoresRaw && Date.now() - scoresRaw.ts < 30 * 60 * 1000 ? scoresRaw : null
    const applied = readCdnApplied()
    const pick = getCdnPick()
    const state = readCdnState()
    // 不在播放页：测速一律停用 —— 首页上残留的 `__playinfo__` 是旧视频的
    const playPage = isCdnPlayPage()
    const running = playPage
      ? !!state && state.state === 'running' && Date.now() - state.ts < 90000
      : !!cdnTimer
    // `applied` 是上一页写下的，换个页面就过期了 —— 只有 pathname 对得上才算「这一页的」
    const samePage = !!applied && applied.page === location.pathname

    if (cdnNowEl)
      cdnNowEl.textContent = playPage && samePage ? shortHost(applied!.host) : ''

    cdnTestBtn.disabled = running || !playPage
    cdnTestBtn.textContent = running ? '测速中…' : '开始测速'

    // 不在播放页：列表里一个节点都不画。有些页面（动态详情、活动页）也能内嵌播放器，
    // sessionStorage 里会留下「这一页」的 hosts/applied —— 不截住就会冒出一排无关节点。
    if (!playPage) {
      cdnListEl.innerHTML = ''
      cdnNoteEl.textContent = '当前不是播放页 —— 打开视频后才能测速、切节点'
      return
    }

    // 列表 = **当前这个视频的全部节点**。用户要求「当前节点必须在这个列表里」，
    // 所以三个来源取**并集**，少一个就会漏：
    //   1. guard.js 从 playurl 响应截下来的节点地址（站内切视频后只有它知道新视频有哪些节点）
    //   2. 这一页刚测过的分数
    //   3. 实际在用的那个节点 —— P2P 主机（`*.mcdn.bilivideo.cn` 之类）不一定在 dash
    //      列表里，但播放器真的在用，漏掉它就会出现「当前节点不在列表里」
    const hostsInfo = readCdnHosts()
    const curHosts = hostsInfo && hostsInfo.page === location.pathname ? Object.keys(hostsInfo.urls) : []
    const scoresHere = !!scores && scores.page === location.pathname
    const scoreMap: Record<string, number> = scoresHere ? scores!.hosts : {}

    const allHosts = new Set<string>()
    for (const h of curHosts) allHosts.add(h)
    for (const h of Object.keys(scoreMap)) allHosts.add(h)
    if (samePage && applied && applied.host) allHosts.add(applied.host)

    const pairs: Array<[string, number | null]> = []
    for (const h of allHosts)
      pairs.push([h, typeof scoreMap[h] === 'number' ? scoreMap[h] : null])
    pairs.sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9))

    if (!pairs.length) {
      cdnListEl.innerHTML = `<div class="cdn-empty">${running ? '正在测速…' : '还没测过，点右上角「开始测速」'}</div>`
    }
    else {
      const rows: string[] = []
      // 选过节点才给「恢复默认」这一行 —— 没选时它点了也没意义
      if (pick)
        rows.push(`<button class="cdn-row is-auto" type="button" data-host=""><span class="cdn-host">B 站默认节点</span><span class="cdn-ms"></span><span class="cdn-tag">恢复默认</span></button>`)
      for (const [host, ms] of pairs) {
        const picked = host === pick
        const live = samePage && !!applied && applied.host === host
        rows.push(`<button class="cdn-row${picked ? ' is-picked' : ''}${live ? ' is-live' : ''}" type="button" data-host="${host}">
          <span class="cdn-host">${shortHost(host)}</span>
          <span class="cdn-ms">${ms == null ? '—' : `${Math.round(ms)}ms`}</span>
          <span class="cdn-tag">${live ? '生效中' : picked ? '手动' : ''}</span>
        </button>`)
      }
      cdnListEl.innerHTML = rows.join('')
    }

    // 状态字：把「有没有真的生效」说清楚（走到这里一定在播放页）
    const bits: string[] = []
    if (pick && samePage && applied) {
      if (applied.host === pick)
        bits.push(`已切到 ${shortHost(pick)}（只对这个视频生效）`)
      else
        bits.push(`这个视频没有 ${shortHost(pick)} 节点，仍用 ${shortHost(applied.host)}`)
    }
    else if (samePage && applied) {
      bits.push(`B 站默认：${shortHost(applied.host)}`)
    }
    else {
      bits.push('播放器开始取分片后才会显示当前节点')
    }
    const prog = running ? probeProgressText(state) : ''
    if (prog)
      bits.push(prog)
    else if (scores) {
      const min = Math.round((Date.now() - scores.ts) / 60000)
      bits.push(min < 1 ? '刚测过' : `${min} 分钟前测的`)
    }
    if (state && state.state === 'no-stream')
      bits.push('还没有可用的播放地址：先让视频播一下再测')
    else if (state && state.state === 'one-host')
      bits.push('这条流没有可测的 CDN 节点')
    else if (state && state.state === 'failed')
      bits.push('这次一个节点都没测通')
    cdnNoteEl.textContent = bits.join(' · ')
  }

  const onCdnTest = () => {
    if (!isCdnPlayPage())
      return
    requestCdnProbe()
    startCdnPoll(15000)
  }

  /** 点一行 = 把这一页后续的分片切到那个节点（`data-host` 为空 = 恢复 B 站默认）。
   *  **不刷新页面**：guard.js 挂在请求那一层，点完下一段就换过去了；刷新反而把这次
   *  播放打断，还会让用户以为「点了没反应」。 */
  const onCdnPick = (e: Event) => {
    const row = (e.target as Element | null)?.closest('.cdn-row') as HTMLElement | null
    if (!row)
      return
    const host = row.dataset.host || ''
    if (host === getCdnPick())
      return
    setCdnPick(host)
    paintCdnCard()
  }

  // guard.js 记完「当前节点」会派这个 DOM 事件：站内切视频不重载页面，
  // 面板要是开着，不重画就一直是上一个视频的节点
  document.addEventListener(CDN_APPLIED_EVENT, paintCdnCard)

  cdnTestBtn?.addEventListener('click', onCdnTest)
  cdnListEl?.addEventListener('click', onCdnPick)
  cleanups.push(() => {
    stopCdnPoll()
    document.removeEventListener(CDN_APPLIED_EVENT, paintCdnCard)
    cdnTestBtn?.removeEventListener('click', onCdnTest)
    cdnListEl?.removeEventListener('click', onCdnPick)
  })
  paintCdnCard()

  // 「设置面板缩放」：不属于任何功能开关，单独渲染与接线
  const scaleInput = shadow.querySelector<HTMLInputElement>('input[data-scale]')!
  const scaleValEl = shadow.querySelector<HTMLElement>('[data-scale-val]')

  function syncScale() {
    const v = getPanelScale().scale
    scaleInput.value = String(v)
    updateRangeFill(scaleInput)
    if (scaleValEl) scaleValEl.textContent = SCALE_DEF.fmt(v)
  }

  // 缩放值同样可以点着改
  if (scaleValEl) {
    const onScaleValClick = (e: Event) => {
      e.stopPropagation()
      startValueEdit({
        el: scaleValEl,
        value: getPanelScale().scale,
        min: SCALE_DEF.min,
        max: SCALE_DEF.max,
        step: SCALE_DEF.step,
        commit: v => setPanelScale('scale', v),
        restore: () => syncScale(),
      })
    }
    scaleValEl.addEventListener('click', onScaleValClick)
    cleanups.push(() => scaleValEl.removeEventListener('click', onScaleValClick))
  }

  const onScaleInput = () => setPanelScale('scale', Number.parseFloat(scaleInput.value))
  scaleInput.addEventListener('input', onScaleInput)
  cleanups.push(() => scaleInput.removeEventListener('input', onScaleInput))
  cleanups.push(onPanelScaleChange(() => {
    applyPanelScale()
    syncScale()
  }))

  // 「图片查看器」的两个参数：同样不属于任何开关，单独渲染与接线
  const viewerInputs = Array.from(shadow.querySelectorAll<HTMLInputElement>('input[data-viewer]'))
  const syncViewer = () => {
    const p = getViewerParams()
    for (const input of viewerInputs) {
      const key = input.getAttribute('data-viewer') as ViewerParamKey | null
      if (!key)
        continue
      input.value = String(p[key])
      updateRangeFill(input)
      const valEl = shadow.querySelector<HTMLElement>(`[data-viewer-val="${key}"]`)
      const def = VIEWER_PARAM_DEFS.find(d => d.key === key)
      if (valEl && def)
        valEl.textContent = def.fmt(p[key])
    }
  }

  for (const input of viewerInputs) {
    const key = input.getAttribute('data-viewer') as ViewerParamKey | null
    const def = key ? VIEWER_PARAM_DEFS.find(d => d.key === key) : null
    if (!key || !def)
      continue

    const onViewerInput = () => setViewerParam(key, Number.parseFloat(input.value))
    input.addEventListener('input', onViewerInput)
    cleanups.push(() => input.removeEventListener('input', onViewerInput))

    const valEl = shadow.querySelector<HTMLElement>(`[data-viewer-val="${key}"]`)
    if (valEl) {
      const onViewerValClick = (e: Event) => {
        e.stopPropagation()
        startValueEdit({
          el: valEl,
          value: getViewerParams()[key],
          min: def.min,
          max: def.max,
          step: def.step,
          commit: v => setViewerParam(key, v),
          restore: () => syncViewer(),
        })
      }
      valEl.addEventListener('click', onViewerValClick)
      cleanups.push(() => valEl.removeEventListener('click', onViewerValClick))
    }
  }
  cleanups.push(onViewerParamsChange(() => syncViewer()))
  syncViewer()

  /* ===== 快捷功能 · 功能轮盘 =====
     编辑器是「左侧圆盘预览 + 右侧功能格」。**两侧的选中态完全独立**（用户明确要求：
     点左边某一格时右边不该跟着亮）：左边选的是「位置」，右边选的是「功能」。
     两边都选中时，哪边后点就用「那个功能」填「那个位置」；只选一边时，另一边只是选中。

     几何计算与页面上的轮盘共用 quickWheelLayout.ts，所以预览和实际看到的完全一致。 */

  /** 左侧选中的槽位（-1 = 没选） */
  let selSlot = -1
  /** 右侧选中的功能 id（null = 没选）—— 与左侧互不影响 */
  let selEntry: string | null = null

  function entryOf(id: string | null | undefined) {
    if (!id) return null
    return WHEEL_ENTRIES.find(e => e.id === id) ?? null
  }

  function clearEditorSel() {
    selSlot = -1
    selEntry = null
  }

  /**
   * 把某个功能放到某个槽位。
   * - 它已经在别的槽：两边**交换**（功能池是固定的，不能凭空丢一个）
   * - 它还没装：直接覆盖那一格，格里原来那个被卸下
   */
  function placeEntry(id: string, slot: number) {
    const slots = getWheelSlots()
    const from = slots.indexOf(id)
    if (from === slot) return
    if (from >= 0) slots[from] = slots[slot]
    slots[slot] = id
    setWheelSlots(slots)
  }

  /** 按当前配置重画圆盘预览与右侧功能格 */
  function renderEditor() {
    const { key } = getWheelConfig()
    const slots = getWheelSlots()
    const used = slots.filter(Boolean).length
    weKey.textContent = keyLabel(key)
    weCount.textContent = `${used} / ${WHEEL_SLOTS}`

    // 八片花瓣永远都在（空槽也画），高亮只落在选中的那个槽上；花瓣之间靠角缝隙分开
    weWedges.innerHTML = Array.from({ length: WHEEL_SLOTS }, (_, i) =>
      `<path class="we-wedge${i === selSlot ? ' is-on' : ''}" data-i="${i}" d="${sectorPath(i)}"></path>`).join('')


    weChips.innerHTML = slots.map((id, i) => {
      const e = entryOf(id)
      const { x, y } = chipOffset(i)
      const pos = `--x:${x.toFixed(2)}%;--y:${y.toFixed(2)}%`
      const cls = `we-chip${i === selSlot ? ' is-on' : ''}${e ? '' : ' is-empty'}`
      const title = e ? e.label : `第 ${i + 1} 格（空）`
      const icon = e
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e.icon}</svg>`
        : ''
      // 空槽只画虚线圈、不写名字；有功能的下面带一行名字，与实际轮盘一致
      const label = e ? `<span class="we-chip-label">${e.label}</span>` : ''
      return `<button class="${cls}" type="button" data-i="${i}" title="${title}" style="${pos}"><span class="we-chip-icon">${icon}</span>${label}</button>`

    }).join('')

    const slotEntry = entryOf(slots[selSlot])
    if (slotEntry) {
      weName.textContent = slotEntry.label
      weDesc.textContent = slotEntry.desc
    }
    else if (selSlot >= 0) {
      weName.textContent = '空位置'
      weDesc.textContent = '点右侧功能装入'
    }
    else {
      weName.textContent = '功能轮盘'
      weDesc.textContent = '点圆盘选中位置'
    }

    // 右侧：已装入的显示序号徽章；「选中」只看 selEntry，不跟左侧联动
    weGrid.innerHTML = WHEEL_ENTRIES.map((e) => {
      const idx = slots.indexOf(e.id)
      const on = selEntry === e.id
      return `<button class="we-tile${idx >= 0 ? ' is-used' : ''}${on ? ' is-on' : ''}" type="button" data-id="${e.id}">
          <span class="we-tile-num${idx >= 0 ? '' : ' is-empty'}">${idx >= 0 ? idx + 1 : ''}</span>
          <span class="we-tile-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e.icon}</svg></span>
          <span class="we-tile-label">${e.label}</span>
        </button>`
    }).join('')

    // 卸下：只有「左侧选中了一个装着东西的槽」时才可用（禁用时是灰的）
    weRemove.disabled = !(selSlot >= 0 && !!slots[selSlot])
    weHint.textContent = selEntry
      ? '再点一个圆盘位置，就把它换过去'
      : selSlot >= 0
        ? '点右侧功能替换这一格，或点「卸下」清空'
        : '点圆盘选中位置，再点右侧功能装入'
  }

  function setEditorOpen(open: boolean) {
    if (open) {
      clearEditorSel()
      renderEditor()
    }
    wheelEditor.classList.toggle('show', open)
  }


  /**
   * 点胶囊：进入 / 退出绑定态。四颗共用一套处理 —— 点另一颗时 setListening 会顺手
   * 把上一颗的绑定态收掉（同一时刻只有一颗在等按键）。
   */
  const onKeyCapClick = (target: KeyTarget) => (e: Event) => {
    e.stopPropagation()
    setListening(listening === target ? null : target)
  }

  const keyCapHandlers = KEY_TARGETS.map(target => ({ target, fn: onKeyCapClick(target) }))
  for (const { target, fn } of keyCapHandlers)
    KEY_CAPS[target]?.addEventListener('click', fn)
  cleanups.push(() => {
    for (const { target, fn } of keyCapHandlers)
      KEY_CAPS[target]?.removeEventListener('click', fn)
  })

  /** 输入框里打字时不能抢键（评论区 / 搜索框 / 面板里的数值输入框都算） */
  function isEditableTarget(target: EventTarget | null) {
    const el = target as HTMLElement | null
    if (!el) return false
    if (el.isContentEditable) return true
    return /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
  }

  /** 这一次按键是不是「开关设置面板」的那一下 */
  function isPanelHotkey(e: KeyboardEvent) {
    if (!get('panelHotkey')) return false
    if (e.code !== getPanelHotkey()) return false
    // 带修饰键的组合留给浏览器 / B 站自己（Ctrl+` 之类）
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
    return !isEditableTarget(e.target)
  }

  /**
   * 绑定态下吃掉这次按键，顺带管着「设置面板呼出键」的日常开关：两条逻辑都要看当前
   * 焦点和按键，放一起少挂一个监听 —— 反正面板一开就要挂到页面卸载。
   *
   * **注意它挂在 document 捕获阶段，比轮盘那个 window 捕获的监听更晚**：绑定态的屏蔽
   * 不能指望这里的先后顺序，得靠 `setWheelKeyCapturing()` 那个标志让轮盘主动让路
   * （见 quickWheelConfig.ts 与 quickWheel.ts 的 onKeyDown 第一行）。
   */
  const onWheelKeyDown = (e: KeyboardEvent) => {
    // 兜底：绑定态只在面板开着时成立。万一还有别的路径把它留下来（关面板时漏清），
    // 就地复位 —— 否则这一次按键会被当成「正在绑定」吃掉，轮盘也会一直不接管。
    if (listening && !panel.classList.contains('show'))
      setListening(null)
    // ① 有胶囊正在等绑定：这一下只用来记键，别的判定全让开
    if (listening) {
      e.preventDefault()
      e.stopPropagation()
      // Esc 取消；只按修饰键不算数（继续等真正的那个键）
      if (e.code === 'Escape') {
        setListening(null)
        return
      }
      if (isModifierCode(e.code)) return
      assignKey(listening, e.code)
      setListening(null)
      return
    }
    // 编辑器开着时 Esc 关编辑器（面板本身不吃 Esc）
    if (e.key === 'Escape' && wheelEditor.classList.contains('show')) {
      e.stopPropagation()
      setEditorOpen(false)
      return
    }
    // ② 日常使用：按一下开、再按一下关
    if (isPanelHotkey(e)) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(!panel.classList.contains('show'))
    }
  }
  const onWheelEditClick = (e: Event) => {
    e.stopPropagation()
    setEditorOpen(true)
  }
  const onWeCloseClick = (e: Event) => {
    e.stopPropagation()
    setEditorOpen(false)
  }
  // 编辑器是 .panel 的兄弟节点（面板 overflow:hidden 会把它裁掉），所以它这里的点击
  // 一律拦住：冒泡到 document 会触发「点面板外面就关面板」，编辑到一半整块面板没了
  const onWeEditorClick = (e: Event) => {
    e.stopPropagation()
    if (e.target === wheelEditor) setEditorOpen(false)
  }
  // 左侧：点圆盘上的某一格
  const onWeWheelClick = (e: Event) => {
    e.stopPropagation()
    const el = (e.target as Element | null)?.closest('[data-i]') as HTMLElement | null
    if (!el) return
    const i = Number(el.dataset.i)
    // 右侧先选中了某个功能：这一下就是「把它换到这一格」，两边都回到未选中
    if (selEntry) {
      placeEntry(selEntry, i)
      clearEditorSel()
      renderEditor()
      return
    }
    // 否则只是选中这个位置（再点一次取消，方便「我不想改了」）
    selSlot = selSlot === i ? -1 : i
    renderEditor()
  }

  // 右侧：点功能格
  const onWeGridClick = (e: Event) => {
    e.stopPropagation()
    const btn = (e.target as Element | null)?.closest('.we-tile') as HTMLElement | null
    if (!btn) return
    const id = btn.dataset.id as string
    // 左侧先选中了某个位置：这一下就是「用这个功能替换那一格」，两边都回到未选中
    if (selSlot >= 0) {
      placeEntry(id, selSlot)
      clearEditorSel()
      renderEditor()
      return
    }
    // 否则只是选中这个功能（再点一次取消）
    selEntry = selEntry === id ? null : id
    renderEditor()
  }

  const onWeRemoveClick = (e: Event) => {
    e.stopPropagation()
    const slots = getWheelSlots()
    if (selSlot < 0 || !slots[selSlot]) return
    slots[selSlot] = null
    setWheelSlots(slots)
    // 卸下之后这一格不再被选中（用户明确要求）
    clearEditorSel()
    renderEditor()
  }


  wheelEditBtn.addEventListener('click', onWheelEditClick)
  weClose.addEventListener('click', onWeCloseClick)
  wheelEditor.addEventListener('click', onWeEditorClick)
  weWheel.addEventListener('click', onWeWheelClick)
  weGrid.addEventListener('click', onWeGridClick)
  weRemove.addEventListener('click', onWeRemoveClick)
  document.addEventListener('keydown', onWheelKeyDown, true)
  cleanups.push(() => {
    wheelEditBtn.removeEventListener('click', onWheelEditClick)
    weClose.removeEventListener('click', onWeCloseClick)
    wheelEditor.removeEventListener('click', onWeEditorClick)
    weWheel.removeEventListener('click', onWeWheelClick)
    weGrid.removeEventListener('click', onWeGridClick)
    weRemove.removeEventListener('click', onWeRemoveClick)
    document.removeEventListener('keydown', onWheelKeyDown, true)
    // 卸载时别把「正在绑定按键」的全局标志留着
    setListening(null)
  })
  // 轮盘配置在别处变了（另一个标签页 / 恢复默认）：把按键胶囊和编辑器同步过来
  cleanups.push(onWheelConfigChange(() => {
    paintKeyCaps()
    if (wheelEditor.classList.contains('show')) renderEditor()
  }))
  // 面板呼出键在别处变了（另一个标签页 / 恢复默认）：胶囊文字跟上
  cleanups.push(onPanelHotkeyChange(() => paintKeyCaps()))
  // 页面快捷键（刷新 / 回到顶部）同理
  cleanups.push(onQuickKeysChange(() => paintKeyCaps()))

  applyPanelParams()
  applyPanelScale()
  syncScale()
  syncUI()


  inputs.forEach((input) => {
    const handler = () => {
      const key = input.dataset.key as FeatureKey
      // 夜间模式走专用的 setNightMode()（1.2.4 v001）：直接 persist 只是把页面颜色
      // 瞬间换掉，没有整页过渡。圆心取开关本身的位置 —— 用户在面板里点，动画就该
      // 从面板里那颗开关开始铺开，而不是屏幕中央。
      if (key === 'nightMode') {
        const box = (input.closest<HTMLElement>('.switch') ?? input).getBoundingClientRect()
        setNightMode(input.checked, { x: box.left + box.width / 2, y: box.top + box.height / 2 })
      }
      else {
        persist({ [key]: input.checked } as any)
      }
      popThumb(input)
    }
    input.addEventListener('change', handler)
    cleanups.push(() => input.removeEventListener('change', handler))

    // 指针离开开关时摘掉「正在切换」的类（理由见 popThumb 的注释）
    const sw = input.closest<HTMLElement>('.switch')
    if (sw) {
      const onLeave = () => sw.classList.remove('is-toggle')
      sw.addEventListener('pointerleave', onLeave)
      cleanups.push(() => sw.removeEventListener('pointerleave', onLeave))
    }
  })

  cleanups.push(onConfigChange(() => syncUI()))

  /* ===== 设置管理：恢复默认设置 ===== */

  /**
   * 把「默认设置」整体写回去：
   * - 功能开关：persist(DEFAULT_CONFIG) 一次写全量 key（含 chrome.storage.sync 同步）
   * - 数值参数：各 store.reset() 回 defs 里的 default，并写回各自的存储 key
   * - 最后重新应用 CSS 变量与面板 UI，保证滑块 / 开关 / 数值立刻对齐
   *
   * **节点测速的数据不在重置范围内**：那是当前这一页的临时状态（sessionStorage），
   * 不属于「设置」。这里只碰各 `*Config` 注册的配置键，
   * 别在下面加 `localStorage.clear()` / `sessionStorage.clear()` 之类的调用。
   */
  function restoreDefaults() {
    persist({ ...DEFAULT_CONFIG })
    resetGlassParams()
    resetTopbarParams()
    resetSearchBoxParams()
    resetSearchPanelParams()
    resetHomePanelParams()
    resetPanelParams()
    resetPreloadParams()
    resetHomeCardParams()
    resetSearchCardParams()
    resetRailCardParams()
    resetPanelScale()
    resetViewerParams()
    resetWheelGlassParams()
    applyWheelGlassVars()
    resetWheelConfig()
    resetPanelHotkey()
    resetQuickKeys()

    // 四颗按键胶囊在绑定态下会停在「请按键…」，恢复默认要把它们都收回来
    setListening(null)
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
    // 关面板时把还没提交的数值输入收掉（相当于失焦提交），别让编辑框挂在隐藏的 DOM 里
    if (!open && editing) editing.finish(true)
    if (open) {
      // 面板样式第一次打开才注入，必须赶在挂 .show 之前（同步生效，不会闪）
      ensurePanelCss()
      panelBody.scrollTop = 0
      // 每次打开都重画一次「当前节点」：它读的是这一页 guard.js 写下的记录，
      // 面板开着不动的时候换了视频（站内路由）就还是旧值
      paintCdnCard()
    }
    else {
      setConfirmOpen(false)
      // 轮盘编辑器与「正在绑定按键」的状态也一起收掉，别留在隐藏的 DOM 里。
      // **一颗都不能漏**：漏掉任何一颗时 `listening` 会一直挂着，于是
      // setWheelKeyCapturing 永远置位（轮盘呼出键全站失效），而且下一次任意按键
      // 都会被当成「正在绑定」吃掉、静默改写成那颗胶囊的键。
      setEditorOpen(false)
      setListening(null)
    }

    panel.classList.toggle('show', open)
    overlay.classList.toggle('show', open)
    // 面板开着时暂停收纳：⚙ 滑走了、面板还杵在屏幕上会很怪
    setFloatDockPaused(open)
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
    offDock()
    host.remove()
    document.documentElement.style.removeProperty('--bili-panel-blur')
    document.documentElement.style.removeProperty('--bili-panel-tint')
    document.documentElement.style.removeProperty('--bili-panel-scale')
    ;(window as any).__biliEliteSettingsInjected__ = false
  }
}

import { bootstrapConfig } from './config'
import { setupAdBlock } from './modules/adBlock'
import { setupCardWholeClick } from './modules/cardWholeClick'
import { setupCommentPreload } from './modules/commentPreload'
import { injectDesignTokens } from './modules/designTokens'
import { setupDynamicOverlay } from './modules/dynamicOverlay'
import { setupFloatingButtons } from './modules/floatingButtons'
import { bootstrapGlassConfig } from './modules/glassConfig'
import { bootstrapHomeCardConfig } from './modules/homeCardConfig'
import { bootstrapHomePanelConfig } from './modules/homePanelConfig'
import { setupHoverPrefetch } from './modules/hoverPrefetch'
import { setupImageGlass } from './modules/imageGlass'
import { setupImageViewer } from './modules/imageViewer'
import { setupImageStyle } from './modules/imageStyle'
import { setupImageTools } from './modules/imageTools'
import { setupLabFeatures } from './modules/labFeatures'
import { bootstrapPanelConfig } from './modules/panelConfig'
import { bootstrapPanelHotkeyConfig } from './modules/panelHotkeyConfig'
import { bootstrapPanelScaleConfig } from './modules/panelScaleConfig'
import { bootstrapPreloadConfig } from './modules/preloadConfig'
import { setupQuickKeys } from './modules/quickKeys'
import { bootstrapQuickKeysConfig } from './modules/quickKeysConfig'
import { setupQuickWheel } from './modules/quickWheel'
import { bootstrapWheelConfig } from './modules/quickWheelConfig'
import { bootstrapWheelGlassConfig } from './modules/wheelGlassConfig'
import { setupReturnRestore } from './modules/returnRestore'


import { startStorageSync } from './storage'

import { bootstrapRailCardConfig } from './modules/railCardConfig'
import { bootstrapSearchCardConfig } from './modules/searchCardConfig'
import { bootstrapSearchConfig } from './modules/searchConfig'
import { setupSearchPanelOpt } from './modules/searchPanelOpt'
import { setupSearchTabs } from './modules/searchTabs'
import { setupSpaceOptimize } from './modules/spaceOptimize'
import { setupSelfTopbar } from './modules/selfTopbar'
import { setupSettingsPanel } from './modules/settingsPanel'
import { bootstrapTopbarConfig } from './modules/topbarConfig'
import { setupTopbarOptimize } from './modules/topbarOptimize'
import { setupVideoBeta } from './modules/videoBeta'
import { setupVideoFullscreen } from './modules/videoFullscreen'

/**
 * 这一帧是不是**我们自己**嵌的视频页（动态页「动态悬浮打开beta」里的视频悬浮窗）。
 *
 * 视频页在 `www.bilibili.com`，动态页在 `t.bilibili.com` —— **跨源**，父页面读不到
 * iframe 的文档，所以「去掉右栏推荐、按我们版本排」只能由 iframe 里的自己来做。
 * 标记走 URL 上的 `blie_embed=1`：B 站会忽略未知参数，比 `window.name`（可能被页面改写）
 * 和 `document.referrer`（沙箱里可能为空）都可靠。
 */
function isEmbeddedVideoFrame() {
  if (window.top === window.self) return false
  if (location.hostname !== 'www.bilibili.com') return false
  if (!location.pathname.startsWith('/video/')) return false
  return new URLSearchParams(location.search).has('blie_embed')
}

const IS_TOP = window.top === window.self
const IS_EMBED = isEmbeddedVideoFrame()

// 嵌进来的视频页：只做「按我们版本排版 + 藏掉右栏推荐」，其余模块一个都不装 ——
// 顶栏、浮钮、设置面板、轮盘出现在 iframe 里既没用又挡内容。
if (IS_EMBED) {
  injectDesignTokens()
  bootstrapConfig()
  startStorageSync()
  // force = true：悬浮窗本身就是「要用我们这套播放页」的表达，不再看 videoBeta 开关
  setupVideoBeta(true)
}

// B 站自己的其它 iframe（广告 / 登录框 / 播放器）：一个模块都不装
if (IS_TOP) {
  // 设计 token（动效三档 / 圆角三档）与「减少动态效果」降级规则最先注入：
  // 后面所有样式表都从这几个变量取值，晚一步就会先按「无过渡」渲染一帧
  injectDesignTokens()

  // 广告卡屏蔽（默认生效、设置面板里没有开关）：规则只是一段 CSS，尽早注入 ——
  // 播放页右栏那条「运营推荐」卡是水合之后才渲染的，样式先就位就不会先闪一下再消失
  setupAdBlock()

  // 「当前标签页打开」之后按后退回来：还原离开时的滚动位置。必须赶在浏览器自己恢复
  // 滚动之前设好 scrollRestoration，晚一步它已经把页面拽回顶部了（见 returnRestore.ts）
  setupReturnRestore()

  bootstrapConfig()
  bootstrapGlassConfig()
  bootstrapHomeCardConfig()
  // 搜索页的卡片大小：与首页分开存，但同样在首屏就写进 --bili-search-card，
  // 免得搜索结果先按 B 站原版栅格排一帧再跳
  bootstrapSearchCardConfig()
  // 播放页右栏推荐卡封面大小：倍率写进 --bili-vb-cover-scale，默认 1 = 原大小
  bootstrapRailCardConfig()
  bootstrapHomePanelConfig()
  bootstrapTopbarConfig()
  bootstrapPanelConfig()
  bootstrapPanelScaleConfig()
  // 「快速使用设置面板」的呼出键：与开关（bili-elite-settings）分开存
  bootstrapPanelHotkeyConfig()
  bootstrapPreloadConfig()
  bootstrapSearchConfig()
  // 功能轮盘的配置（呼出按键 + 轮盘项目）存在自己的 key 里，与开关分开加载
  bootstrapWheelConfig()
  // 「页面快捷键」（快速刷新 / 快速回到顶部）各自绑的键，同样单独一份
  bootstrapQuickKeysConfig()
  // 「轮盘背景」材质的模糊 / 遮罩：写进 :root 的 CSS 变量，Shadow DOM 里的圆盘才取得到
  bootstrapWheelGlassConfig()

  // 上面每个 bootstrap 只是「登记 key + 怎么应用」，真正的读取在这里一次性发起：
  // 一次 get(null) 把整包读回来、只挂一个 onChanged，再按 key 分发给各 store
  // （以前是 15 次 storage.sync.get + 15 个监听）。**必须在所有 bootstrap 之后调用。**
  startStorageSync()

  // 顶栏优化必须在 document_start 立即注入：否则 B 站自身顶栏会先渲染一帧，
  // 造成「旧顶栏残留 / 闪烁」。样式本身按需生效（无 .bili-header 时不匹配）。
  setupTopbarOptimize()

  // 搜索页分类标签栏的滑动指示条：样式在 searchOptimize.css 里跟着「搜索页优化」开关，
  // 这里只负责把指示条挂到选中项下并跟着切（非搜索页直接返回，零开销）
  setupSearchTabs()

  // 空间页优化（界面优化）：导航 tab 与排序按钮的样式要在 B 站 mount 之前就位，
  // 否则会先看到原版的品牌蓝胶囊再跳一下（只在 space.bilibili.com 生效）
  setupSpaceOptimize()

  // 「顶栏优化」：整条顶栏由我们自己画，document_start 就有，不再等 B 站的 header 脚本。
  // 放在 setupTopbarOptimize 之后 —— 它复用 topbar.css 里的频道面板 / 材质 / 夜间样式，
  // 而且要靠顶栏模块先把 <html> 上的根类和 CSS 变量写好
  setupSelfTopbar()

  // 播放页优化（界面优化）：样式与布局变量要赶在播放器渲染出来之前就位，
  // 晚一步会先看到 B 站那套「居中 + 大留白」再跳一下
  setupVideoBeta()

  // 搜索面板优化：根类尽早挂上，避免用户刚聚焦搜索框时看到一帧未改版的默认面板
  setupSearchPanelOpt()

  // 页面级样式（夜间模式）同样要早注入：
  // 夜间模式晚一步挂类，用户就会先看到一帧亮色顶栏
  setupLabFeatures()
}

/**
 * 首屏不需要的模块：等浏览器空闲再装。
 *
 * 用 requestIdleCallback 而不是 setTimeout —— 它只在这一帧真的没事干时才跑，不会和
 * B 站自己的首屏渲染抢主线程。带 timeout 兜底：页面一直忙也不会漏装（最多晚 1s，
 * 这期间只是「图片开合没有 FLIP 动画」「浮动键还没出来」，站点本身的功能不受影响）。
 */
function runWhenIdle(fn: () => void) {
  if (typeof window.requestIdleCallback === 'function')
    window.requestIdleCallback(fn, { timeout: 1000 })
  else
    window.setTimeout(fn, 200)
}

function initModules() {
  // 设置键 ⚙ 必须马上有：它是整个扩展唯一的入口
  setupSettingsPanel()
  // 悬停预取：首页卡片 / 播放页右栏推荐，指针停住 80ms 就把目标页文档预取下来。
  // 实测能把「点进去」的 TTFB 从 ~380ms 压到 1ms、FCP 从 ~800ms 压到 ~370ms
  // （原理见 hoverPrefetch.ts 的注释）。它只挂一个 pointerover 委托，越早越好。
  setupHoverPrefetch()
  // 「卡片整体化」：一个 document 级的点击委托，让整张卡片都能点（见 cardWholeClick.ts）。
  // 和上面的预取一样，只挂一个监听，越早越好 —— 首屏的卡片一出来就要能整卡点
  setupCardWholeClick()
  // 「动态悬浮打开beta」：同样是一个 document 级捕获监听。开关打开、且当前在动态流
  // （t.bilibili.com，不含 /{id} 详情页）时才会接管点击（见 dynamicOverlay.ts）
  setupDynamicOverlay()
  // 功能轮盘只挂一个键盘监听（DOM 等到第一次呼出才建），放这里而不是空闲队列 ——
  // 否则页面刚打开的头一秒里按呼出键会没反应
  setupQuickWheel()
  // 页面快捷键（X 刷新 / Z 回到顶部）同样只挂一个 document 捕获监听。**必须排在
  // setupSettingsPanel 之后**：设置面板的「绑定按键」要先把这一下吃掉，我们靠
  // `e.defaultPrevented` 让路（见 quickKeys.ts）
  setupQuickKeys()

  // 全屏动画挂在播放器的 pointerdown 上，晚装会漏掉最开始那几次点击
  setupVideoFullscreen()
  // 评论预加载：视频起播之后把评论区「透明地挪进视口」一次，让它自己把第一页取回来
  // （原理与时机见 commentPreload.ts）。只在播放页生效，其它页面 setup 里第一行就返回
  setupCommentPreload()
  // 图片开合的「关闭」样式只是一段 CSS，注入很便宜，顺手做掉
  setupImageStyle()
  // 看图器底部工具栏（缩小 / 放大 / 左右旋转 / 复位）。只挂一个 body 的 childList
  // 观察器等 `.pswp` 出现，同样很便宜，跟着上面一起装
  setupImageTools()

  runWhenIdle(() => {
    setupImageViewer()
    setupImageGlass()
    // 浮动键挂在设置键上方，两者互不依赖；放到空闲时只是让 ⚙ 先就位
    setupFloatingButtons()
  })
}

if (IS_TOP) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModules, { once: true })
  }
  else {
    initModules()
  }
}

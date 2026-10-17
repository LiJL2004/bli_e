import './styles.css'
import { bootstrapConfig } from './config'
import { bootstrapGlassConfig } from './modules/glassConfig'
import { setupImageGlass } from './modules/imageGlass'
import { setupImageViewer } from './modules/imageViewer'
import { setupImageStyle } from './modules/imageStyle'
import { bootstrapPanelConfig } from './modules/panelConfig'
import { bootstrapPanelScaleConfig } from './modules/panelScaleConfig'
import { bootstrapPreloadConfig } from './modules/preloadConfig'
import { bootstrapSearchConfig } from './modules/searchConfig'
import { setupSearchPanelOpt } from './modules/searchPanelOpt'
import { setupSettingsPanel } from './modules/settingsPanel'
import { bootstrapTopbarConfig } from './modules/topbarConfig'
import { setupTopbarOptimize } from './modules/topbarOptimize'
import { setupVideoFullscreen } from './modules/videoFullscreen'

bootstrapConfig()
bootstrapGlassConfig()
bootstrapTopbarConfig()
bootstrapPanelConfig()
bootstrapPanelScaleConfig()
bootstrapPreloadConfig()
bootstrapSearchConfig()

// 顶栏优化必须在 document_start 立即注入：否则 B 站自身顶栏会先渲染一帧，
// 造成「旧顶栏残留 / 闪烁」。样式本身按需生效（无 .bili-header 时不匹配）。
setupTopbarOptimize()

// 搜索面板优化：根类尽早挂上，避免用户刚聚焦搜索框时看到一帧未改版的默认面板
setupSearchPanelOpt()

function initModules() {
  setupVideoFullscreen()
  setupImageViewer()
  setupImageStyle()
  setupImageGlass()
  setupSettingsPanel()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initModules, { once: true })
}
else {
  initModules()
}

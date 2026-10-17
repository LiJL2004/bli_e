export interface FeatureDef {
  key: string
  label: string
  default: boolean
  group: string
  /** 为 true 时，在它之前断开「无滑块的合并卡片」，让它另起一张卡（见 settingsPanel.ts） */
  cardBreak?: boolean
}

export const FEATURES = [
  // 这里的 default 就是「默认设置」：首次安装、以及设置面板里点「恢复默认设置」后落到这套值。
  // 注意 fullscreenAnim 默认关闭，其余开关默认开启。
  { key: 'fullscreenAnim', label: '全屏关闭动画', default: false, group: '动效增强' },
  { key: 'webscreenAnim', label: '网页全屏动画', default: true, group: '动效增强' },
  { key: 'imageAnim', label: '评论区图片动画', default: true, group: '动效增强' },
  { key: 'imageGlass', label: '评论区图片背景', default: true, group: '高级材质' },
  { key: 'topbarGlass', label: '顶栏材质', default: true, group: '高级材质' },
  { key: 'searchBoxGlass', label: '搜索框材质', default: true, group: '高级材质' },
  { key: 'searchPanelGlass', label: '搜索面板材质', default: true, group: '高级材质' },
  { key: 'panelGlass', label: '设置面板材质', default: true, group: '高级材质' },
  { key: 'homeOptimize', label: '首页优化', default: true, group: '界面优化' },
  { key: 'searchPanelOpt', label: '搜索面板优化', default: true, group: '界面优化' },
  // 下面六个是「卡片边界 / 卡片确认」——三个页面 × 两个效果，各自独立控制。
  // 2026-10-17 第二次拆分：之前是「卡片边界」「卡片确认」两个全局开关 + 两个「同步」开关，
  // 现在每页各一对，某个页面觉得挤 / 觉得吵可以只关它那一项。
  // cardBreak 让这六项从「首页优化 / 搜索面板优化」那张卡里断开、另起一张。
  { key: 'cardBorderHome', label: '首页卡片边界', default: true, group: '界面优化', cardBreak: true },
  { key: 'cardConfirmHome', label: '首页卡片确认', default: true, group: '界面优化' },
  { key: 'cardBorderSearch', label: '搜索页卡片边界', default: true, group: '界面优化' },
  { key: 'cardConfirmSearch', label: '搜索页卡片确认', default: true, group: '界面优化' },
  { key: 'cardBorderVideo', label: '视频页卡片边界', default: true, group: '界面优化' },
  { key: 'cardConfirmVideo', label: '视频页卡片确认', default: true, group: '界面优化' },
  { key: 'preload', label: '首页预加载', default: true, group: '界面优化' },
  // 两条「布局优化」：B 站会在播放页右栏、页面顶部留出占位块，这里按需收起，让版面更紧凑。
  // cardBreak 让这两项从上面的卡片断开、另起一张。
  { key: 'railCompact', label: '播放页右栏留白收起', default: true, group: '界面优化', cardBreak: true },
  { key: 'noticeCompact', label: '顶部提示条收起', default: true, group: '界面优化' },
] as const satisfies readonly FeatureDef[]

export type FeatureKey = typeof FEATURES[number]['key']
export type FeatureConfig = Record<FeatureKey, boolean>

export const DEFAULT_CONFIG: FeatureConfig = Object.fromEntries(
  FEATURES.map(f => [f.key, f.default]),
) as FeatureConfig

export const STORAGE_KEY = 'bili-elite-settings'

export function groupFeatures() {
  const groups: Record<string, any[]> = {}
  for (const f of FEATURES) {
    ;(groups[f.group] ||= []).push(f)
  }
  return groups
}

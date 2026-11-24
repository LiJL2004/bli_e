import { get } from '../config'
import { scrollToTop, refreshPage } from './pageActions'
import { isPlayerFullscreen } from './playerMode'
import { getQuickKeys } from './quickKeysConfig'
import { isWheelKeyCapturing } from './quickWheelConfig'

/**
 * 页面快捷键：按一下 X 刷新、按一下 Z 回到顶部（键可改，见 quickKeysConfig.ts）。
 *
 * 为什么挂在 document 捕获阶段：B 站不少页面自己也在 document / window 上听键盘
 * （播放器快捷键、搜索框快捷键、轮播图的左右键），捕获阶段能赶在它们之前拿到这一下；
 * 而且只有 `preventDefault` 之后才真的「吃掉」按键，没命中的键原样往下走。
 *
 * 让路规则（少一条就会变成「莫名其妙帮我刷新了」）：
 * 1. **带修饰键的一律不接** —— Ctrl+X 是剪切、Ctrl+Z 是撤销、Shift+X 是大写字母，
 *    这些组合必须原样交给页面 / 浏览器。
 * 2. **输入框里打字不接** —— 评论框、搜索框、动态发布框里打 x / z 是打字，不是快捷键。
 * 3. **播放器网页全屏 / 全屏、轮盘按住、设置面板打开时不接** —— 这三种场景键盘归它们。
 *    尤其是「设置面板里正在绑定按键」：那一下必须被面板吃掉，否则用户按 X 绑键的瞬间
 *    页面先刷了。
 *
 * 也不接管 `e.defaultPrevented` 的按键：排在我们前面的监听器（轮盘的呼出键、面板的
 * 呼出键）已经处理过这一下，再执行一次就是双重动作。
 */

/** 输入框 / 可编辑区域里打字时不能抢键 */
function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  return /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/** 设置面板开着时不接管：面板里的按钮、输入框、按键绑定都要能正常用键盘 */
function settingsPanelOpen() {
  const host = document.getElementById('bili-elite-settings-host')
  return !!host?.shadowRoot?.querySelector('.panel.show')
}

/**
 * 功能轮盘正开着（按住呼出键）时不接管：这时候用户是在选格子，随手按到 X / Z
 * 不该把页面刷掉或者滚走。轮盘是按住不放的交互，误触概率并不低。
 */
function wheelOpen() {
  const host = document.getElementById('bili-elite-wheel-host')
  return !!host?.shadowRoot?.querySelector('.stage.show')
}

export function setupQuickKeys(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // 已经有人处理过这一下（轮盘 / 面板的呼出键）：别再执行第二个动作
    if (e.defaultPrevented) return
    // Ctrl+X / Ctrl+Z / Shift+X … 原样交给页面与浏览器
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    // 面板里正在「按一个键来绑定」：这一下归绑定用
    if (isWheelKeyCapturing()) return
    if (settingsPanelOpen()) return
    if (wheelOpen()) return
    // 全屏 / 网页全屏时播放器独占键盘（宽屏不算：它只是把播放器拉宽，页面还能滚）
    if (isPlayerFullscreen()) return
    if (isEditableTarget(e.target)) return

    const keys = getQuickKeys()

    if (get('quickRefresh') && e.code === keys.refresh) {
      e.preventDefault()
      refreshPage()
      return
    }

    if (get('quickBackTop') && e.code === keys.backtop) {
      e.preventDefault()
      scrollToTop()
    }
  }

  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}

/**
 * 内容脚本 → 后台的一次性消息名。
 *
 * 只有一条：「帮我在新标签页打开这个地址」。为什么非要绕后台一趟：
 * 内容脚本拿不到 `chrome.tabs`（它不在内容脚本的 API 集合里），而 `window.open`
 * 在「按住呼出键 → 松开」这条路径上并不可靠 —— 松手那一下（keyup）不算浏览器的
 * 激活触发事件，一旦超出 5 秒的 transient activation 窗口就会被弹窗拦截器默默吃掉。
 *
 * 两边引同一个常量，改名字不会只改一半。
 */
export const MSG_OPEN_TAB = 'bili-elite:open-tab'

export interface OpenTabMessage {
  type: typeof MSG_OPEN_TAB
  url: string
}

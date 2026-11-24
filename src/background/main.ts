import type { OpenTabMessage } from '~/shared/messages'
import { onMessage } from 'webext-bridge/background'
import { log } from '~/contentScripts/logger'
import { MSG_OPEN_TAB } from '~/shared/messages'

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  import('./contentScriptHMR')
}

browser.runtime.onInstalled.addListener((): void => {
  log('installed')
})

onMessage('get-current-tab', async () => ({ title: undefined }))

/**
 * 轮盘选中之后「在新标签页打开」：内容脚本拿不到 chrome.tabs（它不在内容脚本的
 * API 集合里），所以建标签页这件事只能转给后台。`active: true` 就是「并前往这个新标签页」。
 *
 * **插在当前标签页右边**（`sender.tab.index + 1`）而不是甩到标签栏末尾：浏览器自己
 * 「点链接 / 从视频页跳走」时就是这个位置，标签栏的顺序才跟用户脑子里的「刚看过什么、
 * 接下来看什么」对得上。拿不到 sender.tab（后台被别的上下文调用）时不传 index，
 * 退回 Chrome 的默认行为（追加到末尾）。
 *
 * 刻意不传 `openerTabId`：它会把新标签页和当前页绑成「打开者 / 被打开者」，在标签分组里
 * 还可能被一起归组 —— 轮盘只是跳转，不是从这一页派生出去的子页面。
 *
 * 为什么不走 webext-bridge：bridge 在后台只挂 runtime.onConnect，两边互不干扰，
 * 为一条单程消息拉一套 port 协议没必要。
 */
browser.runtime.onMessage.addListener((msg: unknown, sender: any, sendResponse: (response?: any) => void) => {
  const m = msg as Partial<OpenTabMessage> | undefined
  if (m?.type !== MSG_OPEN_TAB || typeof m.url !== 'string')
    return
  // 内容脚本发消息时 sender.tab 一定是当前这个标签页；index 是它在标签栏里的位置
  const index = sender?.tab?.index
  browser.tabs.create({
    url: m.url,
    active: true,
    ...(typeof index === 'number' ? { index: index + 1 } : {}),
  }).catch(() => {
    // 建不出来就算了（权限被收紧 / 弹窗被拦）：轮盘那边本来就是「尽力而为」
  })
  // 必须给个回执：不回的话内容脚本那边收到的是「message port closed」的 lastError，
  // 于是又走一遍 window.open 兜底 —— 同一个页面被打开两次。
  sendResponse({ ok: true })
})

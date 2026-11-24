// 验证「扩展重载后」不再往控制台/错误页刷 console.error
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe7.json'
const PORT = 9405 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof7-${Date.now()}`

const chrome = spawn(CHROME, [
  `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--no-first-run',
  '--window-size=1600,1000',
  '--mute-audio',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })
chrome.stderr.on('data', () => {})
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    }
    catch {}
    await sleep(250)
  }
  throw new Error('no cdp')
}
let id = 0
const pending = new Map()
const ws = new WebSocket(await wsUrl())
await new Promise(r => ws.addEventListener('open', r, { once: true }))
const consoleMsgs = []
const exceptions = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    consoleMsgs.push({ type: m.params.type, text: m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 120) })
  }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 120))
})
function send(method, params = {}, sessionId) {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  return new Promise((res, rej) => pending.set(mid, { res, rej }))
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => send(m, p, sessionId)
await S('Page.enable')
await S('Runtime.enable')
async function ev(expression, awaitPromise = false) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await S('Page.navigate', { url: 'https://t.bilibili.com/' })
for (let i = 0; i < 60; i++) {
  if (await ev(`document.querySelectorAll('.bili-dyn-item').length > 0`).catch(() => false)) break
  await sleep(500)
}
await sleep(1500)

// 打开设置面板（右下角 ⚙ 在浮钮的 shadow 里，取最后一个 .fab）
// 浮钮里的「夜间模式」键：点它 → setNightMode → persist → syncSet（会走 chromeApi）
const fabInfo = await ev(`
(() => {
  const host = document.getElementById('bili-elite-float-host')
  if (!host || !host.shadowRoot) return { err: 'no-float-host' }
  const fabs = [...host.shadowRoot.querySelectorAll('.fab')]
  return { n: fabs.length, labels: fabs.map(f => f.title || f.getAttribute('aria-label') || f.className) }
})()
`)
console.log('浮钮:', JSON.stringify(fabInfo))

async function toggle() {
  return ev(`
(() => {
  const host = document.getElementById('bili-elite-float-host')
  const fabs = [...host.shadowRoot.querySelectorAll('.fab')]
  const night = fabs.find(f => /夜间/.test(f.title || f.getAttribute('aria-label') || '')) || fabs[fabs.length - 1]
  if (!night) return 'no-fab'
  night.click()
  return 'clicked:' + (night.title || night.className)
})()
`)
}

consoleMsgs.length = 0
console.log('重载前点夜间键:', await toggle())
await sleep(500)
const before = consoleMsgs.slice()
console.log('重载前 console:', JSON.stringify(before))

// 模拟「扩展被重新加载 / 自动更新」：在 SW 里 reload，页面不刷新
const { targetInfos } = await send('Target.getTargets')
const sw = targetInfos.find(t => t.type === 'service_worker' && /chrome-extension/.test(t.url))
if (sw) {
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
  await send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' }, sid).catch(() => {})
  console.log('已触发 runtime.reload')
}
else { console.log('没找到 SW') }
await sleep(2500)

consoleMsgs.length = 0
exceptions.length = 0
console.log('重载后点夜间键:', await toggle())
await sleep(600)
console.log('重载后 console:', JSON.stringify(consoleMsgs))
console.log('重载后异常:', JSON.stringify(exceptions))

fs.writeFileSync(OUT, JSON.stringify({ fabInfo, before, after: consoleMsgs, exceptions }, null, 2))
chrome.kill()
process.exit(0)

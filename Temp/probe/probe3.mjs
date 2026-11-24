// 验证：能不能在 t.bilibili.com 里用 iframe 嵌 www.bilibili.com/video/xxx
// 用法：node probe3.mjs <extDir> <outJson>
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe3.json'
const PORT = 9357 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof3-${Date.now()}`

const chrome = spawn(CHROME, [
  `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1600,1000',
  '--lang=zh-CN',
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
  throw new Error('CDP 没起来')
}

let id = 0
const pending = new Map()
const ws = new WebSocket(await wsUrl())
await new Promise(r => ws.addEventListener('open', r, { once: true }))
const net = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
  if (m.method === 'Network.responseReceived' && /\/video\/BV/.test(m.params.response.url)) {
    const h = m.params.response.headers
    net.push({ url: m.params.response.url.slice(0, 90), status: m.params.response.status, xfo: h['x-frame-options'] || h['X-Frame-Options'] || '', csp: (h['content-security-policy'] || h['Content-Security-Policy'] || '').slice(0, 300) })
  }
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
await S('Network.enable')

async function ev(expression, awaitPromise = false) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

await S('Page.navigate', { url: 'https://t.bilibili.com/' })
let ready = false
for (let i = 0; i < 60; i++) {
  ready = await ev(`document.querySelectorAll('.bili-dyn-item').length > 0`).catch(() => false)
  if (ready) break
  await sleep(500)
}
console.log('动态页:', ready, await ev(`document.querySelectorAll('.bili-dyn-item').length`))

// 找视频卡里的链接（动态里的 ugc 视频卡）
const href = (await ev(`
(() => {
  const cands = [...document.querySelectorAll('.bili-dyn-item a[href*="/video/BV"]')].map(a => a.href)
  return cands[0] || ''
})()
`)) || 'https://www.bilibili.com/video/BV1GJ411x7h7'
console.log('视频链接:', href)
if (!href) {
  fs.writeFileSync(OUT, JSON.stringify({ ready, href, net, note: '没找到视频卡' }, null, 2))
  chrome.kill()
  process.exit(0)
}

// 建 iframe 嵌入（不 await load：视频页可能反嵌跳出，会把顶层 target 导航走）
const res = await ev(`
(() => {
  const old = document.getElementById('probe-frame')
  if (old) old.remove()
  window.__frameState = 'created'
  const f = document.createElement('iframe')
  f.id = 'probe-frame'
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation')
  f.src = ${JSON.stringify(href)}
  f.style.cssText = 'position:fixed;left:40px;top:40px;width:1180px;height:820px;z-index:2147483647;border:4px solid red;background:#fff'
  document.documentElement.appendChild(f)
  window.__frameT0 = Date.now()
  f.addEventListener('load', () => {
    window.__frameState = 'loaded@' + (Date.now() - window.__frameT0)
  })
  return 'ok'
})()
`)
console.log('iframe 创建:', JSON.stringify(res))

await sleep(7000)
console.log('顶层地址:', await ev(`location.href`).catch(e => 'EVAL-FAIL: ' + e.message))
console.log('frame 状态:', await ev(`window.__frameState`).catch(e => 'EVAL-FAIL: ' + e.message))
const shot = await S('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('C:/Users/86157/bli-build-tmp/shot-video-iframe.png', Buffer.from(shot.data, 'base64'))

// iframe 里有没有我们的内容脚本（看 html 上的 root 类）
const inner = await ev(`
(() => {
  const f = document.getElementById('probe-frame')
  if (!f) return 'no-frame'
  try {
    const d = f.contentDocument
    return d ? { title: d.title, html: d.documentElement.className, hasMirror: !!d.getElementById('mirror-vdcon') } : 'null-doc'
  }
  catch (e) { return 'cross-origin:' + e.message }
})()
`)
console.log('iframe 内部:', JSON.stringify(inner))
fs.writeFileSync(OUT, JSON.stringify({ ready, href, res, inner, net }, null, 2))
console.log('网络头:', JSON.stringify(net.slice(0, 3)))
chrome.kill()
process.exit(0)

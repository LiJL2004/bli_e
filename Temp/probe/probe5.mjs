// 读动态流卡片里图片的真实尺寸 / src（判断能不能用卡片图预判窗口宽度）
import { spawn } from 'node:child_process'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const PORT = 9381
const PROFILE = `C:/Users/86157/bli-build-tmp/prof5-${Date.now()}`
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
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
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
async function ev(expression) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
await S('Page.navigate', { url: 'https://t.bilibili.com/' })
for (let i = 0; i < 60; i++) {
  if (await ev(`document.querySelectorAll('.bili-dyn-item').length > 0`).catch(() => false)) break
  await sleep(500)
}
await sleep(1500)
const info = await ev(`
(() => {
  const out = []
  document.querySelectorAll('.bili-dyn-item').forEach((it, i) => {
    const imgs = [...it.querySelectorAll('.dyn-card-opus__pics img, .bili-album__preview__picture img')]
    out.push({ i, n: imgs.length, imgs: imgs.slice(0, 3).map(im => ({ src: (im.currentSrc || im.src || '').slice(-52), nat: im.naturalWidth + 'x' + im.naturalHeight, rect: Math.round(im.getBoundingClientRect().width) + 'x' + Math.round(im.getBoundingClientRect().height) })) })
  })
  return out
})()
`)
console.log(JSON.stringify(info, null, 1))
chrome.kill()
process.exit(0)

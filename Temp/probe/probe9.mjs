// ① 关闭动效 ② 非相册图（评论图 / shadow 里的图）也能全屏
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe9.json'
const PORT = 9429 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof9-${Date.now()}`

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
const ctxs = []
const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
  if (m.method === 'Runtime.executionContextCreated' && m.params.context.auxData?.isDefault)
    ctxs.push({ id: m.params.context.id, origin: m.params.context.origin })
  if (m.method === 'Runtime.exceptionThrown')
    logs.push(m.params.exceptionDetails.text)
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
async function enableFlag() {
  for (let i = 0; i < 20; i++) {
    const { targetInfos } = await send('Target.getTargets')
    const sw = targetInfos.find(t => t.type === 'service_worker' && /chrome-extension/.test(t.url))
    if (sw) {
      const { sessionId: sid } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
      const r = await send('Runtime.evaluate', {
        expression: `new Promise((res) => chrome.storage.sync.get(null, (v) => { const s = Object.assign({}, v['bili-elite-settings'] || {}, { dynamicFloatBeta: true }); chrome.storage.sync.set({ 'bili-elite-settings': s }, () => res('ok')) }))`,
        awaitPromise: true, returnByValue: true,
      }, sid)
      await send('Target.detachFromTarget', { sessionId: sid })
      return r.result?.value
    }
    await sleep(300)
  }
  return 'no-sw'
}
console.log('开关:', await enableFlag())
await sleep(1200)
for (let i = 0; i < 60; i++) {
  if (await ev(`document.querySelectorAll('.bili-dyn-item').length > 0`).catch(() => false)) break
  await sleep(500)
}

await ev(`
(() => {
  const items = [...document.querySelectorAll('.bili-dyn-item')].filter(it => it.querySelector('.dyn-card-opus__pics'))
  const it = items[0]
  if (!it) return 'no-item'
  const box = it.querySelector('.dyn-card-opus__summary') || it.querySelector('.bili-dyn-content') || it
  const r = box.getBoundingClientRect()
  for (const fy of [0.6, 0.4]) for (const fx of [0.5, 0.3]) {
    const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
    if (!t || t.closest('a,img,picture,.bili-album,.dyn-card-opus__pics')) continue
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
    return 'ok'
  }
  return 'no-point'
})()
`)
await sleep(4000)

const sameOrigin = ctxs.filter(c => /t\.bilibili\.com/.test(c.origin || ''))
const sub = sameOrigin[sameOrigin.length - 1]

async function clickAtFramePoint(expr) {
  const p = await send('Runtime.evaluate', { contextId: sub.id, returnByValue: true, expression: expr }, sessionId).then(r => r.result?.value)
  if (!p || p.err) return p
  const fr = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const r = sr.querySelector('.dyn-frame').getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
  const cx = Math.round(fr.x + p.x)
  const cy = Math.round(fr.y + p.y)
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
  await sleep(40)
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
  return { cx, cy, ...p }
}

async function shot(name) {
  const r = await S('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`C:/Users/86157/bli-build-tmp/shot-${name}.png`, Buffer.from(r.data, 'base64'))
}

const viewerState = () => ev(`
(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const v = sr.querySelector('.dyn-viewer')
  const im = sr.querySelector('.dyn-viewer__img')
  const r = im.getBoundingClientRect()
  const cs = getComputedStyle(v)
  return { open: v.classList.contains('is-open'), vis: cs.visibility, img: Math.round(r.width) + 'x' + Math.round(r.height) }
})()
`)

// ---- A. 相册图：打开 → 关闭动效 ----
const a = await clickAtFramePoint(`(() => {
  const im = document.querySelector('.blie-split .bili-album__preview__picture.is-active img')
  if (!im) return { err: 'no-img' }
  const r = im.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
console.log('A 点相册图:', JSON.stringify(a))
await sleep(600)
console.log('A 打开后:', JSON.stringify(await viewerState()))

await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; sr.querySelector('.dyn-viewer__close').click(); return 'ok' })()`)
await sleep(120)
const mid = await viewerState()
await shot('g-closing')
await sleep(400)
const after = await viewerState()
console.log('A 关闭中(120ms):', JSON.stringify(mid))
console.log('A 关闭后:', JSON.stringify(after))

// ---- B. 评论区（shadow DOM 里）的图 ----
const inject = await send('Runtime.evaluate', {
  contextId: sub.id,
  returnByValue: true,
  expression: `(() => {
    const host = document.querySelector('bili-comments')
    if (!host) return { err: 'no-bili-comments' }
    const root = host.shadowRoot
    if (!root) return { err: 'closed-shadow' }
    const old = root.getElementById('probe-img-wrap')
    if (old) old.remove()
    const wrap = document.createElement('div')
    wrap.id = 'probe-img-wrap'
    wrap.style.cssText = 'position:fixed;left:40px;top:120px;width:220px;height:220px;z-index:2147483647;background:#000'
    const im = document.createElement('img')
    im.src = document.querySelector('.blie-split .bili-album__preview__picture.is-active img')?.src || ''
    im.style.cssText = 'width:100%;height:100%;object-fit:cover'
    wrap.appendChild(im)
    root.appendChild(wrap)
    const r = im.getBoundingClientRect()
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`,
}, sessionId).then(r => r.result?.value)
console.log('B 注入评论图:', JSON.stringify(inject))

if (inject && inject.ok) {
  const fr = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const r = sr.querySelector('.dyn-frame').getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
  const cx = Math.round(fr.x + inject.x)
  const cy = Math.round(fr.y + inject.y)
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
  await sleep(40)
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
  await sleep(700)
  console.log('B 打开后:', JSON.stringify(await viewerState()))
  await shot('g-shadow')
}

console.log('异常:', logs.slice(0, 4))
fs.writeFileSync(OUT, JSON.stringify({ a, mid, after, inject, logs }, null, 2))
chrome.kill()
process.exit(0)

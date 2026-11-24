// 验证换图时「比例错 / 闪上一张」：切图后每帧对比 rect 比例 vs naturalWidth 比例
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe10.json'
const PORT = 9441 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof10-${Date.now()}`

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
  const all = [...document.querySelectorAll('.bili-dyn-item')].filter(it => it.querySelector('.dyn-card-opus__pics'))
  const multi = all.filter(it => it.querySelectorAll('.dyn-card-opus__pics .bili-album__preview__picture').length > 1)
  const it = (multi.length ? multi : all)[0]
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
const fr = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const r = sr.querySelector('.dyn-frame').getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
const p = await send('Runtime.evaluate', {
  contextId: sub.id, returnByValue: true,
  expression: `(() => {
    const im = document.querySelector('.blie-split .bili-album__preview__picture.is-active img')
    const r = im.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`,
}, sessionId).then(r => r.result?.value)
await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(fr.x + p.x), y: Math.round(fr.y + p.y), button: 'left', clickCount: 1 })
await sleep(40)
await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(fr.x + p.x), y: Math.round(fr.y + p.y), button: 'left', clickCount: 1 })
await sleep(1200)

// 采样器：每帧记 src 末尾 / naturalWidth / rect
await ev(`
(() => {
  window.__frames = []
  window.__mark = (w) => window.__frames.push({ mark: w, t: Math.round(performance.now()) })
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const im = sr.querySelector('.dyn-viewer__img')
  function snap() {
    const r = im.getBoundingClientRect()
    window.__frames.push({
      t: Math.round(performance.now()),
      src: (im.src || '').slice(-30),
      nat: im.naturalWidth + 'x' + im.naturalHeight,
      rect: Math.round(r.width) + 'x' + Math.round(r.height),
      op: +(+getComputedStyle(im).opacity).toFixed(2),
    })
    requestAnimationFrame(snap)
  }
  requestAnimationFrame(snap)
  return 'ok'
})()
`)

async function next(label) {
  await ev(`(() => { window.__mark('${label}'); const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; sr.querySelector('.dyn-viewer__nav.is-next').click(); return 'ok' })()`)
  await sleep(1500)
}
await next('next-1')
await next('next-2')

const frames = await ev(`window.__frames`)
// 找出「rect 比例与 naturalWidth 比例不一致」的帧（容差 3%）
const bad = frames.filter((f) => {
  if (f.mark) return false
  if (!f.nat || f.nat.startsWith('0x')) return false
  // 只统计**可见**帧：opacity 0 时图片根本没显示，尺寸旧也不算观感问题
  if (f.op < 0.5) return false
  const [nw, nh] = f.nat.split('x').map(Number)
  const [rw, rh] = f.rect.split('x').map(Number)
  if (!rw || !rh) return false
  return Math.abs(rw / rh - nw / nh) / (nw / nh) > 0.03
})
console.log('总帧:', frames.length, '不一致帧:', bad.length)
if (bad.length) console.log('不一致样例:', JSON.stringify(bad.slice(0, 5)))
const marks = frames.filter(f => f.mark).map(f => f.mark)
console.log('标记:', JSON.stringify(marks))
// 打印每次切换后前 8 帧
for (const mk of ['next-1', 'next-2']) {
  const i = frames.findIndex(f => f.mark === mk)
  if (i >= 0) console.log(mk, JSON.stringify(frames.slice(i, i + 40).filter((f, k) => k % 2 === 0).map(f => f.mark ? '[' + f.mark + ']' : [f.nat, f.rect, f.op])))
}
console.log('异常:', logs.slice(0, 3))
fs.writeFileSync(OUT, JSON.stringify({ total: frames.length, bad: bad.slice(0, 10), frames: frames.slice(-40) }, null, 2))
chrome.kill()
process.exit(0)

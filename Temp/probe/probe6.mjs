// 测：① 窗口宽度打开即最终值 ② 点图 → 全屏看图器
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe6.json'
const PORT = 9393 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof6-${Date.now()}`

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
const logs = []
const ctxs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown')
    logs.push(`EXC ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`)
  if (m.method === 'Runtime.executionContextCreated' && m.params.context.auxData?.isDefault)
    ctxs.push({ id: m.params.context.id, origin: m.params.context.origin })
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
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
        expression: `new Promise((res) => chrome.storage.sync.get(null, (v) => { const s = Object.assign({}, v['bili-elite-settings'] || {}, { dynamicFloatBeta: true, dynamicFloatVideo: true }); chrome.storage.sync.set({ 'bili-elite-settings': s }, () => res(JSON.stringify(s))) }))`,
        awaitPromise: true,
        returnByValue: true,
      }, sid)
      await send('Target.detachFromTarget', { sessionId: sid })
      return r.result?.value || 'ok'
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

// 采样器：只记 stage 宽度 / viewer 状态
await ev(`
(() => {
  window.__s = []
  window.__m = []
  const t0 = performance.now()
  window.__mark = w => window.__m.push({ t: Math.round(performance.now() - t0), what: w })
  let last = ''
  function snap() {
    const host = document.getElementById('bili-elite-dynamic-host')
    const sr = host && host.shadowRoot
    const stage = sr && sr.querySelector('.dyn-stage')
    const viewer = sr && sr.querySelector('.dyn-viewer')
    const img = sr && sr.querySelector('.dyn-viewer__img')
    const rec = {
      t: Math.round(performance.now() - t0),
      w: stage ? Math.round(stage.getBoundingClientRect().width) : null,
      op: stage ? +(+getComputedStyle(stage).opacity).toFixed(3) : null,
      vOpen: viewer ? viewer.classList.contains('is-open') : false,
      img: img ? (Math.round(img.getBoundingClientRect().width) + 'x' + Math.round(img.getBoundingClientRect().height)) : '',
    }
    const key = JSON.stringify({ ...rec, t: 0 })
    if (key !== last) { last = key; window.__s.push(rec) }
    requestAnimationFrame(snap)
  }
  requestAnimationFrame(snap)
  return true
})()
`)

// 点第一条「带图」的动态正文
const clicked = await ev(`
(() => {
  const SKIP = 'a,button,input,textarea,select,label,video,audio,img,picture,.bili-dyn-avatar,.bili-dyn-title,.bili-dyn-time,.bili-dyn-item__desc,.bili-album,.dyn-card-opus__pics,.bili-video-card,.bili-dyn-card-video'
  // 优先找多图动态（测左右切换），没有再退回单图
  const all = [...document.querySelectorAll('.bili-dyn-item')].filter(it => it.querySelector('.dyn-card-opus__pics'))
  const multi = all.filter(it => it.querySelectorAll('.dyn-card-opus__pics .bili-album__preview__picture').length > 1)
  const items = multi.length ? multi : all
  if (!items.length) return 'no-pic-item'
  const it = items[0]
  const box = it.querySelector('.dyn-card-opus__summary') || it.querySelector('.bili-dyn-content') || it
  const r = box.getBoundingClientRect()
  for (const fy of [0.6, 0.4, 0.8]) {
    for (const fx of [0.5, 0.3]) {
      const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
      if (!t || t.closest(SKIP)) continue
      window.__mark('click-dyn')
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
      return 'ok:' + t.tagName
    }
  }
  return 'no-point'
})()
`)
console.log('点动态:', clicked)
await sleep(3500)

const stage = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const s = sr.querySelector('.dyn-stage'); return { w: Math.round(s.getBoundingClientRect().width), mediaW: document.getElementById('bili-elite-dynamic-host').style.getPropertyValue('--dyn-media-w') } })()`)
console.log('窗口:', JSON.stringify(stage))

// 在 iframe 里点图片
const sameOrigin = ctxs.filter(c => /t\.bilibili\.com/.test(c.origin || ''))
const sub = sameOrigin[sameOrigin.length - 1]
console.log('contexts:', JSON.stringify(ctxs.map(c => [c.id, c.origin])))

// **真实鼠标事件**：合成 MouseEvent('click') 不触发 pointerdown/up，B 站的内联展开
// 正是靠 pointer 事件起来的 —— 那样测会「假通过」。
let picClick = 'no-ctx'
if (sub) {
  const inFrame = await send('Runtime.evaluate', {
    contextId: sub.id,
    returnByValue: true,
    expression: `(() => {
      const im = document.querySelector('.blie-split .bili-album__preview__picture.is-active img') || document.querySelector('.bili-album__preview__picture img')
      if (!im) return { err: 'no-img' }
      const r = im.getBoundingClientRect()
      if (r.width < 10) return { err: 'img-invisible' }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }
    })()`,
  }, sessionId).then(r => r.result?.value)
  const fr = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const r = sr.querySelector('.dyn-frame').getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
  if (inFrame && !inFrame.err) {
    const cx = Math.round(fr.x + inFrame.x)
    const cy = Math.round(fr.y + inFrame.y)
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
    await sleep(40)
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
    picClick = `real-click@${cx},${cy} (img ${inFrame.w}x${inFrame.h})`
  }
  else { picClick = JSON.stringify(inFrame) }
}
console.log('点图:', picClick)
await sleep(700)

const viewer = await ev(`
(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const v = sr.querySelector('.dyn-viewer')
  const img = sr.querySelector('.dyn-viewer__img')
  const bd = sr.querySelector('.dyn-viewer__backdrop')
  const r = img.getBoundingClientRect()
  const bs = getComputedStyle(bd)
  return {
    open: v.classList.contains('is-open'),
    img: Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top),
    src: (img.src || '').slice(-40),
    blur: bs.backdropFilter,
    bg: bs.backgroundColor,
    count: sr.querySelector('.dyn-viewer__count').textContent,
    navShown: getComputedStyle(sr.querySelector('.dyn-viewer__nav.is-next')).display,
  }
})()
`)
console.log('看图器:', JSON.stringify(viewer))

// iframe 里 B 站自己的内联展开态（工具栏那条）有没有被拦住
if (sub) {
  const watch = await send('Runtime.evaluate', {
    contextId: sub.id,
    returnByValue: true,
    expression: `(() => {
      const w = document.querySelector('.bili-album__watch')
      if (!w) return 'no-watch-node'
      const cs = getComputedStyle(w)
      return { display: cs.display, visibility: cs.visibility, hasControl: !!document.querySelector('.bili-album__watch__control') }
    })()`,
  }, sessionId).then(r => r.result?.value)
  console.log('内联展开态:', JSON.stringify(watch))
}

async function shot(name, clip) {
  const p = { format: 'png' }
  if (clip) p.clip = clip
  const r = await S('Page.captureScreenshot', p)
  fs.writeFileSync(`C:/Users/86157/bli-build-tmp/shot-${name}.png`, Buffer.from(r.data, 'base64'))
}
await shot('g-viewer')

// 多图：点下一张
const nextInfo = await ev(`
(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const next = sr.querySelector('.dyn-viewer__nav.is-next')
  if (getComputedStyle(next).display === 'none') return 'single'
  next.click()
  return 'clicked-next'
})()
`)
await sleep(700)
const afterNext = await ev(`
(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const img = sr.querySelector('.dyn-viewer__img')
  const r = img.getBoundingClientRect()
  return { count: sr.querySelector('.dyn-viewer__count').textContent, img: Math.round(r.width) + 'x' + Math.round(r.height), src: (img.src || '').slice(-36) }
})()
`)
console.log('切下一张:', nextInfo, JSON.stringify(afterNext))
await shot('g-viewer-2')

// 关闭看图器，确认悬浮窗还在
await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; sr.querySelector('.dyn-viewer__close').click(); return 'ok' })()`)
await sleep(600)
const afterClose = await ev(`
(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  return {
    viewerOpen: sr.querySelector('.dyn-viewer').classList.contains('is-open'),
    winOpen: sr.querySelector('.dyn-root').classList.contains('is-open'),
    loaded: sr.querySelector('.dyn-body').classList.contains('is-loaded'),
  }
})()
`)
console.log('关图后:', JSON.stringify(afterClose))

const samples = await ev(`window.__s`)
const marks = await ev(`window.__m`)
fs.writeFileSync(OUT, JSON.stringify({ stage, picClick, viewer, afterClose, marks, samples, logs }, null, 2))
console.log('宽度序列:', [...new Set(samples.map(s => s.w))].join(','))
console.log('异常:', logs.slice(0, 5))
chrome.kill()
process.exit(0)

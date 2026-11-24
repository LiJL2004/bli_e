// 极简 CDP 客户端：起 chromium（带扩展）→ 打开动态页 → 采样「打开 / 关闭 / 再打开」全过程。
// 用法：node probe2.mjs <extDir> <outJson>
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe-out.json'
const PORT = 9345 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof-${Date.now()}`

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
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const j = await r.json()
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
const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown')
    logs.push(`EXC ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`)
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
        expression: `new Promise((res) => chrome.storage.sync.get(null, (v) => { const s = Object.assign({}, v['bili-elite-settings'] || {}, { dynamicFloatBeta: true }); chrome.storage.sync.set({ 'bili-elite-settings': s }, () => res(JSON.stringify(s))) }))`,
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

let ready = false
for (let i = 0; i < 60; i++) {
  ready = await ev(`document.querySelectorAll('.bili-dyn-item').length > 0`).catch(() => false)
  if (ready) break
  await sleep(500)
}
console.log('动态条数:', await ev(`document.querySelectorAll('.bili-dyn-item').length`), 'ready=', ready)

// 采样器：每帧记录状态变化 + 宽度 + 标记
await ev(`
(() => {
  window.__samples = []
  window.__marks = []
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)
  window.__mark = (w) => window.__marks.push({ t: now(), what: w })
  let last = ''
  function snap() {
    const host = document.getElementById('bili-elite-dynamic-host')
    const sr = host && host.shadowRoot
    const q = s => sr && sr.querySelector(s)
    const root = q('.dyn-root'); const stage = q('.dyn-stage'); const body = q('.dyn-body')
    const loading = q('.dyn-loading'); const frame = q('.dyn-frame')
    const cs = el => el ? getComputedStyle(el) : null
    let href = ''
    try { href = frame && frame.contentWindow ? frame.contentWindow.location.href : '' } catch { href = 'X' }
    const rec = {
      t: now(),
      open: root ? root.classList.contains('is-open') : false,
      layout: root ? root.dataset.dynLayout || '' : '',
      stageOp: stage ? +(+cs(stage).opacity).toFixed(3) : null,
      stageVis: stage ? cs(stage).visibility : null,
      scale: stage ? (cs(stage).transform === 'none' ? 'none' : cs(stage).transform.split('(')[1].split(',')[0]) : null,
      stageW: stage ? Math.round(stage.getBoundingClientRect().width) : null,
      body: body ? body.className.replace('dyn-body', '').trim() : '',
      loadOp: loading ? +(+cs(loading).opacity).toFixed(3) : null,
      loadVis: loading ? cs(loading).visibility : null,
      frameOp: frame ? +(+cs(frame).opacity).toFixed(3) : null,
      href: href.slice(0, 45),
    }
    const key = JSON.stringify({ ...rec, t: 0 })
    if (key !== last) { last = key; window.__samples.push(rec) }
    requestAnimationFrame(snap)
  }
  requestAnimationFrame(snap)
  return true
})()
`)

async function clickDyn(index) {
  return ev(`
(() => {
  const SKIP = 'a,button,input,textarea,select,label,video,audio,img,picture,.bili-dyn-avatar,.bili-dyn-title,.bili-dyn-time,.bili-dyn-item__desc,.bili-dyn-item__following,.bili-dyn-follow-btn,.bili-dyn-item__footer,.bili-dyn-item__action,.bili-album,.dyn-card-opus__pics,.bili-video-card,.bili-dyn-card-video,.bili-dyn-card-live,.bili-dyn-card-article,.bili-dyn-card-link-common'
  const items = [...document.querySelectorAll('.bili-dyn-item')].filter(it => it.querySelector('.bili-dyn-time'))
  const it = items[${index}]
  if (!it) return 'no-item'
  const box = it.querySelector('.dyn-card-opus__summary') || it.querySelector('.bili-dyn-content') || it
  const r = box.getBoundingClientRect()
  for (const fy of [0.75, 0.6, 0.45, 0.3]) {
    for (const fx of [0.5, 0.3, 0.7]) {
      const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
      if (!t || t.closest(SKIP) || !t.closest('.bili-dyn-item')) continue
      window.__mark && window.__mark('click')
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
      return 'ok:' + t.tagName
    }
  }
  return 'no-point'
})()
`)
}

console.log('第一次点击:', await clickDyn(0))

// 记下 is-loaded 出现的时刻，用来在「揭开」过渡期连拍
console.log('监听:', await ev(`
(() => {
  window.__loadedAt = 0
  const host = document.getElementById('bili-elite-dynamic-host')
  if (!host || !host.shadowRoot) return 'no-host'
  const body = host.shadowRoot.querySelector('.dyn-body')
  new MutationObserver(() => {
    if (!window.__loadedAt && body.classList.contains('is-loaded')) window.__loadedAt = Math.round(performance.now())
  }).observe(body, { attributes: true, attributeFilter: ['class'] })
  return 'ok'
})()
`))

await sleep(350)
async function shot(name) {
  try {
    const r = await S('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`C:/Users/86157/bli-build-tmp/shot-${name}.png`, Buffer.from(r.data, 'base64'))
  }
  catch (e) { console.log('shot fail', name, e.message) }
}
await shot('loading')

// 等 is-loaded，然后立刻连拍（过渡只有 260ms，抓几帧看有没有半透明重影）
for (let i = 0; i < 200; i++) {
  if (await ev(`window.__loadedAt > 0`)) break
  await sleep(25)
}
for (let i = 0; i < 4; i++) {
  await shot(`reveal${i}`)
  await sleep(40)
}
await sleep(1500)
await shot('content')

console.log('关闭:', await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; window.__mark('close'); sr.querySelector('.dyn-close').click(); return 'ok' })()`))
await sleep(120)
await shot('closing')
await sleep(1080)

const state1 = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const f = sr.querySelector('.dyn-frame'); let h=''; try { h = f.contentWindow.location.href } catch {} return { open: sr.querySelector('.dyn-root').classList.contains('is-open'), href: h, loaded: sr.querySelector('.dyn-body').classList.contains('is-loaded') } })()`)
console.log('关闭后:', JSON.stringify(state1))

console.log('第二次点击:', await clickDyn(1))
await sleep(3000)

const state2 = await ev(`(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const f = sr.querySelector('.dyn-frame'); let h=''; try { h = f.contentWindow.location.href } catch {}
  const d = f.contentDocument
  const img = d && d.querySelector('.blie-split .bili-album__preview__picture.is-active img')
  const split = d && d.querySelector('.blie-split')
  const right = d && d.querySelector('.blie-split__right')
  return {
    open: sr.querySelector('.dyn-root').classList.contains('is-open'),
    href: h,
    loaded: sr.querySelector('.dyn-body').classList.contains('is-loaded'),
    mediaW: document.getElementById('bili-elite-dynamic-host').style.getPropertyValue('--dyn-media-w'),
    layout: sr.querySelector('.dyn-root').dataset.dynLayout,
    stageW: Math.round(sr.querySelector('.dyn-stage').getBoundingClientRect().width),
    imgSrc: img ? img.src.slice(-60) : 'none',
    imgNat: img ? img.naturalWidth + 'x' + img.naturalHeight : '',
    splitCls: split ? split.className : '',
    rightW: right ? Math.round(right.getBoundingClientRect().width) : 0,
    rects: (() => {
      const r = el => { const b = el.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.top) }
      const body = sr.querySelector('.dyn-body'); const frame = sr.querySelector('.dyn-frame')
      return { stage: r(sr.querySelector('.dyn-stage')), body: r(body), frame: r(frame), bodyBg: getComputedStyle(body).backgroundColor }
    })(),
    dbg: document.getElementById('bili-elite-dynamic-host').dataset.blieDbg || '',
  }
})()`)
console.log('再次打开后:', JSON.stringify(state2))

const samples = await ev(`window.__samples`)
const marks = await ev(`window.__marks`)
fs.writeFileSync(OUT, JSON.stringify({ samples, marks, logs, state1, state2 }, null, 2))
console.log(`采样 ${samples.length} 条 → ${OUT}`)
console.log('异常:', logs.slice(0, 6))

chrome.kill()
process.exit(0)

// 极简 CDP 客户端：起 chromium（带扩展）→ 打开动态页 → 采样悬浮窗打开时的每帧状态。
// 用法：node probe.mjs <extDir> [outJson]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe-out.json'
const PORT = 9333 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof-${Date.now()}`

const args = [
  `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=CalculateNativeWinOcclusion',
  '--window-size=1600,1000',
  '--lang=zh-CN',
  '--mute-audio',
  'about:blank',
]
const chrome = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] })
chrome.stderr.on('data', d => {
  const s = String(d)
  if (/ERROR|FATAL/.test(s) && !/gpu|GPU|dbus|Vulkan|voice/i.test(s)) process.stderr.write(`[chrome] ${s}`)
})

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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
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

const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    logs.push(m.params.args.map(a => a.value || a.description).join(' '))
  if (m.method === 'Runtime.exceptionThrown')
    logs.push(`EXC ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`)
})

async function ev(expression, awaitPromise = false) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

await S('Page.navigate', { url: 'https://t.bilibili.com/' })

// 打开「动态悬浮打开beta」开关：直接写扩展 storage（整包 bili-elite-settings）
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

await sleep(1000)

// 等动态流
let ready = false
for (let i = 0; i < 60; i++) {
  ready = await ev(`!!document.querySelector('.bili-dyn-item')`).catch(() => false)
  if (ready) break
  await sleep(500)
}
const pageInfo = await ev(`({url: location.href, title: document.title, items: document.querySelectorAll('.bili-dyn-item').length, host: !!document.getElementById('bili-elite-dynamic-host'), html: document.documentElement.className, flag: (() => { try { return !!chrome.runtime.id } catch { return 'no-chrome' } })()})`)
console.log('页面:', JSON.stringify(pageInfo), 'ready=', ready)

if (!ready) {
  fs.writeFileSync(OUT, JSON.stringify({ pageInfo, logs, timeline: [] }, null, 2))
  console.log('动态流没出来，日志:', logs.slice(0, 10))
  chrome.kill()
  process.exit(0)
}

// 采样器：每帧记录悬浮窗各部分的状态变化
await ev(`
(() => {
  window.__samples = []
  const t0 = performance.now()
  const get = (sr, sel) => sr && sr.querySelector(sel)
  let last = ''
  function snap() {
    const host = document.getElementById('bili-elite-dynamic-host')
    const sr = host && host.shadowRoot
    const root = get(sr, '.dyn-root')
    const stage = get(sr, '.dyn-stage')
    const body = get(sr, '.dyn-body')
    const loading = get(sr, '.dyn-loading')
    const frame = get(sr, '.dyn-frame')
    const cs = el => el ? getComputedStyle(el) : null
    let frameHref = ''
    try { frameHref = frame && frame.contentWindow ? frame.contentWindow.location.href : '' } catch { frameHref = 'X' }
    const rec = {
      t: Math.round(performance.now() - t0),
      root: root ? root.className : '',
      stageOp: stage ? +cs(stage).opacity : null,
      stageVis: stage ? cs(stage).visibility : null,
      stageTf: stage ? cs(stage).transform : null,
      bodyCls: body ? body.className : '',
      loadOp: loading ? +cs(loading).opacity : null,
      loadVis: loading ? cs(loading).visibility : null,
      frameOp: frame ? +cs(frame).opacity : null,
      frameHref: frameHref.slice(0, 60),
    }
    const key = JSON.stringify(rec).replace(/"t":\\d+,/, '')
    if (key !== last) { last = key; window.__samples.push(rec) }
    requestAnimationFrame(snap)
  }
  requestAnimationFrame(snap)
  return true
})()
`)

// 找一条「能解析出地址」的动态：正文区域（不是链接 / 图片）
const clicked = await ev(`
(() => {
  const SKIP = 'a,button,input,textarea,select,label,video,audio,img,picture,.bili-dyn-avatar,.bili-dyn-title,.bili-dyn-time,.bili-dyn-item__desc,.bili-dyn-item__following,.bili-dyn-follow-btn,.bili-dyn-item__footer,.bili-dyn-item__action,.bili-album,.dyn-card-opus__pics,.bili-video-card,.bili-dyn-card-video,.bili-dyn-card-live,.bili-dyn-card-article,.bili-dyn-card-link-common'
  const items = [...document.querySelectorAll('.bili-dyn-item')]
  const tried = []
  for (const it of items) {
    if (!it.querySelector('.bili-dyn-time')) continue
    const box = it.querySelector('.dyn-card-opus__summary') || it.querySelector('.bili-dyn-content') || it
    const r = box.getBoundingClientRect()
    if (r.width < 60 || r.height < 20) { tried.push('box-too-small'); continue }
    for (const fy of [0.75, 0.6, 0.45, 0.3]) {
      for (const fx of [0.5, 0.3, 0.7]) {
        const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
        if (!t) continue
        if (t.closest(SKIP)) { tried.push('skip:' + String(t.className).slice(0, 30)); continue }
        if (!t.closest('.bili-dyn-item')) continue
        t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
        return { ok: true, tag: t.tagName, cls: String(t.className).slice(0, 60), tried }
      }
    }
  }
  return { ok: false, tried }
})()
`)
console.log('点击:', JSON.stringify(clicked))

await sleep(3500)

const timeline = await ev(`window.__samples`)
const state = await ev(`
(() => {
  const host = document.getElementById('bili-elite-dynamic-host')
  const sr = host && host.shadowRoot
  const frame = sr && sr.querySelector('.dyn-frame')
  let href = ''
  try { href = frame ? frame.contentWindow.location.href : '' } catch {}
  const root = sr && sr.querySelector('.dyn-root')
  return { open: root ? root.classList.contains('is-open') : false, href, loaded: sr && sr.querySelector('.dyn-body') ? sr.querySelector('.dyn-body').classList.contains('is-loaded') : null }
})()
`)

fs.writeFileSync(OUT, JSON.stringify({ pageInfo, clicked, state, logs, timeline }, null, 2))
console.log('最终状态:', JSON.stringify(state))
console.log('日志:', logs.slice(0, 10))
console.log(`时间线 ${timeline.length} 条 → ${OUT}`)

chrome.kill()
process.exit(0)

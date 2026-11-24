// 测「动态页 → 视频卡 → 视频悬浮窗」：打开后截图看是否是我们版本的播放页（无右栏推荐）
// 用法：node probe4.mjs <extDir> <outJson>
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe4.json'
const PORT = 9369 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof4-${Date.now()}`
const BV = process.env.BV || 'BV1GJ411x7h7'

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
    ctxs.push({ id: m.params.context.id, origin: m.params.context.origin, name: m.params.context.name })
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

for (let i = 0; i < 60; i++) {
  if (await ev(`document.querySelectorAll('.bili-dyn-item').length > 0`).catch(() => false)) break
  await sleep(500)
}
console.log('动态条数:', await ev(`document.querySelectorAll('.bili-dyn-item').length`))

// 动态流里有没有真的视频卡；没有就注入一条假链接（点它走的是同一条 onClick 分支）
const hasCard = await ev(`!!document.querySelector('.bili-dyn-item .bili-video-card, .bili-dyn-item a[href*="/video/BV"]')`)
console.log('流里有视频卡:', hasCard)

const clicked = await ev(`
(() => {
  if (${hasCard}) {
    const card = document.querySelector('.bili-dyn-item .bili-video-card, .bili-dyn-item a[href*="/video/BV"]')
    const a = card.closest('a') || card.querySelector('a[href*="/video/BV"]') || card
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
    return 'real:' + a.tagName
  }
  const a = document.createElement('a')
  a.href = 'https://www.bilibili.com/video/${BV}'
  a.textContent = 'probe video link'
  a.style.cssText = 'position:fixed;left:10px;top:400px;z-index:2147483647;padding:8px;background:red;color:#fff'
  document.body.appendChild(a)
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
  return 'fake'
})()
`)
console.log('点击:', clicked)
await sleep(700)
const state = await ev(`
(() => {
  const host = document.getElementById('bili-elite-dynamic-host')
  if (!host) return { host: false }
  const sr = host.shadowRoot
  const frame = sr.querySelector('.dyn-frame')
  const root = sr.querySelector('.dyn-root')
  const stage = sr.querySelector('.dyn-stage')
  return {
    host: true,
    open: root.classList.contains('is-open'),
    mode: root.dataset.dynMode || '',
    src: (frame.src || '').slice(0, 80),
    sandbox: frame.getAttribute('sandbox') || '',
    stageW: Math.round(stage.getBoundingClientRect().width),
    stageH: Math.round(stage.getBoundingClientRect().height),
    top: location.href,
  }
})()
`)
console.log('悬浮窗:', JSON.stringify(state))

async function shot(name) {
  const r = await S('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`C:/Users/86157/bli-build-tmp/shot-${name}.png`, Buffer.from(r.data, 'base64'))
}
await sleep(300)
await shot('v-loading')
await sleep(5000)
await shot('v-content')

// 窗口下半部分放大 2 倍：看 UP 主行 / 操作栏 / 简介
const rect = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; const b = sr.querySelector('.dyn-stage').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } })()`)
try {
  const r2 = await S('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y + Math.round(rect.h * 0.55), width: rect.w, height: Math.round(rect.h * 0.45), scale: 2 } })
  fs.writeFileSync('C:/Users/86157/bli-build-tmp/shot-v-info.png', Buffer.from(r2.data, 'base64'))
}
catch (e) { console.log('clip fail', e.message) }

// 滚到播放器下面看信息区 / 评论区
for (let i = 0; i < 3; i++) {
  await S('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: 700 })
  await sleep(500)
}
await shot('v-scrolled')
await sleep(600)

const after = await ev(`
(() => {
  const host = document.getElementById('bili-elite-dynamic-host')
  const sr = host && host.shadowRoot
  return {
    top: location.href,
    loaded: sr ? sr.querySelector('.dyn-body').classList.contains('is-loaded') : null,
    open: sr ? sr.querySelector('.dyn-root').classList.contains('is-open') : null,
  }
})()
`)
console.log('5s 后:', JSON.stringify(after))

// 子 frame 里：嵌入类挂上了吗？右侧那组浮层是什么类名？
const sub = ctxs.find(c => /www\.bilibili\.com/.test(c.origin || '') || /video\/BV/.test(c.name || ''))
console.log('contexts:', JSON.stringify(ctxs.map(c => [c.origin, c.name]).slice(0, 6)))
if (sub) {
  const inner = await send('Runtime.evaluate', {
    contextId: sub.id,
    returnByValue: true,
    expression: `(() => {
      const html = document.documentElement.className
      const fixed = [...document.querySelectorAll('body *')].filter(el => {
        const cs = getComputedStyle(el)
        return (cs.position === 'fixed') && el.getBoundingClientRect().width < 120 && el.getBoundingClientRect().right > innerWidth - 80 && el.getBoundingClientRect().height > 40
      }).map(el => el.tagName + '.' + String(el.className).slice(0, 60))
      const rc = document.querySelector('.right-container')
      const rcKids = rc ? [...rc.children].map(e => e.tagName + '.' + String(e.className).slice(0, 40)) : []
      const innerKids = rc && rc.firstElementChild ? [...rc.firstElementChild.children].map(e => e.tagName + '.' + String(e.className).slice(0, 40)) : []
      const up = document.querySelector('.up-panel-container')
      const upRect = up ? up.getBoundingClientRect() : null
      return { rcKids, innerKids, upRect: upRect ? [Math.round(upRect.x), Math.round(upRect.y), Math.round(upRect.width), Math.round(upRect.height)] : null, html, fixed: [...new Set(fixed)].slice(0, 8), hasRight: !!document.querySelector('.right-container'), rightDisplay: document.querySelector('.right-container') ? getComputedStyle(document.querySelector('.right-container')).display : 'none', playerW: Math.round(document.querySelector('#playerWrap')?.getBoundingClientRect().width || 0) }
    })()`,
  }, sessionId)
  console.log('子 frame 内部:', JSON.stringify(inner.result?.value))
}
else { console.log('子 frame context 没拿到', JSON.stringify(ctxs.slice(0, 4))) }

// 子 frame 里有没有挂上我们的嵌入类（跨源：用 CDP 的 frame tree + 独立执行上下文）
try {
  const tree = await S('Page.getFrameTree')
  const kids = (tree.frameTree.childFrames || []).map(f => f.frame.url)
  console.log('子 frame:', JSON.stringify(kids))
}
catch (e) { console.log('frameTree fail', e.message) }

// 视频窗里的「新标签页」链接不能带 blie_embed
const openLink = await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; return sr.querySelector('.dyn-open').href })()`)
console.log('新标签页链接:', openLink)

// 切回动态详情：sandbox 要摘掉、分栏要恢复
await ev(`(() => { const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot; sr.querySelector('.dyn-close').click(); return 'ok' })()`)
await sleep(700)
const switched = await ev(`
(() => {
  const items = [...document.querySelectorAll('.bili-dyn-item')].filter(it => it.querySelector('.bili-dyn-time'))
  const it = items[0]
  const box = it.querySelector('.dyn-card-opus__summary') || it.querySelector('.bili-dyn-content') || it
  const r = box.getBoundingClientRect()
  for (const fy of [0.75, 0.6, 0.45]) {
    for (const fx of [0.5, 0.3]) {
      const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
      if (!t || t.closest('a,img,picture,video,.bili-album,.bili-video-card,.bili-dyn-time,.bili-dyn-item__desc')) continue
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
      return 'clicked:' + t.tagName
    }
  }
  return 'no-point'
})()
`)
console.log('切到动态:', switched)
await sleep(3000)
const dyn = await ev(`
(() => {
  const sr = document.getElementById('bili-elite-dynamic-host').shadowRoot
  const root = sr.querySelector('.dyn-root')
  const frame = sr.querySelector('.dyn-frame')
  return {
    open: root.classList.contains('is-open'),
    mode: root.dataset.dynMode || '',
    layout: root.dataset.dynLayout || '',
    sandbox: frame.getAttribute('sandbox') || '(none)',
    loaded: sr.querySelector('.dyn-body').classList.contains('is-loaded'),
    src: (frame.src || '').slice(0, 60),
  }
})()
`)
console.log('动态窗:', JSON.stringify(dyn))
await shot('v-switched')
fs.writeFileSync(OUT, JSON.stringify({ state, after, openLink, switched, dyn, logs }, null, 2))
console.log('异常:', logs.slice(0, 5))
chrome.kill()
process.exit(0)

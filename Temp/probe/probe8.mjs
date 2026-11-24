// 调研：动态悬浮窗 iframe 里评论区的图片长什么样（为了接管成全屏看图器）
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const CHROME = 'C:/Users/86157/AppData/Local/ms-playwright/chromium-1105/chrome-win/chrome.exe'
const EXT = process.argv[2]
const OUT = process.argv[3] || 'C:/Users/86157/bli-build-tmp/probe8.json'
const PORT = 9417 + (Number(process.env.PORT_OFFSET) || 0)
const PROFILE = `C:/Users/86157/bli-build-tmp/prof8-${Date.now()}`

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
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
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
        awaitPromise: true,
        returnByValue: true,
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

// 打开一条带图的动态
const clicked = await ev(`
(() => {
  const items = [...document.querySelectorAll('.bili-dyn-item')].filter(it => it.querySelector('.dyn-card-opus__pics'))
  const it = items[0]
  if (!it) return 'no-item'
  const box = it.querySelector('.dyn-card-opus__summary') || it.querySelector('.bili-dyn-content') || it
  const r = box.getBoundingClientRect()
  for (const fy of [0.6, 0.4]) {
    for (const fx of [0.5, 0.3]) {
      const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
      if (!t || t.closest('a,img,picture,.bili-album,.dyn-card-opus__pics')) continue
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }))
      return 'ok'
    }
  }
  return 'no-point'
})()
`)
console.log('点动态:', clicked)
await sleep(4000)

const sameOrigin = ctxs.filter(c => /t\.bilibili\.com/.test(c.origin || ''))
const sub = sameOrigin[sameOrigin.length - 1]
if (!sub) { console.log('没有 iframe context'); chrome.kill(); process.exit(0) }

// 滚到评论区
await send('Runtime.evaluate', {
  contextId: sub.id,
  returnByValue: true,
  expression: `(() => {
    const c = document.querySelector('#commentapp') || document.querySelector('.bili-comments') || document.querySelector('.bili-tabs')
    if (c) c.scrollIntoView({ block: 'start' })
    return !!c
  })()`,
}, sessionId)
await sleep(2500)

const dump = await send('Runtime.evaluate', {
  contextId: sub.id,
  returnByValue: true,
  expression: `(() => {
    const inComments = (el) => !!(el.closest('#commentapp') || el.closest('bili-comments') || el.closest('.bili-comments') || el.closest('.reply-item') || el.closest('.comment-list'))
    const imgs = [...document.querySelectorAll('img')].filter(im => {
      const r = im.getBoundingClientRect()
      return r.width > 40 && r.height > 40
    })
    const out = imgs.slice(0, 14).map((im) => {
      const r = im.getBoundingClientRect()
      const chain = []
      let p = im
      for (let i = 0; i < 5 && p; i++) { chain.push(p.tagName + (p.className ? '.' + String(p.className).split(' ').slice(0, 2).join('.') : '')); p = p.parentElement }
      return {
        cls: String(im.className).slice(0, 50),
        src: (im.currentSrc || im.src || '').slice(-46),
        rect: Math.round(r.width) + 'x' + Math.round(r.height),
        inComments: inComments(im),
        chain: chain.join(' < '),
      }
    })
    return { total: imgs.length, items: out, hasCommentApp: !!document.querySelector('#commentapp'), hasComments: !!document.querySelector('bili-comments') }
  })()`,
}, sessionId).then(r => r.result?.value)

console.log(JSON.stringify(dump, null, 1))
fs.writeFileSync(OUT, JSON.stringify(dump, null, 2))
chrome.kill()
process.exit(0)

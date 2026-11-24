/**
 * 「当前标签页打开」之后按后退回来：把界面还原到离开时的样子。
 *
 * 先说清楚做不到的那一半：**后退必然是一次整页重新加载**。
 * 浏览器本来有个 bfcache（后退时直接复活内存里的旧页面、一个字节都不用重下），但
 * B 站自己把它关掉了 —— 首页注册了 `unload` 监听，另外还有一批 `beforeunload` 和常驻
 * 心跳连接，Chrome 就不会把这一页放进 bfcache（实测：后退回来 `navigation.type` 是
 * `back_forward`，但 `pageshow.persisted` 恒为 false）。这一层是站点的，扩展改不了。
 *
 * 能改的是「回来之后看到什么」：
 * ① 关掉浏览器自己的滚动恢复 —— 它会在文档解析完的瞬间把 scrollTop 归零，跟下面每帧
 *    的推回互相打架，最后谁赢取决于时序；
 * ② 先把 <html> 垫到离开时的总高度 —— 内容还没加载完时页面不够长，scrollTo 会被截断，
 *    表现就是「滚到一半停住，过一会儿再跳」；
 * ③ 每帧把滚动位置按回去，直到页面长够、或用户自己动了滚轮 / 触摸 / 键盘。
 *
 * 只存一条记录（sessionStorage，同标签页同源）：连续跳两页再连退两级时，只有最近一次
 * 离开的位置能还原 —— 更早那几页记不住，也不值得记。
 */

const KEY = 'bili-elite-return'

/** 十分钟内才认：隔了很久才退回来，用户早就不指望还停在原地了 */
const MAX_AGE = 10 * 60 * 1000

/** 每帧推回的总时长上限：B 站首屏这会儿早铺完了，再拖只会变成「页面自己在动」 */
const PUSH_WINDOW = 4000

interface ReturnMark {
  href: string
  /** 离开时的滚动位置 */
  y: number
  /** 离开时的文档总高度：回来时先垫到这么高，才滚得过去 */
  h: number
  t: number
}

/**
 * 跳转前调用：把当前位置记下来。
 * 记不进去（隐私模式 / 存储被禁）就退化成「不还原」，绝不能因为存不下就不跳转。
 */
export function markReturnPoint() {
  try {
    const mark: ReturnMark = {
      href: location.href,
      y: Math.round(window.scrollY),
      h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      t: Date.now(),
    }
    sessionStorage.setItem(KEY, JSON.stringify(mark))
  }
  catch { /* noop */ }
}

/**
 * 页面启动时调用（越早越好：`scrollRestoration` 必须在浏览器恢复滚动之前设）。
 * 没有记录 / 地址对不上 / 本来就在顶部时什么都不做。
 */
export function setupReturnRestore() {
  let mark: ReturnMark | null = null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return
    mark = JSON.parse(raw) as ReturnMark
  }
  catch { return }

  if (!mark || typeof mark.y !== 'number' || typeof mark.h !== 'number') return
  // **先校验、后删**。记录里存的是「出发页」的地址，而跳去的目标页也会跑这个脚本：
  // 原来在解析完就 removeItem，于是同源跳转（视频页 → 首页 / 番剧 / 历史，同一个
  // www.bilibili.com）时记录在目标页就被吃掉了，按后退回来已经什么都不剩 ——
  // 只有跨域目标（t. / space. / message. / live.，sessionStorage 按 origin 隔离）
  // 才侥幸能还原，这也是「有时灵有时不灵」的来源。
  if (mark.href !== location.href) return
  if (Date.now() - mark.t > MAX_AGE) return
  // 确认是「回到出发页」的那一次加载，这条记录只服务这一次，用完就删：
  // 留着会让下次正常打开也莫名滚下去。地址对不上 / 已过期的那份不删，
  // 由十分钟的时效兜着，不会误伤别的页面。
  try {
    sessionStorage.removeItem(KEY)
  }
  catch { /* noop */ }
  // 本来就在顶部：浏览器默认行为就是顶部，不用管
  if (mark.y < 40) return

  const target = mark.y
  // document_start 时 documentElement 一定已经在了；这里只是不想为一个空指针
  // 把整个内容脚本带崩（后面所有模块都还等着初始化）
  const html = document.documentElement
  if (!html) return

  try {
    if ('scrollRestoration' in history)
      history.scrollRestoration = 'manual'
  }
  catch { /* 极老的浏览器没有这个属性 */ }

  // 只垫 html 的 min-height，不动 body：B 站自己那套布局仍然按它的内容算高度，
  // 这里只是保证「内容还没铺满时也滚得到离开时的位置」
  const prevMinHeight = html.style.minHeight
  if (mark.h > window.innerHeight)
    html.style.minHeight = `${mark.h}px`

  let done = false
  let minHeightTries = 0

  /**
   * 撤掉垫高。页面还没长到该有的高度时先留着 —— 抽掉的那一下 scrollY 会被夹小，
   * 用户看到的就是「自己往上跳了一截」。最多再等 8 次（约 6 秒）就不再等。
   */
  function dropMinHeight() {
    if (minHeightTries++ > 8) {
      html.style.minHeight = prevMinHeight
      return
    }
    if (html.scrollHeight - window.innerHeight < target) {
      window.setTimeout(dropMinHeight, 800)
      return
    }
    html.style.minHeight = prevMinHeight
  }

  function finish() {
    if (done) return
    done = true
    window.removeEventListener('wheel', onUserIntent)
    window.removeEventListener('touchstart', onUserIntent)
    window.removeEventListener('mousedown', onUserIntent)
    window.removeEventListener('keydown', onUserIntent, true)
    window.setTimeout(dropMinHeight, 600)
  }

  /** 用户一旦自己动了（滚轮 / 触摸 / 点滚动条 / 键盘翻页），立刻交还控制权 */
  function onUserIntent() {
    finish()
  }

  window.addEventListener('wheel', onUserIntent, { passive: true })
  window.addEventListener('touchstart', onUserIntent, { passive: true })
  window.addEventListener('mousedown', onUserIntent, { passive: true })
  window.addEventListener('keydown', onUserIntent, true)

  const started = performance.now()
  const tick = () => {
    if (done) return
    if (Math.abs(window.scrollY - target) > 1)
      window.scrollTo(0, target)
    if (performance.now() - started > PUSH_WINDOW) {
      finish()
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

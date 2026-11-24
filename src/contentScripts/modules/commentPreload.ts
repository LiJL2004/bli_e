/**
 * 评论预加载（播放页优化 → 评论预加载）
 *
 * 要解决的问题：播放页的评论区在页面下方，B 站的 `<bili-comments>` 带 `lazy-load`，
 * 组件自己用 IntersectionObserver 观察自己，**1px 进入视口才发第一页请求**（实测：页面
 * 打开 3.4s 组件就挂上了，但 `/x/v2/reply/wbi/main` 一直等到滚到评论区才发）。所以用户
 * 滚下去先看到一圈 spinner，再等 1s 左右才出评论。
 *
 * 为什么不能「替它发请求」：那个接口的响应头是 `Cache-Control: no-cache`（实测），我们
 * 取回来的那份进不了任何缓存，B 站组件也不会认 —— 白花流量。preconnect / 预取都没用。
 *
 * 所以唯一的办法是**让评论区真的进入一次视口**：把它整块 `translateY` 到视口顶部、
 * 透明掉（样式在 videoBeta.css §13），它自己的 IO 就判定「可见」，第一页开始下载；
 * 下载完（区块长高）立刻复位。用户还在看视频，什么都没看见，滚下去时评论已经在了。
 *
 * 为什么用 transform 而不是 position: fixed：它是 `.left-container` 栅格里的一格，
 * transform 不改布局 —— 页面高度、滚动条、其它块的位置一个像素都不动；fixed 会让这一格
 * 塌陷，整页高度瞬间少 150px、复位时又长回来，滚动条要抖两下。
 *
 * 「不影响视频打开速度」靠这四条：
 * 1. 只在**首帧就绪之后**动手（`canplay` 捕获阶段，再等 0.4s）—— 首帧已经拿到，视频和
 *    首屏不再抢那几帧带宽了。`playing` 只是补一刀（浏览器从缓存起播时 canplay 会一闪而过）。
 * 2. 页面 `load` + 2s 兜底：视频因为自动播放被拦而没有 canplay 时，首屏这时也已经画完。
 * 3. 6s 硬兜底：用户暂停着看简介 / 视频一直没就绪，这时视频根本没在下东西。
 * 4. 省流量模式 / 2g 网络不做（判据与 hoverPrefetch.ts 一致）；页面在后台也不做，
 *    等切回前台再来。
 *
 * ## 第 5 条（1.2.3 v003）：看缓冲，不看时钟
 *
 * 前四条都只管「什么时候轮到我们」，没有一条管「播放器现在还缺不缺带宽」——
 * 而 4K 那种码率下，起播后头十几秒正是缓冲最薄的时候：一条 7MB 的分片要下一秒多，
 * 这时候插进去一页评论（1 个 JSON + 20 个头像 + 表情）就是实打实地从播放器嘴里抢。
 * 链路只要稍微紧一点，那一下就是「卡住」。
 *
 * 所以真正动手之前再问一句**播放器现在怎么样**（`loadVerdict()`）：
 *   - 没有在播的视频（暂停 / 已结束 / 页面还没播放器）→ 没有任何竞争，直接放行；
 *   - 在播：`readyState >= 3` 且**缓冲领先量**达标 —— 普通清晰度 8s，≥ 2K 的 20s。
 *     不达标就每 500ms 再看一次，最多等到 40s；一直不达标就放弃这次预加载
 *     （链路连视频本身都喂不饱，这时候加请求只会更糟）。
 *   - 位移期间播放器一旦 `waiting` / `stalled`：立刻复位，把这一块让回去。
 *
 * 为什么用「缓冲领先量」而不是 `canplay` / `readyState`：`canplay` 只代表「有两帧能播」，
 * 跟「链路有余量」完全是两件事 —— 4K 起播时 canplay 来得早、缓冲却很薄。
 *
 * 为什么不用更早的 `loadedmetadata` / `DOMContentLoaded`：那会儿视频正在下首帧数据，
 * 评论请求（第一页 JSON + 20 条评论的头像）插进去就是实打实地抢首屏带宽 ——
 * 用户要的是「评论早点好」，不是「视频晚点开」。
 */

import { get } from '../config'
import { log } from '../logger'
import { isVideoPage } from './videoBeta'

/** 临时挂在 <html> 上的类：CSS 靠它把评论区挪进视口（见 videoBeta.css §13） */
const ROOT = 'bili-elite-vb-cp'
/** 位移量（负值），由下面按「评论区顶边到视口顶的距离」写进 <html> */
const SHIFT_VAR = '--bili-vb-cp-shift'

/** 首帧就绪（canplay）之后再等这么久：那一瞬间视频已经拿到第一帧，首屏带宽的竞争基本结束 */
const AFTER_READY = 400
/** 页面 load 之后的兜底：视频可能因为自动播放被拦而没有 canplay，但首屏这时已经画完了 */
const AFTER_LOAD = 2000
/** 最晚什么时候动手：页面结构异常 / 视频一直没就绪（用户可能只是暂停着看简介） */
const HARD_DELAY = 6000
/** 位移最多保持多久：到点无条件复位。宁可这次没预加载完，也不能让评论区一直透明地蹲在视口顶 */
const SHIFT_MAX = 4000
/** 等 `#commentapp` 挂出来的上限（B 站 3~4s 才把 <bili-comments> 插进去） */
const WAIT_APP = 20000
/** 评论区还没挂出来时的重试间隔 */
const RETRY = 250
/**
 * 等「播放器缓冲变厚」的上限与间隔。
 *
 * 比 WAIT_APP 宽一倍：4K 起播后缓冲从薄到厚本来就要十几秒，卡在 20s 等于把这个功能
 * 在 4K 上直接废掉。40s 还没厚起来说明链路连视频本身都喂不饱 —— 那时候放弃才对。
 */
const WAIT_BUFFER = 40000
const RETRY_BUFFER = 500
/** 缓冲领先量达标线（秒）：普通清晰度 / ≥2K（4K 那档码率高一个数量级，要求翻倍还多） */
const BUFFER_MIN = 8
const BUFFER_MIN_HD = 20
/** ≥ 这个宽度按「高码率」算：2560 = 2K/1440p，B 站的 4K(120) 是 3840 */
const HD_WIDTH = 2560

/** 省流量 / 弱网下不做：这类网络下多一个请求只会让视频更卡 */
function weakNetwork(): boolean {
  const conn = (navigator as any).connection
  if (!conn)
    return false
  return !!conn.saveData || /^(?:slow-2g|2g)$/.test(conn.effectiveType || '')
}

/**
 * 第一页回来了没有。
 *
 * B 站这个组件是 lit 写的 web component，内容全在 open shadow root 里：加载前只有一个
 * spinner，加载完才有 header（`bili-comments-header-renderer`）/ 列表 / 空提示。
 * 拿不到 shadowRoot（将来若改成 closed）就退回「区块长高了」这个更粗的判据 ——
 * 未加载时 `#commentapp` 是 154px，加载完 700px 上下。
 */
function commentsLoaded(app: HTMLElement): boolean {
  const sr = document.querySelector('bili-comments')?.shadowRoot
  if (sr)
    return !!sr.querySelector('bili-comments-header-renderer, bili-comment-thread-renderer')
  return app.getBoundingClientRect().height > 400
}

/**
 * 现在加这一页请求，会不会跟正在播的视频抢带宽。
 *
 * `'ok'` = 可以动手；`'wait'` = 缓冲还薄，过一会儿再看。判据只看**播放器自己的状态**，
 * 不猜网速（`navigator.connection` 的估计值在 4G 上太粗）：缓冲领先量是播放器真的把
 * 分片下下来了多少，最诚实。
 */
function loadVerdict(): 'ok' | 'wait' {
  const video = document.querySelector<HTMLVideoElement>('#bilibili-player video')
  // 还没有播放器 / 已经播完 / 用户暂停着看简介：这时候视频根本没在下东西，随便加。
  // 注意别把「readyState 低」也算进来 —— 那恰恰是在拼命下数据的时候。
  if (!video || video.paused || video.ended)
    return 'ok'
  // 缓冲领先量：最后一段 buffered 的终点减当前位置。读不到就是 0（还没下到东西）
  const b = video.buffered
  const ahead = b && b.length ? b.end(b.length - 1) - video.currentTime : 0
  const need = video.videoWidth >= HD_WIDTH ? BUFFER_MIN_HD : BUFFER_MIN
  // readyState >= 3 (HAVE_FUTURE_DATA)：当前帧之后还有数据，说明链路是通的
  if (video.readyState >= 3 && ahead >= need)
    return 'ok'
  return 'wait'
}

export function setupCommentPreload(): () => void {
  // 只接管主站普通播放页（与 videoBeta.ts 的 isVideoPage 同一份判定）
  if (!isVideoPage())
    return () => {}

  let stopped = false
  let done = false
  let shifting = false
  /** 已排定的动手时刻（绝对时间戳）。多个来源竞争时只认最早的那个，见 plan() */
  let fireAt = 0
  let fireTimer = 0
  let retryTimer = 0
  let idleHandle = 0
  /** 位移的收尾函数：复位类与变量、摘掉观察器。幂等 */
  let undoShift: (() => void) | null = null

  const startedAt = Date.now()

  function clearTimers() {
    if (fireTimer) {
      clearTimeout(fireTimer)
      fireTimer = 0
    }
    fireAt = 0
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = 0
    }
    if (idleHandle) {
      if (typeof window.cancelIdleCallback === 'function')
        window.cancelIdleCallback(idleHandle)
      idleHandle = 0
    }
  }

  /**
   * 还没准备好：过一会儿再来。
   *
   * `waitForBuffer` 区分两种「没准备好」：评论区没挂出来（20s 就放弃）和播放器缓冲还薄
   * （40s 才放弃，间隔也放宽到 500ms）—— 后者的正常耗时本来就是十几秒。
   */
  function retry(waitForBuffer = false) {
    if (retryTimer || stopped || done)
      return
    if (Date.now() - startedAt >= (waitForBuffer ? WAIT_BUFFER : WAIT_APP))
      return
    retryTimer = window.setTimeout(() => { retryTimer = 0; run() }, waitForBuffer ? RETRY_BUFFER : RETRY)
  }

  /**
   * 真正干活：把评论区挪进视口一次。
   *
   * 所有前置判断都在这里**重读** —— 这个函数是被 setTimeout / idle 调起来的，
   * 那一刻开关、页面状态、评论区位置都可能已经变了（尤其是开关：setup 在
   * DOMContentLoaded 跑，那时 storage 里的真实值可能还没回来，config 全是默认值）。
   */
  function run() {
    if (stopped || done || shifting)
      return
    if (!get('videoBeta') || !get('videoCommentPreload'))
      return
    if (weakNetwork())
      return
    if (document.hidden) {
      // 后台标签页：评论区挪过去也不会渲染（浏览器不跑 rAF / 停摆 IO 回调），
      // 等用户切回来再做一次
      document.addEventListener('visibilitychange', onVisible, { once: true })
      return
    }

    const app = document.querySelector<HTMLElement>('#commentapp')
    if (!app) {
      // 评论区还没挂上来：过一会儿再试（B 站 3~4s 才插 <bili-comments>）
      retry()
      return
    }
    // 已经加载过（用户自己滚下去过 / B 站提前取过）→ 什么都不用做
    if (commentsLoaded(app)) {
      done = true
      return
    }

    const rect = app.getBoundingClientRect()
    // 高度 0 有两种：评论区还没渲染出内容（`#commentapp` 先出来、里面是空的），
    // 或者沉浸式 / 网页全屏下这一块被收起来了。前者等一会儿就好，后者等多久都没用 ——
    // 统一按「还没准备好」重试，超过 WAIT_APP 自然放弃。
    // 起播 + 1.5s 的时候正好卡在前者（实测那个时间点 appH 还是 0），所以这条不能省。
    if (rect.height < 1) {
      retry()
      return
    }
    // 已经在视口里：B 站自己会加载，别插手
    if (rect.top < window.innerHeight) {
      done = true
      return
    }
    // 结构都就位了，最后问一句「播放器现在还缺不缺带宽」（见文件头第 5 条）。
    // 缓冲没厚起来就再等等 —— 这一条是 1.2.3 v003 修「4K 起播时卡住」的关键：
    // 前面那些时机判据只管「轮到我们了」，管不了「播放器还饿着」。
    if (loadVerdict() === 'wait') {
      retry(true)
      return
    }

    shifting = true
    const startY = window.scrollY
    // -8：让顶边落在视口往下 8px，而不是正好贴着 0 —— 贴边时相交矩形的计算容易落到
    // 「刚好不算相交」那一侧，往里多塞 8px 更稳
    const shift = Math.round(rect.top) - 8
    document.documentElement.style.setProperty(SHIFT_VAR, `-${shift}px`)
    document.documentElement.classList.add(ROOT)
    log('comment preload: shift', shift)

    let finished = false
    let ro: ResizeObserver | null = null
    let timer = 0
    // 位移期间盯着的那个 video：它一卡（waiting / stalled）就说明我们在跟它抢带宽
    const video = document.querySelector<HTMLVideoElement>('#bilibili-player video')

    function onScroll() {
      // 位移期间用户自己滚下来（或滚上去）：立刻复位，别让他看到评论区挂在视口顶上
      if (Math.abs(window.scrollY - startY) > 24)
        finish()
    }

    /**
     * 播放器开始等数据了 —— 这一页评论请求就是嫌疑人之一，立刻把位移撤掉。
     *
     * 只撤位移、不撤已经发出去的请求（撤不掉），但至少不再让那一大块评论内容
     * 压在播放器上抢合成，也不会继续把「还在视口里」这个状态喂给它的懒加载。
     */
    function onStall() {
      log('comment preload: video stalled, reset')
      finish()
    }

    function finish() {
      if (finished)
        return
      finished = true
      shifting = false
      done = true
      document.documentElement.classList.remove(ROOT)
      document.documentElement.style.removeProperty(SHIFT_VAR)
      ro?.disconnect()
      ro = null
      window.removeEventListener('scroll', onScroll)
      video?.removeEventListener('waiting', onStall)
      video?.removeEventListener('stalled', onStall)
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      log('comment preload: reset')
    }

    // 评论区「长高」= 第一页回来了（空评论区也会长出标题栏 + 空提示）
    ro = new ResizeObserver(() => {
      if (commentsLoaded(app))
        finish()
    })
    ro.observe(app)
    timer = window.setTimeout(finish, SHIFT_MAX)
    window.addEventListener('scroll', onScroll, { passive: true })
    video?.addEventListener('waiting', onStall)
    video?.addEventListener('stalled', onStall)
    undoShift = finish
  }

  function onVisible() {
    if (document.visibilityState === 'visible')
      run()
  }

  /**
   * 排期：`delay` 毫秒之后、浏览器空闲时再跑，不跟当前这一帧的渲染抢主线程。
   *
   * 三个来源（canplay / load / 硬兜底）都会调它，**只允许提前、不允许推迟**：
   * 谁给的时刻更早就按谁算。不用「先到先排」——`load` 通常比 `canplay` 先到，
   * 先到就先排 2s 的话，后面 canplay 说的「0.4s 就行」会被守卫挡掉，反而更晚。
   */
  function plan(delay: number) {
    if (stopped || done)
      return
    const at = Date.now() + delay
    if (fireAt && at >= fireAt)
      return
    fireAt = at
    if (fireTimer)
      clearTimeout(fireTimer)
    fireTimer = window.setTimeout(() => {
      fireTimer = 0
      fireAt = 0
      if (stopped || done)
        return
      if (typeof window.requestIdleCallback === 'function')
        idleHandle = window.requestIdleCallback(() => { idleHandle = 0; run() }, { timeout: 800 })
      else
        window.setTimeout(run, 120)
    }, delay)
  }

  function onReady(e: Event) {
    // 用 tagName 判而不是 `instanceof HTMLVideoElement`：与 videoBeta.ts 里的写法一致，
    // 也不依赖隔离世界里 DOM 包装的原型链
    if ((e.target as HTMLElement | null)?.tagName !== 'VIDEO')
      return
    document.removeEventListener('canplay', onReady, true)
    document.removeEventListener('playing', onReady, true)
    plan(AFTER_READY)
  }

  // `canplay` / `playing` 都不冒泡，用捕获阶段在 document 上接 —— 播放器是异步挂上来的，
  // 等它出现再 addEventListener 会漏掉最开始那一次。
  // 主判据是 canplay（首帧已经拿到），playing 只是补一刀（有些情况下 canplay 之后才起播，
  // 或者浏览器直接从缓存起播、canplay 一闪而过）——两个谁先到都行，plan() 只认更早的那个。
  document.addEventListener('canplay', onReady, true)
  document.addEventListener('playing', onReady, true)

  // 兜底一：页面 load（首屏已经画完，视频就算还在缓冲，也不再跟首屏抢那几帧了）。
  // 比 canplay 宽 1.6s，是为了让 canplay 优先 —— 它才是「视频真的能看了」那个信号。
  if (document.readyState === 'complete')
    plan(AFTER_LOAD)
  else
    window.addEventListener('load', () => plan(AFTER_LOAD), { once: true })

  // 兜底二：视频一直没就绪（用户暂停着看简介 / 自动播放被拦 / 页面结构变了）。
  // 这时视频根本没在下东西，做不抢任何带宽。
  plan(HARD_DELAY)

  return () => {
    stopped = true
    clearTimers()
    document.removeEventListener('canplay', onReady, true)
    document.removeEventListener('playing', onReady, true)
    document.removeEventListener('visibilitychange', onVisible)
    undoShift?.()
    undoShift = null
  }
}

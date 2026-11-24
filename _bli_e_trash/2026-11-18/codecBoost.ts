import { get, isUserEdit, onConfigChange } from '../config'
import { log } from '../logger'

/**
 * 「4K 流畅加速」（实验室，1.2.3 v004）。
 *
 * 真正干活的是 `extension/guard.js` §6：它在 MAIN world、document_start 把 B 站播放器
 * 的 localStorage 键 `bilibili_player_codec_prefer_type` 改成 `1`（HEVC），
 * 让 4K 从 AVC 的 15.99Mbps 换成 HEVC 的 6.21Mbps —— 冷门稿件卡缓冲就是这么来的。
 *
 * 这里只做三件事：
 *   1. 把开关同步成 `guard.js` 认得的**镜像键**（`chrome.storage` 是异步的，
 *      而 MAIN world 那边连 `chrome.*` 都没有，只能靠 localStorage 传话）；
 *   2. 关掉时把 B 站自己的原值还回去（`guard.js` 覆盖前记在 PREV_KEY 里）；
 *   3. 用户刚在面板里切换过 → 重载当前播放页，否则要等下一次打开视频才生效。
 *
 * **为什么不在 setup 里先跑一次 `apply(get(...))`**：页面刚打开时 config 里全是默认值
 * （`codecBoost` 默认关），先跑一次就会把 `guard.js` 刚写好的镜像和编码偏好一起抹掉 ——
 * 和 1.2.0 v006 那个「首页无限刷新」是同一个坑：**副作用只认用户意图**，
 * 存储快照 / 默认值那条路一律不许动手。`apply()` 只由 `onConfigChange` 触发。
 */

/** 镜像键：与 `extension/guard.js` §6 共用，改名要两边一起改 */
const MIRROR_KEY = 'bili-elite-codec'
/** 覆盖前 B 站的原值（空串表示「原来没有这个键」） */
const PREV_KEY = 'bili-elite-codec-prev'
/** B 站播放器的编码偏好键（取值见 guard.js 里那段注释） */
const BILI_KEY = 'bilibili_player_codec_prefer_type'

const MIRROR_ON = 'hevc'

/** 只有播放页需要重载；首页 / 搜索页没有播放器，切完等下次打开自然生效 */
function isVideoPage() {
  return location.pathname.includes('/video/')
}

function apply(on: boolean) {
  try {
    if (on) {
      localStorage.setItem(MIRROR_KEY, MIRROR_ON)
      log('codecBoost: mirror on')
      return
    }

    localStorage.removeItem(MIRROR_KEY)
    // 把 B 站自己的值还回去。没记过原值（从没覆盖过）就什么都不用做 ——
    // 那种情况下现在的值本来就是用户自己的，别去动它。
    const prev = localStorage.getItem(PREV_KEY)
    if (prev === null) {
      log('codecBoost: mirror off (nothing to restore)')
      return
    }
    if (prev === '')
      localStorage.removeItem(BILI_KEY)
    else
      localStorage.setItem(BILI_KEY, prev)
    localStorage.removeItem(PREV_KEY)
    log('codecBoost: mirror off, restored', prev)
  }
  catch {
    /* 隐私模式 / 存储被禁用：这一次不生效，页面本身不受影响 */
  }
}

export function setupCodecBoost(): () => void {
  const off = onConfigChange((key) => {
    if (key !== 'codecBoost')
      return

    const on = !!get('codecBoost')
    apply(on)

    // 只有「用户刚在面板里点的」才重载。存储快照 / 别的标签页同步过来时不重载：
    // 那会把用户正在看的视频打断，而且下一次打开播放页本来就会生效。
    if (isUserEdit() && isVideoPage())
      location.reload()
  })

  return off
}

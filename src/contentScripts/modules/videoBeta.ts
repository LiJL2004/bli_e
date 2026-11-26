import { get, onConfigChange } from '../config'
import { isPlayerFullscreen, isPlayerImmersive, onPlayerScreenChange } from './playerMode'
import { installRipple } from './ripple'
import type { PlayerScreen } from './playerMode'
import videoBetaCss from './videoBeta.css?inline'

/**
 * 播放页优化（内部代号 beta；界面优化 → 播放页优化，1.1.4 起默认开启）。
 *
 * **设计前提（v013 定死）：`#mirror-vdcon` 里的 Vue 树一个节点都不插、不搬、不删。**
 * 实测往标题里 append 一个 span 会让 B 站顶栏那次 mount 失败 —— `nextSibling` 报错、
 * `#biliMainHeader` 变成空盒子（顶栏一条白），视频还会停顿一下；插 5/5 复现，不插 0/5。
 * 参照 BewlyCat：**替换/覆盖零等待，patch 原生树才有代价**。
 *
 * 于是所有视觉改造都走「CSS + CSS 变量 + 伪元素」：
 *   1. 注入 videoBeta.css（纯布局，样式本体都在那边）；
 *   2. 按窗口宽高算出「左栏宽 / 播放器高 / 右栏宽 / 左右留白」写进 <html> 的 CSS 变量
 *      （左右留白同一个值，别去扣滚动条宽度，原因见 measure()）
 *      —— 这四个数字 B 站自己也算（写进 `<style id="setSizeStyle">`），但它是「先按一屏高度
 *      封顶、再倒推宽度」，于是在宽屏上两侧空出一大片。这里反过来：宽度优先，右栏固定，
 *      剩下的全给播放器；
 *   3. UP 主卡片留在右栏的 DOM 里不动，用 `position:sticky` 画到左栏第 3 行
 *      （几何写进 `--bili-vb-up-*`，见 layoutUp）；左栏用伪元素占位。
 *      用 sticky 而不是 absolute：左栏自己会 sticky（B 站的 `.scroll-sticky`），
 *      absolute 挂在 #mirror-vdcon 上会和它错开；sticky 让两边用同一套钉住逻辑，滚动零延迟；
 *      卡片的 top 是**常量**（左栏钉住的位置 + up-y，见 leftPinTop），只在布局变化时重算，
 *      滚动里一个字节都不写 —— 用户明确否过「滚动回调」那条路（v023）；
 *      左栏包含块没余量时它根本不钉（见 Geom.room），这时卡片也不钉；
 *   4. UP 主那一行：关注按钮绝对定位到名字右边，粉丝数走 `.up-detail::after`
 *      （只有「关注 1882.4万」这个文本节点要拆一次 —— 改文本不算改结构）；
 *   5. 视频标签写成 `--bili-vb-topics`，由 `.video-info-detail-list::after` 显示成
 *      `#话题`（接在**播放数据后面**，原来那排灰色胶囊整条隐藏）；播放数据跟简介合成一张
 *      灰底卡片 —— 同样不搬 DOM，靠 videoBeta.css §7 的栅格叠层实现；没有简介的稿件
 *      强制把卡片画出来、正文放一个 `~` 占位（§11）；
 *   6. 弹幕发送栏搬进控制栏中间（播放器收回纯 16:9）—— 它在播放器自己的 Vue 应用里、
 *      不在 #mirror-vdcon 下，是**唯一还保留的搬**；只等播放器挂上就动（见 scheduleMove）。
 *   7. 首帧前铺封面（1.2.0 v011）：B 站不做 poster，首帧前播放器是纯黑，用封面顶上，
 *      `loadeddata` 一到就摘（见 ROOT_POSTER 那段注释）。
 */

const STYLE_ID = 'bili-elite-video-beta-style'
const ROOT = 'bili-elite-video-beta'
/** 沉浸式（宽屏 / 网页全屏 / 全屏）：尺寸交回 B 站自己算，见 videoBeta.css §2 */
const ROOT_IMMERSIVE = 'bili-elite-vb-immersive'
/**
 * 播放器圆角（YouTube 同款 12px，见 videoBeta.css §2.1）。
 *
 * **宽屏要圆、网页全屏 / 全屏不能圆**：后两种模式播放器铺满整屏，四角切圆就是在屏幕边上
 * 抠四个缺。这个组合用 `[data-screen]` 判不出来 —— 它只在 B 站那三个「屏幕模式」按钮之间
 * 可靠维护，原生全屏那一下不一定跟着变成 `full`。所以由这里按 `getPlayerScreen()`
 * （原生全屏优先看 `document.fullscreenElement`）算好再挂类。
 */
const ROOT_ROUND = 'bili-elite-vb-round'
/** 被「动态悬浮窗」嵌进来时挂上：收掉顶栏 / 右栏推荐 / 背景（见 isEmbedMode） */
const ROOT_EMBED = 'bili-elite-vb-embed'
/**
 * 嵌入模式 + 窗口够宽：视频页排成「左播放器 / 右标题 + UP + 评论」两栏。
 *
 * 判据在 measure()：去掉两侧留白、播放器与信息栏之间的间距、以及信息栏的最小宽度之后，
 * 左边还能放下 `SPLIT_VIDEO_MIN` 宽的 16:9 播放器。宽度不够就退回单栏（播放器在上、信息在下）。
 */
const ROOT_EMBED_SPLIT = 'bili-elite-vb-embed-split'
/**
 * 两栏布局的宽度参数。**和 dynamicOverlay.ts 的 videoWidthFor() 是同一组数**：
 * 那边用 `clamp(440, 28%, 620)` 预留信息栏，这里用同样的区间算 iframe 内部怎么分。
 * 改一边要同步另一边，否则父页面会按两栏给宽、iframe 里却退回单栏（播放器会顶满窗口高度）。
 */
const SPLIT_INFO_MIN = 440
const SPLIT_INFO_MAX = 620
const SPLIT_INFO_RATIO = 0.28
/** 播放器再窄就不值得分两栏了（600 宽 ≈ 338 高，已经是能看清的下限） */
const SPLIT_VIDEO_MIN = 600
/**
 * 退出两栏的滞回量。iframe 出现 / 消失纵向滚动条会让 `clientWidth` 变 15px 左右，
 * 正好卡在阈值上就会来回切；留 40px 余量，切进来以后要明显更窄才退出去。
 */
const SPLIT_VIDEO_HYSTERESIS = 40
/** 两栏时播放器的尺寸（px），由 measure() 写；单栏时不参与 */
const VIDEO_W_VAR = '--bili-vb-video-w'
const VIDEO_H_VAR = '--bili-vb-video-h'
/**
 * 视频页半顶栏（界面优化 → 顶栏优化 → 视频页半顶栏，1.1.6 v011）。
 *
 * 这个类由**本模块**挂（不是 selfTopbar）：它改的是播放页的几何 —— 左栏上移（顶栏高 −
 * 上方空隙 = 54px）、左右栏间距收窄，而尺寸全在 measure() 里算。顶栏那半边（只画在右栏
 * 上方、左边缘与视频右边缘齐平、搜索框缩小右移）读的是同一个类，见 selfTopbar.css §8。
 *
 * 依赖关系：它同时要求 `customTopbar`（顶栏是自绘的那条）和 `videoBeta`（几何是这套），
 * 任一关掉就不挂 —— 顶栏 CSS 里那几条 `--bili-vb-*` 变量只有 videoBeta 在算。
 */
const ROOT_HALF = 'bili-elite-vb-half'
/**
 * **统一白边（1.2.0）**：左右两侧留白 / 左栏与右栏之间的间距 / 播放器顶部留白，三处同一个数。
 *
 * 以前这三处各走各的：两侧 `clamp(8, 0.6vw, 14)`、中间 24（半顶栏 12）、顶部半顶栏 10 /
 * 非半顶栏 0。于是窗口一宽，两侧就比中间窄；半顶栏一关，播放器又直接顶到顶栏下沿 ——
 * 同一屏里出现三种「白」，看着就是没对齐。
 *
 * 现在全部取半顶栏那个数（10）。**顶部这条只对半顶栏生效**（1.2.1）：半顶栏时左栏上移
 * 64px，顶部那 10px 是留给窗口边缘的呼吸；非半顶栏时顶栏实打实占着上方 64px，再留 10px
 * 就成了顶栏和画面之间一条白缝（用户要求去掉，见 videoBeta.css §1 的 padding-top）。
 *
 * **1.2.0 v005 起首页 / 搜索页也用它**（designTokens.css 的 `--bili-edge`），三页同一条边。
 * 那两页是纯 CSS 取变量；这里必须是 JS 常量（量尺寸要用数字，不能每帧读一遍样式）。
 * **改一处要同时改另一处**：`--bili-edge` ↔ 这个 EDGE。
 */
const EDGE = 10
/** 自绘顶栏的高度 = 原生 `.bili-header__bar` 在文档流里占的那 64px（selfTopbar.css §1） */
const HALF_TOPBAR_H = 64
/**
 * 左栏上移的量 = 顶栏高 − 上方空隙（54px），由 measure() 写进 `--bili-vb-half-shift`。
 *
 * **这是「左栏坐标系」和「右栏坐标系」之间那道 64px 落差的唯一来源**，两边都要用：
 *   · videoBeta.css §12 用它上移左栏；
 *   · 同一文件 §6 用它把 UP 卡的 margin-top 从「左栏坐标」换算到「右栏坐标」——
 *     卡片没搬 DOM，还留在右栏的流里，margin-top 是从右栏顶边量的。以前两边都写死
 *     「上移 64、卡片按左栏算」，卡片就整体低了 64px，正好压在简介卡上（v012 的 bug）。
 */
const HALF_SHIFT_VAR = '--bili-vb-half-shift'
/** 网页全屏 / 全屏：弹幕发送栏整块交回 B 站原生（729×34 那条），见 videoBeta.css §9 */
const ROOT_SEND_NATIVE = 'bili-elite-vb-send-native'
const MIRROR_ID = 'mirror-vdcon'
const UP_SELECTOR = '.up-panel-container'
/** UP 卡片的几何（相对左栏顶边）：离标题的距离 / 宽度 / 自身高度 */
const UP_Y_VAR = '--bili-vb-up-y'
const UP_W_VAR = '--bili-vb-up-w'
const UP_H_VAR = '--bili-vb-up-h'
/** 卡片的 sticky top（视口坐标）= 左栏的 sticky top + 卡片在左栏里的位置，见 syncUpPin */
const UP_TOP_VAR = '--bili-vb-up-top'
/** 话题串 / 粉丝数：给伪元素的 content 用，值必须带引号（见 videoBeta.css §5 / §6） */
const TOPICS_VAR = '--bili-vb-topics'
const FANS_VAR = '--bili-vb-fans'
/**
 * 原版「N 人正在看」（v032）：它本来在弹幕发送栏里，beta 把发送栏搬进控制栏、又把这块人数
 * 藏掉了（§9.2），滚到评论区就再也看不到。现在挪到播放数据那一行的最右侧（§7.1）。
 */
const WATCHING_VAR = '--bili-vb-watching'
const WATCHING_SELECTOR = '.bpx-player-video-info-online'

/** 右栏宽度：窄屏 380、宽屏按 33vw 长，最多 620（v010 放大封面后右栏跟着宽了一点，
 *  不然「封面 58% + 文字」挤不下；1600 窗口下是 528） */
const RAIL_MIN = 380
const RAIL_MAX = 620
const RAIL_RATIO = 0.33
/** 窗口窄到放不下时右栏还能压到多窄 —— 再窄就该整行横向滚动了，不如让卡片窄一点 */
const RAIL_TIGHT = 300
/** 左栏下限：再窄就该交给 B 站自己的 min-width 去横向滚动了 */
const LEFT_MIN = 560
/**
 * 「**摘走**节点」的下限时刻 —— 现在只剩搬弹幕发送栏一件事用它。
 *
 * 先纠正一个记错的前提（v013 实测）：B 站那套白屏检测
 * （`__MIRROR_CONFIG__.config.whiteScreen`，`maxLoop: 10`）**只做上报、不重渲染**。
 * 翻 `biliMirror.umd.mini.js`：`reportWhiteScreen()` 里是 `It({type:'error'…})` +
 * html2canvas 截图 + `clearCache()`，`handleWhiteScreen()` 只 push 一条指标；
 * 既没有 `location.reload()` 也没有重挂组件。所以它不是我们要躲的东西。
 *
 * 真正会把节点冲掉的是 B 站自己：首屏 ~3.2s 它要把整个左栏重渲染一遍，
 * **跟我们在不在完全无关**。但在那之前把节点从原位置**摘走**，Vue patch 时
 * `oldVnode.elm` 已经不在原位，会报 `reading 'nextSibling'`、顶栏那次 mount 失败 → 一条白。
 *
 * 结论：**只有「摘节点」要看这个常量**。改 class / 写 CSS 变量 / 伪元素一律不受限，
 * UP 主卡片和话题串都已经走那条路（见文件头）。往 Vue 树里插节点（v010 的话题链接）
 * 实测也会让顶栏 mount 失败 —— 5/5 复现，所以那条路整个不要了。
 *
 * **v002 把这个下限从 3000 收到 700**：那个 3s 是照着「B 站 3.2s 整栏重渲染」定的，
 * 可发送栏在播放器自己的 Vue 应用里（`.bpx-player-*`），根本不在 #mirror-vdcon 这棵树上，
 * 左边那轮重渲染冲不到它。代价却是实打实的：窗口态我们把整条 `.bpx-player-sending-area`
 * display:none 掉了，搬进控制栏之前播放器下面什么都没有 —— 弹幕开关、输入框、发送键
 * 一起消失三秒，看起来就是「弹幕控件加载特别慢」。
 * 现在只等「播放器挂上」，实测 ~1s 就搬完；观察器仍然盯着两个容器，
 * B 站把发送栏搬回去 / 重建控制栏时会自动再搬一次（见 watchSendingBar）。
 */
const MOVE_DELAY = 700
/** 极端情况（播放器一直没挂上）下的兜底：到点也照搬 */
const MOVE_DEADLINE = 6500
/** 首屏「先做掉的那两件事」的节拍与次数上限（100ms × 60 = 6s：要盖住 B 站 ~3.2s 那次整栏重渲染） */
const EARLY_STEP = 100
const EARLY_MAX_TRIES = 60
/** 观察器补绑只在头 2s 里试（节点一直不出现就别每 100ms 拆绑一次了） */
const EARLY_REBIND_TRIES = 20
/** 「等 #mirror-vdcon 出现」的轮询节拍与上限（100ms × 100 = 10s） */
const WAIT_STEP = 100
const WAIT_MAX_TRIES = 100

/** 关注按钮的文字：「关注 1882.4万」/「已关注 1882.4万」——B 站没有单独的计数元素 */
const FANS_RE = /^([\s\S]*?)\s*([\d.]+[万亿]?)$/

/** 弹幕发送栏：窗口态挂在播放器下面那 56px 里，全屏态挂在控制栏中间 */
const SEND_AREA = '.bpx-player-sending-area'
const SEND_BAR = '.bpx-player-sending-bar'
const CTRL_CENTER = '.bpx-player-control-bottom-center'
/** 搬不动时的重试窗口：退出网页全屏时控制栏会整块重建，那一瞬间找不到中间那块 */
const BAR_RETRY_MS = 2400
const BAR_RETRY_STEP = 120

/** 挂在 <html> 上：告诉 CSS「原标签行可以藏了」（没标签的稿件要留着那条音乐标签） */
const TOPICS_ON = 'bili-elite-vb-topics-on'
/** 真链接那一串（顶栏挂稳之后才插，见 applyTopicsLive） */
const TOPICS_CLASS = 'bili-elite-vb-topics'
/** 挂在 <html> 上：真链接已就位，CSS 把伪元素那串收起来 */
const TOPICS_LIVE = 'bili-elite-vb-topics-live'
/**
 * 「B 站自己渲染完了」的判据（插真链接的门槛）。
 *
 * B 站首屏在 ~3.7s 会做一次整栏重渲染，顶栏那次 mount 就挂在它上面 —— 只要标题里多一个
 * 它不认识的节点，那次 patch 就失败（`nextSibling` → `#biliMainHeader` 空盒子）。
 * 所以不能按固定秒数等，要等两个条件：
 *   1. `#biliMainHeader` 已经有孩子（顶栏挂上了）；
 *   2. 我们盯的那几个容器连续 `SETTLE_QUIET_MS` 没有变动（它自己那轮重渲染过去了）。
 * `SETTLE_FLOOR_MS` 只是个下限，防止在更早的空档里误判。
 */
const SETTLE_QUIET_MS = 800
/**
 * 下限 4.5s 是实测出来的：B 站首屏在 **~3.7s** 还会做一次整栏重渲染，而顶栏那次 mount 就挂在这上面 ——
 * 只要标题里多一个它不认识的节点，3.7s 那次 patch 就会失败、`#biliMainHeader` 变成空盒子。
 * 按 1s / 3s / 5s / 7s 分别插一次，顶栏都是在 3.7~3.9s 塌的（插得早的那次节点还被冲掉了），
 * 所以必须等它过去。4.5s 是「3.7s + 余量」。
 */
const SETTLE_FLOOR_MS = 4500
const SETTLE_MAX_MS = 12000
const SETTLE_STEP = 120
/** 真标签：`.tag-panel` 里还混着「发现《xxx》」那颗音乐标签（.bgm-link），那个不要 */
const TAG_SELECTOR = '.video-tag-container .tag-panel a.tag-link:not(.bgm-link)'
/** 话题串落地的那一行（播放数据：播放量 / 弹幕 / 日期） */
const DESC_LIST = '.video-info-detail-list'
const META_SELECTOR = '.video-info-meta'
/** 标题：卡片的位置锚点（不变量：卡片顶边 = 标题底边 + UP_GAP） */
const TITLE_SELECTOR = '.video-info-title'
/** 简介卡：没有简介时的占位、收起态的「可点 / 高亮」（收起展开本身交给 B 站，见 videoBeta.css §11） */
const DESC_ID = 'v_desc'
const DESC_INFO = '.basic-desc-info'
const NODESC_CLASS = 'bili-elite-vb-nodesc'
/**
 * B 站原生的「展开更多 / 收起」按钮：`#v_desc` 的**直接子级**。
 * B 站 video-desc-container 组件里它是 `ifDescInfoCanBeFolded ? <div class="toggle-btn"> : null`，
 * 位置在简介左下角。我们只负责点它，绝不替换它。
 */
const DESC_TOGGLE = ':scope > .toggle-btn'
/** 「展开更多 / 收起」按钮的涟漪选择器（1.2.5 v029）：同一颗原版按钮，closest 能带 > 子级选择器 */
const DESC_RIPPLE = '#v_desc > .toggle-btn'
/** B 站此刻处于收起态（可展开）：整张卡可点、悬停高亮（1.2.5 v033 恢复） */
const DESC_FOLDED = 'bili-elite-vb-desc-folded'
/**
 * 「这篇简介根本不用展开」：正文在当前宽度下整段都装得进 B 站的折叠高度。
 * 挂上之后 CSS 把行内 height 放开、把「展开更多 / 收起」藏掉（判定见 needDescFit）。
 * 状态类挂 `<html>` 上而不是 `#v_desc` 上：Vue 换掉那个节点时类不会丢。
 */
const DESC_FIT = 'bili-elite-vb-desc-fit'
/** B 站的折叠阈值：3.5 行（实测 1600 宽 84px = 3.5×24、2200 宽 91px = 3.5×26） */
const DESC_FOLD_LINES = 3.5
/** 卡片上内边距（要跟着播放数据那一行的高度走） */
const DESC_TOP_VAR = '--bili-vb-desc-top'
/**
 * 左栏 sticky top 的**兜底值**。B 站是「第一次滚动时才写行内 top」的，在那之前左栏钉不住，
 * 卡片自然也跟着滚走（用户报的「UP 主控件被滚轮带走」）。行内样式优先级更高，B 站一写就接管。
 */
const LEFT_TOP_VAR = '--bili-vb-left-top'
/** 卡片顶边离标题底边多少（v019 从 10 收到 8） */
const UP_GAP = 8
/**
 * 卡片「位置已经量出来了」才显示。首屏前几百毫秒标题还没排版（甚至高度是 0），
 * 那时 up-y 要么没有（卡片贴在右栏顶上）、要么按 0 高的标题算（卡片压在标题上）——
 * 用户看到的「刚打开网页控件挤在一起」。这个类由 layoutUp 挂上，CSS 里负责先藏起来。
 */
const UP_READY = 'bili-elite-vb-up-ready'
/**
 * 多人合作投稿（创作团队）：面板结构完全是另一套 —— 单 UP 是
 * `.up-avatar-wrap + .up-info-container`，多人是 `.members-info-container`（横幅 + 成员卡）。
 * 这个类只负责告诉 CSS「现在是多人」，布局怎么改见 videoBeta.css §6.5。
 */
const MULTI_CLASS = 'bili-elite-vb-multi'

/** 布局节点的观察器（左栏 / 右栏 / UP 主卡片的位置） */
let observer: MutationObserver | null = null
/** #viewbox_report / 标签行是否已经挂上观察器（这两个节点比 #mirror-vdcon 晚一拍到，见 pumpEarly） */
let boundReport = false
let boundTags = false
/** 当前观察器盯着的三个宿主（mirror / 左栏 / 右栏）：还是同一批就别重建观察器 */
let boundNodes: [HTMLElement, HTMLElement, HTMLElement] | null = null
/** 当前盯着简介的那个节点（换 P 时 Vue 会整块换掉它） */
let descTarget: HTMLElement | null = null
/** 盯简介卡尺寸的观察器：窗口一变宽，正文行数就变（见 needDescFit） */
let descSizeObserver: ResizeObserver | null = null
let descSizeTarget: HTMLElement | null = null
let rafDesc = 0
/** 简介节点换了几次：进「要不要展开」那把缓存的 key（换了节点必须重量） */
let descGen = 0
/** 上一次判「装得下吗」用的形状，以及那次算出来的结论（见 syncDesc） */
let descFitKey = ''
let descFit = false
/** ResizeObserver 报过尺寸变化 → 缓存作废，下一次 syncDesc 必须重量 */
let descFitStale = true
/**
 * 「请 B 站重新判一次简介折叠」的定时器（见 scheduleDescRejudge）。
 * 只在窗口宽度真的变了、而且刚才简介是「装得下」状态时才排一次。
 */
let descRejudgeTimer = 0
/** 「等 #mirror-vdcon 出现」的轮询定时器：document_start 时播放页还是空的（见 watchForLayout） */
let waitTimer = 0
let waitTries = 0
/** UP 主卡片内部的观察器：关注状态一变，B 站会把按钮连同文字整个重渲染 */
let upObserver: MutationObserver | null = null
let upTarget: HTMLElement | null = null
/** 「卡片该现身了」的兜底定时器：标题一直不出现（页面结构变了）也不能永远藏着 */
let readyTimer = 0
/** 盯左栏行内 top 的观察器（B 站自己写，见 syncUpPin） */
let stickyObserver: MutationObserver | null = null
let stickyTarget: HTMLElement | null = null
/** 上一次写进 --bili-vb-up-top 的值：没变就别重复写，免得来回触发样式重算 */
let lastStickyTop = ''
/** 上一次写进 --bili-vb-left-top / --bili-vb-desc-top 的值，同样只写变化 */
let lastLeftTop: number | null = null
let lastDescTop = 0
/** 盯「尺寸会变但不触发 mutation」的节点（播放器挂上、标题折行、评论加载） */
let sizeObserver: ResizeObserver | null = null
let sizeTargets: HTMLElement[] = []
let rafSize = 0
let offScreen: (() => void) | null = null
let resizeBound = false
/** scrollend / visibilitychange 兜底监听是否已挂（见 onScrollEnd） */
let healBound = false
/** 盯 <html> 尺寸的观察器：抓「纵向滚动条出现 / 消失」导致的 clientWidth 变化 */
let viewportObserver: ResizeObserver | null = null
/** 上一次 measure() 用的视口宽（用来判断宽度是不是真变了，避免高度变化也重算） */
let lastVw = 0
/** 嵌入模式当前是不是两栏（measure 里带滞回地维护，见 computeEmbedSplit） */
let embedSplitOn = false
/** 嵌入模式首帧音量护栏的观察器与定时器（见 guardEmbedAudio） */
let audioGuardObserver: MutationObserver | null = null
let audioGuardTimers: number[] = []
let raf = 0
let rafUp = 0
let rafBar = 0
/** 拖窗口时 resize 一秒几十次，measure() 全是强制排版 —— 一帧最多算一次 */
let rafResize = 0
/*
 * 曾经试过「屏幕模式刚变的那一帧不跑 layoutUp，推迟到下一帧」（1.1.6 v001），已回滚：
 * 逐帧实测出网页全屏时，卡片会先画在标题上方 363px、下一帧才回位 —— 就是 v008 修掉的
 * 「UP 卡窜一下」。而且推迟并不能缩短总耗时，只是把一个长任务拆成两个
 * （86+106 / 192+132ms），用户多等一帧。别再往这个方向改。
 */
/** 已经排了一次「等水合完再搬」的任务（避免观察器每变一次都排一个） */
let moveArmed = false
let moveTimer = 0
let moveDeadline = 0
/** 发送栏的观察器与当前盯着的两个容器 */
let barObserver: MutationObserver | null = null
let barTargets: HTMLElement[] = []
/** 发送栏「搬不动就再试」的定时器与截止时间（见 pumpSendingBar） */
let barRetryTimer = 0
let barRetryUntil = 0
/** 首屏早做任务的定时器与已试次数（见 pumpEarly） */
let earlyTimer = 0
let earlyTries = 0
/** 上一次写进去的话题串 / 粉丝数：值没变就别重复写 CSS 变量 */
let lastTopics = ''
let lastFans = ''
/** 上一次写进去的「N 人正在看」文本，同样只写变化 */
let lastWatching = ''
/** 上一次判定的「是不是多人合作投稿」：没变就别重复 toggle（toggle 会触发样式重算） */
let lastMulti: boolean | null = null
/** 盯「N 人正在看」的观察器：发送栏被搬、控制栏重建时 B 站会换掉整个节点，见 watchWatching */
let watchObserver: MutationObserver | null = null
let watchTarget: HTMLElement | null = null
/** 左栏最后一次变动的时刻（观察器里更新）：用来判断 B 站那一轮重渲染过去了没有 */
let lastTreeChange = 0
/** 真链接已经挂上（挂上之后观察器才允许补，之前一律不碰 DOM） */
let settled = false
let settleTimer = 0
let settleUntil = 0
/** 简介卡的点击委托是否已挂上（挂在 document 上，Vue 换掉 #v_desc 也不用重绑） */
let descClickBound = false
/** 简介按钮涟漪的卸载函数（挂在 document 上，见 start/stop） */
let offDescRipple: (() => void) | null = null

function clamp(min: number, value: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = videoBetaCss
  ;(document.head || document.documentElement).appendChild(style)
}

/** 写 `<html>` 上的布局变量；值没变就不动（见 measure 里的注释） */
function setRootVar(name: string, value: string) {
  const style = document.documentElement.style
  if (style.getPropertyValue(name) === value) return
  style.setProperty(name, value)
}

/**
 * 这一页是不是被「动态悬浮窗」嵌进来的（见 index.ts 的 isEmbeddedVideoFrame）。
 *
 * 标记在 URL 上（`blie_embed=1`）—— 视频页和动态页跨源，父页面改不到 iframe 里的样式，
 * 只能由 iframe 里的自己认出「我是被嵌进来的」。
 *
 * 嵌入模式只改三件事：**右栏整条不显示**（推荐列表在 1280 宽的悬浮窗里纯属噪音，左栏吃满）、
 * **顶部按 EDGE 留白**（没有 B 站顶栏了）、**左栏 sticky 钉到窗口顶部**。
 * 其余（经典版信息区 / 播放器尺寸 / 评论）与正常播放页完全一致。
 */
export function isEmbedMode() {
  return window.top !== window.self && new URLSearchParams(location.search).has('blie_embed')
}

/**
 * 嵌入模式（悬浮窗里的视频页）下播放页优化**强制生效**：悬浮窗本身就是「要用我们这套
 * 播放页」的表达，用户关掉「播放页优化」不该让悬浮窗里变成半套布局。
 * 其余情况一律看开关。
 */
let betaForced = false
function betaOn() {
  return betaForced || !!get('videoBeta')
}

/**
 * 半顶栏此刻该不该生效：三个开关全开才算（见 ROOT_HALF 的注释）。
 * 读的是内存里的 config（`get`），不碰 DOM —— 观察器 / ResizeObserver 里也能安全调用。
 */
function halfTopbarOn(): boolean {
  // 嵌入模式没有自绘顶栏（那个 iframe 里一个模块都没装），半顶栏无从谈起
  if (isEmbedMode()) return false
  return !!betaOn() && !!get('customTopbar') && !!get('videoHalfTopbar')
}

/**
 * 切半顶栏的 root class。**class 一变就得重新量一遍**：左右栏间距从 24 收到 12、
 * 左栏还要再上移 64px（CSS 那半），播放器尺寸跟着变。
 * 先切类再 measure：measure 里读的是 halfTopbarOn()，两边必须同一帧对上。
 */
function applyHalfTopbar() {
  const on = halfTopbarOn()
  const root = document.documentElement
  if (root.classList.contains(ROOT_HALF) === on) return
  root.classList.toggle(ROOT_HALF, on)
  // 切完立刻重算尺寸；`--bili-vb-left-top` 也要跟着刷新（公式里的「顶栏高」变成了 0）
  lastLeftTop = null
  measure()
}

/**
 * 把布局数字写进 CSS 变量。
 *
 * 用 documentElement.clientWidth 而不是 innerWidth：后者含纵向滚动条（Windows 上 15~17px），
 * 拿它算出来的左栏会宽出一条滚动条，右栏就被挤到下一行去。
 *
 * 左右 padding 就是同一个 gutter，**别去减滚动条**。曾经试过「右侧扣掉滚动条宽度、
 * 左侧补上」让两边视觉留白严格相等，但 Windows 上滚动条 17px 比 gutter 还宽，
 * 结果右侧 padding 被扣成 0 —— 右栏直接贴在滚动条/窗口边缘上，看起来像「跑到屏幕外面去了」。
 * 滚动条本来就是灰的、贴着窗口边缘，当成留白的一部分反而更自然。
 *
 * 高度就是 16:9 —— 弹幕发送栏（`.bpx-player-sending-area`，播放器下面那条 56px 的
 * 「N 人正在看 + 弹幕输入框」）在 beta 里是藏起来的，不再需要给它留位置。
 *
 * 半顶栏（§12）只改一个数：左栏上移 64px（上方那道空隙由 §1 的 padding-top 出，
 * 非半顶栏时它是 0），左右栏间距和两侧留白已经是同一个数了，不用再动。
 */
/**
 * 嵌入模式要不要排两栏，以及播放器该多大。
 *
 * 两栏的宽度分配：
 *   · 信息栏取 `clamp(440, 28%, 620)`（和 dynamicOverlay.ts 的 videoWidthFor() 同一组数）；
 *   · 播放器按窗口高度算 16:9（`(视口高 − 2×EDGE) × 16/9`），但不能超过剩下的宽度；
 *   · 剩下的宽度连 `SPLIT_VIDEO_MIN` 都不到，就退回单栏。
 *
 * **滞回**：滚动条出现 / 消失会让 `clientWidth` 变 15px 左右。切进两栏后要再窄
 * `SPLIT_VIDEO_HYSTERESIS` 才退出去，否则正好卡在阈值上会来回切。
 *
 * 返回 null = 单栏；返回尺寸 = 两栏。`embedSplitOn` 是模块级的，stop() 里会复位。
 */
function computeEmbedSplit(vw: number, vh: number, gutter: number, gap: number) {
  if (!vw || !vh) {
    embedSplitOn = false
    return null
  }
  const infoW = clamp(SPLIT_INFO_MIN, vw * SPLIT_INFO_RATIO, SPLIT_INFO_MAX)
  const availPlayerW = vw - gutter * 2 - gap - infoW
  const threshold = embedSplitOn ? SPLIT_VIDEO_MIN - SPLIT_VIDEO_HYSTERESIS : SPLIT_VIDEO_MIN
  if (availPlayerW < threshold) {
    embedSplitOn = false
    return null
  }
  embedSplitOn = true
  // 高度优先：先让播放器铺满可用高度，再看宽度够不够；取两者较小值，16:9 不会变形
  const videoW = Math.min((vh - EDGE * 2) * 16 / 9, availPlayerW)
  return { videoW, videoH: (videoW * 9) / 16 }
}

function measure() {
  const root = document.documentElement
  const vw = root.clientWidth
  if (!vw) return
  // 宽度真的变了才可能在下面排一次「请 B 站重判简介」（见 scheduleDescRejudge）
  const prevVw = lastVw
  lastVw = vw

  // 两侧留白 / 左右栏间距 / 顶部留白：同一个数（EDGE），不再随窗口宽度变
  const gutter = EDGE
  const gap = EDGE
  // 嵌入模式（悬浮窗里的视频页）**没有右栏推荐**：rail 归零，左栏吃满整个宽度
  const embed = isEmbedMode()
  const railWanted = embed ? 0 : Math.round(clamp(RAIL_MIN, vw * RAIL_RATIO, RAIL_MAX))
  const half = halfTopbarOn()
  // 窗口窄到「左栏下限 + 右栏」放不下时先收右栏：左栏是硬下限（再窄播放器就不能看了），
  // 不先收右栏的话整行会比视口还宽，右栏直接被挤出屏幕（表现就是「右边跑到屏幕外面去了」）
  const rail = embed ? 0 : Math.max(RAIL_TIGHT, Math.min(railWanted, vw - gutter * 2 - gap - LEFT_MIN))
  const left = embed ? vw - gutter * 2 : Math.max(LEFT_MIN, vw - gutter * 2 - rail - gap)
  /**
   * 高度 = 宽 × 9/16，**不取整**（1.1.6 v020）。
   *
   * 取整会让播放器容器的宽高比和视频的 1920:1080 差一点点，而 B 站的 video 是
   * `object-fit: contain` —— 差多少，右边就露多少 `.bpx-player-video-area` 的黑底。
   * 1885 宽取整成 1060（正确值 1060.3125）时，视频实际只画到 1884.4，
   * 最右边那一列就成了 89% 黑的一条竖线（用户报的「播放器右侧黑边」）。
   *
   * 为什么开半顶栏才看见：`left` 多出那 12px 改变了小数部分，四舍五入**进位**时
   * 误差跑到下边（被控制栏的深色渐变盖住），**舍去**时就跑到右边（对着页面白底，一眼就看见）。
   * 取整误差最大 0.5px 高 → 0.89px 宽，所以它永远只是一条 1px 的线，不是大黑边。
   */
  const playerH = (left * 9) / 16

  // 嵌入模式（悬浮窗里的视频页）：宽度够就排成「左播放器 / 右信息」两栏。
  // 非嵌入模式永远单栏；类先切好，下面 layoutUp() 读栅格列宽时才是新布局。
  const embedSplit = embed ? computeEmbedSplit(vw, root.clientHeight, gutter, gap) : null
  if (!embed)
    embedSplitOn = false
  root.classList.toggle(ROOT_EMBED_SPLIT, !!embedSplit)

  // 值没变就别写：`<html>` 上的自定义属性一变，整棵树都要重新匹配一遍样式 ——
  // 拖窗口 / 滚动条出现消失都会走到这里，多数时候那几个数一个都没变。
  setRootVar('--bili-vb-gutter', `${gutter}px`)
  setRootVar('--bili-vb-gap', `${gap}px`)
  // 播放器顶部那道白：**只有半顶栏才留**（1.2.1）。非半顶栏时顶栏还实打实占着上方那
  // 64px，再留 10px 就是顶栏和画面之间一条白缝 —— 用户明确要求去掉（画面直接贴着顶栏）。
  // 它不能跟 gutter 共用一个变量：沉浸式（宽屏 / 全屏）要把它清掉，
  // 而两侧留白在那些模式下也本来就不归我们管。
  // 嵌入模式没有 B 站顶栏，顶部要留 EDGE，否则播放器直接贴着窗口边缘
  setRootVar('--bili-vb-top-gap', half || embed ? `${EDGE}px` : '0px')
  setRootVar('--bili-vb-rail', `${rail}px`)
  setRootVar('--bili-vb-left', `${left}px`)
  setRootVar('--bili-vb-player-h', `${playerH}px`)
  // 两栏时播放器单独占左边一列，尺寸按窗口高度算（见 computeEmbedSplit）；
  // 单栏时写 0，CSS 里两栏规则不匹配，这两个变量不参与任何计算。
  setRootVar(VIDEO_W_VAR, embedSplit ? `${embedSplit.videoW}px` : '0px')
  setRootVar(VIDEO_H_VAR, embedSplit ? `${embedSplit.videoH}px` : '0px')
  // 左栏上移多少。**半顶栏时就是整个顶栏高 64**：上方那道空隙（半顶栏 10px、非半顶栏 0）
  // 由 `#mirror-vdcon` 的 padding-top 出，左栏只是把顶栏那 64px 让出来。
  // 见 HALF_SHIFT_VAR 的注释：UP 卡的 margin-top 也要靠它换算，所以哪怕 CSS 只在这一处用，
  // 也得由 measure 统一写。
  setRootVar(HALF_SHIFT_VAR, half ? `${HALF_TOPBAR_H}px` : '0px')
  // 左右栏宽度变了，UP 卡片的宽度 / 位置跟着变（节点还没到时 layoutUp 自己会返回）
  layoutUp()
  // 宽度变了、而且刚才简介是「装得下」状态 → 让 B 站重新判一次折叠（见 scheduleDescRejudge）
  if (prevVw && prevVw !== vw && descFit)
    scheduleDescRejudge()
}

/**
 * 请 B 站重新判一次「简介要不要折叠」。
 *
 * 为什么需要：B 站自己的 resize 处理**跑在我们更新左栏宽度之前** —— 那一刻栅格还是旧宽度，
 * 正文看起来「装得下」，它就把「展开更多」永久摘掉（inline height 也写成 auto）；等我们
 * 把宽度改小，它不会再判第二次。表现就是「大窗口切回窄窗口之后，简介永远展开、收不起来」
 * （实测 1200 → 2200 → 1200：fit 撤销了，但按钮没了）。
 *
 * 延后 260ms 有两个原因：躲开 B 站自己那次（可能带节流的）处理，以及等这一帧布局落定 ——
 * 我们自己的 measure 是被 rAF / ResizeObserver 叫起来的，写完变量时 B 站已经量过了。
 * 只补一次：dispatch 出来的 resize 会让 measure 再跑一遍，那时 prevVw === vw，不会再排。
 */
function scheduleDescRejudge() {
  if (descRejudgeTimer)
    clearTimeout(descRejudgeTimer)
  descRejudgeTimer = window.setTimeout(() => {
    descRejudgeTimer = 0
    window.dispatchEvent(new Event('resize'))
  }, 260)
}

function clearVars() {
  const style = document.documentElement.style
  for (const name of [
    '--bili-vb-gutter',
    '--bili-vb-gap',
    '--bili-vb-top-gap',
    '--bili-vb-rail',
    '--bili-vb-left',
    '--bili-vb-player-h',
    VIDEO_W_VAR,
    VIDEO_H_VAR,
    HALF_SHIFT_VAR,
    UP_Y_VAR,
    UP_W_VAR,
    UP_H_VAR,
    UP_TOP_VAR,
    DESC_TOP_VAR,
    LEFT_TOP_VAR,
  ])
    style.removeProperty(name)
}

/**
 * 一帧要用的几何，**一次读完**再交给下面那些函数用。
 *
 * 存在的唯一理由见 layoutUp 顶部那段注释：`<html>` 上的自定义属性一变，整棵树都要重新
 * 匹配样式；如果「写变量 → 紧接着读 rect」，浏览器会被逼着**立刻**做一次同步重算
 * （实测 10.5ms / 3300 个元素）。所以所有读取必须先集中在这里，写一律排在后面。
 */
interface Geom {
  /** 左栏此刻是不是真 sticky（B 站挂 `.scroll-sticky` 之后才是） */
  sticky: boolean
  rect: DOMRect
  height: number
  /**
   * 左栏的包含块还有多少余量可推：`mirror 高 − 左栏高`，**< 1 表示它根本钉不住**。
   *
   * sticky 的位移被包含块夹住，左栏的包含块是 `#mirror-vdcon`，而 mirror 的高度 =
   * max(左栏, 右栏)。所以左栏一旦比右栏高（评论加载完必然如此），mirror 底下就一点余量
   * 都没有：它连一个像素都推不下去，整栏跟着页面滚、**永远不钉住**。实测（真实 Chrome /
   * 685 视口 / 4320 右栏）：左栏 1141 → room 3179、钉在 -456；评论加载完左栏 7468 →
   * room 0、永不钉住。
   *
   * 这个数只跟「高度」有关，滚动时不变，所以可以当常量用（别用 bottom 相减 —— 左栏钉住时
   * 两者会一起滚，差值会缩到 0，那会把「正钉着」误判成「钉不住」）。
   *
   * **余量 0 时卡片必须一起不钉**，否则它会照上一个布局状态的 top 停在半空 ——
   * 用户报的「UP 控件刚加载完的一瞬间下滑滚轮、控件跑到评论区」就是它：
   * B 站的行内 top 还停在左栏只有 700 高时算出来的 -33，卡片就钉在 -33 + 613 = 580，
   * 而标题已经滚到视口顶上了。
   */
  room: number
}

function readGeom(left: HTMLElement): Geom {
  const sticky = getComputedStyle(left).position === 'sticky'
  const rect = left.getBoundingClientRect()
  const mirror = document.getElementById(MIRROR_ID)
  // mirror 被 Vue 换掉的那一帧 room 记 0（不是正无穷）：以前返回 Infinity 等于「左栏随便钉」，
  // 可那一帧恰恰是 `--up-top` 最容易算错的时候 —— 卡片会带着一个过期位置留在半空。
  // 记 0 = 这一帧先别钉，等 mirror 回来下一轮重算，最多丢一帧。
  const room = mirror ? mirror.getBoundingClientRect().height - rect.height : 0
  return { sticky, rect, height: Math.round(rect.height), room }
}

/**
 * UP 卡片的几何 —— 卡片**没有搬 DOM**，靠 `position:sticky` + 外边距 + translate 画到左栏第 3 行，
 * 所以要四个数：
 *
 *   `--bili-vb-up-y`    卡片顶边（**相对左栏顶边**）= 标题底边 + 10，同时是它的 margin-top
 *   `--bili-vb-up-w`    左栏第 1 列的宽度（第 2 列是操作栏，别压上去）
 *   `--bili-vb-up-h`    卡片自身高度（CSS 用它算 margin-bottom 和左栏第 3 行的占位）
 *   `--bili-vb-up-top`  钉住时的 sticky top（见 syncUpPin）
 *
 * 关注按钮不在这里定位 —— B 站本来就是「名字块 + 按钮」同一个 flex 行，改 flex 就行（§6）。
 * 宽高都不依赖 `--bili-vb-up-y`，所以写变量不会引起「改位置→改高度→再改位置」的抖动。
 * 节点没齐就原样返回，CSS 里有兜底值。
 *
 * **本函数里「读」必须全部排在「写」前面**（1.2.0 v003 的性能修复）。
 * 以前是 `syncLeftTop → syncUpPin → 读 meta → 读 title/up → syncUpPin`，读写交错四轮，
 * 每一轮「写完再读」都是一次强制同步重算。首屏 B 站水合那一秒里标题 / 卡片高度每帧都在变，
 * 变量几乎每次都要真的写进去 —— 于是每帧白烧 30~40ms，实测播放页 LCP 因此晚 250ms、
 * 最长任务从 340ms 涨到 380~450ms（这就是「1.2.0 之后播放页打开 / 切视频变慢」的大头）。
 * 现在读全做完再统一写：变量变化并进浏览器本来就要做的那一次重算，额外开销≈0。
 */
function layoutUp() {
  // 别在这里加「切换那一帧先不跑」的守卫（v001 试过，回滚了）：退出沉浸式的那一帧
  // 卡片会带着空的 --up-top 画出来，飞出去 363px 再回位。

  // ===== 1. 读（全部） =====
  const left = document.querySelector<HTMLElement>('.left-container')
  if (!left) return
  const geom = readGeom(left)
  const meta = document.querySelector<HTMLElement>(META_SELECTOR)
  const metaH = meta ? meta.getBoundingClientRect().height : 0
  const title = document.querySelector<HTMLElement>(TITLE_SELECTOR)
  const up = document.querySelector<HTMLElement>(UP_SELECTOR)
  const titleRect = title ? title.getBoundingClientRect() : null
  const upRect = up ? up.getBoundingClientRect() : null
  const cols = (geom.sticky || isEmbedMode()) ? getComputedStyle(left).gridTemplateColumns.split(' ') : []

  // ===== 2. 算 =====
  // 左栏 sticky top 的兜底值：播放器挂上 / 评论加载都会改左栏高度，得跟着重算
  const leftTop = geom.sticky ? leftPinTop(left, geom.height) : null
  // 简介卡的上内边距 = 播放数据那一行的高度 + 20（12 上边距 + 8 间隙）。这一行后面接了
  // 话题串，标签多了会折行变高 —— 写死 44px 就会被压到简介正文上。
  const descTop = meta ? Math.round(metaH) + 20 : null
  // 别用宽度当「面板渲染了没」的判据：卡片宽度来自 --bili-vb-up-w，万一先写进去一个 0，
  // 这里就永远返回、up-w 再也更新不回来（实测窄窗口就是这么卡死的）。高度更可靠。
  // 标题同理：**高度 0 时量出来的 up-y 是「标题顶边」**，卡片会直接压在标题上 ——
  // 宁可这一轮不写（CSS 里有兜底值），等下一次（pumpEarly / ResizeObserver）再量。
  //
  // 基准是**左栏**，不是 #mirror-vdcon：左栏自己会 sticky，相对 mirror 的坐标随滚动漂移，
  // 量出来的 up-y 就会跟着错（v015 那一版「UP 主控件跟着滚轮上下动」就是这么来的）。
  // 标题和左栏在同一个 sticky 盒子里，两者相减恒等于「标题底边到左栏顶边的距离」。
  let upY: number | null = null
  let upH = 0
  if (upRect && titleRect && upRect.height && titleRect.height) {
    upY = Math.round(titleRect.bottom - geom.rect.top + UP_GAP)
    upH = Math.round(upRect.height)
  }

  // ===== 3. 写（全部） =====
  const leftTopChanged = applyLeftTop(geom.sticky, leftTop)
  if (descTop !== null && descTop !== lastDescTop) {
    lastDescTop = descTop
    document.documentElement.style.setProperty(DESC_TOP_VAR, `${descTop}px`)
  }
  if (upY !== null) {
    setRootVar(UP_Y_VAR, `${upY}px`)
    setRootVar(UP_H_VAR, `${upH}px`)
    // 只写**正数**：首帧左栏还没排版，量出来是 0px，写进去卡片就变成 0 宽了
    const col0 = cols[0]
    if (col0 && col0.endsWith('px') && Number.parseFloat(col0) > 0)
      setRootVar(UP_W_VAR, col0)
  }

  // ===== 4. 卡片钉在哪 =====
  // **排在所有早退之前**（v003）：上面的分支会因为「标题 / 卡片高度是 0」跳过，
  // 把这一步放在它们后面的话，`--up-top` 会在那些帧里僵住 —— 见 syncUpPin 的注释。
  // upY 为 null 时 syncUpPin 自己会退回上一次写进去的值，和以前的「先调一次无参」等价。
  //
  // `--left-top` 刚变过的那一帧不能复用旧 rect：左栏位置变了，卡片要按新位置算。
  // 这是唯一一处「写完还得再读」，而且只在 left-top 真的变了的那几帧发生（不是每帧）。
  const pinRect = leftTopChanged ? left.getBoundingClientRect() : geom.rect
  syncUpPin(left, upY ?? undefined, { ...geom, rect: pinRect })

  // 位置量出来了才让卡片现身（CSS 里默认 visibility: hidden）
  if (upY !== null)
    document.documentElement.classList.add(UP_READY)
}

/**
 * 左栏钉住时的**视口 top** —— 这是个常量，不随滚动变（滚动里唯一会变的是「钉住了没有」）。
 *
 * 取值顺序：
 *   1. B 站自己写的行内 top（`min(视口高 − 左栏高, 顶栏高)`，实测 685 视口 / 987 左栏 → `-302px`）；
 *   2. 它还没写（首屏 / 加载期）就用同一个公式兜底，见 syncLeftTop。
 *
 * **必须和左栏用同一个数字**：卡片钉在「它 + up-y」处，左栏钉在「它」处，
 * 两边钉住的时刻才严格同步 —— 谁多一像素，卡片就在标题下面错一像素。
 *
 * **别用 `getBoundingClientRect().top`**（v022 的弯路）：那是「此刻渲染在哪」，
 * 左栏没钉住时它跟着滚动跑。拿它当 top，等于把「量的时候的自然位置」当成钉住位置，
 * 卡片一到那儿就钉死 = 一张不跟滚动的悬浮窗（用户报的第一个 bug）；
 * 于是只能再挂个滚动回调每帧去改 —— 那正是 v023 删掉的东西。
 */
function leftPinTop(left: HTMLElement, knownHeight?: number): number | null {
  // 高度由调用方传进来时别再量一遍：layoutUp 里已经读过左栏 rect，
  // 而这一行后面紧跟的 `offsetHeight` 会让「刚写完变量」的那一帧再重算一次。
  const height = knownHeight ?? Math.round(left.getBoundingClientRect().height)
  if (!height) return null
  const half = halfTopbarOn()
  const embed = isEmbedMode()
  // 播放器顶部那道白：半顶栏 / 嵌入模式 10px、非半顶栏 0（1.2.1，见 measure 里的同一处）
  const topGap = half || embed ? EDGE : 0
  // 半顶栏：左栏上方**没有**顶栏（它只在右栏上方），所以「最多钉到顶栏下沿」这条不成立，
  // 上限就是**上方那道空隙**（= EDGE，1.2.1 起由 `#mirror-vdcon` 的 padding-top 提供，
  // 不再和 margin-top 是同一个数 —— margin-top 现在是整个顶栏高 64）。
  // 行内 top 也不能读 —— B 站写的是「顶栏高」那套公式，半顶栏下它会把左栏往下推 64px，
  // 正好抵消掉上移（CSS 那边用 !important 压着，这里跟着用同一个数，卡片才和左栏钉在同一处）。
  if (!half && !embed) {
    const inline = Number.parseFloat(left.style.top)
    // 行内 top 是 B 站自己算的 `min(视口高 − 左栏高, 顶栏高)`：**正值 = 被顶栏夹住**，
    // 这时要再加上顶部那道白边（半顶栏才不为 0）；**负值 = 左栏比视口还高、由底边决定**，一个像素都别动。
    if (Number.isFinite(inline)) return inline > 0 ? Math.round(inline) + topGap : Math.round(inline)
  }
  // 顶栏在首屏会先渲染成 91px 的「大banner」再收成 64，夹的时候按 64 算（不然左栏会被推下去 27px）。
  // 非半顶栏时再加上顶部那道白（1.2.1 起是 0：播放器直接贴着顶栏下沿）。
  // 嵌入模式没有 B 站顶栏（被嵌入 CSS 藏了），直接钉到窗口顶部那道 EDGE 白边。
  const headerH = half || embed
    ? topGap
    : Math.min(document.getElementById('biliMainHeader')?.offsetHeight || 64, 64) + topGap
  return Math.min(Math.round(document.documentElement.clientHeight - height), headerH)
}

/**
 * 左栏 sticky top，公式和 B 站一致：`min(视口高 − 左栏高, 顶栏高)`。
 * 左栏比视口高时是负值（滚到底才钉住），比视口矮时夹到顶栏下沿（否则会滑到顶栏底下）。
 *
 * **1.2.0 起两种模式都靠这个变量**（CSS 那边加了 !important，见 videoBeta.css §2 / §12）：
 * 以前非半顶栏让 B 站行内值接管，半顶栏一钉住就把刚上移的左栏又推回 64px。
 * 现在值 = B 站那套 + 顶部白边（**只有半顶栏才有这 10px**，1.2.1 起非半顶栏是 0；
 * 只对正值加，负值原样）。
 *
 * 只给 `watchLeftSticky` 用（B 站改左栏行内 top / 挂 `.scroll-sticky` 的那一刻）：
 * 读一次几何，把 `--left-top` 和卡片的 `--up-top` 一起更新 —— 两件事本来就绑在一起，
 * 分成两次调用的话第二次读会撞上第一次刚写进去的变量（一次整棵文档的强制重算）。
 */
function syncLeftTop(left: HTMLElement) {
  const geom = readGeom(left)
  // **只有真的 sticky 才能写 top**：B 站给左栏挂 `.scroll-sticky` 之前它是 `position: relative`，
  // 这时 top 会被当成相对偏移，把整栏往上/往下推几十像素 —— 卡片是按右栏算的，跟不上，
  // 于是「刚打开网页各种控件挤在一起」（实测首屏 300ms 时顶栏还是 91 高、左栏被推下去 27px）。
  const changed = applyLeftTop(geom.sticky, geom.sticky ? leftPinTop(left, geom.height) : null)
  syncUpPin(left, undefined, changed ? { ...geom, rect: left.getBoundingClientRect() } : geom)
}

/**
 * 写 `--bili-vb-left-top`。返回**这一帧到底有没有改它** —— layoutUp 靠这个返回值判断
 * 卡片那一步要不要重新读一次左栏 rect（改过就得读，没改就能复用刚读到的几何）。
 *
 * 语义和 1.2.0 v002 之前逐字一致：
 *   · 不是真 sticky → 撤掉变量（撤过一次就不重复撤）；
 *   · `leftPinTop` 量不出来（高度 0）→ **保持原值不动**，别把上一帧的值清掉；
 *   · 值没变 → 不写（写一次就是一次整棵文档的样式重算）。
 */
function applyLeftTop(sticky: boolean, value: number | null): boolean {
  const root = document.documentElement
  if (!sticky) {
    if (lastLeftTop === null) return false
    lastLeftTop = null
    root.style.removeProperty(LEFT_TOP_VAR)
    return true
  }
  if (value === null || value === lastLeftTop) return false
  lastLeftTop = value
  root.style.setProperty(LEFT_TOP_VAR, `${value}px`)
  return true
}

/**
 * 盯「尺寸会变、但不产生 mutation」的几个节点：播放器挂上（`#playerWrap` 从 0 长到 16:9）、
 * 标题折行、评论加载（左栏变高 → sticky top 要重算）。
 *
 * 这些变化以前完全抓不到 —— `layoutUp()` 只在 childList 变动时跑，于是播放器一挂上，
 * 标题被顶下去 500px，`--bili-vb-up-y` 还停在旧值：UP 主卡片浮在半空、跟谁都对不上
 * （用户截图里「卡片孤零零在下面、还被滚轮带走」就是它）。
 * 回调里不直接改布局（会触发 `ResizeObserver loop` 警告），甩到下一帧。
 */
function watchSizes() {
  if (typeof ResizeObserver === 'undefined') return
  const targets = [
    document.querySelector<HTMLElement>('.left-container'),
    document.getElementById('playerWrap'),
    document.querySelector<HTMLElement>(TITLE_SELECTOR),
    // 卡片自己的高度也要盯：它在加载期会从 48 长到 80（头像 / 粉丝数 / 关注按钮陆续到位），
    // --up-h 停在旧值的话左栏第 3 行的占位就短了，简介卡会被拉到卡片身上（叠字）。
    document.querySelector<HTMLElement>(UP_SELECTOR),
    // mirror 的高度决定「左栏有没有余量钉住」（见 Geom.room）：右栏推荐加载完会让它变高，
    // 左栏从「钉不住」变成「钉得住」，这时卡片得跟着改。
    document.getElementById(MIRROR_ID),
  ].filter((el): el is HTMLElement => !!el)
  if (!targets.length) return
  if (targets.length === sizeTargets.length && targets.every((el, i) => el === sizeTargets[i])) return
  unwatchSizes()
  sizeTargets = targets
  sizeObserver = new ResizeObserver(() => {
    // **「该不该钉」必须同步判**（v008）：这一步只读 4 个尺寸、只写一个 CSS 变量，
    // 不改动任何被观察元素的尺寸，所以不会触发 RO 循环；但它**不能等下一帧** ——
    // 评论加载完、左栏高度追上 mirror 的那一帧 room 归 0，卡片如果还带着上一轮的
    // `--up-top`，就会在屏幕上「窜」一下。实测（1440×620 / 快速下滑）：
    // scrollY 1750 那一帧 `up.top − title.bottom` 冲到 1410px，下一帧才归位 ——
    // 用户报的「下滑时往上窜 / 悬浮」就是这一帧。RO 回调本身跑在「布局之后、绘制之前」，
    // 在这里写变量，同一帧就能画对，零延迟。
    const left = document.querySelector<HTMLElement>('.left-container')
    if (left)
      syncUpPin(left)
    if (rafSize) return
    rafSize = requestAnimationFrame(() => {
      rafSize = 0
      layoutUp()
    })
  })
  targets.forEach(el => sizeObserver?.observe(el))
}

function unwatchSizes() {
  sizeObserver?.disconnect()
  sizeObserver = null
  sizeTargets = []
  if (rafSize) {
    cancelAnimationFrame(rafSize)
    rafSize = 0
  }
}

/** 读一个 px 变量（如 `--bili-vb-up-y`）：没有 / 不是 px 就返回 null */
function readPxVar(name: string): number | null {
  const raw = document.documentElement.style.getPropertyValue(name).trim()
  if (!raw.endsWith('px'))
    return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * **`--bili-vb-up-top` 的唯一写入方**。
 *
 * 不变量只有一条：**卡片顶边 = 标题底边 + UP_GAP**（验收判据 `up.top − title.bottom === 8`）。
 * 标题在左栏里、左栏自己 sticky，所以「标题此刻渲染在哪」就是唯一的真相 ——
 * **能测到就用测的**，测不到（左栏还没吸住）才用公式推。
 *
 * 三种状态，判据全在左栏身上：
 *   1. 左栏不是真 sticky（B 站还没挂 `.scroll-sticky`）→ 清空（`top: auto`）；
 *   2. 左栏被包含块夹死、已经跟着页面滚（实测比它**该**钉的位置更靠上）→ 清空，
 *      否则卡片会浮在半空压着评论区（用户报的「UP 主信息控件悬浮」）；
 *   3. 其余情况写值：
 *      - 左栏**正吸住**（`leftRect.top ≈ pinned`）→ 直接量 `title.bottom + UP_GAP`；
 *      - 左栏**还没吸住** → `pinned + up-y`。
 *      两者是同一个数：`up-y` 的定义就是「标题底边 − 左栏顶边 + UP_GAP」，左栏一旦吸到
 *      `pinned`，标题底边必然落在 `pinned + up-y − UP_GAP`。区别只在**公式和 B 站实际写的
 *      top 对不上时，实测那一支能自己纠回来** —— 这就是 v008 把「量标题」提为主路径的原因。
 *
 * **为什么要排在最前面**：它以前挂在 `layoutUp()` 的最后，而 `layoutUp` 前面有早退
 * （标题 / 卡片高度为 0 —— Vue 换节点的那几帧必然命中）。那几帧里 `--up-top` 不更新，
 * 只要正好撞上「左栏从钉得住变成钉不住」，变量就**僵在上一轮布局里**，而且**不会自愈**
 * （滚动时 `layoutUp` 根本不跑）。现在它排在所有早退之前。
 *
 * `leftRoom` 那条是**预测**（高度差一变就生效，见 Geom.room 的注释）；
 * `leftRect.top < pinned` 那条是**实测兜底**（左栏已经在滚了）。两条互补，任一命中都不钉。
 * **别在这里判 `pinned < 0`**（v006 的弯路）：左栏比视口高时 pinned 一定是负数，那只是
 * 说明「对齐点在视口上方」，不是错位；一刀切不钉会让左栏照钉、卡片改跟右栏滚，两者当场分家。
 *
 * 1.2.0 v003：几何可以由调用方传进来（`geom`）。layoutUp 里已经读过一遍，
 * 再自己量一次就会撞上「刚写完变量」的那一帧 —— 那是一次整棵文档的强制重算。
 * 不传就自己读（ResizeObserver / stickyObserver 那两条路），语义完全不变。
 */
function syncUpPin(left: HTMLElement, upY?: number, geom?: Geom) {
  // **别给这一步加任何「这一帧先跳过」的守卫**：它是「同一帧画对」的那一道。
  // 一旦跳过，退出沉浸式的那一帧卡片就会带着空 top 出现（实测飞出去 363px 再回位）。
  // 它只读 4 个尺寸 + 写 1 个变量，而且在 RO 回调里跑（布局已经算完，读是缓存命中）。
  const g = geom ?? readGeom(left)
  if (!g.sticky)
    return clearUpTop()
  if (g.room < 1)
    return clearUpTop()
  const y = upY ?? readPxVar(UP_Y_VAR)
  if (y === null)
    return clearUpTop()
  const pinned = leftPinTop(left, g.height)
  if (pinned === null)
    return clearUpTop()
  const leftTop = g.rect.top
  // 左栏本该钉在 pinned，实际却更靠上 → 它已经被包含块夹死、跟着页面滚了
  if (leftTop < pinned - 1)
    return clearUpTop()
  let value = `${Math.round(pinned + y)}px`
  // 左栏正吸住：标题的位置就是真相，直接量它。量不到（标题还没渲染）就退回公式值。
  if (leftTop <= pinned + 1) {
    const bottom = document.querySelector<HTMLElement>(TITLE_SELECTOR)?.getBoundingClientRect().bottom
    if (bottom)
      value = `${Math.round(bottom + UP_GAP)}px`
  }
  if (value === lastStickyTop)
    return
  lastStickyTop = value
  document.documentElement.style.setProperty(UP_TOP_VAR, value)
}

/** 撤掉卡片的 sticky top（左栏没钉住 / 关开关时）：`top: auto` 就是不钉，跟着左栏一起滚 */
function clearUpTop() {
  if (lastStickyTop === 'auto') return
  lastStickyTop = 'auto'
  document.documentElement.style.removeProperty(UP_TOP_VAR)
}

/**
 * 盯左栏的行内 style：B 站只在「钉住位置变了」时才写它（实测 7 次滚动一共写了 3 次），
 * 所以这个观察器几乎不花钱，但能保证卡片和左栏永远钉在同一处。
 */
function watchLeftSticky() {
  const left = document.querySelector<HTMLElement>('.left-container')
  if (!left || stickyTarget === left) return
  stickyObserver?.disconnect()
  stickyTarget = left
  // 只重算「钉不钉 / 钉在哪」（4 个尺寸 + 1 个变量），不再跑整轮 layoutUp：
  // 它唯一要跟的就是 B 站写在左栏上的行内 top，而滚动时 layoutUp 里那 6 个 rect
  // 都是强制排版。B 站滚到底才改一次，但改的那一帧正好在滚动里，能省就省。
  stickyObserver = new MutationObserver(() => {
    syncLeftTop(left)
  })
  // class 也要盯：`.scroll-sticky` 是 B 站后加的，加上的那一刻 position 才变成 sticky
  stickyObserver.observe(left, { attributes: true, attributeFilter: ['style', 'class'] })
}

function unwatchLeftSticky() {
  stickyObserver?.disconnect()
  stickyObserver = null
  stickyTarget = null
  lastStickyTop = ''
}

/**
 * 元素里最后一个「有内容」的文本节点（关注按钮里 svg 在前、文案在后）。
 *
 * 必须**往下递归**找：B 站的「已关注」态把文案又包了一层
 * （`.follow-btn-inner > span.already-btn > svg + 文本`），只翻直接子节点会漏掉它 ——
 * 漏掉的表现就是「已关注的 UP 主，按钮上还挂着粉丝数」。
 * 「未关注」态是老结构（文本直接在 `.follow-btn-inner` 下），两种都要能拿到。
 * `.van-popover`（悬停出来的「设置分组 / 取消关注」那个浮层）里的字不算，整棵跳过。
 */
function lastTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node.nodeValue || '').trim())
        return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest('.van-popover'))
        return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let last: Text | null = null
  let node = walker.nextNode()
  while (node) {
    last = node as Text
    node = walker.nextNode()
  }
  return last
}

/**
 * 把头像的 data-src 落到 src 上。
 *
 * B 站的 bili-avatar 是懒加载的：元素**可见**时才把 `data-src` 写进 `src`。而这块面板在我们
 * 搬过来之前一直是 display:none（videoBeta.css §6），等它变可见时 B 站那个观察器早退场了 ——
 * 结果就是一个透明的空圆，作者头像永远不出来（用户报的「作者头像加载很慢 / 空白」就是它）。
 * 所以搬完补一刀。src 已经有值就别动，B 站自己补上了就让它的。
 */
function kickAvatar(up: HTMLElement) {
  // 用 forEach 而不是 for...of：NodeListOf 要 dom.iterable 才能迭代，这个仓库的 tsconfig 没开
  up.querySelectorAll<HTMLImageElement>('.bili-avatar img[data-src]').forEach((img) => {
    if (img.getAttribute('src')) return
    const src = img.dataset.src
    if (src) img.src = src
  })
}

/**
 * 多人合作投稿（创作团队）—— 面板是另一套结构，布局改法全在 videoBeta.css §6.5，
 * 这里只把「当前是不是多人」翻译成 `<html>` 上的一个类。
 *
 * 判据是 `.up-panel-container` 里有没有 `.members-info-container`：换 P / 换稿件时
 * 整个面板会被 Vue 换掉，所以这个检测得跟着观察器反复跑；`lastMulti` 缓存一下，
 * 免得每轮都 toggle（toggle 会重新算样式）。
 */
function syncUpKind() {
  const multi = !!document.querySelector(`${UP_SELECTOR} .members-info-container`)
  if (multi === lastMulti)
    return
  lastMulti = multi
  document.documentElement.classList.toggle(MULTI_CLASS, multi)
}

/**
 * 首屏每 100ms 走一遍，把**不碰 DOM 结构**的几件事刷新一下：
 *
 *   - 话题串 / 粉丝数写进 CSS 变量（由伪元素负责显示，见 videoBeta.css §5 / §6）；
 *   - UP 卡片的几何（位置 / 宽度 / 高度 / sticky top，见 layoutUp）；
 *   - #viewbox_report / 标签行比 #mirror-vdcon 晚一拍才解析出来，这里补绑观察器。
 *
 * 这几件事全是「改属性 / 改变量」，不插不搬节点，所以**不用躲 MOVE_DELAY**
 * （只有搬弹幕发送栏要等，见 scheduleMove）。
 * 面板 / 标签都是后到的（SSR 里不一定齐），所以按节拍试到超时为止。
 */
function pumpEarly() {
  earlyTimer = 0
  if (!betaOn()) return
  earlyTries++
  if ((!boundReport || !boundTags) && earlyTries < EARLY_REBIND_TRIES) bindObservers()
  applyTopics()
  syncDesc()
  syncUpKind()
  watchWatching()
  const up = document.querySelector<HTMLElement>(UP_SELECTOR)
  if (up) {
    decorateUpPanel(up)
    watchUpPanel(up)
  }
  layoutUp()
  // **收工条件**（v002）：该绑的都绑上了、卡片位置也量出来了，就没必要再按 100ms 轮询。
  // 1.2.0 v003 起这一轮的代价已经很低（layoutUp 是「先读完再写」，没有变化的那些轮次
  // 只剩几次缓存命中的 rect 读），但「B 站水合那 6s 里别反复跑全文档查询」这条依然成立。
  // 收工之后的变化由观察器接手：childList（节点换了）→ rAF 里重算，
  // ResizeObserver（尺寸变了）→ 同样重算，B 站 3.2s 那次整栏重渲染跑不掉。
  const done = earlyTries > 10
    && boundReport && boundTags
    && document.documentElement.classList.contains(UP_READY)
  if (done || earlyTries >= EARLY_MAX_TRIES) return
  earlyTimer = window.setTimeout(pumpEarly, EARLY_STEP)
}

/**
 * UP 主那一行的文字处理（**不动结构**）：
 *   「关注 1882.4万」拆成两半 —— 按钮只留「关注」，数字写成 `--bili-vb-fans`
 *   由 `.up-detail::after` 显示在名字下面（videoBeta.css §6）。
 * B 站把那串数字写在一个文本节点里（`<span class="follow-btn-inner"><svg/>关注 1882.4万</span>`，
 * 「已关注」态是 `<span class="already-btn"><svg/>已关注 1882.4万</span>` 再深一层），
 * 没有单独的计数元素，只能按正则拆；拆的时候把原值记进 data 属性，关开关时能拼回去。
 * 改文本节点的值不碰 DOM 结构，Vue 重渲染也只会把它写回原样、我们再拆一次。
 * 关注按钮的位置、充电 / 发消息的隐藏全是 CSS（§6），这里一概不管。
 */
function decorateUpPanel(up: HTMLElement) {
  kickAvatar(up)
  // 面板也可能是多人结构（创作团队）。upObserver 盯的就是这棵子树 —— 它从「加载骨架」
  // 变成真面板、或者换稿件换了结构，都会走到这里，比 pumpEarly 的轮询可靠。
  syncUpKind()
  const inner = up.querySelector<HTMLElement>('.follow-btn .follow-btn-inner')
  const node = inner ? lastTextNode(inner) : null
  const full = node?.nodeValue || ''
  const matched = full.trim().match(FANS_RE)
  // 已经拆过了（按钮只剩「关注」）就别再动，免得把粉丝数那一行清空
  if (!inner || !node || !matched) return
  const [, label, count] = matched

  if (node.nodeValue !== ` ${label}`) {
    inner.dataset.biliEliteFull = full
    node.nodeValue = ` ${label}`
  }

  const text = `${count}粉丝`
  if (text === lastFans) return
  lastFans = text
  document.documentElement.style.setProperty(FANS_VAR, JSON.stringify(text))
}

/** 关掉开关时把 UP 主那一行的文本拼回去 */
function restoreUpPanelDom(up: HTMLElement) {
  const inner = up.querySelector<HTMLElement>('.follow-btn .follow-btn-inner')
  const node = inner ? lastTextNode(inner) : null
  const full = inner?.dataset.biliEliteFull
  if (inner && node && full) {
    node.nodeValue = full
    delete inner.dataset.biliEliteFull
  }
  lastFans = ''
  document.documentElement.style.removeProperty(FANS_VAR)
}

/**
 * 视频标签 → 标题后面那串蓝色 `#话题`。
 *
 * 为什么是**克隆**而不是搬：`.tag-panel` 是 Vue 渲染的，把子节点搬走以后，标签列表一变
 * （换 P、B 站补数据）它就会按 vnode 把节点挪回去，或者干脆重建整块 —— 搬走的那几个
 * 就留在标题里变成孤儿。克隆出来的节点不在 vnode 树里，原标签行由 CSS 整条隐藏，
 * Vue 怎么重排都跟我们无关；这里只在「标签内容变了」时整串重建（data-sig 比对）。
 */
/**
 * 标签 → `#标签` 文本（伪元素和真链接两版必须用**同一份**，不然切换时会重排）。
 * `#` 后面跟一个 U+2060（word joiner）：中文默认允许在任意两个字之间折行，
 * 不占住这一位的话行尾会孤零零留一个 `#`，标签被拆到下一行去。
 */
function topicEntries(): { el: HTMLAnchorElement, text: string }[] {
  const out: { el: HTMLAnchorElement, text: string }[] = []
  document.querySelectorAll<HTMLAnchorElement>(TAG_SELECTOR).forEach((el) => {
    const text = `#\u2060${(el.textContent || '').trim()}`
    if (text.length > 2) out.push({ el, text })
  })
  return out
}

function applyTopics() {
  const root = document.documentElement
  // 标签之间用**真空格**分隔（不是 margin）—— 伪元素那一版只能靠空格，
  // 两版必须逐像素一致，否则换成真链接时标题会重排一下。
  const text = topicEntries().map(entry => entry.text).join('  ')
  if (text === lastTopics) return
  lastTopics = text
  if (!text) {
    root.style.removeProperty(TOPICS_VAR)
    root.classList.remove(TOPICS_ON)
    return
  }
  // content 的值要是一个 CSS 字符串，所以整串 JSON.stringify 一下（带引号）
  root.style.setProperty(TOPICS_VAR, JSON.stringify(text))
  root.classList.add(TOPICS_ON)
}

/**
 * 把话题串插成**真链接**（可以点）。只在 `pumpSettle` 判定「B 站渲染完了」之后调用，
 * 所以不会踩到顶栏那次 mount。挂上 `html.bili-elite-vb-topics-live` 之后 CSS 会把伪元素收起，
 * 两者文字一样，切换看不出来。
 */
function applyTopicsLive() {
  const inner = document.querySelector<HTMLElement>(DESC_LIST)
  const entries = topicEntries()
  if (!inner || !entries.length) return
  const sig = entries.map(entry => entry.text).join('|')
  const old = inner.querySelector<HTMLElement>(`.${TOPICS_CLASS}`)
  if (old && old.dataset.sig === sig) return
  old?.remove()

  const wrap = document.createElement('span')
  wrap.className = TOPICS_CLASS
  wrap.dataset.sig = sig
  entries.forEach((entry, i) => {
    // 标签之间是**真空格**，跟伪元素那版一模一样（见 applyTopics）
    if (i) wrap.appendChild(document.createTextNode('  '))
    const a = entry.el.cloneNode(true) as HTMLAnchorElement
    // 标签本身不带 #，参考稿里是 #标签 —— 文本直接拼，别用 ::before（复制标题时会丢掉）
    a.textContent = entry.text
    wrap.appendChild(a)
  })
  inner.appendChild(wrap)
  document.documentElement.classList.add(TOPICS_LIVE)
}

/**
 * 等 B 站渲染完再放行真链接（判据见 SETTLE_QUIET_MS 的注释）。
 * 到 SETTLE_MAX_MS 还没稳定就放弃 —— 话题串退回纯展示（伪元素还在，只是不能点）。
 */
function pumpSettle() {
  settleTimer = 0
  if (!betaOn() || settled) return
  const now = performance.now()
  if (now >= settleUntil) return
  const header = document.getElementById('biliMainHeader')
  if (now >= SETTLE_FLOOR_MS && header && header.children.length && now - lastTreeChange >= SETTLE_QUIET_MS) {
    settled = true
    applyTopicsLive()
    return
  }
  settleTimer = window.setTimeout(pumpSettle, SETTLE_STEP)
}

/**
 * 简介卡：三件「加料」的事 —— **收起 / 展开的动画和状态本身仍然交给 B 站**（细节见 videoBeta.css §11）。
 *
 *   1. **没有简介的稿件**：B 站给 `#v_desc` 写了行内 `display:none`（实测 BV1xdx56HEFA），
 *      整张灰卡就没了，播放数据那一行裸在外面。这里挂 `bili-elite-vb-nodesc`，CSS 强制画出来、
 *      正文位置显示 `~`。
 *   2. **收起态**：B 站自己的折叠是「超过 3.5 行 → 行内 `height` 写成 3.5 × 行高，
 *      `#v_desc` 末尾渲染出 `.toggle-btn`」，展开时行内 `height` 写回 `auto`。
 *      这里只把「此刻是收起态」翻译成 `<html>` 上的一个类，CSS 拿它挂指针和悬停高亮，
 *      点击委托见 onDescClick（整张卡 / 播放数据那一行都能点开，1.2.5 v033 恢复）。
 *      注意：**点卡片触发的展开不画涟漪**，只有直接点按钮文字才有（见 onDescClick 里的 detail:1）。
 *   3. **根本不用展开**（`bili-elite-vb-desc-fit`，1.2.1 v003）：见 needDescFit。
 *
 * **别在这里写 max-height / height**：v018 曾经用 `max-height` 把正文压到 2 行，而 B 站
 * `checkIfDescInfoCanBeFolded` 量的就是 `getBoundingClientRect().height` —— 被压成 52px 之后
 * 它判定「不需要折叠」，原版「展开更多」按钮直接不渲染（用户报的「原版展开按钮被删了」）。
 * DESC_FIT 那条 `height: auto` 走的是**反向**（把已经裁掉的内容放出来），不会造成这个后果。
 */
function syncDesc() {
  const root = document.documentElement
  const desc = document.getElementById(DESC_ID)
  if (!desc) {
    root.classList.remove(NODESC_CLASS, DESC_FOLDED, DESC_FIT)
    descFit = false
    descFitKey = ''
    // 节点整个不在了（换页 / 数据没到）→ 下次出现必须重量
    descFitStale = true
    return
  }
  // 只认 B 站自己写的「这条稿件没有简介」（行内 display:none，实测 BV1xdx56HEFA）。
  // **别只按 textContent 判**：数据还没到的那几百毫秒里它同样是空的，于是会先给整张卡
  // 挂上 nodesc、画一个 `~` 占位，等简介到了再撤掉 —— 首屏能看见闪一下。
  // textContent 里还带着按钮文案，但按钮只在「有简介且要折叠」时才存在，不影响判空。
  const noDesc = desc.style.display === 'none' && !(desc.textContent || '').trim()
  root.classList.toggle(NODESC_CLASS, noDesc)
  // 收起时 B 站写死 px，展开时写 auto；没有按钮 = 这篇简介不需要折叠
  const info = desc.querySelector<HTMLElement>(DESC_INFO)
  const btn = desc.querySelector<HTMLElement>(DESC_TOGGLE)
  const height = info?.style.height || ''
  const folded = !!btn && height !== '' && height !== 'auto'
  const immersive = root.classList.contains(ROOT_IMMERSIVE)
  // 「装得下吗」必须读布局（scrollHeight），而这条路径被叫得**很勤** —— 播放数据（播放量 /
  // 弹幕数）每秒都在变，每次都跟着重算就是每秒几次强制排版。所以只有「形状」变了才重量：
  // 节点换没换 / 行内高度 / 按钮 / 文字长度 / 是否沉浸式，再加 ResizeObserver 报过的尺寸变化。
  const key = `${descGen}|${immersive ? 1 : 0}|${height}|${btn ? 1 : 0}|${(desc.textContent || '').length}`
  if (descFitStale || key !== descFitKey) {
    descFitKey = key
    descFitStale = false
    descFit = !noDesc && !immersive && needDescFit(info, btn, height)
  }
  // 「装得下」时不再挂 folded：卡片不该有指针 / 悬停高亮（点了也没东西可展开）
  root.classList.toggle(DESC_FOLDED, folded && !descFit)
  root.classList.toggle(DESC_FIT, descFit)
}

/**
 * 点简介卡（灰色区域 / 播放数据那一行）= 展开。**展开这件事仍然由 B 站做**：直接点它自己的
 * `.toggle-btn`，于是折叠状态、行内高度、按钮文案全都由 B 站维护，我们一个字节都不写。
 *
 * 委托在 document 上而不是绑到 `#v_desc`：Vue 把那个节点换掉时不用重绑。
 * 展开态不接管 —— 要能选中文字、点简介里的链接；点在按钮自己身上也放过
 * （它自己有 click 处理，再点一次就是切换两次 = 没反应）。
 *
 * **点卡片不画涟漪（1.2.5 v033）**：这里不能调 `btn.click()` —— 它派发的 click 是 `detail: 0`，
 * 会被 ripple.ts 当成「键盘 / 脚本触发」再补一颗从按钮中心扩散的涟漪，用户就会看到
 * 「点卡片 → 按钮上莫名冒一圈波纹」。改成手动派发 `detail: 1` 的合成 click：
 * B 站的 @click 照常触发（它不看 detail），涟漪那条路径则直接跳过。
 */
function onDescClick(e: MouseEvent) {
  const root = document.documentElement
  // 宽屏 / 网页全屏下信息区整套交回 B 站，不接管点击
  if (root.classList.contains(ROOT_IMMERSIVE) || !root.classList.contains(DESC_FOLDED)) return
  const target = e.target instanceof Element ? e.target : null
  const desc = document.getElementById(DESC_ID)
  // 播放数据那一行是卡片的**兄弟**（叠在同一格），视觉上属于卡片，点它也算点卡片
  const hit = target?.closest(`#${DESC_ID}`) || target?.closest(META_SELECTOR)
  if (!desc || !hit) return
  if (target?.closest('a, img, .toggle-btn')) return
  // 拖选简介里的文字时不要顺手展开
  if ((window.getSelection()?.toString() || '').trim()) return
  const btn = desc.querySelector<HTMLElement>(DESC_TOGGLE)
  if (!btn) return
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  // B 站改的是行内 height（属性变动观察不到），下一帧把「收起态」同步回来
  requestAnimationFrame(syncDesc)
}

/**
 * 正文在当前宽度下是不是**整段都装得进折叠高度**（= 这颗「展开更多」是多余的）。
 *
 * 为什么必须自己判：B 站只在简介数据到的那一下判一次（`checkIfDescInfoCanBeFolded`），
 * 之后窗口变宽、正文从 4 行缩到 2 行，行内 `height` 还是「3.5 行」那个 px —— 于是
 * **收起态就已经把全文露出来了**，那颗「展开更多」点下去只会让卡片矮一截
 * （用户报的「大屏点开反而收起了一些」）。窗口变窄则反过来，B 站那套仍然是对的。
 *
 * 判据只用两个跟 DESC_FIT 无关的量，**不能拿 clientHeight 比**：DESC_FIT 自己会把
 * 行内 height 放开，比出来的结果永远是「装得下」，缩窗口就再也收不回去了。
 *   - 折叠高度 = B 站写在行内的 px（折叠态一定有；展开态退回 3.5 行）
 *   - 正文高度 = scrollHeight（`overflow: hidden` 裁掉的也算进去）
 *
 * 没有按钮却留着行内 px（B 站量的时候窗口还没定下来，会留下这种「裁掉又没法展开」）→ 也放开。
 */
function needDescFit(info: HTMLElement | null, btn: HTMLElement | null, height: string): boolean {
  if (!info)
    return false
  const inline = Number.parseFloat(height)
  const inlinePx = height !== 'auto' && Number.isFinite(inline)
  if (!btn) {
    // 没按钮 = B 站认为不该折叠。行内还留着 px 就是被裁住了，只能我们放开
    return inlinePx && info.scrollHeight > inline + 1
  }
  const foldH = inlinePx ? inline : DESC_FOLD_LINES * lineHeightOf(info)
  return info.scrollHeight <= foldH + 1
}

/** 元素的行高（px）。`line-height: normal` 按 1.5 倍字号估，只用来兜展开态那一种情况 */
function lineHeightOf(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  const lh = Number.parseFloat(cs.lineHeight)
  if (Number.isFinite(lh))
    return lh
  const fs = Number.parseFloat(cs.fontSize)
  return Number.isFinite(fs) ? fs * 1.5 : 24
}

/**
 * 盯简介卡的尺寸：窗口一变宽，正文行数就变（needDescFit 的结论跟着变）。
 *
 * 用 ResizeObserver 而不是 window.resize：卡片的宽度由栅格算出来（右栏 `clamp(380, 33vw, 620)`），
 * 窗口宽度没变、栅格变了（沉浸式切换、滚动条出现）同样会改宽度，RO 两种都抓得到。
 * 回调里**不同步改类**（DESC_FIT 会改卡片高度，同步写会撞 ResizeObserver loop 警告），
 * 甩到下一帧；syncDesc 是幂等的，缩窗口那一轮最多多跑一次。
 */
function watchDescSize() {
  if (typeof ResizeObserver === 'undefined')
    return
  const desc = document.getElementById(DESC_ID)
  if (!desc || desc === descSizeTarget)
    return
  descSizeObserver?.disconnect()
  descSizeTarget = desc
  descGen++
  descFitStale = true
  descSizeObserver = new ResizeObserver(() => {
    descFitStale = true
    if (rafDesc)
      return
    rafDesc = requestAnimationFrame(() => {
      rafDesc = 0
      syncDesc()
    })
  })
  descSizeObserver.observe(desc)
}

function unwatchDescSize() {
  descSizeObserver?.disconnect()
  descSizeObserver = null
  descSizeTarget = null
  descFitKey = ''
  descFitStale = true
  if (rafDesc) {
    cancelAnimationFrame(rafDesc)
    rafDesc = 0
  }
}

/**
 * 原版「N 人正在看」→ 播放数据那一行最右侧（CSS 里是 `.video-info-meta::after`）。
 *
 * 它原本挂在弹幕发送栏（`.bpx-player-video-info`）里，beta 把发送栏搬进控制栏中间、
 * 又把这块人数藏掉了，人数就再也看不见。这里**只读文本、写 CSS 变量**，一个节点都不插 ——
 * 播放数据这块是 Vue 高频重渲染的区域，动它的 children 会踩到 §7 注释里那些坑。
 *
 * 数字由 B 站自己轮询，`display:none` 不影响更新（实测隐藏期间 8 → 7 照样在变），
 * 所以观察器盯文本变化就够。中文里没有要保留的空格：结构是 `<span>8</span>人正在看`。
 */
function syncWatching() {
  const online = document.querySelector<HTMLElement>(WATCHING_SELECTOR)
  const text = (online?.textContent || '').replace(/\s+/g, '')
  if (text === lastWatching) return
  lastWatching = text
  const style = document.documentElement.style
  if (text) style.setProperty(WATCHING_VAR, JSON.stringify(text))
  else style.removeProperty(WATCHING_VAR)
}

/**
 * 盯住人数节点。发送栏被搬来搬去 / 控制栏整块重建时节点会换新，观察器会失联，
 * 所以 pumpEarly 和 pumpSendingBar 都会走一遍这里重绑（同一个节点就直接返回）。
 */
function watchWatching() {
  const online = document.querySelector<HTMLElement>(WATCHING_SELECTOR)
  if (!online) return
  syncWatching()
  if (watchTarget === online) return
  watchObserver?.disconnect()
  watchTarget = online
  watchObserver = new MutationObserver(() => syncWatching())
  watchObserver.observe(online, { childList: true, characterData: true, subtree: true })
}

function unwatchWatching() {
  watchObserver?.disconnect()
  watchObserver = null
  watchTarget = null
  lastWatching = ''
  document.documentElement.style.removeProperty(WATCHING_VAR)
}

/** 关开关时把话题串撤掉（原标签行靠 CSS 隐藏，变量一撤就回来了） */
function restoreTags() {
  lastTopics = ''
  lastFans = ''
  const style = document.documentElement.style
  style.removeProperty(TOPICS_VAR)
  style.removeProperty(FANS_VAR)
  document.querySelector(`.${TOPICS_CLASS}`)?.remove()
  const root = document.documentElement
  root.classList.remove(TOPICS_ON, TOPICS_LIVE)
  settled = false
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = 0
  }
}

/**
 * 把弹幕发送栏搬进控制栏中间 —— **照全屏那套来**。
 *
 * 窗口态 B 站在播放器下面挂一条 56px 的发送栏（`.bpx-player-sending-area`：观看人数 +
 * 弹幕开关 + 输入框 + 发送）；全屏态没有这条，它把**同一个** `.bpx-player-sending-bar`
 * 塞进控制栏中间（`.bpx-player-control-bottom-center`），做成半透明的一条。
 * 所以这里不是「删掉发送栏」，而是把它挪到全屏待的那个位置，播放器高度也就能收回纯 16:9。
 * 样式在 videoBeta.css §9：窗口态 / 宽屏用我们那套（深色半透明、压一档），
 * **网页全屏 / 全屏一条都不改**（`bili-elite-vb-send-native`，B 站原样就正好）。
 *
 * 返回 false = 这一刻搬不了（找不到发送栏本体，或者控制栏中间那块正在重建），调用方要再试。
 */
function moveSendingBar(): boolean {
  const bar = document.querySelector<HTMLElement>(SEND_BAR)
  // 发送栏还没渲染出来：没什么可搬的，但**必须继续重试**。
  // 搬的时刻提前到「播放器一挂上」之后，那时发送栏本体往往还晚到 100~300ms
  // （v002 之前是固定等 3s，它早就渲染好了，所以这里原来可以直接返回 true）。
  // 返回 false → pumpSendingBar 按 120ms 一轮试到 barRetryUntil 为止。
  if (!bar) return false
  const center = document.querySelector<HTMLElement>(CTRL_CENTER)
  // 控制栏整块正在重建（退出网页全屏时就是这样）：等下一轮
  if (!center) return false
  if (bar.parentElement === center) return true
  center.appendChild(bar)
  return true
}

/** 关掉开关时搬回播放器下面（B 站原本的位置） */
function restoreSendingBar() {
  const area = document.querySelector<HTMLElement>(SEND_AREA)
  const bar = document.querySelector<HTMLElement>(`${CTRL_CENTER} ${SEND_BAR}`)
  if (!area || !bar) return
  area.appendChild(bar)
}

/**
 * 搬一次，搬不动就自己重试。
 *
 * 「网页全屏 → 回到窗口态」时 B 站会做两件事：把发送栏搬回下面那条（我们 display:none
 * 掉的）发送栏容器，**同时把控制栏整块重建**。观察器回调里 querySelector 到的新控制栏
 * 有可能还没挂进文档，那一次 moveSendingBar() 拿不到 center，于是发送栏就留在了
 * 隐藏的容器里 —— 用户看到的就是「弹幕发送框被挤没」，而且不是每次都能复现（看重建快慢）。
 * 所以这里加一层短重试：120ms 一次，最多 2.4s，正常情况第一轮就搬好了。
 */
function pumpSendingBar() {
  if (!betaOn()) return
  const ok = moveSendingBar()
  watchSendingBar()
  watchWatching()
  if (ok || performance.now() >= barRetryUntil) return
  if (barRetryTimer) return
  barRetryTimer = window.setTimeout(() => {
    barRetryTimer = 0
    pumpSendingBar()
  }, BAR_RETRY_STEP)
}

/** 给发送栏开一个重试窗口，然后立刻搬一次 */
function ensureSendingBar() {
  barRetryUntil = performance.now() + BAR_RETRY_MS
  pumpSendingBar()
}

/**
 * 盯住这两个容器：进出全屏 / 网页全屏时 B 站自己会把发送栏搬来搬去，
 * 搬回外面（发送栏容器）我们就再挪进来。只订阅 childList，很便宜。
 */
function watchSendingBar() {
  const area = document.querySelector<HTMLElement>(SEND_AREA)
  const center = document.querySelector<HTMLElement>(CTRL_CENTER)
  if (!area || !center) return
  if (barTargets[0] === area && barTargets[1] === center) return
  barObserver?.disconnect()
  barTargets = [area, center]
  barObserver = new MutationObserver(() => {
    if (rafBar) return
    rafBar = requestAnimationFrame(() => {
      rafBar = 0
      pumpSendingBar()
    })
  })
  barObserver.observe(area, { childList: true })
  barObserver.observe(center, { childList: true })
}

function unwatchSendingBar() {
  barObserver?.disconnect()
  barObserver = null
  barTargets = []
  if (rafBar) {
    cancelAnimationFrame(rafBar)
    rafBar = 0
  }
  if (barRetryTimer) {
    clearTimeout(barRetryTimer)
    barRetryTimer = 0
  }
  barRetryUntil = 0
}

/** 播放器挂上了没有：B 站把真正的播放器塞进 #bilibili-player 之后才算 */
function playerMounted() {
  return !!document.querySelector('#bilibili-player .bpx-player-container')
}

/* ===== 首帧前的封面兜底（1.2.0 v011）=====
 *
 * 为什么做：实测（真实 Chrome / 冷缓存 / 无扩展，各 2 次）播放页
 *   TTFB 460~529ms → FCP 924~1112ms → **首帧 1331~1662ms**
 * 而这 1.3~1.6s 里播放器区域是**纯黑**：B 站已经不做 poster 了
 * （`.bpx-player-video-poster` 是空元素、0×0，实测），首帧之前什么都不画。
 * 同机同网络的直播页 0.45s 就靠 SSR 的一张满屏背景图（`.room-bg`）把 LCP 钉住，
 * 所以「直播比视频快」的感觉，大半来自这一段黑屏，不是网络真的差。
 *
 * 做法：把封面铺在播放器上，首帧一到就摘。
 *   · 封面地址来自 `__INITIAL_STATE__.videoData.pic`，**不用额外接口**；但内容脚本跑在
 *     隔离世界、读不到页面的 window 变量，所以由 guard.js（MAIN world）把它镜像到
 *     `<html data-blie-pic>`，这边只读属性；DOM 里那个内联状态脚本实测并不存在
 *     （`document.scripts` 里 0 个含 `"videoData"`），解析文本那条只是兜底；
 *   · 封面取 `@672w_378h_1c.webp`（实测 20.6KB，`@320w` 只有 8.3KB 但铺到 1092px
 *     宽的播放器上明显发虚）—— 20KB 抢不走播放器的带宽：三次 A/B 的首帧差值是
 *     −232 / +100 / +131ms，均值落在噪声里；**LCP 反而从 1596ms 提到 1192ms**
 *     （首帧不算 LCP 候选，之前那个「LCP = video」其实是占位，封面才是真正的大块绘制）；
 *   · 用伪元素画（`videoBeta.css` §10），**不往 #mirror-vdcon 插节点**；
 *   · 摘除时机是 `loadeddata`（有画面了），不是 `playing`（还在等起播）；
 *     另加 8s 兜底与 `error`，别让封面永远盖着播放器。
 *   · **只在首屏铺一次，切换视频不重铺**：右栏推荐卡是 **SPA 切换**（不换文档，
 *     `performance.timeOrigin` 不变，实测），播放器会一直保留上一帧直到新视频出画 ——
 *     铺封面反而盖掉那一帧；而且这时 `<html data-blie-pic>` 还是上一条的地址
 *     （`__INITIAL_STATE__` 要等 view 接口回来才更新），铺上去就是「上一条的封面」。
 *
 * 实测收益：黑屏 1.46~1.59s → 0.66~1.0s（class 662~733ms 挂上、图 999~1101ms 到）。
 */
const ROOT_POSTER = 'bili-elite-vb-poster'
const POSTER_VAR = '--bili-vb-poster'
/** 等 `__INITIAL_STATE__` 出现的上限（它就在 HTML 第 7.8KB，正常 150ms 内就有） */
const POSTER_WAIT_MS = 5000
/** 轮询步长：50ms 足够跟上「HTML 一解析到就铺上」，又不至于空转 */
const POSTER_STEP = 50
/** 等不到 `loadeddata` 的兜底：宁可露出 B 站原本的黑底，也别一直盖着 */
const POSTER_FALLBACK_MS = 8000

let posterTimer = 0
let posterFallback = 0
let posterUntil = 0
let posterBound = false

/**
 * 兜底通道：从内联 `<script>` 的文本里抠封面地址。
 *
 * 实测 B 站播放页**没有**这个内联脚本（`document.scripts` 里 0 个含 `"videoData"`，
 * 状态由外部脚本赋到 `window` 上），所以正常走的是 guard.js 镜像出来的
 * `<html data-blie-pic>`。这里留着是因为 SSR 版 HTML 里确实带着状态（curl 拿到的
 * 250KB 响应里有 `"videoData"` 和第 131 个字符处的 `"pic"`），万一哪天改成内联就又用上。
 *
 * **不能直接读 `window.__INITIAL_STATE__`**：内容脚本跑在隔离世界，DOM 共享、JS 全局不共享
 * （v011 第一版就是这么写的，实测 class 一次都没挂上）。
 */
function picFromInlineState(): string {
  const scripts = document.scripts
  for (let i = 0; i < scripts.length; i++) {
    const el = scripts[i]
    // 只扫内联脚本：状态是内联的，外链的 textContent 本来就是空
    if (el.src) continue
    const text = el.textContent
    if (!text || text.length < 512) continue
    const at = text.indexOf('"videoData"')
    if (at < 0) continue
    const m = /"pic"\s*:\s*"([^"]+)"/.exec(text.slice(at, at + 4000))
    if (!m) continue
    // HTML 里 `/` 被转义成 `\u002F`（个别位置是 `\/`），`&` 同理
    return m[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&')
  }
  return ''
}

/** 封面地址：`//i2.hdslb.com/bfs/archive/xxx.jpg` + `@672w_378h_1c.webp`；拿不到返回空串 */
function posterUrl(): string {
  // 主通道：guard.js 在页面世界读到 `__INITIAL_STATE__.videoData.pic` 后写进这个属性
  const mirrored = document.documentElement.getAttribute('data-blie-pic') || ''
  const pic = mirrored || picFromInlineState()
  if (!pic)
    return ''
  // 已经是带尺寸后缀的地址（少数稿件 `pic` 自带 `@…`）就别再拼一次
  if (pic.includes('@'))
    return pic.replace(/^http:/, 'https:')
  const base = pic.startsWith('//') ? `https:${pic}` : pic.replace(/^http:/, 'https:')
  return `${base}@672w_378h_1c.webp`
}

function dropPoster() {
  document.documentElement.classList.remove(ROOT_POSTER)
  if (posterFallback) {
    clearTimeout(posterFallback)
    posterFallback = 0
  }
}

/** 铺封面 + 起兜底计时。已经有画面时直接跳过（多 P 切回来时 `readyState` 可能已经是 4） */
function applyPoster(url = posterUrl()) {
  if (!betaOn() || !url)
    return
  const video = document.querySelector<HTMLVideoElement>('#bilibili-player video')
  if (video && video.readyState >= 2) {
    dropPoster()
    return
  }
  const root = document.documentElement
  root.style.setProperty(POSTER_VAR, `url("${url}")`)
  root.classList.add(ROOT_POSTER)
  if (posterFallback)
    clearTimeout(posterFallback)
  posterFallback = window.setTimeout(dropPoster, POSTER_FALLBACK_MS)
}

/**
 * 轮询到封面地址出现为止。**不能只看一次**：内容脚本在 document_start 就跑，
 * 而 `guard.js` 要等页面把 `__INITIAL_STATE__` 赋上（实测 ~600ms）才会写 `data-blie-pic`。
 */
function pumpPoster() {
  posterTimer = 0
  if (!betaOn())
    return
  const url = posterUrl()
  if (url) {
    applyPoster(url)
    return
  }
  if (performance.now() < posterUntil)
    posterTimer = window.setTimeout(pumpPoster, POSTER_STEP)
}

/** 首帧 / 出错都要摘封面，监听挂一次就够（捕获阶段，视频元素后创建也收得到） */
function bindPosterEvents() {
  if (posterBound)
    return
  posterBound = true
  document.addEventListener('loadeddata', onPosterFrame, true)
  document.addEventListener('error', onPosterError, true)
}

function onPosterFrame(event: Event) {
  if ((event.target as HTMLElement | null)?.tagName === 'VIDEO')
    dropPoster()
}

function onPosterError(event: Event) {
  if ((event.target as HTMLElement | null)?.tagName === 'VIDEO')
    dropPoster()
}

function startPoster() {
  bindPosterEvents()
  posterUntil = performance.now() + POSTER_WAIT_MS
  if (posterTimer)
    clearTimeout(posterTimer)
  pumpPoster()
}

function stopPoster() {
  dropPoster()
  if (posterTimer) {
    clearTimeout(posterTimer)
    posterTimer = 0
  }
  if (posterBound) {
    document.removeEventListener('loadeddata', onPosterFrame, true)
    document.removeEventListener('error', onPosterError, true)
    posterBound = false
  }
}

/**
 * 把弹幕发送栏搬进控制栏中间 —— **必须等 B 站首屏那一段过去**。
 *
 * 先纠正一个记错的前提（v013 实测）：B 站那套白屏检测
 * （`__MIRROR_CONFIG__.config.whiteScreen`，`maxLoop: 10`）**只做上报、不重渲染**。
 * 翻 `biliMirror.umd.mini.js`：`reportWhiteScreen()` 里是 `It({type:'error'…})` +
 * html2canvas 截图 + `clearCache()`，`handleWhiteScreen()` 只 push 一条指标，
 * 既没有 `location.reload()` 也没有重挂组件。所以它不是要躲的东西。
 *
 * 真正会把节点冲掉的是 B 站自己：首屏 ~3.2s 它要把整个**左栏**重渲染一遍，
 * **跟我们在不在完全无关**。在那之前把节点从原位置摘走，Vue patch 时 `oldVnode.elm`
 * 已经不在原位，会报 `reading 'nextSibling'`、顶栏那次 mount 失败 → 一条白条。
 *
 * 但发送栏在播放器自己的 Vue 应用里（`.bpx-player-*`），**根本不在 #mirror-vdcon 这棵树上**，
 * 左栏那轮重渲染冲不到它 —— 那个 3s 的下限对它不成立（v002 收到 700ms）。
 * 现在等播放器挂上（`playerMounted()`）就搬；观察器仍然盯着两个容器，
 * B 站把发送栏搬回去 / 重建控制栏时会自动再搬一次（见 watchSendingBar）。
 */
function scheduleMove() {
  if (moveArmed) return
  moveArmed = true
  moveDeadline = performance.now() + MOVE_DEADLINE

  const tick = () => {
    if (!betaOn()) {
      moveArmed = false
      moveTimer = 0
      return
    }
    const now = performance.now()
    const settled = now >= MOVE_DELAY && (playerMounted() || now >= moveDeadline)
    if (!settled) {
      moveTimer = window.setTimeout(tick, 80)
      return
    }
    moveArmed = false
    moveTimer = 0
    ensureSendingBar()
  }

  moveTimer = window.setTimeout(tick, 80)
}

/**
 * 盯住 UP 主卡片内部：点「关注」之后 B 站会把整个按钮重渲染（文字、class 全换新），
 * 拆出来的粉丝数要重新拆一遍。这个子树很小（头像 + 名字 + 两个按钮），递归观察很便宜。
 */
function watchUpPanel(up: HTMLElement) {
  if (upTarget === up) return
  upObserver?.disconnect()
  upTarget = up
  upObserver = new MutationObserver(() => {
    if (rafUp) return
    rafUp = requestAnimationFrame(() => {
      rafUp = 0
      decorateUpPanel(up)
    })
  })
  // 顺带盯 `data-src`：bili-avatar 是懒加载的，`src` 只在它自己的观察器里落。
  // 轮询收工之后（见 pumpEarly 的收工条件）这里就是唯一能把头像补上的入口，
  // 只过滤这一个属性，开销可以忽略（写 src 不会被 attributeFilter 命中，不会自激）。
  upObserver.observe(up, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-src'],
  })
}

function unwatchUpPanel() {
  upObserver?.disconnect()
  upObserver = null
  upTarget = null
  if (rafUp) {
    cancelAnimationFrame(rafUp)
    rafUp = 0
  }
}

/** 关掉开关时只还原文本（卡片一直在原地，没搬过） */
function restoreUpPanel() {
  const up = document.querySelector<HTMLElement>(UP_SELECTOR)
  unwatchUpPanel()
  if (up) restoreUpPanelDom(up)
}

/**
 * 观察器只盯「可能变」的几层，且都只订阅 childList：
 * - #mirror-vdcon 的子级：左栏 / 右栏被整体换掉时重新绑；
 * - .left-container 的子级：搬过去的卡片被 Vue 摘掉；
 * - .right-container-inner 的子级：UP 主卡片的数据回来后新建出来；
 * - #viewbox_report 的子树：Vue 重渲染标题时会把话题链接一起冲掉，得补回来；
 * - .video-tag-container 的子树：标签是后到的（换 P / 补数据），话题链接要跟着重建。
 * 不加整棵 subtree —— 评论区一直在变，递归观察会把主线程吃掉。
 * 回调里只排任务、不动 DOM：真要搬也走 scheduleMove（水合期间不许动）。
 */
function bindObservers() {
  const mirror = document.getElementById(MIRROR_ID)
  const left = document.querySelector<HTMLElement>('.left-container')
  const rail = document.querySelector<HTMLElement>('.right-container-inner')
  // 先查再拆：这几个节点是陆续到齐的，pumpEarly 会反复叫这里，没到齐就原样返回，
  // 别把已经绑好的观察器拆了重来
  if (!mirror || !left || !rail) return
  // **宿主没换过就只补绑后到的容器**（v002）。以前这里无条件 unbind + 重建，
  // 而 pumpEarly 每 100ms 叫一次 —— 头 2s 等于把 MutationObserver 和 ResizeObserver
  // 拆了重建二十遍，每次重建都会立刻回放一次初始回调（又跑一遍 layoutUp）。
  if (observer && boundNodes && boundNodes[0] === mirror && boundNodes[1] === left && boundNodes[2] === rail) {
    bindLateTargets()
    watchLeftSticky()
    watchSizes()
    return
  }
  unbindObservers()
  boundNodes = [mirror, left, rail]
  boundReport = false
  boundTags = false

  observer = new MutationObserver(() => {
    lastTreeChange = performance.now()
    // 话题链接**当场**补（同步），不进 rAF。
    // B 站首屏 ~3.2s 会把整个左栏（连同 .video-info-title-inner）重渲染一遍，挂在标题尾巴上的
    // 话题链接跟着被冲掉；等下一帧再补的话，中间那几帧标题少一串话题、从 3 行缩回 1 行，
    // 底下整块内容往上弹 56px，看得见地闪一下（实测 60~80ms）。
    // MutationObserver 的回调是微任务，跑在 Vue 那次 patch 的调用栈退出之后、**同一帧绘制之前**，
    // 所以这里补等于没被删过。
    // 只在「话题链接不见了」时才补 —— 水合期间这个回调会被叫很多次，每次都跑一遍
    // querySelectorAll 不值得；标签内容变了（换 P）由下面 rAF 那条路整串重建。
    // 话题串 / 粉丝数都是 CSS 变量，重渲染冲不掉；这里只是「万一标签换了 P」时补一次，
    // 放进 rAF 里、跟下面那条一起走，别在同步回调里做全文档查询。
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      applyTopics()
      if (settled) applyTopicsLive()
      syncDesc()
      // 换稿件时面板可能从单人换成多人（或反过来），类名得跟着换 —— 否则 §6.5 那套
      // 「藏横幅 / 清内边距」会一直挂在一个单 UP 的面板上（它是靠 .bili-elite-vb-multi 生效的）
      syncUpKind()
      // 后到的容器（播放数据 / 标签行 / 简介）可能被 Vue 整块换掉，换掉就等于观察器失联。
      // 轮询收工之后这里就是唯一的补绑入口 —— 一次 identity 比对，很便宜。
      bindLateTargets()
      layoutUp()
      scheduleMove()
      if (document.contains(mirror) && document.contains(left) && document.contains(rail)) return
      // 节点被换掉了：旧观察器随旧节点一起失效，重新找一遍
      bindObservers()
      if (!observer) watchForLayout()
    })
  })
  observer.observe(mirror, { childList: true })
  observer.observe(left, { childList: true })
  observer.observe(rail, { childList: true })
  bindLateTargets()
  // 左栏被整个换掉时（B 站首屏那轮重渲染）上面那个观察器会把这里重新叫一遍，
  // 节点换了就重新盯 —— watchLeftSticky / watchSizes 自己会比对是不是同一批节点
  watchLeftSticky()
  watchSizes()

}

/**
 * 后到的几个容器（`#viewbox_report` / 标签行 / 简介）补绑到**现有**观察器上。
 *
 * 它们比 #mirror-vdcon 晚一拍才解析出来。同一个 MutationObserver 可以 observe 多个目标，
 * 所以补绑的代价只是一次 observe —— 不用把整棵观察器拆了重来（见 bindObservers）。
 */
function bindLateTargets() {
  if (!observer) return
  if (!boundReport) {
    const report = document.getElementById('viewbox_report')
    if (report) {
      observer.observe(report, { childList: true, subtree: true })
      boundReport = true
    }
  }
  if (!boundTags) {
    const tags = document.querySelector<HTMLElement>('.video-tag-container')
    if (tags) {
      observer.observe(tags, { childList: true, subtree: true })
      boundTags = true
    }
  }
  // 简介是后到的（换 P 会整块换内容），收起 / 展开的判定得跟着重算。
  // 节点换了才重新 observe —— 旧节点已经被 Vue 扔掉，观察器跟着失效
  const desc = document.getElementById(DESC_ID)
  if (desc && desc !== descTarget) {
    descTarget = desc
    observer.observe(desc, { childList: true, subtree: true, characterData: true })
  }
  // 简介卡的宽度（正文行数）也要盯：窗口一变，needDescFit 的结论就变了
  watchDescSize()
}

function unbindObservers() {
  observer?.disconnect()
  observer = null
  boundNodes = null
  descTarget = null
  unwatchDescSize()
  unwatchLeftSticky()
  unwatchSizes()
  boundReport = false
  boundTags = false
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/**
 * 播放页的骨架是 SSR 出来的，但 document_start 时还不在文档里（顶栏那条先到）。
 * 这里等 #mirror-vdcon 出现，找到就绑观察器 + 排搬运。
 *
 * **别改回「对整个 documentElement 挂 subtree MutationObserver」**（1.1.4 v011 修的）：
 * 那样等于给页面每一条 DOM 变动都记一条 record —— 首屏 B 站自己要插上万条节点，
 * 我们的回调在**每一个微任务检查点**都被叫起来（哪怕里面只有一次 getElementById）。
 * 实测代价不是「慢一点」而是把 B 站顶栏（bili-header.umd.js）的挂载搞崩：
 * `TypeError: Cannot read properties of null (reading 'nextSibling')` +
 * `[Vue warn] There is already an app instance mounted on the host container`，
 * 于是 `#biliMainHeader` 是个空盒子 —— 表现就是「打开播放页卡一下、顶栏变成一条白」。
 * 二分验证：只加 videoBeta 的类名+样式没问题，加上这个观察器 4/4 必现，换回轮询 0/4。
 *
 * 现在按 100ms 轮询，一次 getElementById（id 查找是哈希命中，很便宜），最多 10s 就放弃。
 */
function watchForLayout() {
  if (observer || waitTimer) return
  waitTries = 0
  const tick = () => {
    waitTimer = 0
    if (!betaOn()) return
    if (!document.getElementById(MIRROR_ID)) {
      if (++waitTries < WAIT_MAX_TRIES) waitTimer = window.setTimeout(tick, WAIT_STEP)
      return
    }
    bindObservers()
    scheduleMove()
  }
  waitTimer = window.setTimeout(tick, WAIT_STEP)
}

/**
 * 兜底自愈（v003）：**一次滚动只触发一次**，不进滚动路径、不影响跟手，但能保证
 * 「观察器失联 / 变量僵死」这类问题最多只持续一个滚动动作。
 *
 * 只做三件幂等的事：
 *   1. 观察器没了就补绑（`#mirror-vdcon` 被整块换掉时旧观察器会一起失效，而那时没有任何
 *      回调会再叫 `bindObservers`，等于整套逻辑静默死掉）；
 *   2. `bindLateTargets()` 补绑后到的容器（一次 identity 比对）；
 *   3. 重算一次布局 —— 把 `--up-top` / `--up-y` 拉回真实值。
 *
 * 为什么不用 `scroll`：用户明确否过「滚动回调」（v023），而且滚动里每一次 `layoutUp` 都是
 * 6 个 `getBoundingClientRect` + 2 次 `getComputedStyle`（强制排版），跟手会掉帧。
 * `scrollend` 是滚动**结束**后才发一次，代价可以忽略。
 */
function onScrollEnd() {
  if (!betaOn()) return
  if (!observer) {
    bindObservers()
    if (!observer) watchForLayout()
  }
  else {
    bindLateTargets()
  }
  layoutUp()
}

/** 从后台标签页切回来：期间可能发生过重排（播放器暂停、评论加载），重算一次 */
function onVisibilityChange() {
  if (document.visibilityState === 'visible') onScrollEnd()
}

function stopWait() {
  if (waitTimer) {
    clearTimeout(waitTimer)
    waitTimer = 0
  }
  waitTries = 0
}

/**
 * 盯住视口宽度 —— **纵向滚动条出现 / 消失也算**。
 *
 * measure() 第一次是在 document_start 跑的，那时文档还是空的：B 站自己的 CSS（给 <html> 加
 * `overflow-y: scroll`）还没应用、内容也没渲染，所以根本没有纵向滚动条，
 * `documentElement.clientWidth` 等于 innerWidth（含滚动条那 17px）。
 * 等内容和样式都进来、滚动条一占位，clientWidth 就少了 17px —— 但**滚动条出现不会触发
 * window 的 resize 事件**，于是 measure() 再也不会被叫起来，整行就比视口宽 17px：
 * 右栏右边缘跑到窗口外面 / 压在滚动条底下，看起来就是「视频右侧没白边、内容跑出屏幕」。
 * 而手动缩一下窗口（触发 resize）或关掉再打开 beta（重跑 start() → measure()）都会好 ——
 * 和用户描述的现象一模一样。
 *
 * ResizeObserver 盯 <html> 就能抓到这一刻（滚动条占位时根元素的内容盒宽度会变）。
 * 只在**宽度**变化时重算：<html> 的高度会随内容不停长，按高度触发会把主线程吃掉。
 */
function watchViewport() {
  if (viewportObserver || typeof ResizeObserver === 'undefined')
    return
  viewportObserver = new ResizeObserver(() => {
    if (document.documentElement.clientWidth === lastVw)
      return
    measure()
  })
  viewportObserver.observe(document.documentElement)
}

function unwatchViewport() {
  viewportObserver?.disconnect()
  viewportObserver = null
  lastVw = 0
}

function onResize() {
  if (rafResize) return
  rafResize = requestAnimationFrame(() => {
    rafResize = 0
    measure()
  })
}

/**
 * 屏幕模式变化后的收尾工作。**必须在同一帧里做完**（v001 推迟到 rAF 的方案已回滚，
 * 见文件上方那段注释）。
 *
 * 沉浸式（宽屏 / 网页全屏 / 全屏）里我们的尺寸规则整套关掉，`measure()` 写了也没人用，
 * 直接跳过；回到窗口态才需要重算 —— 窗口宽度没变时连 `measure()` 都不用跑，它写的
 * 5 个变量跟原来一模一样，只补一次卡片几何就够。
 *
 * 「切全屏卡一下」的收益来自别处，别回来动这里：
 *   - `videoFullscreen.ts` 的补间时长（280/240 → 200/180）—— 用户看到的就是这段动画；
 *   - 退出网页全屏时那次多余的强制排版（`offsetHeight`）已删；
 *   - `setRootVar()` 值没变就不写，省掉整棵树重新匹配样式。
 */
function handleScreenChange(screen: PlayerScreen) {
  const root = document.documentElement
  const immersive = screen === 'wide' || screen === 'web' || screen === 'full'
  root.classList.toggle(ROOT_IMMERSIVE, immersive)
  root.classList.toggle(ROOT_ROUND, screen !== 'web' && screen !== 'full')
  root.classList.toggle(ROOT_SEND_NATIVE, screen === 'web' || screen === 'full')
  // 沉浸式里播放页尺寸整块归 B 站算（measure 根本不跑），半顶栏那套「左栏上移 64px +
  // 右栏宽度」对不上，顶栏也会飘到视频上 —— 整条让位，退回全宽那条。
  root.classList.toggle(ROOT_HALF, !immersive && halfTopbarOn())
  if (!betaOn())
    return
  if (!immersive) {
    if (document.documentElement.clientWidth !== lastVw) measure()
    else layoutUp()
  }
  // 进出全屏时 B 站会把发送栏搬来搬去、控制栏还会整块重建 —— 每次都要重新接管一遍
  ensureSendingBar()
}

/**
 * 嵌入模式（悬浮窗里的视频页）首帧音量护栏。
 *
 * **现象一**（用户报）：动态里的视频在悬浮窗里打开时，先「轰」一下非常大声，随后才回到正常音量。
 *
 * **原因**：悬浮窗 iframe（www.bilibili.com）嵌在 t.bilibili.com 里是**同站**的，
 * localStorage 并没有被分区 —— 播放器读得到用户的保存音量。真正的坑在**时序**：
 * 打开悬浮窗是用户刚点过的一次点击，手势激活会传进 iframe，自动播放可能抢在播放器
 * 把保存音量写进 `<video>` 之前就开始出声；播放器启动早期还可能先写一个内置默认值。
 * 「轰」的那一下就是首声到真正音量落位之间的这段。
 *
 * **v024 的「先静音、见到 <1.0 的写入就解除」为什么没用**：两条解除路径都可能踩空 ——
 * 那个 <1.0 的写入可能只是内置默认值（不是保存音量），1 秒兜底也可能赶在真正的恢复之前；
 * 两条路都会在错误音量上解除静音，爆音照旧。
 *
 * **现象二（用户报，v015 修）**：悬浮窗打开后**完全没声音**，点一下静音再取消静音就恢复。
 * 根因：v024 的「读不到保存音量就先静音」兜底，而它读的键名（`bilibili_player_settings`）
 * 在现在的播放器上已经不存在了（改叫 `bpx_player_profile`），于是**每次**都走静音兜底；
 * 更糟的是播放器把「被静音的 `<video>`」当成「用户把音量拖到 0」存回去
 * （实测 profile 变成 `volume: 0` / `nonzeroVol: 0.9`），下次打开还是 0 —— 死循环。
 *
 * **改法（只写 `volume`，绝不碰 `muted`）**：
 *   1. 从 `bpx_player_profile.media.volume` 读保存音量（旧键 `bilibili_player_settings`
 *      兜底）。读不到就**什么都不做** —— 播放器自己的默认音量就是最终音量，别替它猜。
 *   2. 视频元素一出现就把保存音量写进 `<video>.volume`（MutationObserver 回调是插入任务后的
 *      microtask，抢在播放管线出声之前），之后谁把它改走（播放器 boot 写 1.0）就再写回来，
 *      直到播放器自己写出同值为止（说明它的恢复流程跑完了）；1.5s 兜底收工。
 *   3. **永远不写 `muted`**：静音会被播放器当成「用户把音量拖到 0」持久化，正是现象二的根；
 *      而「起播那一段别出声」已经由 holdEmbedAutoplay 扣在暂停上，不需要再靠静音压。
 *   4. 一次性修复历史坏值：`volume === 0 && nonzeroVol > 0` 是「被静音写坏的」，
 *      按 `nonzeroVol`（B 站自己记的「取消静音恢复到多少」）修回去；**只修一次**，
 *      之后用户真把音量拖到 0 不会被我们改回来。
 *
 * 只装在嵌入模式。B 站自己切换分 P 时如果换了 `<video>` 节点，观察器会再护一次。
 */
const AUDIO_GUARD_CAP_MS = 1500
const AUDIO_GUARD_POLL_MS = 100
const AUDIO_GUARD_EPS = 0.005
/** 播放器档案：新版把音量放在 media 里，旧版在 video_status 里（两个都试） */
const PLAYER_PROFILE_KEY = 'bpx_player_profile'
const PLAYER_SETTINGS_KEY = 'bilibili_player_settings'
/** 「历史坏值已修过」的标记，防止把用户自己拖到 0 的音量又改回去 */
const AUDIO_REPAIR_KEY = 'bili-elite-audio-repair'

interface SavedVolume {
  /** 当前音量 0–1 */
  volume: number
  /** B 站记的「取消静音时恢复到多少」；没有就是 0 */
  nonzero: number
}

function pickVolume(raw: string | null, container: string): SavedVolume | null {
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown> | undefined>
    const node = parsed?.[container]
    if (!node)
      return null
    const volume = node.volume
    if (typeof volume !== 'number' || volume < 0 || volume > 1)
      return null
    const nonzero = node.nonzeroVol
    return {
      volume,
      nonzero: typeof nonzero === 'number' && nonzero > 0 && nonzero <= 1 ? nonzero : 0,
    }
  }
  catch {
    return null
  }
}

/** 读播放器保存在 localStorage 里的音量（同站 iframe 读得到；读不到就返回 null） */
function savedPlayerVolume(): SavedVolume | null {
  try {
    return pickVolume(localStorage.getItem(PLAYER_PROFILE_KEY), 'media')
      ?? pickVolume(localStorage.getItem(PLAYER_SETTINGS_KEY), 'video_status')
  }
  catch {
    return null
  }
}

/** 把「被静音写成 0」的档案修回 nonzeroVol —— 只做一次，之后不再插手用户的音量 */
function repairZeroVolume(target: number) {
  try {
    if (localStorage.getItem(AUDIO_REPAIR_KEY))
      return
    localStorage.setItem(AUDIO_REPAIR_KEY, '1')
  }
  catch {
    return
  }
  try {
    const raw = localStorage.getItem(PLAYER_PROFILE_KEY)
    if (!raw)
      return
    const profile = JSON.parse(raw) as { media?: { volume?: number } }
    if (!profile?.media || profile.media.volume !== 0)
      return
    profile.media.volume = target
    localStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile))
  }
  catch { /* 存储被拒（隐私模式 / 分区）就算了，只修内存里那个 video */ }
}

function guardEmbedAudio() {
  if (!isEmbedMode() || audioGuardObserver) return

  // 保存音量只读一次：一次会话里它不会变（变了也是用户在播放器里拖的，与我们无关）
  const saved = savedPlayerVolume()
  let target: number | null = saved?.volume ?? null
  // 被静音写坏的历史值（volume 0 + 还记得上一档非零音量）：修回 nonzeroVol，只修一次
  if (saved && saved.volume === 0 && saved.nonzero > 0) {
    target = saved.nonzero
    repairZeroVolume(target)
  }

  const guard = (video: HTMLVideoElement) => {
    if (video.dataset.blieAudioGuard) return
    // 只护主播放器；推荐卡的悬停预览 / 广告视频不碰
    if (!video.closest('#playerWrap, #bilibili-player, .bpx-player-container')) return
    video.dataset.blieAudioGuard = '1'

    // 读不到保存音量（存储被拒 / 分区）或本来就是 100%：没有「先大声后回落」可言，
    // 一个字节都不动 —— 播放器自己的默认音量就是最终音量
    if (target === null || target > 0.999) return

    const want = target
    let retired = false
    let pollTimer = 0

    const retire = () => {
      if (retired) return
      retired = true
      window.clearInterval(pollTimer)
      video.removeEventListener('volumechange', onVolumeChange)
    }

    // 只写 volume。**永远不写 muted** —— 静音会被播放器当成「用户把音量拖到 0」存回去，
    // 下次打开就是没声音（见文件头「现象二」）。
    const align = () => {
      if (retired) return
      if (Math.abs(video.volume - want) <= AUDIO_GUARD_EPS) {
        // 播放器自己写出了保存音量：它的恢复流程已经跑完，收工
        retire()
      }
      else {
        // 谁把音量改走了（boot 写 1.0 / 内置默认值 / 换 P 重建）：写回用户值
        video.volume = want
      }
    }

    const onVolumeChange = () => align()

    // 首声之前把音量钉死。写同值不触发 volumechange，所以「播放器插入前就写好了」的场景零打扰。
    video.volume = want
    video.addEventListener('volumechange', onVolumeChange)
    // volumechange 兜不住「元素插入前音量就被写好」（没有事件可听）：轮询补一拍，
    // 同时巡回纠正「我们写的值后来被播放器改走」的情况。
    pollTimer = window.setInterval(align, AUDIO_GUARD_POLL_MS)
    audioGuardTimers.push(pollTimer)
    const capTimer = window.setTimeout(() => {
      align()
      retire()
    }, AUDIO_GUARD_CAP_MS)
    audioGuardTimers.push(capTimer)
  }

  const scan = (root: ParentNode) => {
    const el = root as Element
    if (el.tagName === 'VIDEO')
      guard(el as HTMLVideoElement)
    root.querySelectorAll?.('video').forEach(node => guard(node as HTMLVideoElement))
  }

  scan(document)
  audioGuardObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE)
          scan(node as Element)
      }
    }
  })
  audioGuardObserver.observe(document.documentElement, { childList: true, subtree: true })
}

function stopEmbedAudio() {
  audioGuardObserver?.disconnect()
  audioGuardObserver = null
  for (const timer of audioGuardTimers)
    window.clearTimeout(timer)
  audioGuardTimers = []
}

/* ===== 嵌入模式 · 起播闸门 =====
   悬浮窗这一侧是跨源 iframe，父页面读不到文档，只能等它的 load 事件才揭开
   （dynamicOverlay.ts 的 finishLoad，load + 160ms）；而 B 站播放器的自动播放赶在
   load 之前就开始了 —— 转圈的那一两秒里视频已经在底下出声走画面，揭开时开头
   已经过去一小段（用户报的「打开视频时开头被跳过」）。

   所以嵌入模式把起播扣住：play 事件一律先 pause，等父页面揭幕时 postMessage
   过来（EMBED_REVEAL_MSG）再放行。播放器的 UI / 弹幕引擎本来就靠 video 元素自己的
   play / pause 事件驱动，我们只是在 play 里补一个 pause、放行时补一个 play，
   不碰播放器内部状态 —— 扣住期间整个 iframe 被占位的转圈盖着，暂停态的 UI 谁也看不见。 */

/** 父页面揭幕时发来的消息类型。**和 dynamicOverlay.ts 的 notifyFrameReveal 是同一个值**，改一边要同步另一边 */
export const EMBED_REVEAL_MSG = 'blie-elite:dyn-reveal'

/** 闸门是否还扣着（start 可能被配置变化重复调用，靠它防监听器叠加） */
let embedHoldOn = false
let holdPlayListener: ((event: Event) => void) | null = null
let holdMessageListener: ((event: MessageEvent) => void) | null = null
let holdFallbackTimer = 0
/** 被我们暂停过、揭幕后要接回去的 video（换 P 重建的节点也认） */
const heldVideos = new WeakSet<HTMLVideoElement>()

function releaseEmbedHold() {
  if (!embedHoldOn) return
  embedHoldOn = false
  if (holdPlayListener) {
    document.removeEventListener('play', holdPlayListener, true)
    holdPlayListener = null
  }
  if (holdMessageListener) {
    window.removeEventListener('message', holdMessageListener)
    holdMessageListener = null
  }
  if (holdFallbackTimer) {
    window.clearTimeout(holdFallbackTimer)
    holdFallbackTimer = 0
  }
  // 播放器在「起播被我们扣住」的那一两秒里可能自己把 <video> 静音（自动播放被拦时的兜底），
  // 而它的 UI 还显示未静音 —— 用户看到的就是「打开没声音，点一下静音再取消才恢复」。
  // 档案里的音量非 0 就说明用户没打算静音，放行时顺手解开（档案读不到就不动，别替用户决定）。
  const saved = savedPlayerVolume()
  const wantSound = !!saved && saved.volume > 0.001
  document.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
    if (!heldVideos.has(video) || video.ended) return
    if (wantSound && video.muted)
      video.muted = false
    // 揭幕离用户那一下点击通常不到 5s，手势激活还在，带声放行没问题；真被自动播放
    // 策略拦下就保持暂停 —— 播放器的大播放键还在，用户点一下就能放
    video.play().catch(() => {})
  })
}

function holdEmbedAutoplay() {
  if (!isEmbedMode() || embedHoldOn) return
  embedHoldOn = true

  holdPlayListener = (event: Event) => {
    const video = event.target as HTMLVideoElement
    if (!video || video.tagName !== 'VIDEO') return
    // 只扣主播放器；推荐卡悬停预览之类的视频不碰（和 guardEmbedAudio 同一份判据）
    if (!video.closest('#playerWrap, #bilibili-player, .bpx-player-container')) return
    heldVideos.add(video)
    video.pause()
  }
  // play 不冒泡，但捕获阶段会从 document 一路下来 —— 必须在捕获挂（document_start 就位，
  // 播放器随后的第一次 play() 一定拦得到）
  document.addEventListener('play', holdPlayListener, true)

  holdMessageListener = (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const data = event.data as { type?: string } | null
    if (!data || data.type !== EMBED_REVEAL_MSG) return
    releaseEmbedHold()
  }
  window.addEventListener('message', holdMessageListener)

  // 父页面最迟 20s（它的 loadTimer 兜底）必发揭幕消息；这条再兜一层 —— 万一父页面
  // 脚本整个没跑起来，宁可揭开前白等几秒，也不能让视频永远扣在暂停上
  holdFallbackTimer = window.setTimeout(releaseEmbedHold, 30000)
}

function start() {
  const root = document.documentElement
  root.classList.add(ROOT)
  // 嵌入模式（悬浮窗里的视频页）：挂上类让 CSS 收掉顶栏 / 右栏推荐 / 背景
  root.classList.toggle(ROOT_EMBED, isEmbedMode())
  // 自动播放可能抢在播放器把保存音量写进 <video> 之前出声：视频元素一出现就把我们自己
  // 读到的保存音量钉上去，直到播放器自己写出同值（见 guardEmbedAudio 的「音量锚定」）。
  // 同时把起播扣到父页面揭幕那一刻：转圈期间视频一个画面都不走，开头不会白过（见 holdEmbedAutoplay）。
  if (isEmbedMode()) {
    guardEmbedAudio()
    holdEmbedAutoplay()
  }
  ensureStyle()
  // 半顶栏的类要在第一次 measure 之前落定：它决定左右栏间距（24 / 12）
  applyHalfTopbar()
  measure()
  // 宽屏 / 网页全屏 / 全屏时不接管尺寸（那三种模式 B 站自己算一套）
  root.classList.toggle(ROOT_IMMERSIVE, isPlayerImmersive())
  // 播放器圆角只在「不是整屏」的模式下挂（宽屏算窗口态，见 ROOT_ROUND）
  root.classList.toggle(ROOT_ROUND, !isPlayerFullscreen())
  // 网页全屏 / 全屏下发送栏也整套交回 B 站（宽屏不算，见 isPlayerFullscreen）
  root.classList.toggle(ROOT_SEND_NATIVE, isPlayerFullscreen())
  bindObservers()
  if (!observer) watchForLayout()
  // bindObservers 里节点没齐时会提前返回，这里再试一次（节点到齐了就自己跳过）
  watchSizes()
  // 话题链接 / 占位骨架不用等水合（纯加法 / 纯 class），能多早就多早
  earlyTries = 0
  pumpEarly()
  // 首帧前那 1.3s 的黑屏：用封面顶上（见 ROOT_POSTER 那段注释）。轮询到
  // `__INITIAL_STATE__` 就挂，和播放器自己的初始化并行，不占它的顺序
  startPoster()
  // 真链接（可点击的那一版）要等 B 站渲染完再插，判据见 SETTLE_QUIET_MS 的注释
  settled = false
  lastTreeChange = performance.now()
  settleUntil = performance.now() + SETTLE_MAX_MS
  pumpSettle()
  scheduleMove()

  if (!resizeBound) {
    window.addEventListener('resize', onResize, { passive: true })
    resizeBound = true
  }
  // 滚动结束 / 切回标签页各兜一次底（见 onScrollEnd）。`scrollend` 是 Chrome 114+ 的，
  // 老版本没有就是没有 —— 只少了这层兜底，主逻辑不受影响。
  if (!healBound) {
    document.addEventListener('scrollend', onScrollEnd, { passive: true } as AddEventListenerOptions)
    document.addEventListener('visibilitychange', onVisibilityChange)
    healBound = true
  }
  // 滚动条占位不触发 resize，得单独盯视口宽度（见 watchViewport 的注释）
  watchViewport()

  // 兜底：万一标题一直没出现（页面结构变了 / 加载失败），2.5s 后也让卡片现身，
  // 不然它永远是 visibility: hidden —— 宁可位置不完美，也不能整个不见。
  // 但先按此刻的布局再量一次：能量出来说明只是轮询没跑到，别把卡片钉在 0px 上
  // （那就是用户报的「控件像悬浮窗一样挂在半空」）。
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = window.setTimeout(() => {
    readyTimer = 0
    layoutUp()
    if (root.classList.contains(UP_READY)) return
    root.classList.add(UP_READY)
  }, 2500)

  // 简介卡的点击委托挂在 document 上（见 onDescClick），只挂一次
  if (!descClickBound) {
    document.addEventListener('click', onDescClick)
    descClickBound = true
  }
  // 简介按钮的涟漪也委托在 document 上（样式挂点在 videoBeta.css §11.2）。
  // **只认 B 站那颗原版 `.toggle-btn`**：点卡片展开走 onDescClick 的 detail:1 派发，
  // 不会命中涟漪这条路径（见 onDescClick 的注释）
  if (!offDescRipple)
    offDescRipple = installRipple(document, DESC_RIPPLE)
  syncDesc()

  // 重复 start（同一份配置被应用两次）时先退掉旧订阅，免得监听器越积越多
  offScreen?.()
  offScreen = onPlayerScreenChange(handleScreenChange)
}

function stop() {
  const root = document.documentElement
  root.classList.remove(ROOT, ROOT_IMMERSIVE, ROOT_ROUND, ROOT_SEND_NATIVE, ROOT_HALF, ROOT_EMBED, ROOT_EMBED_SPLIT, NODESC_CLASS, DESC_FOLDED, DESC_FIT, UP_READY, MULTI_CLASS)
  if (descClickBound) {
    document.removeEventListener('click', onDescClick)
    descClickBound = false
  }
  offDescRipple?.()
  offDescRipple = null
  unbindObservers()
  stopWait()
  stopPoster()
  stopEmbedAudio()
  // 闸门不摘的话，「播放页优化」开关中途关掉会把悬浮窗里的视频永远扣在暂停上
  releaseEmbedHold()
  embedSplitOn = false
  restoreUpPanel()
  restoreTags()
  unwatchSendingBar()
  unwatchWatching()
  restoreSendingBar()
  offScreen?.()
  offScreen = null
  if (resizeBound) {
    window.removeEventListener('resize', onResize)
    resizeBound = false
  }
  if (healBound) {
    document.removeEventListener('scrollend', onScrollEnd)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    healBound = false
  }
  if (rafResize) {
    cancelAnimationFrame(rafResize)
    rafResize = 0
  }
  unwatchViewport()
  if (descRejudgeTimer) {
    clearTimeout(descRejudgeTimer)
    descRejudgeTimer = 0
  }
  clearUpTop()
  if (readyTimer) {
    clearTimeout(readyTimer)
    readyTimer = 0
  }
  if (moveTimer) {
    clearTimeout(moveTimer)
    moveTimer = 0
  }
  if (earlyTimer) {
    clearTimeout(earlyTimer)
    earlyTimer = 0
  }
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = 0
  }
  earlyTries = 0
  moveArmed = false
  moveDeadline = 0
  lastLeftTop = null
  lastDescTop = 0
  lastMulti = null
  clearVars()
  document.getElementById(STYLE_ID)?.remove()
}

/**
 * 只在**主站普通播放页**（`/video/BVxxx`）生效。
 *
 * 这套样式除了 `#mirror-vdcon` / `.left-container`，还写了一堆 `.bpx-player-*`（B 站播放器的
 * **公共**类名）和 `#bilibili-player`。直播页的播放器用的是同一套类名，root class 一挂上去，
 * 直播画面就被按播放页那套尺寸接管了 —— 实测直播页 `video` 变成 0×8、`#live-player` 只剩
 * 1017×84（用户看到的「直播画面不显示」）。所以先按地址判定，别的页面一个字节都不碰。
 *
 * 1.1.6 v021：**番剧 / 纪录片 / 影视这些 `/bangumi/play/*` 页也排除掉了。**
 * 它们根本是另一套 DOM —— 没有 `#mirror-vdcon`，也没有 `.left-container` / `.right-container`，
 * 播放器是 `#bilibili-player` 直接挂在剧集布局里。而我们的 `#playerWrap` / `#bilibili-player`
 * 尺寸规则（`--bili-vb-left` × 16:9）是**不分页面**的，挂上 root class 就会把播放器强行改成
 * 窗口算出来的宽度：实测某番剧页 668×432 → 1099×618，直接压过剧集列表。
 * 这类特殊播放页的排版差异太大（剧集列表 / 分集 / 追番 / 评分卡…），不做改动。
 *
 * 1.2.1 v006 起导出：`commentPreload.ts`（评论预加载）也要同一份判定 —— 它搬的
 * `#commentapp` 只在这类页面存在，判定必须一模一样，不然会去动番剧页。
 */
export function isVideoPage() {
  if (location.hostname !== 'www.bilibili.com') return false
  return location.pathname.startsWith('/video/')
}

/**
 * @param force 嵌入模式（悬浮窗里的视频页）传 true：不管「播放页优化」开关开没开都排版。
 *   悬浮窗本身就是「要用我们这套播放页」的表达，关掉开关不该让它变成半套布局。
 */
export function setupVideoBeta(force = false): () => void {
  // 直播 / 首页 / 空间 / 搜索… 一律不接管（见 isVideoPage 的注释）
  if (!isVideoPage()) return () => {}
  betaForced = force
  // 样式尽早注入（document_start）：播放页要 2~3s 才渲染出播放器，
  // 但播放器一出现就该是最终尺寸，晚一步会先看到「居中 + 大留白」再跳一下
  if (betaOn()) start()
  else ensureStyle()

  const off = onConfigChange((key) => {
    // 半顶栏的三个依赖项任意一个变了，都要重切类 + 重新量（见 ROOT_HALF 的注释）
    if (key === 'videoHalfTopbar' || key === 'customTopbar') {
      applyHalfTopbar()
      return
    }
    if (key !== 'videoBeta') return
    if (betaOn()) start()
    else stop()
  })

  return () => {
    off()
    stop()
  }
}

export interface FeatureDef {
  key: string
  label: string
  default: boolean
  group: string
  /** 为 true 时，在它之前断开「无滑块的合并卡片」，让它另起一张卡（见 settingsPanel.ts） */
  cardBreak?: boolean
  /**
   * 挂到同组另一项（带滑块的那张卡）里面，作为它下面的一行。
   * 父项关闭时整行变灰不可点 —— 用在「顶栏渐变」这种依附于某个材质的子选项上。
   */
  under?: string
  /** 卡片上方那行灰色小字：说明这张卡控制的是哪一块（开关统一叫「材质」后就靠它区分） */
  note?: string
  /**
   * 标签右边那颗灰色感叹号里的说明（悬停 / 聚焦才展开）。
   * 只给「光看标签看不出开了会怎样」的开关写，别给每一项都挂一颗。
   */
  hint?: string
}

export const FEATURES = [
  // 这里的 default 就是「默认设置」：首次安装、以及设置面板里点「恢复默认设置」后落到这套值。
  // 实验室那一项默认关闭。
  { key: 'webscreenAnim', label: '网页全屏动画', default: true, group: '动效增强' },
  // 宽屏（播放器右下角那个「宽屏」按钮）与网页全屏是两条独立的路：它只把播放器撑宽、
  // 右栏挪到下面，不接管整屏。动画同样是 FLIP，开关单独一个 —— 有人喜欢撑开时那一下缩放，
  // 也有人只想让它「瞬间到位」。
  { key: 'wideAnim', label: '宽屏模式动画', default: true, group: '动效增强' },
  { key: 'imageAnim', label: '评论区图片动画', default: true, group: '动效增强' },
  // 打开设置面板时卡片错开淡入（面板本身的开合动画不动，见 panel.css §19）。
  // 1.0.3 从「动效增强」移进实验室；1.1.1 与夜间模式一起转正到个性设置；
  // 1.2.3 v018 又挪回「动效增强」（用户要求）—— 它本来就是动效，放在个性设置里不好找。
  // 1.2.3 v017 起默认开启 —— 只改 default，不给老用户做强制迁移：已经保存过配置的人
  // 保持存储里的值（见 CHANGELOG v017 关于「改默认值」的说明）。
  // 1.2.5 v005 改回默认关闭：卡片错开淡入在打开面板时会让后面的卡片空等几百毫秒，
  // 用户反馈「点了没反应 / 关不掉」，干脆默认不做，想要的人自己开。
  { key: 'panelCascade', label: '面板卡片级联', default: false, group: '动效增强',
    hint: '设置卡片淡入淡出效果' },
  // 「高级材质」这一页的开关统一叫「材质」、滑块统一去掉前缀（渐变 / 模糊强度 / 遮罩强度 /
  // 背景明暗）：一块材质一张卡、整行铺满，靠顺序区分是哪一块。
  { key: 'imageGlass', label: '材质', default: true, group: '高级材质', note: '评论区图片背景' },
  { key: 'topbarGlass', label: '材质', default: true, group: '高级材质', note: '顶栏' },
  // 顶栏渐变：玻璃从「实色一条」变成「上实下透」，越往下越透、和页面内容接上。
  // 挂在「顶栏材质」卡片里（under），材质关掉时这一行跟着变灰
  { key: 'topbarFade', label: '渐变', default: true, group: '高级材质', under: 'topbarGlass' },
  // 1.1.6 v011：搜索框 / 搜索面板 / 触发面板三块材质默认关闭（用户要求）。
  // 只有「顶栏」那块仍默认开 —— 它决定的是顶栏本体，不是弹出来的浮层。
  { key: 'searchBoxGlass', label: '材质', default: false, group: '高级材质', note: '搜索框' },
  { key: 'searchPanelGlass', label: '材质', default: false, group: '高级材质', note: '搜索面板' },
  // 悬停顶栏「首页」展开的频道面板（自绘 #bili-elite-home-panel）+ 右侧头像 / 消息 /
  // 动态 / 收藏 / 历史的悬停浮层 + 首页卡片右下角「⋮」的悬停菜单。两个滑块的默认值与
  // 「搜索面板材质」一致（38px / 61%），因为都是弹出来的浮层，观感要统一。
  // 1.1.1：卡片的「⋮」菜单并进这一块材质（同一个开关、同一组滑块，见 topbar.css §7.5）。
  { key: 'homePanelGlass', label: '材质', default: false, group: '高级材质', note: '触发面板' },
  // 设置面板材质：默认关闭。它是唯一一块「盖在设置面板上」的材质 —— 面板本身要
  // 长时间读数值、调滑块，毛玻璃会把底下的文字透出来，长时间看比实色底累。
  // 想要的话自己开，其它几块材质仍然默认开。
  { key: 'panelGlass', label: '材质', default: false, group: '高级材质', note: '设置面板' },
  // 功能轮盘的圆盘背景：默认开（24px / 86%，与之前写死的观感一致）。
  // 关掉就是一块实色圆盘 —— 在视频页那种深色画面上，实色反而更干净。
  { key: 'wheelGlass', label: '材质', default: true, group: '高级材质', note: '轮盘背景' },

  // 顶栏优化：整条顶栏由扩展自绘（logo / 首页 ∨ + 频道面板 / 动态 / 搜索框 + 搜索面板 /
  // 右侧图标区），第一帧就在，不再等 B 站那套 header 脚本（实测播放页 1.2s、冷缓存 4~5s）。
  // 原生顶栏只是 visibility: hidden，仍然占着文档流里那 64px，所以开关来回切页面都不会跳。
  // 关掉就退回原生顶栏 + 我们原来那套改造（topbarOptimize.ts），两套不共存。
  { key: 'customTopbar', label: '顶栏优化', default: true, group: '界面优化',
    hint: '自绘精简版顶栏，提供更多个性化选项' },
  // 视频页半顶栏（1.1.6 v011，v012 起默认开）：整条顶栏只画在右栏推荐流上方，左边视频那一块
  // 完全没有顶栏 —— 播放器因此能顶到窗口最上面（留 10px 空隙），左侧播放区跟着大一点。
  // 实现分两半：顶栏自身的收缩在 selfTopbar.css §8，左栏上移 / 尺寸重算在 videoBeta.ts
  // （所以它依赖「播放页优化」，那边关掉时这一项什么都不做）。
  // under：挂在「顶栏优化」那张卡里，顶栏关掉时整行变灰（与「投稿按钮移除」同一套）。
  { key: 'videoHalfTopbar', label: '播放页半顶栏', default: true, group: '界面优化', under: 'customTopbar' },
  // 投稿按钮（右侧那颗 90×34 的粉色胶囊）默认收掉：投稿是低频动作，它在最右边一直
  // 占着 100px（90 + 10 左边距）。收掉之后右侧那排图标靠 .tb-right 的 margin-left:auto
  // 自动右移补位，不会留下缺口。挂在「顶栏优化」那张卡里（under），顶栏关掉时整行变灰。
  // v011：标签右边的感叹号去掉（用户要求），说明只留在代码里。
  { key: 'uploadBtnHide', label: '投稿按钮移除', default: true, group: '界面优化', under: 'customTopbar' },
  { key: 'homeOptimize', label: '首页优化', default: true, group: '界面优化' },
  // 搜索页优化：把搜索结果的 bootstrap 固定列栅格（1920 下 7 列、卡片只有 275px）
  // 换成与首页同一套 auto-fill，留白也从写死的 96px 换成响应式窄栏；
  // 带「卡片大小」滑块（searchCardConfig.ts），默认值与首页那张卡一致（350px）。
  { key: 'searchOptimize', label: '搜索页优化', default: true, group: '界面优化' },
  { key: 'searchPanelOpt', label: '搜索面板优化', default: true, group: '界面优化' },
  // 播放页优化（1.1.4 从「实验室 → 播放页beta」转正并改名）：把播放页从「居中 + 大留白」改成满宽
  // （播放器吃掉右栏之外的全部宽度），标题 / 播放数据 / UP 主 / 操作栏按经典版顺序
  // 排到播放器下方，右栏去掉「推荐 / 最近上传 / 番剧…」那条分类条。
  // 为什么转正：1.1.4 把这套排版跑了一整轮实测（停顿重播 / 话题加载 / 作者行 / 简介卡 /
  // 投票卡 / 宽屏与网页全屏让位 / 直播页误伤 ……都已修完），它已经不是「试一试」的东西了。
  // 想回到原版布局就在面板里关掉它，关掉之后页面一个字节都不改。
  // 卡里还挂着「封面大小」滑块（railCardConfig.ts）：那条只控制右栏推荐卡的封面宽度，
  // 开关一关整行变灰、CSS 也整段失效。
  { key: 'videoBeta', label: '播放页优化', default: true, group: '界面优化',
    hint: '播放页焕新视觉效果，带来更沉浸播放体验' },
  // 评论预加载（1.2.1 v006）：评论区在页面下方，B 站的 <bili-comments> 带 lazy-load，
  // 滚到它跟前才发第一页请求 —— 用户滚下去先看到一圈 spinner，再等 1s 才出内容。
  // 这里趁视频起播之后、带宽空出来的那段时间，把评论区「透明地挪进视口」一次，
  // 骗过它自己的 IntersectionObserver，让它先把第一页（20 条）取回来；取完立刻复位。
  // 为什么不替它发请求：评论接口响应是 no-cache，我们取回来的那份它不认（见 commentPreload.ts）。
  // 1.2.3 v003 起还要先看播放器缓冲：4K 起播那十几秒缓冲最薄，这时候插一页评论
  // （JSON + 20 个头像）就是跟播放器抢带宽 —— 缓冲没厚起来就等，等不到就这次不做。
  // under：挂在「播放页优化」那张卡里，播放页优化关掉时整行变灰、CSS 也整段失效。
  { key: 'videoCommentPreload', label: '评论预加载', default: true, group: '界面优化', under: 'videoBeta',
    hint: '视频缓冲充足后再预加载评论第一页，滚到评论区时不用再等；缓冲薄时自动让路，不跟播放器抢带宽' },
  // 「卡片边界」（首页 / 搜索页 / 视频页三个独立开关）1.2.5 v014 全部删掉：
  // 平时那圈灰描边纯粹是装饰，默认就是关的，开着还让栅格显得更挤。
  // 「卡片确认」（悬停时的灰色衬底）更早 —— 1.1.6 v010 就删掉开关改成常开：
  // 它只是一层纯 CSS 的悬停反馈，关掉之后卡片看着像死的，没人真的会去关。
  // cardBreak 挪到「卡片整体化」上：那一项照旧另起一张卡，面板分组不变。
  //
  // 卡片整体化：把 B 站那套「只有封面 + 标题能点」换成 BewlyCat 的整卡点击 ——
  // 卡片里除了 UP 主名字（要去空间，得单独保留）之外，点到哪儿都跳视频。
  // 顺带把「悬停标题变蓝」收掉：整张卡已经是一个点击目标了，标题再变色就成了
  // 卡里第二个「可点区域」的暗示，反而让人以为只有标题能点。UP 主名字仍然变蓝。
  // 事件委托在 cardWholeClick.ts，样式在 topbar.css §12.5。
  // 上游出处（BewlyBewly 的 VideoCard）与许可：见 THIRD-PARTY-NOTICES.md。
  { key: 'cardWhole', label: '卡片整体化', default: true, group: '界面优化', cardBreak: true,
    hint: '整张卡片作为交互目标' },
  { key: 'preload', label: '首页预加载', default: true, group: '界面优化' },
  // 1.1.6 v011 起，「播放页右栏留白收起 / 顶部提示条收起 / 统一返回顶部键 / 统一刷新键 /
  // 原生刷新按钮屏蔽 / 原生返回顶部按钮屏蔽」六项**从面板里删掉、行为固定为开启**：
  // 它们本来就是「把 B 站那堆散落的按钮收成一套」这种没有反悔价值的整理动作，
  // 开关只让人多按一次。样式与实现都还在（topbar.css §14 / §17、floatingButtons.ts），
  // 只是不再由 config 控制。
  // 下面三项管的是「右下角那列操作浮钮」本身（返回顶部 / 刷新 / 设置键），
  // 合成一张小卡放在界面优化末尾，卡上方那行灰字就是它的小标题。
  // 默认全关：它们是收纳类的偏好，不该替用户决定「按钮要不要躲起来」。
  // 「自动隐藏」与「半隐藏」互斥，后打开的那个生效（见 floatDock.ts）。
  { key: 'fabAutoHide', label: '自动隐藏操作浮钮', default: false, group: '界面优化', cardBreak: true, note: '操作浮钮',
    hint: '鼠标不靠近屏幕右边缘时，整列浮钮滑出屏幕；移到右边缘再滑出来' },
  // 挂在「自动隐藏」那张卡里：父项关掉时整行变灰不可点（与「顶栏渐变」同一套）
  { key: 'fabKeepActions', label: '自动隐藏时始终显示临时操作浮钮', default: false, group: '界面优化', under: 'fabAutoHide',
    hint: '只收起设置键，返回顶部与刷新始终留在原位' },
  { key: 'fabHalfHide', label: '半隐藏操作浮钮', default: false, group: '界面优化',
    hint: '默认状态只露出右半边并变淡，鼠标移上去后展开；与自动隐藏互斥，后打开者生效' },
  // 夜间模式操作浮钮（1.2.4 v001）：右下角那列浮钮里多一枚昼夜切换键。
  // **默认显示** —— 夜间模式本身仍然默认关着（改的是整站配色，不替用户决定），
  // 但这枚键只是「随时能开 / 关」的入口，放在手边比每次进设置面板方便。
  // 不需要它的人可以在这里关掉；关掉只是不渲染这颗按钮，夜间模式的开关键仍在
  // 「个性设置」页。关闭 / 打开即时生效（floatingButtons.ts 里按这个 key 切类）。
  { key: 'fabNightMode', label: '夜间模式操作浮钮', default: true, group: '界面优化',
    hint: '在右下角操作浮钮里加一枚昼夜切换键，点击即可打开 / 关闭夜间模式' },
  // ===== 功能增强 =====
  // 1.2.3 v018：新增这一页（用户要求，放在「界面优化」下面），把「让播放页打开 / 播放更快」
  // 的几项收在一起 —— 它们本来就是一条链上的，分散在两页反而不好找。
  // 从左邻右舍挪进来的两项：
  //   · 播放页开启加速（原「界面优化」）
  //   · 播放节点优选（原「实验室」，这一版起**默认开启**）
  // 节点测速工具不是开关，由 settingsPanel.ts 挂在本页末尾（见 BOOST_GROUP）。
  //
  // 播放页开启加速（1.2.1 v026 把「预取命中修复」+「首屏空闲预取」合成一项，v028 从
  // 「实验室」转正并**默认开启**，1.2.3 v018 移入「功能增强」）：两件事本来就是一条链上的 ——
  // 地址不规范化 → 预取了也命不中；不接管点击 → 命中了也会被 B 站拼的埋点参数打散；
  // 不预取首屏那几张 → 手快直接点的那次照样慢。
  // 打开后同时生效：① 预取 / 点击都走 `canonicalVideoUrl()`（去埋点参数、视频页补尾斜杠、
  // 番剧页不补），点击时若确实预取过就在捕获阶段直接导航（省掉那次 301）；
  // ② `load` 后 1.5s 空闲时把首屏最前面 3 张卡也预取掉（约 200KB/页）。
  // 只接管 `target="_blank"` 的链接（首页 / 搜索页），同页的播放页右栏交给 B 站自己的路由。
  // 实测：悬停再点 17ms、直接点 29ms、`redirectCount = 0`。
  // 默认开：它省的是每次打开播放页的那一下等待，是「打开就能感觉到」的东西；
  // 流量侧有兜底（`saveData` / 2G / 标签页隐藏整段跳过），不想花的可以在面板里关掉。
  { key: 'playBoost', label: '播放页开启加速', default: true, group: '功能增强',
    hint: '加快播放页打开速度，可能造成极少额外流量消耗' },
  // ===== 快捷功能 =====
  // 功能轮盘：按住呼出键（默认 Tab）在屏幕中央弹出圆盘，移动鼠标选一格、松开前往。
  // 只在首页、动态页与视频页生效（见 quickWheel.ts 的 pageAllowed）—— 其它页面上 Tab 是
  // 浏览器的焦点导航键，抢过来会毁掉键盘操作，所以只覆盖这几类内容页。
  // 呼出键与轮盘项目不是布尔值，存在 bili-elite-wheel 里（quickWheelConfig.ts）；
  // 「恢复默认设置」会把它一起复位。
  { key: 'quickWheel', label: '呼出功能轮盘', default: true, group: '快捷功能' },
  // 轮盘选中之后在哪儿打开：开着 = 当前标签页（1.1.3 之前的行为），关掉 = 新标签页并切过去。
  // 默认关 —— 视频正看着的时候用轮盘去「历史 / 动态」，把当前这个视频顶掉太可惜了。
  // under：挂在「呼出功能轮盘」那张卡里，轮盘关掉时这一行跟着变灰（与「顶栏渐变」同一套）。
  { key: 'wheelCurrentTab', label: '在当前标签页打开', default: false, group: '快捷功能', under: 'quickWheel' },
  // 快速使用设置面板：按呼出键（默认键盘左上角那颗 `` ` ``）直接开关右下角这块面板，
  // 不用每次都把鼠标挪过去点 ⚙。**全站生效**（不像轮盘只在那几类内容页），
  // 按键本身存在 bili-elite-panel-hotkey（panelHotkeyConfig.ts）。
  // 默认开：` 键在 B 站页面里没有别的用途，抢它不会破坏任何既有操作。
  { key: 'panelHotkey', label: '快速使用设置面板', default: true, group: '快捷功能' },
  // 页面快捷键（1.2.3）：按一下 X 刷新、按一下 Z 回到顶部，键可以在面板里改
  // （存在 bili-elite-quick-keys，见 quickKeysConfig.ts）。
  // 默认开：X / Z 在 B 站页面上没有别的用途（B 站播放器用的是 空格 / D / F / M / W），
  // 抢过来不会破坏既有操作；输入框里打字、带 Ctrl / Shift 的组合、网页全屏与全屏下都不接管
  // （见 quickKeys.ts）。
  // 「刷新」在首页只重取推荐流、滚动位置保得住，其它页面整页重载 —— 这点写在 hint 里，
  // 免得有人在视频页按 X 之后发现播放进度没了。
  { key: 'quickRefresh', label: '快速刷新', default: true, group: '快捷功能',
    hint: '按一下快捷键刷新页面；首页只刷新推荐流，其它页面会整页重载' },
  { key: 'quickBackTop', label: '快速回到顶部', default: true, group: '快捷功能',
    hint: '按一下快捷键平滑滚回页面顶部' },
  // 把右下角那颗 ⚙ 换成奶睿形象；默认关闭，保持原版悬浮球
  { key: 'mascotButton', label: '奶睿设置键', default: false, group: '个性设置' },
  // 把顶栏左上角的 logo 换成奶睿形象；默认关闭，关着仍是原版自绘字标
  { key: 'mascotLogo', label: '奶睿顶栏图', default: false, group: '个性设置' },
  // 夜间模式：1.1.1 从实验室转正。打开时同步开启 B 站自己的夜间（两套主题机制都要动，
  // 见 labFeatures.ts），我们只补顶栏 / 搜索框 / 搜索面板 / 顶栏浮层这些「B 站没管」的地方。
  // 仍然是默认关闭 —— 它改的是整站配色，不想默认替用户做这个决定。
  { key: 'nightMode', label: '夜间模式', default: false, group: '个性设置' },
  // 「面板卡片级联」1.2.3 v018 移入「动效增强」（见上面那一项）。
  // ===== 实验室 =====
  // 实验性功能：后续版本可能转为默认开启，也可能长期留在这里，还可能直接删掉 ——
  // 这就是「实验室」存在的意义。全部默认关闭：它们改的是观感与手感，
  // 一旦有兼容问题会影响整站，不适合默认上线。
  // 1.2.1 v028：「播放页开启加速」转正到「界面优化」并默认开启。
  // 1.2.3 v011：删掉「4K 流畅加速」—— 它是拿画质换带宽（HEVC 4K 只有 6.2Mbps），
  // 而「播放节点优选」能在不动编码的前提下把带宽问题解决掉，留着它只会让人选错。
  // 老用户如果开着过，guard.js 会把 B 站的编码偏好还原回去（见该文件 §6 的收尾）。
  // 1.2.3 v018：「播放节点优选」移入「功能增强」并默认开启（连同它的节点测速卡），
  // 这一页只剩「浮动键胶囊化」一项。
  { key: 'fabCapsule', label: '浮动键胶囊化', default: false, group: '实验室' },
  // 动态悬浮打开（1.2.4 v005）：动态页点一条动态的内容，不再整页跳到详情，
  // 而是在当前页弹一个悬浮窗（iframe）打开动态详情；交互参考 bili_cat 的动态详情弹窗。
  // 只在 t.bilibili.com 生效 —— 详情页与动态流同源，才能把 iframe 里的 B 站顶栏 /
  // 背景 / 侧栏收掉；个人空间是跨源的，硬开会露出一整条 B 站顶栏，所以不接管。
  // 它改的是「点击后去哪儿」，属于实验性交互，默认关闭。
  { key: 'dynamicFloatBeta', label: '动态悬浮打开beta', default: false, group: '实验室',
    hint: '在动态页点击动态内容时，用悬浮窗打开详情，不再另开标签页' },
  // 视频卡是另一条路径（跨源 iframe + 播放页排版），单独给一个下属开关：
  // 有人只想要「动态详情悬浮」，不希望点视频也被接管。
  { key: 'dynamicFloatVideo', label: '动态里的视频也悬浮打开', default: true, group: '实验室',
    under: 'dynamicFloatBeta',
    hint: '点动态里的视频卡时，在同一个悬浮窗里打开播放页（去掉右栏推荐）' },

  // 1.1.6 v015：`fullscreenAnim`（全屏关闭动画）与 `dynamicOptimize`（动态页优化）整项删除 ——
  // 前者只在「按 F 退出全屏」那一刻补一段 180ms 的 FLIP，命中面太窄（浏览器自己那条全屏
  // 退出过渡本来就够用），后者只在 t.bilibili.com 生效、默认关闭，长期没人开。
  // v016 又删了 `materialFade`（材质开关过渡）：材质开关一年点不了几次，为了那一次不硬切
  // 常驻一整份 lab.css（顶栏 ::before 叠层 + 四块浮层的颜色补间）不值得。
  // 删掉之后 `restoreDefaults` 走 DEFAULT_CONFIG，会自动把存储里的旧 key 清掉。
] as const satisfies readonly FeatureDef[]

export type FeatureKey = typeof FEATURES[number]['key']
export type FeatureConfig = Record<FeatureKey, boolean>

export const DEFAULT_CONFIG: FeatureConfig = Object.fromEntries(
  FEATURES.map(f => [f.key, f.default]),
) as FeatureConfig

export const STORAGE_KEY = 'bili-elite-settings'

export function groupFeatures() {
  const groups: Record<string, any[]> = {}
  for (const f of FEATURES) {
    ;(groups[f.group] ||= []).push(f)
  }
  return groups
}

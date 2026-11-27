# PROJECT-MAP.md — 文件 ↔ 功能 总索引

> **用途**：改任何一处功能，先在这里查到「要动哪几个文件」，再动手。
> 本文件只做索引与定位，不写规则（规则在 `AGENTS.md`）、不写历史（历史在 `CHANGELOG/`）。
>
> **维护约定**：新增 / 删除 / 改名文件时同步改这里，一次改动改一行。发现对不上就说明它过期了。

---

## 0. 三十秒定位法

| 你要做的事 | 从这里开始 |
| --- | --- |
| 改某个开关 / 滑块的**行为** | §1 按功能查 → 表里的「主逻辑」 |
| 改某个开关 / 滑块的**外观** | §1 按功能查 → 表里的「样式 / 参数」 |
| 加 / 删一个开关 | §5 场景 A |
| 加 / 删一个数值滑块 | §5 场景 B |
| 改顶栏（自绘） | `selfTopbar.ts` + `selfTopbar.css` |
| 改播放页布局 | `videoBeta.ts` + `videoBeta.css`（先读 §5 场景 E 的三条硬约束） |
| 改设置面板 | `settingsPanel.ts` + `panel.css`（§4 有分段索引） |
| 改夜间模式 | `night.css` + 各浮层的 `is-night`（§5 场景 G） |
| 改拦截 / CDN / 编码 | `extension/guard.js`（手写，不走构建） |
| 发版 / 写版本记录 | `CHANGELOG/README.md` |

---

## 1. 按功能查

`key` 列就是 `src/shared/features.ts` 里的开关名，也是 `chrome.storage` 里 `bili-elite-settings` 的字段。
顺序与设置面板一致；没有 `key` 的项是常开的。

### 动效增强

| 功能（面板上的名字） | key | 生效页面 | 主逻辑 | 样式 / 参数 |
| --- | --- | --- | --- | --- |
| 网页全屏动画 | `webscreenAnim` | 播放页、直播页 | `videoFullscreen.ts` | 时长 / 曲线在 `designTokens.css` |
| 宽屏模式动画 | `wideAnim` | 播放页 | `videoFullscreen.ts` + `playerMode.ts`（模式判定） | 同上 |
| 评论区图片动画 | `imageAnim` | 评论区、动态页相册 | `imageViewer.ts` + `imageStyle.ts` | 内联在 `imageStyle.ts`（`<style id="bili-elite-anim-style">`） |
| 自绘图片查看器（缩放/拖拽/旋转/复位/多图） | 常开 | 动态页相册（点图直接进） | `imageViewerSelf.ts` | `imageViewerSelf.css` |
| 看图器工具栏（缩小/放大/左右旋转/复位） | 常开 | 官方 PhotoSwipe（评论区等入口兜底） | `imageTools.ts` | `imageTools.css` |
| 卡片「已关注」胶囊 | 常开 | 首页（B 站原生节点，我们只改样式） | `topbarOptimize.ts`（按文本打标） | `topbar.css` §18 + `night.css` §5.2 |
| 面板卡片级联 | `panelCascade` | 设置面板 | `settingsPanel.ts` | `panel.css` §19 |

### 高级材质（每块 = 一个开关 + 一组滑块）

| 功能（卡上方灰字） | key | 生效位置 | 主逻辑 | 样式 / 参数 |
| --- | --- | --- | --- | --- |
| 评论区图片背景 | `imageGlass` | 图片查看器 | `imageGlass.ts` | `glassConfig.ts`，内联样式 |
| 顶栏（含「渐变」`topbarFade`） | `topbarGlass` | 全站顶栏 | `topbarOptimize.ts`（原生顶栏）/ `selfTopbar.ts`（自绘顶栏） | `topbarConfig.ts`；`topbar.css`「顶栏材质」段 + `selfTopbar.css` §5 |
| 搜索框 | `searchBoxGlass` | 顶栏搜索框 | `searchConfig.ts` | 同上；`topbar.css` §8 + `selfTopbar.css` §3 |
| 搜索面板 | `searchPanelGlass` | 搜索历史 / 热搜面板 | `searchPanelOpt.ts`（开合）+ `searchConfig.ts`（参数） | `topbar.css` §9 + `selfTopbar.css` §3 |
| 触发面板 | `homePanelGlass` | 频道面板、右侧图标浮层、卡片「⋮」菜单 | `homePanelConfig.ts` | `topbar.css`「顶栏材质」段 + `selfTopbar.css` §4.1 |
| 设置面板 | `panelGlass` | 设置面板本体 | `settingsPanel.ts` | `panelConfig.ts` + `panel.css` |
| 轮盘背景 | `wheelGlass` | 功能轮盘外那层虚化 | `quickWheel.ts` | `wheelGlassConfig.ts` + `quickWheel.css` |

### 界面优化

| 功能 | key | 生效页面 | 主逻辑 | 样式 / 参数 |
| --- | --- | --- | --- | --- |
| 顶栏优化 | `customTopbar` | 全站 | `selfTopbar.ts` | `selfTopbar.css` |
| └ 播放页半顶栏 | `videoHalfTopbar` | 播放页 | `selfTopbar.css` §8（顶栏收缩）+ `videoBeta.ts`（左栏上移） | 两处都要改 |
| └ 投稿按钮移除 | `uploadBtnHide` | 全站 | `selfTopbar.ts` | `selfTopbar.css` §4 |
| 首页优化 | `homeOptimize` | 首页 | `topbarOptimize.ts` | `homeOptimize.css` + `topbar.css`（首页段 / §12 / §16）；卡片大小 `homeCardConfig.ts` |
| 搜索页优化 | `searchOptimize` | 搜索页 | `topbarOptimize.ts`（筛选按钮 + 分类标签的涟漪安装）；指示条定位 `searchTabs.ts` | `searchOptimize.css`（栅格 + 筛选按钮 + 分类标签栏）；卡片大小 `searchCardConfig.ts` |
| 空间页优化 | `spaceOptimize` | 个人空间 `space.bilibili.com` | `spaceOptimize.ts`（注入样式 + 三类控件涟漪） | `spaceOptimize.css`（侧边分类 / 排序胶囊 / 播放全部） |
| 搜索面板优化 | `searchPanelOpt` | 顶栏搜索面板 | `searchPanelOpt.ts` | `topbar.css` §9 |
| 播放页优化 | `videoBeta` | 播放页（番剧页排除） | `videoBeta.ts` | `videoBeta.css`；右栏封面 `railCardConfig.ts` |
| └ 评论预加载 | `videoCommentPreload` | 播放页 | `commentPreload.ts` | `videoBeta.css` §13 |
| 卡片整体化 | `cardWhole` | 首页 / 搜索页 / 播放页右栏 | `cardWholeClick.ts` | `topbar.css` §12.5 |
| 首页预加载 | `preload` | 首页 | `topbarOptimize.ts` | `preloadConfig.ts` + `topbar.css` §11 |
| 操作浮钮 · 自动隐藏 | `fabAutoHide` | 全站右下角 | `floatingButtons.ts` + `floatDock.ts` | `floatingButtons.css` |
| └ 自动隐藏时保留操作键 | `fabKeepActions` | 同上 | `floatDock.ts` | 同上 |
| 操作浮钮 · 半隐藏 | `fabHalfHide` | 同上 | `floatDock.ts` | 同上 |
| 夜间模式操作浮钮 | `fabNightMode` | 同上 | `floatingButtons.ts` | 同上 |
| 设置管理（恢复默认） | — | 设置面板 | `settingsPanel.ts`（`restoreDefaults`）+ 各 `*Config.ts` 的 `resetXxxParams()` | `panel.css`「设置管理」段 |

### 功能增强

| 功能 | key | 生效页面 | 主逻辑 | 样式 / 参数 |
| --- | --- | --- | --- | --- |
| 播放页开启加速 | `playBoost` | 首页 / 搜索页 / 播放页 | `hoverPrefetch.ts`（预取 + 点击接管 + 首屏空闲预取） | — |
| 节点测速 / 手动切节点 | — | 播放页 | `cdnBoost.ts`（面板侧读写工具 + 选择落 sessionStorage）+ **`extension/guard.js` §7**（测速与分片改写，真正干活的地方） | `panel.css` §25（节点测速） |

### 快捷功能

| 功能 | key | 生效页面 | 主逻辑 | 样式 / 参数 |
| --- | --- | --- | --- | --- |
| 呼出功能轮盘 | `quickWheel` | 首页 / 动态页 / 播放页 | `quickWheel.ts` + `quickWheelLayout.ts`（几何） | `quickWheel.css`；配置 `quickWheelConfig.ts` |
| └ 在当前标签页打开 | `wheelCurrentTab` | 同上 | `quickWheel.ts` + `background/main.ts`（新标签页时） | — |
| 快速使用设置面板 | `panelHotkey` | 全站 | `settingsPanel.ts` | 按键存 `panelHotkeyConfig.ts` |
| 快速刷新 | `quickRefresh` | 全站 | `quickKeys.ts` → `pageActions.ts` | 按键存 `quickKeysConfig.ts` |
| 快速回到顶部 | `quickBackTop` | 全站 | 同上 | 同上 |

### 个性设置

| 功能 | key | 生效位置 | 主逻辑 | 样式 |
| --- | --- | --- | --- | --- |
| 奶睿设置键 | `mascotButton` | 右下角 ⚙ | `settingsPanel.ts` | `panelButton.css` |
| 奶睿顶栏图 | `mascotLogo` | 自绘顶栏 logo | `selfTopbar.ts` | `selfTopbar.css` §2 |
| 夜间模式 | `nightMode` | 全站 | `labFeatures.ts` 的 `setNightMode()`（**唯一入口**，含圆形过渡） | `night.css` + `panel.css` §21 + `quickWheel.css` + `selfTopbar.css` |

### 实验室

| 功能 | key | 生效页面 | 主逻辑 | 样式 / 参数 |
| --- | --- | --- | --- | --- |
| 浮动键胶囊化 | `fabCapsule` | 全站 | `floatingButtons.ts` | `floatingButtons.css` |
| 动态悬浮打开beta | `dynamicFloatBeta` | 动态页 `t.bilibili.com` | `dynamicOverlay.ts` | `dynamicOverlay.css` |
| └ 动态里的视频也悬浮打开 | `dynamicFloatVideo` | 同上 | `dynamicOverlay.ts` + `videoBeta.ts`（嵌入模式） | `dynamicOverlay.css` + `videoBeta.css`「嵌入模式」段 |

### 常开（面板里没有开关）

| 功能 | 生效页面 | 文件 | 说明 |
| --- | --- | --- | --- |
| 广告卡屏蔽 | 全站 | `adBlock.ts` + `adBlock.css` | 纯 CSS，`document_start` 就注入 |
| 埋点 / 广告 / 质量上报拦截 | 全站 | `extension/guard.js` | MAIN world，改法见 §5 场景 H |
| 设计 token（动效三档 / 圆角） | 全站 | `designTokens.ts` + `designTokens.css` | 必须最先注入 |
| 后退时还原滚动位置 | 全站 | `returnRestore.ts` | 抢在浏览器恢复滚动之前 |
| 轮盘「新标签页打开」 | 全站 | `background/main.ts` | 内容脚本拿不到 `chrome.tabs` |

---

## 2. 按文件查

```
src/
  manifest.ts               动态生成 extension/manifest.json（版本号、权限、两个 content script 条目）
  manifest.config.ts        站点匹配范围与 host 权限
  shared/
    features.ts             ★ 全部开关的定义（顺序 = 面板顺序）；default 就是「默认设置」
    bilibiliDom.ts          两站（主站 / 直播站）的 DOM 约定，如网页全屏的 body 类名
    messages.ts             内容脚本 → 后台的消息名常量
  contentScripts/
    index.ts                ★ 唯一入口：模块装配顺序与时机都在这里
    config.ts               开关存储（整包 bili-elite-settings）+ isUserEdit() 判用户意图
    storage.ts              ★ chrome.storage.sync 唯一入口：registerSyncKey / startStorageSync
    logger.ts               日志唯一出口（error 常开，log/warn 靠 ?blie-debug）
    eventBag.ts             监听器收纳（卸载时一次性摘掉）
    modules/                （见下表）
  options/                  扩展选项页（版本号 + 使用说明，不是设置面板）
  styles/                   选项页用的 unocss / reset
  background/main.ts        后台：只负责「新标签页打开」
  env.ts                    构建期环境判定（dev / firefox / 禁止域名）
extension/
  guard.js                  ★ 手写，不走构建，MAIN world（见 §5 场景 H）
  manifest.json             构建产物，别手改
  dist/                     构建产物，别手改
  assets/                   图标与吉祥物图（手放，clear 不会删）
scripts/                    prepare / manifest / pack-edge / pack-source / zip
```

### `src/contentScripts/modules/` 逐文件（TS；样式表见 §4）

| 文件 | 职责 |
| --- | --- |
| `topbarOptimize.ts` | 原生顶栏改造 + 首页优化 + 搜索页优化 + 预加载 + 根类；注入 `topbar.css` / `homeOptimize.css` / `searchOptimize.css` |
| `selfTopbar.ts` | 自绘顶栏（`#bili-elite-tb`）：logo / 导航 / 搜索框 / 右侧图标与浮层；注入 `selfTopbar.css` |
| `videoBeta.ts` | 播放页布局：算尺寸写 CSS 变量、UP 卡 sticky、简介折叠、发送栏搬运、嵌入模式；注入 `videoBeta.css` |
| `commentPreload.ts` | 评论预加载（把评论区挪进视口骗过它自己的 IO） |
| `playerMode.ts` | 播放器屏幕模式判定（普通 / 宽屏 / 网页全屏 / 全屏 / 小窗），只判定不碰 DOM |
| `videoFullscreen.ts` | 全屏 / 网页全屏 / 宽屏的 FLIP 动画 |
| `videoLayer.ts` | 网页全屏时收起我们的浮层（宿主 z-index 管理） |
| `settingsPanel.ts` | 设置面板（Shadow DOM）+ 恢复默认 + 「新版本改动」页 + 节点测速卡 |
| `ripple.ts` / `ripple.css` | Material 涟漪：`installRipple(root, selector)` 装监听并把它唯一的 CSS 注入同一个根（面板 shadow / document）；差异用宿主上的 `--blie-ripple-color` / `--blie-ripple-z` |
| `searchTabs.ts` | 搜索页分类标签栏的滑动指示条（量选中项位置写 translateX / width） |
| `spaceOptimize.ts` | 空间页：侧边分类 / 排序胶囊 / 播放全部换 Google 观感（纯 CSS + 涟漪）；注入 `spaceOptimize.css` |
| `floatingButtons.ts` | 右下角操作浮钮（返回顶部 / 刷新 / 夜间模式） |
| `floatDock.ts` | 浮钮收纳：自动隐藏 / 半隐藏（唯一实现） |
| `quickWheel.ts` | 功能轮盘：呼出、选格、跳转 |
| `quickWheelLayout.ts` | 轮盘几何（8 槽位 / 每 45°） |
| `quickKeys.ts` | 页面快捷键（X 刷新 / Z 回顶） |
| `pageActions.ts` | 刷新 / 回到顶部两个动作（浮钮与快捷键共用） |
| `hoverPrefetch.ts` | 悬停预取 + 首屏空闲预取 + 点击接管（`playBoost` 的实现） |
| `cardWholeClick.ts` | 卡片整体化（整卡可点） |
| `imageViewer.ts` | 图片开合 FLIP（评论区 / 看图器）；动态页相册缩略图**一步开自绘查看器**（拦下 B 站的内联中间态） |
| `imageViewerSelf.ts` | 自绘图片查看器（缩放 / 拖拽 / 旋转 / 复位 / 多图 / FLIP / 渐进加载）；注入 `imageViewerSelf.css` |
| `pswpTakeover.ts` | 把 B 站所有入口的 PhotoSwipe 接管到自绘那层（读 `guard.js` §11 给的 dataSource） |
| `viewerParams.ts` | 看图器的两个数值参数（按钮 / 滚轮缩放步进，无开关） |
| `imageStyle.ts` | 图片开合动画的 CSS（内联注入） |
| `imageGlass.ts` | 图片查看器毛玻璃（内联注入） |
| `imageTools.ts` | 看图器底部工具栏（旋转走 `<img>` 的 rotate；缩放命令交给 `guard.js` §9）；注入 `imageTools.css` |
| `dynamicOverlay.ts` | 动态悬浮窗（iframe + 揭幕 + 跨源通道） |
| `dynamicOpusLayout.ts` | 悬浮窗内详情页的分栏（够宽才开） |
| `labFeatures.ts` | 页面级纯 CSS 功能：夜间模式（`setNightMode`）；注入 `night.css` |
| `adBlock.ts` | 广告卡屏蔽；注入 `adBlock.css` |
| `cdnBoost.ts` | 节点测速：面板侧读写工具 + 手动选节点（选择只对当前视频生效；测速在 `guard.js`） |
| `designTokens.ts` | 设计 token + 「减少动态效果」降级；注入 `designTokens.css` |
| `returnRestore.ts` | 后退回来还原滚动位置 |
| `bodyClass.ts` | `<body>` 类名变化：全页只挂一个观察器，订阅者共享 |
| `whatsNew.ts` | 设置面板「新版本改动」页的全部文案（发版时只改这里） |
| `paramStore.ts` | 数值参数的存储工厂（`bootstrap` / clamp / 同步 / `resetXxxParams`），所有 `*Config.ts` 的底座 |
| `homePanelData.ts` | 频道面板的静态快照（脚本生成，别手改） |
| `*Config.ts` | 数值 / 按键参数（见 §3） |

---

## 3. 按存储键查

| 键 | 内容 | 存储位置 | 读写方 |
| --- | --- | --- | --- |
| `bili-elite-settings` | 全部开关（整包） | sync | `config.ts`；定义在 `shared/features.ts` |
| `bili-elite-glass-params` | 评论区图片背景材质 | sync | `glassConfig.ts` |
| `bili-elite-topbar-params` | 顶栏材质 | sync | `topbarConfig.ts` |
| `bili-elite-searchbox-params` / `-searchpanel-params` | 搜索框 / 搜索面板材质 | sync | `searchConfig.ts` |
| `bili-elite-homepanel-params` | 触发面板材质 | sync | `homePanelConfig.ts` |
| `bili-elite-panel-params` | 设置面板材质 | sync | `panelConfig.ts` |
| `bili-elite-wheelglass-params` | 轮盘背景材质 | sync | `wheelGlassConfig.ts` |
| `bili-elite-home-card-params` / `-search-card-params` / `-rail-card-params` | 三处卡片大小 | sync | `homeCardConfig.ts` / `searchCardConfig.ts` / `railCardConfig.ts` |
| `bili-elite-preload` | 首页预加载距离 | sync | `preloadConfig.ts` |
| `bili-elite-panel-scale` | 设置面板缩放 | sync | `panelScaleConfig.ts` |
| `bili-elite-panel-hotkey` | 设置面板呼出键 | sync | `panelHotkeyConfig.ts` |
| `bili-elite-quick-keys` | 快速刷新 / 回顶键 | sync | `quickKeysConfig.ts` |
| `bili-elite-wheel` | 轮盘呼出键 + 8 个槽位 | sync | `quickWheelConfig.ts` |
| `bili-elite-search-history` | 自绘顶栏的搜索历史词 | sync | `selfTopbar.ts` |
| `bili-elite-codec` / `-codec-prev` | 编码偏好的**镜像**与还原备份 | localStorage | `guard.js`（内容脚本读不到页面的 localStorage） |
| `bili-elite-cdn-*` | 节点分数 / 节点地址 / 当前节点 / 测速状态 / 手动选的节点（`-pick`） | **sessionStorage**（全部按标签页 + 页面，换视频即失效） | `guard.js` §7、`cdnBoost.ts` |
| `bili-elite-return` | 后退时要还原的滚动位置 | sessionStorage | `returnRestore.ts` |

> 「夜间模式」没有独立存储键：它是 `bili-elite-settings` 里的 `nightMode`，`labFeatures.ts` 只负责切根类
> `html.bili-elite-night`。


> 新增存储键：只 `registerSyncKey(key, apply)` 登记，读取由 `index.ts` 的 `startStorageSync()` 统一发起。
> 写读的 key 必须对上，写错不报错、只是永远不生效。

---

## 4. CSS 分段索引

### `topbar.css`（原生顶栏 + 首页 / 搜索页 + 材质 + 卡片）
| 段 | 内容 |
| --- | --- |
| 开头通用段 | 顶栏改造本体（无编号） |
| 「顶栏材质」段 | 顶栏毛玻璃 / 渐变 / 触发面板与浮层 / 卡片「⋮」菜单 |
| §8 | 搜索框材质 |
| §9 | 搜索面板：改版样式 + 开合动画 + 材质 |
| §10 / §10.1 | 播放页右栏留白收起 / 顶部提示条收起 |
| §11 | 首页预加载（哨兵上抬） |
| §12 / §12.5 | 卡片悬停衬底、卡片整体化 |
| §13 | 网页全屏 / 原生全屏时顶栏让位 |
| §15 | 页面级吸顶子栏下移 |
| §16 | 首页加载占位（骨架 → 占位卡） |
| §17 | 原生浮动按钮隐藏 |

### `selfTopbar.css`（自绘顶栏）
§1 宿主与 bar · §1.1 左右边距 · §2 左侧 logo + 导航 · §3 搜索框 + 搜索面板 · §4 右侧图标区 · §4.1 右侧项 + 悬停浮层 · §5 毛玻璃材质 · §6 窄窗口 · §7 减少动态效果 · §8 视频页半顶栏

### `videoBeta.css`（播放页）
§1 容器 · §2 左栏 / 播放器尺寸 · §3 右栏 + 推荐卡封面 · §4 分类条 · §5 左栏栅格 · §6 UP 卡 sticky（§6.5 多人合作） · §7 简介灰卡 · §8 窄窗口兜底 · §9 播放器下栏 · §10 沉浸式（宽屏 / 网页全屏 / 全屏） · §11 简介卡收起态 · §12 视频页半顶栏 · §13 评论预加载（§13b 嵌入模式禁小窗） · §14 嵌入模式两栏 · 「首帧前的封面兜底」

### `panel.css`（设置面板）
设置管理段 · 恢复默认确认弹窗 · §18 面板细节 · §19 卡片级联 · §21 夜间模式 · §22 呼出按键 / 危险操作 · §23 轮盘编辑器 · §24 新版本改动 · §25 功能增强 · 节点测速

### `night.css`（夜间模式）
§1 顶栏 · §2 搜索框 · §3 搜索面板 · §4 顶栏浮层 · §5 卡片配色微调（§5.2 已关注胶囊、§5.3 搜索页排序栏按钮、§5.4 搜索页分类标签栏）· §6 消息中心

> 注意：`night.css` 里的规则是**页面级**的；设置面板 / 弹窗 / 轮盘 / 浮钮是 `.panel` 的兄弟节点，
> 各自有自己的 `.is-night` 配色，改夜间要一处一处确认，别只改 `night.css`。

其余样式表都是一件事一个文件，看名字即可：`designTokens.css`（动效 / 圆角 token）、`adBlock.css`、
`homeOptimize.css`（首页）、`searchOptimize.css`（搜索页：栅格 / 排序栏按钮 / 分类标签栏）、
`spaceOptimize.css`（空间页：导航 tab / 排序按钮）、`dynamicOverlay.css`、`floatingButtons.css`、`quickWheel.css`、
`panelButton.css`（只放 ⚙ 按钮，面板 CSS 要等第一次打开才注入）、`ripple.css`（涟漪节点，全仓库唯一一份，由 `installRipple` 注入）。

---

## 5. 常见改动场景

### A. 加 / 删一个开关
1. `shared/features.ts` 的 `FEATURES` 加一行（**数组顺序 = 面板顺序**；`cardBreak` 另起一张卡，`under` 挂进上一张卡，`note` 是卡上方灰字，`hint` 是感叹号说明）。
2. 模块里 `get(key)` / `onConfigChange(key, fn)` 接上行为。
3. 删开关：`FEATURES` 删行 + `get(key)` 换成常量 + 删 `onConfigChange` 分支（三处都改，漏了不报错）。

### B. 加 / 删一个数值滑块
1. 新建 / 改 `xxxConfig.ts`：`paramStore.ts` 工厂 + `bootstrapXxxConfig()`。
2. `settingsPanel.ts` 的 `PARAM_GROUPS` 里挂到对应卡片。
3. `restoreDefaults()` 里加 `resetXxxParams()`（**漏了不报错**，只是「恢复默认」不动它）。
4. 值写成 CSS 变量，样式侧只读变量。

### C. 加一份新的存储
`registerSyncKey(key, apply)` 登记 → `index.ts` 的 `startStorageSync()` 统一读取 → 别自己 `chrome.storage.get`。
写读 key 必须对上。

### D. 改顶栏
- 自绘顶栏（默认）：`selfTopbar.ts` 建 DOM，`selfTopbar.css` 排版；尺寸照原生逐项量过。
- 原生顶栏改造（`customTopbar` 关掉时）：`topbarOptimize.ts` + `topbar.css`。
- 材质两套都要过一遍：`topbar.css`「顶栏材质」段 与 `selfTopbar.css` §5。

### E. 改播放页布局（三条硬约束）
1. `#mirror-vdcon` 里**一个节点都不插、不搬、不删**（会让 B 站顶栏 mount 失败）→ 只用 CSS + 变量 + 伪元素。
2. 所有布局规则都要带 `:not(.bili-elite-vb-immersive)`（沉浸式 = 宽屏 / 网页全屏 / 全屏），媒体查询里也要带。
3. `--bili-edge`（`videoBeta.css`）与 `videoBeta.ts` 的 `EDGE` 必须同时改。

### F. 改设置面板
`settingsPanel.ts` 建结构，`panel.css` 排版。加控件先确认它挂在哪一层：`.panel` 内部能吃到 `.panel.is-night`，
弹窗 / 轮盘 / 浮钮是兄弟节点，要各自 `toggle('is-night')`。

### G. 改夜间模式
`labFeatures.ts` 的 `setNightMode()` 是唯一入口（同时开 B 站自己的夜间）。配色分两处：页面级 `night.css`，
面板级 `panel.css` §21 与各浮层自己的 `.is-night`。

### H. 动 `guard.js`
手写在 `extension/`，**不走构建**；`world: 'MAIN'`。改完要用户去 `chrome://extensions` 重新加载。
拦什么、为什么给假响应，看文件顶部注释。

### I. 升版本号
四处同时改：`package.json`、`settingsPanel.ts` 的 `DEV_VERSION`、`CHANGELOG/<版本>.md`、`blie-build/package.json`。
细节见 `CHANGELOG/README.md`。

---

## 6. 已经删掉的东西（别去找）

| 曾经的东西 | 现状 |
| --- | --- |
| `fullscreenAnim`（全屏关闭动画） | 1.1.6 v015 删除，命中面太窄 |
| `dynamicOptimize`（动态页优化） | 1.1.6 v015 删除 |
| `materialFade`（材质开关过渡）+ `lab.css` | 1.1.6 v016 删除 |
| 「4K 流畅加速」（改 HEVC 编码） | 1.2.3 v011 删除；`guard.js` 只保留「把用户编码偏好还原回去」的收尾 |
| 「CDN 优化」（DNR 重定向切节点）+ `netHints.ts` | 1.2.1 v013 删除，探测本身抢带宽 |
| 「控制面板新材质」 | 1.2.1 v026 删除 |
| 首屏「顶栏壳」（等 B 站元素的那一版） | 1.1.6 被自绘顶栏取代 |
| `softGlass.css` | 源文件早已不在（只剩 `.tmpold` 残留，已清）；材质参数现在由各 `*Config.ts` 写出的 CSS 变量提供 |
| `src/components/`（Logo / SharedSubtitle） | vitesse 模板残留，从未被引用，已清 |
| `.opencode/skills/bili-elite/` | v1.0.0 的旧 agent 说明，已被取代 |
| `*.tmpold*` 备份残留 | 「改名法」写文件留下的旧副本，已清 |

---

## 7. 不要手改的文件

| 文件 | 为什么 |
| --- | --- |
| `extension/manifest.json` | `src/manifest.ts` 生成 |
| `extension/dist/**` | 构建产物 |
| `src/auto-imports.d.ts` | unplugin 自动生成 |
| `src/contentScripts/modules/homePanelData.ts` | 脚本生成的频道面板快照 |

> `designTokens.css` 不是产物，但它是**全站动效与圆角的唯一来源**：改一个值，所有过渡都会跟着变，
> 改之前先确认影响面。

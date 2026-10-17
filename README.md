# 奶睿pro

> 哔哩哔哩增强浏览器扩展 · **v1.0.0**
> 顶栏重做、全屏 / 图片开合动效、iOS 毛玻璃材质、搜索面板与首页信息流优化。

- Manifest V3，Chrome / Edge（Chromium 内核）与 Firefox 均可加载
- 所有功能都在一个 content script 里，注入 `*://*.bilibili.com/*`，`document_start` 执行
- 设置入口：**B 站任意页面右下角的 ⚙ 按钮**（工具栏图标弹窗里也有开关）

---

## 一、功能总览

设置面板分三组：**动效增强 / 高级材质 / 界面优化**。下表是全部功能，`key` 是 `src/shared/features.ts` 里的开关标识。

### 动效增强

| 功能 | key | 说明 | 默认 |
| --- | --- | --- | --- |
| 全屏关闭动画 | `fullscreenAnim` | 退出原生全屏（F）时，播放器从全屏位置平滑落回页面内位置，不再硬切 | 关 |
| 网页全屏动画 | `webscreenAnim` | 进入 / 退出网页全屏各一段过渡，播放器与页面一起伸缩 | 开 |
| 评论区图片动画 | `imageAnim` | 点开图片时从缩略图位置 FLIP 放大到全屏，关闭时缩回原位。评论区图片与**动态页「查看大图」**都走这一套 | 开 |

### 高级材质（毛玻璃）

| 功能 | key | 可调参数 | 默认 |
| --- | --- | --- | --- |
| 评论区图片背景 | `imageGlass` | 模糊强度 / 背景明暗 | 31px / 偏暗 6 |
| 顶栏材质 | `topbarGlass` | 模糊强度 / 遮罩强度 | 8px / 7% |
| 搜索框材质 | `searchBoxGlass` | 模糊强度 / 遮罩强度 | 15px / 47% |
| 搜索面板材质 | `searchPanelGlass` | 模糊强度 / 遮罩强度 | 38px / 61% |
| 设置面板材质 | `panelGlass` | 模糊强度 / 遮罩强度 | 28px / 31% |

> 遮罩强度拉到 0 时该材质完全透明，发丝描边与投影一起淡出。

### 界面优化

| 功能 | key | 说明 | 默认 |
| --- | --- | --- | --- |
| 首页优化 | `homeOptimize` | 去掉首页大 banner / 频道栏 / 顶部轮播；隐藏封面与操作区两枚「稍后再看」浮钮；把番剧、直播、赛事、课堂…等特殊卡从推荐流里移除并修正行距 | 开 |
| 搜索面板优化 | `searchPanelOpt` | 搜索历史 / 热搜下拉改版：历史固定 4 行可滚动、去掉「展开更多」、弹出与收回带过渡 | 开 |
| 首页卡片边界 | `cardBorderHome` | 首页视频卡描边 | 开 |
| 首页卡片确认 | `cardConfirmHome` | 首页卡片悬停衬底 + 高亮描边 | 开 |
| 搜索页卡片边界 | `cardBorderSearch` | 搜索页结果卡描边 | 开 |
| 搜索页卡片确认 | `cardConfirmSearch` | 搜索页结果卡悬停效果 | 开 |
| 视频页卡片边界 | `cardBorderVideo` | 播放页右栏推荐卡描边 | 开 |
| 视频页卡片确认 | `cardConfirmVideo` | 播放页右栏推荐卡悬停效果 | 开 |
| 首页预加载 | `preload` | 把加载哨兵上抬，提前取回下方的推荐内容，滑到底不再等白屏 | 开 |
| 预加载范围 | — | 上抬多少屏（0–300%，100% ≈ 1 屏） | 150% |
| 设置面板缩放 | — | 整个设置面板等比缩放（80–140%） | 130% |
| 设置管理 | — | 「恢复默认设置」→ 弹窗确认 → 一键回到上表所有默认值 | — |

### 始终开启（没有开关）

| 功能 | 说明 |
| --- | --- |
| 顶栏重做 | 自绘 logo 与顶栏骨架，重排导航 / 搜索框 / 右侧头像区，替换 B 站原生顶栏的视觉；搜索页把搜索框并入顶栏中央 |
| 顶栏下拉面板 | 顶栏「首页 ∨」导航下拉整体重绘：版式、悬停展开、内容按需注入（首屏不解析） |
| 播放页右栏广告屏蔽 | 隐藏 `#slide_ad` 广告卡（弹幕列表下方） |
| 吸顶子栏让位 | 页面级 sticky 子栏自动下移到固定顶栏之下，不再被压住 |
| 首页加载占位 | B 站骨架卡重绘为带扫光动画的占位卡，加载时不再是死板的灰块 |
| 设置面板 | 右下角 ⚙ 打开的面板本身（分类导航 / 开关 / 滑块 / 弹窗） |

### 不生效的页面

顶栏改造在下列页面**整体退出**（这些页面没有统一的全局顶栏，硬套会出现「凭空多一条白栏」）：
`space.bilibili.com`（个人空间全部子页）、`www.bilibili.com/history`、`live.bilibili.com`。
动效类功能（全屏 / 图片动画）不受影响。

---

## 二、安装 / 构建

```bash
pnpm install
pnpm build          # 产物在 extension/
```

1. 打开 `chrome://extensions`（Edge 用 `edge://extensions`）
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选择仓库里的 **`extension/` 目录**（不是 `extension/dist`）
4. 改了代码之后重新 `pnpm build`，再在扩展页点一次「刷新」

开发模式：`pnpm dev` 会 watch 构建，`pnpm dev-firefox` 出 Firefox 版；`pnpm typecheck` 做类型检查。

> `extension/manifest.json` 是构建时由 `src/manifest.ts` 生成的，**不要手改**。

---

## 三、更换图标

图标是仓库里两个静态文件，不参与打包逻辑：

```
extension/assets/icon-512.png     ← 真正生效的那个（512×512 PNG）
extension/assets/icon.svg         ← 设计源文件（当前未被 manifest 引用）
```

**最省事的换法**：直接用你自己的 512×512 PNG 覆盖 `extension/assets/icon-512.png`，
然后 `pnpm build` + 在扩展页点「刷新」。manifest 里 16 / 48 / 128 三个尺寸都指向这张图，
浏览器会自己缩放，够用。

**想要每个尺寸都清晰**（推荐正式发布时这么做）：

1. 准备 `icon-16.png`、`icon-32.png`、`icon-48.png`、`icon-128.png`，放进 `extension/assets/`；
2. 改 `src/manifest.ts` 里的 `icons`（以及 `action.default_icon`）：

```ts
icons: {
  16: 'assets/icon-16.png',
  32: 'assets/icon-32.png',
  48: 'assets/icon-48.png',
  128: 'assets/icon-128.png',
},
```

3. `pnpm build` → 重新加载扩展。

注意：

- **文件必须真实存在**，否则 Chrome 会直接报 `Could not load icon`，扩展加载失败；
- `extension/assets/` 是构建产物目录，但里面的图标是**手放的、不会被清掉**（`pnpm clear` 只删 `extension/dist` 和 `manifest.json`）；
- 换完如果工具栏图标没变，是 Chrome 缓存：关掉扩展再打开，或重启浏览器；
- 页面右下角那颗 **⚙ 按钮不是扩展图标**，它是内容脚本画的 div，改它要动 `src/contentScripts/modules/panel.css` 里的 `.btn`（蓝色渐变圆钮）。

---

## 四、目录结构

```
src/
  manifest.ts              动态生成 extension/manifest.json
  manifest.config.ts       content script 的 matches / 权限
  shared/features.ts       全部开关的定义（顺序 = 设置面板里的顺序）
  contentScripts/
    index.ts               唯一的 content script 入口（IIFE）
    config.ts              开关存储（chrome.storage.sync，回落 localStorage）
    modules/
      topbarOptimize.ts    顶栏重做 + 首页优化 + 材质根类
      topbar.css           全部顶栏 / 搜索 / 卡片 / 预加载 CSS
      settingsPanel.ts     设置面板（Shadow DOM）+ 恢复默认设置
      panel.css            设置面板样式
      imageViewer.ts       图片开合动画（评论区 + 动态页相册）
      imageGlass.ts        图片查看器毛玻璃
      videoFullscreen.ts   全屏 / 网页全屏动画
      searchPanelOpt.ts    搜索面板开合与版式
      paramStore.ts        数值参数存储工厂
      *Config.ts           各组材质 / 预加载 / 缩放的参数定义
  popup/                   工具栏弹窗（开关列表）
  options/                 扩展选项页（版本信息 + 使用说明）
scripts/                   构建脚本（生成 manifest、dev stub）
extension/                 ← 加载这个目录；dist/ 是构建产物
```

---

## 五、已知限制

- 顶栏改造依赖 B 站当前的 DOM 结构，B 站大改版时可能需要跟进选择器；
- 全屏动画只在「播放页」与「直播页」生效，其他页面没有播放器容器；
- 设置通过 `chrome.storage.sync` 同步，多设备需要登录同一浏览器账号；
- 只在 Chromium 与 Firefox 上验证过，其他内核未测试。

---

## 六、许可证

见 [LICENSE](./LICENSE)。

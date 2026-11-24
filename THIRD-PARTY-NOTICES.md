# 第三方来源与许可声明

本仓库（奶睿pro / Bili_Elite）整体采用 **MIT** 许可，见 [`LICENSE`](./LICENSE)。

除自身代码与工程模板之外，有一部分**视觉参数、交互时序与组件结构**参考 / 移植自下面三个开源项目。
凡属「移植」的部分，本文件保留上游的版权与许可全文（见文末附录），并在对应源文件头部注明出处。

> 一句话原则：**数值与时序可以照抄，版权声明必须一起抄。**
> 我们没有整段复制上游源码 —— 上游是 Vue + UnoCSS + Pinia，本项目是原生 TS + 手写 CSS，
> 抄过来也跑不起来；实际搬的是「圆角多少、时长多少、曲线是什么、结构怎么摆」这类设计参数。

---

## 一、来源清单

| 项目 | 作者 | 许可 | 我们用了什么 |
| --- | --- | --- | --- |
| [vitesse-webext](https://github.com/antfu-collective/vitesse-webext) | Anthony Fu | MIT | 工程模板：`manifest` / vite 配置 / 构建与打包脚本 / 目录结构。`LICENSE` 里原有的那行版权就是它 |
| [BewlyBewly](https://github.com/BewlyBewly/BewlyBewly) | Hakadao | MIT | 交互与视觉的**原始出处**：自绘顶栏的思路、顶栏悬停浮层、搜索框动效与搜索历史 / 联想面板、卡片整卡点击与悬停衬底、Dock 的自动隐藏 / 半隐藏、返回顶部与刷新按钮 |
| [BewlyCat](https://github.com/keleus/BewlyCat) | Keleus | MIT + 附加限制（禁止套壳成非浏览器插件形态分发） | 作为 BewlyBewly 的衍生版，是上面那些数值的直接**对照来源**（本项目注释里写的「照 BewlyCat 的 X」指的就是它）：`--bew-radius: 12px`、`--bew-fill-2: rgb(131 131 145 / 30%)`、`300ms` + `cubic-bezier(.22,.61,.36,1)`、浮层宽度 380 / 450 / 380 等 |

> 本项目是浏览器扩展，不涉及 BewlyCat 附加条款里禁止的「客户端 / 桌面 / 移动 App」形态，条款不冲突。
> 但条款是跟着代码走的：**以后如果要把这套 UI 搬到非扩展形态，先回来看这一行。**

---

## 二、逐项对照：我们的面板项 ← 上游有没有

「上游有」= BewlyBewly 原版就存在这个控件或行为；「原创」= 上游没有，本项目自己做的。
判断依据是 BewlyBewly `main` 分支的 `src/logic/storage.ts`（全部设置项）、
`src/components/TopBar/`、`src/components/SearchBar/SearchBar.vue`、`src/components/Dock/Dock.vue`、
`src/components/VideoCard/VideoCard.vue`、`src/styles/adaptedStyles/pages/videoPage.scss`。

| 我们的开关 / 控件 | 上游 | 上游出处 | 我们改了什么 |
| --- | --- | --- | --- |
| 顶栏优化 `customTopbar` | **有**（同思路） | `useOriginalBilibiliTopBar`、`showBewlyOrBiliTopBarSwitcher`、`components/TopBar/TopBar.vue` | 上游连整站页面一起重绘；我们只重绘顶栏这一条，其余仍用 B 站自己的 DOM（所以才有「原生顶栏只 `visibility:hidden`」那套做法） |
| 视频页半顶栏 `videoHalfTopbar` | **无** | — | 原创。上游顶栏永远是整条横贯全宽 |
| 投稿按钮移除 `uploadBtnHide` | 按钮**有**，开关**无** | `components/TopBar/components/UploadPop.vue` | 上游把投稿按钮画进自己的顶栏；我们保留 B 站顶栏，所以额外给了一个「收掉它」的开关 |
| 顶栏 / 搜索框 / 搜索面板 / 触发面板 / 设置面板 / 轮盘背景 / 评论区图片 **材质** | 只有**总开关** | `disableFrostedGlass`、`reduceFrostedGlassBlur`；`--bew-filter-glass-1: blur(20px) saturate(180%)` | 上游模糊值写死在 CSS 变量里、只有「关」和「减半」两档；**逐块可调模糊 / 遮罩的滑块是本项目原创** |
| 搜索面板优化 `searchPanelOpt` | **有** | `components/SearchBar/SearchBar.vue` + `searchHistoryProvider.ts` | 上游是搜索框自带的联想 / 历史下拉；我们是给 B 站原生下拉重新排版（历史固定 4 行、去掉「展开更多」） |
| 搜索框动效（静息胶囊 → 聚焦 12px） | **有** | 同上：`rounded="60px focus:$bew-radius"`、`transition all duration-300`、三层聚焦阴影 | 数值照搬；实现从 UnoCSS 改写成本项目的手写 CSS + `::after` 光环（合成层，避免每帧重绘 box-shadow） |
| 卡片整体化 `cardWhole` | **有** | `components/VideoCard/VideoCard.vue`：整卡包在 `<ALink :href="videoUrl">` 里 | 上游靠改 DOM 结构；我们用 document 级点击委托（B 站是 Vue 渲染的，搬节点会被 diff 冲掉）。另外上游**没有**把 UP 主名字排除出去，我们排除了（点名字仍然去空间） |
| 卡片悬停衬底 / 按下态 | **有** | `--bew-fill-2: rgb(131 131 145 / 30%)`、`--bew-fill-3: 45%`、`ring hover:8` | 颜色与 `0.2s ease` 照搬；外扩从 8px 收到 6px（B 站卡片间距更小，8px 会连成一片） |
| 首页卡片边界 / 搜索页 / 视频页 `cardBorder*` | **无** | — | 原创（上游是整页重绘，卡片天生没有 B 站那种描边，不需要开关） |
| 自动隐藏操作浮钮 `fabAutoHide` | **有** | `autoHideDock`（`components/Dock/Dock.vue`）：隐藏时 `translateX(100%)` + `opacity: 0`，边缘热区 14px → hover 60px | 概念与数值照搬；上游是左侧竖排 Dock，我们是右下角那列浮钮 |
| 半隐藏操作浮钮 `fabHalfHide` | **有** | `halfHideDock`：`translateX(50%)` + `opacity: .6` | 同上 |
| 自动隐藏时始终显示操作按钮 `fabKeepActions` | **无** | — | 原创（上游整列一起收） |
| 统一返回顶部 / 刷新键 | **有** | Dock 里的 `backToTopAndRefreshButtonsAreSeparated`（合并 / 分离两态） | 上游默认是**一颗会变脸的按钮**（在顶部显示刷新、往下滚显示回顶）；我们做成两颗常驻，行为更直白 |
| 首页优化 `homeOptimize`（去 banner / 卡片大小 / 自动栅格） | **有**（同思路） | 首页整体重写 + `gridLayout: 'adaptive'` | 上游整页换成 Bewly 版；我们只在 B 站原页面上做减法（去 banner / 改栅格 / 去特殊卡） |
| 播放页优化 `videoBeta`（满宽 + 右栏 + UP 卡吸顶） | **无** | `styles/adaptedStyles/pages/videoPage.scss` 只做配色适配，**不动布局** | 原创 |
| 夜间模式 `nightMode` | **有** | `theme: 'light' \| 'dark' \| 'auto'` | 上游是自己重绘整站后的暗色；我们只补 B 站没管的几块（顶栏 / 搜索框 / 浮层 / 消息中心背景图） |
| 夜间模式操作浮钮 `fabNightMode` | **无**（切换入口在设置页） | — | 原创。浮钮列里一枚昼夜切换键，默认显示，可在「界面优化」关掉 |
| 夜间模式整页过渡 `setNightMode` | **有**（同思路） | `composables/useDark.ts`：View Transitions + 从点击处 `circle()` 揭示，300ms | 思路、时长与 `::view-transition-(old\|new)(root){animation:none}` 照搬；圆心取点击坐标（设置面板取开关中心），并在回调里等 `light.css` / `dark.css` 换好再拍新帧 |
| 功能轮盘 `quickWheel` | **无** | — | 原创（上游是 Dock 竖排图标列，没有轮盘） |
| 悬停预取 `hoverPrefetch` | **无** | 上游有 `enableVideoPreview`（悬停预览视频），不是文档预取 | 原创 |
| 广告屏蔽 | **有** | `blockAds`、`blockTopSearchPageAds` | 我们做成常开、没有开关（规则只有几行 CSS） |
| 动态页优化 `dynamicOptimize` | **无** | — | 原创（上游是整页重绘，不存在「社区中心横幅」这个 B 站原生结构） |
| 面板卡片级联 / 奶睿形象 / 实验室各项 | **无** | — | 原创 |

> 结论：**「B 站原页面上做局部改造」这一层几乎全是原创**；真正来自上游的是
> 「顶栏自绘 + 悬停浮层」「搜索框动效与下拉」「整卡点击 + 悬停衬底」「Dock 的收纳行为」四块，
> 以及它们的数值与时序。

---

## 三、我们怎么声明引用行为（约定）

四条，按「读者在哪儿看到」排序：

1. **源文件头**：凡数值 / 时序 / 结构来自上游的文件，头部注释写一行出处，例如
   `视觉与交互参考 BewlyBewly（MIT, © Hakadao）/ BewlyCat（© Keleus），见 THIRD-PARTY-NOTICES.md`。
   具体某个数抄自哪一行时，就近写在注释里（如「照 BewlyCat 的 `--bew-fill-2`」）——
   **不写「参考了某项目」这种笼统话**，下次改这个数的人要能顺着注释找回去。
2. **发布物**：`extension/THIRD-PARTY-NOTICES.txt` 随商店 zip 一起发（`scripts/pack-edge.mjs`
   打的是整个 `extension/` 目录，这个文件会自动进包）。MIT 要求「所有副本或实质部分」都带声明，
   只放在仓库里不算数。
3. **仓库根**：本文件 + `README.md` 的「许可证与第三方来源」一节 + `LICENSE` 里的版权行。
4. **产品内**：设置面板「开源地址」页有「BewlyBewly 原项目」与「第三方许可声明」两个跳转，
   用户不用翻仓库也能看到我们站在谁的肩膀上。

反面清单（别这么做）：

- 不要把上游整段源码贴进来再改——许可没问题，但维护成本极高（框架都不一样），
  而且以后上游修 bug 我们收不到。**只搬参数，不搬实现。**
- 不要在注释里只写「照 BewlyCat」而不给路径：BewlyCat 是 BewlyBewly 的衍生版，
  同一个数值往往两边都有，写清是哪一边、哪个文件，才追得动。
- 不要把 `LICENSE` 里原有的 Anthony Fu 版权行删掉换成自己的——那是模板的，
  删了就违反了 vitesse-webext 的 MIT 条件。

---

## 附录：上游许可全文

### A. BewlyBewly（MIT）

```
MIT License

Copyright (c) 2021 Hakadao(hakadao2000@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### B. BewlyCat（MIT + 附加限制）

```
Custom License

Copyright (c) 2025 Keleus <jen.hs@outlook.com>

本项目在MIT协议的基础上：

禁止将本项目或基于本项目修改、衍生的代码用于以下用途：

1. 将本浏览器插件封装、转换、打包或集成为独立客户端、桌面应用、移动应用或其他非浏览器插件形态的软件；
2. 以客户端、套壳客户端、桌面端、移动端 App 或类似形式发布、分发、传播或提供下载；
3. 基于本项目代码开发、发布或分发与本项目功能实质相同或高度相似的客户端产品；
---
MIT License

Copyright (c) 2021 Hakadao(hakadao2000@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### C. vitesse-webext（MIT）

```
MIT License

Copyright (c) 2021 Anthony Fu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

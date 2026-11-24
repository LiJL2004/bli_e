---
name: Bili_Elite (bli_e)
description: Use when working on the Bili_Elite browser extension source (the `bli_e` repo, v1.0.0) — a Bilibili enhancement WebExtension whose content script rewrites the site topbar, animates fullscreen/image transitions, and adds iOS-style frosted-glass materials (topbar, search box, search panel, comment images, settings panel) plus a redesigned search-history/trending dropdown, homepage feed cleanup, a centred fixed-size settings modal with a left category nav / click-blocking overlay / overall zoom slider, and a "设置管理 → 恢复默认设置" flow driven by the same `default` values used on first install. Covers project layout, build/verify reality on this Windows+WSL box, the feature/settings system, the settings-panel DOM contract, module conventions, the live-page injection preview workflow, version/icon handling, and known tech debt. Trigger for tasks like editing modules, adding settings toggles or sliders, changing the settings panel (layout, size, zoom, nav, reset), touching topbar/search-panel CSS or the search dropdown, adjusting the manifest, replacing the icon, or building/loading the extension.
---

# Bili_Elite (`bli_e`)

A **Bilibili enhancement WebExtension** (MV3, Chrome + Firefox), **v1.0.0**, built on the
[`vitesse-webext`](https://github.com/antfu/vitesse-webext) Vite template.
Everything user-facing happens in a **content script** injected on
`*://*.bilibili.com/*` at `document_start`. There is **no toolbar popup** — the `action`
declares only `default_icon`, so clicking the toolbar icon opens the browser's own extension
menu (Edge: 网站访问权限 / 管理扩展 …); the options page is an info/about screen (settings
live in the in-page ⚙ panel).
Git remote: `github.com/LiJL2004/bli_e` (branch `main`).

`README.md` is the **user-facing** doc (full feature list, build steps, how to replace the
icon). This file is the **implementation** source of truth — when they disagree, this one
wins and README should be fixed.

Version lives in `package.json` only (`src/manifest.ts` copies `pkg.version`), so a
release = bump `package.json` + `pnpm build`. Current: **1.0.0**.

## What it does

| Group (settings) | Feature key / label | Module |
| --- | --- | --- |
| 动效增强 | `fullscreenAnim` 全屏关闭动画 | `modules/videoFullscreen.ts` |
| 动效增强 | `webscreenAnim` 网页全屏动画 | `modules/videoFullscreen.ts` |
| 动效增强 | `wideAnim` 宽屏模式动画 | `modules/videoFullscreen.ts` + `playerMode.ts` |
| 动效增强 | `imageAnim` 评论区图片动画 | `modules/imageViewer.ts` + `imageStyle.ts` |
| 高级材质 | `imageGlass` 评论区图片背景 (sliders) | `modules/imageGlass.ts` |
| 高级材质 | `topbarGlass` 顶栏材质 (sliders) | `modules/topbarOptimize.ts` + `topbar.css` |
| 高级材质 | `searchBoxGlass` 搜索框材质 (sliders) | `modules/searchConfig.ts` + `topbar.css` |
| 高级材质 | `searchPanelGlass` 搜索面板材质 (sliders) | `modules/searchConfig.ts` + `topbar.css` |
| 高级材质 | `homePanelGlass` 顶栏触发面板材质 (sliders) | `modules/homePanelConfig.ts` + `topbar.css` §7.1 |
| 高级材质 | `panelGlass` 设置面板材质 (sliders) | `modules/settingsPanel.ts` + `panel.css` |
| 界面优化 | `homeOptimize` 首页优化 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `searchPanelOpt` 搜索面板优化 | `modules/searchPanelOpt.ts` + `topbar.css` |
| 界面优化 | `cardBorderHome` 首页卡片边界 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `cardConfirmHome` 首页卡片确认 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `cardBorderSearch` 搜索页卡片边界 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `cardConfirmSearch` 搜索页卡片确认 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `cardBorderVideo` 视频页卡片边界 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `cardConfirmVideo` 视频页卡片确认 | `modules/topbarOptimize.ts` + `topbar.css` |
| 界面优化 | `preload` 首页预加载 | `modules/topbarOptimize.ts` + `preloadConfig.ts` + `topbar.css` |
| 界面优化 | `backTopBtn` 统一返回顶部键 / `refreshBtn` 统一刷新键 | `modules/floatingButtons.ts` + `floatingButtons.css` |
| 界面优化 | `nativeRefreshHide` 原生刷新按钮屏蔽 / `nativeBackTopHide` 原生返回顶部按钮屏蔽 | `modules/topbarOptimize.ts` + `topbar.css` §17 |
| 界面优化 | *(no feature key)* 设置面板缩放 slider | `modules/panelScaleConfig.ts` + `settingsPanel.ts` |
| 个性设置 | `mascotButton` 奶睿设置键 | `settingsPanel.ts` + `panel.css` |
| 个性设置 | `mascotLogo` 奶睿顶栏图 | `modules/topbarOptimize.ts` + `topbar.css` |
| 个性设置 | *(no feature key)* 设置管理 → 恢复默认设置 | `settingsPanel.ts` + `paramStore.ts` + 各 `*Config.ts` |

The **topbar rewrite is always on** (no toggle). `html.bili-elite-home-opt` is
applied unconditionally by `setupTopbarOptimize()` — treat it as the "always on, every
page" layer; it also blocks the video-page sidebar ad (`#slide_ad`), pushes B站's
page-level sticky sub-bars below it, and runs §16 (static skeleton placeholders) —
see "Page-level sticky sub-bars" and "Homepage loading placeholders" further down.
(The live site keeps its own topbar; it only opts into the 动效增强 fullscreen animations —
see "Fullscreen animations".)

**Exception — three page families opt out of the whole topbar rewrite.** `setupTopbarOptimize()`
returns a no-op when `isTopbarOptExcluded()` is true: `space.bilibili.com` (every sub-page:
个人主页 / 收藏 / 投稿 / 动态…), `www.bilibili.com/history` (+ its client-side entry
`/account/history`) and `live.bilibili.com`. On those, **nothing** of ours touches the topbar —
no `topbar.css`, no `bili-elite-*` root classes, no `#bili-elite-logo` /
`#bili-elite-topbar-skeleton`, and no sticky-sub-bar shift — so B站's own topbar (transparent
over the space banner, mini on the history page, `.link-navbar` on live) behaves exactly as
shipped. `isTopbarOptExcluded()` is re-checked from `sync()`, so a client-side jump into an
excluded path tears the rewrite down mid-flight (`disposeTopbarOpt`).
Consequence for the two sections below: the live-site topbar adaptation and the two explicit
sticky-sub-bar selectors were **deleted** once live / space / history opted out — don't
reintroduce them without also editing the exclusion list.
The feature flags
only layer extras on top: `homeOptimize` → `bili-elite-home-only` (removes the homepage
big banner / channel bar, hides **both** 「稍后再看」 hover buttons on video cards —
`.bili-watch-later--wrap` on the cover and `.watchlater-pip-button` in the corner
palette — drops the special 番剧 / 直播 / … cards out of the homepage
recommendation grid, **and** removes the top-left carousel `.recommended-swipe`), `topbarGlass` → `bili-elite-glass`, etc.

The 设置面板缩放 slider is the one settings control that is **not** a boolean
feature — see "The settings panel" below.

## Repo layout

```
src/
  manifest.ts            dynamic manifest (name Bili_Elite, version = package.json version)
  manifest.config.ts     SITES.bilibili matches + HOST_PERMISSIONS
  global.d.ts            minimal chrome.* ambient types (needed for tsc)
  shared/features.ts     FEATURES list + FeatureKey/FeatureConfig + groupFeatures()
  contentScripts/
    index.ts             bootstrap order (the only content-script entry)
    config.ts            feature flags store (chrome.storage.sync, localStorage fallback)
    eventBag.ts          EventBag helper: bulk add/remove listeners
    logger.ts            log / warn / error
    styles.css           DEAD / unused (see tech debt)
    modules/
      topbarOptimize.ts  topbar rewrite (always on) + 首页优化 + material root classes
      topbar.css         ALL topbar CSS incl. search box / search panel (imported `?inline`)
      topbarConfig.ts    顶栏材质 params: blur, tint
      glassConfig.ts     评论区图片背景 params: blur, brightness
      panelConfig.ts     设置面板材质 params: blur, tint
      panelScaleConfig.ts 设置面板缩放 param: scale (80–140 %)
      searchConfig.ts    搜索框材质 + 搜索面板材质 params (two stores in one module)
      homePanelConfig.ts 顶栏触发面板材质 params: blur, tint（默认同搜索面板）
      preloadConfig.ts   首页预加载 param: dist (0–300 %)
      paramStore.ts      createNumberParamStore() — shared param store factory (+ reset)
      searchPanelOpt.ts  搜索面板优化: open/close class driving only (no fold control)
      settingsPanel.ts   in-page shadow-DOM settings modal (layout + wiring + 恢复默认设置)
      panel.css          settings panel CSS (imported via `?inline`)
      imageViewer.ts     image open/close transition (PhotoSwipe .pswp): 评论区 + 动态页相册
      imageStyle.ts      image animation CSS (.pswp.bili-closing-anim)
      imageGlass.ts      comment-image overlay frosted glass
      videoFullscreen.ts fullscreen / web-fullscreen animation (.bpx-player-container)
      videoLayer.ts      hides the fixed hosts (设置键 / 浮动键) while in web fullscreen
      homePanelData.ts   homepage dropdown panel HTML as a base64 gzip blob
  options/Options.vue    options page — version + where the settings live (no toggles)
  components/            Logo.vue / SharedSubtitle.vue — vitesse leftovers, now unreferenced
  logic/common-setup.ts  setupApp(), used by options main.ts
  styles/                unocss reset + main.css, imported by options
scripts/                 prepare.ts (writes extension/manifest.json), manifest.ts, utils.ts
extension/               package root — load THIS folder as an unpacked extension
extension/assets/        icon-512.png + icon.svg — hand-placed, NOT generated by the build
extension/dist/          build output (content script: dist/contentScripts/index.global.js)
README.md                user-facing: full feature list / build / how to replace the icon
.opencode/skills/bili-elite/SKILL.md   this file
```

**Cleaned 2026-10-17 (1.0.0):** `demo/`, `backups/`, `e2e/`, `playwright.config.ts`,
`src/tests/`, `src/components/__tests__/`, `src/sidepanel/`, `src/contentScripts/views/`,
`.gitpod.*`, `shot.cjs` and the template's `logic/storage.ts` + `composables/` are all
gone. Do not recreate them: there is **no snapshot directory** any more (see
"File-writing gotchas"), no e2e harness, and no sidepanel entry.

`tsconfig.json` excludes `["dist", "node_modules", "backups", "src.bak"]` (the last two no
longer exist; the exclude is harmless). There is no `include`, so tsc walks the repo —
`.opencode/` and `.workbuddy-ai/` are harmless only because they contain no `.ts`.
Don't drop a `.ts` file in there.

## Build & verify (read this before promising a build)

The repo lives on **WSL (`Ubuntu-26.04.1`) and is reached from Windows over the UNC
path `//wsl.localhost/Ubuntu-26.04.1/home/devcontainers/bli_e`.** Node inside WSL is
`/home/devcontainers/.nvm/versions/node/v24.21.0/bin` and is not on the default PATH.

**On this box the normal build loop is unavailable** — verified, not assumed:

- `wsl.exe` is **blocked by the sandbox program blacklist**, so you cannot run
  `pnpm` / `tsc` / `vite` inside WSL from here. Do not retry it or route around it.
- Windows-side `node.exe` *can* read/write the UNC path, but `node_modules` is a
  **pnpm symlink farm**: touching e.g. `node_modules/typescript` fails with
  `Input/output error`, so `tsc` and `vite` cannot start from Windows either.

Consequence: **you cannot run `pnpm typecheck` / `pnpm build` in this environment.**
Compensate by (a) reading the changed code carefully and diffing it against a copy of the
original you kept in a Windows temp dir, (b) type-checking just the files you touched with
the managed tsc (see below), and (c) for anything visual, injecting the real modules into
a live page — see "Preview a change without building the extension".
Say plainly in your reply that typecheck/build were not run.

The **user** can build (they run `pnpm` inside WSL); `extension/dist/*` timestamps are how
you tell whether the bundle you are looking at includes your change:

```sh
grep -c 'confirm-mask' extension/dist/contentScripts/index.global.js   # 0 = stale bundle
```

| Script | Purpose (run on a normal machine) |
| --- | --- |
| `pnpm typecheck` | `tsc --noEmit` — must pass before you are done |
| `pnpm build` | production build → `extension/` (web, manifest, background, content) |
| `pnpm dev` | watch + HMR; then load `extension/` unpacked |
| `pnpm lint` | ESLint (`@antfu/eslint-config`) — **already fails pre-existing** |

### Scoped typecheck without node_modules

`node_modules` is unusable from Windows, but the managed Node workspace ships its own
`typescript`. Write a throwaway `tsconfig.check.json` at the repo root (archive it in the
temp dir afterwards) that lists only the files you touched, drops `types: ["vite/client"]`,
and adds a 6-line `check-env.d.ts` for `import.meta.env` + `*.css?inline`:

```sh
node "C:/Users/<user>/.workbuddy-ai/binaries/node/workspace/node_modules/typescript/bin/tsc" -p tsconfig.check.json
```

That catches real type errors in `.ts` files (it is how `restoreDefaults()` and the
`getManifest` declaration were validated) — it does **not** cover `.vue` SFCs.

### File-writing gotchas on the UNC path

`Read` works everywhere on `//wsl.localhost/...`. **`Edit` / `Write` are unreliable**: they
succeed on some paths (`src/contentScripts/modules/*`) and fail with
`ModifyBackup failed: target file not found` on others (`.opencode/`, `.workbuddy-ai/`,
`src/shared/`, repo-root files like `package.json`). Try `Edit` first; if it throws, use the
temp-file dance. Shell redirection is always refused.

| Operation | Works? |
| --- | --- |
| `Read` a file on the UNC path | ✅ |
| `Edit` / `Write` the file directly | ⚠️ path-dependent (`ModifyBackup failed`) |
| `cat > file` (shell redirect) | ❌ `Permission denied` |
| `cp new-file` (creating a file that does not exist yet) | ✅ |
| `cp existing-file` (overwrite) | ❌ `Permission denied` |
| `rm` / `unlink` / `git clean` (delete) | ❌ |
| `mv a b` — same share, any directory | ✅ (this is the only way to "delete") |
| `mv` to another drive (`/tmp`, `C:`) | ❌ (`cannot remove … Permission denied`) |

**Why deletion is impossible from here.** `rm`/`unlink` are shell functions routed to a
`safe-delete` shim that calls a Windows trash binary with the `\\wsl.localhost\…` path —
Windows processes cannot resolve that share, so it fails (`0x80070002`). Going around the
shim (`\rm`, `/usr/bin/rm`) hits the same wrapper, `git clean`/`rm` fail with
`Invalid argument` (9P rejects unlink from the Windows side), and `os.remove` in Python
cannot even see the path. **So: move junk out of the repo instead**
(`mv <junk> //wsl.localhost/.../home/devcontainers/_bli_e_trash/`), and tell the user to
`rm -rf ~/_bli_e_trash` from inside WSL to reclaim the space.

**Working pattern for any edit:**

1. `cp <repo-file> C:/Users/<user>/AppData/Local/Temp/<job>/<name>.pre` — keep the original
   (this replaces the old `backups/snapshot-*.bak/*.pre` convention, which is gone);
2. `Write` the new content to the same temp dir;
3. in one shell command: `mv <repo-file> <repo-file>.tmpold && cp <temp-new> <repo-file>`;
4. `mv <repo-file>.tmpold <trash-dir>/` — never leave `.tmpold` in the repo, and give each
   one a unique name (two `index.html.tmpold` from different dirs collide).

Keep each shell command to **2–4 files**; longer `for` loops over the share get killed
mid-way (`SIGTERM`) and can leave a `*.tmpold` behind — check with
`find . -name "*.tmpold"` afterwards.

Other shell notes: relative `../../..` traversal is unreliable on UNC — use absolute
UNC paths when moving between directories. PowerShell mangles `$`, `|` and pipes, so
avoid them inside shell one-liners; the `PowerShell` tool itself fails on this share.
`git` works, but every command needs `-c safe.directory='*'` (the repo is owned by the WSL
user, Windows git calls it "dubious ownership").

## Architecture

`src/contentScripts/index.ts` is the whole content bundle (an **IIFE — no code
splitting**). Order matters:

1. `bootstrapConfig()`, `bootstrapGlassConfig()`, `bootstrapTopbarConfig()`,
   `bootstrapPanelConfig()`, `bootstrapPanelScaleConfig()`, `bootstrapSearchConfig()`
   — load persisted settings.
2. `setupTopbarOptimize()` — **at `document_start`**, before B站 renders its own
   topbar (otherwise the old topbar flashes).
3. `setupSearchPanelOpt()` — also at `document_start` (applies its root class early, and
   attaches to the panel as soon as B站 creates it, to drive the open/close class).
4. `initModules()` — on `DOMContentLoaded` (or immediately if already parsed):
   `setupVideoFullscreen`, `setupImageViewer`, `setupImageStyle`, `setupImageGlass`,
   `setupSettingsPanel`.

**Module contract:** every `setupXxx(): () => void` returns a cleanup function,
gates itself on its feature flag via `get('<key>')`, and re-reacts by subscribing
with `onConfigChange(cb)`. Register listeners through `EventBag` so cleanup is bulk.

**Config:** `config.ts` holds the flags; `get`/`getAll`/`onConfigChange`/`persist`/
`bootstrapConfig`. Storage is `chrome.storage.sync` (key `bili-elite-settings`),
falling back to `localStorage`. `applyValues` only overwrites keys present in
`DEFAULT_CONFIG`, so removing a feature key is safe (stale stored values are ignored).

**Numeric params (sliders):** `paramStore.ts` exports `createNumberParamStore(key, defs)`
returning `{ defs, storageKey, defaults, get, set, reset, onChange, bootstrap }`. The
`*Config.ts` modules wrap it and expose `getXParams` / `setXParam` / `resetXParams` /
`onXParamsChange` / `bootstrapXConfig`. Stored as `{ blur, tint }` etc. One module can own
several stores (`searchConfig.ts` has one for the box, one for the panel). `reset()` puts
every key back to `defs[].default` and always re-`persist()`s (the in-memory value may
already be the default while storage — or another tab — is not); it only `notify()`s when
something actually changed. It is the building block of 恢复默认设置.

**CSS:** `topbar.css` and `panel.css` are imported with Vite's `?inline` and injected
as a `<style>` element (topbar style id `#bili-elite-topbar-style`). `panel.css`
lives inside a **shadow root**, so page CSS cannot leak in — style panel UI only via
`panel.css`. Theme knobs are CSS custom properties on `document.documentElement`
(`--bili-topbar-*`, `--bili-panel-*`, `--bili-panel-scale`) so they inherit into the
shadow tree.

## The settings panel (shadow DOM modal)

`modules/settingsPanel.ts` owns it; all styling is in `modules/panel.css`.

**Host & open/close.** A `<div id="bili-elite-settings-host">` is appended to
`documentElement`, `position: fixed`, 44×44, bottom-right (`bottom: 180px; right:
24px`), `z-index: 2147483647`. It is the ⚙ trigger and the shadow root's parent —
**never give the host `transform` / `filter` / `opacity`**, that would break the
panel's own `backdrop-filter` (see the backdrop-root trap below).

DOM inside the shadow root, in order:

```
.overlay                       ← transparent click blocker (z-index 1)
.panel                         ← the modal (z-index 2)
  .panel-head                  ← .title ("设置面板", was "Bili_Elite") + button.close (the ✕)
  .panel-main                  ← flex row, gap 12px
    nav.nav                    ← .nav-item buttons, one per feature group
    .panel-body                ← the only scroll container
      .page[data-page=<组名>]   ← one per group; .is-active shows it
        .group                 ← grid of cards
          .setting-block       ← one feature (or one merged plain card;
                                  .is-plain / .is-wide span the whole row)
            .block-head        ← optional card title (only 设置管理 uses it)
            .item / .item-range
.confirm-mask                  ← dim scrim for the reset dialog (z-index 3)
  .confirm                     ← 是否恢复默认设置 + 取消 / 确定
.btn                           ← the ⚙ trigger (44px circle)
```

**Fixed size, centred, and overall zoom.** `.panel` is `position: fixed; top/left:
50%` + `translate(-50%, -50%)` so it is always dead-centre. Size is **fixed** (it must
not change when you switch categories, and short pages just leave empty space):

```css
--z: var(--bili-panel-scale, 1);                    /* 1 = 100 % */
width:  min(1000px, calc((100vw - 48px) / var(--z)));
height: min(660px, calc((100vh - 120px) / var(--z)));
transform: translate(-50%, -50%) scale(var(--z));
```

The `calc(... / var(--z))` is load-bearing: without it, a 140 % zoom would render
1400 px wide and overflow the viewport. The hidden state uses
`scale(calc(0.94 * var(--z)))` so the entrance animation keeps the same relative
pop at every zoom level. `transform-origin: center center` keeps the panel centred
while zooming. There is **no JS size calculation** any more (no `--max-h`, no
`window.resize` listener).

**Click blocking.** `.overlay` is `position: fixed; inset: 0; background: transparent;
pointer-events: none`, and gets `.show` → `pointer-events: auto` while the panel is
open. It is deliberately **not** a dim/blur scrim: no `background`, no
`backdrop-filter`, so it costs no paint and the page underneath stays visually
untouched. Because the overlay becomes the event target, clicks outside the panel
never reach the page (no accidental video-card navigation) *and* close the panel.
A `document` click listener is kept as a fallback. There is **no Esc-to-close**.

**Left nav + right pages.** `groupFeatures()` drives both: one `.nav-item` button and
one `.page` per group, first one active. `selectGroup(name)` only toggles `is-active`
classes (no DOM rebuild) and resets `panelBody.scrollTop`. The group name is **not**
repeated as a heading in the right pane — the nav carries it.

The active nav item's blue fill is not a plain `background` change: it is a
`linear-gradient` painted with `background-size: 0% → 100%` (`background-position: left center`,
0.32 s) so the highlight **wipes in from the left** (traced frame by frame: 0 % → 100 %
monotonic over ≈330 ms, `color` interpolating to `#0A6CFF` in step). Because of that,
**never use the `background` shorthand** on `.nav-item`, `.nav-item:hover` or
`.nav-item.is-active` — it resets `background-image` / `background-size` and silently kills
the wipe and the hover grey.

**Cards.** `.group` is `display: grid; grid-template-columns: repeat(auto-fit,
minmax(280px, 1fr))` — 2 columns at the default 1000 px width (right pane ≈ 784 px),
3 columns only past ≈ 1070 px panel width. Features that own sliders get their own
card; consecutive slider-less features are merged into one card that spans the row
(`.setting-block.is-plain { grid-column: 1 / -1 }`). A `ParamGroup` may also set
`wide: true`, which tags its slider card `is-wide` — same `grid-column: 1 / -1`; 首页预加载
uses it so the card lines up with 设置面板缩放. **`FEATURES` order drives the page**, so
界面优化 currently renders as **seven** full-width cards: 首页优化 + 搜索面板优化, then the six
card switches (首页/搜索页/视频页 × 边界/确认), then 首页预加载 (wide: toggle + range +
`.range-hint`), then 布局优化两条 (播放页右栏留白收起 + 顶部提示条收起), then 悬浮键两条
(统一返回顶部键 + 统一刷新键), then 原生按钮屏蔽两条, and finally
设置面板缩放 (it has no owning feature, see below).
个性设置 页是两张卡：奶睿设置键 + 奶睿顶栏图 合在一张 `.is-plain` 卡里，后面接
设置管理 (`.block-head` + 恢复默认设置 row)，最末一行是开发版本标记。The six
card switches start a new card because
`cardBorderHome` carries `cardBreak: true` — a `FeatureDef` flag that makes the page
builder `flushPlain()` before that row (see `settingsPanel.ts`). Use it whenever a run of
slider-less toggles should not merge with the one before it.

Every card is outlined by an **even 1 px border, not a shadow** (2026-10-17):
`border: 1px solid rgba(20,22,30,.12)`; glass variant
`rgba(20,22,30, calc(var(--bili-panel-tint,.82) * .16))` (≈ #DEDFE1 at the default tint).
A drop shadow was tried first and rejected: it carries a y-offset, so only the right and
bottom edges ever read, and once the page *and* the panel are both white the card looked
like it was floating crooked. A border is four-sided by construction and survives a white
background. Keep the alpha scaled by `--bili-panel-tint` so the cards fade out together
with the glass panel when the tint slider reaches 0. `.setting-block` has
`overflow: hidden` (for the row dividers) — the border is unaffected, but any future depth
effect must stay on the block itself, not on an inner wrapper.

**The 设置面板缩放 slider (the non-feature control).** `panelScaleConfig.ts` is a
normal `createNumberParamStore` store (`scale`, 80–140, step 5, default 130, fmt
`${v}%`, storage key `bili-elite-panel-scale`), but it is **not** in `PARAM_GROUPS`
because it has no owning feature toggle. Instead:

- `SCALE_GROUP = '界面优化'` + `SCALE_DEF = PANEL_SCALE_PARAM_DEFS[0]` are module
  constants in `settingsPanel.ts`; the page builder appends one `.is-plain` card
  containing `rangeRowHtml('scale', SCALE_DEF)` to that group's page.
- It is wired by hand (`scaleInput` / `scaleValEl` / `syncScale` / `onPanelScaleChange`)
  rather than by the `PARAM_GROUPS` loop.
- `applyPanelScale()` writes `--bili-panel-scale` as `scale / 100`.

Prefer a **slider** over −/+ buttons for anything that changes the panel's own size:
the panel scales about its centre, so buttons drift out from under the cursor between
clicks, whereas a native range input captures the pointer and the handle's screen
position is a stable fixed point (negative feedback), so it tracks the cursor.

**「个性设置」页（`PERSONAL_GROUP`）。** 第四组，nav 里紧跟「界面优化」之后。
奶睿设置键 / 奶睿顶栏图 两个开关（`FEATURES` 里 `group: '个性设置'`，默认都关）合并成
一张 `.is-plain` 卡，后面接 `manageBlockHtml`（设置管理 → 恢复默认设置），最末一行是
开发版本标记。页面构建只认 `PERSONAL_GROUP` 这个常量，两项的实际实现在别处：

- `mascotButton`：`settingsPanel.ts` 的 `applyMascotButton()` 给 `#btn` 切 `is-mascot`
  并写 `--bili-mascot-img`（`chrome.runtime.getURL('assets/panel-mascot.png')`）；
  `panel.css` 负责 44×44 圆盘、`#FFD338` 底色与铺满圆盘的径向光晕。
- `mascotLogo`：`topbarOptimize.ts` 的 `applyMascotLogo()` 切 root class
  `bili-elite-mascot-logo` + 写 `--bili-logo-img`；`topbar.css` §1.3 把
  `#bili-elite-logo .bili-elite-logo__mark` 的 mask 换成 48×38 插画。它挂在顶栏改造里，
  所以 `isTopbarOptExcluded()` 的三类页面上不生效。
- 两张图都在 `extension/assets/`，必须留在 `manifest.ts` 的 `web_accessible_resources`
  里，否则 `chrome-extension://` 资源会被页面上下文拒绝（表现是开关打开但界面没变）。

## 默认设置（首次安装 / 恢复默认设置）

**「默认设置」就是代码里的 `default`，没有第二份配置表。** 首次安装时
`chrome.storage.sync.get(DEFAULT_CONFIG, cb)` 用 `FEATURES[].default` 补齐缺失的 key，
`createNumberParamStore` 用 `defs[].default` 当初始值，所以「改默认值」= 改这两处，
改完首次安装和「恢复默认设置」自动一致。

当前定稿的一套（2026-10-17，来自设计稿截图）：

| 位置 | 默认值 |
| --- | --- |
| 动效增强 | `fullscreenAnim` **关**，其余三项开 |
| 评论区图片背景 | 模糊 31px / 背景明暗 44（显示「偏暗 6」） |
| 顶栏材质 | 8px / 7% |
| 搜索框材质 | 15px / 47% |
| 搜索面板材质 | 38px / 61% |
| 顶栏触发面板材质 | 38px / 61%（与搜索面板一致） |
| 设置面板材质 | 28px / 31% |
| 首页预加载 | 150% |
| 设置面板缩放 | 130% |

> 背景明暗的 `fmt` 是 `50 - v`，所以「偏暗 6」= 44 而不是 6；滑块 step 是 2，写默认值要能被 2 整除。

### 恢复默认设置（个性设置 → 设置管理）

> 2026-10-17 起「设置管理」不再在「界面优化」页末，而是和奶睿两项一起挪进新增的
> 「个性设置」页（`PERSONAL_GROUP`，见 `settingsPanel.ts`）。`restoreDefaults()` 仍然是
> **全局**重置 —— 它重置的是所有分组的所有开关与参数，和它挂在哪一页无关。

- 卡片结构：`.setting-block.is-plain` > `.block-head`（「设置管理」）+ `.item`
  （「恢复默认设置」+ `button.text-btn`「重置」）。`.block-head` 用和 `.item::after`
  同一条左内缩 12px 的发丝线，别改成对称的 `border-bottom`。
- 点「重置」→ `.confirm-mask.show`；`.confirm` 是弹窗本体（标题「是否恢复默认设置」+
  一行说明 + `#confirm-cancel` / `#confirm-ok`）。取消、点暗色遮罩、Esc 都只关弹窗，
  不动任何设置。
- 点「确定」→ `restoreDefaults()`：`persist({ ...DEFAULT_CONFIG })` 写全量开关 →
  逐个 `resetXxxParams()`（各自 `persist` 自己的 storage key）→ `applyPanelParams()` /
  `applyPanelScale()` / `syncUI()` / `syncScale()` 把 CSS 变量与面板 UI 拉回默认。
  页面级效果（顶栏、预加载）不用管：它们各自订阅了 `onXxxParamsChange`，`reset()` 的
  `notify()` 会把它们一起刷新。
- **弹窗必须 `stopPropagation`**：面板关合靠 `document` 上的兜底 click（`onDocClick`），
  而 `.confirm-mask` 在 `.panel` 之外，不拦的话点一下弹窗会把整个面板关掉。
- `.confirm-mask` 是 `position: fixed; inset: 0`（宿主没有 transform，不会退化成局部定位），
  `z-index: 3` 盖住 `.panel` 的 2。弹窗宽度同样 `calc(... / var(--z))` 再 `scale(var(--z))`，
  跟面板一起缩放；隐藏态 `scale(calc(0.94 * var(--z)))`，和面板同一套弹性曲线。
- 玻璃模式：`applyPanelGlass()` 会同步给 `.confirm-mask` 加 `is-glass`。弹窗遮罩强度用
  `max(0.74, var(--bili-panel-tint))` 兜底 —— 面板大面积透明好看，但弹窗只有几行字，
  跟到 31% 会难读。**这是全项目唯一一处故意不跟随面板 tint 的地方**，别再改回去。

## 版本、发布与图标

**版本号只有一处**：`package.json` 的 `version`。`src/manifest.ts` 里
`version: pkg.version`，构建时写进 `extension/manifest.json`。当前 **1.0.1**
（1.0.0 已上架 Microsoft Edge 加载项商店）。
发版 = 改 `package.json` → `pnpm build` → 重新加载扩展。

### 开发版本号：每次改动 +1

商店版本号只在发版时变，开发期改代码它不动，于是「用户装的是哪一次构建」没法从界面
判断。所以另有一个开发序号，显示在**设置面板 → 个性设置 → 最末一行**
（形如 `开发版本 1.0.1 v008`）：

- 常量是 `settingsPanel.ts` 里的 `DEV_VERSION`，格式固定 `<商店版本> v<三位序号>`；
- **每改一次代码（功能 / 样式 / 文案 / 性能 / 修 bug）就把 v 后面 +1**：
  v001 → v002 → v003 …，补零到三位，用户报「我是 v007」时才对得上；
- 商店版本号升级时（1.0.1 → 1.0.2）序号**重置回 v001**；
- 只改版本号本身不算一次改动，不 +1、也不写日志。

### 变更日志：`CHANGELOG/<商店版本>.md`

一个正式版本一个文件（当前是 `CHANGELOG/1.0.1.md`）。同一版本内的所有改动都往这个
文件追加一条**一句话概述**（改了什么 + 为什么），按小节归类；v 序号的递增本身不记。
发版时这个文件就是商店「更新说明」的底稿。

**图标**（`extension/assets/` 是手放目录，构建不会覆盖也不会生成）：

| 文件 | 用途 |
| --- | --- |
| `extension/assets/icon-16.png` / `icon-48.png` / `icon-128.png` | **真正生效的三张**。`src/manifest.ts` 的 `icons` 16/48/128 分别指向它们，`action.default_icon` 是 `{ 16: icon-16, 32: icon-48, 48: icon-48 }` |
| `extension/assets/icon-512.png` | 旧图标的 512 原图，**manifest 已不引用**；留着只当备份 |
| `extension/assets/icon.svg` | 设计源文件，manifest 未引用 |

换图标：把新图按 16 / 48 / 128 三档导出并**覆盖同名文件** → `pnpm build` → 扩展页刷新。
文件必须真实存在，否则 Chrome 报 `Could not load icon`，扩展直接加载失败。
想加 32 / 256 档就同时改 `src/manifest.ts` 的 `icons` 与 `action.default_icon`。
注意 `pnpm clear` 只删 `extension/dist` 和 `extension/manifest.json`，**不动 `assets/`**，
所以图标文件不会被构建清掉。换完没生效通常是 Chrome 缓存：停用再启用扩展，或重启浏览器。

**页面右下角那颗 ⚙ 不是扩展图标**，是内容脚本画的 `div`（`settingsPanel.ts` 里的
`<div class="btn">⚙</div>` + `panel.css` 的 `.btn`）。改它走 CSS，不要去找图标文件。

## Root classes & CSS variables

Applied to `<html>` by the script (see the `topbar.css` header comment):

| Class | Meaning |
| --- | --- |
| `bili-elite-home-opt` | topbar rewrite + 播放页右栏广告屏蔽 — **always on** |
| `bili-elite-home-only` | 首页优化 (banner/channel bar + 稍后再看 button + 推荐流特殊卡片) |
| `bili-elite-glass` | 顶栏材质 |
| `bili-elite-searchbox-glass` | 搜索框材质 |
| `bili-elite-searchpanel-glass` | 搜索面板材质 |
| `bili-elite-homepanel-glass` | 顶栏触发面板材质（悬停「首页」弹出的自绘频道面板） |
| `bili-elite-searchpanel-opt` | 搜索面板优化 |
| `bili-elite-sp-managed` | (on the panel) 搜索面板优化 has taken over this node |
| `bili-elite-sp-open` | (on the panel) panel currently open |
| `bili-elite-preload` | 首页预加载 — lifts the feed sentinel so B站 loads the next batch earlier |
| `bili-elite-card-border-home` / `-confirm-home` | 首页卡片边界 / 首页卡片确认 |
| `bili-elite-card-border-search` / `-confirm-search` | 搜索页卡片边界 / 搜索页卡片确认 |
| `bili-elite-card-border-video` / `-confirm-video` | 视频页卡片边界 / 视频页卡片确认 |

| Variable | Consumer |
| --- | --- |
| `--bili-topbar-blur` / `--bili-topbar-tint` | 顶栏材质 |
| `--bili-searchbox-blur` / `--bili-searchbox-tint` | 搜索框材质 |
| `--bili-searchpanel-blur` / `--bili-searchpanel-tint` | 搜索面板材质 |
| `--bili-homepanel-blur` / `--bili-homepanel-tint` | 顶栏触发面板材质 |
| `--bili-panel-blur` / `--bili-panel-tint` | 设置面板材质 (shadow tree) |
| `--bili-panel-scale` | 设置面板缩放 — unitless, `1` = 100 % |
| `--bili-topbar-arrow` | 「首页 ∨」arrow SVG mask |

## The topbar search dropdown (subtlest part)

Markup facts verified on the live site:

```
.bili-header__bar
└ .center-search-container            ← must NOT create a backdrop root
  └ .center-search__bar               ← position: relative
    ├ #nav-searchform                 ← the 40px search box (focus → .is-focus / .is-actived)
    └ .search-panel.nav-search-panel  ← ONE element, two classes:
        │                                .nav-search-panel positions it (top:100%)
        │                                .search-panel is the white board
        ├ .trending > .header>.title + .trendings-double > .trendings-col > .trending-item
        └ .history > .header>.title/.clear
                  > .histories-wrap[style="max-height:92px|172px"]   ← we pin to 172 + scroll
                  >   .histories > .history-item > .history-text (+ .close)
                  > .history-fold-wrap > .fold-text + svg.fold-icon(.fold)   ← we hide this
```

- **Open/close is inline `style="display:none"`** on `.search-panel` (Vue `v-show`).
  `display` cannot be transitioned, so `topbar.css` forces the panel to stay
  `display:block !important` and the script switches `.bili-elite-sp-open`, with
  `opacity / transform / visibility` transitions doing both directions. The forced
  display is scoped to `.bili-elite-sp-managed` (added by `searchPanelOpt.ts`), so if
  the script ever fails to attach, the panel falls back to B站's native behaviour
  instead of being stuck hidden.
- **The search history no longer folds — it is a fixed-height scroll box.** B站
  hard-codes the fold heights in the inline `max-height` (92px folded / 172px expanded),
  keyed off `foldVisible && isFold`, and renders its own `.history-fold-wrap`
  「展开更多 / 收起」 button when it thinks the list is too tall. We override both, because
  the old behaviour still cut history off even after expanding:
  - `topbar.css` pins `.histories-wrap` to `max-height: 172px !important` — the old
    *expanded* size, i.e. 4 rows — plus `overflow-y: auto !important` (with a thin
    `scrollbar-width: thin` bar). Anything past 4 rows is reached by scrolling.
  - `.history-fold-wrap` is hidden outright (`display: none !important`), so the expand
    button is gone. `searchPanelOpt.ts` no longer injects a self-drawn one either — the
    whole `.bili-elite-sp-fold` control and its rAF-coalesced re-sync were deleted.
  - Our chip metrics are chosen so rows line up exactly: 34px chip + 6px margin = 40px per
    row → 172px = 4 rows. Change those numbers and the last row gets sliced in half.
- **Why `.histories { margin-bottom: 0 }`:** 4 rows (160px) + the 10px top margin = 170px,
  which is what has to fit under the 172px cap. B站's own `margin-bottom: 4px` would make
  it 174px, so an exactly-4-row history would grow a pointless 2px scrollbar.
- **B站's first-open measurement bug is now moot.** B站's `foldVisible` is computed as
  `historiesElRef.clientHeight > 80` inside `A()`, which runs when the panel becomes
  visible: it awaits `cols.getItem('search_history')`, assigns `l.value`, then measures —
  **before** Vue has rendered the items. On the first ever open `l.value` was still empty,
  so the whole `.history` block is not even in the DOM → the ref is `null` → measures `0`
  → `foldVisible = false`, and the inline `max-height` is written as the expanded `172px`.
  That measurement still cannot be influenced from the outside, and it no longer needs to
  be: the height is pinned with `!important` and B站's fold state is ignored entirely.
- **The history items still render asynchronously** (the history comes from an async
  store), but nothing in `searchPanelOpt.ts` depends on them any more. Its panel observer
  now watches only the `style` attribute for open/close — do not re-add a
  `childList`/`subtree` observer over the whole panel, that was the expensive part this
  simplification removed.

## The homepage recommendation grid (special cards)

Verified against the live site **and** B站's own bundle (`s1.hdslb.com/bfs/static/shanks/
laputa-home/assets/index-*.js` — grep for `__name:"FeedCard"` and the `goto` enum
`ht={av,ad,ogv_season,live,login}`).

```
.recommended-container_floor-aside             ← outer
└ .container.is-version8                       ← display:grid, gap 20px,
  │                                              grid-template-columns: repeat(4|5, 1fr)
  ├ .recommended-swipe                         ← top carousel (a grid item too)
  ├ .feed-card × 10                            ← first row
  │  └ .bili-feed-card > .bili-video-card | .bili-live-card | .bili-login-card
  ├ .floor-single-card                         ← 赛事 / 直播 / 番剧 / 国创 / 综艺 /
  ├ .bili-feed-card                            ←   课堂 / 电影 / 电视剧 / 纪录片 /
  ├ .floor-single-card                         ←   漫画 「楼层卡」
  └ …
```

- `FeedCard` (`.bili-feed-card`) dispatches on the item's `goto`: `av` / `ad` →
  `.bili-video-card`, `live` → `.bili-live-card`, `login_card` → `.bili-login-card`,
  and **anything else renders nothing**.
- `ogv_season` (番剧) does *not* go through `FeedCard` — it comes from the floor
  machinery and renders as `.floor-single-card`. That one class covers the whole special
  family (赛事 / 直播 / 番剧 / 国创 / 综艺 / 课堂 / 电影 / 电视剧 / 纪录片 / 漫画), so
  hiding it is enough; you do not need a per-category list.
- **Trap:** `.load-more-anchor` also contains `.floor-single-card` skeletons, and they are
  what gives the infinite-scroll trigger its height. Scope the hide to the *grid items*
  with a child combinator — `.container > .floor-single-card` — never a bare descendant
  selector.
- The container is a real CSS grid, so `display: none` on an item makes everything after
  it reflow with no holes. There is no JS bookkeeping needed — **but only for items that
  are actually removed from the grid.** `FeedCard` renders *nothing* for a `goto` it does
  not handle (everything except `av` / `ad` / `live` / `login_card` — e.g. `ogv_season`),
  which leaves a **contentless wrapper that still occupies a grid cell**: that is what a
  one-cell "空洞" (hole) in the card flow is. `topbar.css` §5.3 removes them with
  `.bili-feed-card:empty` (plus `.feed-card:has(> .bili-feed-card:empty)` for the outer
  wrapper — `:empty` ignores comment nodes, which is exactly what Vue's
  `createCommentVNode` leaves behind).
- **Hiding items breaks B站's `nth-of-type`-based row spacing.** Two of B站's rules key off
  DOM position: `.container > *:nth-of-type(n+8) { margin-top: 40px }` (children 8–12) and
  `.container.is-version8 > *:nth-of-type(n+13) { margin-top: 24px }`. Once the floor cards
  are gone, later cards slide up into those slots and a single row ends up mixing 40px and
  24px top margins — cards sit 16px out of line. §5.3 normalises children ≥ 8 to 24px, so
  every row from the third one on uses the same 44px rhythm.
- **Do not hide the skeleton placeholders — that is the real hole.** B站 renders a batch
  of skeleton cards at the end of the grid (`.bili-video-card__skeleton`,
  `.floor-card.single-card.floor-skeleton`, `.bili-live-card__skeleton`) to hold the cells
  of the batch it is still fetching. `display: none` on those leaves the cells genuinely
  blank, which is exactly the one-cell "空洞" you see while scrolling down. So the §5.2 rule
  only removes cards that carry data:
  - floor cards: the skeleton carries `.floor-skeleton`, real cards do not →
    `.floor-single-card:not(:has(.floor-skeleton))`;
  - live cards: a **real** live card contains `.bili-live-card__skeleton.hide` (B站 keeps the
    node and hides it with `visibility: hidden`), so "a skeleton that is actually showing"
    is `.bili-live-card__skeleton:not(.hide)` →
    `.bili-live-card:not(:has(.bili-live-card__skeleton:not(.hide)))`.
  With the skeletons left in place the grid always stays full: hiding a real card shifts the
  following skeletons up into the freed cells.
- Grid auto-placement with only one explicitly-placed item (the top `.recommended-swipe`,
  `grid-column: 1/3; grid-row: 1/3`) **cannot leave holes**, so `grid-auto-flow: dense`
  would be a no-op here — it is deliberately not used.
- §5.4 adds `padding-top: 20px` to `.bili-feed4-layout`: with 首页优化 hiding the big banner,
  the feed used to start flush against the fixed 64px topbar (gap = 0).
- B站's own `nth-of-type` rules on `.container > *` only set `margin-top` (row spacing),
  never `display: none`, so hiding items cannot trip them. Rows measure a uniform 44px
  gap; the one ~317px gap that shows up in a column exists **before** the change too
  (a B站 skeleton-card region) — do not chase it.

## The video-page sidebar ad

`#slide_ad` sits in `.video-pod-above-modules__inner` (right column, directly under the
danmaku list) and is roughly 411×235. **Its class list is not stable** — B站 adds/removes
`slide-ad` depending on ad state (sometimes it is only `.slide-ad-exp`), so only the
**id** can be relied on. It is hidden by the always-on layer
(`html.bili-elite-home-opt #slide_ad { display: none !important }`) rather than by a
feature toggle: the node only exists on the play page, so other pages are unaffected and
no extra settings UI is warranted. The sibling `.video-card-ad-small` is a separate small
ad and is deliberately left alone.

## 动态页侧栏「回到旧版」按钮（§17.1）

动态页（`t.bilibili.com`）右侧固定栏里有一枚 40×40 的「回到旧版」按钮，和「回到顶部」
**是同一个类名**：

```
.bili-dyn-sidebar
├ .bili-dyn-sidebar__btn > span            ← 「回到旧版」，常驻
└ .bili-dyn-sidebar__btn > span.back-top  ← 「回到顶部」，滚到一定位置才显示
```

所以不能整类隐藏，`topbar.css` §17.1 用 `:not(:has(.back-top))` 只排掉旧版那枚
（2026-10-17 之前它单独占 §10.2，收尾时并进了 §17 —— 原生浮动按钮的屏蔽都归一处）：

```css
html.bili-elite-home-opt .bili-dyn-sidebar__btn:not(:has(.back-top)) { display: none !important }
```

挂在始终生效层下（无开关）：这个节点只存在于动态页，其他页面自然无影响；而动态页不在
`isTopbarOptExcluded()` 里，`html.bili-elite-home-opt` 一定在。实测（2026-10-17，
真实页面注入该条规则）：`.bili-dyn-sidebar__btn` 共 2 个，该选择器命中 1 个（「回到旧版」），
computed `display` 变 `none`，「回到顶部」不受影响。

## 右下角浮动键（返回顶部 / 刷新）与原生浮动按钮屏蔽

`floatingButtons.ts` + `floatingButtons.css`：在设置键 ⚙ 上方 10px 处挂两枚 44×44 白底黑图标圆钮。

- 宿主 `#bili-elite-float-host`：`position:fixed; right:24px; bottom:234px; pointer-events:none`。
  234 = 设置键的 180 + 44 高 + 10 间距；`pointer-events:none` 让两键之间的空档不挡页面点击，
  只有 `.fab` 自己 `pointer-events:auto`。
- **按页面类型决定渲染哪几枚**，没有的键根本不写进 DOM（不是 `display:none`）：返回顶部
  全站都有；刷新只给首页（`isHomePage()` = `www.bilibili.com` 的 `/` 或 `/index.html`）。
  少一个键时整列自然贴着设置键，不留空位。
- 返回顶部 `scrollY > 200` 才显示（`sync()` 同时看开关与滚动位置）；滚动监听 passive + rAF 合帧，
  不读布局。
- **刷新必须点内层** `.flexible-roll-btn.refresh .flexible-roll-btn-inner`：外层
  `.flexible-roll-btn` 上没有处理器 —— 实测点外层零请求、点内层发一次
  `wbi/index/top/feed/rcmd`。找不到内层才退回 `location.reload()`。节点被 §17 藏成
  `display:none` 不影响 `click()` 派发。
- 点刷新时给图标挂 `is-spinning` 转一圈（一次性动画，620ms 后摘掉），不做常驻动画。

原生那一列（`topbar.css` §17）分四套容器收：

| 页面 | 刷新 | 返回顶部 | 始终隐藏 |
| --- | --- | --- | --- |
| 首页 | `.flexible-roll-btn.refresh`、`.feed-roll-btn` | `.to-top-btn` | `.palette-button-wrap .storage-box`（… + 客服） |
| 搜索页 | — | `.btn-to-top-wrap` | `.side-buttons > div:has(> a[href*="customer-service"])` |
| 视频页 | — | `.back-to-top-wrap` | `.fixed-sidenav-storage > div:has(> a.customer-service)` |
| 动态页 | — | `.bili-dyn-sidebar__btn:has(.back-top)` | `.bili-dyn-sidebar__btn:not(:has(.back-top))`（回到旧版） |

两个开关各切一个 root class（`bili-elite-native-refresh-hide` /
`bili-elite-native-backtop-hide`，见 `topbarOptimize.ts` 的 `applyNativeHide()`）。
客服那几条带 `:has(> …)` 的父级选择器：搜索页 / 视频页的客服外面还套了一层 `div`，
只藏 `a` 会在 flex 列里留一个空档。

### 网页全屏时必须被视频盖住（`videoLayer.ts`）

两个宿主都是 `position: fixed` + `z-index: 2147483647`，进网页全屏后会浮在播放器上面。
`videoLayer.ts` 统一管这一层：

- `onWebFullscreenChange(cb)`：`MutationObserver` 盯 `<body>` 的 `class`，
  命中 `webscreen-fix`（主站）/ `player-full-win`（直播站）就算在网页全屏里 ——
  和 `videoFullscreen.ts` 的判据同源。只在进 / 出全屏各回调一次，不轮询、不读布局。
- `bindLayerToWebFullscreen(host, frontZ)`：平时写 `frontZ`；**进全屏把宿主整个
  `display: none !important`，退出时 `removeProperty('display')` 再把 `frontZ` 写回来**。
- **不要试图用「压低 z-index」解决（2026-10-18 真实播放页实测）**：网页全屏时 B 站给
  body 加的是 `position: fixed`（z-index: auto），而 fixed 自己就生成层叠上下文 ——
  播放器的 `#bilibili-player.mode-webscreen{position:fixed;z-index:100000}` /
  `.bpx-player-container{position:relative;z-index:100000}` 全被关在 body 这个 0 级上下文里；
  我们的宿主是 `<html>` 的直接子元素，只要 z-index 为正就永远压在整棵 body 子树之上 ——
  压到 1000 甚至 1 都还在视频上面，压成负数才会沉到 body 背景后面。隐藏与层级无关，才稳。
- **`z-index` 必须用 `setProperty(..., 'important')`**：宿主原本带 `!important` 的内联层级，
  普通赋值压不住它。所以创建宿主时也别再把 `z-index` 写进 `cssText`，交给这个函数。

## Fullscreen animations (main site + live site)

`modules/videoFullscreen.ts` runs on every B站 page (`initModules()`), but it used to be
hard-wired to the main site's player — so **直播页的两个动画一直没生效**（容器选择器根本命中不了）.
It now covers both players:

| | 主站播放页 | 直播站 |
| --- | --- | --- |
| 播放器容器 | `.bpx-player-container` | `#fullscreen-container` |
| 网页全屏时 `<body>` 上的类 | `webscreen-fix` | `player-full-win` |
| 「全屏」(F) | Fullscreen API | Fullscreen API，fullscreenElement 就是 `#fullscreen-container` |

- `CONTAINER_SELECTORS` 是列表、先命中先用（`getContainer()`）；`WEB_FS_CLASSES` 同理
  （`inWebFullscreen()`）。**两个 body 类名不能合并**：直播站上 `body.fullscreen-fix` 是
  *原生全屏* 那条路的状态（`#fullscreen-container` 同时成为 `document.fullscreenElement`），
  网页全屏才是 `body.player-full-win`；把 `fullscreen-fix` 当网页全屏会让动画重复触发。
- 跑哪段动画由「动效增强」的三个开关决定：网页全屏动画 `webscreenAnim`（进入 / 退出各一段）、
  宽屏模式动画 `wideAnim`（宽屏 ↔ 普通各一段，触发点是 `.bpx-player-container` 的
  `data-screen` 从 `normal` 变 `wide`，见 `playerMode.ts`）、
  全屏关闭动画 `fullscreenAnim`（原生全屏退出时一段）。
- 宽屏**只能靠 data-screen 判定**，没有可拦的事件：B 站改完属性后的那一次布局里尺寸就已经是
  终态了（实测 963×588 → 1218×728 在同一帧完成），所以「从哪儿开始」必须用切之前快照的 rect。
- **直播站退出全屏时布局是晚几帧才恢复的。** 在 `live.bilibili.com/1` 实测：`fullscreenchange`
  那一刻 `#fullscreen-container` 还是 `[0,578,1028,900]`，下一帧才变 `[50,126,1028,578]`。
  拿同步量到的 rect 当目标，动画会飞错地方、结束时再跳一下 —— 所以退出目标改取
  `lastNonFsRect`（进全屏前那一刻由 `pointerdown` / `keydown` / `scroll` 快照下来的 rect），
  仅在它与当前 rect 不一致时才用（`sameRect()` 比较）。主站两者本来就一致，那条路径与改动前
  完全相同，不引入额外延迟。
- 直播站的播放器是 Svelte 组件（`.live-web-player-controller svelte-*`），由
  `s1.hdslb.com/bfs/static/bilibili-live-player/room-player.*.prod.min.js` +
  `s1.hdslb.com/bfs/static/blive/blfe-live-room/static/js/*.js` 渲染，**里面没有 `.bpx-player-*`**。
  控制栏只在 hover 时渲染，两个全屏按钮是 `.live-web-player-controller .right-area .tip-wrap`：
  下标 0 = 全屏，下标 1 = 网页全屏。
- 直播页的搜索表单与主站**同 id** `#nav-searchform`；§8（搜索框材质）作用域在 `.bili-header`
  之下，所以不会漏到直播站。

## 图片开合动画（评论区 + 动态页相册）

`imageViewer.ts` 的开关动画都是 **FLIP**：点击时记下起点 `rect`（`lastImgRect`），
再 rAF 轮询等 `.pswp.pswp--open` 出现，然后反算 `.pswp__scroll-wrap` 的
`translate + scale`（`computeFlip()`）；关闭由 `.pswp` 上 `pswp--ui-visible`
被移除触发反向动画，transition 由 `imageStyle.ts` 注入的 `.bili-closing-anim` 提供。
开关两段的时长是 `IMAGE_DUR_OPEN = 330` / `IMAGE_DUR_CLOSE = 290`。

| 入口 | 点击目标 | FLIP 起点 |
| --- | --- | --- |
| 评论区图片 / 页面上任意 `<img>` | `<img>` | 被点的 `<img>` 自身 |
| 动态页「查看大图」 | `<div>`（工具栏按钮） | `.bili-album__watch__content img`（相册内联大图） |

**动态页（t.bilibili.com）是两步打开大图的**，别当成一步：

```
.bili-album
├ .bili-album__preview                    ← 缩略图；点击 → 卡片**内联展开**（不建 pswp）
└ .bili-album__watch                      ← display: none ↔ block
  ├ .bili-album__watch__control
  │ └ .bili-album__watch__control__option
  │     .zoom-out(收起) / .full-screen(查看大图) / .ccw-rotation / .cw-rotation
  └ .bili-album__watch__content > img     ← 内联大图（FLIP 起点）
```

- 第二步「查看大图」的 `e.target` 是个 `<div>`，`composedPath` 里**没有 `<img>`**，
  所以「只认 `<img>`」的老逻辑直接 return —— 这就是动态页一直没有开合动画的原因。
  `albumSource()` 为这个按钮补了一条：从按钮所在 `.bili-album__watch` 里取
  `.bili-album__watch__content img` 的 rect 当起点。
- **缩略图点击必须提前 return**（`isAlbumPreviewClick()`）：它只做内联展开，
  既不记 rect 也不上锁。否则 `lockFor(IMAGE_DUR_OPEN)` 那 330 ms 的锁会把紧随其后的
  「查看大图」点击 `stopImmediatePropagation` 掉 —— 实测「点缩略图 → 120 ms 内点查看大图」
  会完全没反应。这个 guard 只在相册里确实存在 `.bili-album__watch`（即两步式）时才生效，
  所以哪天某个变体改成「点缩略图直接开 pswp」，老路径仍然接管。
- 关闭方向不用额外处理：关掉 pswp 后内联态还在原位，`rect` 就是它的位置，直接缩回去。
- **pswp 里的图可能比内联图小**：B站给 pswp 上下各留 130 px 内边距，且不放大超过图片
  原始尺寸（实测源图 480×640 的相册：内联 616×821，大图 480×640），所以动画看起来是
  「缩一下」。那是 B站的最终状态，FLIP 必须落在它上面 —— 为了好看去放大，结束时就会跳。
- 验证方式（真实页面注入 `imageViewer.ts` + `imageStyle.ts` 的 tsc 产物，逐帧读
  `.pswp__scroll-wrap` 的 computed transform）：点「查看大图」后第一帧应为
  `matrix(1.283,0,0,1.283,-215,97.2)`（正好把 pswp 图映射到内联图 rect），
  ≈330 ms 后回到 `none`；关闭时反向回到同一个 matrix，pswp 在 ≈370 ms 后被移除。

## Page-level sticky sub-bars must be pushed below the fixed topbar

我们的顶栏是 `position: fixed` + `z-index: 1002`；B站各子页面自带一条 `position: sticky;
top: 0` 的页面级工具栏（原生顶栏会随页面滚走，所以它 `top: 0` 本来是对的），固定顶栏一压上去
它就钻到底下：既看不见也点不到，**而且顶栏的 `backdrop-filter` 采到的是那块静止的白底**，
于是毛玻璃读起来就是「下滑后实时模糊没了、变成一块不动的白」。

§15 现在只剩一条通用机制：`html.bili-elite-home-opt .bili-elite-under-topbar { top: 64px !important }`，
标记类由 `ensureUnderTopbar()` 按「`position: sticky` + computed `top: 0px` + 高度 24–200 +
宽度 ≥ 视口 60%」自动打，只扫 `body` 往下 6 层（≈ 40–110 个元素，从 `sync()` 跑得起），
跳过已标记元素、`document.hidden` 时直接返回。B站以后新加子栏也能自动覆盖。

原先两个「已知案例」的选择器已经删掉，因为那两个页面现在整页排除顶栏改造（见上面的 Exception）：

| Page | Selector | Native rule |
| --- | --- | --- |
| 个人空间（已排除） | `.nav-bar.space-navbar` | `position: sticky; top: 0; z-index: 99` |
| 历史记录（已排除） | `.history-record .main-breadcrumbs` | `position: sticky; top: 0; z-index: 1000` (from `shanks/history-record/assets/index-*.css`) |

这两页顶栏是 B站原版、子栏按原生 `top: 0` 工作，本来就不需要下移。反过来说：**§15 目前
在 www 主站 / t.bilibili.com 这些页面上没有任何命中目标**，它是给非排除页（含游戏 / 商城 /
漫画等子站）留的保险；如果哪天它开始误命中，先确认不是把某个非工具栏的 sticky 元素卷进来了。
验证方式（2026-10-16 实测）：注入一条未知类名的 sticky 条，`ensureUnderTopbar()` 会打上
`.bili-elite-under-topbar` 且 computed `top` 变 `64px`。

## Preloading the homepage feed (`preload`)

B站's infinite scroll is driven by `F6(element, cb, { offset, throttle })` in the homepage
bundle, called with the **`.load-more-anchor`** element and `offset: 200`:

```js
// F6 内部（每个 window scroll，节流 200ms）
const h = top ? rect.top : rect.bottom
h + offset <= window.innerHeight ? cb({ stop }) : Math.abs(h - window.innerHeight) < offset && cb({ stop })
```

So the rule is effectively **`rect.bottom < window.innerHeight + 200`** — i.e. B站 only
starts fetching the next batch once the sentinel is within 200px of the fold, which is why
you always see a gap of skeleton cards while scrolling. It also runs the check once on
mount, so the first extra batch arrives by itself.

The 200px lives in a closure and cannot be changed, but the check reads the element's
**current rect**, and `transform` changes `getBoundingClientRect()` without touching layout.
The distance is a **settings slider** (界面优化 → 首页预加载 → 预加载范围, 0–300 %,
default 150 %, step 10) owned by `preloadConfig.ts` (`createNumberParamStore`, key
`bili-elite-preload`, cap constant `PRELOAD_MAX_DIST`); `topbarOptimize.ts` writes it as
`--bili-preload-dist` in `vh`, and `topbar.css` §11 uses it. 0 % is a no-op = B站's stock
behaviour.

The percentage is a **screen count measured from the current scroll position**: 100 % ≈ lift
the sentinel one viewport (≈ 1 屏 / 1 页 preloaded below the fold) and 300 % is the cap (3 屏).
Because the lift is a constant `translateY`, it is always relative to wherever the user is
right now — never to the initial top-of-page state. `PRELOAD_PARAM_DEFS[0].hint` carries the
Chinese explanation and `settingsPanel.ts` renders it as `.range-hint` small print under the
range (`hint?: string` is optional on `NumberParamDef`, so any slider can have one).

**Test metric trap:** `.feed-card` is *not* a usable count for "did another batch arrive" —
B站 wraps only the first batch in `.feed-card` and appends later batches as bare
`.bili-feed-card`s, so the count stays at 10 forever. Count
`.recommended-container_floor-aside .container > *` instead. Measured on the live site with
the CSS injected after load: scrolling to 2 screens above the bottom loads nothing at 0 %,
but at 300 % the same scroll pulls in ~45 extra grid items (≈ 3 batches) — the 3-屏 cap
behaves as intended. Geometry check: at `--bili-preload-dist: 300vh` with `innerHeight` 900
the sentinel's computed transform is exactly `matrix(1,0,0,1,0,-2700)` and its skeleton child
does not move.

- **The preload cannot "stop working" — verified, do not chase it as a bug.** B站's loader
  callback (`Ne` in `F6(O, Ne, { offset: 200 })`) never calls the `stop` function it is handed;
  it only guards on concurrency (`if (!V.value && !C.value && !P.value && !ee.value)`) and on a
  hard `fetch_row` cap, after which it flips the sentinel out of the DOM entirely. Because the
  lift is a constant `translateY`, the trigger stays true at every scroll position. Measured on
  the live site over **22 consecutive 900 px scrolls** (y 0 → 18365): the grid's child count
  rose monotonically 42 → 357 with no stall, and the sentinel's computed transform stayed
  `matrix(1,0,0,1,0,-2700)` the whole way.
- **The grey "unloaded" cells are B站's own placeholder tail, not a preload failure.** B站
  reserves a batch of skeleton cells (12–16) at the end of the grid at all times; the preload
  only makes the fetch start earlier so they get filled sooner. **§11.1 used to hide that
  tail whenever `preload` was on and was deleted on 2026-10-17** — hiding it left a big blank
  area on first load, which reads as "nothing loaded". The tail is now kept and repainted
  (§16), and the sentinel's own skeleton child is kept as well, so the last cell is a normal
  placeholder instead of a 1 px stub (which also removes the old
  `if (d === 0 && f === 0) return` worry). What remains is the JS keep-alive timer below.
- **The loader only re-checks on `scroll` — that is why "stop and wait" never loads.** B站's
  `c()` is registered with `uC(window, { throttle: 200, onScroll: c })`, so once the user stops
  scrolling nothing re-evaluates and the placeholder tail sits there forever, which reads as
  "the preload stopped working". `topbarOptimize.ts` therefore runs
  `setInterval(nudgePreload, 800)`: while the sentinel's (already lifted) rect still satisfies
  `rect.bottom <= innerHeight + 200`, it dispatches a synthetic `scroll` event on `window`.
  Measured on the live site: after scrolling to y=866 and then **not touching the page**, the
  grid's visible children grew 47 → 83 → 107 over the next 4 s (8 nudges) and then stopped on
  its own once `trigger` flipped to `false`, leaving ≈3.2 screens of loaded content below the
  fold. The loop converges because each load pushes the sentinel out of range; `document.hidden`
  short-circuits it in background tabs.
- **The timer is gated by an `IntersectionObserver`, and that gate needs two conditions.**
  The observer uses `rootMargin: '0px 0px 200px 0px'`; but §11 *lifts* the sentinel by up to
  300 vh, so "sitting at the real bottom of the feed" puts the sentinel **above** the viewport,
  where `isIntersecting` is `false`. The callback therefore also treats
  `boundingClientRect.bottom < 0` as "in range" (`2026-10-17` fix). Drop that clause and the
  timer never starts while the user rests at the bottom — the placeholder tail hangs forever,
  most visibly right after clicking 刷新 (B站 rebuilds the feed, the page jumps to the top,
  and the freshly placed sentinel ends up above the fold).
- **`IntersectionObserver` only fires on *state changes*, so a re-render can leave it stale.**
  `返回顶部 → 刷新` is the trap: before the refresh the sentinel is below the viewport
  (not intersecting), after it the sentinel is above the viewport (still not intersecting) —
  same state, **no callback**, so `startKeepAlive()` never runs and the placeholder tail sits
  there until the user scrolls (which produces a real threshold crossing — "下滑后恢复").
  `syncPreloadAnchor()` makes it worse by early-returning when the node is unchanged, and
  B站 usually *reuses* `.load-more-anchor` across refreshes. Fix: `preloadDirty` is set by
  `touchesFeed()` in the MutationObserver, and `sync()` then calls
  `syncPreloadAnchor(true)` to **rebuild** the observer — a fresh `observe()` always delivers
  an initial callback, which re-evaluates the current geometry regardless of crossings.

So `topbar.css` §11 lifts the sentinel by `--bili-preload-dist` (default `80vh`):

```css
html.bili-elite-preload … .load-more-anchor { transform: translateY(calc(-1 * var(--bili-preload-dist, 80vh))) }
html.bili-elite-preload … .load-more-anchor > * { transform: translateY(var(--bili-preload-dist, 80vh)) }
```

The second rule counter-translates the skeleton **child** so it still paints exactly where
it used to — the sentinel's rect moves up (triggering the fetch ~720px earlier, i.e. the
buffer grows from ≈1 screen to ≈1.8 screens) while nothing moves visually. Two traps:

- **Do not hide the sentinel's content instead.** Hiding it (`visibility: hidden`) keeps the
  cell occupied but blank, which *is* a visible hole in the grid.
- **Use `transform`, not `margin`.** A negative margin changes layout and therefore changes
  the very rect the check reads.

Verified: with `preload` off, scrolling to `scrollY=500` does not load; with it on, the same
scroll loads the next batch (`anchorPageBottom 1810` vs `1090 − 720 = 370`, threshold 1100).

## Card border / card confirm — six switches (3 pages × 2 effects)

History: one `cardOutline` toggle → split into `cardBorder` + `cardConfirm` (2026-10-17) →
split again into **six independent switches**, one per page per effect:

| Page | Border | Confirm |
| --- | --- | --- |
| 首页 | `cardBorderHome` | `cardConfirmHome` |
| 搜索页 | `cardBorderSearch` | `cardConfirmSearch` |
| 视频页右栏 | `cardBorderVideo` | `cardConfirmVideo` |

`topbarOptimize.ts` keeps them in one `CARD_SCOPE_CLASSES` map (key → root class) and a
single `applyCardScopes()`; `onConfigChange` just does `key in CARD_SCOPE_CLASSES`. Add a
page or an effect by adding one map entry + one CSS block, no new functions.
"Border" = the resting grey hairline, "confirm" = hover substrate + blue outline; they are
independent everywhere (border-only → no hover change; confirm-only → no resting border).

§12 has four blocks: **12.0** per-page geometry variables, **12.1** shared geometry
(radius / transition / "no substrate by default", applied when *either* switch of that page
is on), **12.2** the border, **12.3** the confirm. Everything is driven by
`--bili-card-radius` / `--bili-card-offset` / `--bili-card-spread`, set once per page:

| Page | radius | offset | spread | why |
| --- | --- | --- | --- | --- |
| 首页 | 12 | 6 | 6 | transparent card body, substrate on the grid item |
| 搜索页 | 10 | 4 | 4 | card sits 8 px inside its cell — offset must stay **< 8 px** (see traps) |
| 视频页 | 10 | 4 | 4 | 350×80 cards, only 12 px of margin between them |

- **The border deliberately covers the loading placeholders too** (§16): a placeholder
  is still "a video cell whose content hasn't arrived", so outlining only the real cards
  made the tail look like grey slabs floating on white. The **hover** rule is the one
  that excludes placeholders — they carry nothing clickable, so colouring them in would
  read as "loaded".
- **Placeholders are excluded with `:not(:has(...))`**, three times
  (`.bili-video-card__skeleton:not(.hide)`, `.floor-skeleton`,
  `.bili-live-card__skeleton:not(.hide)`).
  `:has()` inside `:not()` **is** legal (only `:has()` inside `:has()` is not). The
  previous design instead reset the properties in a separate rule; that no longer works
  because the reset would also wipe the grey border, which placeholders now *do* get.
  Verified on the live homepage: the hover selector matches the 10 `.feed-card`s plus
  the one real live card and nothing else.
- **Keep `:not(.hide)` on `.bili-video-card__skeleton`.** On the search page *every real
  card* permanently carries `<div class="hide bili-video-card__skeleton">` as its loading
  state (42/42 on a live 综合 page). The search rule no longer needs the exclusion (it has
  no `:has()` chain), but the homepage one does keep it: the same "hidden skeleton inside a
  real card" pattern would otherwise exclude real cards, and the failure mode is silent
  (hover simply stops working).
- **`outline`, never `border`**, and no `transform` on hover: `outline` does not take
  part in layout and Chrome follows `border-radius`, so `border-radius: 12px` +
  `outline-offset: 6px` puts the hairline 6 px outside the cell. A `transform` would give
  B站's absolutely-positioned popovers a new containing block.
- The hover substrate is two layout-neutral layers: `background-color: #e6e9ee` (visible
  behind the title / UP row because `.bili-video-card` is transparent) plus
  `box-shadow: 0 0 0 6px #e6e9ee` (0 blur + 6 px spread) for the "inner padding" gap.
  **`padding` is not an option** — it would widen the card and change the column count.
  Both states declare two `box-shadow`s (the default pair fully transparent) so the fade
  in/out interpolates cleanly.
- **Never make the substrate the default.** B站 always keeps a batch of empty placeholder
  cells at the grid tail; a default `background-color` paints them as solid grey slabs,
  which reads as "the preload is broken". That was the round-1 design and it was wrong.
- `:not(.load-more-anchor)` stays in every selector — the sentinel is a grid item but is
  not a card.

### 搜索页的两处坑（都踩过，别改回去）

1. **The search grid cell is not the card.** `.search-page .video-list > *` is
   `.col_3 … mb_x40` with **`padding: 0 8px`**, and in the wrapping flex row the cells'
   border boxes are **flush (0 gap)**. Outlining the cell at `offset: 6px` makes
   neighbouring outlines overlap by 12 px. So the search rules target the inner
   `.bili-video-card` (282 px wide, `position: relative`). That card already sits 8 px
   inside the cell, so any `outline-offset < 8px` keeps the outlines apart. It is set to
   **4 px**: 4 px of breathing room between the border and the card content, and
   `16 − 4 − 4 = 8` px left between two neighbouring outlines (measured: card gap 16,
   outline gap 4–6 px counting the 1 px / 2 px stroke). Do **not** raise the offset to 8
   or beyond — that reproduces the original overlap.
2. **`.bili-video-card__wrap` is white and absolute on the search page.** On the homepage
   that node is `static` + transparent, so a substrate on the grid item shows through. On
   the search page it is `position: absolute; background: #fff` and covers the whole card —
   painting the substrate on the cell gets masked by it ("grey plate with a white sheet on
   top"). So the search confirm paints `background-color` on
   `.bili-video-card:hover > .bili-video-card__wrap` instead, and the transition lives on
   that node too.

### 视频页右栏

- Scope is `.recommend-list-v1 .video-page-card-small` (20 cards) — **not** `.rec-list > *`
  / `.next-play > *`. `.next-play` also contains `.rec-title` ("接下来播放" header) and a
  `.split-line`; a `> *` selector boxes the header and the 1 px divider. The divider must
  stay visible (it is B站's own separator) — it simply must not get an outline.
  Verified: `rec-title` / `split-line` → `outline: none`, `split-line` still `display: block`,
  1 px tall.
- `--bili-card-offset: 4px` because the cards are only 12 px apart; 6 px would make the
  outlines touch.

## Homepage loading placeholders (§16, always on)

First-load / refresh used to show a large blank area under the last real card, because
§11.1 hid B站's placeholder tail. That is gone: the tail is kept and repainted, so the
unloaded region reads as placeholder cards instead of a hole. No JS — §16 is pure CSS hung
off `html.bili-elite-home-opt`, so it applies with `preload` on *or* off.

- B站's skeleton markup (verified on the live homepage):
  `.container > .bili-video-card` (bare class, no `.feed-card` wrapper) →
  `.bili-video-card__skeleton` → `--cover` (248×140, `padding: 56.25% 0 0`, radius 6) +
  `--info > --right > --text` ×2 + `--light`. The floor variant is
  `.floor-skeleton > .floor-card-inner > .cover.skeleton-item` + 2 ×
  `.sub-information.skeleton-item`. The sentinel `.load-more-anchor` **contains** a floor
  skeleton, i.e. it is itself one of those cells.
- Native style is a **static** `#f1f2f3`. §16 repaints `--cover` / `--text` / `--light` /
  `.floor-skeleton .skeleton-item` with `#e9ecf0` + a static `120°` gradient
  (`#e9ecf0 → #eef1f5 46% → #e9ecf0`).
- **There is deliberately no animation, and that is a measurement, not an oversight.**
  The sheen used to slide via `background-position` on the 9 floor-skeleton elements
  (infinite). On the live homepage that alone cost **23.7 % idle main-thread CPU**
  (`Performance.getMetrics` `TaskDuration` over a 6 s window) versus **6.5 %** with the
  animation removed — and `ScriptDuration` was 11 ms in the same window, so the time was
  pure paint. A composited `transform` rewrite (`::after` + `translate3d`) measured
  *worse* here (29 %), so the animation was dropped entirely. If you ever want it back,
  measure first — never assume a composited animation is free.
- Traps: (a) never write the `background` shorthand — B站's `background-color` has to
  survive; (b) a transparent-to-white gradient washes the whole cell out to near-white —
  keep a real base colour in the gradient stops.
- `.floor-skeleton .skeleton-item.cover` gets `border-radius: 6px` so both placeholder
  flavours look like the same kind of cell.

## 顶栏首屏：播放页那 3 秒到底在干什么（topbar.css §1.1 / §1.2）

**先记住这组实测数字**（1440×900，本机，系统 Chrome；`page.addInitScript` 注入 dist
模拟 document_start，轮询 `.left-entry__item`）：

| 页面 | 旧版顶栏就位 | 新版顶栏导航就位 |
| --- | --- | --- |
| 首页 | —（SSR 直接给新版） | **≈0.23s** |
| 搜索页 | 无 | **≈0.8–1.3s** |
| 播放页 | **≈0.4s** | **≈2.7–4.6s**（vanilla 完全一样） |

播放页那 3 秒的 CPU 时间线（100µs 采样，按 250ms 窗口聚合）：

| 时间 | 在干什么 |
| --- | --- |
| 0–1.3s | B 站的**安全指纹 + 埋点**：`bili-user-fingerprint.min.js`（102ms）、`log-reporter.js`（66+94ms）、`bili-sc-sdk.umd.js`（80ms）、播放器 `core.js` 的 codec 能力检测（`checkVideoCapabilitySync`，走 rIC）。主线程 100% 占满 |
| 1.3–1.7s | 基本空闲，等 playurl / 等播放器 |
| 1.7–2.2s | 页面壳插入（`insertBefore` 52+35ms）；播放器 core 调 `fetchHelpers`，**2.17s 一次性拉 20 个 `npd.*.js` 分块**（调用栈：`core.js → fetchHelpers → buildRootExtra → __webpack_require__.e`） |
| 2.2–3.0s | `video.f3c6…js` 主包执行（67+60+30ms） |
| 3.0–3.3s | `bili-header.umd.js` 执行 → 新版顶栏出现 |

**结论**：播放页的顶栏不是独立组件，它和新版页面壳 / 播放器一起由 `npd` 那批 chunk
渲染，而那条链要等安全指纹 + 播放器 bootstrap 跑完 —— 我们改不了这个顺序
（那段 658ms 长任务里 273ms 是 B 站自己的 `insertBefore`，我们全部代码只占 60ms）。
**不要再试图提前它**，能做的只有两件事：

1. **别让 B 站自己的旧版顶栏拖后腿**：它在 `~0.4s` 就渲染出来了（`.bili-header.fixed-header
   > .mini-header`，导航项 `ul.left-entry > li`），以前我们只把内容 `visibility:hidden`
   （留一条白条）。实测它有真开销 —— 8 轮 A/B（显示 vs 隐藏）：新版顶栏就位中位数
   **3502ms → 3070ms（省 ~430ms）**，因为它的毛玻璃 `::before` 在整页首屏渲染期间
   一直在重算背景模糊（只去掉 backdrop-filter 也能省 ~250ms）。所以 §1.1 现在是
   **整块 `display:none`**。
2. **骨架栏别做毛玻璃**：它只画 logo、只填「0 → 新版顶栏」这段空窗，背后没有有意义的内容；
   换成实色底 + 发丝线，实测再省 ~200ms。`html:has(.left-entry__item)` 一成立就退场。

**不要做「假顶栏」**（试过把骨架画成整条顶栏：logo + 导航 + 搜索框 + 右侧图标，用户否了 ——
看着像加载完了，点上去却没反应，比空着更糟）。

**首屏主线程要省着用**：`MutationObserver` 回调在每个 DOM 批次上都会跑，首屏 B 站会打出
成百上千批。`startObservers()` 里两处必须保持：① 顶栏出现后不再每批
`querySelector('.bili-header')`；② `preloadAnchor` 为 null（非首页）时整段
`touchesFeed()` 跳过 —— 它要遍历 addedNodes 逐个 `matches`，CPU profile 里最坏占
我们首屏脚本时间的 60%（`$n` 179ms / 总 300ms）。扩展自身在搜索页前 2s 的脚本时间 ≈150ms。

## 「首页」悬停：跳动 + 箭头翻转（topbar.css §3）

B 站只给普通导航项加了 `jump` 动画（实测 `animation: jump-ec16de5b 0.3s`，
translateY 峰值 -2.9px），首页这一项（`.home-page-entry` / `.home-page-panel-entry`）
被排除在外。§3 补了一套同参数的 `@keyframes bili-elite-jump`（-3px / 0.3s），
并给自绘箭头的 `::after` 加了 `transition: transform` + 悬停 `rotate(180deg)`。
面板打开后鼠标已经进了面板，`<a>` 不再 `:hover`，所以再用
`.left-entry-main:has(#bili-elite-home-panel:hover)` 把翻转状态续上 —— 否则鼠标一进
面板箭头就弹回去。

## 顶栏触发面板材质（§7.1 频道面板 / §7.2 右侧浮层）

`homePanelConfig.ts` 是普通 `createNumberParamStore`（blur 0–60 默认 38、
tint 0–100 默认 61，与「搜索面板材质」一致），root class
`bili-elite-homepanel-glass`，变量 `--bili-homepanel-blur` / `-tint`。覆盖两处：

- **§7.1 频道面板**（`#bili-elite-home-panel`）：卡片 `.bili-elite-panel-card` 和内层
  `.bili-header-channel-panel` 各有一层不透明白底，两层都要透明化。
- **§7.2 右侧浮层**：结构是 `.v-popover`（透明定位层，带 transform）>
  `.v-popover-content`（白卡片，圆角 8 / 细描边 / 投影）。backdrop-filter 加在
  `.v-popover-content` 上即可，**外层 transform 不会阻断**（实测：把 tint 拉到 0
  能透过面板看到模糊后的页面内容）。内层直接子元素（`.login-panel-popover` /
  `.right-entry__item-unlogin-panel`）都是纯容器，一并透明化。

## Recipes

### Add a boolean feature toggle
1. Add `{ key, label, default, group }` to `FEATURES` in `src/shared/features.ts`.
   `FeatureKey`/`FeatureConfig`/`DEFAULT_CONFIG` update automatically.
2. Implement `setupXxx()` in a module, gate on `get('<key>')`, subscribe to
   `onConfigChange`, and call it from `index.ts` (top level only if it must run at
   `document_start`, otherwise from `initModules()`).
3. Both the popup and the on-page panel pick it up with zero UI changes. Features
   **without** sliders share one card with the other slider-less features of their group.

### Add a slider-controlled material
1. Create `modules/<name>Config.ts` using `createNumberParamStore(STORAGE_KEY, DEFS)`,
   exporting `...PARAM_DEFS`, `get/set/onChange/bootstrap`.
2. `bootstrap<Name>Config()` in `index.ts`.
3. Add one entry to `PARAM_GROUPS` in `settingsPanel.ts` (`kind`, `defs`, `get`, `set`,
   `onChange`, `feature`, optional `afterChange`). A `kind` with sliders becomes its
   own card automatically; the `kind` prefixes `data-<kind>` / `data-<kind>-val`.
4. Write the values into CSS vars on `documentElement` and consume them in the CSS.
   The `.range-wrap::after` blue fill reads `--p` (set on the input **and** its parent).

### Add a slider that has no owning feature toggle
Follow the 设置面板缩放 pattern: a normal `*Config.ts` store, then in `settingsPanel.ts`
(a) add a constant for the group it belongs to and the `*_PARAM_DEFS[0]` def, (b) push
`rangeRowHtml('<kind>', DEF)` into that group's page inside the page builder, and
(c) wire it by hand — `input` → `setXParam`, plus `onXParamsChange` → apply + resync,
and register both in `cleanups`. Do **not** add it to `PARAM_GROUPS` (that loop assumes
an owning `FeatureKey`).

### Change the settings panel's size / zoom
All in `modules/panel.css`, `.panel`:

| What | Declaration |
| --- | --- |
| base width | `width: min(1000px, calc((100vw - 48px) / var(--z)))` |
| base height | `height: min(660px, calc((100vh - 120px) / var(--z)))` |
| inner padding | `padding: 14px` |
| left nav width | `.nav { flex: 0 0 176px }` |
| left/right gap | `.panel-main { gap: 12px }` |
| column threshold | `.group { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)) }` |
| zoom range | `PANEL_SCALE_PARAM_DEFS` in `panelScaleConfig.ts` (min/max/step) |

Keep the height ≥ ~600 px or the tallest page (高级材质) starts scrolling; keep the
width ≤ ~1070 px or the card grid jumps to 3 columns (right pane = panel width − 216 px).

### Change the search-history area's height / row count
All in `topbar.css` (§9.1). The visible height is the `max-height` on
`.search-panel .history .histories-wrap` (172px = 4 rows); the row height comes from
`.histories .history-item` (34px chip + 6px margin-bottom). If you change either, keep
`.histories { margin-top: 10px; margin-bottom: 0 }` in sync, otherwise an exactly-N-row
history grows a 2px scrollbar. Do **not** re-introduce `overflow: hidden` — overflowing
history has to stay reachable by scrolling.

### Change the manifest
Edit `src/manifest.ts` (and `src/manifest.config.ts` for matches/permissions). The
built `extension/manifest.json` is regenerated by `pnpm build` (`build:prepare`);
never edit `extension/manifest.json` directly.

### Preview a change without building the extension

This is the **only** way to see anything on this box, and it beats a hand-built DOM
fixture: **run the real source**. Compile the module graph with the managed tsc, inject it
into a live bilibili page, and drive it with Playwright.

```js
// C:\Users\<user>\AppData\Local\Temp\<job>.js — run with the managed node.exe
const TS = require('C:/Users/<user>/.workbuddy-ai/binaries/node/workspace/node_modules/typescript')
const { chromium } = require('C:/Users/<user>/.workbuddy-ai/binaries/node/workspace/node_modules/playwright')

const mods = {}, maps = {}
function resolve(spec, fromId) {
  const dir = path.dirname(fromId)
  if (spec.startsWith('~/')) return path.join(ROOT, 'src', spec.slice(2)) + '.ts'
  if (spec.endsWith('?inline')) return path.join(dir, spec.slice(0, -8))
  if (spec.startsWith('.')) return path.join(dir, spec) + '.ts'
}
function load(id) {                       // recursive, entry = settingsPanel.ts etc.
  const src = fs.readFileSync(id, 'utf8').replace(/import\.meta\.env\.DEV/g, 'false')
  mods[id] = TS.transpileModule(src, {    // module: CommonJS, target: ES2020
    compilerOptions: { module: TS.ModuleKind.CommonJS, target: TS.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  maps[id] = {}
  for (const s of mods[id].matchAll(/require\("([^"]+)"\)/g)) {
    maps[id][s[1]] = resolve(s[1], id); load(maps[id][s[1]])
  }
}
```

Serialize `mods` + `maps` into one IIFE that defines `__mods[id] = function(module,
exports, require){…}` and a `load(id)` cache, then `page.evaluate(payload)` and
`page.evaluate(() => window.__setupPanel())`.

Gotchas that cost time:

- **`import.meta.env.DEV`** (in `logger.ts`) breaks CommonJS output — replace it with
  `false` *before* transpiling.
- **`*.css?inline`** modules must export `{ __esModule: true, default: '<css>' }`, or
  `__importDefault` wraps the string and `panelCss` becomes `{}`.
- `new Function(...)` bodies share the **global** scope, so two modules both declaring
  `const config_1` collide — wrap each body in `(function(){ … })()`.
- The extension must **not** be loaded in the browser profile you test with, or every
  listener runs twice.
- `chromium.launch({ channel: 'chrome' })` — the bundled ms-playwright build mismatches.

Then assert on numbers, not vibes:

- panel: `shadowRoot.getElementById('btn').click()` to open, `.nav-item[data-group="…"]`
  to switch pages, `getBoundingClientRect()` on `.panel` for size/centre, `clientHeight`
  vs `scrollHeight` on `.panel-body` for "does this page scroll", and read
  `localStorage` keys (`bili-elite-*`) after a reset to prove every store moved.
- image animation: sample `getComputedStyle(document.querySelector('.pswp__scroll-wrap')).transform`
  every rAF and check the first frame equals the thumbnail rect (see 图片开合动画).
- screenshots: `page.screenshot({ clip })` on the element's rect, `deviceScaleFactor: 3`
  for a readable crop of a 320 px dialog.

Playwright's CSS selectors **pierce open shadow roots**, so `page.click('#close')` works on
the panel directly. Screenshots can only be written to Windows temp (the UNC share is not
writable by Chrome) — view them with `Read`, don't try to `cp` them back into the repo
(there is no `demo/` any more).

### Inspect B站's real DOM / CSS
The header CSS/JS are hashed assets on the homepage. Fetch `https://www.bilibili.com/`,
pull the `<script src>` (e.g. `.../laputa-home/assets/index-<hash>.js`) and the
`<link href>` CSS from the HTML, then grep them:

- selectors/rules → split the CSS on `}` and filter by selector;
- markup and component logic → search the JS (it is a Vue render function; strings
  like `histories-wrap`, `foldVisible`, `isFold` are all present verbatim).

You can also load the live page in the Playwright browser (it reaches the network) and
probe it directly — e.g. to validate a hide rule: `page.goto('https://www.bilibili.com/')`,
then `addStyleTag` + `documentElement.classList.add('bili-elite-home-only')`, then read
`getComputedStyle(el).display` and `getBoundingClientRect()`. This is how the
`.watchlater-pip-button` rule was confirmed (it exists once on the homepage, and is
absent on video/search pages).

Live-page notes: cross-origin `cssRules` are unreadable, so read *computed* styles
instead; B站 is best inspected while logged out (the dropdown falls back to 热搜).

## Conventions

- `@antfu/eslint-config`: single quotes, **no semicolons**, 2-space indent,
  `if (cond)\n  return`, `}\nelse {`, `type` imports sorted last in a group,
  `Number.parseFloat` over `parseFloat`. `noUnusedLocals` is on — don't leave
  unused imports/locals.
- Match the existing module style even where repo lint already fails; **only fix
  lint you introduce**, don't reformat untouched files.
- Comments and UI strings are in **Chinese**; keep that. Each CSS section is numbered
  (`/* ===== 9. 搜索面板… ===== */`) and each module opens with a Chinese doc comment
  explaining *why*, not just what.
- **No snapshot directory any more.** Keep the pre-edit original in the Windows temp job
  dir as `<name>.pre` and `diff` against it before reporting done; never create
  `backups/` again (it grew to 13 MB of noise).
- Prefer minimal, surgical diffs; when asked to change one thing, don't restyle the
  rest.

## Known tech debt / hazards

- **`backdrop-filter` and the "backdrop root" rule — the #1 trap.** A backdrop-filter
  only samples the backdrop *up to the nearest backdrop root*. Any ancestor that
  creates one truncates it: non-identity `transform`, `filter`, `opacity < 1`,
  `contain: paint|layout|strict`, `mix-blend-mode`, a `will-change` of those, or
  another `backdrop-filter`. Symptom: a blur slider "does nothing". Never add those
  properties to an ancestor of a glass element. In this repo the topbar blur lives on
  `.bili-header__bar::before`, and the search container is centred with
  `inset: 0 + height: 40px + margin: auto + transform: none`. A quick diagnostic,
  walking up from the glass element:

  ```js
  let el = panel, bad = []
  while (el && el !== document.documentElement) {
    const c = getComputedStyle(el)
    const hit = [c.transform !== 'none' && 'transform', c.filter !== 'none' && 'filter',
      Number(c.opacity) < 1 && 'opacity', c.contain !== 'none' && 'contain',
      c.mixBlendMode !== 'normal' && 'mix-blend-mode'].filter(Boolean)
    if (hit.length) bad.push({ cls: String(el.className).slice(0, 40), hit })
    el = el.parentElement
  }
  ```

  Note the settings panel is itself `transform: scale(var(--z))` — that is fine, because
  the transform is on the element that *has* the `backdrop-filter`; only ancestors
  matter. Keep `#bili-elite-settings-host` free of transform/filter/opacity.
- **`SCALE_GROUP = '界面优化'` / `PERSONAL_GROUP = '个性设置'` are hard-coded group names**
  in `settingsPanel.ts`. Renaming either group in `features.ts` silently drops that page's
  extra content (no error — the zoom slider / 设置管理 + 开发版本卡片 just disappear).
- **原生浮动按钮的类名四家各不相同、且没有语义**（`.to-top-btn` / `.btn-to-top-wrap` /
  `.back-to-top-wrap` / `.bili-dyn-sidebar__btn`）。B 站改版时它们会静默失效 —— 不报错，
  只是原生按钮又冒出来。排查「右下角出现两个返回顶部」时先数一遍 `topbar.css` §17 的
  选择器是否还命中。
- **「刷新」依赖 B 站的内层节点** `.flexible-roll-btn.refresh .flexible-roll-btn-inner`。
  结构一变就退回整页 `location.reload()`：功能不丢，只是从「重取推荐流」变成「重载整页」。
- **`#bili-elite-topbar-skeleton` is a child of `<html>`, not of `<body>`**
  (`ensureSkeleton()` does `document.documentElement.appendChild`). Any rule that hides it must
  therefore be rooted at `html`, e.g. `html.bili-elite-home-opt:has(.left-entry__item) …` —
  writing `body:has(…) #bili-elite-topbar-skeleton` silently **never matches**, and the
  64 px white bar then sits on top of everything (it is `z-index: 1002`). This was a live bug:
  in 网页全屏 the bar stayed visible above the video as a "顶栏残留". Same trap for
  `#bili-elite-logo`'s sibling — always check where the script actually appends the node.
- **网页全屏 = `body.webscreen-fix`**（主站）/ `body.player-full-win`（直播站）— 都是 B站
  自己的类。§13 在 `html.bili-elite-home-opt:has(body.webscreen-fix)`（外加 `:fullscreen` 给原生
  全屏）下隐藏我们那几层固定顶栏，否则它们会盖在视频上。直播站「全屏」加的是
  `body.fullscreen-fix`，别跟网页全屏混了。
- **直播站退出全屏时布局晚几帧才恢复**，`fullscreenchange` 同步量到的 `#fullscreen-container`
  rect 不是最终位置（实测 `[0,578,1028,900]` → 下一帧 `[50,126,1028,578]`）。退出动画的目标
  取 `lastNonFsRect`（进全屏前的快照），见 "Fullscreen animations"。
- **改顶栏前先看 `isTopbarOptExcluded()`**：`space.bilibili.com` / `www.bilibili.com/history`
  / `live.bilibili.com` 上整套顶栏改造不生效（不注入样式、不挂根类），所以 `topbar.css` 的
  改动在这三类页面上完全看不出来 —— 别拿它们验证顶栏。
- **`--bili-panel-scale` must stay a unitless number.** It is used as the divisor in
  `calc((100vw - 48px) / var(--z))`; a non-number makes the whole declaration
  invalid-at-computed-value-time and the panel loses its width/height.
- **`.overlay` must default to `pointer-events: none`.** It is permanently in the shadow
  DOM; if it ever sticks at `auto` the entire page becomes unclickable.
- `modules/homePanelData.ts` is a **26 KB base64 gzip blob** of the homepage
  dropdown HTML with **no generator script** in `scripts/` — treat as opaque.
- **`#bili-elite-home-panel` must not go back to `display: none ↔ block`.** `display` is not
  transitionable, which is why the panel used to pop open with no animation. It now uses
  `visibility` + `opacity` + `translateY(-6px)` (160 ms fade, 200 ms spring). Two rules to
  keep: the hidden state needs `pointer-events: none` (the absolutely-positioned panel still
  occupies its box and would otherwise eat clicks on the channel bar underneath), and the
  hide transition must delay `visibility` by the fade duration (`visibility 0s linear .16s`),
  otherwise the element disappears on frame 1 and the fade never shows.
- **`PAGE_LEVEL_SELECTOR` (6 levels below `body`) is a depth bound, not a promise.**
  `foreignTopbarReady()` and `ensureUnderTopbar()` both rely on it. A page-level topbar or
  sticky sub-bar nested deeper than 6 will be missed — add its selector to §1.2 / §15 rather
  than deepening the scan (a full-document `getComputedStyle` sweep is too expensive to run
  from `sync()`, which fires on a 200 ms debounce while scrolling).
- `src/contentScripts/styles.css` is **dead**: it is emitted and exposed via
  `web_accessible_resources`, but no code ever adds `body.my-bili-fullscreen`, so its
  rules never match.
- `IMAGE_DUR_CLOSE = 290` is duplicated in `imageViewer.ts` and `imageStyle.ts`
  (`imageGlass.ts` imports it from `imageViewer.ts`).
- `settingsPanel.ts` uses a `window.__biliEliteSettingsInjected__` singleton guard.
- **Two whole-document `MutationObserver`s** run (`topbarOptimize` + `searchPanelOpt`).
  Keep DOM work cheap and debounced, and always add a cheap early-out before
  `querySelector` (e.g. `if (!panel || !panel.isConnected) collect()`).
- **`:has()` cannot be nested inside `:has()`** — not even through `:not()`. Chrome treats
  e.g. `.feed-card:has(> .bili-feed-card:not(:has(*)))` as an invalid selector, and because
  an invalid selector invalidates the **whole rule** (not just that one selector in the
  list), the entire declaration block is silently dropped. Use `:empty` instead, and always
  sanity-check a new selector with `document.querySelectorAll(sel)` (it throws on invalid
  input) before trusting it. **`:not(:has(...))` is fine** — that is what 卡片确认 uses to
  skip placeholder cells.
- **「稍后再看」 has two buttons and two class names, one of them easy to get wrong:**
  the cover button is `.bili-watch-later--wrap` (**double** hyphen; `.bili-watch-later-wrap`
  is a stale name), the corner-palette one is `.watchlater-pip-button`. Hiding the inner
  `.bili-watch-later` is not enough — B站 toggles *its* inline `display` on hover.
- CSS that must beat B站 needs matching specificity: B站's own rules carry an id
  (`#nav-searchform`) plus ~4 classes, and the material blocks in `topbar.css` add
  `!important`. When overriding one of our own `!important` material rules, match (or
  exceed) its specificity **and** use `!important`; a later rule only wins on ties.
- The content bundle is an IIFE: **no dynamic import / code splitting** is possible in
  the content entry. Perceived-load issues (e.g. slow topbar on video pages) are solved
  in-page (skeleton bar, immediate sync), not by splitting the bundle.
- **新增一个数值参数 store 时，必须同时加进 `restoreDefaults()`**（`settingsPanel.ts`）。
  它是一张手写清单：`persist({ ...DEFAULT_CONFIG })` + 每个 `resetXxxParams()` +
  `applyPanelParams/applyPanelScale/syncUI/syncScale`。漏一个的后果是「恢复默认设置」
  对它无效，而且**没有任何报错**。`PARAM_GROUPS` 里的组不会自动被 reset —— 别以为加了
  `ParamGroup` 就完事了。
- `src/components/Logo.vue` / `SharedSubtitle.vue` 是 vitesse 模板遗留，1.0.0 清理后
  **已无任何引用**（`src/components.d.ts` 里还挂着声明，那是 unplugin 自动生成的，
  带 `@ts-nocheck`，不影响 typecheck）。留着是因为 `vite.config.mts` 的
  `Components({ dirs: ['src/components'] })` 指向这个目录；真要删就整个目录 + 那个
  plugin 一起删。

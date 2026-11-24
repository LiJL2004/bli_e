import fs from 'fs-extra'
import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import { isDev, port, r } from '../scripts/utils'
import { HOST_PERMISSIONS, SITES } from './manifest.config'

export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

  // 登录 / 手机版等页面没有全局顶栏，骨架栏与 logo 会「凭空」出现，排除掉
  const EXCLUDE = [
    '*://passport.bilibili.com/*',
    '*://account.bilibili.com/*',
    '*://m.bilibili.com/*',
  ]

  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    // 声明默认语言后，商店会按包内 _locales 识别语言；否则只会被当成「英语(美国)」，
    // 中文清单在 Partner Center 里连加都加不了（下拉是灰的）。
    default_locale: 'zh_CN',
    name: '__MSG_extensionName__',
    version: pkg.version,
    description: '__MSG_extensionDescription__',
    action: {
      default_icon: {
        16: 'assets/icon-16.png',
        32: 'assets/icon-48.png',
        48: 'assets/icon-48.png',
      },
      // 刻意不设 default_popup：设置面板已经做在页面里（右下角 ⚙），再挂一个工具栏弹窗
      // 就是两套 UI 要同步维护。不设 popup 时点图标走浏览器自己的扩展菜单
      // （Edge 会直接列出「网站访问权限 / 管理扩展」等默认项）。
    },
    options_ui: {
      page: 'dist/options/index.html',
      open_in_tab: true,
    },
    background: {
      service_worker: 'dist/background/index.mjs',
    },
    // 图标：assets/icon-16 / 48 / 128 三档，均为手放文件，pnpm clear 不会删。
    // 想用分尺寸图标就放 assets/icon-16/32/48/128.png 再把这里改成对应路径，
    // 注意文件必须真实存在，否则 Chrome 加载时会报 "Could not load icon"。
    icons: {
      16: 'assets/icon-16.png',
      48: 'assets/icon-48.png',
      128: 'assets/icon-128.png',
    },
    // 只保留真正用到的权限：storage 存设置。activeTab 已移除（代码里没有读当前标签页，
    // 商店明确写着「请求不必要的权限会导致此版本被拒绝」）。
    permissions: ['storage'],
    host_permissions: HOST_PERMISSIONS,
    content_scripts: [
      {
        // 页面世界的「请求闸门」：掐掉 B 站的埋点上报与广告投放请求（见 extension/guard.js
        // 顶部那一大段注释）。**必须是 `world: 'MAIN'`**：
        //   · 隔离世界（内容脚本）改 `navigator.sendBeacon` / `fetch` / `XHR` 对页面无效；
        //   · 往页面里塞 inline `<script>` 会被**扩展自己的 CSP**（`script-src 'self'`）挡掉，
        //     实测控制台报 "Executing inline script violates the following Content Security
        //     Policy directive"，补丁一次都没装上（1.2.0 v003 踩过）。
        // `guard.js` 是手写在 `extension/` 里的，不走构建：`pnpm clear` 只删 `dist` 与
        // `manifest.json`，不会碰它；`pack-edge.mjs` 整个 `extension/` 一起打包，会带走。
        matches: SITES.bilibili,
        exclude_matches: EXCLUDE,
        js: ['guard.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        matches: SITES.bilibili,
        exclude_matches: EXCLUDE,
        js: ['dist/contentScripts/index.global.js'],
        run_at: 'document_start',
        // 播放页在「动态悬浮窗」里是**跨源 iframe**（t.bilibili.com 嵌 www.bilibili.com），
        // 父页面读不到它的文档 —— 去掉右栏推荐、按我们版本排版只能由 iframe 里的自己来做。
        // 只有 index.ts 认出 `blie_embed=1` 的那一帧才会干活，B 站自己的 iframe
        // （广告 / 登录框 / 播放器）一个模块都不装，见 index.ts 顶部的 IS_TOP / IS_EMBED。
        all_frames: true,
      },
    ],
    // 只暴露两张吉祥物图（奶睿设置键 / 顶栏 logo 用 CSS 引用它们）。
    // 匹配范围收窄到 B 站：写 `<all_urls>` 的话任何网站都能探测到这个资源、
    // 从而判断「用户装了本扩展」，商店审核也会问为什么需要全站暴露。
    web_accessible_resources: [
      {
        resources: ['assets/panel-mascot.png', 'assets/logo-mascot.png'],
        matches: SITES.bilibili,
      },
    ],
    content_security_policy: {
      extension_pages: isDev
        ? `script-src 'self' http://localhost:${port}; object-src 'self'`
        : 'script-src \'self\'; object-src \'self\'',
    },
  }

  return manifest
}

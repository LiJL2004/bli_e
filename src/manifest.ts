import fs from 'fs-extra'
import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import { isDev, port, r } from '../scripts/utils'
import { HOST_PERMISSIONS, SITES } from './manifest.config'

export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

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
      default_popup: 'dist/popup/index.html',
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
        matches: SITES.bilibili,
        // 登录 / 手机版等页面没有全局顶栏，骨架栏与 logo 会「凭空」出现，排除掉
        exclude_matches: [
          '*://passport.bilibili.com/*',
          '*://account.bilibili.com/*',
          '*://m.bilibili.com/*',
        ],
        js: ['dist/contentScripts/index.global.js'],
        run_at: 'document_start',
      },
    ],
    web_accessible_resources: [
      {
        resources: ['dist/contentScripts/style.css'],
        matches: ['<all_urls>'],
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

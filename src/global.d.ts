declare const __DEV__: boolean
/** Extension name, defined in packageJson.name */
declare const __NAME__: string

/**
 * 最小化的 chrome.* 类型声明。
 *
 * 内容脚本 / popup 直接使用 chrome.storage.sync（见 config.ts、Popup.vue），
 * 但项目未安装 @types/chrome，导致 `pnpm typecheck` 一直报
 * 「Cannot find name 'chrome'」。这里只声明实际用到的字段，
 * 避免为几个属性引入整个 @types/chrome。
 */
interface ChromeStorageArea {
  get: (keys: unknown, callback: (items: any) => void) => void
  set: (items: Record<string, unknown>, callback?: () => void) => void
}
interface ChromeStorageOnChanged {
  addListener: (callback: (changes: any, areaName: string) => void) => void
}
declare const chrome: {
  runtime: {
    lastError?: { message?: string }
    /** 扩展页（options / popup）里用来显示版本号 */
    getManifest?: () => { version?: string }
    /** 把包内资源（如 assets/icon-512.png）解析成可用的扩展 URL */
    getURL?: (path: string) => string
  }
  storage: {
    sync: ChromeStorageArea
    onChanged: ChromeStorageOnChanged
  }
}

declare module '*.vue' {
  const component: any
  export default component
}

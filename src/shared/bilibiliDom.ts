/**
 * B 站 DOM 上那几个「两站不一致」的约定，统一放这里。
 *
 * 网页全屏时 B 站给 `<body>` 加类：主站 `webscreen-fix`、直播站 `player-full-win`。
 * 这套判定原来在 playerMode / videoFullscreen / videoLayer 三个文件里各抄了一份，
 * 靠注释「三处必须一致」维持 —— 漏改一处的表现是「一个模块认得出全屏、另一个不认」，
 * 而这种 bug 只在直播站出现，很难在开发时发现。现在只有一个来源。
 */

export const WEB_FS_CLASSES = ['webscreen-fix', 'player-full-win'] as const

/** 当前页面是否处于 B 站的「网页全屏」（原生全屏不算，那条看 fullscreenElement） */
export function hasWebFullscreenClass(body: HTMLElement | null = document.body): boolean {
  if (!body) return false
  return WEB_FS_CLASSES.some(cls => body.classList.contains(cls))
}

#!/usr/bin/env node
/**
 * 打包**完整工程源码** → `bili-elite-<version>-source.zip`。
 *
 * 和 `pack-edge.mjs` 的区别（两个包用途完全不同，别混）：
 * - `pack-edge.mjs` → `bili-elite-<version>.zip`：只有 `extension/` 里的运行时产物
 *   （manifest + dist + 图标 + _locales），**manifest.json 必须在 zip 根目录**，
 *   给商店送审 / 直接加载用。里面没有一行源码，解压不能接着开发。
 * - 这个脚本 → `bili-elite-<version>-source.zip`：`src/`、构建配置、lockfile、脚本、
 *   设计参考稿、更新日志全都在，解压 `pnpm install && pnpm build` 就能继续改。
 *   所有文件套在一层 `bili-elite-<version>/` 里，解压不会把一堆文件撒在当前目录。
 *
 * 用白名单而不是「复制整个仓库再排除」：仓库根上堆着历次发版的 zip、`key.pem`
 * （签名私钥）、`.workbuddy-ai/`（AI 工作日志）、`.opencode/`（内部笔记）、
 * `node_modules/` 与一堆 `.tmpold*` 编辑残留。白名单漏掉一个就是「悄悄没进包」，
 * 黑名单漏掉一个就是「把私钥发出去了」—— 这里选前者。
 *
 * 用法：`node scripts/pack-source.mjs [输出路径]`（默认 `./bili-elite-<version>-source.zip`）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, writeZip } from './zip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const OUT = process.argv[2] || path.join(ROOT, `bili-elite-${pkg.version}-source.zip`)
const PREFIX = `bili-elite-${pkg.version}`

/** 整个目录收进来（`extension/assets` 这种两级路径也走这里） */
const INCLUDE_DIRS = [
  'src',
  'scripts',
  'design',
  'CHANGELOG',
  'RELEASE',
  'extension/assets',
  'extension/_locales',
]

/** 根目录上的单个文件 */
const INCLUDE_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.mts',
  'vite.config.background.mts',
  'vite.config.content.mts',
  'unocss.config.ts',
  'eslint.config.mjs',
  'modules.d.ts',
  'shim.d.ts',
  '.gitignore',
  'README.md',
  'DEVELOPMENT.md',
  'LICENSE',
]

/** 自动生成的类型声明：构建时由 unplugin-auto-import 产出，不该进源码包 */
const EXCLUDE_REL = new Set([
  'src/auto-imports.d.ts',
  'src/components.d.ts',
])

const HOWTO = `# 解压说明

这是 **${pkg.name} v${pkg.version} 的完整工程源码**，不是可以直接装进浏览器的扩展包。

## 想直接用

同目录下的 \`bili-elite-${pkg.version}.zip\` 是打包好的扩展：解压后打开
\`chrome://extensions\`（Edge 用 \`edge://extensions\`）→ 打开「开发者模式」→
「加载已解压的扩展程序」→ 选解压出来的那个文件夹。

## 想继续开发

\`\`\`bash
pnpm install
pnpm build      # 产物写进 extension/
\`\`\`

然后把 \`extension/\` 目录（**不是** \`extension/dist\`）加载为已解压的扩展。
改完代码重新 \`pnpm build\`，再在扩展页点一次「刷新」。

- \`pnpm dev\` —— watch 构建
- \`pnpm typecheck\` —— 类型检查
- \`pnpm lint\` —— ESLint

## 包里有什么

| 路径 | 说明 |
| --- | --- |
| \`src/\` | 全部源码（content script / 样式 / 设置面板 / 后台脚本） |
| \`scripts/\` | 构建期脚本：\`manifest.ts\`（生成 manifest）、\`prepare.ts\`、打包脚本 |
| \`extension/assets/\`、\`extension/_locales/\` | 图标与 i18n 文案（构建时复制进 \`extension/\`） |
| \`design/\` | 设计参考稿截图 |
| \`CHANGELOG/\` | 逐版本更新日志，含每个改动的取舍原因 |
| \`DEVELOPMENT.md\` | 开发说明（构建、图标替换、目录结构） |
| \`README.md\` | 面向用户的功能总览 |

**没有**包含：\`node_modules/\`、构建产物 \`extension/dist/\` 与 \`extension/manifest.json\`
（\`pnpm build\` 会生成）、发版 zip、签名私钥 \`key.pem\`。

## 打包

\`\`\`bash
node scripts/pack-edge.mjs     # 商店 / 加载用的 extension 包
node scripts/pack-source.mjs   # 就是你现在这个源码包
\`\`\`
`

const files = []
const seen = new Set()

function add(rel, full) {
  if (seen.has(rel) || EXCLUDE_REL.has(rel))
    return
  seen.add(rel)
  files.push({ rel: `${PREFIX}/${rel}`, full })
}

for (const dir of INCLUDE_DIRS) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) {
    console.warn(`  ! 跳过不存在的目录：${dir}`)
    continue
  }
  for (const f of walk(abs, dir))
    add(f.rel, f.full)
}

for (const file of INCLUDE_FILES) {
  const abs = path.join(ROOT, file)
  if (!fs.existsSync(abs)) {
    console.warn(`  ! 跳过不存在的文件：${file}`)
    continue
  }
  add(file, abs)
}

// 说明文件只存在于 zip 里，不落盘到仓库根（免得和真正的 README 混在一起）
files.push({ rel: `${PREFIX}/解压说明.md`, data: HOWTO })

// 兜底：万一哪天白名单里混进了不该带的东西，这里直接拦下来
const BANNED = /(^|\/)(node_modules|\.git|\.workbuddy-ai|\.opencode)\/|\.pem$|\.zip$|\.crx$|\.xpi$/
const bad = files.filter(f => BANNED.test(f.rel))
if (bad.length)
  throw new Error(`包里混进了不该带的文件：\n${bad.map(f => f.rel).join('\n')}`)

if (!files.some(f => f.rel === `${PREFIX}/package.json`))
  throw new Error('package.json 没进包 —— 白名单配错了')

const { bytes, count } = writeZip(OUT, files)
const byDir = {}
for (const f of files) {
  const rel = f.rel.slice(PREFIX.length + 1)
  const top = rel.includes('/') ? rel.split('/')[0] : '(根目录)'
  byDir[top] = (byDir[top] || 0) + 1
}

console.log(`✓ ${path.relative(ROOT, OUT)}  ${(bytes / 1024).toFixed(0)} KB  ${count} 个文件`)
console.log(`  版本 ${pkg.version} · 解压出 ${PREFIX}/ 一个目录`)
for (const [dir, n] of Object.entries(byDir).sort((a, b) => b[1] - a[1]))
  console.log(`  - ${dir}/  ${n}`)

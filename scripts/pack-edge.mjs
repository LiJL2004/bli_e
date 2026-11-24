#!/usr/bin/env node
/**
 * 打包 `extension/` → `bili-elite-<version>.zip`（Edge / Chrome 商店送审用）。
 *
 * 为什么不用 `pnpm pack:zip`：那条命令走 `jszip-cli add extension/*`，条目路径是否带
 * `extension/` 前缀取决于 CLI 版本，商店要求 **manifest.json 在 zip 根目录**，赌不起。
 * 这里自己写 zip（字节格式在 `zip.mjs`），并且：
 * - 条目全部用相对 `extension/` 的路径（`manifest.json` 就在根上）；
 * - 时间戳固定，同样的产物重复打包字节一致，方便比对；
 * - 自动跳过 `.tmpold*` / `.new*` 编辑残留 —— 这台机器改文件只能「改名 + 重建」，
 *   `extension/` 里常年躺着十几份 `manifest.json.tmpold1234567890`，带上会被商店判无关文件；
 * - 打完把条目清单和大小打出来，一眼能看出有没有多带文件。
 *
 * 这个包**只有运行时产物**（manifest + dist + 图标 + _locales），没有一行源码。
 * 要能接着开发的完整工程，用 `pack-source.mjs`。
 *
 * 用法：`node scripts/pack-edge.mjs [输出路径]`（默认 `./bili-elite-<version>.zip`）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk, writeZip } from './zip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'extension')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const OUT = process.argv[2] || path.join(ROOT, `bili-elite-${pkg.version}.zip`)

const files = walk(SRC)
if (!files.some(f => f.rel === 'manifest.json'))
  throw new Error(`extension/manifest.json 不存在 —— 先跑 pnpm build`)

const { bytes, count } = writeZip(OUT, files)

console.log(`✓ ${path.relative(ROOT, OUT)}  ${(bytes / 1024).toFixed(0)} KB  ${count} 个文件`)
console.log(`  版本 ${pkg.version} · manifest 在根目录 · 条目：`)
for (const f of files)
  console.log(`  - ${f.rel}`)

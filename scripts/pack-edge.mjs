#!/usr/bin/env node
/**
 * 打包 `extension/` → `bili-elite-<version>.zip`（Edge / Chrome 商店送审用）。
 *
 * 为什么不用 `pnpm pack:zip`：那条命令走 `jszip-cli add extension/*`，条目路径是否带
 * `extension/` 前缀取决于 CLI 版本，商店要求 **manifest.json 在 zip 根目录**，赌不起。
 * 这里自己写 zip（Node 自带 zlib，零依赖），并且：
 * - 条目全部用相对 `extension/` 的路径（`manifest.json` 就在根上）；
 * - 时间戳固定，同样的产物重复打包字节一致，方便比对；
 * - 打完把条目清单和大小打出来，一眼能看出有没有多带文件。
 *
 * 用法：`node scripts/pack-edge.mjs [输出路径]`（默认 `./bili-elite-<version>.zip`）
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'extension')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const OUT = process.argv[2] || path.join(ROOT, `bili-elite-${pkg.version}.zip`)

/** 固定时间戳（2026-10-17 00:00），让打包结果可复现 */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 17

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++)
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function walk(dir, base = '') {
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (fs.statSync(full).isDirectory())
      out.push(...walk(full, rel))
    else
      out.push({ full, rel })
  }
  return out
}

const files = walk(SRC)
if (!files.some(f => f.rel === 'manifest.json'))
  throw new Error(`extension/manifest.json 不存在 —— 先跑 pnpm build`)

const chunks = []
const central = []
let offset = 0

for (const f of files) {
  const raw = fs.readFileSync(f.full)
  const deflated = zlib.deflateRawSync(raw, { level: 9 })
  // 压缩后反而更大时按 store 存（小图标偶尔会这样）
  const stored = deflated.length >= raw.length
  const body = stored ? raw : deflated
  const method = stored ? 0 : 8
  const crc = crc32(raw)
  const name = Buffer.from(f.rel, 'utf8')

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034B50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)

  chunks.push(local, name, body)

  const dir = Buffer.alloc(46)
  dir.writeUInt32LE(0x02014B50, 0)
  dir.writeUInt16LE(20, 4)
  dir.writeUInt16LE(20, 6)
  dir.writeUInt16LE(0x0800, 8)
  dir.writeUInt16LE(method, 10)
  dir.writeUInt16LE(DOS_TIME, 12)
  dir.writeUInt16LE(DOS_DATE, 14)
  dir.writeUInt32LE(crc, 16)
  dir.writeUInt32LE(body.length, 20)
  dir.writeUInt32LE(raw.length, 24)
  dir.writeUInt16LE(name.length, 28)
  dir.writeUInt16LE(0, 30) // extra
  dir.writeUInt16LE(0, 32) // comment
  dir.writeUInt16LE(0, 34) // disk
  dir.writeUInt16LE(0, 36) // internal attrs
  dir.writeUInt32LE(0, 38) // external attrs
  dir.writeUInt32LE(offset, 42)
  central.push(dir, name)

  offset += local.length + name.length + body.length
}

const centralSize = central.reduce((n, b) => n + b.length, 0)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054B50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(files.length, 8)
eocd.writeUInt16LE(files.length, 10)
eocd.writeUInt32LE(centralSize, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

const zip = Buffer.concat([...chunks, ...central, eocd])
fs.writeFileSync(OUT, zip)

console.log(`✓ ${path.relative(ROOT, OUT)}  ${(zip.length / 1024).toFixed(0)} KB  ${files.length} 个文件`)
console.log(`  版本 ${pkg.version} · manifest 在根目录 · 条目：`)
for (const f of files)
  console.log(`  - ${f.rel}`)

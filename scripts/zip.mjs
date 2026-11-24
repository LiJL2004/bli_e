#!/usr/bin/env node
/**
 * 极简 zip 写入器（Node 自带 zlib，零依赖）。
 *
 * 抽出来是因为现在有两个打包脚本要用它：`pack-edge.mjs`（商店送审用的 extension 包）
 * 和 `pack-source.mjs`（完整工程源码包）。两边的字节格式必须一致 —— 商店要求
 * **manifest.json 在 zip 根目录**，条目路径不能带 `extension/` 前缀，所以这里只负责
 * 「给定 rel 路径列表 → 写一个 zip」，前缀由调用方自己决定。
 *
 * 另外两点和 `jszip-cli` 不同的地方：
 * - 时间戳固定，同样的内容重复打包字节一致，方便比对产物有没有变；
 * - 压缩后反而更大时按 store（不压缩）存 —— 小图标和 png 经常这样。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** 固定时间戳（2026-10-17 00:00），让打包结果可复现 */
export const DOS_TIME = 0
export const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 17

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

export function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * 编辑残留：UNC 路径上改文件只能「改名 + 重建」，偶尔会留下 `.tmpold1234` / `.new567`。
 * 这些绝不能进包 —— 商店包会被判「包含无关文件」，源码包也会白胖一圈。
 */
export function isJunk(name) {
  return name === '.DS_Store' || /\.(tmpold|new)\d+$/.test(name) || name.endsWith('.tmpold')
}

/**
 * 递归收集目录下的文件，返回 `{ full, rel }`（rel 用 `/` 分隔、相对 base 目录）。
 * `skipDir` 收目录名，用来整棵剪掉（`node_modules` 之类）。
 */
export function walk(dir, base = '', { skipDir } = {}) {
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    if (isJunk(name))
      continue
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (fs.statSync(full).isDirectory()) {
      if (skipDir && skipDir(name))
        continue
      out.push(...walk(full, rel, { skipDir }))
    }
    else {
      out.push({ full, rel })
    }
  }
  return out
}

/**
 * 写 zip。`files` 里每一项要么是 `{ full, rel }`（从磁盘读），
 * 要么是 `{ rel, data: Buffer | string }`（内容直接在内存里，比如生成的说明文件）。
 *
 * @param {string} outPath 输出路径
 * @param {{ full?: string, rel: string, data?: Buffer | string }[]} files
 * @returns {{ bytes: number, count: number, entries: string[] }}
 */
export function writeZip(outPath, files) {
  const chunks = []
  const central = []
  let offset = 0

  for (const f of files) {
    const raw = f.data !== undefined
      ? (Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'))
      : fs.readFileSync(f.full)
    const deflated = zlib.deflateRawSync(raw, { level: 9 })
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
  // UNC 路径上覆盖已存在的文件会 EPERM（和仓库里改文件是同一个限制），
  // 所以先把它改名让开，再写新的。旧包留成 .tmpold* 也不会被下次打包收进去。
  if (fs.existsSync(outPath))
    fs.renameSync(outPath, `${outPath}.tmpold${Date.now()}`)
  fs.writeFileSync(outPath, zip)
  return { bytes: zip.length, count: files.length, entries: files.map(f => f.rel) }
}

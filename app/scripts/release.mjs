#!/usr/bin/env node
/**
 * 发布一个新版本（供应用内更新用）
 *
 * 做什么：
 *   1. 构建前端（npm run build）
 *   2. 把 dist 的内容打成 zip —— **内容直接放 zip 根**，不能套一层 dist/，
 *      否则插件解出来的目录结构不对，应用会白屏
 *   3. 算 zip 的 sha256（插件下载后校验这个）
 *   4. 写 latest.json（版本号 + zip 地址 + 校验值）
 *
 * 产物都在 app/release/ 下，**这个目录不进 git**。
 *
 * 用完要做的（手动，就两步）：
 *   把 release/ 里的 zip 和 latest.json 传到 Supabase Storage 的桶里，
 *   latest.json 覆盖旧的 → 手机上点「检查更新」就能拿到新版。
 *
 * 版本号用时间戳（YYYYMMDD-HHmm），每次发布天然是新的，不用手动维护。
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const distDir = join(appRoot, 'dist')
const outDir = join(appRoot, 'release')

/** 极简 .env 解析（够用就行，不引 dotenv） */
function readEnv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    if (line.trim().startsWith('#')) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const pad = (n) => String(n).padStart(2, '0')

console.log('▸ 构建前端…')
execSync('npm run build', { cwd: appRoot, stdio: 'inherit' })

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('✗ dist/ 里没有 index.html —— 构建没成功，先看上面的输出')
  process.exit(1)
}

const now = new Date()
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}`

// zip 内容直接放在根目录（addLocalFolder 的行为就是"把这个目录的内容铺进去"）
const zip = new AdmZip()
zip.addLocalFolder(distDir)
const zipName = `dist-${version}.zip`
mkdirSync(outDir, { recursive: true })
const zipPath = join(outDir, zipName)
zip.writeZip(zipPath)

// 只留最新一版：旧的 dist-*.zip 一并清掉（latest.json 只有一个，直接覆盖）。
//
// 文件名**必须带版本号**，不能图省事改成固定的 dist.zip —— zip 的 URL 一旦固定，
// Cloudflare 就会缓存它，用户可能下到旧代码（latest.json 那边是靠 ?t= 时间戳绕的，
// 但 zip 是给插件直接下的，不好这么干）。所以是"带版本号 + 清旧的"，不是"固定名"。
//
// 删不掉也不该挡住发布（本机的安全删除垫片可能拦），失败只警告。
const stale = readdirSync(outDir).filter(
  (f) => f.startsWith('dist-') && f.endsWith('.zip') && f !== zipName
)
for (const f of stale) {
  try {
    unlinkSync(join(outDir, f))
  } catch {
    console.warn(`  ⚠ 旧包没删掉（大概被安全删除垫片拦了）：${f}`)
  }
}

const zipBuf = readFileSync(zipPath)
const checksum = createHash('sha256').update(zipBuf).digest('hex')
const sizeMb = (zipBuf.length / 1024 / 1024).toFixed(2)

const env = readEnv(join(appRoot, '.env.local'))
const base = (env.VITE_UPDATE_BASE ?? '').replace(/\/+$/, '')

const latest = {
  version,
  url: base ? `${base}/${zipName}` : `【把 ${zipName} 传进桶后，这里填它的公开地址】`,
  checksum,
  builtAt: now.toISOString(),
}
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n')

console.log('')
console.log(`✓ 版本 ${version}`)
console.log(`  release/${zipName}   ${sizeMb} MB`)
console.log(`  release/latest.json`)
console.log(`  sha256 ${checksum.slice(0, 16)}…`)
if (stale.length) {
  console.log(`  （已清掉 ${stale.length} 个旧包，release/ 里只留最新一份）`)
}
console.log('')
if (!base) {
  console.log('⚠ app/.env.local 里没配 VITE_UPDATE_BASE —— latest.json 里的 url 是个占位符，')
  console.log('  传之前先补上，否则手机上点更新会拿到一个无效地址。')
  console.log('')
}
console.log('接着做：把 release/ 里的两个文件传到 Supabase Storage 的桶，latest.json 覆盖旧的。')

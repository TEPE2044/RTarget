/**
 * 应用图标 / 启动图生成脚本
 *
 * 用法：
 *   node scripts/gen-icons.mjs          # 生成 assets/*.png
 *   npx @capacitor/assets generate --android   # 再分发到原生工程
 *
 * 为什么用脚本而不是丢几张图进去：图标是一组有几何约束的东西
 * （自适应图标的前景必须落在 108dp 里的 66dp 安全区，否则会被系统裁掉），
 * 写成代码才能保证改一处、全部尺寸都跟着对。
 *
 * 想改样式，只要动下面这几个常量。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(appDir, 'assets')

// ---------- 样式常量 ----------

const BG = '#0C447C' // 底色：app 蓝色系里较深的一档，够沉，桌面上一眼能认出来
const RING = '#FFFFFF' // 外环
const CORE = '#EF9F27' // 中心：活力值配色里的琥珀色
const SPLASH_LIGHT = '#F5F5F5'
const SPLASH_DARK = '#141414'

// 图标本体画在 108×108 的坐标系里，中心 (54,54)
const MARK_BOX = 108
const RING_R = 30
const RING_W = 9
const CORE_R = 12

// Android 自适应图标：108dp 画布，只有中间 66dp 保证可见（圆形遮罩最多切到 72dp）
const SAFE_RATIO = 66 / 108

// ---------- 画图 ----------

/** 把图标本体放到 (cx,cy)，外径 scale 到 d */
function mark(cx, cy, d) {
  const s = d / MARK_BOX
  return `<g transform="translate(${cx} ${cy}) scale(${s}) translate(-54 -54)">
    <circle cx="54" cy="54" r="${RING_R}" fill="none" stroke="${RING}" stroke-width="${RING_W}"/>
    <circle cx="54" cy="54" r="${CORE_R}" fill="${CORE}"/>
  </g>`
}

/** 带圆角底色的整块图标（启动图用，这样放在浅底深底上都成立） */
function badge(cx, cy, size) {
  const half = size / 2
  return `<g>
    <rect x="${cx - half}" y="${cy - half}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${BG}"/>
    ${mark(cx, cy, size * 0.62)}
  </g>`
}

function canvas(size, layers) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${layers}</svg>`
}

// ---------- 输出清单（@capacitor/assets 认这几张） ----------

const targets = [
  {
    file: 'icon-only.png',
    note: '传统图标（系统不做遮罩时用），本体留够余量',
    svg: canvas(1024, `<rect width="1024" height="1024" fill="${BG}"/>${mark(512, 512, 1024 * 0.62)}`),
  },
  {
    file: 'icon-foreground.png',
    note: '自适应图标前景：只有标记，透明底，必须落在安全区内',
    svg: canvas(1024, mark(512, 512, 1024 * SAFE_RATIO)),
  },
  {
    file: 'icon-background.png',
    note: '自适应图标背景：纯色',
    svg: canvas(1024, `<rect width="1024" height="1024" fill="${BG}"/>`),
  },
  {
    file: 'splash.png',
    note: '浅色启动图',
    svg: canvas(2732, `<rect width="2732" height="2732" fill="${SPLASH_LIGHT}"/>${badge(1366, 1366, 1100)}`),
  },
  {
    file: 'splash-dark.png',
    note: '深色启动图',
    svg: canvas(2732, `<rect width="2732" height="2732" fill="${SPLASH_DARK}"/>${badge(1366, 1366, 1100)}`),
  },
]

// ---------- 跑 ----------

await mkdir(outDir, { recursive: true })

// 顺便留一份图标 SVG，方便在浏览器里直接看效果
await writeFile(resolve(outDir, 'icon.svg'), targets[0].svg, 'utf8')

for (const t of targets) {
  await sharp(Buffer.from(t.svg)).png().toFile(resolve(outDir, t.file))
  console.log(`✓ ${t.file}  —— ${t.note}`)
}

console.log(`\n生成完毕，输出目录：${outDir}`)
console.log('下一步：npx @capacitor/assets generate --android')

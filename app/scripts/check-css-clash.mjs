/**
 * 查"同一个元素上两个 class 抢同一个属性"的碰撞（一次性排查脚本，跑完即删）。
 *
 * 背景：这个 bug 已经出现两次了 —— `.rt-cap` 的 margin 简写吃掉 `.rt-gap26`、
 * `.rt-legend` 的 color 吃掉 `.rt-legend-bad`。都是"两个单类选择器作用在同一元素、
 * 后声明的赢"，而写代码时以为修饰类会赢。构建不报错、肉眼也不一定看得出来。
 *
 * 做法：把每个 class 单独规则的属性集抽出来，再用 .vue 模板里的实际 class 组合
 * 两两求交集 —— 有交集就说明这一对在抢属性，把"谁赢"也算出来。
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'
// 先去掉注释：注释会夹在规则之间，让下一条规则的前一个字符不是 }，
// 从而被"后面紧跟规则"的解析漏掉（第一版就是这么漏光的，反向验证才发现）
const css = readFileSync(join(SRC, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// 只认不带逗号、不带伪类/后代/属性的**单类选择器**
const props = new Map() // class -> { prop -> 声明所在的下标 }
const order = new Map() // class -> 规则起始位置（用来定谁后声明）
const ruleRe = /([^{}]+)\{([^{}]*)\}/g
let m
while ((m = ruleRe.exec(css)) !== null) {
  const sel = m[1].trim()
  const body = m[2]
  if (!/^\.[A-Za-z0-9_-]+$/.test(sel)) continue // 只要单类
  const cls = sel.slice(1)
  if (!props.has(cls)) {
    props.set(cls, new Map())
    order.set(cls, m.index)
  }
  const bag = props.get(cls)
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    if (!prop || prop.startsWith('/*')) continue
    // 简写会顺手重置其它属性，这里把它们都算上（margin 简写吃掉 margin-top 就是这类）
    const pm = /^(margin|padding|border|border-radius|background|font)$/.exec(prop)
    if (pm && prop === 'margin') {
      for (const p of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']) {
        if (!bag.has(p)) bag.set(p, order.get(cls))
      }
    }
    if (pm && prop === 'padding') {
      for (const p of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
        if (!bag.has(p)) bag.set(p, order.get(cls))
      }
    }
    if (!bag.has(prop)) bag.set(prop, order.get(cls))
  }
}

// 收集模板里真实出现过的 class 组合。
// 关键是**同一个元素**上的静态 class 与 :class 里的字面量要合并考虑 ——
// 上一次踩的坑正是 `class="rt-legend" :class="{'rt-legend-bad': ...}"`，
// 只看静态 class 是抓不到的。
const groups = new Set()
for (const f of readdirSync(SRC, { recursive: true })) {
  const name = String(f)
  if (!name.endsWith('.vue')) continue
  const src = readFileSync(join(SRC, name), 'utf8')
  for (const tag of src.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = tag[0]
    const list = []
    const stat = /(?<![:\w-])class="([^"]*)"/.exec(t)
    if (stat) list.push(...stat[1].trim().split(/\s+/).filter(Boolean))
    const dyn = /:class="([^"]*)"/.exec(t)
    if (dyn) {
      // :class 里出现的所有字面量类名（对象 key 和字符串都要）
      for (const q of dyn[1].matchAll(/'([A-Za-z0-9_ -]+)'|"([A-Za-z0-9_ -]+)"/g)) {
        const v = (q[1] ?? q[2] ?? '').trim()
        for (const c of v.split(/\s+/)) if (c) list.push(c)
      }
    }
    if (list.length >= 2) groups.add([...new Set(list)].sort().join(' '))
  }
}

let hits = 0
for (const g of [...groups].sort()) {
  const list = g.split(' ')
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const pa = props.get(a)
      const pb = props.get(b)
      if (!pa || !pb) continue
      const both = [...pa.keys()].filter((p) => pb.has(p))
      if (!both.length) continue
      const aLater = order.get(a) > order.get(b)
      const winner = aLater ? a : b
      hits++
      console.log(`💥 ${a} + ${b}`)
      console.log(`   抢: ${both.join(', ')}`)
      console.log(`   谁赢: ${winner}（后声明）`)
    }
  }
}
console.log(hits ? `\n共 ${hits} 处碰撞` : '\n没有碰撞')
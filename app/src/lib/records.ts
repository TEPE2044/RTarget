/**
 * 动态（首页「最近」/ 历史页）的文案模板。
 *
 * **这是文案的唯一出处** —— 改措辞只改这个文件，不用动数据库、不用跑迁移。
 *
 * 库里 `records` 只存数据：type、goal_id、goal_content（名字快照）、amount、created_at。
 * 以前是把拼好的整句话写进 text 列，三个后果都是坏的：
 * 1. 改文案改不动历史数据（行里存的是当年那句话，得再写一条迁移去刷）
 * 2. 想换措辞就得重写 SQL 函数
 * 3. 点击只能靠 text.includes(目标名) 反查目标 —— 重名取错、删过的取不到
 *
 * 那个 text 列 2026-10-13 已经 drop 掉了。
 *
 * ⚠️ 改这里的措辞不用跑迁移，但**别把句子再写回库里**。
 */

import type { RecordItem } from './game'

/**
 * 一条动态要显示的那句话。
 *
 * 存档名不在记录里 —— records 对 archives 是 `on delete cascade`，存档在记录就在，
 * 所以调用方从自己的 archives 列表里查一下传进来即可（见 store 的 recordLabel）。
 */
export function recordText(r: RecordItem, archiveName = ''): string {
  // 目标被删档清掉后 goal_content 就是唯一的名字来源；真没有就兜一句，别显示空白
  const name = r.goal_content || '（已删除的目标）'
  const n = r.amount ?? 0

  switch (r.type) {
    case 'created':
      return `设置目标 ${name} · ${n} 活力值`
    case 'done':
      return `完成 ${name} · +${n} 活力值`
    case 'failed':
      // amount 存的是负数，显示要的是绝对值 —— 减号由模板自己给
      return `未完成 ${name} · −${Math.abs(n)} 活力值`
    case 'sealed':
      // amount = 0 表示封档时档内已经全了结、没扣分
      return n === 0
        ? `封档 ${archiveName} · 全部完成`
        : `封档 ${archiveName} · - ${Math.abs(n)} 活力值`
    default:
      // type 在库里是 text 不是枚举，理论上可能出现没见过的值；宁可不显示也别崩
      return ''
  }
}
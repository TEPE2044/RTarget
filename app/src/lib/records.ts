/**
 * 动态（首页「最近」/ 历史页）的文案模板。
 *
 * **这是文案的唯一出处** —— 改措辞只改这个文件，不碰数据库、不用跑迁移。
 *
 * 以前是把整句话拼好、连渲染结果一起 insert 进 records.text，三个后果都是坏的：
 * 1. 文案改不动历史数据（行里存的是当年那句话）
 * 2. 想换措辞就得重写 SQL 函数 + 跑一次迁移
 * 3. 点击要靠 text.includes(目标名) 反查目标 —— 重名时取错、删过的取不到
 *    （"点最近那条没反应/点错目标"就是这么来的）
 *
 * 现在把「数据」和「文案」分开：
 * - 库里只剩数据（type / archive_id / created_at）
 * - 句子在这里按模板现拼
 * - 立项动态**根本不落库** —— 它是目标本身的一个投影，由目标当场生成，
 *   所以历史里的立项也会跟着新模板走
 */

import type { Goal, RecordItem } from './game'

/** 立项：设置目标 X · N 活力值 */
function createdText(g: Goal): string {
  return `设置目标 ${g.content} · ${g.stake} 活力值`
}

/**
 * 把一条目标投影成它的立项动态。
 *
 * 不写库，所以这条记录随目标存在而存在、随目标删除而消失 —— 这符合它的语义：
 * 它陈述的就是"这个目标被设立了"。created_at 直接用目标的创建时间。
 *
 * id 用字符串前缀，免得跟库里 records 的自增 int 撞（渲染时只当 key 用）。
 */
export function createdRecord(g: Goal): RecordItem {
  return {
    id: `goal-${g.id}`,
    archive_id: g.archive_id,
    type: 'created',
    text: createdText(g),
    created_at: g.created_at,
    goal_id: g.id,
  }
}

/**
 * 过滤掉库里存量的立项行。
 *
 * 它们是在"文案写库"那套做法下留下的，text 里烤着旧措辞（"立了「X」· 押 5"）。
 * 现在立项统一由 createdRecord 现拼，所以这些旧行不再参与渲染 ——
 * 库里数据不动，只是不显示了。
 */
export function dropStoredCreated(rs: RecordItem[]): RecordItem[] {
  return rs.filter((r) => r.type !== 'created')
}

/**
 * 拼出最终的动态列表：库里的记录 + 目标的立项投影，按时间倒序。
 *
 * limit 只给首页「最近」用（历史页要看全部，不传）。
 */
export function mergeFeed(fromDb: RecordItem[], gs: Goal[], limit?: number): RecordItem[] {
  const all = [...dropStoredCreated(fromDb), ...gs.map(createdRecord)]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return limit ? all.slice(0, limit) : all
}
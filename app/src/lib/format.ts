/** 时间格式化（原型 app.js 的同款文案，别改措辞） */

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 还剩多久（到死线）：剩 N 分钟 / N 小时 M 分 / N 天 */
export function fmtLeft(at: number | string | Date): string {
  const ts = new Date(at).getTime()
  const d = ts - Date.now()
  if (d <= 0) return '已过死线'
  const m = Math.floor(d / 60_000)
  if (m < 60) return `剩 ${m} 分钟`
  const h = Math.floor(m / 60)
  if (h < 24) return h % 24 === 0 ? `剩 ${h} 小时` : `剩 ${h} 小时 ${m % 60} 分`
  const dd = Math.floor(h / 24)
  return h % 24 === 0 ? `剩 ${dd} 天` : `剩 ${dd} 天 ${h % 24} 小时`
}

/** 过去多久：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / N 天前 / M 月 D 日 */
export function fmtTime(at: number | string | Date): string {
  const ts = new Date(at).getTime()
  const diff = Date.now() - ts
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  const d = new Date(ts)
  const now = new Date()
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const y = new Date(now.getTime() - 86400e3)
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function fmtDay(at: number | string | Date): string {
  const d = new Date(at)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function fmtDayTime(at: number | string | Date): string {
  const d = new Date(at)
  return `${fmtDay(at)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 死线写成一句：8 月 3 日 18:00 · 剩 1 天 4 小时 */
export function fmtDue(at: number | string | Date): string {
  return `${fmtDayTime(at)} · ${fmtLeft(at)}`
}

/** 'YYYY-MM-DDTHH:mm' → Date（本地时区），给 datetime-local / 选择器用 */
export function pad2n(n: number) { return pad2(n) }
/* ============================================================
 * api.js —— 异步服务层（stub）
 *
 * 每个函数的签名、时延、返回结构都按"将来真后端"的形状写；
 * 接后端时只需把函数体换成 fetch(...)，调用方一行不用改。
 * 每个函数上方注释标了对应的 HTTP 方法与路径。
 * ============================================================ */

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const clone = (o) => JSON.parse(JSON.stringify(o))
/* 存档记录懒初始化：新档第一次写记录时才建数组 */
const rec = (id) => DB.records[id] || (DB.records[id] = [])

const Api = {
  /* GET /api/dashboard → { vitality, feed } */
  async getDashboard() {
    await delay(140)
    return clone({ vitality: DB.vitality, feed: DB.feed })
  },

  /* GET /api/todos → Todo[] */
  async getTodos() {
    await delay(160)
    return clone(DB.todos)
  },

  /* PATCH /api/todos/:id ｜ POST /api/todos → Todo */
  async saveTodo(t) {
    await delay(180)
    if (t.id) {
      const hit = DB.todos.find((x) => x.id === t.id)
      if (hit) Object.assign(hit, t)
      return clone(hit)
    }
    const nt = { id: 't' + (Date.now() % 100000), times: 1, left: 1, ...t }
    DB.todos.unshift(nt)
    return clone(nt)
  },

  /* GET /api/goals?status=active → Goal[] */
  async getGoals() {
    await delay(180)
    return clone(DB.goals.filter((g) => g.status === 'active'))
  },

  /* GET /api/goals/:id → Goal */
  async getGoal(id) {
    await delay(120)
    return clone(DB.goals.find((g) => g.id === id))
  },

  /* POST /api/goals → Goal */
  async createGoal(g) {
    await delay(260)
    const ng = { id: 'g' + (Date.now() % 100000), ...g }
    DB.goals.unshift(ng)
    DB.feed.unshift({ type: 'created', text: `立了「${ng.title}」 · 押 ${ng.stake}`, ts: Date.now() })
    rec(ng.archiveId).unshift({ type: 'created', text: `立了「${ng.title}」 · 押 ${ng.stake}`, ts: Date.now() })
    return clone(ng)
  },

  /* POST /api/goals/:id/complete → { gained, reward } */
  async completeGoal(id) {
    await delay(220)
    const g = DB.goals.find((x) => x.id === id)
    g.status = 'done'
    DB.vitality.value += g.stake
    /* 奖励是从愿望单来的话 → 愿望当场兑现 */
    const w = DB.wishes.find((x) => x.title === g.reward)
    if (w) w.status = 'done'
    DB.feed.unshift({ type: 'done', text: `完成了「${g.title}」 · +${g.stake} 活力值`, ts: Date.now() })
    rec(g.archiveId).unshift({ type: 'done', text: `完成了「${g.title}」 · +${g.stake}`, ts: Date.now() })
    return clone({ gained: g.stake, reward: g.reward })
  },

  /* POST /api/goals/:id/giveup → { lost, returned } */
  async giveUpGoal(id) {
    await delay(220)
    const g = DB.goals.find((x) => x.id === id)
    g.status = 'failed'
    DB.vitality.value -= g.stake
    /* 从待办挑来的 → 退回待办（次数不动，计划文本跟着回去） */
    if (g.source === 'todo') {
      DB.todos.unshift({ id: g.todoId || 't' + (Date.now() % 100000), title: g.title, text: g.exec || '', times: 1, left: 1 })
    }
    DB.feed.unshift({ type: 'failed', text: `没做到「${g.title}」 · −${g.stake} 活力值 · 已退回待办`, ts: Date.now() })
    rec(g.archiveId).unshift({ type: 'failed', text: `没做到「${g.title}」 · −${g.stake} · 已退回待办`, ts: Date.now() })
    return clone({ lost: g.stake, returned: g.source === 'todo' })
  },

  /* GET /api/wishes → Wish[] */
  async getWishes() {
    await delay(140)
    return clone(DB.wishes)
  },

  /* POST /api/wishes/:id/toggle → Wish */
  async toggleWish(id) {
    await delay(140)
    const w = DB.wishes.find((x) => x.id === id)
    w.status = w.status === 'open' ? 'done' : 'open'
    return clone(w)
  },

  /* GET /api/archives → Archive[] */
  async getArchives() {
    await delay(120)
    return clone(DB.archives)
  },

  /* POST /api/archives → Archive */
  async createArchive(name) {
    await delay(200)
    const a = { id: 'a' + (Date.now() % 100000), name, status: 'open', createdAt: Date.now() }
    DB.archives.unshift(a)
    DB.records[a.id] = []
    return clone(a)
  },

  /* GET /api/archives/:id/records → FeedItem[] */
  async getRecords(id) {
    await delay(160)
    return clone(DB.records[id] || [])
  },

  /* POST /api/archives/:id/seal → { penalty, free } */
  async sealArchive(id) {
    await delay(240)
    const a = DB.archives.find((x) => x.id === id)
    const pending = DB.goals.some((g) => g.archiveId === id && g.status === 'active')
    a.status = 'sealed'
    a.sealedAt = Date.now()
    const p = pending ? -Math.round(DB.vitality.value * 0.1) : 0
    a.penalty = p
    a.sealedFree = !pending
    DB.vitality.value += p
    rec(id).unshift({
      type: 'sealed',
      text: pending ? `封档 · 未了结扣 10% · ${p}` : '封档 · 全部走奖励分支 · 免费',
      ts: Date.now(),
    })
    return clone({ penalty: p, free: !pending })
  },
}
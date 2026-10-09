/* ============================================================
 * app.js —— RTarget Vant 原型 · 全部交互
 *
 * 分层：mock.js（数据单源）→ api.js（异步 stub）→ 本文件（Vue 3 + Vant 4）
 * 无构建：Vue / Vant 都是本地 UMD，双击 index.html 即开。
 * 接后端时只换 api.js，本文件一行不用改。
 * ============================================================ */

/* ---------- 小工具 ---------- */
const pad2 = (n) => String(n).padStart(2, '0')
const TIER_STAKE = { 低: 5, 中: 10, 高: 20 }
let toastTimer = null

function fmtLeft(ts) {
  const d = ts - Date.now()
  if (d <= 0) return '已过死线'
  const m = Math.floor(d / 60000)
  if (m < 60) return `剩 ${m} 分钟`
  const h = Math.floor(m / 60)
  if (h < 24) return h % 24 === 0 ? `剩 ${h} 小时` : `剩 ${h} 小时 ${m % 60} 分`
  const dd = Math.floor(h / 24)
  return h % 24 === 0 ? `剩 ${dd} 天` : `剩 ${dd} 天 ${h % 24} 小时`
}
function fmtTime(ts) {
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
function fmtDay(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
function fmtDayTime(ts) {
  const d = new Date(ts)
  return `${fmtDay(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/* ---------- 应用 ---------- */
const { createApp } = Vue

const WZ_FRESH = () => ({
  show: true, step: 1,
  source: 'free', title: '', pickId: null,
  dueAt: Date.now() + 24 * 3600e3, dueLabel: '明天此刻',
  pickerShow: false, pickerMode: 'date', pickerDate: [], pickerTime: [],
  tier: '低', rewardFrom: 'free', rewardPick: null, reward: '',
  penalty: '', exec: '',
})

createApp({
  template: '#tpl-app',

  data() {
    const wz = WZ_FRESH()
    wz.show = false
    return {
      tab: 'home',
      loaded: { dash: false, todos: false, goals: false, wishes: false, history: false, archives: false },
      loadingRecords: false,
      vitality: { value: 10 },
      feed: [],
      todos: [], goals: [], wishes: [], archives: [], records: [],
      activeArchiveId: 'a3',
      histArchiveId: null,
      detailShow: false, detailId: null, detail: null,
      sheet: { show: false, isNew: true, id: null, title: '', text: '' },
      confirm: { show: false, title: '', text: '', okText: '确定', onOk: null },
      toastState: { show: false, msg: '' },
      quickDues: [
        { label: '今晚 18:00', fn: () => { const d = new Date(); d.setHours(18, 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime() } },
        { label: '明天此刻', fn: () => Date.now() + 24 * 3600e3 },
        { label: '后天 18:00', fn: () => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(18, 0, 0, 0); return d.getTime() } },
      ],
      wz,
    }
  },

  computed: {
    vitalityPct() { return Math.max(0, Math.min(100, Math.round((this.vitality.value / 30) * 100))) },
    openTodos() { return this.todos.filter((t) => !t.done) },
    doneTodos() { return this.todos.filter((t) => t.done) },
    openWishes() { return this.wishes.filter((w) => w.status === 'open') },
    doneWishes() { return this.wishes.filter((w) => w.status === 'done') },
    openArchives() { return this.archives.filter((a) => a.status === 'open') },
    sealedArchives() { return this.archives.filter((a) => a.status === 'sealed') },
    activeArchive() { return this.archives.find((a) => a.id === this.activeArchiveId) || null },
    archiveGoals() { return this.goals.filter((g) => g.archiveId === this.activeArchiveId) },
    minDate() { return new Date() },
    maxDate() { return new Date(Date.now() + 365 * 86400e3) },
    wzStake() {
      const d = this.wz
      return d.tier === 'allin'
        ? Math.max(1, Math.round(this.vitality.value * 0.8))
        : TIER_STAKE[d.tier]
    },
    wzTierLabel() { return this.wz.tier === 'allin' ? 'ALL IN' : this.wz.tier },
    wzValid() {
      const d = this.wz
      return d.source === 'todo' ? !!d.pickId : !!d.title.trim()
    },
    wzTitle() {
      const d = this.wz
      if (d.source !== 'todo') return d.title.trim()
      const t = this.todos.find((x) => x.id === d.pickId)
      return t ? t.title : ''
    },
    wzReward() {
      const d = this.wz
      if (d.rewardFrom !== 'wish') return d.reward.trim()
      const w = this.wishes.find((x) => x.id === d.rewardPick)
      return w ? w.title : ''
    },
    wzDueText() { return `${fmtDayTime(this.wz.dueAt)} · ${fmtLeft(this.wz.dueAt)}` },
  },

  watch: {
    tab() { this.loadTab() },
    'detail.exec'(v) {
      /* 执行区随写随存（原型内存；真实现 PATCH /api/goals/:id） */
      if (!this.detail) return
      const g = DB.goals.find((x) => x.id === this.detail.id)
      if (g) g.exec = v
    },
  },

  methods: {
    /* ================= 数据装载 ================= */
    async loadTab() {
      const t = this.tab
      if (t === 'home') await this.ensureDash()
      else if (t === 'todos') await this.ensureTodos()
      else if (t === 'goals') await this.ensureGoals()
      else if (t === 'wishes') await this.ensureWishes()
      else if (t === 'history') await this.ensureHistory()
    },
    invalidate(...keys) { keys.forEach((k) => { this.loaded[k] = false }) },
    reload() { return this.loadTab() },

    async ensureDash() {
      if (this.loaded.dash) return
      const d = await Api.getDashboard()
      this.vitality = d.vitality
      this.feed = d.feed.map((f) => ({ ...f, time: fmtTime(f.ts) }))
      await this.ensureGoals()               /* 动态流里点得进目标 */
      this.loaded.dash = true
    },
    async ensureTodos() {
      if (this.loaded.todos) return
      this.todos = (await Api.getTodos()).map((t) => ({ ...t, done: !!t.done }))
      this.loaded.todos = true
    },
    async ensureArchives() {
      if (this.loaded.archives) return
      this.archives = (await Api.getArchives()).map((a) => ({
        ...a, sealedText: a.sealedAt ? fmtDayTime(a.sealedAt) + ' 封档' : '',
      }))
      this.loaded.archives = true
    },
    async ensureGoals() {
      if (this.loaded.goals) return
      await this.ensureArchives()
      this.goals = (await Api.getGoals()).map((g) => ({
        ...g, left: fmtLeft(g.dueAt), tierLabel: g.tier === 'allin' ? 'ALL IN' : g.tier,
      }))
      this.loaded.goals = true
    },
    async ensureWishes() {
      if (this.loaded.wishes) return
      this.wishes = (await Api.getWishes()).map((w) => ({
        ...w, doneText: w.status === 'done' ? fmtDay(w.doneAt) + ' 兑现' : '',
      }))
      this.loaded.wishes = true
    },
    async ensureHistory() {
      if (this.loaded.history) return
      await this.ensureArchives()
      this.histArchiveId = this.sealedArchives.length ? this.sealedArchives[0].id : null  /* 默认最新 */
      await this.loadRecords()
      this.loaded.history = true
    },
    async loadRecords() {
      if (!this.histArchiveId) { this.records = []; return }
      this.loadingRecords = true
      this.records = (await Api.getRecords(this.histArchiveId)).map((r) => ({ ...r, time: fmtTime(r.ts) }))
      this.loadingRecords = false
    },
    selectHist(id) { this.histArchiveId = id; this.loadRecords() },

    /* ================= 存档（挂在「当前档」上） ================= */
    switchArchive(id) { this.activeArchiveId = id },
    archiveHasPending(id) { return this.goals.some((g) => g.archiveId === id && g.status === 'active') },
    async newArchive() {
      const name = '新档 ' + (this.openArchives.length + 1)
      const a = await Api.createArchive(name)
      this.archives.unshift({ ...a, sealedText: '' })
      this.activeArchiveId = a.id
      this.toast(`已开新档「${name}」`)
    },

    /* ================= 首页 ================= */
    feedGoal(text) { return this.goals.find((g) => text.includes(g.title)) },
    feedIcon(type) {
      return { done: 'passed', failed: 'revoke', redeemed: 'gift-o', created: 'plus', sealed: 'lock' }[type] || 'passed'
    },
    onFeedClick(f) { const g = this.feedGoal(f.text); if (g) this.openDetail(g.id) },

    /* ================= 待办 ================= */
    openTodoSheet(t) {
      this.sheet = { show: true, isNew: !t, id: t ? t.id : null, title: t ? t.title : '', text: t ? t.text : '' }
    },
    async saveTodo() {
      const title = this.sheet.title.trim()
      if (!title) return this.toast('先写个标题')
      const saved = await Api.saveTodo({
        ...(this.sheet.id ? { id: this.sheet.id } : {}), title, text: this.sheet.text,
      })
      if (this.sheet.id) {
        const hit = this.todos.find((x) => x.id === this.sheet.id)
        if (hit) Object.assign(hit, saved)
      } else {
        this.todos.unshift({ ...saved, done: false })
      }
      this.sheet.show = false
      this.toast('已保存')
    },
    async toggleTodo(t) {
      const was = t.done
      await Api.saveTodo({ id: t.id, done: !was })
      t.done = !was
      this.toast(was ? '放回清单了' : '已勾掉')
    },

    /* ================= 愿望 ================= */
    async toggleWish(w) {
      const r = await Api.toggleWish(w.id)
      w.status = r.status
      if (r.status === 'done') w.doneText = fmtDay(Date.now()) + ' 兑现'
      this.toast(r.status === 'done' ? '兑现了，去享受吧' : '放回愿望单')
    },

    /* ================= 目标 ================= */
    openDetail(id) {
      const g = DB.goals.find((x) => x.id === id)
      if (!g) return
      this.detailId = id
      this.detail = { ...g, left: fmtLeft(g.dueAt), tierLabel: g.tier === 'allin' ? 'ALL IN' : g.tier }
      this.detailShow = true
    },
    async completeGoal() {
      const g = DB.goals.find((x) => x.id === this.detailId)
      if (!g) return
      const r = await Api.completeGoal(g.id)
      this.detailShow = false
      this.invalidate('dash', 'goals', 'wishes', 'todos', 'history')
      await this.reload()
      this.toast(`已 +${r.gained} 活力值 · 奖励兑现${r.reward ? '：' + r.reward : ''}`)
    },
    askGiveUp() {
      const g = DB.goals.find((x) => x.id === this.detailId)
      if (!g) return
      this.openConfirm({
        title: '放弃这个目标？',
        text: `放弃 = 做不到：扣 ${g.stake} 活力值${g.source === 'todo' ? '，并退回待办（次数不动）' : ''}。`,
        okText: '放弃',
        onOk: async () => {
          const r = await Api.giveUpGoal(g.id)
          this.detailShow = false
          this.invalidate('dash', 'goals', 'todos', 'history')
          await this.reload()
          this.toast(`已 −${r.lost} 活力值${r.returned ? ' · 已退回待办' : ''}`)
        },
      })
    },

    /* ================= 立项向导 ================= */
    async openWizard() {
      if (!this.activeArchiveId) return this.toast('先开一个档')
      await this.ensureTodos()               /* 立项要用到待办 / 愿望两个池子 */
      await this.ensureWishes()
      this.wz = WZ_FRESH()
    },
    closeWizard() { this.wz.show = false; this.toast('已取消') },
    wzStep(n) {
      const s = this.wz.step + n
      if (s >= 1 && s <= 6) this.wz.step = s
    },
    async wzNext() {
      if (this.wz.step === 6) return this.submitWizard()
      this.wz.step += 1
    },
    pickDue(q) { this.wz.dueAt = q.fn(); this.wz.dueLabel = q.label },
    openPicker() {
      const d = new Date(this.wz.dueAt)
      this.wz.pickerDate = [String(d.getFullYear()), pad2(d.getMonth() + 1), pad2(d.getDate())]
      this.wz.pickerTime = [pad2(d.getHours()), pad2(d.getMinutes())]
      this.wz.pickerMode = 'date'
      this.wz.pickerShow = true
    },
    onDateConfirm({ selectedValues }) {
      this.wz.pickerDate = selectedValues
      this.wz.pickerMode = 'time'            /* 选完日期接着选时刻 */
    },
    onTimeConfirm({ selectedValues }) {
      this.wz.pickerTime = selectedValues
      const [y, mo, da] = this.wz.pickerDate.map(Number)
      const [h, mi] = selectedValues.map(Number)
      this.wz.dueAt = new Date(y, mo - 1, da, h, mi).getTime()
      this.wz.dueLabel = '自定义'
      this.wz.pickerShow = false
    },
    async submitWizard() {
      const d = this.wz
      const title = this.wzTitle
      const reward = this.wzReward
      await Api.createGoal({
        archiveId: this.activeArchiveId, title, tier: d.tier, stake: this.wzStake,
        dueAt: d.dueAt, reward, penalty: d.penalty.trim(), exec: d.exec,
        source: d.source, todoId: d.source === 'todo' ? d.pickId : null,
      })
      /* 从待办来的 → 立项后移出清单（真实现由后端做） */
      if (d.source === 'todo') DB.todos = DB.todos.filter((t) => t.id !== d.pickId)
      d.show = false
      this.invalidate('dash', 'goals', 'todos', 'history')
      this.tab = 'goals'
      await this.reload()
      this.toast(`已押注设立「${title}」`)
    },

    /* ================= 封档（在当前档上，不在历史页） ================= */
    askSeal() {
      const a = this.activeArchive
      if (!a) return
      const pending = this.archiveHasPending(a.id)
      this.openConfirm({
        title: `封档「${a.name}」？`,
        text: pending
          ? `这个存档还有没做完的事 —— 封档会扣当前活力值的 10%（约 ${Math.round(this.vitality.value * 0.1)} 分）。`
          : '全部走向奖励分支 —— 免费封档。',
        okText: '封档',
        onOk: async () => {
          const r = await Api.sealArchive(a.id)
          this.invalidate('archives', 'goals', 'dash', 'history')
          await this.ensureArchives()
          const next = this.archives.find((x) => x.status === 'open')
          this.activeArchiveId = next ? next.id : null
          await this.reload()
          this.toast(r.free ? '已封档 —— 全部完成，免费' : `已封档 · 扣 ${Math.abs(r.penalty)} 活力值`)
        },
      })
    },

    /* ================= 通用 ================= */
    openConfirm({ title, text, okText, onOk }) {
      this.confirm = { show: true, title, text, okText: okText || '确定', onOk }
    },
    async confirmOk() { const fn = this.confirm.onOk; if (fn) await fn() },
    toast(msg) {
      this.toastState.msg = msg
      this.toastState.show = true
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { this.toastState.show = false }, 1900)
    },
  },

  mounted() { this.loadTab() },
}).use(vant).mount('#app')
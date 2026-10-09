/* ============================================================
 * app.js —— 状态 + 视图渲染 + 交互（原型，无后端）
 *
 * 分层：mock.js（数据单源）→ api.js（异步 stub）→ 本文件（状态与视图）。
 * 接后端时只换 api.js，本文件的调用一行不用改。
 * ============================================================ */

/* ---------- 内联 Lucide 图标（stroke 1.75，单一图标来源） ---------- */
const ICONS = {
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  zap: '<path d="M13 2.5 4 14h7l-1 7.5L19 10h-7Z"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5.5 12v7a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-7"/><path d="M12 8v12.5"/><path d="M12 8H8.2a2.1 2.1 0 1 1 0-4.2C10.8 3.8 12 8 12 8Z"/><path d="M12 8h3.8a2.1 2.1 0 1 0 0-4.2C13.2 3.8 12 8 12 8Z"/>',
  'alert-triangle': '<path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5V14"/><path d="M12 17.2h.01"/>',
  'corner-up-left': '<path d="M20 20v-7a4 4 0 0 0-4-4H4"/><path d="m9 14-5-5 5-5"/>',
  sparkles: '<path d="M12 4.5 13.6 9l4.5 1.6-4.5 1.6L12 16.7l-1.6-4.5L5.9 10.6 10.4 9Z"/><path d="M18.5 3.5v3M17 5h3"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  'pen-line': '<path d="M12 20.5h9"/><path d="M16.8 3.7a2.3 2.3 0 0 1 3.2 3.2L7 19.9l-4.2 1.1L3.9 16.8Z"/>',
}
function icon(name, cls = 'ico') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
}

/* ---------- 小工具 ---------- */
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pad = (n) => String(n).padStart(2, '0')

function toast(msg) {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { t.hidden = true }, 1900)
}
function skel(n) { return '<div class="skeleton"></div>'.repeat(n) }

/** 倒计时文案（永远是合理的：mock 用「距现在偏移」声明） */
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
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const y = new Date(now.getTime() - 86400e3)
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
const fmtDay = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1} 月 ${d.getDate()} 日` }
const fmtDayTime = (ts) => { const d = new Date(ts); return `${fmtDay(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const toLocalInput = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }

/* ---------- 状态 ---------- */
const State = {
  view: 'home',
  dash: null,
  todos: [], goals: [], wishes: [], archives: [], records: [],
  archiveId: null,          // 历史页当前存档（默认 = 最新）
  detailId: null,
  sheet: { mode: 'edit', id: null },
  confirm: { onOk: null },
  wz: null,                 // 立项向导（打开时初始化）
}
const loaded = { dash: false, todos: false, goals: false, wishes: false, history: false }
const invalidateAll = () => { for (const k in loaded) loaded[k] = false }

/* ---------- 首页 ---------- */
async function ensureDash() {
  if (loaded.dash) return
  State.dash = await Api.getDashboard()
  loaded.dash = true
}
function renderVitality() {
  const v = State.dash.vitality
  const pct = Math.max(0, Math.min(100, Math.round((v.value / 30) * 100)))
  $('#vitalityCard').innerHTML = `
    <p class="v-label">活力值</p>
    <p class="v-num">${v.value}</p>
    <div class="v-bar"><div class="v-fill" id="vFill"></div></div>
    <p class="v-legend">押注：低 <b>5</b> · 中 <b>10</b> · 高 <b>20</b> · ALL IN <b>80%</b></p>`
  requestAnimationFrame(() => { $('#vFill').style.width = pct + '%' })
}
const FEED_ICON = { done: 'check', failed: 'corner-up-left', redeemed: 'sparkles', created: 'plus', sealed: 'lock' }
function renderFeed() {
  const list = State.dash.feed
  $('#feedList').innerHTML = list.map((f, i) => {
    const g = State.goals.find((x) => f.text.includes(x.title))
    return `
    <div class="f-item reveal ${g ? 'tappable' : ''}" style="--d:${i}" ${g ? `data-act="open-goal" data-id="${g.id}"` : ''}>
      <span class="f-dot t-${f.type}">${icon(FEED_ICON[f.type] || 'check')}</span>
      <div class="f-main">
        <p class="f-text">${esc(f.text)}</p>
        <p class="f-time">${fmtTime(f.ts)}</p>
      </div>
    </div>`
  }).join('')
}

/* ---------- 待办 ---------- */
async function renderTodos() {
  const box = $('#todoList')
  if (!loaded.todos) {
    box.innerHTML = skel(6)
    State.todos = await Api.getTodos()
    loaded.todos = true
  }
  const open = State.todos.filter((t) => !t.done)
  const done = State.todos.filter((t) => t.done)
  if (!State.todos.length) {
    box.innerHTML = `<div class="empty">待办是空的 —— 想到什么就往里记一条。</div>`
    return
  }
  const item = (t, i, muted) => `
    <div class="card todo-item reveal ${muted ? 't-done' : ''}" style="--d:${i}">
      <button class="t-check ${t.done ? 'on' : ''}" data-act="todo-check" data-id="${t.id}" aria-label="勾掉">${icon('check')}</button>
      <div class="t-main" data-act="todo-open" data-id="${t.id}">
        <p class="t-title">${esc(t.title)}</p>
        <p class="t-meta">
          ${t.times > 1 ? `<span class="chip chip-ink">${icon('zap')}剩 ${t.left} 次</span>` : ''}
          ${t.text ? `<span class="t-preview">${esc(t.text)}</span>` : ''}
        </p>
      </div>
    </div>`
  box.innerHTML =
    open.map((t, i) => item(t, i, false)).join('') +
    (done.length
      ? `<div class="sec-head"><h2 class="sec-title">已勾掉</h2></div>` + done.map((t, i) => item(t, i, true)).join('')
      : '')
}

/* ---------- 目标 ---------- */
async function renderGoals() {
  const box = $('#goalList')
  if (!loaded.goals) {
    box.innerHTML = skel(4)
    State.goals = await Api.getGoals()
    loaded.goals = true
  }
  if (!State.goals.length) {
    box.innerHTML = `<div class="empty">还没有进行中的目标 —— 右上角立一个。</div>`
    return
  }
  box.innerHTML = State.goals.map((g, i) => `
    <div class="card goal-card hoverable reveal" style="--d:${i}" data-act="open-goal" data-id="${g.id}">
      <h3 class="goal-title">${esc(g.title)}</h3>
      <p class="goal-meta">${icon('clock')}<span>${fmtLeft(g.dueAt)}</span><span>·</span><span>押 <b>${g.tier === 'allin' ? 'ALL IN' : g.tier} ${g.stake}</b></span></p>
      <div class="goal-duo">
        <span class="chip chip-warm">${icon('gift')}奖励 · ${esc(g.reward || '没写')}</span>
        <span class="chip chip-cold">${icon('alert-triangle')}惩罚 · ${esc(g.penalty || '没写')}</span>
      </div>
    </div>`).join('')
}

/* ---------- 愿望 ---------- */
async function renderWishes() {
  if (!loaded.wishes) {
    $('#wishList').innerHTML = skel(6)
    State.wishes = await Api.getWishes()
    loaded.wishes = true
  }
  const open = State.wishes.filter((w) => w.status === 'open')
  const done = State.wishes.filter((w) => w.status === 'done')
  $('#wishList').innerHTML = open.length ? open.map((w, i) => `
    <div class="card wish-item reveal" style="--d:${i}">
      <div class="wish-main">
        <p class="wish-title">${esc(w.title)}</p>
        ${w.attachedTo ? `<p class="w-attach">已挂给「${esc(w.attachedTo)}」· 兑现或判负前先别动它</p>` : ''}
      </div>
      <button class="w-check" data-act="wish-toggle" data-id="${w.id}" aria-label="标记为已实现">${icon('check')}</button>
    </div>`).join('') : `<div class="empty">还没想做的事 —— 加一个。</div>`
  $('#wishDoneHead').hidden = !done.length
  $('#wishDoneList').innerHTML = done.map((w) => `
    <div class="card wish-item wish-done">
      <div class="wish-main">
        <p class="wish-title">${esc(w.title)}</p>
        <p class="w-done-at">${fmtDay(w.doneAt)} 兑现</p>
      </div>
    </div>`).join('')
}

/* ---------- 历史（存档，默认最新） ---------- */
async function renderHistory() {
  if (!loaded.history) {
    $('#archiveChips').innerHTML = ''
    $('#archiveRecords').innerHTML = skel(5)
    State.archives = await Api.getArchives()
    State.archiveId = State.archives[0]?.id || null   // 默认 = 最新，不藏下拉
    loaded.history = true
  }
  $('#archiveChips').innerHTML = State.archives.map((a) => `
    <button class="a-chip ${a.id === State.archiveId ? 'on' : ''}" data-act="pick-archive" data-id="${a.id}">
      ${a.status === 'sealed' ? icon('lock') : ''}${esc(a.name)}
    </button>`).join('')
  await ensureRecords()
}
async function ensureRecords() {
  State.records = await Api.getRecords(State.archiveId)
  $('#archiveRecords').innerHTML = State.records.map((r, i) => `
    <div class="f-item reveal" style="--d:${i}">
      <span class="f-dot t-${r.type}">${icon(FEED_ICON[r.type] || 'check')}</span>
      <div class="f-main"><p class="f-text">${esc(r.text)}</p><p class="f-time">${fmtTime(r.ts)}</p></div>
    </div>`).join('') || `<div class="empty">这个存档还没有记录。</div>`
  const cur = State.archives.find((a) => a.id === State.archiveId)
  $('#sealBox').innerHTML = cur && cur.status === 'open' ? `
    <p class="seal-note">封档：这个存档还有未了结的事，封档会扣当前活力值的 10%；全部走奖励分支则免费。</p>
    <button class="btn btn-ghost btn-block" data-act="seal">${icon('lock')}封档「${esc(cur.name)}」</button>` : ''
}

/* ---------- 目标详情 ---------- */
function openDetail(id) {
  State.detailId = id
  renderDetail()
  $('#detailOverlay').hidden = false
}
function closeDetail() { $('#detailOverlay').hidden = true; State.detailId = null }
function renderDetail() {
  const g = DB.goals.find((x) => x.id === State.detailId)
  if (!g) return
  $('#detailBody').innerHTML = `
    <div class="d-hero">
      <h2 class="d-title">${esc(g.title)}</h2>
      <div class="d-meta">
        ${icon('clock')}<span>${fmtLeft(g.dueAt)}</span>
        <span class="chip chip-ink">${icon('zap')}押 ${g.tier === 'allin' ? 'ALL IN' : g.tier} ${g.stake}</span>
      </div>
    </div>
    <div class="d-panels">
      <div class="panel panel-warm">
        ${icon('gift')}
        <div class="panel-body">
          <p class="panel-label">做到了 · 奖励</p>
          <p class="panel-text">${g.reward ? esc(g.reward) : '（没写）'}</p>
          <p class="panel-sub">达成那一刻就算兑现，自动从愿望单划掉。</p>
        </div>
      </div>
      <div class="panel panel-cold">
        ${icon('alert-triangle')}
        <div class="panel-body">
          <p class="panel-label">做不到 · 惩罚</p>
          <p class="panel-text">${g.penalty ? esc(g.penalty) : '（没写）'}</p>
          <p class="panel-sub">扣 ${g.stake} 活力值${g.source === 'todo' ? ' · 退回待办（次数不动）' : ''} · 目标关闭</p>
        </div>
      </div>
    </div>
    <p class="d-exec-label">${icon('pen-line')}怎么做</p>
    <textarea class="note" id="execNote" placeholder="写计划、写步骤、想到什么写什么……支持 Markdown">${esc(g.exec)}</textarea>`
  $('#execNote').addEventListener('input', (e) => {
    /* 原型内直写内存；真实现走 PATCH /api/goals/:id */
    g.exec = e.target.value
  })
}

/* ---------- 立项向导（6 步换页） ---------- */
const QUICK_DUES = [
  { label: '今晚 18:00', fn: () => { const d = new Date(); d.setHours(18, 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime() } },
  { label: '明天此刻', fn: () => Date.now() + 24 * 3600e3 },
  { label: '后天 18:00', fn: () => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(18, 0, 0, 0); return d.getTime() } },
]
const TIERS = [
  { key: '低', stake: 5 }, { key: '中', stake: 10 }, { key: '高', stake: 20 }, { key: 'allin', stake: null },
]
const wzTierStake = (key) => key === 'allin'
  ? Math.max(1, Math.round(State.dash.vitality.value * 0.8))
  : TIERS.find((t) => t.key === key).stake

async function openWizard() {
  /* 立项要用到待办 / 愿望池：没去过那两个 tab 时也得先有数据 */
  if (!loaded.todos) { State.todos = await Api.getTodos(); loaded.todos = true }
  if (!loaded.wishes) { State.wishes = await Api.getWishes(); loaded.wishes = true }
  State.wz = {
    step: 1,
    data: {
      source: 'free', title: '', pickId: null,
      dueAt: Date.now() + 24 * 3600e3, dueQuick: '明天此刻',
      tier: '低', rewardFrom: 'free', rewardPick: null, reward: '',
      penalty: '', exec: '',
    },
  }
  $('#wizardOverlay').hidden = false
  renderWizard()
}
function closeWizard() { $('#wizardOverlay').hidden = true; State.wz = null }
const wzPickedTodo = () => State.todos.find((t) => t.id === State.wz?.data.pickId)
const wzValid = () => {
  const d = State.wz.data
  return d.source === 'todo' ? !!d.pickId : !!d.title.trim()
}

function renderWizard(dir) {
  const { step, data: d } = State.wz
  $('#wzTag').textContent = `${step} / 6`
  $('#wzDots').innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i + 1 === step ? 'on' : ''}"></i>`).join('')
  $('#wzNext').textContent = step === 6 ? '押注设立' : '继续'
  $('#wzNext').disabled = !wzValid()
  $$('[data-act="wz-prev"]').forEach((b) => { b.disabled = step === 1 })

  let html = ''
  if (step === 1) {
    const canPick = State.todos.filter((t) => !t.done)
    html = `
      <h2 class="wz-h">要立一个什么目标？</h2>
      <p class="wz-sub">从待办里挑一条，或者临时起意写一个。</p>
      <div class="wz-block seg">
        <button data-seg="source" data-v="todo" class="${d.source === 'todo' ? 'on' : ''}">从待办挑</button>
        <button data-seg="source" data-v="free" class="${d.source === 'free' ? 'on' : ''}">自己写</button>
      </div>
      ${d.source === 'todo'
        ? (canPick.length
          ? `<div class="pick-list">${canPick.map((t) => `
              <button class="pick ${d.pickId === t.id ? 'on' : ''}" data-pick="${t.id}"><span class="dot"></span><span>${esc(t.title)}</span></button>`).join('')}</div>`
          : `<div class="empty">待办是空的 —— 切到「自己写」吧。</div>`)
        : `<div class="wz-block"><input class="input" id="wzTitle" placeholder="比如：把阳台收拾出来" value="${esc(d.title)}" /></div>`}`
  } else if (step === 2) {
    html = `
      <h2 class="wz-h">什么时候做到？押多少？</h2>
      <p class="wz-sub">到点没做到就算判负 —— 押多少，输了就扣多少。</p>
      <div class="quick-chips">
        ${QUICK_DUES.map((q) => `<button class="qchip ${d.dueQuick === q.label ? 'on' : ''}" data-due="${q.label}">${q.label}</button>`).join('')}
      </div>
      <div class="wz-block"><input class="input" id="wzDue" type="datetime-local" value="${toLocalInput(d.dueAt)}" /></div>
      <div class="tier-row">
        ${TIERS.map((t) => `
          <button class="tier ${d.tier === t.key ? 'on' : ''}" data-tier="${t.key}">
            <b>${t.key === 'allin' ? 'ALL IN' : t.key}</b>
            <span>${t.key === 'allin' ? '当前 × 80%' : t.stake + ' 分'}</span>
          </button>`).join('')}
      </div>`
  } else if (step === 3) {
    const pool = State.wishes.filter((w) => w.status === 'open')
    html = `
      <h2 class="wz-h">做到了，奖励是什么？</h2>
      <p class="wz-sub">从愿望单里挑一个 —— 达成那一刻它就算兑现；也可以临时写一句。</p>
      <div class="wz-block seg">
        <button data-seg="rewardFrom" data-v="wish" class="${d.rewardFrom === 'wish' ? 'on' : ''}">从愿望挑</button>
        <button data-seg="rewardFrom" data-v="free" class="${d.rewardFrom === 'free' ? 'on' : ''}">写一句</button>
      </div>
      ${d.rewardFrom === 'wish'
        ? (pool.length
          ? `<div class="pick-list">${pool.map((w) => `
              <button class="pick ${d.rewardPick === w.id ? 'on' : ''}" data-wishpick="${w.id}"><span class="dot"></span><span>${esc(w.title)}${w.attachedTo ? '<br><small style="color:var(--ink-sub)">已挂给别的目标</small>' : ''}</span></button>`).join('')}</div>`
          : `<div class="empty">愿望单空了 —— 切到「写一句」吧。</div>`)
        : `<div class="wz-block"><input class="input" id="wzReward" placeholder="比如：看一场电影" value="${esc(d.reward)}" /></div>`}`
  } else if (step === 4) {
    html = `
      <h2 class="wz-h">做不到，罚自己什么？</h2>
      <p class="wz-sub">写一句就好，也可以留空 —— 系统的处理是固定的。</p>
      <div class="wz-block"><input class="input" id="wzPenalty" placeholder="比如：手洗羽绒服" value="${esc(d.penalty)}" /></div>
      <div class="wz-warn">做不到会：扣 <b>${wzTierStake(d.tier)}</b> 活力值${d.source === 'todo' ? '，并退回待办（次数不动）' : ''}，目标关闭。没有第二阶段，也没有补做。</div>`
  } else if (step === 5) {
    if (!d.exec && d.source === 'todo' && wzPickedTodo()?.text) d.exec = wzPickedTodo().text
    html = `
      <h2 class="wz-h">具体怎么做？</h2>
      <p class="wz-sub">像手机笔记那样写：步骤、清单、想法都行，支持 Markdown，之后随时补。</p>
      <textarea class="note" id="wzExec" placeholder="第一步……&#10;第二步……">${esc(d.exec)}</textarea>`
  } else {
    const title = d.source === 'todo' ? (wzPickedTodo()?.title || '') : d.title
    const reward = d.rewardFrom === 'wish' ? (State.wishes.find((w) => w.id === d.rewardPick)?.title || '') : d.reward
    html = `
      <h2 class="wz-h">最后看一眼</h2>
      <p class="wz-sub">确认后就不能改了 —— 到点见分晓。</p>
      <div class="sum">
        <div class="sum-row"><span class="k">目标</span><span class="v">${esc(title)}</span></div>
        <div class="sum-row"><span class="k">死线</span><span class="v">${fmtDayTime(d.dueAt)} · <b>${fmtLeft(d.dueAt)}</b></span></div>
        <div class="sum-row"><span class="k">押注</span><span class="v">${d.tier === 'allin' ? 'ALL IN' : d.tier} · 输赢 ${wzTierStake(d.tier)} 分</span></div>
        <div class="sum-row"><span class="k">奖励</span><span class="v ${reward ? '' : 'muted'}">${reward ? esc(reward) : '（没写）'}</span></div>
        <div class="sum-row"><span class="k">惩罚</span><span class="v ${d.penalty ? '' : 'muted'}">${d.penalty ? esc(d.penalty) : '（没写）'}</span></div>
        <div class="sum-row"><span class="k">怎么做</span><span class="v ${d.exec.trim() ? '' : 'muted'}">${d.exec.trim() ? '已写 ' + d.exec.trim().length + ' 字' : '（还没写，立完再写也行）'}</span></div>
      </div>
      <div class="wz-warn">做到：+${wzTierStake(d.tier)} 活力值，奖励当场兑现。做不到：−${wzTierStake(d.tier)} 活力值${d.source === 'todo' ? '，退回待办' : ''}，目标关闭。</div>`
  }

  const body = $('#wzBody')
  body.innerHTML = html
  if (dir) {
    body.classList.remove('step-anim-next', 'step-anim-prev')
    void body.offsetWidth
    body.classList.add(dir === 'prev' ? 'step-anim-prev' : 'step-anim-next')
  }
  bindWizardStep()
}

function bindWizardStep() {
  const { step, data: d } = State.wz
  $$('#wzBody [data-seg]').forEach((b) => b.addEventListener('click', () => {
    d[b.dataset.seg] = b.dataset.v
    renderWizard()
  }))
  $$('#wzBody [data-pick]').forEach((b) => b.addEventListener('click', () => {
    d.pickId = b.dataset.pick
    renderWizard()
  }))
  $$('#wzBody [data-wishpick]').forEach((b) => b.addEventListener('click', () => {
    d.rewardPick = b.dataset.wishpick
    renderWizard()
  }))
  const title = $('#wzTitle')
  if (title) title.addEventListener('input', () => { d.title = title.value; $('#wzNext').disabled = !wzValid() })
  if (step === 2) {
    $$('#wzBody [data-due]').forEach((b) => b.addEventListener('click', () => {
      const q = QUICK_DUES.find((x) => x.label === b.dataset.due)
      d.dueAt = q.fn()
      d.dueQuick = q.label
      renderWizard()
    }))
    const due = $('#wzDue')
    if (due) due.addEventListener('change', () => {
      const t = new Date(due.value).getTime()
      if (t) { d.dueAt = t; d.dueQuick = null; renderWizard() }
    })
    $$('#wzBody [data-tier]').forEach((b) => b.addEventListener('click', () => {
      d.tier = b.dataset.tier
      renderWizard()
    }))
  }
  if (step === 3) {
    const reward = $('#wzReward')
    if (reward) reward.addEventListener('input', () => { d.reward = reward.value })
  }
  if (step === 4) {
    const penalty = $('#wzPenalty')
    if (penalty) penalty.addEventListener('input', () => { d.penalty = penalty.value })
  }
  if (step === 5) {
    const exec = $('#wzExec')
    if (exec) exec.addEventListener('input', () => { d.exec = exec.value })
  }
}

async function submitWizard() {
  const d = State.wz.data
  const title = d.source === 'todo' ? (wzPickedTodo()?.title || '') : d.title.trim()
  const reward = d.rewardFrom === 'wish' ? (State.wishes.find((w) => w.id === d.rewardPick)?.title || '') : d.reward.trim()
  const btn = $('#wzNext')
  btn.disabled = true
  btn.textContent = '押注中…'
  try {
    await Api.createGoal({
      archiveId: 'a3', title, tier: d.tier, stake: wzTierStake(d.tier),
      dueAt: d.dueAt, reward, penalty: d.penalty.trim(), exec: d.exec,
      source: d.source, todoId: d.source === 'todo' ? d.pickId : null,
    })
    /* 从待办来的 → 立项后移出清单（真实现由后端做） */
    if (d.source === 'todo') DB.todos = DB.todos.filter((t) => t.id !== d.pickId)
    closeWizard()
    invalidateAll()
    setView('goals')
    toast(`已押注设立「${title}」`)
  } catch (e) {
    btn.disabled = false
    btn.textContent = '押注设立'
    toast('出错了，再试一次')
  }
}

/* ---------- 待办编辑抽屉 ---------- */
function openTodoSheet(mode, id) {
  State.sheet = { mode, id: id || null }
  const t = id ? State.todos.find((x) => x.id === id) : null
  $('#sheetTitle').textContent = mode === 'new' ? '记一条待办' : '编辑待办'
  $('#sheetInput').value = t?.title || ''
  $('#sheetText').value = t?.text || ''
  $('#todoSheet').hidden = false
  if (mode === 'new') setTimeout(() => $('#sheetInput').focus(), 60)
}
function closeTodoSheet() { $('#todoSheet').hidden = true }
async function saveTodoSheet() {
  const title = $('#sheetInput').value.trim()
  if (!title) { toast('先写个标题'); return }
  const payload = { title, text: $('#sheetText').value }
  if (State.sheet.id) payload.id = State.sheet.id
  const saved = await Api.saveTodo(payload)
  /* 本地同步，避免整列表闪骨架 */
  if (State.sheet.id) {
    const hit = State.todos.find((x) => x.id === State.sheet.id)
    if (hit) Object.assign(hit, saved)
  } else {
    State.todos.unshift(saved)
  }
  closeTodoSheet()
  toast('已保存')
  if (State.view === 'todos') renderTodos()
}

/* ---------- 通用确认抽屉 ---------- */
function openConfirm({ title, text, okText, onOk }) {
  $('#confirmTitle').textContent = title
  $('#confirmText').textContent = text
  $('#confirmOk').textContent = okText || '确定'
  State.confirm.onOk = onOk
  $('#confirmSheet').hidden = false
}
const closeConfirm = () => { $('#confirmSheet').hidden = true; State.confirm.onOk = null }

/* ---------- 视图切换 ---------- */
function setView(v) {
  State.view = v
  document.body.dataset.view = v
  renderView(v)
}
async function renderView(v) {
  if (v === 'home') { await ensureDash(); await ensureGoals(); renderVitality(); renderFeed() }
  else if (v === 'todos') await renderTodos()
  else if (v === 'goals') await renderGoals()
  else if (v === 'wishes') await renderWishes()
  else if (v === 'history') await renderHistory()
}
/** 首页动态流里要点开目标 → 需要一份 goals 缓存 */
async function ensureGoals() { if (!loaded.goals) { State.goals = await Api.getGoals(); loaded.goals = true } }

/* ---------- 动作分发（唯一入口） ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  const id = el.dataset.id

  if (act === 'open-wizard') openWizard()
  else if (act === 'new-todo') openTodoSheet('new')
  else if (act === 'todo-open') openTodoSheet('edit', id)
  else if (act === 'todo-check') {
    const t = State.todos.find((x) => x.id === id)
    const was = t.done
    await Api.saveTodo({ id, done: !was })
    t.done = !was            /* 本地同步，避免整列表闪骨架 */
    toast(was ? '放回清单了' : '已勾掉')
    renderTodos()
  }
  else if (act === 'wish-toggle') {
    const w = await Api.toggleWish(id)
    const hit = State.wishes.find((x) => x.id === id)
    if (hit) hit.status = w.status   /* 本地同步，避免整列表闪骨架 */
    toast(w.status === 'done' ? '兑现了，去享受吧' : '放回愿望单')
    renderWishes()
  }
  else if (act === 'open-goal') openDetail(id)
  else if (act === 'detail-back') closeDetail()
  else if (act === 'complete') {
    const g = DB.goals.find((x) => x.id === State.detailId)
    if (!g) return
    const r = await Api.completeGoal(g.id)
    State.goals = State.goals.filter((x) => x.id !== g.id)
    loaded.dash = loaded.wishes = loaded.todos = loaded.history = false
    closeDetail()
    toast(`已 +${r.gained} 活力值 · 奖励兑现：${r.reward || '（没写奖励）'}`)
    renderView(State.view)
  }
  else if (act === 'give-up') {
    const g = DB.goals.find((x) => x.id === State.detailId)
    if (!g) return
    openConfirm({
      title: '放弃这个目标？',
      text: `放弃 = 做不到：扣 ${g.stake} 活力值${g.source === 'todo' ? '，并退回待办（次数不动）' : ''}。`,
      okText: '放弃',
      onOk: async () => {
        const r = await Api.giveUpGoal(g.id)
        State.goals = State.goals.filter((x) => x.id !== g.id)
        loaded.dash = loaded.todos = loaded.history = false
        closeConfirm()
        closeDetail()
        toast(`已 −${r.lost} 活力值${r.returned ? ' · 已退回待办' : ''}`)
        renderView(State.view)
      },
    })
  }
  else if (act === 'wz-next') {
    if (State.wz.step === 6) await submitWizard()
    else { State.wz.step += 1; renderWizard('next') }
  }
  else if (act === 'wz-prev') { if (State.wz.step > 1) { State.wz.step -= 1; renderWizard('prev') } }
  else if (act === 'wz-back') { closeWizard(); toast('已取消') }
  else if (act === 'sheet-cancel') closeTodoSheet()
  else if (act === 'sheet-save') await saveTodoSheet()
  else if (act === 'confirm-cancel') closeConfirm()
  else if (act === 'confirm-ok') { const fn = State.confirm.onOk; if (fn) await fn() }
  else if (act === 'pick-archive') {
    State.archiveId = id
    renderHistory()
  }
  else if (act === 'seal') {
    const cur = State.archives.find((a) => a.id === State.archiveId)
    if (!cur) return
    openConfirm({
      title: `封档「${cur.name}」？`,
      text: '还有未了结的事，会扣当前活力值的 10%；全部走奖励分支则免费。',
      okText: '封档',
      onOk: async () => {
        const r = await Api.sealArchive(cur.id)
        closeConfirm()
        invalidateAll()
        toast(`已封档 · 扣 ${Math.abs(r.penalty)} 活力值`)
        renderHistory()
      },
    })
  }
})

/* ---------- 底部 tab（nav 冻结，唯一 active 机制） ---------- */
$$('.tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)))

/* ---------- 启动 ---------- */
setView('home')
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import NodeList from '../components/NodeList.vue'
import LoginCard from '../components/LoginCard.vue'
import WishList from '../components/WishList.vue'
import TodosList from '../components/TodosList.vue'
import type { GameNode, Wish, Todo } from '../lib/game'

// dev-only 排版预览：真实组件 + 假数据，不连库。
// 打开 http://localhost:5173/preview.html 看，构建时不会被打包。
// tab 顺序与 App 的底部导航一致：0 首页 / 1 执行 / 2 待办 / 3 愿望 / 4 历史 / 5 表单
// 另外支持 ?theme=light|dark、?sheet=1（设目标抽屉）、?more=1、?debug=1、?update=1、?fail=1。
// ?auth=login|code-email|code-verify|code-password 直接看登录那几步。

const DAY = 86_400_000
const at = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
/** 带具体时刻的死线（v1.4）：0 点的走「前一天全天」，非 0 点的直接显示时刻 */
const atHM = (offsetDays: number, h: number, m = 0) => {
  const d = new Date(Date.now() + offsetDays * DAY)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const base: GameNode = {
  id: '', archive_id: 'a1', user_id: 'u1', kind: 'A', parent_id: null,
  content: '', tier: 'low', stake: 5, due_at: at(1), status: 'active',
  created_at: new Date().toISOString(), completed_at: null,
  compound_a_done: null, compound_c_done: null, wish_id: null, todo_id: null,
}
const mk = (o: Partial<GameNode>): GameNode => ({ ...base, ...o })

const nodes: GameNode[] = [
  mk({ id: 'a1', kind: 'A', content: '做完 660 题第三章', due_at: atHM(1, 18) }),
  mk({ id: 'b1', kind: 'B', parent_id: 'a1', content: '看一集纪录片', status: 'bound', due_at: atHM(1, 18) }),
  mk({ id: 'c1', kind: 'C', parent_id: 'a1', content: '把堆着的快递盒清掉', status: 'bound', due_at: atHM(4, 9, 30) }),

  mk({
    id: 'a2', kind: 'A', content: '跑完半马训练计划', status: 'settled', due_at: at(-2),
  }),
  mk({ id: 'b2', kind: 'B', parent_id: 'a2', content: '买那个键盘', status: 'bound', due_at: at(-2) }),
  mk({
    id: 'c2', kind: 'C', parent_id: 'a2', content: '把简历模板重写一遍',
    status: 'active', due_at: at(4),
  }),

  mk({
    id: 'a3', kind: 'A', content: '投完 20 家简历', status: 'settled',
    due_at: at(-3), completed_at: new Date().toISOString(),
  }),
  mk({ id: 'b3', kind: 'B', parent_id: 'a3', content: '去吃一顿好的', status: 'bound', due_at: at(-3) }),
  mk({
    id: 'c3', kind: 'C', parent_id: 'a3', content: '整理作品集文件夹',
    status: 'active', due_at: at(4), completed_at: new Date().toISOString(),
  }),

  mk({
    id: 'a4', kind: 'A', content: '读完《深度工作》', tier: 'mid', stake: 10,
    status: 'settled', due_at: at(-8), compound_a_done: true, compound_c_done: false,
  }),
  mk({ id: 'b4', kind: 'B', parent_id: 'a4', content: '买个新键帽', tier: 'mid', stake: 10, status: 'bound', due_at: at(-8) }),
  mk({
    id: 'c4', kind: 'C', parent_id: 'a4', content: '把书桌彻底收拾一遍',
    tier: 'mid', stake: 10, status: 'settled', due_at: at(-4),
  }),

  mk({
    id: 'a5', kind: 'A', content: '改完作品集第一版', tier: 'mid', stake: 10,
    status: 'settled', due_at: at(-6), completed_at: at(-6),
  }),
  mk({
    id: 'b5', kind: 'B', parent_id: 'a5', content: '买那个键盘', tier: 'mid', stake: 10,
    status: 'settled', due_at: at(-6), completed_at: at(-5),
  }),
  mk({
    id: 'c5', kind: 'C', parent_id: 'a5', content: '把旧简历全删掉',
    tier: 'mid', stake: 10, status: 'bound', due_at: at(-2),
  }),

  // 已过死线、但还没结算 —— 惰性结算留下的中间态。
  // 用来验"完成按钮必须消失，只剩一个『已过死线』"
  mk({ id: 'a6', kind: 'A', content: '把论文初稿写完', due_at: atHM(-1, 9) }),
  mk({ id: 'b6', kind: 'B', parent_id: 'a6', content: '去吃一顿好的', status: 'bound', due_at: atHM(-1, 9) }),
  mk({ id: 'c6', kind: 'C', parent_id: 'a6', content: '把书桌彻底整理一遍', status: 'bound', due_at: atHM(2, 9) }),
]

const openArchives = ['2026 秋招冲刺', '体重管理', '读书计划']
const pendingIdx = [0, 1]

const ledger = [
  { id: 6, amount: 5, text: '奖励 B · 回血', day: '9/15' },
  { id: 5, amount: -10, text: '复合体双未完成 · 再扣 A+C', day: '9/15' },
  { id: 4, amount: -5, text: '进入惩罚复合体 · 扣 C 分', day: '9/15' },
  { id: 3, amount: -5, text: 'A 判负 · 扣押注分', day: '9/15' },
  { id: 2, amount: 20, text: '奖励 B · 回血', day: '9/14' },
  { id: 1, amount: 10, text: '初始活力值', day: '9/14' },
]

const pendingGroups = [
  { id: 'a1', pill: 'p-blue', label: '进行中', text: '做完 660 题第三章', due: '今天 18:00 · 剩 3 小时 20 分', archive: '2026 秋招冲刺' },
  { id: 'a9', pill: 'p-blue', label: '进行中', text: '跑三次 5 公里', due: '明天 09:00 · 剩 18 小时', archive: '体重管理' },
  { id: 'a2', pill: 'p-amber', label: '复合体', text: '跑完半马训练计划', due: '9/21 全天 · 剩 3 天', archive: '2026 秋招冲刺' },
  { id: 'a3', pill: 'p-amber', label: '复合体', text: '投完 20 家简历', due: '9/21 全天 · 剩 3 天', archive: '2026 秋招冲刺' },
]

const sealed = [
  { id: 's1', name: '2026 春招', at: '2026/8/30 22:14', goals: 6, free: false, penalty: -3, net: 12 },
  { id: 's2', name: '减肥第一季', at: '2026/7/12 09:02', goals: 4, free: true, penalty: 0, net: -8 },
]

const wishes: Wish[] = [
  { id: 'w1', user_id: 'u1', content: '看一集纪录片', status: 'open', done_at: null, done_archive_id: null, created_at: at(-6) },
  { id: 'w2', user_id: 'u1', content: '买那个一直加在购物车的键盘', status: 'open', done_at: null, done_archive_id: null, created_at: at(-4) },
  { id: 'w3', user_id: 'u1', content: '去吃一顿好的', status: 'open', done_at: null, done_archive_id: null, created_at: at(-2) },
  { id: 'w4', user_id: 'u1', content: '睡到自然醒', status: 'open', done_at: null, done_archive_id: null, created_at: at(-1) },
  { id: 'w5', user_id: 'u1', content: '买本《深度工作》', status: 'done', done_at: at(-5), done_archive_id: 'a5', created_at: at(-20) },
  { id: 'w6', user_id: 'u1', content: '买个新键帽', status: 'done', done_at: at(-8), done_archive_id: 'a4', created_at: at(-30) },
]

// times_* = 电量格（0017）。默认 1 = 一次性的；> 1 的才显示格子。
// 这里 t2 / t4 故意留成多次，用来看格子在不同数量下的样子。
const todos: Todo[] = [
  { id: 't1', user_id: 'u1', content: '把书桌彻底收拾一遍', status: 'open', times_total: 1, times_left: 1, done_at: null, taken_at: null, created_at: at(-7) },
  { id: 't2', user_id: 'u1', content: '跑三次 5 公里', status: 'open', times_total: 3, times_left: 2, done_at: null, taken_at: null, created_at: at(-5) },
  { id: 't3', user_id: 'u1', content: '把简历模板重写一遍', status: 'open', times_total: 1, times_left: 1, done_at: null, taken_at: null, created_at: at(-3) },
  { id: 't4', user_id: 'u1', content: '给爸妈打电话', status: 'open', times_total: 6, times_left: 5, done_at: null, taken_at: null, created_at: at(-2) },
  { id: 't5', user_id: 'u1', content: '整理作品集文件夹', status: 'done', times_total: 1, times_left: 0, done_at: at(-1), taken_at: null, created_at: at(-9) },
  { id: 't6', user_id: 'u1', content: '退掉不用的订阅', status: 'done', times_total: 1, times_left: 0, done_at: at(-4), taken_at: null, created_at: at(-12) },
]

// tab 顺序与 App 的底部导航一致：0 首页 / 1 待办 / 2 执行 / 3 愿望 / 4 历史 / 5 设目标表单
const tabs = ['首页', '待办', '执行', '愿望', '历史', '表单']
const q = new URLSearchParams(location.search)
const tab = ref(Number(q.get('tab') ?? 0))
const theme = ref<'light' | 'dark'>(q.get('theme') === 'dark' ? 'dark' : 'light')

/** ?auth=... 时整屏渲染登录/注册流程（走真实组件，不调接口） */
type AuthStep = 'login' | 'code-email' | 'code-verify' | 'code-password'
const authMode = ref<AuthStep | null>((q.get('auth') as AuthStep | null) ?? null)

// ---- 设目标表单的预览状态（死线精确到时刻；C 的日期在 A 当天起 3 天内、必须晚于 A）----
const pDue = ref('2026-08-01T18:00')
const pOffset = ref(Number(q.get('pday') ?? 3))
/** C 的到期时刻。默认跟 A 一致 → 补做窗口正好是整 1/2/3 天 */
const pPenaltyTime = ref('18:00')
/** 目标来源：?goal=free 切到「自己写」，默认演示"从目标单选" */
const pGoalSource = ref<'todo' | 'free'>(q.get('goal') === 'free' ? 'free' : 'todo')
const pTodoId = ref('t1')
const pGoalText = ref('')
/** 奖励来源：?reward=free 切到「自己写」，默认演示"从愿望单选" */
const pRewardSource = ref<'wish' | 'free'>(q.get('reward') === 'free' ? 'free' : 'wish')
const pWishId = ref('w1')
const pRewardText = ref('')
const pSaveToWishlist = ref(true)
/** 底部抽屉：?sheet=1 或切到「表单」页签时自动打开 */
const showSheet = ref(tab.value === 5 || q.get('sheet') === '1')
/** 顶栏「更多」抽屉：?more=1 可直接截图 */
const showMore = ref(q.get('more') === '1')

function shift(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const shortD = (s: string) => {
  const [, m, d] = s.slice(0, 10).split('-').map(Number)
  return `${m}/${d}`
}
const pDueDatePart = computed(() => pDue.value.slice(0, 10))
const pOptions = computed(() =>
  [0, 1, 2, 3].map((o) => ({
    o,
    label: o === 0 ? '当天' : `后 ${o} 天`,
    date: shift(pDueDatePart.value, o),
    hint: `${shortD(shift(pDueDatePart.value, o))} ${o === 0 ? '18:30' : pPenaltyTime.value}`,
  }))
)
const pPenaltyDate = computed(() => shift(pDueDatePart.value, pOffset.value))

function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme.value)
}
// ---- 临时诊断：?debug=1 时把横向溢出的元素列出来 ----
const debugInfo = ref('')
onMounted(() => {
  applyTheme()
  if (!q.get('debug')) return
  setTimeout(() => {
    const vw = document.documentElement.clientWidth
    const out: string[] = [`vw=${vw} scrollW=${document.documentElement.scrollWidth}`]
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 0.5 && r.width > 0) {
        const cls = (el.className as string)?.toString().slice(0, 46)
        out.push(`${el.tagName.toLowerCase()}.${cls} w=${Math.round(r.width)} r=${Math.round(r.right)}`)
      }
    })
    debugInfo.value = out.slice(0, 24).join('\n')
  }, 1200)
})
function toggle() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  applyTheme()
}

const openNodes = computed(() => nodes.filter((n) => ['a1', 'a2', 'a3', 'a6', 'b1', 'b2', 'b3', 'b6', 'c1', 'c2', 'c3', 'c6'].includes(n.id)))
const closedNodes = computed(() => nodes.filter((n) => ['a4', 'a5', 'b4', 'b5', 'c4', 'c5'].includes(n.id)))
</script>

<template>
  <LoginCard v-if="authMode" :dev-preview="authMode" />

  <div v-else class="rt">
    <pre v-if="debugInfo" style="position: fixed; inset: 0 0 auto 0; z-index: 99; margin: 0; padding: 6px;
      background: #fff; color: #000; font-size: 10px; line-height: 1.35; white-space: pre-wrap">{{ debugInfo }}</pre>
    <header class="rt-appbar">
      <div class="rt-appbar-inner">
        <span class="rt-brand">RTarget</span>
        <span class="rt-meta rt-num">2026/9/16 11:46:53</span>
        <span class="rt-push"></span>
        <button class="rt-iconbtn" @click="toggle()" aria-label="切换深浅色">
          <svg v-if="theme === 'dark'" class="rt-ico" width="19" height="19" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
          </svg>
          <svg v-else class="rt-ico" width="19" height="19" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />
          </svg>
        </button>
        <button class="rt-iconbtn" aria-label="更多" @click="showMore = true">
          <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5.2" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="18.8" r="1.6" />
          </svg>
        </button>
      </div>
    </header>

    <main class="rt-main">
      <div class="rt-chips" style="margin-bottom: 8px">
        <span class="rt-meta">排版预览（dev only）· 顶栏右侧按钮可切深浅色</span>
      </div>

      <!-- 执行（tab=2） -->
      <template v-if="tab === 2">
        <div class="rt-chips">
          <button v-for="(a, i) in openArchives" :key="a" class="rt-chip" :class="{ active: i === 0 }">
            <span v-if="pendingIdx.includes(i)" class="rt-dot"></span>{{ a }}
          </button>
          <button class="rt-chip rt-chip-add">+ 新档</button>
        </div>
        <div class="rt-line1 rt-gap8">
          <span class="rt-meta">红点表示这个存档里还有事没做完</span>
          <span class="rt-btns"><button class="rbtn rbtn-danger rt-push">封档</button></span>
        </div>
        <NodeList class="rt-gap12" :nodes="openNodes" variant="open" />
      </template>

      <!-- 首页（tab=0） -->
      <template v-else-if="tab === 0">
        <!-- 数据没拉到（真实那处在 App.vue）。?fail=1 才出现 -->
        <button v-if="q.get('fail')" class="rt-alert rt-alert-bad">
          <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8.6" />
            <path d="M12 7.6v5.2M12 16.2h.01" />
          </svg>
          <span class="rt-alert-tx">
            <span class="rt-t14s">没加载出来</span>
            <span class="rt-meta rt-alert-sub">连不上服务器。检查下网络，然后点这里重试</span>
          </span>
          <span class="rt-meta rt-push" style="white-space: nowrap">重试 →</span>
        </button>

        <!-- 有新版本（真实那处在 App.vue，这里手写一份看样式）。?update=1 才出现 -->
        <button v-if="q.get('update')" class="rt-alert rt-alert-up">
          <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.8v10.4M7.6 10.2 12 14.6l4.4-4.4M4.6 19.4h14.8" />
          </svg>
          <span class="rt-alert-tx">
            <span class="rt-t14s">有新版本可用</span>
            <span class="rt-meta rt-alert-sub">新版 9/18 14:52 · 当前 9/18 10:58</span>
          </span>
          <span class="rt-meta rt-push" style="white-space: nowrap">更新 →</span>
        </button>

        <!-- 临期提醒（真实那处在 App.vue，这里手写一份看样式） -->
        <button class="rt-alert">
          <span class="rt-alert-tx">
            <span class="rt-t14s">今天 18:00 有一件要到点</span>
            <span class="rt-meta rt-alert-sub">做完 660 题第三章 · 剩 3 小时 20 分</span>
          </span>
          <span class="rt-meta rt-push" style="white-space: nowrap">去处理 →</span>
        </button>

        <div class="rt-card rt-vital">
          <div>
            <p class="rt-meta" style="margin: 0">活力值</p>
            <p class="rt-vital-num rt-num" style="color: var(--rt-green)">10</p>
          </div>
          <div class="rt-vital-side">
            <span class="rt-meta">累计奖励 <span class="rt-num" style="color: var(--rt-green)">+35</span></span>
            <span class="rt-meta">累计扣除 <span class="rt-num" style="color: var(--rt-red)">-25</span></span>
          </div>
        </div>
        <p class="rt-meta rt-note">不留小数 · 活力值为负时禁押高档与 ALL IN</p>

        <div class="rt-card rt-strip rt-gap12">
          <div>
            <p class="rt-meta" style="margin: 0">未封档存档</p>
            <p class="rt-strip-val">3</p>
          </div>
          <div>
            <p class="rt-meta" style="margin: 0">进行中的目标</p>
            <p class="rt-strip-val">2</p>
          </div>
          <div>
            <p class="rt-meta" style="margin: 0">惩罚复合体中</p>
            <p class="rt-strip-val" style="color: var(--rt-amber)">2</p>
          </div>
          <div>
            <p class="rt-meta" style="margin: 0">已完成的目标</p>
            <p class="rt-strip-val">4</p>
          </div>
        </div>

        <div class="rt-card rt-pad rt-gap12">
          <div class="rt-line1">
            <span class="rt-sec">未完成的事</span>
            <span class="rt-meta rt-push">4 件</span>
          </div>
          <div style="margin-top: 4px">
            <div v-for="g in pendingGroups" :key="g.id" class="rt-li">
              <span class="pill" :class="g.pill">{{ g.label }}</span>
              <div class="rt-li-2">
                <div class="rt-li-2-t">{{ g.text }}</div>
                <div class="rt-meta">
                  {{ g.due }} <span style="opacity: 0.7">· {{ g.archive }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rt-card rt-pad rt-gap12">
          <div class="rt-line1">
            <span class="rt-sec">流水账</span>
            <span class="rt-meta rt-push">最近 100 笔</span>
          </div>
          <div style="margin-top: 4px">
            <div v-for="l in ledger" :key="l.id" class="rt-li">
              <span class="rt-num" style="flex: 0 0 36px; text-align: right"
                :style="{ color: l.amount > 0 ? 'var(--rt-green)' : l.amount < 0 ? 'var(--rt-red)' : 'var(--rt-tx2)' }">
                {{ l.amount > 0 ? '+' : '' }}{{ l.amount }}
              </span>
              <div class="rt-li-2">
                <div class="rt-li-2-t">{{ l.text }}</div>
                <div class="rt-meta">{{ l.day }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 待办（tab=1）· 走真实组件 -->
      <template v-else-if="tab === 1">
        <TodosList :todos="todos" />
      </template>

      <!-- 愿望单（tab=3）· 走真实组件 -->
      <template v-else-if="tab === 3">
        <WishList :wishes="wishes" />
      </template>

      <!-- 历史（tab=4） -->
      <template v-else-if="tab === 4">
        <div class="rt-line1">
          <span class="rt-sec">封档记录</span>
          <span class="rt-meta rt-push">2 个存档</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px">
          <div v-for="s in sealed" :key="s.id" class="rt-card rt-cardwrap">
            <div class="rt-rail rt-rail-gray"></div>
            <div class="rt-node-body rt-pad">
              <div class="rt-line1">
                <span class="pill p-gray">已封档</span>
                <span class="rt-t14s rt-flex1">{{ s.name }}</span>
                <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" aria-label="删除存档">
                  <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
                    <path d="M10.4 10.6v5.6M13.6 10.6v5.6" />
                  </svg>
                </button>
              </div>
              <p class="rt-meta" style="margin: 3px 0 0">{{ s.at }}</p>
              <div class="rt-line2" style="gap: 8px 18px">
                <span class="rt-meta">目标 <span class="rt-num" style="color: var(--rt-tx)">{{ s.goals }}</span> 个</span>
                <span class="rt-meta">封档
                  <span v-if="s.free" class="rt-num" style="color: var(--rt-green)">免费（全部完成）</span>
                  <span v-else class="rt-num" style="color: var(--rt-red)">扣 {{ Math.abs(s.penalty) }} 分</span>
                </span>
                <span class="rt-meta">净收支
                  <span class="rt-num" :style="{ color: s.net >= 0 ? 'var(--rt-green)' : 'var(--rt-red)' }">
                    {{ s.net >= 0 ? '+' : '' }}{{ s.net }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="rt-gap20" style="padding-top: 16px; border-top: 0.5px solid var(--rt-line)">
          <div class="rt-line1">
            <span class="rt-sec">已完成的目标</span>
          </div>
          <div style="margin-top: 10px; padding: 6px 12px; border: 0.5px solid var(--rt-line-strong); border-radius: 8px; color: var(--rt-tx2)">
            2026 春招（已封档）
          </div>
        </div>

        <NodeList class="rt-gap12" :nodes="closedNodes" variant="closed" />
      </template>

      <!-- 设目标表单（真实弹窗：底部抽屉） -->
      <template v-else>
        <div class="rt-card rt-pad rt-center-tx">
          <p class="rt-meta" style="margin: 0 0 4px">「设一个新目标」在真实应用里是底部抽屉</p>
          <p class="rt-meta" style="margin: 0 0 12px">?sheet=1 可直接打开截图</p>
          <button class="rbtn-primary rbtn-lg" @click="showSheet = true">打开抽屉</button>
        </div>
        <p class="rt-meta rt-hint" style="padding: 0 2px">
          抽屉里改 A 死线日期，三个选项会跟着重算 —— 试一下 2026-08-01，就是需求里那个例子。
          A 死线的最小可选值是今天（今天做完，次日 0 点才判负）。
        </p>
      </template>
    </main>

    <nav class="rt-tabbar">
      <div class="rt-tabbar-inner">
        <button v-for="(t, i) in tabs" :key="t" class="rt-tab" :class="{ active: tab === i }"
          @click="tab = i">
          <span class="rt-tab-ico">
            <svg v-if="i === 0" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.6 10.4 12 3.8l8.4 6.6" /><path d="M5.8 9.3V20h12.4V9.3" />
            </svg>
            <svg v-else-if="i === 1" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="M4.4 6.6h2.4M4.4 12h2.4M4.4 17.4h2.4" />
              <path d="M10.6 6.6h9M10.6 12h9M10.6 17.4h9" />
            </svg>
            <svg v-else-if="i === 2" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <circle cx="12" cy="12" r="8.3" /><circle cx="12" cy="12" r="3.4" />
            </svg>
            <svg v-else-if="i === 3" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z" />
            </svg>
            <svg v-else-if="i === 4" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="8.3" /><path d="M12 7.4V12l3.2 1.9" />
            </svg>
            <svg v-else class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4.6" y="3.8" width="14.8" height="16.4" rx="2" />
              <path d="M8.4 8.6h7.2M8.4 12h7.2M8.4 15.4h4.4" />
            </svg>
            <span v-if="i === 2" class="rt-tab-badge">4</span>
          </span>
          <span>{{ t }}</span>
        </button>
      </div>
    </nav>

    <div v-if="tab === 2" class="rt-fabwrap">
      <div class="rt-fabwrap-inner">
        <button class="rt-fab" aria-label="设一个新目标" @click="showSheet = true">
          <svg class="rt-ico" width="26" height="26" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5.5v13M5.5 12h13" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 真实弹窗（antd Modal + rt-sheet：底部抽屉） -->
    <a-modal v-model:open="showMore" title="账号" :footer="null" :width="580"
      wrap-class-name="rt-sheet">
      <p class="rt-meta" style="margin: 0">jackie@rtarget.app</p>
      <div class="rt-sheetlist">
        <button class="rt-sheetitem">刷新数据</button>
        <button class="rt-sheetitem rt-sheetitem-danger">退出登录</button>
      </div>
    </a-modal>

    <a-modal v-model:open="showSheet" title="设一个新目标" :footer="null" :width="580"
      wrap-class-name="rt-sheet">
      <a-form layout="vertical">
        <a-form-item label="目标 A（押注）· 这件事是什么">
          <div class="rt-seg" style="margin-bottom: 10px">
            <button type="button" class="rt-segbtn" :class="{ active: pGoalSource === 'todo' }"
              @click="pGoalSource = 'todo'">
              <span>从目标单选</span>
              <span class="rt-meta">4 条待办</span>
            </button>
            <button type="button" class="rt-segbtn" :class="{ active: pGoalSource === 'free' }"
              @click="pGoalSource = 'free'">
              <span>自己写</span>
              <span class="rt-meta">临时起意</span>
            </button>
          </div>

          <a-select v-if="pGoalSource === 'todo'" v-model:value="pTodoId"
            :options="todos.filter((t) => t.status === 'open').map((t) => ({ value: t.id, label: t.content }))"
            style="width: 100%" />
          <a-input v-else v-model:value="pGoalText" placeholder="比如：做完 660 题第三章" />
        </a-form-item>
        <p v-if="pGoalSource === 'todo'" class="rt-meta" style="margin: -14px 0 12px">
          立项后这条会从目标单移出，事情就进「执行」页了。
        </p>

        <div class="rt-form-row">
          <a-form-item label="档位" style="flex: 1">
            <a-select value="low">
              <a-select-option value="low">低（5 分）</a-select-option>
            </a-select>
          </a-form-item>
        </div>
        <a-form-item label="A 死线（做到这一刻，到点判负）">
          <a-input v-model:value="pDue" type="datetime-local" />
        </a-form-item>

        <a-form-item label="奖励 B（想做的事 · 档位继承 A）">
          <div class="rt-seg" style="margin-bottom: 10px">
            <button type="button" class="rt-segbtn" :class="{ active: pRewardSource === 'wish' }"
              @click="pRewardSource = 'wish'">
              <span>从愿望单选</span>
              <span class="rt-meta">4 个待实现</span>
            </button>
            <button type="button" class="rt-segbtn" :class="{ active: pRewardSource === 'free' }"
              @click="pRewardSource = 'free'">
              <span>自己写</span>
              <span class="rt-meta">临时起意</span>
            </button>
          </div>

          <a-select v-if="pRewardSource === 'wish'" v-model:value="pWishId"
            :options="wishes.filter((w) => w.status === 'open').map((w) => ({ value: w.id, label: w.content }))"
            style="width: 100%" />
          <template v-else>
            <a-input v-model:value="pRewardText" placeholder="做成 A 后想做的事（无时限，达成即加分）" />
            <a-checkbox v-if="pRewardText" v-model:checked="pSaveToWishlist" style="margin-top: 8px">
              顺手存进愿望单
            </a-checkbox>
          </template>
        </a-form-item>
        <p v-if="pRewardSource === 'wish'" class="rt-meta" style="margin: -12px 0 16px">
          A 达成的那一刻这个愿望就算兑现，会自动从待实现里划掉。
        </p>

        <a-form-item label="惩罚 C（一直拖延的事 · 档位继承 A）">
          <a-input placeholder="如果没做成，被强制面对的事" />
        </a-form-item>

        <a-form-item label="C 死线（A 当天起 3 天内 · 必须晚于 A 的死线）">
          <div class="rt-seg">
            <button v-for="o in pOptions" :key="o.o" type="button" class="rt-segbtn"
              :class="{ active: pOffset === o.o }" @click="pOffset = o.o">
              <span>{{ o.label }}</span>
              <span class="rt-meta">{{ o.hint }}</span>
            </button>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px">
            <span class="rt-meta">C 到期时刻</span>
            <a-input v-model:value="pPenaltyTime" type="time" style="width: 140px" />
          </div>
          <p v-if="pOffset === 0" class="rt-meta" style="margin: 8px 0 0">
            C 在 A 当天的话必须晚于 A 的死线（{{ pDue.slice(11, 16) }}），最早只能 18:30
          </p>
        </a-form-item>
        <p class="rt-meta" style="margin: -12px 0 16px">
          A 死线 {{ shortD(pDue) }} {{ pDue.slice(11, 16) }}（到点判负）· C 死线
          {{ shortD(pPenaltyDate) }} {{ pPenaltyTime }} —— 改上面的日期和时刻，几个选项会跟着重算
        </p>

        <div class="rt-sheet-actions">
          <button class="rbtn-primary">押注设立</button>
          <button class="rbtn" @click="showSheet = false">取消</button>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

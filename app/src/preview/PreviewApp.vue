<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import NodeList from '../components/NodeList.vue'
import type { GameNode } from '../lib/game'

// dev-only 排版预览：真实组件 + 假数据，不连库。
// 打开 http://localhost:5173/preview.html 看，构建时不会被打包。

const DAY = 86_400_000
const at = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

const base: GameNode = {
  id: '', archive_id: 'a1', user_id: 'u1', kind: 'A', parent_id: null,
  content: '', tier: 'low', stake: 5, due_at: at(1), status: 'active',
  created_at: new Date().toISOString(), completed_at: null,
  compound_a_done: null, compound_c_done: null,
}
const mk = (o: Partial<GameNode>): GameNode => ({ ...base, ...o })

const nodes: GameNode[] = [
  mk({ id: 'a1', kind: 'A', content: '做完 660 题第三章', due_at: at(1) }),
  mk({ id: 'b1', kind: 'B', parent_id: 'a1', content: '看一集纪录片', status: 'bound', due_at: at(1) }),
  mk({ id: 'c1', kind: 'C', parent_id: 'a1', content: '把堆着的快递盒清掉', status: 'bound', due_at: at(4) }),

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
  { id: 'a2', pill: 'p-amber', label: '复合体', text: '跑完半马训练计划', archive: '2026 秋招冲刺' },
  { id: 'a3', pill: 'p-amber', label: '复合体', text: '投完 20 家简历', archive: '2026 秋招冲刺' },
  { id: 'a1', pill: 'p-blue', label: '进行中', text: '做完 660 题第三章', archive: '2026 秋招冲刺' },
  { id: 'a9', pill: 'p-blue', label: '进行中', text: '跑三次 5 公里', archive: '体重管理' },
]

const sealed = [
  { id: 's1', name: '2026 春招', at: '2026/8/30 22:14', goals: 6, free: false, penalty: -3, net: 12 },
  { id: 's2', name: '减肥第一季', at: '2026/7/12 09:02', goals: 4, free: true, penalty: 0, net: -8 },
]

const tabs = ['正在执行', '首页', '历史记录', '设目标表单']
// 支持 ?tab=0|1|2|3 与 ?theme=light|dark，方便无头截图逐个页面出图
const q = new URLSearchParams(location.search)
const tab = ref(Number(q.get('tab') ?? 0))
const theme = ref<'light' | 'dark'>(q.get('theme') === 'dark' ? 'dark' : 'light')

// ---- 设目标表单的预览状态（C 死线 = A 之后 1~3 天）----
const pDue = ref('2026-08-01')
const pOffset = ref(3)

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

function shift(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const shortD = (s: string) => {
  const [, m, d] = s.split('-').map(Number)
  return `${m}/${d}`
}
const pOptions = computed(() =>
  [1, 2, 3].map((o) => ({ o, date: shift(pDue.value, o), hint: `${shortD(shift(pDue.value, o))} 截止` }))
)
const pPenaltyDate = computed(() => shift(pDue.value, pOffset.value))

function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme.value)
}
onMounted(applyTheme)
function toggle() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  applyTheme()
}

const openNodes = computed(() => nodes.filter((n) => ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'].includes(n.id)))
const closedNodes = computed(() => nodes.filter((n) => ['a4', 'a5', 'b4', 'b5', 'c4', 'c5'].includes(n.id)))
</script>

<template>
  <div class="rt">
    <header class="rt-top">
      <span class="rt-brand">RTarget</span>
      <span class="rt-meta rt-num">2026/9/15 14:41:53</span>
      <nav class="rt-nav">
        <button v-for="(t, i) in tabs" :key="t" class="rt-navbtn" :class="{ active: tab === i }"
          @click="tab = i">
          {{ t }}<span v-if="i === 0" class="rt-navnum">4</span>
        </button>
      </nav>
      <div class="rt-topright">
        <span class="rt-meta">jackie@rtarget.app</span>
        <button class="rbtn" @click="toggle()">{{ theme === 'light' ? '深色' : '浅色' }}</button>
        <button class="rbtn">刷新</button>
        <button class="rbtn">退出</button>
      </div>
    </header>

    <main class="rt-main">
      <p class="rt-meta" style="margin: 0 0 16px">
        排版预览（dev only）· 真实组件 + 假数据 · 切换顶部「深色 / 浅色」看两种主题
      </p>

      <!-- 正在执行 -->
      <template v-if="tab === 0">
        <div class="rt-bar">
          <div class="rt-chips">
            <button v-for="(a, i) in openArchives" :key="a" class="rt-chip" :class="{ active: i === 0 }">
              <span v-if="pendingIdx.includes(i)" class="rt-dot"></span>{{ a }}
            </button>
          </div>
          <button class="rbtn">+ 新档</button>
          <div class="rt-push" style="display: flex; gap: 8px">
            <button class="rbtn rbtn-danger">封档</button>
            <button class="rbtn-primary rbtn-lg">+ 设一个新目标</button>
          </div>
        </div>
        <p class="rt-meta" style="margin: 8px 0 14px">红点表示这个存档里还有事没做完</p>

        <NodeList :nodes="openNodes" variant="open" />
      </template>

      <!-- 首页 -->
      <template v-else-if="tab === 1">
        <div class="rt-card" style="padding: 20px 22px; display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap">
          <div>
            <p class="rt-meta" style="margin: 0">活力值（全局血池）</p>
            <p class="rt-num" style="margin: 4px 0 0; font-size: 40px; font-weight: 500; line-height: 1.1; color: var(--rt-green)">10</p>
          </div>
          <div style="display: flex; gap: 20px; margin-bottom: 4px">
            <span class="rt-meta">累计奖励 <span class="rt-num" style="font-size: 13px; color: var(--rt-green)">+35</span></span>
            <span class="rt-meta">累计扣除 <span class="rt-num" style="font-size: 13px; color: var(--rt-red)">-25</span></span>
          </div>
          <span class="rt-meta rt-push" style="margin-bottom: 4px">四舍五入取整 · 穿透负值后禁押高档</span>
        </div>

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

        <div class="rt-cols rt-gap12">
          <div class="rt-card rt-col rt-pad">
            <div class="rt-line1">
              <span class="rt-sec">未完成的事</span>
              <span class="rt-meta rt-push">跨全部未封档存档</span>
            </div>
            <div style="margin-top: 6px">
              <div v-for="g in pendingGroups" :key="g.id" class="rt-li">
                <span class="pill" :class="g.pill">{{ g.label }}</span>
                <span class="rt-li-main">{{ g.text }}</span>
                <span class="rt-meta">{{ g.archive }}</span>
              </div>
            </div>
          </div>

          <div class="rt-card rt-col rt-pad">
            <div class="rt-line1">
              <span class="rt-sec">流水账</span>
              <span class="rt-meta rt-push">最近 100 笔</span>
            </div>
            <div style="margin-top: 6px">
              <div v-for="l in ledger" :key="l.id" class="rt-li">
                <span class="rt-num" style="flex: 0 0 34px; text-align: right; font-size: 13px"
                  :style="{ color: l.amount > 0 ? 'var(--rt-green)' : l.amount < 0 ? 'var(--rt-red)' : 'var(--rt-tx2)' }">
                  {{ l.amount > 0 ? '+' : '' }}{{ l.amount }}
                </span>
                <span class="rt-li-main">{{ l.text }}</span>
                <span class="rt-meta">{{ l.day }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 历史记录 -->
      <template v-else-if="tab === 2">
        <div class="rt-line1" style="margin-bottom: 12px">
          <span class="rt-sec">封档记录</span>
          <span class="rt-meta">{{ sealed.length }} 个档</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px">
          <div v-for="s in sealed" :key="s.id" class="rt-card rt-cardwrap">
            <div class="rt-rail rt-rail-gray"></div>
            <div class="rt-node-body rt-pad">
              <div class="rt-line1">
                <span class="pill p-gray">已封档</span>
                <span class="rt-t14s">{{ s.name }}</span>
                <span class="rt-meta rt-push">{{ s.at }}</span>
                <button class="rbtn rbtn-danger">删除</button>
              </div>
              <div class="rt-line1" style="margin-top: 10px; gap: 22px">
                <span class="rt-meta">目标 <span class="rt-num" style="font-size: 13px; color: var(--rt-tx)">{{ s.goals }}</span> 个</span>
                <span class="rt-meta">封档
                  <span v-if="s.free" class="rt-num" style="font-size: 13px; color: var(--rt-green)">免费（干净了结）</span>
                  <span v-else class="rt-num" style="font-size: 13px; color: var(--rt-red)">扣 {{ Math.abs(s.penalty) }} 分</span>
                </span>
                <span class="rt-meta">本档净收支
                  <span class="rt-num" style="font-size: 13px"
                    :style="{ color: s.net >= 0 ? 'var(--rt-green)' : 'var(--rt-red)' }">
                    {{ s.net >= 0 ? '+' : '' }}{{ s.net }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="rt-line1" style="margin: 24px 0 12px; padding-top: 18px; border-top: 0.5px solid var(--rt-line)">
          <span class="rt-sec">已完成的目标</span>
          <span style="padding: 3px 10px; border-radius: 6px; font-size: 12px; background: var(--rt-sub); margin-left: 10px">
            2026 春招（已封档）
          </span>
        </div>

        <NodeList :nodes="closedNodes" variant="closed" />
      </template>

      <!-- 设目标表单 -->
      <template v-else>
        <div class="rt-card" style="max-width: 580px; padding: 20px 22px">
          <p class="rt-sec" style="margin: 0 0 14px">设一个新目标</p>
          <a-form layout="vertical">
            <a-form-item label="目标 A（押注）· 这件事是什么">
              <a-input placeholder="比如：做完 660 题第三章" />
            </a-form-item>

            <div style="display: flex; gap: 12px">
              <a-form-item label="档位" style="flex: 1">
                <a-select value="low">
                  <a-select-option value="low">低（5 分）</a-select-option>
                </a-select>
              </a-form-item>
              <a-form-item label="A 死线（哪天做完，次日 0 点判负）" style="flex: 1">
                <a-input v-model:value="pDue" type="date" :min="todayStr" />
              </a-form-item>
            </div>

            <a-form-item label="奖励 B（想做的事 · 档位继承 A）">
              <a-input placeholder="做成 A 后想做的事（无时限，达成即加分）" />
            </a-form-item>

            <a-form-item label="惩罚 C（一直拖延的事 · 档位继承 A）">
              <a-input placeholder="如果没做成，被强制面对的事" />
            </a-form-item>

            <a-form-item label="C 死线（哪天做完 · 只能落在 A 死线之后的三天内）">
              <div class="rt-seg">
                <button v-for="o in pOptions" :key="o.o" type="button" class="rt-segbtn"
                  :class="{ active: pOffset === o.o }" @click="pOffset = o.o">
                  <span>后 {{ o.o }} 天</span>
                  <span class="rt-meta">{{ o.hint }}</span>
                </button>
              </div>
            </a-form-item>
            <p class="rt-meta" style="margin: -12px 0 16px">
              A 死线 {{ shortD(pDue) }}（次日 0 点判负）· 惩罚 C 死线 {{ shortD(pPenaltyDate) }}
              —— 这段就是惩罚复合体的补做窗口
            </p>

            <div style="display: flex; gap: 8px">
              <button class="rbtn-primary rbtn-lg">押注设立</button>
              <button class="rbtn rbtn-lg">取消</button>
            </div>
          </a-form>
        </div>
        <p class="rt-meta" style="margin-top: 12px">
          改上面那个 A 死线日期，三个选项会跟着重算 —— 试一下 2026-08-01，就是需求里那个例子。
          A 死线的最小可选值是今天（今天做完，次日 0 点才判负）。
        </p>
      </template>
    </main>
  </div>
</template>

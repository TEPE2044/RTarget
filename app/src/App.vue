<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { theme as antdTheme, message } from 'ant-design-vue'
import { isAuthError, useAuth } from './lib/auth'
import { registerBackButton, syncSystemBars } from './lib/native'
import { useTheme } from './lib/theme'
import {
  settleAll, getVitality, getLedger, getArchives, getAllNodes,
  createArchive, createGoal, sealArchive, deleteArchive, hasPending, inCompound,
  getArchiveLedgerSums, findSealPenalty,
} from './lib/game'
import type { Archive, GameNode, LedgerEntry, Tier } from './lib/game'
import LoginCard from './components/LoginCard.vue'
import NodeList from './components/NodeList.vue'

const { session, loading, signOut, forceSignOut, passwordPending, setPassword } = useAuth()
const { theme, toggleTheme } = useTheme()

// antd v4 ConfigProvider 主题算法（深/浅）
const antdThemeConfig = computed(() => ({
  algorithm: theme.value === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
}))

const userEmail = computed(() => session.value?.user?.email ?? '')

// ---------- 状态 ----------

const vitality = ref(0)
const ledger = ref<LedgerEntry[]>([])
const archives = ref<Archive[]>([])
const allNodes = ref<GameNode[]>([])
const sealSums = ref<Record<string, number>>({})
const busy = ref(false)
const now = ref(new Date())

type PageKey = 'home' | 'running' | 'history'
const page = ref<PageKey>('home')
const activeArchiveId = ref<string | null>(null)
/** 历史记录页当前查看的存档（可以是已封档的） */
const historyArchiveId = ref<string | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

const openArchives = computed(() => archives.value.filter((a) => a.status === 'open'))
const sealedArchives = computed(() => archives.value.filter((a) => a.status === 'sealed'))
const activeArchive = computed(
  () => archives.value.find((a) => a.id === activeArchiveId.value) ?? null
)
/** 当前存档的节点（不单独查库，从全量节点里筛） */
const nodes = computed(() => allNodes.value.filter((n) => n.archive_id === activeArchiveId.value))
const clock = computed(() => now.value.toLocaleString('zh-CN'))

/** 有未完成事情的存档 id —— 存档页签红点 */
const pendingArchiveIds = computed(() => {
  const s = new Set<string>()
  for (const a of openArchives.value) if (hasPending(allNodes.value, a.id)) s.add(a.id)
  return s
})

// ---------- 统计 ----------

interface Group { a: GameNode; c: GameNode | null }
const groupsOf = (list: GameNode[]): Group[] =>
  list
    .filter((n) => n.kind === 'A')
    .map((a) => ({ a, c: list.find((n) => n.parent_id === a.id && n.kind === 'C') ?? null }))

/** 未封档存档里还没完成的目标（进行中 + 复合体中） */
const pendingGroups = computed(() => {
  const openIds = new Set(openArchives.value.map((a) => a.id))
  const list = allNodes.value.filter((n) => openIds.has(n.archive_id))
  return groupsOf(list).filter((g) => g.a.status === 'active' || inCompound(g.a, g.c))
})

const allGroups = computed(() => groupsOf(allNodes.value))
const stats = computed(() => ({
  running: allGroups.value.filter((g) => g.a.status === 'active').length,
  compound: allGroups.value.filter((g) => inCompound(g.a, g.c)).length,
  done: allGroups.value.filter((g) => g.a.status !== 'active' && !inCompound(g.a, g.c)).length,
  gained: ledger.value.filter((l) => l.amount > 0).reduce((s, l) => s + Number(l.amount), 0),
  lost: ledger.value.filter((l) => l.amount < 0).reduce((s, l) => s + Number(l.amount), 0),
}))

/** 底部导航：手机上要短，长词放不下 */
const pages = computed(() => [
  { key: 'home' as PageKey, label: '首页', badge: 0 },
  { key: 'running' as PageKey, label: '执行', badge: pendingGroups.value.length },
  { key: 'history' as PageKey, label: '历史', badge: 0 },
])

const vitalityColor = computed(() =>
  vitality.value < 0 ? 'var(--rt-red)' : vitality.value < 25 ? 'var(--rt-amber)' : 'var(--rt-green)'
)

const reasonText: Record<string, string> = {
  a_failed: 'A 判负 · 扣押注分',
  c_entered: '进入惩罚复合体 · 扣 C 分',
  b_completed: '奖励 B · 回血',
  compound_fail: '复合体双未完成 · 再扣 A+C',
  compound_redeem: '复合体双完成 · 返还 A+C',
}

function archiveName(id: string): string {
  return archives.value.find((a) => a.id === id)?.name ?? '—'
}

/**
 * 统一错误上报。
 * 关键点：登录态失效（账号被删 / token 过期）不能只弹个 toast 了事 ——
 * 那时界面还挂在登录态上、数据全空，用户只会以为"坏了"。必须踢回登录页。
 */
async function reportError(e: unknown, prefix = '') {
  if (isAuthError(e)) {
    await forceSignOut()
    message.warning('登录状态已失效，请重新登录')
    return
  }
  message.error(prefix + (e as Error).message)
}

// ---------- 数据刷新 ----------

async function refresh() {
  busy.value = true
  try {
    await settleAll() // 惰性结算：把到点的账先结掉
    const [v, l, as, ns, sums] = await Promise.all([
      getVitality(), getLedger(100), getArchives(), getAllNodes(), getArchiveLedgerSums(),
    ])
    vitality.value = v
    ledger.value = l
    archives.value = as
    allNodes.value = ns
    sealSums.value = sums

    if (!activeArchiveId.value || !as.some((a) => a.id === activeArchiveId.value)) {
      activeArchiveId.value = as.find((a) => a.status === 'open')?.id ?? null
    }
    if (!historyArchiveId.value) {
      historyArchiveId.value = as.find((a) => a.status === 'sealed')?.id ?? activeArchiveId.value
    }
  } catch (e) {
    await reportError(e, '加载失败：')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 1000) // 顶栏时钟走秒

  // 只有装进壳里才生效，浏览器上是空操作
  registerBackButton({
    hasModalOpen: () =>
      showNewArchive.value || showGoalForm.value || showMore.value || showPassword.value,
    closeModal: () => {
      showNewArchive.value = false
      showGoalForm.value = false
      showMore.value = false
      showPassword.value = false
    },
    currentPage: () => page.value,
    goHome: () => { page.value = 'home' },
  })
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// 壳里让系统栏图标跟着深浅主题走（浏览器上无副作用）
watch(theme, (t) => syncSystemBars(t), { immediate: true })

watch(session, (s) => {
  if (s) refresh()
  else {
    vitality.value = 0
    ledger.value = []
    archives.value = []
    allNodes.value = []
    activeArchiveId.value = null
    historyArchiveId.value = null
  }
}, { immediate: true })

// ---------- 存档 ----------

const showNewArchive = ref(false)
const newArchiveName = ref('')
/** 顶栏「更多」：手机上用底部抽屉，比下拉菜单好点 */
const showMore = ref(false)
/** 改密码抽屉 */
const showPassword = ref(false)
const newPwd1 = ref('')
const newPwd2 = ref('')

async function onChangePassword() {
  if (newPwd1.value.length < 6) return message.warning('密码至少 6 位')
  if (newPwd1.value !== newPwd2.value) return message.warning('两次输的不一样')
  busy.value = true
  try {
    await setPassword(newPwd1.value)
    message.success('密码已更新，下次用新密码登录')
    showPassword.value = false
    newPwd1.value = ''
    newPwd2.value = ''
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

async function addArchive() {
  const name = newArchiveName.value.trim()
  if (!name) return
  busy.value = true
  try {
    const a = await createArchive(name)
    // 先把新档塞进列表再选中，避免页签拿不到名字而闪出 uuid
    archives.value = [a, ...archives.value]
    activeArchiveId.value = a.id
    newArchiveName.value = ''
    showNewArchive.value = false
    message.success(`已创建存档「${a.name}」`)
    await refresh()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

async function onSeal() {
  if (!activeArchive.value) return
  busy.value = true
  try {
    const deducted = await sealArchive(activeArchive.value.id)
    message.success(
      deducted < 0
        ? `已封档，扣除 ${Math.abs(deducted)} 点活力值`
        : '已封档 —— 全部完成，免费'
    )
    activeArchiveId.value = null
    await refresh()
    page.value = 'history'
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

/**
 * 删除已封档的存档。
 * 只会删存档和它的节点；活力值流水保留（只断开归属），所以分数不变 ——
 * 否则「封档扣 10% → 删档」就成了刷分漏洞。
 */
async function onDeleteArchive(a: Archive) {
  busy.value = true
  try {
    const detached = await deleteArchive(a.id)
    if (historyArchiveId.value === a.id) historyArchiveId.value = null
    message.success(
      `已删除存档「${a.name}」` +
      (detached > 0 ? `，${detached} 笔流水转为无归属（活力值不变）` : '')
    )
    await refresh()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

// ---------- 新建目标 ----------
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function localDateStr(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 完成日 → 结算时刻
 * 死线是「你要在哪天做完」：当天 24:00 截止，判负发生在**次日 0 点**。
 * 所以库里存的 due_at = 完成日 + 1 天的 0 点。今天可选。
 */
function dueInstant(workDate: string): string {
  const d = new Date(workDate + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/** 最早只能是今天（今天做，明天 0 点结算） */
const minDueDate = localDateStr(0)

const showGoalForm = ref(false)

/**
 * 惩罚 C 的死线只能是 A 死线之后的 1~3 天（需求）
 * 例：A = 8月1日 → C 只能取 8月2日 / 8月3日 / 8月4日
 */
const PENALTY_OFFSETS = [1, 2, 3] as const
type PenaltyOffset = (typeof PENALTY_OFFSETS)[number]

const goalForm = ref({
  content: '',
  tier: 'low' as Tier,
  dueDate: minDueDate,
  penaltyOffset: 3 as PenaltyOffset,
  reward: { content: '' },
  penalty: { content: '' },
})

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${m}/${d}`
}

/** C 死线由 A 死线 + 偏移算出来，用户不能手填 */
const penaltyDate = computed(() => addDays(goalForm.value.dueDate, goalForm.value.penaltyOffset))
const penaltyOptions = computed(() =>
  PENALTY_OFFSETS.map((offset) => {
    const date = addDays(goalForm.value.dueDate, offset)
    return { offset, label: `后 ${offset} 天`, hint: `${shortDate(date)} 截止` }
  })
)

/** 活力值穿透负值时，高档与 ALL IN 禁用（机制 v1.2） */
const highTiersDisabled = computed(() => vitality.value < 0)

async function addGoal() {
  if (!activeArchiveId.value) return message.warning('先选一个存档')
  if (!goalForm.value.content.trim()) return message.warning('目标内容必填')
  if (!goalForm.value.reward.content.trim()) return message.warning('奖励 B 必填（想做的事）')
  if (!goalForm.value.penalty.content.trim()) return message.warning('惩罚 C 必填（一直拖延的事）')
  if (highTiersDisabled.value && (goalForm.value.tier === 'high' || goalForm.value.tier === 'allin')) {
    return message.warning('活力值为负，高档与 ALL IN 暂不可押')
  }

  busy.value = true
  try {
    await createGoal({
      archiveId: activeArchiveId.value,
      content: goalForm.value.content.trim(),
      tier: goalForm.value.tier,
      dueAt: dueInstant(goalForm.value.dueDate),
      penaltyDueAt: dueInstant(penaltyDate.value),
      reward: { content: goalForm.value.reward.content.trim() },
      penalty: { content: goalForm.value.penalty.content.trim() },
      vitality: vitality.value,
    })
    message.success('已押注设立，到点未申报即判负')
    showGoalForm.value = false
    goalForm.value = {
      content: '', tier: 'low', dueDate: minDueDate, penaltyOffset: 3,
      reward: { content: '' },
      penalty: { content: '' },
    }
    await refresh()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

// ---------- 历史记录 ----------

const historyNodes = computed(() =>
  allNodes.value.filter((n) => n.archive_id === historyArchiveId.value)
)
const archiveOptions = computed(() =>
  archives.value.map((a) => ({
    value: a.id,
    label: `${a.name}${a.status === 'sealed' ? '（已封档）' : ''}`,
  }))
)

function archiveGoalCount(id: string): number {
  return allNodes.value.filter((n) => n.archive_id === id && n.kind === 'A').length
}
</script>

<template>
  <a-config-provider :theme="antdThemeConfig">
    <!-- 会话恢复中：先别闪一下登录页 -->
    <div v-if="loading" class="rt rt-center">
      <span class="rt-meta">载入中…</span>
    </div>

    <LoginCard v-else-if="!session || passwordPending" />

    <div v-else class="rt">
      <!-- ---------- 顶部窄栏 ---------- -->
      <header class="rt-appbar">
        <div class="rt-appbar-inner">
          <span class="rt-brand">RTarget</span>
          <span class="rt-meta rt-num">{{ clock }}</span>
          <span class="rt-push"></span>

          <button class="rt-iconbtn" :disabled="busy" aria-label="刷新"
            @click="refresh()">
            <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 11.5a8 8 0 1 0-2.4 5.7" />
              <path d="M20 5.5v6h-6" />
            </svg>
          </button>

          <button class="rt-iconbtn" aria-label="切换深浅色" @click="toggleTheme()">
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
              <circle cx="12" cy="5.2" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="18.8" r="1.6" />
            </svg>
          </button>
        </div>
      </header>

      <main class="rt-main">

        <!-- ==================== 首页 ==================== -->
        <section v-if="page === 'home'">
          <div class="rt-card rt-vital">
            <div>
              <p class="rt-meta" style="margin: 0">活力值</p>
              <p class="rt-vital-num rt-num" :style="{ color: vitalityColor }">{{ vitality }}</p>
            </div>
            <div class="rt-vital-side">
              <span class="rt-meta">累计奖励
                <span class="rt-num" style="color: var(--rt-green)">+{{ stats.gained }}</span>
              </span>
              <span class="rt-meta">累计扣除
                <span class="rt-num" style="color: var(--rt-red)">{{ stats.lost }}</span>
              </span>
            </div>
          </div>
          <p class="rt-meta rt-note">不留小数 · 活力值为负时禁押高档与 ALL IN</p>

          <div class="rt-card rt-strip rt-gap12">
            <div>
              <p class="rt-meta" style="margin: 0">未封档存档</p>
              <p class="rt-strip-val">{{ openArchives.length }}</p>
            </div>
            <div>
              <p class="rt-meta" style="margin: 0">进行中的目标</p>
              <p class="rt-strip-val">{{ stats.running }}</p>
            </div>
            <div>
              <p class="rt-meta" style="margin: 0">惩罚复合体中</p>
              <p class="rt-strip-val" :style="stats.compound > 0 ? 'color: var(--rt-amber)' : ''">{{ stats.compound }}</p>
            </div>
            <div>
              <p class="rt-meta" style="margin: 0">已完成的目标</p>
              <p class="rt-strip-val">{{ stats.done }}</p>
            </div>
          </div>

          <div class="rt-card rt-pad rt-gap12">
            <div class="rt-line1">
              <span class="rt-sec">未完成的事</span>
              <span class="rt-meta rt-push">{{ pendingGroups.length }} 件</span>
            </div>
            <div style="margin-top: 4px">
              <div v-for="g in pendingGroups" :key="g.a.id" class="rt-li">
                <span class="pill" :class="inCompound(g.a, g.c) ? 'p-amber' : 'p-blue'">
                  {{ inCompound(g.a, g.c) ? '复合体' : '进行中' }}
                </span>
                <div class="rt-li-2">
                  <div class="rt-li-2-t">{{ g.a.content }}</div>
                  <div class="rt-meta">{{ archiveName(g.a.archive_id) }}</div>
                </div>
              </div>
              <p v-if="pendingGroups.length === 0" class="rt-meta rt-hint">暂时没有未完成的事。</p>
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
                  <div class="rt-li-2-t">{{ reasonText[l.reason ?? ''] ?? l.note ?? '初始活力值' }}</div>
                  <div class="rt-meta">{{ new Date(l.created_at).toLocaleDateString('zh-CN') }}</div>
                </div>
              </div>
              <p v-if="ledger.length === 0" class="rt-meta rt-hint">暂无流水。</p>
            </div>
          </div>
        </section>

        <!-- ==================== 正在执行 ==================== -->
        <section v-else-if="page === 'running'">
          <div class="rt-chips">
            <button v-for="a in openArchives" :key="a.id" class="rt-chip"
              :class="{ active: a.id === activeArchiveId }" @click="activeArchiveId = a.id">
              <span v-if="pendingArchiveIds.has(a.id)" class="rt-dot"></span>{{ a.name }}
            </button>
            <button class="rt-chip rt-chip-add" @click="showNewArchive = true">+ 新档</button>
          </div>

          <div class="rt-line1 rt-gap8">
            <span v-if="pendingArchiveIds.size > 0" class="rt-meta">红点表示这个存档里还有事没做完</span>
            <a-popconfirm v-if="activeArchive"
              title="封档？这个存档里还有事没做完，将扣当前活力值 10%"
              ok-text="封档" cancel-text="取消" @confirm="onSeal()">
              <button class="rbtn rbtn-danger rt-push" :disabled="busy">封档</button>
            </a-popconfirm>
          </div>

          <p v-if="openArchives.length === 0" class="rt-meta rt-hint">
            还没有正在执行的存档 —— 点上面「+ 新档」开一个。
          </p>

          <NodeList v-else class="rt-gap12" :nodes="nodes" :busy="busy" variant="open" @refresh="refresh" />
        </section>

        <!-- ==================== 历史记录 ==================== -->
        <section v-else>
          <div class="rt-line1">
            <span class="rt-sec">封档记录</span>
            <span class="rt-meta rt-push">{{ sealedArchives.length }} 个存档</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px">
            <div v-for="a in sealedArchives" :key="a.id" class="rt-card rt-cardwrap"
              style="cursor: pointer" @click="historyArchiveId = a.id">
              <div class="rt-rail rt-rail-gray"></div>
              <div class="rt-node-body rt-pad">
                <div class="rt-line1">
                  <span class="pill p-gray">已封档</span>
                  <span class="rt-t14s rt-flex1">{{ a.name }}</span>
                  <a-popconfirm
                    title="删除这个存档？存档和它的目标都会被删掉。活力值流水会保留，所以分数不变。"
                    ok-text="删除" cancel-text="取消" @confirm="onDeleteArchive(a)">
                    <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy"
                      aria-label="删除存档" @click.stop>
                      <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
                        <path d="M10.4 10.6v5.6M13.6 10.6v5.6" />
                      </svg>
                    </button>
                  </a-popconfirm>
                </div>
                <p class="rt-meta" style="margin: 3px 0 0">
                  {{ a.sealed_at ? new Date(a.sealed_at).toLocaleString('zh-CN') : '' }}
                </p>
                <div class="rt-line2" style="gap: 8px 18px">
                  <span class="rt-meta">目标
                    <span class="rt-num" style="color: var(--rt-tx)">{{ archiveGoalCount(a.id) }}</span> 个
                  </span>
                  <span class="rt-meta">封档
                    <span v-if="a.sealed_free" class="rt-num" style="color: var(--rt-green)">免费（全部完成）</span>
                    <span v-else class="rt-num" style="color: var(--rt-red)">
                      扣 {{ Math.abs(findSealPenalty(ledger, a.id) ?? 0) }} 分
                    </span>
                  </span>
                  <span class="rt-meta">净收支
                    <span class="rt-num"
                      :style="{ color: (sealSums[a.id] ?? 0) >= 0 ? 'var(--rt-green)' : 'var(--rt-red)' }">
                      {{ (sealSums[a.id] ?? 0) >= 0 ? '+' : '' }}{{ sealSums[a.id] ?? 0 }}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="sealedArchives.length === 0" class="rt-card rt-center-tx rt-gap12" style="padding: 28px">
            <span class="rt-meta">还没有封过档。</span>
          </div>

          <div class="rt-gap20" style="padding-top: 16px; border-top: 0.5px solid var(--rt-line)">
            <div class="rt-line1">
              <span class="rt-sec">已完成的目标</span>
            </div>
            <a-select v-model:value="historyArchiveId" :options="archiveOptions"
              placeholder="选择存档" style="width: 100%; margin-top: 10px" />
          </div>

          <div v-if="!historyArchiveId" class="rt-card rt-center-tx rt-gap12" style="padding: 28px">
            <span class="rt-meta">选一个存档看历史。</span>
          </div>
          <NodeList v-else class="rt-gap12" :nodes="historyNodes" :busy="busy" variant="closed" @refresh="refresh" />
        </section>

      </main>

      <!-- ---------- 底部导航 ---------- -->
      <nav class="rt-tabbar">
        <div class="rt-tabbar-inner">
          <button v-for="p in pages" :key="p.key" class="rt-tab"
            :class="{ active: page === p.key }" @click="page = p.key">
            <span class="rt-tab-ico">
              <svg v-if="p.key === 'home'" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3.6 10.4 12 3.8l8.4 6.6" />
                <path d="M5.8 9.3V20h12.4V9.3" />
              </svg>
              <svg v-else-if="p.key === 'running'" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                <circle cx="12" cy="12" r="8.3" />
                <circle cx="12" cy="12" r="3.4" />
              </svg>
              <svg v-else class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="8.3" />
                <path d="M12 7.4V12l3.2 1.9" />
              </svg>
              <span v-if="p.badge > 0" class="rt-tab-badge">{{ p.badge > 99 ? '99+' : p.badge }}</span>
            </span>
            <span>{{ p.label }}</span>
          </button>
        </div>
      </nav>

      <!-- ---------- 主行动按钮（只在执行页出现） ---------- -->
      <div v-if="page === 'running' && activeArchive" class="rt-fabwrap">
        <div class="rt-fabwrap-inner">
          <button class="rt-fab" :disabled="busy" aria-label="设一个新目标" @click="showGoalForm = true">
            <svg class="rt-ico" width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 5.5v13M5.5 12h13" />
            </svg>
          </button>
        </div>
      </div>

      <!-- ---------- 更多（底部抽屉） ---------- -->
      <a-modal v-model:open="showMore" title="账号" :footer="null" :width="580"
        wrap-class-name="rt-sheet">
        <p class="rt-meta" style="margin: 0">{{ userEmail }}</p>
        <div class="rt-sheetlist">
          <button class="rt-sheetitem" :disabled="busy" @click="refresh(); showMore = false">
            刷新数据
          </button>
          <button class="rt-sheetitem" @click="showMore = false; showPassword = true">
            设置密码
          </button>
          <button class="rt-sheetitem rt-sheetitem-danger" @click="signOut()">退出登录</button>
        </div>
      </a-modal>

      <!-- ---------- 设置 / 修改密码（底部抽屉） ---------- -->
      <a-modal v-model:open="showPassword" title="设置密码" :footer="null" :width="580"
        wrap-class-name="rt-sheet">
        <p class="rt-meta" style="margin: 0 0 12px">
          设完之后手机和网页都能用这个密码登录，不用再收验证码。
        </p>
        <a-form layout="vertical">
          <a-form-item label="新密码（至少 6 位）">
            <a-input-password v-model:value="newPwd1" size="large" />
          </a-form-item>
          <a-form-item label="再输一遍">
            <a-input-password v-model:value="newPwd2" size="large" @pressEnter="onChangePassword" />
          </a-form-item>
        </a-form>
        <div class="rt-sheet-actions">
          <button class="rbtn-primary" :disabled="busy" @click="onChangePassword()">保存</button>
          <button class="rbtn" @click="showPassword = false">取消</button>
        </div>
      </a-modal>

      <!-- ---------- 开新存档（底部抽屉） ---------- -->
      <a-modal v-model:open="showNewArchive" title="开新存档" :footer="null" :width="580"
        wrap-class-name="rt-sheet">
        <a-input v-model:value="newArchiveName" placeholder="存档名，比如 2026 秋招冲刺"
          @keyup.enter="addArchive()" />
        <p class="rt-meta" style="margin: 8px 0 0">开新档不是重来 —— 活力值全局公用，之前扣掉的分不会回来。</p>
        <div class="rt-sheet-actions">
          <button class="rbtn-primary" :disabled="busy || !newArchiveName.trim()"
            @click="addArchive()">创建</button>
          <button class="rbtn" @click="showNewArchive = false">取消</button>
        </div>
      </a-modal>

      <!-- ---------- 设一个新目标（底部抽屉） ---------- -->
      <a-modal v-model:open="showGoalForm" title="设一个新目标" :footer="null" :width="580"
        wrap-class-name="rt-sheet">
        <a-form layout="vertical">
          <a-form-item label="目标 A（押注）· 这件事是什么">
            <a-input v-model:value="goalForm.content" placeholder="比如：做完 660 题第三章" />
          </a-form-item>

          <div class="rt-form-row">
            <a-form-item label="档位" style="flex: 1">
              <a-select v-model:value="goalForm.tier">
                <a-select-option value="low">低（5 分）</a-select-option>
                <a-select-option value="mid">中（10 分）</a-select-option>
                <a-select-option value="high" :disabled="highTiersDisabled">高（20 分）</a-select-option>
                <a-select-option value="allin" :disabled="highTiersDisabled">
                  ALL IN（当前活力值的 80%）
                </a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="A 死线（哪天做完）" style="flex: 1">
              <a-input v-model:value="goalForm.dueDate" type="date" :min="minDueDate" />
            </a-form-item>
          </div>
          <p v-if="highTiersDisabled" class="rt-meta" style="margin: -8px 0 12px; color: var(--rt-red)">
            活力值已穿透负值，高档与 ALL IN 暂不可押，回正后解锁。
          </p>

          <a-form-item label="奖励 B（想做的事 · 档位继承 A）">
            <a-input v-model:value="goalForm.reward.content"
              placeholder="做成 A 后想做的事（无时限，达成即加分）" />
          </a-form-item>

          <a-form-item label="惩罚 C（一直拖延的事 · 档位继承 A）">
            <a-input v-model:value="goalForm.penalty.content" placeholder="如果没做成，被强制面对的事" />
          </a-form-item>

          <a-form-item label="C 死线（哪天做完 · 只能落在 A 死线之后的三天内）">
            <div class="rt-seg">
              <button v-for="o in penaltyOptions" :key="o.offset" type="button" class="rt-segbtn"
                :class="{ active: goalForm.penaltyOffset === o.offset }"
                @click="goalForm.penaltyOffset = o.offset">
                <span>{{ o.label }}</span>
                <span class="rt-meta">{{ o.hint }}</span>
              </button>
            </div>
          </a-form-item>
          <p class="rt-meta" style="margin: -12px 0 16px">
            A 死线 {{ shortDate(goalForm.dueDate) }}（次日 0 点判负）· 惩罚 C 死线
            {{ shortDate(penaltyDate) }} —— 这段就是惩罚复合体的补做窗口
          </p>

          <div class="rt-sheet-actions">
            <button class="rbtn-primary" :disabled="busy" @click="addGoal()">押注设立</button>
            <button class="rbtn" @click="showGoalForm = false">取消</button>
          </div>
        </a-form>
      </a-modal>
    </div>
  </a-config-provider>
</template>

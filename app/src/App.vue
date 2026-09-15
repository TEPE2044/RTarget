<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useAuth } from './lib/auth'
import {
  settleAll, getVitality, getLedger, getArchives, getNodes, createArchive, createGoal, sealArchive,
} from './lib/game'
import type { Archive, GameNode, LedgerEntry, Tier } from './lib/game'
import LoginCard from './components/LoginCard.vue'
import VitalityPanel from './components/VitalityPanel.vue'
import NodeList from './components/NodeList.vue'

const { session, signOut } = useAuth()

const vitality = ref(0)
const ledger = ref<LedgerEntry[]>([])
const archives = ref<Archive[]>([])
const nodes = ref<GameNode[]>([])
const busy = ref(false)
const now = ref(new Date())

// 每分钟刷新"当前时间"（仅显示用，结算靠 settleAll 的打开时机）
let timer: ReturnType<typeof setInterval> | null = null

const openArchives = computed(() => archives.value.filter((a) => a.status === 'open'))
const activeArchiveId = ref<string | null>(null)
const activeArchive = computed(
  () => archives.value.find((a) => a.id === activeArchiveId.value) ?? null
)

async function refresh() {
  busy.value = true
  try {
    await settleAll() // 惰性结算：每次刷新都先判负该判负的
    const [v, l, as] = await Promise.all([getVitality(), getLedger(), getArchives()])
    vitality.value = v
    ledger.value = l
    archives.value = as
    if (!activeArchiveId.value && openArchives.value.length > 0) {
      activeArchiveId.value = openArchives.value[0].id
    }
    if (activeArchiveId.value) {
      nodes.value = await getNodes(activeArchiveId.value)
    } else {
      nodes.value = []
    }
  } catch (e) {
    alert((e as Error).message)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 60_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// 登录后自动拉取
watch(session, (s) => {
  if (s) refresh()
  else {
    vitality.value = 0
    ledger.value = []
    archives.value = []
    nodes.value = []
    activeArchiveId.value = null
  }
}, { immediate: true })

// 切换存档时重新拉节点
watch(activeArchiveId, () => refresh())

// ---------- 新建存档 ----------
const newArchiveName = ref('')
async function addArchive() {
  if (!newArchiveName.value.trim()) return
  busy.value = true
  try {
    const a = await createArchive(newArchiveName.value.trim())
    newArchiveName.value = ''
    activeArchiveId.value = a.id
    await refresh()
  } catch (e) {
    alert((e as Error).message)
  } finally {
    busy.value = false
  }
}

// ---------- 新建目标（A + B + C 一次配齐） ----------
// 时间粒度：日（文档 v1.0）。dueDate 是"到期日"，结算发生在到期日 0 点。
// 例：9/15 设目标选到期日 9/16 → 9/16 00:00 判定。
function dueDateToISO(dateStr: string): string {
  // 当地时区该日期的 0 点
  const d = new Date(dateStr + 'T00:00:00')
  return d.toISOString()
}

// 到期日最早 = 明天（今天 0 点已过，选今天等于立即判负，无意义）
function localDateStr(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const minDueDate = localDateStr(1)

const showGoalForm = ref(false)
const goalForm = ref({
  content: '',
  tier: 'low' as Tier,
  dueDate: minDueDate,
  reward: { content: '' },
  penalty: { content: '' },
})

async function addGoal() {
  if (!activeArchiveId.value) return
  if (!goalForm.value.content.trim()) return alert('目标内容必填')
  if (!goalForm.value.reward.content.trim()) return alert('奖励内容必填（想做的事）')
  if (!goalForm.value.penalty.content.trim()) return alert('惩罚内容必填（一直拖延的事）')

  busy.value = true
  try {
    const dueAt = dueDateToISO(goalForm.value.dueDate)
    await createGoal({
      archiveId: activeArchiveId.value,
      content: goalForm.value.content.trim(),
      tier: goalForm.value.tier,
      dueAt,
      reward: {
        content: goalForm.value.reward.content.trim(),
      },
      penalty: {
        content: goalForm.value.penalty.content.trim(),
      },
      vitality: vitality.value,
    })
    showGoalForm.value = false
    goalForm.value = {
      content: '', tier: 'low', dueDate: minDueDate,
      reward: { content: '' },
      penalty: { content: '' },
    }
    await refresh()
  } catch (e) {
    alert((e as Error).message)
  } finally {
    busy.value = false
  }
}

// ---------- 封档 ----------
async function onSeal() {
  if (!activeArchive.value) return
  const ok = window.confirm(
    `封档「${activeArchive.value.name}」？
有未了结之事将扣当前活力值 10%，干净封档免费。`
  )
  if (!ok) return
  busy.value = true
  try {
    const deducted = await sealArchive(activeArchive.value.id)
    alert(deducted < 0
      ? `已封档，扣除 ${Math.abs(deducted)} 点活力值`
      : '已封档（干净了结，免费）')
    activeArchiveId.value = null
    await refresh()
  } catch (e) {
    alert((e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <LoginCard v-if="!session" />
  <div v-else class="min-h-screen bg-slate-950 text-slate-200">
    <!-- 顶栏 -->
    <header class="flex items-center gap-4 px-6 h-14 border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
      <span class="font-bold text-lg tracking-wide">RTarget</span>
      <span class="text-xs text-slate-500">{{ now.toLocaleString() }}</span>
      <div class="ml-auto flex gap-2">
        <button
          class="px-3 py-1.5 text-sm rounded-md border border-slate-700 hover:border-slate-500 hover:bg-slate-800/60 transition disabled:opacity-40"
          :disabled="busy" @click="refresh()">刷新</button>
        <button
          class="px-3 py-1.5 text-sm rounded-md border border-slate-700 hover:border-slate-500 hover:bg-slate-800/60 transition"
          @click="signOut()">退出</button>
      </div>
    </header>

    <main class="flex gap-6 p-6 items-start max-w-6xl mx-auto">
      <!-- 左侧：活力值面板 -->
      <aside class="w-80 shrink-0">
        <VitalityPanel :vitality="vitality" :ledger="ledger" />
      </aside>

      <!-- 右侧：存档 + 节点 -->
      <section class="flex-1 min-w-0">
        <div class="flex gap-2 mb-5">
          <select v-model="activeArchiveId"
            class="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500">
            <option v-for="a in openArchives" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <input v-model="newArchiveName" placeholder="新存档名" @keyup.enter="addArchive()"
            class="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm flex-1 max-w-48 focus:outline-none focus:border-blue-500" />
          <button :disabled="busy || !newArchiveName.trim()" @click="addArchive()"
            class="px-3 py-1.5 text-sm rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600 transition disabled:opacity-40">开新档</button>
          <button v-if="activeArchive" :disabled="busy" @click="onSeal()"
            class="px-3 py-1.5 text-sm rounded-md bg-red-900/40 hover:bg-red-900/70 text-red-200 border border-red-800/60 transition disabled:opacity-40">封档</button>
        </div>

        <NodeList :nodes="nodes" :busy="busy" @refresh="refresh" />

        <!-- 新建目标 -->
        <div class="mt-6" v-if="activeArchive">
          <button v-if="!showGoalForm" :disabled="busy" @click="showGoalForm = true"
            class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition shadow-lg shadow-blue-900/30 disabled:opacity-40">
            + 设一个新目标
          </button>

          <form v-else class="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4 shadow-xl" @submit.prevent="addGoal">
            <h4 class="text-sm font-semibold text-slate-300">目标 A（押注）</h4>
            <input v-model="goalForm.content" placeholder="这件事是什么" required
              class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <div class="flex gap-4">
              <label class="flex-1 flex flex-col gap-1 text-xs text-slate-400">档位
                <select v-model="goalForm.tier"
                  class="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                  <option value="low">低（5 分）</option>
                  <option value="mid">中（10 分）</option>
                  <option value="high">高（20 分）</option>
                  <option value="allin">ALL IN（80% 活力值）</option>
                </select>
              </label>
              <label class="flex-1 flex flex-col gap-1 text-xs text-slate-400">到期日（0 点结算）
                <input v-model="goalForm.dueDate" type="date" required :min="minDueDate"
                  class="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500" />
              </label>
            </div>

            <h4 class="text-sm font-semibold text-emerald-400">奖励 B（想做的事 · 档位继承 A）</h4>
            <input v-model="goalForm.reward.content" placeholder="做成 A 后想做的事" required
              class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />

            <h4 class="text-sm font-semibold text-rose-400">惩罚 C（一直拖延的事 · 档位继承 A）</h4>
            <input v-model="goalForm.penalty.content" placeholder="如果没做成，被强制面对的事" required
              class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />

            <div class="flex gap-3 pt-2">
              <button type="submit" :disabled="busy"
                class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition disabled:opacity-40">押注设立</button>
              <button type="button" @click="showGoalForm = false"
                class="px-4 py-2 rounded-lg border border-slate-600 hover:bg-slate-800 text-sm transition">取消</button>
            </div>
          </form>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
</style>

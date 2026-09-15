<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { theme as antdTheme } from 'ant-design-vue'
import { useAuth } from './lib/auth'
import { useTheme } from './lib/theme'
import {
  settleAll, getVitality, getLedger, getArchives, getNodes, createArchive, createGoal, sealArchive,
} from './lib/game'
import type { Archive, GameNode, LedgerEntry, Tier } from './lib/game'
import LoginCard from './components/LoginCard.vue'
import VitalityPanel from './components/VitalityPanel.vue'
import NodeList from './components/NodeList.vue'

const { session, signOut } = useAuth()
const { theme, toggleTheme } = useTheme()

// antd v4 ConfigProvider 主题算法（Dark/Light）
const antdThemeConfig = computed(() => ({
  algorithm: theme.value === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
}))

// 登录用户邮箱（顶栏显示"是谁在登录"）
const userEmail = computed(() => session.value?.user?.email ?? '')

const vitality = ref(0)
const ledger = ref<LedgerEntry[]>([])
const archives = ref<Archive[]>([])
const nodes = ref<GameNode[]>([])
const busy = ref(false)
const now = ref(new Date())

let timer: ReturnType<typeof setInterval> | null = null

const openArchives = computed(() => archives.value.filter((a) => a.status === 'open'))
const activeArchiveId = ref<string | null>(null)
const activeArchive = computed(
  () => archives.value.find((a) => a.id === activeArchiveId.value) ?? null
)

async function refresh() {
  busy.value = true
  try {
    await settleAll()
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
    console.error(e)
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

// ---------- 新建目标 ----------
function dueDateToISO(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toISOString()
}

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
      reward: { content: goalForm.value.reward.content.trim() },
      penalty: { content: goalForm.value.penalty.content.trim() },
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
  <a-config-provider :theme="antdThemeConfig">
    <LoginCard v-if="!session" />
    <div v-else class="min-h-screen app-bg">
      <header class="flex items-center gap-4 px-6 h-14 border-b sticky top-0 z-10 header-bar">
        <span class="font-bold text-lg tracking-wide">RTarget</span>
        <span class="text-xs opacity-60">{{ now.toLocaleString() }}</span>
        <div class="ml-auto flex items-center gap-3">
          <span class="text-xs opacity-70">{{ userEmail }}</span>
          <a-button size="small" @click="toggleTheme()">
            {{ theme === 'dark' ? '☀️ Light' : '🌙 Dark' }}
          </a-button>
          <a-button size="small" :disabled="busy" @click="refresh()">刷新</a-button>
          <a-button size="small" @click="signOut()">退出</a-button>
        </div>
      </header>

      <main class="flex gap-6 p-6 items-start max-w-6xl mx-auto">
        <aside class="w-80 shrink-0">
          <VitalityPanel :vitality="vitality" :ledger="ledger" />
        </aside>

        <section class="flex-1 min-w-0">
          <div class="flex gap-2 mb-5 items-center flex-wrap">
            <a-select v-model:value="activeArchiveId" placeholder="选择存档" style="min-width: 160px">
              <a-select-option v-for="a in openArchives" :key="a.id" :value="a.id">{{ a.name }}</a-select-option>
            </a-select>
            <a-input v-model:value="newArchiveName" placeholder="新存档名" style="width: 160px"
              @keyup.enter="addArchive()" />
            <a-button :disabled="busy || !newArchiveName.trim()" @click="addArchive()">开新档</a-button>
            <a-popconfirm v-if="activeArchive" title="封档？未了结之事将扣当前活力值 10%" ok-text="封档" cancel-text="取消" @confirm="onSeal()">
              <a-button danger :disabled="busy">封档</a-button>
            </a-popconfirm>
          </div>

          <NodeList :nodes="nodes" :busy="busy" @refresh="refresh" />

          <div class="mt-6" v-if="activeArchive">
            <a-button v-if="!showGoalForm" type="primary" :disabled="busy" @click="showGoalForm = true">
              + 设一个新目标
            </a-button>

            <a-form v-else layout="vertical" class="card-bg border"
              style="padding: 24px; border-radius: 8px" @submit.prevent="addGoal">
              <a-typography-title :level="5" style="margin-top: 0">目标 A（押注）</a-typography-title>
              <a-form-item>
                <a-input v-model:value="goalForm.content" placeholder="这件事是什么" />
              </a-form-item>
              <div class="flex gap-4">
                <a-form-item label="档位" class="flex-1">
                  <a-select v-model:value="goalForm.tier">
                    <a-select-option value="low">低（5 分）</a-select-option>
                    <a-select-option value="mid">中（10 分）</a-select-option>
                    <a-select-option value="high">高（20 分）</a-select-option>
                    <a-select-option value="allin">ALL IN（80% 活力值）</a-select-option>
                  </a-select>
                </a-form-item>
                <a-form-item label="到期日（0 点结算）" class="flex-1">
                  <a-input v-model:value="goalForm.dueDate" type="date" :min="minDueDate" />
                </a-form-item>
              </div>

              <a-typography-title :level="5" type="success">奖励 B（想做的事 · 档位继承 A）</a-typography-title>
              <a-form-item>
                <a-input v-model:value="goalForm.reward.content" placeholder="做成 A 后想做的事" />
              </a-form-item>

              <a-typography-title :level="5" type="danger">惩罚 C（一直拖延的事 · 档位继承 A）</a-typography-title>
              <a-form-item>
                <a-input v-model:value="goalForm.penalty.content" placeholder="如果没做成，被强制面对的事" />
              </a-form-item>

              <div class="flex gap-3">
                <a-button type="primary" html-type="submit" :disabled="busy">押注设立</a-button>
                <a-button @click="showGoalForm = false">取消</a-button>
              </div>
            </a-form>
          </div>
        </section>
      </main>
    </div>
  </a-config-provider>
</template>

<style>
/* 页面底色随亮暗模式（antd 组件有自己的配色） */
[data-theme='dark'] .app-bg { background: #141414; color: rgba(255,255,255,0.85); min-height: 100vh; }
[data-theme='light'] .app-bg { background: #f5f5f5; color: rgba(0,0,0,0.88); min-height: 100vh; }

[data-theme='dark'] .header-bar {
  background: rgba(20,20,20,0.88); border-color: #2a2a2a; backdrop-filter: blur(8px);
}
[data-theme='light'] .header-bar {
  background: rgba(255,255,255,0.88); border-color: #e8e8e8; backdrop-filter: blur(8px);
}

[data-theme='dark'] .card-bg { background: #1d1d1d; border-color: #2a2a2a; }
[data-theme='light'] .card-bg { background: #fff; border-color: #e8e8e8; }
</style>

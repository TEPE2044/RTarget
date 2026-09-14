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
const showGoalForm = ref(false)
const goalForm = ref({
  content: '',
  tier: 'low' as Tier,
  hours: 24,
  reward: { content: '', tier: 'low' as Tier, hours: 24 },
  penalty: { content: '', tier: 'low' as Tier, hours: 24 },
})

async function addGoal() {
  if (!activeArchiveId.value) return
  if (!goalForm.value.content.trim()) return alert('目标内容必填')
  if (!goalForm.value.reward.content.trim()) return alert('奖励内容必填（想做的事）')
  if (!goalForm.value.penalty.content.trim()) return alert('惩罚内容必填（一直拖延的事）')

  busy.value = true
  try {
    const dueAt = new Date(Date.now() + goalForm.value.hours * 3600_000).toISOString()
    await createGoal({
      archiveId: activeArchiveId.value,
      content: goalForm.value.content.trim(),
      tier: goalForm.value.tier,
      dueAt,
      reward: {
        content: goalForm.value.reward.content.trim(),
        tier: goalForm.value.reward.tier,
        dueAt: new Date(Date.now() + goalForm.value.reward.hours * 3600_000).toISOString(),
      },
      penalty: {
        content: goalForm.value.penalty.content.trim(),
        tier: goalForm.value.penalty.tier,
        dueAt: new Date(Date.now() + goalForm.value.penalty.hours * 3600_000).toISOString(),
      },
      vitality: vitality.value,
    })
    showGoalForm.value = false
    goalForm.value = {
      content: '', tier: 'low', hours: 24,
      reward: { content: '', tier: 'low', hours: 24 },
      penalty: { content: '', tier: 'low', hours: 24 },
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
  <div v-else class="layout">
    <header>
      <span class="brand">活力值奖罚系统</span>
      <span class="now">现在：{{ now.toLocaleString() }}</span>
      <button class="ghost" :disabled="busy" @click="refresh()">刷新</button>
      <button class="ghost" @click="signOut()">退出</button>
    </header>

    <main>
      <aside>
        <VitalityPanel :vitality="vitality" :ledger="ledger" />
      </aside>

      <section>
        <div class="archive-bar">
          <select v-model="activeArchiveId">
            <option v-for="a in openArchives" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <input v-model="newArchiveName" placeholder="新存档名" @keyup.enter="addArchive" />
          <button :disabled="busy || !newArchiveName.trim()" @click="addArchive()">开新档</button>
          <button v-if="activeArchive" class="danger" :disabled="busy" @click="onSeal()">封档</button>
        </div>

        <NodeList :nodes="nodes" :busy="busy" @refresh="refresh" />

        <div class="goal-actions" v-if="activeArchive">
          <button v-if="!showGoalForm" class="primary" :disabled="busy" @click="showGoalForm = true">
            设一个新目标
          </button>
          <form v-else class="goal-form" @submit.prevent="addGoal">
            <h4>目标 A（押注）</h4>
            <input v-model="goalForm.content" placeholder="这件事是什么" required />
            <div class="row">
              <label>档位
                <select v-model="goalForm.tier">
                  <option value="low">低（5 分）</option>
                  <option value="mid">中（10 分）</option>
                  <option value="high">高（20 分）</option>
                  <option value="allin">ALL IN（80% 活力值）</option>
                </select>
              </label>
              <label>时限（小时）
                <input v-model.number="goalForm.hours" type="number" min="1" required />
              </label>
            </div>

            <h4>奖励 B（想做的事 · A 达成后开启）</h4>
            <input v-model="goalForm.reward.content" placeholder="做成 A 后想做的事" required />
            <div class="row">
              <label>档位
                <select v-model="goalForm.reward.tier">
                  <option value="low">低（5 分）</option>
                  <option value="mid">中（10 分）</option>
                  <option value="high">高（20 分）</option>
                  <option value="allin">ALL IN（80% 活力值）</option>
                </select>
              </label>
              <label>有效期（小时）
                <input v-model="goalForm.reward.hours" type="number" min="1" required />
              </label>
            </div>

            <h4>惩罚 C（一直拖延的事 · A 判负后开启）</h4>
            <input v-model="goalForm.penalty.content" placeholder="如果没做成，被强制面对的事" required />
            <div class="row">
              <label>档位
                <select v-model="goalForm.penalty.tier">
                  <option value="low">低（5 分）</option>
                  <option value="mid">中（10 分）</option>
                  <option value="high">高（20 分）</option>
                  <option value="allin">ALL IN（80% 活力值）</option>
                </select>
              </label>
              <label>时限（小时）
                <input v-model="goalForm.penalty.hours" type="number" min="1" required />
              </label>
            </div>

            <div class="row">
              <button type="submit" class="primary" :disabled="busy">押注设立</button>
              <button type="button" class="ghost" @click="showGoalForm = false">取消</button>
            </div>
          </form>
        </div>
      </section>
    </main>
  </div>
</template>

<style>
#app {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: #14161b;
  color: #e6e6e6;
  min-height: 100vh;
  margin: 0;
}
* { box-sizing: border-box; }
body { margin: 0; }

header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px; border-bottom: 1px solid #2a2e38;
}
.brand { font-weight: 700; }
.now { color: #9aa0aa; font-size: 13px; margin-left: auto; }
button {
  padding: 6px 14px; border: none; border-radius: 6px;
  font-size: 13px; cursor: pointer; background: #3a3f4a; color: #e6e6e6;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
.primary { background: #4f7cff; color: white; }
.ghost { background: transparent; border: 1px solid #3a3f4a; }
.danger { background: #6b2f2f; color: #f5d6d6; }

main { display: flex; gap: 16px; padding: 16px 20px; align-items: flex-start; }
aside { width: 320px; flex-shrink: 0; }
section { flex: 1; min-width: 0; }

.archive-bar { display: flex; gap: 8px; margin-bottom: 16px; }
select, input {
  background: #1c1f26; color: #e6e6e6; border: 1px solid #3a3f4a;
  border-radius: 6px; padding: 6px 10px; font-size: 13px;
}

.goal-actions { margin-top: 16px; }
.goal-form {
  background: #1c1f26; border-radius: 12px; padding: 20px; margin-top: 12px;
}
.goal-form h4 { margin: 12px 0 8px; color: #9aa0aa; font-size: 13px; }
.goal-form h4:first-child { margin-top: 0; }
.goal-form input { width: 100%; }
.row { display: flex; gap: 12px; margin-top: 8px; }
.row label { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9aa0aa; }
</style>

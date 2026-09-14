<script setup lang="ts">
import { computed } from 'vue'
import type { GameNode } from '../lib/game'
import { completeNode, concedeNode } from '../lib/game'

const props = defineProps<{ nodes: GameNode[]; busy?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

// A 节点 + 其子节点 B/C 分组渲染
const groups = computed(() => {
  const aNodes = props.nodes.filter((n) => n.kind === 'A')
  return aNodes.map((a) => ({
    a,
    b: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'B') ?? null,
    c: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'C') ?? null,
  }))
})

const kindName: Record<string, string> = { A: '目标', B: '奖励', C: '惩罚' }
const tierName: Record<string, string> = { low: '低', mid: '中', high: '高', allin: 'ALL IN' }

function statusText(n: GameNode): string {
  if (n.status === 'bound') return '未开启'
  if (n.status === 'active') return '进行中'
  if (n.completed_at) return '已完成'
  return '已结算'
}

function isOverdue(n: GameNode): boolean {
  return n.status === 'active' && new Date(n.due_at) < new Date()
}

/** A 在复合体中（已判负未复合结算）时仍可点完成（补完） */
function canComplete(n: GameNode): boolean {
  if (n.status === 'active') return true
  // A 已判负但复合体未结算，允许补完
  return n.kind === 'A' && n.status === 'settled' && n.compound_a_done === null
}

function canConcede(n: GameNode): boolean {
  return n.status === 'active'
}

async function onComplete(id: string) {
  try {
    await completeNode(id)
    emit('refresh')
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onConcede(id: string) {
  if (!confirm('确认认输？效果等同超时判负。')) return
  try {
    await concedeNode(id)
    emit('refresh')
  } catch (e) {
    alert((e as Error).message)
  }
}
</script>

<template>
  <div class="node-list">
    <div v-for="g in groups" :key="g.a.id" class="group" :class="{ failed: g.a.status === 'settled' && !g.a.completed_at }">
      <div class="node a">
        <div class="head">
          <span class="kind">{{ kindName.A }}</span>
          <span class="tier">{{ tierName[g.a.tier] }} · {{ g.a.stake }} 分</span>
          <span class="status" :class="{ overdue: isOverdue(g.a) }">
            {{ isOverdue(g.a) ? '已超时（待结算）' : statusText(g.a) }}
          </span>
        </div>
        <p class="content">{{ g.a.content }}</p>
        <p class="due">时限：{{ new Date(g.a.due_at).toLocaleString() }}</p>
        <p v-if="g.a.compound_a_done !== null" class="compound">
          复合体结算：A{{ g.a.compound_a_done ? '✓' : '✗' }} C{{ g.a.compound_c_done ? '✓' : '✗' }}
          <template v-if="g.a.compound_a_done && g.a.compound_c_done">（已返还）</template>
          <template v-else-if="!g.a.compound_a_done && !g.a.compound_c_done">（已再扣）</template>
          <template v-else>（无分）</template>
        </p>
        <div class="actions">
          <button v-if="canComplete(g.a)" :disabled="busy" class="ok" @click="onComplete(g.a.id)">完成</button>
          <button v-if="canConcede(g.a)" :disabled="busy" class="bad" @click="onConcede(g.a.id)">认输</button>
        </div>
      </div>

      <div v-if="g.b" class="node b" :class="{ locked: g.b.status === 'bound', done: g.b.status === 'settled' }">
        <div class="head">
          <span class="kind">{{ kindName.B }}</span>
          <span class="tier">{{ tierName[g.b.tier] }} · {{ g.b.stake }} 分</span>
          <span class="status">{{ statusText(g.b) }}</span>
        </div>
        <p class="content">{{ g.b.content }}</p>
        <div v-if="g.b.status === 'active'" class="actions">
          <button :disabled="busy" class="ok" @click="onComplete(g.b.id)">去做并完成</button>
        </div>
        <p v-else-if="g.b.status === 'bound'" class="locked-hint">A 达成后开启</p>
        <p v-else class="done-hint">{{ g.b.completed_at ? '已享受 ✓' : '已过期作废' }}</p>
      </div>

      <div v-if="g.c" class="node c" :class="{ locked: g.c.status === 'bound', done: g.c.status === 'settled' }">
        <div class="head">
          <span class="kind">{{ kindName.C }}</span>
          <span class="tier">{{ tierName[g.c.tier] }} · {{ g.c.stake }} 分</span>
          <span class="status">{{ statusText(g.c) }}</span>
        </div>
        <p class="content">{{ g.c.content }}</p>
        <div v-if="g.c.status === 'active'" class="actions">
          <button :disabled="busy" class="ok" @click="onComplete(g.c.id)">把拖延的事做掉</button>
          <button :disabled="busy" class="bad" @click="onConcede(g.c.id)">认输</button>
        </div>
        <p v-else-if="g.c.status === 'bound'" class="locked-hint">A 判负后开启</p>
        <p v-else class="done-hint">{{ g.c.completed_at ? '已了结 ✓' : '复合体已结算' }}</p>
      </div>
    </div>
    <p v-if="groups.length === 0" class="empty">还没有目标。设一个，配好奖罚。</p>
  </div>
</template>

<style scoped>
.node-list { display: flex; flex-direction: column; gap: 16px; }
.group {
  border: 1px solid #2a2e38;
  border-radius: 12px;
  overflow: hidden;
}
.group.failed { border-color: #6b3030; }
.node { padding: 14px 16px; background: #1c1f26; color: #e6e6e6; }
.node + .node { border-top: 1px dashed #2a2e38; }
.node.b { background: #1a2420; }
.node.c { background: #241a1a; }
.head { display: flex; gap: 10px; align-items: center; font-size: 12px; }
.kind {
  padding: 2px 8px; border-radius: 4px; background: #3a3f4a; color: #e6e6e6; font-weight: 600;
}
.node.c .kind { background: #5a2a2a; }
.node.b .kind { background: #2a5a3a; }
.tier { color: #9aa0aa; }
.status { margin-left: auto; color: #9aa0aa; }
.status.overdue { color: #ff7a7a; font-weight: 600; }
.content { margin: 8px 0 4px; font-size: 15px; }
.due { margin: 0; color: #666d78; font-size: 12px; }
.compound { margin: 4px 0 0; color: #f0c94f; font-size: 12px; }
.actions { margin-top: 10px; display: flex; gap: 8px; }
button {
  padding: 6px 14px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;
}
.ok { background: #2f6b3a; color: #d6f5dc; }
.bad { background: #6b2f2f; color: #f5d6d6; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.locked { opacity: 0.55; }
.locked-hint, .done-hint { color: #666d78; font-size: 12px; margin: 8px 0 0; }
.done-hint { color: #7fe08a; }
.empty { color: #666d78; text-align: center; padding: 24px; }
</style>

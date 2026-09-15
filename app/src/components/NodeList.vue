<script setup lang="ts">
import { computed } from 'vue'
import type { GameNode } from '../lib/game'
import { completeNode, concedeNode } from '../lib/game'

const props = defineProps<{ nodes: GameNode[]; busy?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const groups = computed(() => {
  const aNodes = props.nodes.filter((n) => n.kind === 'A')
  return aNodes.map((a) => ({
    a,
    b: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'B') ?? null,
    c: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'C') ?? null,
  }))
})

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

function dueDateText(n: GameNode): string {
  const d = new Date(n.due_at)
  return `${d.getMonth() + 1}/${d.getDate()} 0点`
}

function canComplete(n: GameNode): boolean {
  if (n.status === 'active') return true
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
  <div class="space-y-4">
    <div v-for="g in groups" :key="g.a.id"
      class="bg-slate-900 border rounded-xl overflow-hidden"
      :class="g.a.status === 'settled' && !g.a.completed_at ? 'border-red-900/50' : 'border-slate-800'">

      <!-- A 节点 -->
      <div class="p-4">
        <div class="flex items-center gap-2.5 text-xs">
          <span class="px-2 py-0.5 rounded font-semibold bg-slate-700 text-slate-200">目标</span>
          <span class="text-slate-500">{{ tierName[g.a.tier] }} · {{ g.a.stake }} 分</span>
          <span class="ml-auto" :class="isOverdue(g.a) ? 'text-red-400 font-semibold' : 'text-slate-500'">
            {{ isOverdue(g.a) ? '已超时（待结算）' : statusText(g.a) }}
          </span>
        </div>
        <p class="mt-2 text-[15px] text-slate-100">{{ g.a.content }}</p>
        <p class="mt-1 text-xs text-slate-600">到期：{{ dueDateText(g.a) }}</p>
        <p v-if="g.a.compound_a_done !== null" class="mt-1 text-xs text-amber-400">
          复合体结算：A{{ g.a.compound_a_done ? '✓' : '✗' }} C{{ g.a.compound_c_done ? '✓' : '✗' }}
          <template v-if="g.a.compound_a_done && g.a.compound_c_done">（已返还）</template>
          <template v-else-if="!g.a.compound_a_done && !g.a.compound_c_done">（已再扣）</template>
          <template v-else>（无分）</template>
        </p>
        <div class="mt-3 flex gap-2">
          <button v-if="canComplete(g.a)" :disabled="busy" @click="onComplete(g.a.id)"
            class="px-3.5 py-1.5 text-sm rounded-md bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-200 border border-emerald-700/50 transition disabled:opacity-40">完成</button>
          <button v-if="canConcede(g.a)" :disabled="busy" @click="onConcede(g.a.id)"
            class="px-3.5 py-1.5 text-sm rounded-md bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-800/50 transition disabled:opacity-40">认输</button>
        </div>
      </div>

      <!-- B 节点 -->
      <div v-if="g.b" class="p-4 border-t border-dashed border-slate-800"
        :class="g.b.status === 'bound' ? 'opacity-50' : ''">
        <div class="flex items-center gap-2.5 text-xs">
          <span class="px-2 py-0.5 rounded font-semibold bg-emerald-900/60 text-emerald-300">奖励</span>
          <span class="text-slate-500">{{ tierName[g.b.tier] }} · {{ g.b.stake }} 分</span>
          <span class="ml-auto text-slate-500">{{ statusText(g.b) }}</span>
        </div>
        <p class="mt-2 text-[15px] text-slate-200">{{ g.b.content }}</p>
        <p v-if="g.b.status === 'bound'" class="mt-2 text-xs text-slate-600">A 达成时自动奖励</p>
        <p v-else class="mt-2 text-xs text-emerald-500">已奖励 {{ g.b.stake }} 分 ✓（去做吧）</p>
      </div>

      <!-- C 节点 -->
      <div v-if="g.c" class="p-4 border-t border-dashed border-slate-800"
        :class="g.c.status === 'bound' ? 'opacity-50' : ''">
        <div class="flex items-center gap-2.5 text-xs">
          <span class="px-2 py-0.5 rounded font-semibold bg-rose-900/60 text-rose-300">惩罚</span>
          <span class="text-slate-500">{{ tierName[g.c.tier] }} · {{ g.c.stake }} 分</span>
          <span class="ml-auto" :class="isOverdue(g.c) ? 'text-red-400 font-semibold' : 'text-slate-500'">
            {{ isOverdue(g.c) ? '已超时（待结算）' : statusText(g.c) }}
          </span>
        </div>
        <p class="mt-2 text-[15px] text-slate-200">{{ g.c.content }}</p>
        <p class="mt-1 text-xs text-slate-600" v-if="g.c.status === 'active'">到期：{{ dueDateText(g.c) }}</p>
        <div v-if="g.c.status === 'active'" class="mt-3 flex gap-2">
          <button :disabled="busy" @click="onComplete(g.c.id)"
            class="px-3.5 py-1.5 text-sm rounded-md bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-200 border border-emerald-700/50 transition disabled:opacity-40">把拖延的事做掉</button>
          <button :disabled="busy" @click="onConcede(g.c.id)"
            class="px-3.5 py-1.5 text-sm rounded-md bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-800/50 transition disabled:opacity-40">认输</button>
        </div>
        <p v-else-if="g.c.status === 'bound'" class="mt-2 text-xs text-slate-600">A 判负后开启</p>
        <p v-else class="mt-2 text-xs text-slate-500">{{ g.c.completed_at ? '已了结 ✓' : '复合体已结算' }}</p>
      </div>
    </div>
    <p v-if="groups.length === 0" class="text-center text-slate-600 py-10 text-sm">还没有目标。设一个，配好奖罚。</p>
  </div>
</template>

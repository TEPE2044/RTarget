<script setup lang="ts">
import { computed } from 'vue'
import type { LedgerEntry } from '../lib/game'

const props = defineProps<{ vitality: number; ledger: LedgerEntry[] }>()

const vitalityClass = computed(() =>
  props.vitality < 0 ? 'text-red-400' : props.vitality < 25 ? 'text-amber-400' : 'text-emerald-400'
)

const reasonText: Record<string, string> = {
  a_failed: 'A 判负 · 扣押注分',
  c_entered: '进入惩罚复合体 · 扣 C 分',
  b_completed: '奖励 B · 回血',
  compound_fail: '复合体双未完成 · 再扣 A+C',
  compound_redeem: '复合体双完成 · 返还 A+C',
}
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
    <div class="flex items-baseline gap-3 pb-4 border-b border-slate-800">
      <span class="text-sm text-slate-500">活力值</span>
      <span class="text-5xl font-bold tabular-nums" :class="vitalityClass">{{ vitality }}</span>
    </div>

    <div class="mt-4">
      <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">流水账</h4>
      <ul class="max-h-72 overflow-y-auto space-y-0.5 pr-1">
        <li v-for="e in ledger" :key="e.id"
          class="flex gap-2.5 items-baseline py-1.5 text-sm border-b border-slate-800/50">
          <span class="w-14 text-right font-semibold tabular-nums"
            :class="e.amount >= 0 ? 'text-emerald-400' : 'text-red-400'">
            {{ e.amount >= 0 ? '+' : '' }}{{ e.amount }}
          </span>
          <span class="flex-1 text-slate-300">{{ reasonText[e.reason ?? ''] ?? e.note ?? '初始活力值' }}</span>
          <span class="text-[11px] text-slate-600">{{ new Date(e.created_at).toLocaleDateString() }}</span>
        </li>
        <li v-if="ledger.length === 0" class="text-sm text-slate-600 py-2">暂无流水</li>
      </ul>
    </div>
  </div>
</template>

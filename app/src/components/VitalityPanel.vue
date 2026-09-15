<script setup lang="ts">
import { computed } from 'vue'
import type { LedgerEntry } from '../lib/game'

const props = defineProps<{ vitality: number; ledger: LedgerEntry[] }>()

const vitalityColor = computed(() =>
  props.vitality < 0 ? '#ff4d4f' : props.vitality < 25 ? '#faad14' : '#52c41a'
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
  <a-card :bordered="true">
    <a-statistic title="活力值" :value="vitality"
      :value-style="{ color: vitalityColor, fontSize: '40px', fontWeight: 700 }" />

    <a-divider style="margin: 16px 0" />

    <a-typography-text type="secondary" class="text-xs uppercase tracking-wider">流水账</a-typography-text>
    <a-list :data-source="ledger" size="small" style="max-height: 300px; overflow-y: auto; margin-top: 8px">
      <template #renderItem="{ item }">
        <a-list-item style="padding: 6px 0">
          <div class="flex items-center gap-3 w-full">
            <span class="font-semibold tabular-nums" style="width: 48px; text-align: right"
              :style="{ color: item.amount >= 0 ? '#52c41a' : '#ff4d4f' }">
              {{ item.amount >= 0 ? '+' : '' }}{{ item.amount }}
            </span>
            <span class="flex-1 text-sm">{{ reasonText[item.reason ?? ''] ?? item.note ?? '初始活力值' }}</span>
            <span class="text-xs opacity-50">{{ new Date(item.created_at).toLocaleDateString() }}</span>
          </div>
        </a-list-item>
      </template>
      <template #emptyText><span class="text-xs opacity-50">暂无流水</span></template>
    </a-list>
  </a-card>
</template>

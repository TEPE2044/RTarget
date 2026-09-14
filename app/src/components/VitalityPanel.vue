<script setup lang="ts">
import { computed } from 'vue'
import type { LedgerEntry } from '../lib/game'

const props = defineProps<{ vitality: number; ledger: LedgerEntry[] }>()

const vitalityClass = computed(() =>
  props.vitality < 0 ? 'negative' : props.vitality < 25 ? 'low' : 'healthy'
)

const reasonText: Record<string, string> = {
  a_failed: 'A 判负 · 扣押注分',
  c_entered: '进入惩罚复合体 · 扣 C 分',
  b_completed: '奖励 B 完成 · 回血',
  compound_fail: '复合体双未完成 · 再扣 A+C',
  compound_redeem: '复合体双完成 · 返还 A+C',
}
</script>

<template>
  <div class="panel">
    <div class="vitality" :class="vitalityClass">
      <span class="label">活力值</span>
      <span class="value">{{ vitality }}</span>
    </div>

    <div class="ledger">
      <h4>流水账</h4>
      <ul>
        <li v-for="e in ledger" :key="e.id">
          <span class="amount" :class="e.amount >= 0 ? 'plus' : 'minus'">
            {{ e.amount >= 0 ? '+' : '' }}{{ e.amount }}
          </span>
          <span class="reason">{{ reasonText[e.reason ?? ''] ?? e.note ?? '初始活力值' }}</span>
          <span class="time">{{ new Date(e.created_at).toLocaleString() }}</span>
        </li>
        <li v-if="ledger.length === 0" class="empty">暂无流水</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: #1c1f26;
  border-radius: 12px;
  padding: 20px;
  color: #e6e6e6;
}
.vitality {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid #2a2e38;
}
.label { color: #9aa0aa; font-size: 14px; }
.value { font-size: 42px; font-weight: 700; }
.healthy { color: #7fe08a; }
.low { color: #f0c94f; }
.negative { color: #ff7a7a; }

.ledger h4 { margin: 16px 0 8px; color: #9aa0aa; font-size: 13px; }
.ledger ul { list-style: none; padding: 0; margin: 0; max-height: 280px; overflow-y: auto; }
.ledger li {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px dashed #2a2e38;
}
.amount { width: 56px; text-align: right; font-weight: 600; }
.plus { color: #7fe08a; }
.minus { color: #ff7a7a; }
.reason { flex: 1; color: #c8cdd4; }
.time { color: #666d78; font-size: 11px; }
.empty { color: #666d78; }
</style>

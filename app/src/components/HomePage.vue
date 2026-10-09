<script setup lang="ts">
import { computed } from 'vue'
import { booted, feed, goals, vitality } from '../lib/store'
import type { Goal, RecordItem } from '../lib/game'
import { fmtTime } from '../lib/format'

const emit = defineEmits<{
  (e: 'more'): void
  (e: 'wizard'): void
  (e: 'todo'): void
  (e: 'goal', id: string): void
}>()

const vitalityPct = computed(() =>
  Math.max(0, Math.min(100, Math.round((vitality.value / 30) * 100)))
)

const ICONS: Record<string, string> = {
  done: 'passed', failed: 'revoke', created: 'plus', sealed: 'lock',
}

/** 动态里提到的那条目标（点了就进详情） */
function goalOf(f: RecordItem): Goal | undefined {
  return goals.value.find((g) => f.text.includes(g.content))
}

function onFeedClick(f: RecordItem) {
  const g = goalOf(f)
  if (g) emit('goal', g.id)
}
</script>

<template>
  <van-nav-bar title="今天">
    <template #right>
      <van-icon name="ellipsis" size="20" @click="emit('more')" />
    </template>
  </van-nav-bar>

  <div class="pad">
    <van-skeleton v-if="!booted" title :row="5" />
    <template v-else>
      <div class="hero-card">
        <p class="hero-label">活力值</p>
        <p class="hero-num">{{ vitality }}</p>
        <div class="hero-bar"><i :style="{ width: vitalityPct + '%' }"></i></div>
        <p class="hero-legend">押注：低 <b>5</b> · 中 <b>10</b> · 高 <b>20</b> · ALL IN <b>80%</b></p>
      </div>

      <div class="quick">
        <van-button type="primary" block round @click="emit('wizard')">新目标</van-button>
        <van-button plain block round @click="emit('todo')">记待办</van-button>
      </div>

      <van-cell-group inset title="最近">
        <van-cell v-for="f in feed" :key="f.id" :title="f.text" :label="fmtTime(f.created_at)"
          :is-link="!!goalOf(f)" @click="onFeedClick(f)">
          <template #icon>
            <span class="cell-lead">
              <van-icon :name="ICONS[f.type] || 'passed'" :class="'f-ic f-ic-' + f.type" />
            </span>
          </template>
        </van-cell>
        <van-cell v-if="!feed.length" title="还没有动静 —— 立个目标，或者记条待办" />
      </van-cell-group>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import {
  activeArchive, activeArchiveId, activeGoals, archiveHasPending, askSeal,
  booted, newArchive, openArchives,
} from '../lib/store'
import { TIER_LABEL } from '../lib/game'
import { fmtLeft } from '../lib/format'

const emit = defineEmits<{
  (e: 'wizard'): void
  (e: 'goal', id: string): void
}>()

const anyPending = computed(() => openArchives.value.some((a) => archiveHasPending(a.id)))

function switchArchive(id: string) {
  activeArchiveId.value = id
}
</script>

<template>
  <van-nav-bar title="目标">
    <template #right>
      <van-icon name="plus" size="20" @click="emit('wizard')" />
    </template>
  </van-nav-bar>

  <div class="pad">
    <template v-if="booted">
      <div class="a-chips">
        <button v-for="a in openArchives" :key="a.id" class="a-chip"
          :class="{ on: a.id === activeArchiveId }" @click="switchArchive(a.id)">
          <i v-if="archiveHasPending(a.id)" class="dot"></i>{{ a.name }}
        </button>
        <button class="a-chip a-chip-add" @click="newArchive">＋ 新档</button>
      </div>
      <div v-if="activeArchive" class="seal-row">
        <span v-if="anyPending" class="seal-hint">红点 = 这个存档还有没做完的事</span>
        <van-button size="small" type="danger" plain @click="askSeal">封档</van-button>
      </div>
    </template>

    <van-skeleton v-if="!booted" title :row="5" />
    <template v-else>
      <div v-for="g in activeGoals" :key="g.id" class="goal-card" @click="emit('goal', g.id)">
        <p class="goal-title">{{ g.content }}</p>
        <p class="goal-meta">
          <van-icon name="clock-o" />{{ fmtLeft(g.due_at) }} · 押 {{ TIER_LABEL[g.tier] }} {{ g.stake }}
        </p>
        <div class="goal-duo">
          <span class="chip chip-warm">
            <van-icon name="gift-o" /><span class="chip-t">奖励 · {{ g.reward || '没写' }}</span>
          </span>
          <span class="chip chip-cold">
            <van-icon name="warning-o" /><span class="chip-t">惩罚 · {{ g.penalty || '没写' }}</span>
          </span>
        </div>
      </div>
      <van-empty v-if="!activeGoals.length" description="这个存档还没有进行中的目标 —— 点右上角立一个" />
    </template>
  </div>
</template>
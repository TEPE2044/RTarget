<script setup lang="ts">
import { computed } from 'vue'
import {
  activeArchive, activeArchiveId, activeGoals, archiveHasPending, askSeal,
  booted, busy, openArchives,
} from '../lib/store'
import { TIER_LABEL } from '../lib/game'
import { fmtLeft } from '../lib/format'

const emit = defineEmits<{
  (e: 'wizard'): void
  (e: 'goal', id: string): void
  (e: 'archive'): void
}>()

/** 封档提示只讲**当前这个档**的事 —— 它就是"封档会不会扣分"的依据。
    数全部存档的话，会出现"别的档有事、当前档干干净净"却提示要扣分的情况。 */
const activePending = computed(() =>
  activeArchiveId.value ? archiveHasPending(activeArchiveId.value) : false
)

function switchArchive(id: string) {
  activeArchiveId.value = id
}
</script>

<template>
  <van-skeleton v-if="!booted" title :row="6" style="padding:16px 0" />
  <template v-else>
    <!-- 存档页签：进行中的档之间随意切换 -->
    <div class="rt-archrow">
      <div class="rt-chips">
        <button v-for="a in openArchives" :key="a.id" class="rt-chip"
          :class="{ active: a.id === activeArchiveId }" @click="switchArchive(a.id)">
          <i v-if="archiveHasPending(a.id)" class="rt-dot"></i>{{ a.name }}
        </button>
        <button class="rt-chip rt-chip-add" @click="emit('archive')">＋ 新档</button>
      </div>
    </div>

    <div v-if="activeArchive" class="rt-bar" style="margin-bottom:12px">
      <span class="rt-meta">
        {{ activePending ? '还有事没做完，封档要扣分' : '都做完了，封档免费' }}
      </span>
      <button class="rbtn rbtn-danger rt-push" :disabled="busy" @click="askSeal()">封档</button>
    </div>

    <!-- 目标卡：标题居中，奖励 / 惩罚等宽并排铺满 -->
    <div v-for="g in activeGoals" :key="g.id" class="rt-card rt-goal" @click="emit('goal', g.id)">
      <p class="rt-goal-t">{{ g.content }}</p>
      <p class="rt-goal-m">
        <svg class="rt-ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.3" />
          <path d="M12 7.4V12l3.2 1.9" />
        </svg>
        <span>{{ fmtLeft(g.due_at) }}</span>
        <span>· 押 {{ TIER_LABEL[g.tier] }} {{ g.stake }}</span>
      </p>
      <div class="rt-duo">
        <span class="rt-slug rt-slug-warm">
          <van-icon name="gift-o" />
          <span class="rt-slug-t">奖励 · {{ g.reward || '没写' }}</span>
        </span>
        <span class="rt-slug rt-slug-cold">
          <van-icon name="warning-o" />
          <span class="rt-slug-t">惩罚 · {{ g.penalty || '没写' }}</span>
        </span>
      </div>
    </div>

    <p v-if="!activeGoals.length" class="rt-meta rt-center-tx" style="padding:28px 0">
      还没有目标
    </p>
  </template>
</template>
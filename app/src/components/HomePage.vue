<script setup lang="ts">
import { computed } from 'vue'
import { booted, busy, feed, goals, vitality } from '../lib/store'
import type { Goal, RecordItem } from '../lib/game'
import { fmtDayTime, fmtTime } from '../lib/format'

const emit = defineEmits<{
  (e: 'wizard'): void
  (e: 'todo'): void
  (e: 'goal', id: string): void
  (e: 'goals'): void
}>()

/** 还没了结的（含已经过了死线、只是还没被结算的） */
const pending = computed(() => goals.value.filter((g) => g.status === 'active'))

/** 过点还没结清的 —— 这是唯一值得占用首页一条横幅的情况 */
const overdue = computed(() =>
  pending.value.filter((g) => new Date(g.due_at).getTime() <= Date.now())
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
  <van-skeleton v-if="!booted" title :row="6" style="padding:16px 0" />
  <template v-else>
    <!-- 过点还没结清的：结算是惰性的（打开应用才跑），所以真会出现"界面还停在能点完成"的状态 -->
    <button v-if="overdue.length" class="rt-alert" @click="emit('goals')">
      <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8.6" />
        <path d="M12 7.6V12l3.2 1.9" />
      </svg>
      <span class="rt-alert-tx">
        <span class="rt-t14s">有 {{ overdue.length }} 件过期了</span>
        <!-- 副标题给的是它本来该什么时候交 -->
        <span class="rt-meta rt-alert-sub">
          {{ overdue[0].content }} · 原定 {{ fmtDayTime(overdue[0].due_at) }}
        </span>
      </span>
      <span class="rt-meta rt-push" style="white-space:nowrap">去处理 →</span>
    </button>

    <!-- 活力值：全系统唯一的数值，主角位 -->
    <div class="rt-card">
      <div class="rt-vital">
        <div>
          <p class="rt-meta" style="margin:0">活力值</p>
          <p class="rt-vital-num rt-num">{{ vitality }}</p>
        </div>
        <div class="rt-vital-side">
          <span class="rt-meta">进行中 {{ pending.length }} 件</span>
          <span class="rt-meta">共 {{ goals.length }} 个目标</span>
        </div>
      </div>
      <!-- 押注档位说明归卡里 —— 摆在外面就成了页面上一条没主的注释 -->
      <p class="rt-vital-legend">
        押注 低 5 · 中 10 · 高 20 · ALL IN 八成
      </p>
    </div>

    <!-- 两个入口：都走"柔和款"，别在首页正中杵一块黑色实心砖 -->
    <div class="rt-quick">
      <button class="rbtn-soft" :disabled="busy" @click="emit('wizard')">新目标</button>
      <button class="rbtn" :disabled="busy" @click="emit('todo')">记待办</button>
    </div>

    <!-- 最近 -->
    <div class="rt-cap rt-gap26">
      <svg class="rt-ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8.3" />
        <path d="M12 7.4V12l3.2 1.9" />
      </svg>
      最近
    </div>
    <div class="rt-card rt-listpad">
      <div v-if="!feed.length" class="rt-li">
        <span class="rt-meta">还没有动静</span>
      </div>
      <div v-for="f in feed" :key="f.id" class="rt-li"
        :class="{ 'rt-li-link': !!goalOf(f) }" @click="onFeedClick(f)">
        <span class="rt-li-ic" :class="'rt-li-ic-' + f.type">
          <van-icon :name="ICONS[f.type] || 'passed'" />
        </span>
        <div class="rt-li-2">
          <div class="rt-li-2-t">{{ f.text }}</div>
          <div class="rt-meta">{{ fmtTime(f.created_at) }}</div>
        </div>
        <van-icon v-if="goalOf(f)" name="arrow" class="rt-meta" />
      </div>
    </div>
  </template>
</template>
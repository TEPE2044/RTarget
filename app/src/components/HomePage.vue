<script setup lang="ts">
import { computed } from 'vue'
import {
  booted, busy, canCheckInToday, checkIn, feed, goals, isCheckGoal, recordLabel, vitality,
} from '../lib/store'
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

/**
 * 首页快捷打卡：进行中、还没打满、且还没到死线的打卡目标。
 *
 * 三样都排除掉才干净：
 * - 打满的会自动结算 → 自动从这里消失，不用手动清
 * - 过了死线的不能再打（check_in_goal 会挡），摆在首页只会是个按不动的按钮；
 *   这种交给上面那条「过期」横幅去说
 * - 非打卡目标（check_total 为 null）压根不该出现在这儿
 */
const checkGoals = computed(() =>
  goals.value
    .filter((g) =>
      isCheckGoal(g) && g.status === 'active'
      && (g.check_done ?? 0) < (g.check_total ?? 0)
      && new Date(g.due_at).getTime() > Date.now()
    )
    // 今天还没打的排前面 —— 每天要动手的就是上面这几个
    .sort((a, b) => Number(canCheckInToday(b)) - Number(canCheckInToday(a)))
)

/** 今天还剩几个未打卡。全打完时标题换成一句话，比显示 "0 个未打卡" 好听 */
const checkLeft = computed(() => checkGoals.value.filter(canCheckInToday).length)

/**
 * 动态里提到的那条目标（点了就进详情）。
 *
 * 优先按 goal_id 精确命中；没有 id 的（目标已被删档清掉、或者重名没能回填）
 * 退回按名字精确比 —— 比原来的 `text.includes(名字)` 稳：包含匹配会把
 * "踩踩踩" 匹配到 "踩踩踩2" 上。
 */
function goalOf(f: RecordItem): Goal | undefined {
  if (f.goal_id) return goals.value.find((g) => g.id === f.goal_id)
  if (f.goal_content) return goals.value.find((g) => g.content === f.goal_content)
  return undefined
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

    <!-- 快捷打卡：一个打卡目标都没有时整块不渲染（连标题都不占位）。
         放在活力值下面、两个入口上面 —— 每天要动手的事优先于"新建" -->
    <template v-if="checkGoals.length">
      <div class="rt-cap rt-gap26">
        <svg class="rt-ico" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.3" />
          <path d="M8.2 12.3 11 15.1 15.9 9.3" />
        </svg>
        打卡
        <span class="rt-meta rt-push">
          {{ checkLeft ? `${checkLeft} 个目标未打卡` : '今天目标已完成' }}
        </span>
      </div>
      <div class="rt-card rt-listpad">
        <!-- 整行可点进目标详情；按钮是行内唯一动作，所以 @click.stop -->
        <div v-for="g in checkGoals" :key="g.id" class="rt-li rt-li-link"
          :class="{ 'rt-done': !canCheckInToday(g) }" @click="emit('goal', g.id)">
          <div class="rt-li-2">
            <div class="rt-li-2-t">{{ g.content }}</div>
            <div class="rt-checkline">
              <span class="rt-batt">
                <i v-for="n in g.check_total" :key="n" :class="{ on: n <= g.check_done }"></i>
              </span>
              <span class="rt-meta">{{ g.check_done }} / {{ g.check_total }}</span>
            </div>
          </div>
          <span class="rt-li-act">
            <button class="rbtn rbtn-soft" :disabled="busy || !canCheckInToday(g)"
              @click.stop="checkIn(g)">
              {{ canCheckInToday(g) ? '打卡' : '今日已打' }}
            </button>
          </span>
        </div>
      </div>
    </template>

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
      <div v-for="f in feed" :key="f.id" class="rt-li rt-li-flow"
        :class="{ 'rt-li-link': !!goalOf(f) }" @click="onFeedClick(f)">
        <span class="rt-li-ic" :class="'rt-li-ic-' + f.type">
          <van-icon :name="ICONS[f.type] || 'passed'" />
        </span>
        <div class="rt-li-2">
          <div class="rt-li-2-t">{{ recordLabel(f) }}</div>
          <div class="rt-meta">{{ fmtTime(f.created_at) }}</div>
        </div>
        <van-icon v-if="goalOf(f)" name="arrow" class="rt-meta" />
      </div>
    </div>
  </template>
</template>
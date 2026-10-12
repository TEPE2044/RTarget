<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  askGiveUp, busy, canCheckInToday, checkIn, finishGoal, goals, isCheckGoal, saveExec,
} from '../lib/store'
import { TIER_LABEL } from '../lib/game'
import { fmtLeft } from '../lib/format'

const props = defineProps<{ show: boolean; goalId: string | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const goal = computed(() => goals.value.find((g) => g.id === props.goalId) ?? null)

/** 执行区：随写随存（停手 0.8 秒才落库，免得每敲一个字打一次请求） */
const exec = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [props.show, props.goalId] as const,
  ([show]) => {
    if (show && goal.value) exec.value = goal.value.exec
  },
  { immediate: true },
)

watch(exec, () => {
  if (!props.show || !goal.value) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), 800)
})

async function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  const g = goal.value
  if (!g || g.exec === exec.value) return
  await saveExec(g.id, exec.value)
  g.exec = exec.value // 本地对齐，别让下一次判定又觉得是脏的
}

function close() {
  void flush()
  emit('update:show', false)
}

async function doComplete() {
  const g = goal.value
  if (!g) return
  await flush()
  emit('update:show', false)
  await finishGoal(g)
}

/** 目标结清了（放弃 / 到点判负）就顺手把这个浮层收掉，别停在一条已死的目标上 */
watch(
  () => goal.value?.status,
  (s) => { if (props.show && s && s !== 'active') emit('update:show', false) },
)

onUnmounted(() => void flush())
</script>

<template>
  <van-popup :show="show" position="right" :style="{ width: '100%', height: '100%' }" :duration="0.25"
    :close-on-click-overlay="false" @update:show="(v: boolean) => emit('update:show', v)">
    <div v-if="goal" class="rt-page">
      <div class="rt-page-head">
        <button class="rt-iconbtn" aria-label="返回" @click="close()">
          <svg class="rt-ico" width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 5.5 8.5 12l6.5 6.5" />
          </svg>
        </button>

        <!-- 标题在左、放弃在右。
             这里必须用 flex-1 撑满：Tailwind v4 的 w-100 是 25rem(400px)，
             **不是 width:100%** —— 写成 w-100，「放弃」会停在离左边 400px 的半空中。 -->
        <div class="flex-1 min-w-0 flex justify-between items-center">
          <span class="rt-sec">目标</span>
          <div class="btn-group">
            <button class="rbtn rbtn-danger" @click="askGiveUp(goal)">放弃</button>
            <button v-if="!isCheckGoal(goal)" class="rbtn-primary ml-2" @click="doComplete()">完成</button>
          </div>
        </div>
      </div>

      <div class="rt-page-body">
        <h2 class="rt-detail-t">{{ goal.content }}</h2>
        <div class="rt-detail-m">
          <span>{{ fmtLeft(goal.due_at) }}</span>
          <span>· 押 {{ TIER_LABEL[goal.tier] }} {{ goal.stake }}</span>
        </div>

        <!-- 打卡型目标：进度 + 打卡。打满由库里自动结算，不需要再点完成 -->
        <div v-if="isCheckGoal(goal)" class="rt-card rt-checkcard rt-gap12">
          <div class="rt-checkrow">
            <span class="rt-batt">
              <i v-for="n in goal.check_total" :key="n" :class="{ on: n <= goal.check_done }"></i>
            </span>
            <span class="rt-meta">{{ goal.check_done }} / {{ goal.check_total }}</span>
            <button class="rbtn rbtn-soft rt-push" :disabled="busy || !canCheckInToday(goal)"
              @click="checkIn(goal)">
              {{ canCheckInToday(goal) ? '打卡' : '今日已打' }}
            </button>
          </div>
          <p class="rt-legend" style="margin-top:8px">打满即自动结算。到死线没打满，照旧判负。</p>
        </div>

        <div class="rt-panel rt-panel-warm rt-gap12">
          <div class="rt-panel-head">
            <van-icon name="gift-o" />做到了 · 奖励
          </div>
          <p class="rt-panel-tx">{{ goal.reward || '（没写）' }}</p>
          <p class="rt-panel-sub">达成即兑现</p>
        </div>

        <div class="rt-panel rt-panel-cold rt-gap12">
          <div class="rt-panel-head">
            <van-icon name="warning-o" />做不到 · 惩罚
          </div>
          <p class="rt-panel-tx">{{ goal.penalty || '（没写）' }}</p>
          <p class="rt-panel-sub">扣 {{ goal.stake }} 活力值</p>
        </div>

        <p class="rt-cap rt-gap20">
          <van-icon name="edit" />怎么做
        </p>
        <div class="rt-card rt-listpad">
          <van-field v-model="exec" type="textarea" autosize :rows="6"
            placeholder="计划、步骤、想法" />
        </div>
      </div>

      <!-- 放弃已经移到顶栏了，这条底栏只剩「完成」——
           用 solo 变体居中，不然它会缩在 1fr 那一列里靠左 -->
      <!-- <div class="rt-page-foot rt-page-foot-solo"> -->
        <!-- 打卡型没有「完成」可点：它只有一个达成条件 —— 打满，
             而打满那一刻库里会自动结算。摆一个点不动的按钮只会让人猜。 -->
        <!-- <button v-if="!isCheckGoal(goal)" class="rbtn-primary" @click="doComplete()">完成</button>
        <span v-else class="rt-meta">打满就自动结算，不用点完成</span>
      </div> -->
    </div>
  </van-popup>
</template>
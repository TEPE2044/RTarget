<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { askGiveUp, finishGoal, goals, saveExec } from '../lib/store'
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
    <div v-if="goal" class="d-page">
      <van-nav-bar title="目标" left-arrow @click-left="close" />
      <div class="d-body">
        <h2 class="hero">{{ goal.content }}</h2>
        <div class="d-meta">
          <van-icon name="clock-o" /><span>{{ fmtLeft(goal.due_at) }}</span>
          <van-tag type="primary" plain>押 {{ TIER_LABEL[goal.tier] }} {{ goal.stake }}</van-tag>
        </div>

        <div class="panel panel-warm">
          <div class="p-head"><van-icon name="gift-o" />做到了 · 奖励</div>
          <p class="p-text">{{ goal.reward || '（没写）' }}</p>
          <p class="p-sub">达成那一刻就算兑现，自动从愿望单划掉。</p>
        </div>
        <div class="panel panel-cold">
          <div class="p-head"><van-icon name="warning-o" />做不到 · 惩罚</div>
          <p class="p-text">{{ goal.penalty || '（没写）' }}</p>
          <p class="p-sub">扣 {{ goal.stake }} 活力值 · 目标关闭</p>
        </div>

        <div class="d-exec-label"><van-icon name="edit" />怎么做</div>
        <van-cell-group inset>
          <van-field v-model="exec" type="textarea" autosize :rows="6"
            placeholder="写计划、写步骤、想到什么写什么……支持 Markdown" />
        </van-cell-group>
      </div>
      <div class="foot">
        <van-button block plain type="danger" @click="askGiveUp(goal)">放弃</van-button>
        <van-button block type="primary" @click="doComplete">完成</van-button>
      </div>
    </div>
  </van-popup>
</template>
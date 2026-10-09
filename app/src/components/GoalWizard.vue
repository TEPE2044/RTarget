<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  addGoal, openTodos, pickableWishes, previewStake, reportError,
} from '../lib/store'
import { TIER_LABEL } from '../lib/game'
import type { Tier } from '../lib/game'
import { fmtDue, pad2n } from '../lib/format'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'done'): void
}>()

type Source = 'todo' | 'free'
type RewardFrom = 'wish' | 'free'

const wz = reactive({
  step: 1,
  source: 'free' as Source,
  title: '',
  pickId: null as string | null,
  dueAt: Date.now() + 24 * 3600e3,
  dueLabel: '明天此刻',
  pickerShow: false,
  pickerMode: 'date' as 'date' | 'time',
  pickerDate: [] as string[],
  pickerTime: [] as string[],
  tier: 'low' as Tier,
  rewardFrom: 'free' as RewardFrom,
  rewardPick: null as string | null,
  reward: '',
  penalty: '',
  exec: '',
})

/**
 * 待办的「内容」带进执行区当起点（见 mechanism.md）。
 * 只在用户还没动过执行区的时候灌 —— 一旦自己写了，就不能再被覆盖。
 */
let execSeed = ''

/** 每开一次就是全新的一页（不能留着上一次的残渣） */
function reset() {
  wz.step = 1
  wz.source = 'free'
  wz.title = ''
  wz.pickId = null
  wz.dueAt = Date.now() + 24 * 3600e3
  wz.dueLabel = '明天此刻'
  wz.pickerShow = false
  wz.pickerMode = 'date'
  wz.tier = 'low'
  wz.rewardFrom = 'free'
  wz.rewardPick = null
  wz.reward = ''
  wz.penalty = ''
  wz.exec = ''
  execSeed = ''
}

/**
 * 待办的「内容」带进执行区当起点（见 mechanism.md）。
 * 只在用户还没动过执行区的时候灌 —— 一旦自己写了，就不能再被覆盖。
 */
watch(
  () => [wz.source, wz.pickId] as const,
  () => {
    if (wz.source !== 'todo') return
    const note = openTodos.value.find((t) => t.id === wz.pickId)?.note ?? ''
    if (wz.exec === execSeed) {
      wz.exec = note
      execSeed = note
    }
  },
)

watch(() => props.show, (v) => { if (v) reset() })

const quickDues = [
  {
    label: '今晚 18:00',
    fn: () => {
      const d = new Date()
      d.setHours(18, 0, 0, 0)
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
      return d.getTime()
    },
  },
  { label: '明天此刻', fn: () => Date.now() + 24 * 3600e3 },
  {
    label: '后天 18:00',
    fn: () => {
      const d = new Date()
      d.setDate(d.getDate() + 2)
      d.setHours(18, 0, 0, 0)
      return d.getTime()
    },
  },
]

const minDate = new Date()
const maxDate = new Date(Date.now() + 365 * 86400e3)

const wzStake = computed(() => previewStake(wz.tier))
const wzTierLabel = computed(() => TIER_LABEL[wz.tier])
const wzValid = computed(() => (wz.source === 'todo' ? !!wz.pickId : !!wz.title.trim()))
const wzTitle = computed(() =>
  wz.source !== 'todo'
    ? wz.title.trim()
    : (openTodos.value.find((t) => t.id === wz.pickId)?.content ?? '')
)
const wzReward = computed(() =>
  wz.rewardFrom !== 'wish'
    ? wz.reward.trim()
    : (pickableWishes.value.find((w) => w.id === wz.rewardPick)?.content ?? '')
)
const wzDueText = computed(() => fmtDue(wz.dueAt))

function step(n: number) {
  const s = wz.step + n
  if (s >= 1 && s <= 6) wz.step = s
}

function pickDue(q: { label: string; fn: () => number }) {
  wz.dueAt = q.fn()
  wz.dueLabel = q.label
}

function openPicker() {
  const d = new Date(wz.dueAt)
  wz.pickerDate = [String(d.getFullYear()), pad2n(d.getMonth() + 1), pad2n(d.getDate())]
  wz.pickerTime = [pad2n(d.getHours()), pad2n(d.getMinutes())]
  wz.pickerMode = 'date'
  wz.pickerShow = true
}

function onDateConfirm({ selectedValues }: { selectedValues: string[] }) {
  wz.pickerDate = selectedValues
  wz.pickerMode = 'time' // 选完日期接着选时刻
}

function onTimeConfirm({ selectedValues }: { selectedValues: string[] }) {
  wz.pickerTime = selectedValues
  const [y, mo, da] = wz.pickerDate.map(Number)
  const [h, mi] = selectedValues.map(Number)
  wz.dueAt = new Date(y, mo - 1, da, h, mi).getTime()
  wz.dueLabel = '自定义'
  wz.pickerShow = false
}

async function next() {
  if (wz.step === 6) return submit()
  wz.step += 1
}

async function submit() {
  if (!wzValid.value) return
  try {
    await addGoal({
      content: wzTitle.value,
      tier: wz.tier,
      dueAt: new Date(wz.dueAt).toISOString(),
      reward: wzReward.value,
      rewardWishId: wz.rewardFrom === 'wish' ? wz.rewardPick : null,
      penalty: wz.penalty.trim(),
      exec: wz.exec,
      todoId: wz.source === 'todo' ? wz.pickId : null,
    })
    emit('update:show', false)
    emit('done')
  } catch (e) {
    await reportError(e)
  }
}

function cancel() {
  emit('update:show', false)
}
</script>

<template>
  <van-popup :show="show" position="bottom" :style="{ height: '100%' }" :duration="0.25"
    :close-on-click-overlay="false" @update:show="(v: boolean) => emit('update:show', v)">
    <div class="wz-page">
      <van-nav-bar :title="'第 ' + wz.step + ' / 6 页'" left-arrow @click-left="cancel" />
      <div class="dots"><i v-for="n in 6" :key="n" :class="{ on: n === wz.step }"></i></div>
      <div class="wz-body">
        <!-- ① 目标 -->
        <template v-if="wz.step === 1">
          <h3 class="wz-h">要立一个什么目标？</h3>
          <p class="wz-sub">从待办里挑一条，或者临时起意写一个。</p>
          <div class="segline">
            <van-button :type="wz.source === 'todo' ? 'primary' : 'default'"
              :plain="wz.source !== 'todo'" @click="wz.source = 'todo'">从待办挑</van-button>
            <van-button :type="wz.source === 'free' ? 'primary' : 'default'"
              :plain="wz.source !== 'free'" @click="wz.source = 'free'">自己写</van-button>
          </div>
          <van-radio-group v-if="wz.source === 'todo'" v-model="wz.pickId">
            <van-cell-group v-if="openTodos.length" inset>
              <van-cell v-for="t in openTodos" :key="t.id" :title="t.content" clickable
                @click="wz.pickId = t.id">
                <template #right-icon><van-radio :name="t.id" /></template>
              </van-cell>
            </van-cell-group>
            <van-empty v-else description="待办是空的 —— 切到「自己写」吧" />
          </van-radio-group>
          <van-cell-group v-else inset>
            <van-field v-model="wz.title" label="目标" placeholder="比如：把阳台收拾出来" />
          </van-cell-group>
        </template>

        <!-- ② 死线 + 押注 -->
        <template v-else-if="wz.step === 2">
          <h3 class="wz-h">什么时候做到？押多少？</h3>
          <p class="wz-sub">到点没做到就算判负 —— 押多少，输了就扣多少。</p>
          <div class="chips">
            <van-button v-for="q in quickDues" :key="q.label" size="small" round
              :type="wz.dueLabel === q.label ? 'primary' : 'default'"
              :plain="wz.dueLabel !== q.label" @click="pickDue(q)">{{ q.label }}</van-button>
            <van-button size="small" round plain @click="openPicker">自定义…</van-button>
          </div>
          <van-cell-group inset>
            <van-cell title="死线" :value="wzDueText" is-link @click="openPicker" />
          </van-cell-group>
          <van-cell-group inset title="押注档位">
            <div class="segline segline-pad">
              <van-button :type="wz.tier === 'low' ? 'primary' : 'default'"
                :plain="wz.tier !== 'low'" @click="wz.tier = 'low'">低 5</van-button>
              <van-button :type="wz.tier === 'mid' ? 'primary' : 'default'"
                :plain="wz.tier !== 'mid'" @click="wz.tier = 'mid'">中 10</van-button>
              <van-button :type="wz.tier === 'high' ? 'primary' : 'default'"
                :plain="wz.tier !== 'high'" @click="wz.tier = 'high'">高 20</van-button>
              <van-button :type="wz.tier === 'allin' ? 'primary' : 'default'"
                :plain="wz.tier !== 'allin'" @click="wz.tier = 'allin'">ALL IN</van-button>
            </div>
            <div class="legend2">赢了 +{{ wzStake }} / 输了 −{{ wzStake }} 活力值</div>
          </van-cell-group>
        </template>

        <!-- ③ 奖励 -->
        <template v-else-if="wz.step === 3">
          <h3 class="wz-h">做到了，奖励是什么？</h3>
          <p class="wz-sub">从愿望单挑一个 —— 达成那一刻就算兑现；也可以临时写一句。</p>
          <div class="segline">
            <van-button :type="wz.rewardFrom === 'wish' ? 'primary' : 'default'"
              :plain="wz.rewardFrom !== 'wish'" @click="wz.rewardFrom = 'wish'">从愿望挑</van-button>
            <van-button :type="wz.rewardFrom === 'free' ? 'primary' : 'default'"
              :plain="wz.rewardFrom !== 'free'" @click="wz.rewardFrom = 'free'">写一句</van-button>
          </div>
          <van-radio-group v-if="wz.rewardFrom === 'wish'" v-model="wz.rewardPick">
            <van-cell-group v-if="pickableWishes.length" inset>
              <van-cell v-for="w in pickableWishes" :key="w.id" :title="w.content" clickable
                @click="wz.rewardPick = w.id">
                <template #right-icon><van-radio :name="w.id" /></template>
              </van-cell>
            </van-cell-group>
            <van-empty v-else description="愿望单是空的 —— 切到「写一句」吧" />
          </van-radio-group>
          <van-cell-group v-else inset>
            <van-field v-model="wz.reward" label="奖励" placeholder="比如：看一场电影" />
          </van-cell-group>
        </template>

        <!-- ④ 惩罚 -->
        <template v-else-if="wz.step === 4">
          <h3 class="wz-h">做不到，罚自己什么？</h3>
          <p class="wz-sub">写一句就好，也可以留空 —— 系统的处理是固定的。</p>
          <van-cell-group inset>
            <van-field v-model="wz.penalty" label="惩罚" placeholder="比如：手洗羽绒服" />
          </van-cell-group>
          <van-notice-bar wrapable :scrollable="false" left-icon="info-o"
            :text="'做不到会：扣 ' + wzStake + ' 活力值' + (wz.source === 'todo' ? '，并退回待办（次数不动）' : '') + '，目标关闭。没有第二阶段，也没有补做。'" />
        </template>

        <!-- ⑤ 怎么做 -->
        <template v-else-if="wz.step === 5">
          <h3 class="wz-h">具体怎么做？</h3>
          <p class="wz-sub">像手机笔记那样写：步骤、清单、想法都行，支持 Markdown，之后随时补。</p>
          <van-cell-group inset>
            <van-field v-model="wz.exec" type="textarea" autosize :rows="8" placeholder="第一步……" />
          </van-cell-group>
        </template>

        <!-- ⑥ 确认 -->
        <template v-else>
          <h3 class="wz-h">最后看一眼</h3>
          <p class="wz-sub">确认后就不能改了 —— 到点见分晓。</p>
          <van-cell-group inset>
            <van-cell title="目标" :value="wzTitle" />
            <van-cell title="死线" :value="wzDueText" />
            <van-cell title="押注" :value="wzTierLabel + ' · 输赢 ' + wzStake + ' 分'" />
            <van-cell title="奖励" :value="wzReward || '（没写）'" />
            <van-cell title="惩罚" :value="wz.penalty || '（没写）'" />
            <van-cell title="怎么做"
              :value="wz.exec.trim() ? '已写 ' + wz.exec.trim().length + ' 字' : '（还没写，立完再写也行）'" />
          </van-cell-group>
          <van-notice-bar wrapable :scrollable="false" left-icon="info-o"
            :text="'做到：+' + wzStake + ' 活力值，奖励当场兑现。做不到：−' + wzStake + ' 活力值' + (wz.source === 'todo' ? '，退回待办' : '') + '，目标关闭。'" />
        </template>
      </div>
      <div class="foot">
        <van-button block plain :disabled="wz.step === 1" @click="step(-1)">上一步</van-button>
        <van-button block type="primary" :disabled="!wzValid" @click="next">
          {{ wz.step === 6 ? '押注设立' : '继续' }}
        </van-button>
      </div>
    </div>
  </van-popup>

  <!-- 日期 / 时刻选择 -->
  <van-popup v-model:show="wz.pickerShow" position="bottom" round>
    <van-date-picker v-if="wz.pickerMode === 'date'" v-model="wz.pickerDate" :min-date="minDate"
      :max-date="maxDate" title="选日期" @confirm="onDateConfirm" @cancel="wz.pickerShow = false" />
    <van-time-picker v-else v-model="wz.pickerTime" title="选时刻"
      @confirm="onTimeConfirm" @cancel="wz.pickerShow = false" />
  </van-popup>
</template>
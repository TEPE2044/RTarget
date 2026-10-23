<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  addGoal, busy, openTodos, pickableWishes, previewStake, reportError,
} from '../lib/store'
import { TIER_LABEL } from '../lib/game'
import type { Tier } from '../lib/game'
import { checkInSlots, fmtDue, pad2n } from '../lib/format'

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
  /** 打卡型目标的总格数；null = 一次做完 */
  checkTotal: null as number | null,
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
  wz.checkTotal = null
  wz.rewardFrom = 'free'
  wz.rewardPick = null
  wz.reward = ''
  wz.penalty = ''
  wz.exec = ''
  execSeed = ''
}

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

/** 桌面变体：Vant 的滚轮选择器只认触摸，鼠标拖不动，换成原生的日期时间控件 */
const isDesktopPlat = import.meta.env.VITE_PLATFORM === 'desktop'
const nativeDue = ref('')

/** `<input type="datetime-local">` 要的是 `YYYY-MM-DDTHH:mm`（本地时间，不带时区） */
function toLocalInput(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2n(d.getMonth() + 1)}-${pad2n(d.getDate())}`
    + `T${pad2n(d.getHours())}:${pad2n(d.getMinutes())}`
}
const nativeMin = toLocalInput(minDate.getTime())
const nativeMax = toLocalInput(maxDate.getTime())

const wzStake = computed(() => previewStake(wz.tier))
const wzTierLabel = computed(() => TIER_LABEL[wz.tier])

/** 从此刻到死线还能打几次卡（一天最多一次）—— 打卡次数的硬上限 */
const wzMaxChecks = computed(() => checkInSlots(wz.dueAt))
/** 次数要得比天数还多，这个目标永远打不满，挡在第 2 步 */
const wzChecksFeasible = computed(
  () => wz.checkTotal === null || wz.checkTotal <= wzMaxChecks.value
)

/**
 * 切到「分次打卡」。
 *
 * 顺手把死线拉长：默认死线是"明天此刻"，那个上限只有 2 次，
 * 一进去就是不可能达成的目标。取"当前死线"和"默认 30 天"里更远的那个，
 * 用户之后想改还是能改。
 */
function pickCheckMode() {
  if (wz.checkTotal === null) wz.checkTotal = 30
  const need = Date.now() + wz.checkTotal * 86400e3
  if (wz.dueAt < need) {
    wz.dueAt = need
    wz.dueLabel = '自定义'
  }
}
/** 第 1 步：目标必须有（挑一条待办，或者自己写一句） */
const wzValid = computed(() => (wz.source === 'todo' ? !!wz.pickId : !!wz.title.trim()))

/**
 * 「继续」的放行条件，**逐步判定**。
 *
 * 第 3 步奖励、第 4 步惩罚都**不能为空**：这个机制的兑现是"做到给什么、
 * 做不到罚什么"两头都要给出承诺，空着一头等于没立。
 * （原先只有第 1 步有门槛，后面几步能空着过去，是漏的。）
 */
const canNext = computed(() => {
  switch (wz.step) {
    case 1: return wzValid.value
    case 2: return wzChecksFeasible.value
    case 3: return wz.rewardFrom === 'wish' ? !!wz.rewardPick : !!wz.reward.trim()
    case 4: return !!wz.penalty.trim()
    default: return true // 第 5 步执行区可后补；第 6 步只是确认
  }
})
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
  nativeDue.value = toLocalInput(wz.dueAt)
  wz.pickerMode = 'date'
  wz.pickerShow = true
}

/** 桌面：原生控件一次选完日期 + 时刻，不用再走"日期 → 时刻"两步 */
function confirmNativeDue() {
  const t = new Date(nativeDue.value).getTime()
  if (Number.isNaN(t)) return
  wz.dueAt = t
  wz.dueLabel = '自定义'
  wz.pickerShow = false
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
  // 库里没有非空约束，也没有"天数装得下次数"的约束，所以这两道防线只在客户端
  // —— 三样都不能缺，打卡次数还得真的打得完
  if (!wzValid.value || !wzReward.value || !wz.penalty.trim() || !wzChecksFeasible.value) return
  if (busy.value) return // 请求锁：第 6 步那颗「押注设立」连点两下会立出两个目标
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
      checkTotal: wz.checkTotal,
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
  <!-- overlay=false：这是全屏不透明浮层，背后那页根本看不见，遮罩纯属多余 ——
       而它会先以 rgba(0,0,0,.55) 铺满整屏再被滑入的面板盖住，看着就是"点一下黑一下"。
       lock-scroll=false：Vant 锁背景滚动会把 window 的滚动位置挪走、关掉还不还回来
       （实测：列表滚到 350，打开浮层变 84，关闭后仍停在 84 —— 位置就丢了） -->
  <van-popup :show="show" position="bottom" :style="{ height: '100%' }" :duration="0.25"
    class="wz-pop"
    :overlay="false" :lock-scroll="false" :close-on-click-overlay="false"
    @update:show="(v: boolean) => emit('update:show', v)">
    <div class="rt-page">
      <div class="rt-page-head">
        <button class="rt-iconbtn" aria-label="返回" @click="cancel()">
          <svg class="rt-ico" width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 5.5 8.5 12l6.5 6.5" />
          </svg>
        </button>
        <span class="rt-sec">第 {{ wz.step }} / 6 页</span>
      </div>

      <div class="rt-page-body">
        <div class="wz-dots"><i v-for="n in 6" :key="n" :class="{ on: n === wz.step }"></i></div>

        <!-- ① 目标 -->
        <template v-if="wz.step === 1">
          <h3 class="wz-h">立什么目标？</h3>
          <p class="wz-sub">从待办挑，或者自己写。</p>
          <div class="rt-seg" style="margin-bottom:12px">
            <button class="rt-segbtn" :class="{ active: wz.source === 'todo' }"
              @click="wz.source = 'todo'">
              <span>从待办挑</span>
              <span class="rt-meta">{{ openTodos.length }} 条待办</span>
            </button>
            <button class="rt-segbtn" :class="{ active: wz.source === 'free' }"
              @click="wz.source = 'free'">
              <span>自己写</span>
              <span class="rt-meta">临时起意</span>
            </button>
          </div>

          <van-radio-group v-if="wz.source === 'todo'" v-model="wz.pickId">
            <div class="rt-card rt-listpad">
              <div v-for="t in openTodos" :key="t.id" class="rt-li" @click="wz.pickId = t.id">
                <span class="rt-li-ic"><van-radio :name="t.id" /></span>
                <div class="rt-li-2">
                  <div class="rt-li-2-t">{{ t.content }}</div>
                  <div v-if="t.note" class="rt-meta rt-quote">{{ t.note }}</div>
                </div>
              </div>
              <div v-if="!openTodos.length" class="rt-li">
                <span class="rt-meta">没有待办</span>
              </div>
            </div>
          </van-radio-group>

          <div v-else class="rt-card rt-listpad">
            <van-field v-model="wz.title" label="目标" placeholder="想做什么" />
          </div>
        </template>

        <!-- ② 死线 + 押注 + 打卡 -->
        <template v-else-if="wz.step === 2">
          <h3 class="wz-h">什么时候做到？</h3>
          <p class="wz-sub">到时间还没完成就算输，押多少扣多少。</p>

          <!-- 一次性还是长期打卡。做成分段选择而不是另开一种目标类型：
               库里也只是 check_total 有没有值，结算规则完全一样 -->
          <div class="rt-seg" style="margin-bottom:14px">
            <button class="rt-segbtn" :class="{ active: wz.checkTotal === null }"
              @click="wz.checkTotal = null">
              <span>一次做完</span>
              <span class="rt-meta">到死线见分晓</span>
            </button>
            <button class="rt-segbtn" :class="{ active: wz.checkTotal !== null }"
              @click="pickCheckMode()">
              <span>分次打卡</span>
              <span class="rt-meta">长期目标</span>
            </button>
          </div>

          <template v-if="wz.checkTotal !== null">
            <div class="rt-card rt-listpad" style="margin-bottom:14px">
              <van-field label="打满几次">
                <template #input>
                  <van-stepper v-model="wz.checkTotal" :min="1" :max="365" integer />
                  <span class="rt-meta" style="margin-left:10px">每天最多打一次</span>
                </template>
              </van-field>
            </div>
            <p class="rt-legend" :class="{ 'rt-legend-bad': !wzChecksFeasible }"
              style="margin-bottom:14px">
              <template v-if="wzChecksFeasible">
                打满 {{ wz.checkTotal }} 次就自动结算，不用再点完成；到死线没打满照旧判负。
              </template>
              <template v-else>
                死线太近了：到那天最多只能打 {{ wzMaxChecks }} 次，把期限往后挪，或者把次数调小。
              </template>
            </p>
          </template>

          <div class="rt-chiprow">
            <button v-for="q in quickDues" :key="q.label" class="rbtn"
              :class="{ 'rbtn-primary': wz.dueLabel === q.label }"
              @click="pickDue(q)">{{ q.label }}</button>
            <button class="rbtn" @click="openPicker()">自定义…</button>
          </div>

          <div class="rt-card rt-listpad" style="margin-bottom:16px">
            <div class="rt-li rt-li-link" @click="openPicker()">
              <span class="rt-li-main">{{ wz.checkTotal === null ? '死线' : '最后期限' }}</span>
              <span class="rt-meta">{{ wzDueText }}</span>
              <van-icon name="arrow" class="rt-meta" />
            </div>
          </div>

          <p class="rt-cap">押注档位</p>
          <div class="rt-segline rt-segline-4">
            <van-button :type="wz.tier === 'low' ? 'primary' : 'default'"
              :plain="wz.tier !== 'low'" @click="wz.tier = 'low'">低 5</van-button>
            <van-button :type="wz.tier === 'mid' ? 'primary' : 'default'"
              :plain="wz.tier !== 'mid'" @click="wz.tier = 'mid'">中 10</van-button>
            <van-button :type="wz.tier === 'high' ? 'primary' : 'default'"
              :plain="wz.tier !== 'high'" @click="wz.tier = 'high'">高 20</van-button>
            <van-button :type="wz.tier === 'allin' ? 'primary' : 'default'"
              :plain="wz.tier !== 'allin'" @click="wz.tier = 'allin'">ALL IN</van-button>
          </div>
          <p class="rt-legend">赢了 +{{ wzStake }} / 输了 −{{ wzStake }} 活力值</p>
        </template>

        <!-- ③ 奖励 -->
        <template v-else-if="wz.step === 3">
          <h3 class="wz-h">做到了，奖励什么？</h3>
          <p class="wz-sub">必须写。从愿望挑，或者自己写一句。</p>
          <div class="rt-seg" style="margin-bottom:12px">
            <button class="rt-segbtn" :class="{ active: wz.rewardFrom === 'wish' }"
              @click="wz.rewardFrom = 'wish'">
              <span>从愿望挑</span>
              <span class="rt-meta">{{ pickableWishes.length }} 个可挑</span>
            </button>
            <button class="rt-segbtn" :class="{ active: wz.rewardFrom === 'free' }"
              @click="wz.rewardFrom = 'free'">
              <span>写一句</span>
              <span class="rt-meta">临时起意</span>
            </button>
          </div>

          <van-radio-group v-if="wz.rewardFrom === 'wish'" v-model="wz.rewardPick">
            <div class="rt-card rt-listpad">
              <div v-for="w in pickableWishes" :key="w.id" class="rt-li" @click="wz.rewardPick = w.id">
                <span class="rt-li-ic"><van-radio :name="w.id" /></span>
                <div class="rt-li-2"><div class="rt-li-2-t">{{ w.content }}</div></div>
              </div>
              <div v-if="!pickableWishes.length" class="rt-li">
                <span class="rt-meta">没有可挑的愿望，切到「写一句」</span>
              </div>
            </div>
          </van-radio-group>

          <div v-else class="rt-card rt-listpad">
            <van-field v-model="wz.reward" label="奖励" placeholder="想做什么" />
          </div>
        </template>

        <!-- ④ 惩罚 -->
        <template v-else-if="wz.step === 4">
          <h3 class="wz-h">做不到，罚什么？</h3>
          <p class="wz-sub">必须写。两头都给出承诺，这事才算立住。</p>
          <div class="rt-card rt-listpad">
            <van-field v-model="wz.penalty" label="惩罚" placeholder="比如：手洗羽绒服" />
          </div>
          <p class="rt-legend">
            做不到：扣 {{ wzStake }} 活力值{{
              wz.source === 'todo' ? '，退回待办' : ''
            }}，目标关闭。
          </p>
        </template>

        <!-- ⑤ 怎么做 -->
        <template v-else-if="wz.step === 5">
          <h3 class="wz-h">怎么做？</h3>
          <p class="wz-sub">步骤、清单、想法都行，之后随时补。</p>
          <div class="rt-card rt-listpad">
            <van-field v-model="wz.exec" type="textarea" autosize :rows="8" placeholder="第一步……" />
          </div>
        </template>

        <!-- ⑥ 确认 -->
        <template v-else>
          <h3 class="wz-h">确认一下</h3>
          <p class="wz-sub">设立后不能改。</p>
          <div class="rt-card rt-listpad">
            <div class="rt-li">
              <span class="rt-li-main">目标</span>
              <span class="rt-meta" style="max-width:60%">{{ wzTitle }}</span>
            </div>
            <div class="rt-li">
              <span class="rt-li-main">死线</span>
              <span class="rt-meta">{{ wzDueText }}</span>
            </div>
            <div class="rt-li">
              <span class="rt-li-main">押注</span>
              <span class="rt-meta">{{ wzTierLabel }} · 输赢 {{ wzStake }} 分</span>
            </div>
            <div v-if="wz.checkTotal !== null" class="rt-li">
              <span class="rt-li-main">打卡</span>
              <span class="rt-meta">打满 {{ wz.checkTotal }} 次 · 每天一次</span>
            </div>
            <div class="rt-li">
              <span class="rt-li-main">奖励</span>
              <span class="rt-meta" style="max-width:60%">{{ wzReward || '（没写）' }}</span>
            </div>
            <div class="rt-li">
              <span class="rt-li-main">惩罚</span>
              <span class="rt-meta" style="max-width:60%">{{ wz.penalty || '（没写）' }}</span>
            </div>
            <div class="rt-li">
              <span class="rt-li-main">怎么做</span>
              <span class="rt-meta">
                {{ wz.exec.trim() ? '已写 ' + wz.exec.trim().length + ' 字' : '还没写' }}
              </span>
            </div>
          </div>
          <p class="rt-legend">
            做到：+{{ wzStake }} 活力值，奖励兑现。做不到：−{{ wzStake }} 活力值{{
              wz.source === 'todo' ? '，退回待办' : ''
            }}。
          </p>
        </template>
      </div>

      <div class="rt-page-foot">
        <!-- 两颗都带 busy：设立那一下在飞的时候，整条底栏都别能再点 -->
        <button class="rbtn" :disabled="busy || wz.step === 1" @click="step(-1)">上一步</button>
        <button class="rbtn-primary" :disabled="busy || !canNext" @click="next()">
          {{ wz.step === 6 ? '押注设立' : '继续' }}
        </button>
      </div>
    </div>
  </van-popup>

  <!-- 日期 / 时刻选择 -->
  <van-popup v-model:show="wz.pickerShow" position="bottom" round>
    <!-- 桌面：Vant 滚轮只认触摸事件，鼠标既拖不动也滚不动；用原生控件一步选完 -->
    <div v-if="isDesktopPlat" class="rt-sheet-inner">
      <h3 class="rt-sheet-head">选死线</h3>
      <div class="wz-native-pick">
        <input type="datetime-local" v-model="nativeDue" :min="nativeMin" :max="nativeMax" />
        <div class="wz-native-acts">
          <button class="rbtn" @click="wz.pickerShow = false">取消</button>
          <button class="rbtn-primary" @click="confirmNativeDue()">确定</button>
        </div>
      </div>
    </div>
    <template v-else>
      <van-date-picker v-if="wz.pickerMode === 'date'" v-model="wz.pickerDate" :min-date="minDate"
        :max-date="maxDate" title="选日期" @confirm="onDateConfirm" @cancel="wz.pickerShow = false" />
      <van-time-picker v-else v-model="wz.pickerTime" title="选时刻"
        @confirm="onTimeConfirm" @cancel="wz.pickerShow = false" />
    </template>
  </van-popup>
</template>
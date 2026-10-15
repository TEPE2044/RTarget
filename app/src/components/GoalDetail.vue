<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import {
  askFinish, askGiveUp, busy, canCheckInToday, checkIn, goals, isCheckGoal, saveExec,
} from '../lib/store'
import { TIER_LABEL } from '../lib/game'
import { fmtDayTime, fmtLeft } from '../lib/format'

const props = defineProps<{ show: boolean; goalId: string | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const goal = computed(() => goals.value.find((g) => g.id === props.goalId) ?? null)

/**
 * 执行区（备忘）。
 *
 * **没有自动保存** —— 原来那套"停手 0.8 秒就落库"去掉了。它有个很实的副作用：
 * 输入框下面那个「保存备忘」按钮会因为"已经存过了"而一直保持禁用（灰的、写「已保存」），
 * 于是**你想保存的那一刻，屏幕上唯一醒目、唯一能点的按钮只剩顶栏那颗黑「完成」**
 * —— 点下去就是把目标结束了。这不是人粗心，是没有可点的保存动作。
 * 现在写进去只有一个入口：输入框下面的「保存备忘」。存没存，看那个按钮就知道。
 */
const exec = ref('')

watch(
  () => [props.show, props.goalId] as const,
  ([show]) => {
    if (show && goal.value) exec.value = goal.value.exec
  },
  { immediate: true },
)

/** 备忘是否已经落库（保存成功后会把 goal.exec 对齐，所以两个值相等就是干净的） */
const execClean = computed(() => !goal.value || goal.value.exec === exec.value)

/**
 * 把备忘落库。**只写字、不退出**，返回"到底存上没有"。
 * 存失败时不能把 goal.exec 对齐 —— 否则界面会谎报「已保存」，人一走字就丢了。
 */
async function saveMemo(): Promise<boolean> {
  const g = goal.value
  if (!g || g.exec === exec.value) return true
  const ok = await saveExec(g.id, exec.value)
  if (ok) g.exec = exec.value // 本地对齐，别让下一次判定又觉得是脏的
  return ok
}

/** 「保存备忘」：存好就走（这是"写完了"的动作） */
async function onSaveClick() {
  if (!(await saveMemo())) return // 没存上就留在页面，别把人连同字一起带走
  showToast('备忘已保存')
  emit('update:show', false)
}

/**
 * 返回。
 *
 * 没有自动保存，所以有没存的东西时问一句 —— **这不是自动保存**：
 * 选「不保存」就一个字都不写。
 */
function close() {
  if (execClean.value) { emit('update:show', false); return }
  showConfirmDialog({
    title: '备忘还没保存',
    message: '直接返回会丢掉这次改动。',
    confirmButtonText: '保存',
    cancelButtonText: '不保存',
    lockScroll: false,
  }).then(() => void onSaveClick()).catch(() => emit('update:show', false))
}

/**
 * 完成 / 放弃：先把备忘存下来，再弹确认框 ——
 * 这条目标是"结束"，正在写的东西不该跟着一起丢。
 */
function onCompleteClick() {
  const g = goal.value
  if (!g) return
  void saveMemo()
  askFinish(g)
}

function onGiveUpClick() {
  const g = goal.value
  if (!g) return
  void saveMemo()
  askGiveUp(g)
}

/**
 * 这条已经结清了（做到 / 判负 / 放弃）。
 *
 * 结清的目标也能打开看 —— 首页「最近」里点"完成了「X」"就是要回看它。
 * 但这种时候没有动作可做，所以底部不给「完成」、顶栏不给「放弃」。
 */
const settled = computed(() => !!goal.value && goal.value.status !== 'active')

/**
 * 目标**在详情开着的时候**被结清了，就把浮层收掉 —— 别停在一条已经变死的目标上。
 *
 * 判据必须**同时比对 id 和 status**，两个坑都踩过：
 *
 * 1. 只看 status、不看是不是同一条目标时，会用错配的对：详情关闭后 goalId **不会重置**
 *    （App.vue 只翻 show），所以 goal 一直挂着上一条。于是
 *    「先看过一条进行中的目标 → 再点最近里已结清的那条」时，goal 直接从
 *    active 换成 failed，配上原来的 prev 判据就成立 → 详情刚打开就被自己关掉，
 *    留下的就是那下黑闪。这解释了为什么是"有时候"：取决于你之前看过什么。
 * 2. 连 prev 都不带时更糟：watch 不带 immediate 也会在"依赖从无到有"时触发一次，
 *    回看一条已结清的目标，详情刚渲染就被关掉。
 *
 * 所以现在要求 **cur.id === prev.id**（同一条目标）才收浮层；原来的意图保留：
 * 目标在详情开着时被结算掉，浮层仍然自动收起。
 */
watch(
  () => (goal.value ? { id: goal.value.id, status: goal.value.status } : null),
  (cur, prev) => {
    if (!cur || !prev) return
    if (cur.id === prev.id && prev.status === 'active' && cur.status !== 'active' && props.show) {
      emit('update:show', false)
    }
  },
)

/** 底部那行结论：已结清时替掉「完成」（那按钮对已结清的目标只会报"这条已经结清了"） */
const outcomeText = computed(() => {
  const g = goal.value
  if (!g || g.status === 'active') return ''
  return g.status === 'done' ? `已完成 · +${g.stake} 活力值` : `已判负 · −${g.stake} 活力值`
})
</script>

<template>
  <!-- overlay=false：全屏不透明浮层，背后那页根本看不见，遮罩纯属多余 ——
       而它会先以 rgba(0,0,0,.55) 铺满整屏再被滑入的面板盖住，看着就是"点一下黑一下"。
       （深色主题下更重，0.7。）
       lock-scroll=false：Vant 锁背景滚动会把 window 的滚动位置挪走、关掉不还回来 ——
       实测列表滚到 350，打开详情变 84，关闭后仍停在 84，等于"看完详情位置丢了" -->
  <van-popup :show="show" position="right" :style="{ width: '100%', height: '100%' }" :duration="0.25"
    :overlay="false" :lock-scroll="false" :close-on-click-overlay="false"
    @update:show="(v: boolean) => emit('update:show', v)">
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
          <!-- 已结清的回看态（首页「最近」点进来）没有动作可做，摆一个点了只会报
               「这条已经结清了」的按钮没意义 —— 换成结论 -->
          <span v-if="settled" class="rt-meta">{{ outcomeText }}</span>
          <!-- 顶栏只放"结束这条目标"的两个动作，**两个都不用实心黑** ——
               实心黑是"最该点"的信号，而这里没有一个动作是最该点的：
               写备忘时屏幕上的实心黑应该只属于「保存备忘」（见下面那行）。
               标签也带上宾语（完成目标 / 放弃目标），不给"以为是保存"留余地。 -->
          <div v-else class="btn-group">
            <button class="rbtn rbtn-danger" @click="onGiveUpClick()">放弃目标</button>
            <button v-if="!isCheckGoal(goal)" class="rbtn ml-2" @click="onCompleteClick()">完成目标</button>
          </div>
        </div>
      </div>

      <div class="rt-page-body">
        <h2 class="rt-detail-t">{{ goal.content }}</h2>
        <div class="rt-detail-m">
          <span>死线 {{ fmtDayTime(goal.due_at) }}</span>
          <span>· {{ fmtLeft(goal.due_at) }}</span>
          <span>· 押 {{ TIER_LABEL[goal.tier] }} {{ goal.stake }}</span>
        </div>

        <!-- 打卡型目标：进度 + 打卡。打满由库里自动结算，不需要再点完成 -->
        <div v-if="isCheckGoal(goal)" class="rt-card rt-checkcard rt-gap12">
          <div class="rt-checkrow">
            <span class="rt-batt">
              <i v-for="n in goal.check_total" :key="n" :class="{ on: n <= goal.check_done }"></i>
            </span>
            <span class="rt-meta">{{ goal.check_done }} / {{ goal.check_total }}</span>
            <!-- 已结清的打卡目标只留进度，不给打卡按钮（库里会拒，摆着只会让人猜） -->
            <button v-if="!settled" class="rbtn rbtn-soft rt-push"
              :disabled="busy || !canCheckInToday(goal)" @click="checkIn(goal)">
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
        <!-- 备忘的保存动作就在输入框下面，而且**有改动时它是实心黑**（干净的才灰掉）——
             这样"有没有东西没存"不用去别处找，一眼就看得出；
             顶栏那两个动作于是不会在你想保存的时候冒充保存按钮。 -->
        <div class="rt-exectools">
          <button :class="execClean ? 'rbtn' : 'rbtn-primary'" :disabled="busy || execClean"
            @click="onSaveClick()">保存备忘</button>
          <span class="rt-meta">{{ execClean ? '已保存' : '有改动没保存' }}</span>
        </div>
      </div>
    </div>
  </van-popup>
</template>
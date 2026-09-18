<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { isAuthError, useAuth } from '../lib/auth'
import type { GameNode } from '../lib/game'
import { completeNode, concedeNode, inCompound } from '../lib/game'

const { forceSignOut } = useAuth()

const props = defineProps<{
  nodes: GameNode[]
  busy?: boolean
  variant?: 'open' | 'closed'
}>()
const emit = defineEmits<{ refresh: [] }>()

const variant = computed(() => props.variant ?? 'open')

// 60 秒心跳：让"剩 N 天"和超时状态自己往前走
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 60_000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

interface Group {
  a: GameNode
  b: GameNode | null
  c: GameNode | null
}

const allGroups = computed<Group[]>(() =>
  props.nodes
    .filter((n) => n.kind === 'A')
    .map((a) => ({
      a,
      b: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'B') ?? null,
      c: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'C') ?? null,
    }))
)

const isOpenGroup = (g: Group) => g.a.status === 'active' || inCompound(g.a, g.c)

/**
 * 这一组当前真正起作用的死线。
 *
 * 进了复合体之后 A 的死线已经过去了（A 已经判负），此刻压着你的其实是 C 的死线 ——
 * 所以排序键要跟着切，不然复合体会一直沉在下面。
 */
function effectiveDue(g: Group): string {
  if (inCompound(g.a, g.c) && g.c) return g.c.due_at
  return g.a.due_at
}

const shown = computed(() => {
  const list = allGroups.value.filter((g) =>
    variant.value === 'open' ? isOpenGroup(g) : !isOpenGroup(g)
  )
  // 只给「进行中」排序：死线越近越靠前（已过期的自然排最前，那是最该看的）。
  // 已了结的那批保持原样（按创建时间），免得历史页的观感跟着变。
  // 死线相同时按创建时间兜底，保证顺序稳定、不会每次刷新跳来跳去。
  if (variant.value !== 'open') return list
  return [...list].sort((x, y) => {
    const diff = new Date(effectiveDue(x)).getTime() - new Date(effectiveDue(y)).getTime()
    if (diff !== 0) return diff
    return new Date(x.a.created_at).getTime() - new Date(y.a.created_at).getTime()
  })
})

const tierName: Record<string, string> = { low: '低', mid: '中', high: '高', allin: 'ALL IN' }

// ---------- 显示辅助 ----------

function isOverdue(n: GameNode): boolean {
  return n.status === 'active' && new Date(n.due_at) < now.value
}

/**
 * due_at 存的就是**判负时刻**（v1.4 起死线精确到分钟，到点即判负）。
 *
 * 例外：恰好落在 0 点的按「前一天全天」读 —— 存量数据全是这个形状
 * （旧版把「你要在哪天做完」翻译成了次日 0 点），这样显示跟以前一致。
 */
function dueText(dueAt: string): string {
  const d = new Date(dueAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (hm === '00:00') {
    const prev = new Date(dueAt)
    prev.setDate(prev.getDate() - 1)
    return `${prev.getMonth() + 1}/${prev.getDate()} 全天`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 剩余时间：还剩两天以上就只报天，进了最后两天才精确到小时/分钟 */
function leftText(dueAt: string): string {
  const ms = new Date(dueAt).getTime() - now.value.getTime()
  if (ms <= 0) return '已到期'
  const mins = Math.floor(ms / 60_000)
  if (mins >= 2880) return `剩 ${Math.ceil(mins / 1440)} 天`
  if (mins >= 60) return `剩 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分`
  return `剩 ${Math.max(1, mins)} 分钟`
}

/**
 * 只在死线进到两天内时附上"还剩多久"。
 * 平时每张卡都挂着倒计时反而让人麻木，到临界了再出现才有推动力。
 */
function soonLeft(dueAt: string): string {
  const ms = new Date(dueAt).getTime() - now.value.getTime()
  if (ms <= 0 || ms >= 2 * 86_400_000) return ''
  return leftText(dueAt)
}

interface Pill { text: string; cls: string }

/** 状态 pill：颜色只表达状态，不表达 A/B/C 类型 */
function pillOf(n: GameNode): Pill {
  if (n.status === 'bound') return { text: '未开启', cls: 'p-gray' }
  if (n.completed_at) {
    return n.status === 'settled'
      ? { text: '已完成', cls: 'p-green' }
      : { text: '待结算', cls: 'p-amber' }
  }
  if (n.status === 'active') {
    if (isOverdue(n)) return { text: '已超时（待结算）', cls: 'p-amber' }
    return n.kind === 'B' ? { text: '待确认', cls: 'p-green' } : { text: '进行中', cls: 'p-blue' }
  }
  return n.kind === 'A' ? { text: '已判负', cls: 'p-red' } : { text: '已结算', cls: 'p-gray' }
}

/** 色轨：复合体琥珀 / 已完成绿 / 进行中蓝 / 其余灰 */
function railCls(g: Group): string {
  if (inCompound(g.a, g.c) || g.a.compound_a_done !== null) return 'rt-rail-amber'
  if (g.a.completed_at) return 'rt-rail-green'
  if (g.a.status === 'active') return 'rt-rail-blue'
  return 'rt-rail-gray'
}

/**
 * 能不能点"完成"：
 * - 已申报过的一律不能（修掉"完成之后按钮还能点"）
 * - **过了死线的也不能** —— 到点即判负，再点就是在申报一个已经判负的目标
 */
function canComplete(n: GameNode | null): boolean {
  if (!n || n.completed_at) return false
  if (n.status === 'active') return !isOverdue(n)
  return n.kind === 'A' && n.status === 'settled' && n.compound_a_done === null
}

function canConcede(n: GameNode | null): boolean {
  if (!n) return false
  return n.status === 'active' && !n.completed_at
}

function compoundVerdict(a: GameNode): string {
  const x = a.compound_a_done
  const y = a.compound_c_done
  if (x && y) return 'A✓ C✓ · 两边都做完了，扣的分已全部返还'
  if (!x && !y) return 'A✗ C✗ · 两边都没做，已再扣一次'
  return `A${x ? '✓' : '✗'} C${y ? '✓' : '✗'} · 只做了一边，分数不变`
}

/** C 没开启时的说明：A 正常达成的话惩罚永远不会触发 */
function boundHint(g: Group): string {
  if (g.a.completed_at) return 'A 已达成，惩罚未触发'
  return `A 判负后开启 · 独立死线 ${g.c ? dueText(g.c.due_at) : '—'}`
}

/** B 没开启时的说明：A 已经判负的话，奖励永远不会到账 */
function bHint(g: Group): string {
  if (g.a.status === 'settled' && !g.a.completed_at) return 'A 已判负，奖励未触发'
  return 'A 达成即自动加分，无时限'
}

// ---------- 动作 ----------

/** 登录态失效就直接踢回登录页，不能只弹 toast 让人对着空界面发呆 */
async function handleError(e: unknown) {
  if (isAuthError(e)) {
    await forceSignOut()
    message.warning('登录状态已失效，请重新登录')
    return
  }
  message.error((e as Error).message)
}

async function onComplete(n: GameNode, tip: string) {
  try {
    await completeNode(n.id)
    message.success(tip)
    emit('refresh')
  } catch (e) {
    await handleError(e)
  }
}

async function onConcede(n: GameNode, tip: string) {
  try {
    await concedeNode(n.id)
    message.warning(tip)
    emit('refresh')
  } catch (e) {
    await handleError(e)
  }
}
</script>

<template>
  <div class="rt-cards">
    <article v-for="g in shown" :key="g.a.id" class="rt-card rt-cardwrap">
      <div class="rt-rail" :class="railCls(g)"></div>
      <div class="rt-node-body rt-pad">

        <!-- ============ 惩罚复合体：独立卡片，上下各一组按钮 ============ -->
        <template v-if="inCompound(g.a, g.c) && g.c">
          <header class="rt-cmp-head">
            <span class="rt-t14s" style="color: var(--rt-amber)">惩罚复合体</span>
            <span class="rt-meta rt-push" style="color: var(--rt-amber); white-space: nowrap">
              C 死线 {{ dueText(g.c.due_at) }} · {{ leftText(g.c.due_at) }}
            </span>
            <span class="rt-meta rt-cmp-note" style="color: var(--rt-amber)">
              原目标未完成，扣分已生效 —— 两边都做完，扣的分全部返还
            </span>
          </header>

          <div class="rt-cmp-cols">
            <div class="rt-cmp-col" :class="{ 'is-done': !!g.a.completed_at }">
              <div class="rt-line1">
                <span class="pill p-blue">原目标</span>
                <span class="rt-meta rt-push">{{ tierName[g.a.tier] }} · {{ g.a.stake }} 分（已扣）</span>
              </div>
              <p class="rt-t14" style="margin: 8px 0 0">{{ g.a.content }}</p>
              <p class="rt-meta" style="margin: 4px 0 0" :style="g.a.completed_at ? 'color: var(--rt-green)' : ''">
                {{ g.a.completed_at ? '已申报完成，等另一边一起结算' : '还没补做' }}
              </p>
              <div class="rt-actrow">
                <button v-if="canComplete(g.a)" class="rbtn-primary" :disabled="busy"
                  @click="onComplete(g.a, '已补做原目标 —— 两边都完成就全部返还')">补做完成</button>
                <button v-else class="rbtn" disabled>已补做</button>
                <a-popconfirm v-if="canConcede(g.a)" title="放弃补做？A 的扣分保持不变，也不会返还。"
                  ok-text="放弃" cancel-text="取消" @confirm="onConcede(g.a, '已放弃补做')">
                  <button class="rbtn rbtn-danger" :disabled="busy">放弃</button>
                </a-popconfirm>
              </div>
            </div>

            <div class="rt-cmp-col" :class="{ 'is-done': !!g.c.completed_at }">
              <div class="rt-line1">
                <span class="pill p-red">惩罚</span>
                <span class="rt-meta rt-push">{{ tierName[g.c.tier] }} · {{ g.c.stake }} 分（已扣）</span>
              </div>
              <p class="rt-t14" style="margin: 8px 0 0">{{ g.c.content }}</p>
              <p class="rt-meta" style="margin: 4px 0 0" :style="g.c.completed_at ? 'color: var(--rt-green)' : ''">
                {{ g.c.completed_at ? '已申报完成，等另一边一起结算' : '还没做' }}
              </p>
              <div class="rt-actrow">
                <button v-if="canComplete(g.c)" class="rbtn-primary" :disabled="busy"
                  @click="onComplete(g.c, '已把拖延的事做完 —— 两边都完成就全部返还')">完成</button>
                <button v-else class="rbtn" disabled>已完成</button>
                <a-popconfirm v-if="canConcede(g.c)" title="放弃惩罚？C 的死线一到就会再扣一次 A + C。"
                  ok-text="放弃" cancel-text="取消" @confirm="onConcede(g.c, '已放弃惩罚')">
                  <button class="rbtn rbtn-danger" :disabled="busy">放弃</button>
                </a-popconfirm>
              </div>
            </div>
          </div>

          <footer class="rt-cmp-foot">
            <span class="rt-meta">都完成 → <span style="color: var(--rt-green)">返还 {{ g.a.stake + g.c.stake }} 分</span></span>
            <span class="rt-meta">只做一个 → 分数不变</span>
            <span class="rt-meta">都没做 → <span style="color: var(--rt-red)">再扣 {{ g.a.stake + g.c.stake }} 分</span></span>
          </footer>
        </template>

        <!-- ============ 一般卡片：进行中 / 已完成 ============ -->
        <template v-else>
          <div class="rt-node">
            <span class="rt-node-lbl">目标</span>
            <div class="rt-node-body">
              <div class="rt-line1">
                <span class="rt-flex1" :class="variant === 'open' ? 'rt-t14s' : 'rt-t14'">{{ g.a.content }}</span>
                <span class="pill" :class="pillOf(g.a).cls">{{ pillOf(g.a).text }}</span>
              </div>
              <div v-if="g.a.compound_a_done !== null" class="rt-line2">
                <span class="rt-meta" style="color: var(--rt-amber)">复合体结算：{{ compoundVerdict(g.a) }}</span>
              </div>
              <div class="rt-line2">
                <span class="rt-meta">{{ tierName[g.a.tier] }} · {{ g.a.stake }} 分</span>
                <span class="rt-meta">
                  死线 {{ dueText(g.a.due_at) }}{{ soonLeft(g.a.due_at) ? ' · ' + soonLeft(g.a.due_at) : '' }}
                </span>
                <span v-if="isOverdue(g.a) || canComplete(g.a) || canConcede(g.a)" class="rt-btns">
                  <button v-if="isOverdue(g.a)" class="rbtn" disabled>已过死线</button>
                  <template v-else>
                    <button v-if="canComplete(g.a)" class="rbtn-primary" :disabled="busy"
                      @click="onComplete(g.a, '目标达成，奖励 B 已到账')">完成</button>
                    <a-popconfirm v-if="canConcede(g.a)" title="放弃目标？立刻判负并进入惩罚复合体。"
                      ok-text="放弃" cancel-text="取消" @confirm="onConcede(g.a, '已放弃，进入惩罚复合体')">
                      <button class="rbtn rbtn-danger" :disabled="busy">放弃</button>
                    </a-popconfirm>
                  </template>
                </span>
              </div>
            </div>
          </div>

          <hr class="rt-sep" />

          <div v-if="g.b" class="rt-node">
            <span class="rt-node-lbl">奖励</span>
            <div class="rt-node-body">
              <div class="rt-line1">
                <span class="rt-flex1 rt-t14" :style="g.b.status === 'bound' ? 'color: var(--rt-tx2)' : ''">{{ g.b.content }}</span>
                <span class="pill" :class="pillOf(g.b).cls">{{ pillOf(g.b).text }}</span>
              </div>
              <div class="rt-line2">
                <span v-if="g.b.status === 'bound'" class="rt-meta">{{ bHint(g) }}</span>
                <template v-else-if="!g.b.completed_at">
                  <span class="rt-meta" style="color: var(--rt-green)">+{{ g.b.stake }} 分已到账，享受完点确认</span>
                  <span class="rt-btns">
                    <button class="rbtn-primary" :disabled="busy" @click="onComplete(g.b, '奖励已确认')">确认</button>
                  </span>
                </template>
                <span v-else class="rt-meta">已奖励 {{ g.b.stake }} 分，已确认</span>
              </div>
            </div>
          </div>

          <template v-if="g.c">
            <hr class="rt-sep" />
            <div class="rt-node">
              <span class="rt-node-lbl">惩罚</span>
              <div class="rt-node-body">
                <div class="rt-line1">
                  <span class="rt-flex1 rt-t14" :style="g.c.status === 'bound' ? 'color: var(--rt-tx2)' : ''">{{ g.c.content }}</span>
                  <span class="pill" :class="pillOf(g.c).cls">{{ pillOf(g.c).text }}</span>
                </div>
                <div class="rt-line2">
                  <span v-if="g.c.status === 'bound'" class="rt-meta">{{ boundHint(g) }}</span>
                  <template v-else-if="g.c.status === 'active' && !g.c.completed_at">
                    <span class="rt-meta">{{ tierName[g.c.tier] }} · {{ g.c.stake }} 分</span>
                    <span class="rt-meta">死线 {{ dueText(g.c.due_at) }} · {{ leftText(g.c.due_at) }}</span>
                    <span class="rt-btns">
                      <button v-if="isOverdue(g.c)" class="rbtn" disabled>已过窗口</button>
                      <template v-else>
                        <button v-if="canComplete(g.c)" class="rbtn-primary" :disabled="busy"
                          @click="onComplete(g.c, '已把拖延的事做完')">完成</button>
                        <a-popconfirm v-if="canConcede(g.c)" title="放弃惩罚？复合体会按最终结果结算。"
                          ok-text="放弃" cancel-text="取消" @confirm="onConcede(g.c, '已放弃惩罚')">
                          <button class="rbtn rbtn-danger" :disabled="busy">放弃</button>
                        </a-popconfirm>
                      </template>
                    </span>
                  </template>
                  <span v-else class="rt-meta">{{ g.c.completed_at ? '已完成' : '未完成' }}</span>
                </div>
              </div>
            </div>
          </template>
        </template>

      </div>
    </article>

    <div v-if="shown.length === 0" class="rt-card rt-center-tx" style="padding: 28px">
      <span class="rt-meta">
        {{ variant === 'open' ? '没有未完成的事。' : '这个档还没有已完成的目标。' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.rt-cards { display: flex; flex-direction: column; gap: 12px; }

/* ---------- 复合体 ---------- */

.rt-cmp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  margin: -14px -16px 14px;
  padding: 11px 16px;
  background: var(--rt-amber-bg);
}
.rt-cmp-note { flex-basis: 100%; }

/* 手机竖屏两栏太窄，改成上下堆叠 */
.rt-cmp-cols { display: flex; flex-direction: column; gap: 10px; }

.rt-cmp-col {
  padding: 12px 14px;
  border: 0.5px solid var(--rt-line);
  border-radius: 10px;
}
.rt-cmp-col.is-done { background: var(--rt-sub); }

.rt-cmp-foot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  margin: 14px -16px -14px;
  padding: 10px 16px;
  border-top: 0.5px solid var(--rt-line);
}
</style>

import { computed, ref } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast, showToast } from 'vant'
import {
  checkInGoal as apiCheckInGoal, completeGoal as apiCompleteGoal, createArchive,
  createGoal as apiCreateGoal, createTodo,
  createWish, deleteArchive, deleteTodo, deleteWish, getRecentRecords, giveUpGoal as apiGiveUpGoal,
  getArchives, getGoals, getRecords, getTodos, getVitality, getWishes, reopenTodo, reopenWish,
  sealArchive as apiSealArchive, setTodoDone, setTodoTimesLeft, setWishDone, settleAll, stakeOf,
  updateGoalExec, updateTodo, updateWish,
} from './game'
import type { Archive, Goal, RecordItem, Tier, Todo, Wish } from './game'
import { friendlyError, isAuthError, isClockSkewError, isNetworkError } from './auth'
import { recordText } from './records'
import { bjToday } from './format'

/**
 * 全局状态 + 动作（单例组合式）。
 *
 * 为什么集中在一处：五个页面共用同一份数据（活力值 / 存档 / 目标 / 待办 / 愿望 / 动态），
 * 散在各组件里再靠 props / emit 串起来，会多出一大堆纯搬运的代码。
 * 这里只放"状态 + 拉数据 + 业务动作"，页面组件保持薄。
 */

// ---------- 状态 ----------

export const vitality = ref(10)
export const archives = ref<Archive[]>([])
export const goals = ref<Goal[]>([])
export const todos = ref<Todo[]>([])
export const wishes = ref<Wish[]>([])
export const feed = ref<RecordItem[]>([])
export const records = ref<RecordItem[]>([])
export const loadingRecords = ref(false)

export const booted = ref(false)
export const busy = ref(false)

/** 这次加载没成功的原因（空串 = 一切正常）——首页留一条可点重试的横幅 */
export const loadFail = ref('')

export const activeArchiveId = ref<string | null>(null)
export const historyArchiveId = ref<string | null>(null)

// ---------- 派生 ----------

/**
 * 进行中的档，**按"最近活跃"排**：最近动过的排最前。
 *
 * 为什么不用 archives 自己的 created_at：那会让刚建的**空档**顶到最前，
 * 而真正在做事的档（往往建得最早）反而沉下去 —— 空档"没东西"却占着头位，很别扭。
 *
 * 为什么**不给 archives 加 updated_at**（更直觉的想法）：那列得靠人维护 ——
 * check_in_goal / complete_goal / giveup_goal / settle_goals 全在 SQL 函数里，
 * 每条写入路径都要记得 bump，漏一处就悄悄排错，而且"什么算活跃"这条规则
 * 会散在客户端和四个函数里。而这些事实**本来就在 goals 上**
 * （created_at / settled_at / last_check_on），getGoals() 又把全部目标都拉到了本地
 * —— 派生出来零迁移、零写入改动、不可能漂移。
 *
 * 口径：某档的"活动时间" = 它名下所有目标里最新的
 * max(settled_at, last_check_on, created_at)；**一个目标都没有的档记 0**，自然沉底。
 * 同分时保持 archives 的原顺序（建档时间倒序）—— sort 是稳定的。
 *
 * 已知不覆盖：改备忘（exec）不写时间戳，所以"光写备忘"不算活跃。
 * 真要算进去，就得回到"给目标加时间戳列"那条路。
 */
export const openArchives = computed(() => {
  const activity = new Map<string, number>()
  for (const g of goals.value) {
    const t = Math.max(
      Date.parse(g.settled_at ?? '') || 0,
      Date.parse(g.last_check_on ?? '') || 0,
      Date.parse(g.created_at) || 0,
    )
    if (t > (activity.get(g.archive_id) ?? 0)) activity.set(g.archive_id, t)
  }
  return archives.value
    .filter((a) => a.status === 'open')
    .sort((a, b) => (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0))
})

/** 封档记录：**最新的排最前**（按封档时间，不是建档时间） */
export const sealedArchives = computed(() =>
  archives.value
    .filter((a) => a.status === 'sealed')
    .sort((a, b) => new Date(b.sealed_at ?? 0).getTime() - new Date(a.sealed_at ?? 0).getTime())
)
export const activeArchive = computed(
  () => archives.value.find((a) => a.id === activeArchiveId.value) ?? null
)

export const openTodos = computed(() => todos.value.filter((t) => t.status === 'open'))
export const doneTodos = computed(() => todos.value.filter((t) => t.status === 'done'))
export const openWishes = computed(() => wishes.value.filter((w) => w.status === 'open'))
export const doneWishes = computed(() => wishes.value.filter((w) => w.status === 'done'))

/** 当前存档里还在跑的目标，最紧的排在前面 */
export const activeGoals = computed(() =>
  goals.value
    .filter((g) => g.archive_id === activeArchiveId.value && g.status === 'active')
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
)

/** 已经被「进行中的目标」挂为奖励的愿望 id（挑奖励时要排除） */
export const occupiedWishIds = computed(
  () => new Set(goals.value.filter((g) => g.status === 'active' && g.reward_wish_id)
    .map((g) => g.reward_wish_id as string))
)
export const pickableWishes = computed(
  () => openWishes.value.filter((w) => !occupiedWishIds.value.has(w.id))
)

export function archiveHasPending(id: string): boolean {
  return goals.value.some((g) => g.archive_id === id && g.status === 'active')
}

/**
 * 一条动态要显示的那句话。
 *
 * 句子由模板现拼（lib/records.ts），这里只负责补上模板拿不到的东西：
 * 封档动态要用存档名，而记录里只有 archive_id —— 从本地的 archives 里查一下。
 */
export function recordLabel(r: RecordItem): string {
  const a = archives.value.find((x) => x.id === r.archive_id)
  return recordText(r, a?.name ?? '（已删除的存档）')
}

/**
 * 是不是打卡型目标。
 *
 * **必须用 typeof 判，不能写 `check_total !== null`** —— 0022 迁移还没在库上跑时，
 * 这一列取回来是 `undefined`，而 `undefined !== null` 是 true，
 * 结果所有普通目标都会被当成打卡型，卡片上冒出一排空格子。
 */
export function isCheckGoal(g: Goal): boolean {
  return typeof g.check_total === 'number'
}

/**
 * 打卡型目标今天还能不能打。
 *
 * 只管界面置灰，**真判定在库里的 check_in_goal** —— 两处都判会迟早不一致，
 * 但完全不判又会让用户对着一个按不动的按钮猜原因，所以这边只做"看起来对不对"。
 */
export function canCheckInToday(g: Goal): boolean {
  if (!isCheckGoal(g) || g.status !== 'active') return false
  if ((g.check_done ?? 0) >= (g.check_total ?? 0)) return false
  return g.last_check_on !== bjToday()
}

// ---------- 错误上报 ----------

/**
 * 三类错误必须分开，否则就会出现"莫名其妙"的体验（见 MEMORY）：
 * - 网络不通：请求没出去，会话是好的 → 只提示、可重试，**不登出**
 * - Supabase 时钟漂移：平台侧的，重新登录也没用 → 等一会儿自动好，**不登出**
 * - 真的登录失效：踢回登录页
 */
let forceSignOut: (() => Promise<void>) | null = null
/** App.vue 挂载时把登出函数交进来（store 不直接碰 auth 单例，方便单测） */
export function bindSignOut(fn: () => Promise<void>) { forceSignOut = fn }

export async function reportError(e: unknown, prefix = ''): Promise<void> {
  if (isNetworkError(e)) {
    loadFail.value = '连不上服务器，点这里重试'
    showToast('连不上服务器，数据没事')
    return
  }
  if (isClockSkewError(e)) {
    loadFail.value = '服务器时钟对不上，等一两分钟点这里重试'
    showToast('服务器时钟没对上，等一会儿就好')
    return
  }
  if (isAuthError(e)) {
    loadFail.value = ''
    await forceSignOut?.()
    showToast('登录状态已失效，请重新登录')
    return
  }
  loadFail.value = ''
  showFailToast(prefix + friendlyError(e))
}

// ---------- 拉数据 ----------

let refreshing = false

/** 拉全量数据。silent = 后台自跑（惰性结算），不动 busy，免得把正在输入的框灰掉 */
export async function refresh(opts: { silent?: boolean } = {}): Promise<void> {
  const silent = opts.silent === true
  if (silent) {
    if (refreshing || busy.value) return
    refreshing = true
  } else {
    busy.value = true
  }
  try {
    try {
      await loadAll()
    } catch (e) {
      // 网络抖动最常见：隔一秒自动重来一次，只对网络错误重试
      if (!isNetworkError(e)) throw e
      await new Promise((r) => setTimeout(r, 1200))
      await loadAll()
    }
    loadFail.value = ''
  } catch (e) {
    await reportError(e, '加载失败：')
  } finally {
    if (silent) refreshing = false
    else busy.value = false
  }
}

async function loadAll() {
  await settleAll() // 惰性结算：把到点的账先结掉
  const [v, as, gs, ts, ws, fd] = await Promise.all([
    getVitality(), getArchives(), getGoals(), getTodos(), getWishes(), getRecentRecords(20),
  ])
  vitality.value = v
  archives.value = as
  goals.value = gs
  todos.value = ts
  wishes.value = ws
  feed.value = fd

  // 初始选中**页签里排在最前的那个档**（= 最近活跃的），不是 getArchives() 顺序里的第一个。
  // as 是按**建档时间**倒序的，取 as.find(open) 会选中刚建的空档 ——
  // 而它在新排序里已经被排到最后，于是"选中的那个不在第一位"，看着很别扭。
  // 只在**当前选中无效**时才改，不跟用户的显式选择打架。
  if (!activeArchiveId.value || !as.some((a) => a.id === activeArchiveId.value && a.status === 'open')) {
    activeArchiveId.value = openArchives.value[0]?.id ?? null
  }
  if (!historyArchiveId.value || !as.some((a) => a.id === historyArchiveId.value && a.status === 'sealed')) {
    historyArchiveId.value = sealedArchives.value[0]?.id ?? null
  } else {
    await loadRecords()
  }
  booted.value = true
}

/** 历史页：拉某个存档的记录（新的在前） */
export async function loadRecords() {
  const id = historyArchiveId.value
  if (!id) { records.value = []; return }
  loadingRecords.value = true
  try {
    records.value = await getRecords(id)
  } finally {
    loadingRecords.value = false
  }
}

export function selectHistory(id: string) {
  historyArchiveId.value = id
  void loadRecords()
}

/** 清空（登出时） */
export function resetAll() {
  vitality.value = 10
  archives.value = []
  goals.value = []
  todos.value = []
  wishes.value = []
  feed.value = []
  records.value = []
  activeArchiveId.value = null
  historyArchiveId.value = null
  booted.value = false
  loadFail.value = ''
}

// ---------- 存档 ----------

export async function newArchive(name: string) {
  const n = name.trim()
  if (!n) return
  await doCreateArchive(n)
}

async function doCreateArchive(name: string) {
  busy.value = true
  try {
    const a = await createArchive(name)
    // 先把新档塞进列表再选中，避免页签拿不到名字而闪出 uuid
    archives.value = [a, ...archives.value]
    activeArchiveId.value = a.id
    showToast(`已开新档「${a.name}」`)
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

export async function sealArchive(id: string) {
  busy.value = true
  try {
    const penalty = await apiSealArchive(id)
    showToast(penalty < 0 ? `已封档，扣 ${Math.abs(penalty)} 活力值` : '已封档，免费')
    activeArchiveId.value = null
    historyArchiveId.value = id
    await refresh()
    await loadRecords()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

export async function removeArchive(a: Archive) {
  busy.value = true
  try {
    await deleteArchive(a.id)
    if (historyArchiveId.value === a.id) historyArchiveId.value = null
    showToast(`已删除存档「${a.name}」`)
    await refresh()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

/**
 * 删存档要确认，而且得说清"分数不变"。
 * 删掉的只是存档和档内节点，活力值流水保留（只断开归属）——
 * 不然「封档扣 10% → 删档」就成了刷分漏洞。
 */
export function askDeleteArchive(a: Archive) {
  showConfirmDialog({
    title: `删除存档「${a.name}」？`,
    message: '存档和里面的目标都会删掉。活力值流水保留，所以分数不变。',
    confirmButtonText: '删除',
    confirmButtonColor: '#C0392B',
  }).then(() => void removeArchive(a)).catch(() => {})
}

// ---------- 目标 ----------

export async function addGoal(input: {
  content: string
  tier: Tier
  dueAt: string
  reward: string
  rewardWishId?: string | null
  penalty: string
  exec?: string
  todoId?: string | null
  /** 打卡型目标的总格数；不传 = 普通的一次性目标 */
  checkTotal?: number | null
}) {
  if (!activeArchiveId.value) throw new Error('先开一个档')
  const goal = await apiCreateGoal({
    archiveId: activeArchiveId.value,
    vitality: vitality.value,
    ...input,
  })
  showToast(`已押注设立「${goal.content}」`)
}

export async function finishGoal(goal: Goal) {
  busy.value = true
  try {
    const gained = await apiCompleteGoal(goal.id)
    if (gained === 0) {
      showToast('这条已经结清了')
    } else {
      showSuccessToast(`+${gained} 活力值${goal.reward ? ' · 奖励兑现：' + goal.reward : ''}`)
    }
    await refresh()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

/**
 * 打一次卡。
 *
 * 判定（一天一次 / 上限 / 过死线）全在库里的 check_in_goal，这边只报结果：
 * 它返回 completed = true 说明这是最后一格、库里已经当场结算过了，所以拉一次全量。
 */
export async function checkIn(goal: Goal) {
  busy.value = true
  try {
    const r = await apiCheckInGoal(goal.id)
    // 先就地更新，让格子立刻动起来；后面 refresh 会拿库里的真值覆盖
    goal.check_done = r.done
    goal.last_check_on = bjToday()
    showToast(`已打卡 ${r.done} / ${r.total}`)
    if (r.completed) {
      showSuccessToast(`打满了 · +${goal.stake} 活力值`)
      await refresh()
    }
  } catch (e) {
    // 「今天已经打过卡了」这类是正常的业务拒绝，不是网络/权限问题，用黄条提示
    const msg = friendlyError(e)
    if (/已经打|打满|结清|不是打卡/.test(msg)) showToast(msg)
    else await reportError(e)
  } finally {
    busy.value = false
  }
}

export async function giveUpGoal(goal: Goal) {
  busy.value = true
  try {
    const r = await apiGiveUpGoal(goal.id)
    showToast(`已 −${r.lost} 活力值${r.returned ? ' · 已退回待办' : ''}`)
    await refresh()
  } catch (e) {
    await reportError(e)
  } finally {
    busy.value = false
  }
}

/**
 * 执行区（备忘）落库。返回**是否真的写成功**。
 *
 * 详情那边靠这个决定要不要把界面标成"已保存" —— 失败时若照样标成已保存，
 * 人会以为存好了然后离开，字就丢了（自动保存已经去掉，这个状态更得是真话）。
 */
export async function saveExec(id: string, exec: string): Promise<boolean> {
  try {
    await updateGoalExec(id, exec)
    return true
  } catch (e) {
    await reportError(e)
    return false
  }
}

/**
 * 放弃 / 完成这类"一旦结算就没法回头"的确认框，统一 **lockScroll: false**。
 *
 * 它们在目标详情里弹出，而详情是全屏浮层、html 已经被 .rt-noscroll 锁住了；
 * 弹窗再按默认去锁一次 body，就会把 window 的滚动位置挪走还不还回来 ——
 * 就是"看完详情位置丢了"那个老 bug（实测位置被挪到 84）。
 */
export function askGiveUp(goal: Goal) {
  showConfirmDialog({
    title: '放弃这个目标？',
    message: `扣 ${goal.stake} 活力值`
      + (goal.todo_id ? '，退回待办' : '') + '。',
    confirmButtonText: '放弃目标',
    confirmButtonColor: '#C0392B',
    lockScroll: false,
  }).then(() => void giveUpGoal(goal)).catch(() => {})
}

/**
 * 做到：加一道确认再结算。
 *
 * 顶栏那颗按钮容易被当成"保存备忘"（它原来还是实心黑、最醒目）——
 * 除了把标签写成「完成目标」、把实心黑让给「保存备忘」之外，这里再兜一道确认：
 * 一旦结算就没法回头。
 */
export function askFinish(goal: Goal) {
  showConfirmDialog({
    title: '完成这个目标？',
    message: `加 ${goal.stake} 活力值`
      + (goal.reward ? `，兑现奖励：${goal.reward}` : '') + '。',
    confirmButtonText: '完成目标',
    lockScroll: false,
  }).then(() => void finishGoal(goal)).catch(() => {})
}

export function askSeal() {
  const a = activeArchive.value
  if (!a) return
  const pending = archiveHasPending(a.id)
  showConfirmDialog({
    title: `封档「${a.name}」？`,
    message: pending
      ? `还有事没做完：扣 ${Math.max(0, Math.round(vitality.value * 0.1))} 活力值，`
        + '没做完的目标一起关掉。'
      : '都做完了，免费封档。',
    confirmButtonText: '封档',
  }).then(() => void sealArchive(a.id)).catch(() => {})
}

// ---------- 待办 ----------

export async function saveTodo(input: {
  id?: string | null
  title: string
  text: string
  /** 打算做几次。只在新建时生效 —— 跟 0.0.1 一样，建完不再改 */
  times?: number
}) {
  const title = input.title.trim()
  if (!title) throw new Error('先写个标题')
  if (input.id) {
    await updateTodo(input.id, title, input.text)
    const hit = todos.value.find((t) => t.id === input.id)
    if (hit) { hit.content = title; hit.note = input.text.trim() }
  } else {
    const t = await createTodo(title, input.text, input.times ?? 1)
    todos.value.unshift(t)
  }
}

export async function toggleTodo(t: Todo) {
  try {
    if (t.status === 'done') { await reopenTodo(t.id); t.status = 'open'; t.done_at = null }
    else { await setTodoDone(t.id); t.status = 'done' }
  } catch (e) {
    await reportError(e)
  }
}

export async function removeTodo(id: string) {
  try {
    await deleteTodo(id)
    todos.value = todos.value.filter((t) => t.id !== id)
    showToast('已删掉')
  } catch (e) {
    await reportError(e)
  }
}

/**
 * 主动把次数减一格（次数待办行上的「−」）。
 *
 * 跟"目标完成时自动扣格"是两条路，但落点一样：都是 times_left−1，
 * 减到 0 就整条用完、归入已完成。所以走同一个终态。
 */
export async function decTodoTimes(t: Todo) {
  if (t.times_left <= 0) return
  const left = t.times_left - 1
  try {
    await setTodoTimesLeft(t.id, left)
    t.times_left = left
    if (left === 0) {
      await setTodoDone(t.id)
      t.status = 'done'
      t.done_at = new Date().toISOString()
      showToast(`「${t.content}」用完了`)
    } else {
      showToast(`还剩 ${left} 次`)
    }
  } catch (e) {
    await reportError(e)
  }
}

/** 删待办要确认 —— 这条不可撤销，且文件里可能写了东西 */
export function askDeleteTodo(t: Todo) {
  showConfirmDialog({
    title: '删掉这条待办？',
    message: t.note ? '连里面的内容一起删掉。' : '',
    confirmButtonText: '删除',
    confirmButtonColor: '#C0392B',
  }).then(() => void removeTodo(t.id)).catch(() => {})
}

// ---------- 愿望 ----------

export async function addWish(content: string) {
  const w = await createWish(content)
  wishes.value.unshift(w)
  return w
}

export async function toggleWish(w: Wish) {
  try {
    if (w.status === 'done') {
      await reopenWish(w.id)
      w.status = 'open'
      w.done_at = null
      showToast('已放回愿望单')
    } else {
      // 已挂给进行中目标的愿望不能提前兑现：否则那个目标达成时无处可兑
      // （setWishDone 带 status='open' 条件，会**静默地影响 0 行**）。见 docs/feedback.md 2026-09-28。
      const hooked = goals.value.find((g) => g.status === 'active' && g.reward_wish_id === w.id)
      if (hooked) {
        showToast(`这个愿望已经挂给「${hooked.content}」了，等它出结果`)
        return
      }
      await setWishDone(w.id, activeArchiveId.value)
      w.status = 'done'
      w.done_at = new Date().toISOString()
      showToast('已兑现')
    }
  } catch (e) {
    await reportError(e)
  }
}

/** 改愿望的文案。已经挂给目标的愿望也能改 —— 目标存的是文案快照，不受影响 */
export async function saveWish(id: string, content: string) {
  const c = content.trim()
  if (!c) return
  try {
    await updateWish(id, c)
    const hit = wishes.value.find((w) => w.id === id)
    if (hit) hit.content = c
  } catch (e) {
    await reportError(e)
  }
}

export async function removeWish(id: string) {
  try {
    await deleteWish(id)
    wishes.value = wishes.value.filter((w) => w.id !== id)
    showToast('已从愿望单删掉')
  } catch (e) {
    await reportError(e)
  }
}

/** 被进行中目标挂走的愿望不许删 —— 删了那个目标达成时就无处可兑 */
export function askDeleteWish(w: Wish) {
  const hooked = goals.value.find((g) => g.status === 'active' && g.reward_wish_id === w.id)
  if (hooked) {
    showToast(`这个愿望已经挂给「${hooked.content}」了，等它出结果`)
    return
  }
  showConfirmDialog({
    title: '从愿望单删掉？',
    message: '已经立过的目标不受影响。',
    confirmButtonText: '删除',
    confirmButtonColor: '#C0392B',
  }).then(() => void removeWish(w.id)).catch(() => {})
}

// ---------- 小工具 ----------

/** 某个目标现在的分值（ALL IN 会随活力值变，只用于向导里的实时预览） */
export function previewStake(tier: Tier): number {
  return stakeOf(tier, vitality.value)
}
import { computed, ref } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast, showToast } from 'vant'
import {
  completeGoal as apiCompleteGoal, createArchive, createGoal as apiCreateGoal, createTodo,
  createWish, deleteArchive, deleteTodo, getRecentRecords, giveUpGoal as apiGiveUpGoal,
  getArchives, getGoals, getRecords, getTodos, getVitality, getWishes, reopenTodo, reopenWish,
  sealArchive as apiSealArchive, setTodoDone, setWishDone, settleAll, stakeOf, updateGoalExec,
  updateTodo,
} from './game'
import type { Archive, Goal, RecordItem, Tier, Todo, Wish } from './game'
import { friendlyError, isAuthError, isClockSkewError, isNetworkError } from './auth'

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

export const openArchives = computed(() => archives.value.filter((a) => a.status === 'open'))
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
    loadFail.value = '连不上服务器。检查下网络，然后点这里重试'
    showToast('连不上服务器 —— 是网络的问题，你的数据没事')
    return
  }
  if (isClockSkewError(e)) {
    loadFail.value = 'Supabase 的服务器时钟飘了（平台侧的问题），等一两分钟点这里重试'
    showToast('服务器时钟没对上，等一两分钟就好')
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

  if (!activeArchiveId.value || !as.some((a) => a.id === activeArchiveId.value && a.status === 'open')) {
    activeArchiveId.value = as.find((a) => a.status === 'open')?.id ?? null
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
  if (!historyArchiveId.value) { records.value = []; return }
  loadingRecords.value = true
  try {
    records.value = await getRecords(historyArchiveId.value)
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

export async function newArchive() {
  if (!openArchives.value.length) {
    // 一条都没有时给个默认名，之后可以改
    return void doCreateArchive('现在')
  }
  await doCreateArchive(`新档 ${openArchives.value.length + 1}`)
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
    showToast(penalty < 0 ? `已封档 · 扣 ${Math.abs(penalty)} 活力值` : '已封档 —— 全部完成，免费')
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

/** 执行区随写随存（失败只提示，不打断） */
export async function saveExec(id: string, exec: string) {
  try {
    await updateGoalExec(id, exec)
  } catch (e) {
    await reportError(e)
  }
}

export function askGiveUp(goal: Goal) {
  showConfirmDialog({
    title: '放弃这个目标？',
    message: `放弃 = 做不到：扣 ${goal.stake} 活力值`
      + (goal.todo_id ? '，并退回待办（次数不动）' : '') + '。',
    confirmButtonText: '放弃',
    confirmButtonColor: '#C0392B',
  }).then(() => void giveUpGoal(goal)).catch(() => {})
}

export function askSeal() {
  const a = activeArchive.value
  if (!a) return
  const pending = archiveHasPending(a.id)
  showConfirmDialog({
    title: `封档「${a.name}」？`,
    message: pending
      ? `这个存档还有没做完的事 —— 封档会扣当前活力值的 10%（约 ${Math.max(0, Math.round(vitality.value * 0.1))} 分），`
        + '档内没做完的目标会一并关闭。'
      : '全部走向奖励分支 —— 免费封档。',
    confirmButtonText: '封档',
  }).then(() => void sealArchive(a.id)).catch(() => {})
}

// ---------- 待办 ----------

export async function saveTodo(input: { id?: string | null; title: string; text: string }) {
  const title = input.title.trim()
  if (!title) throw new Error('先写个标题')
  if (input.id) {
    await updateTodo(input.id, title, input.text)
    const hit = todos.value.find((t) => t.id === input.id)
    if (hit) { hit.content = title; hit.note = input.text.trim() }
  } else {
    const t = await createTodo(title, input.text)
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
  } catch (e) {
    await reportError(e)
  }
}

// ---------- 愿望 ----------

export async function addWish(content: string) {
  const w = await createWish(content)
  wishes.value.unshift(w)
  return w
}

export async function toggleWish(w: Wish) {
  try {
    if (w.status === 'done') { await reopenWish(w.id); w.status = 'open'; w.done_at = null }
    else { await setWishDone(w.id, activeArchiveId.value); w.status = 'done'; w.done_at = new Date().toISOString() }
  } catch (e) {
    await reportError(e)
  }
}

// ---------- 小工具 ----------

/** 某个目标现在的分值（ALL IN 会随活力值变，只用于向导里的实时预览） */
export function previewStake(tier: Tier): number {
  return stakeOf(tier, vitality.value)
}
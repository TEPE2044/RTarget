import { supabase } from './supabase'

// ---------- 类型（与 supabase/migrations/0020_goals_v2.sql 对应） ----------

export type Tier = 'low' | 'mid' | 'high' | 'allin'
export type GoalStatus = 'active' | 'done' | 'failed'
export type RecordType = 'created' | 'done' | 'failed' | 'sealed'

export interface Archive {
  id: string
  name: string
  status: 'open' | 'sealed'
  created_at: string
  sealed_at: string | null
  sealed_free: boolean | null
}

/** 一个目标 = 一个奖励 + 一个惩罚，一锤子结清 */
export interface Goal {
  id: string
  user_id: string
  archive_id: string
  content: string
  tier: Tier
  /** 押注分值快照（ALL IN = 设立时的活力值 × 80%） */
  stake: number
  due_at: string
  reward: string
  /** 奖励来自愿望单时有值；手输的为 null */
  reward_wish_id: string | null
  penalty: string
  /** 执行区正文（Markdown，随时可改） */
  exec: string
  /** 目标来自待办时有值；自己写的为 null */
  todo_id: string | null
  /**
   * 打卡型目标：总共要打几次。**null = 普通的一次性目标**（现有目标全是 null）。
   * 打满即自动结算；到死线没打满照旧判负。
   */
  check_total: number | null
  /** 已打卡次数 */
  check_done: number
  /** 最后一次打卡的北京日期（'YYYY-MM-DD'）；一天只能打一次 */
  last_check_on: string | null
  status: GoalStatus
  settled_at: string | null
  created_at: string
}

export type TodoStatus = 'open' | 'taken' | 'done'

export interface Todo {
  id: string
  user_id: string
  /** 标题 */
  content: string
  /** open 待办 / taken 已立项（移出清单）/ done 勾掉或用完 */
  status: TodoStatus
  /** 总格数。默认 1 = 一次性的；> 1 就是"打算重复做的事" */
  times_total: number
  /** 还剩几格。来源目标完成一次扣一格，扣到 0 就变成 done */
  times_left: number
  /** 内容（Markdown，默认空） */
  note: string
  done_at: string | null
  taken_at: string | null
  created_at: string
}

export type WishStatus = 'open' | 'done'

export interface Wish {
  id: string
  user_id: string
  content: string
  status: WishStatus
  done_at: string | null
  done_archive_id: string | null
  created_at: string
}

export interface LedgerEntry {
  id: number
  goal_id: string | null
  archive_id: string | null
  reason: string | null
  note: string | null
  amount: number
  created_at: string
}

/**
 * 动态 / 历史记录（首页「最近」与历史页共用）。
 *
 * **库里只存数据，句子由前端按模板渲染**（见 lib/records.ts）——
 * 以前这里有一列 text 存着拼好的整句话，2026-10-13 已经 drop 掉了：
 * 那样改文案改不动历史数据、还要重写 SQL 函数 + 跑迁移。
 */
export interface RecordItem {
  id: number
  archive_id: string | null
  type: RecordType
  /** 哪条目标（created / done / failed）。目标被删档清掉后是 null */
  goal_id: string | null
  /** 目标名字的**快照** —— 目标没了也要能显示，所以不能只靠 join */
  goal_content: string | null
  /**
   * 这条动态涉及的分值：
   * created → 押注分值（正）· done → +stake · failed → −stake
   * sealed → 封档扣分（≤ 0），**0 表示全部完成、免费**
   */
  amount: number | null
  /**
   * ⚠️ 过渡字段：0023 迁移 drop 掉这一列之前它还在。
   * 客户端在 `goal_content` 取不到时会退回显示这句原文（见 lib/records.ts），
   * 免得迁移还没跑的那段时间界面上一堆"（已删除的目标）"。
   * 0023 跑完确认没问题后，这个字段可以删。
   */
  text?: string
  created_at: string
}

// ---------- 档位分值 ----------

export const TIER_STAKE: Record<Exclude<Tier, 'allin'>, number> = { low: 5, mid: 10, high: 20 }

/** ALL IN = 当前活力值 × 80%（四舍五入，最低 1） */
export function allInStake(vitality: number): number {
  return Math.max(1, Math.round(vitality * 0.8))
}

export function stakeOf(tier: Tier, vitality: number): number {
  return tier === 'allin' ? allInStake(vitality) : TIER_STAKE[tier]
}

export const TIER_LABEL: Record<Tier, string> = { low: '低', mid: '中', high: '高', allin: 'ALL IN' }

// ---------- 核心操作 ----------

/**
 * 取当前登录用户。
 * 刻意把 getUser 的 error 原样抛出（而不是统一成"未登录"）：账号被删 / token 失效时
 * 错误里带 status（401/403），上层才能用 isAuthError() 识别出来、把人踢回登录页。
 */
async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('未登录')
  return user
}

/** 惰性结算：打开应用 / 关键操作后调用（幂等）—— 到点未申报的目标在这里判负 */
export async function settleAll() {
  // 顺带当成一次登录态体检：账号被删时，只有打到服务端的请求才会暴露问题
  const user = await requireUser()
  const { error } = await supabase.rpc('settle_goals', { p_user_id: user.id })
  if (error) throw error
}

/** 当前活力值（流水求和） */
export async function getVitality(): Promise<number> {
  const { data, error } = await supabase.from('vitality_ledger').select('amount')
  if (error) throw error
  const sum = (data as { amount: number }[]).reduce((s, r) => s + Number(r.amount), 0)
  return Math.round(sum)
}

/** 流水账（最近 n 笔） */
export async function getLedger(limit = 100): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('vitality_ledger')
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as LedgerEntry[]
}

// ---------- 动态 / 记录 ----------

/** 全局最近的动态（首页「最近」），新的在前 */
export async function getRecentRecords(limit = 20): Promise<RecordItem[]> {
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as RecordItem[]
}

/** 某个存档的记录（历史页），新的在前 */
export async function getRecords(archiveId: string): Promise<RecordItem[]> {
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .eq('archive_id', archiveId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as RecordItem[]
}

// ---------- 存档 ----------

export async function getArchives(): Promise<Archive[]> {
  const { data, error } = await supabase
    .from('archives')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Archive[]
}

/** 开新存档 */
export async function createArchive(name: string): Promise<Archive> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('archives')
    .insert({ name: name.trim(), user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data as Archive
}

/** 封档：有未了结扣当前活力值 10%，全了结免费。返回扣分（≤ 0） */
export async function sealArchive(archiveId: string): Promise<number> {
  const { data, error } = await supabase.rpc('seal_archive', { p_archive_id: archiveId })
  if (error) throw error
  return Number(data)
}

/** 删除已封档的存档。返回被解绑的流水笔数（活力值不变） */
export async function deleteArchive(archiveId: string): Promise<number> {
  await requireUser()
  const { data, error } = await supabase.rpc('delete_archive', { p_archive_id: archiveId })
  if (error) throw error
  return Number(data)
}

// ---------- 目标 ----------

/** 全部目标（跨存档），新的在前 */
export async function getGoals(): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Goal[]
}

/**
 * 设立目标。
 * - 押注分值在这里快照下来（ALL IN 用当时的活力值）
 * - 目标从待办来时：content 与 exec 都取当时的文案快照，并把那条待办移出清单（taken）
 * - 奖励从愿望单来时：记下 wish_id，达成那一刻由 complete_goal 划掉它
 */
export async function createGoal(input: {
  archiveId: string
  content: string
  tier: Tier
  vitality: number
  dueAt: string
  reward: string
  rewardWishId?: string | null
  penalty: string
  exec?: string
  todoId?: string | null
  /** 打卡型目标的总格数；不传 = 普通的一次性目标 */
  checkTotal?: number | null
}): Promise<Goal> {
  const user = await requireUser()
  const stake = stakeOf(input.tier, input.vitality)

  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: user.id,
      archive_id: input.archiveId,
      content: input.content.trim(),
      tier: input.tier,
      stake,
      due_at: input.dueAt,
      reward: input.reward.trim(),
      reward_wish_id: input.rewardWishId ?? null,
      penalty: input.penalty.trim(),
      exec: input.exec ?? '',
      todo_id: input.todoId ?? null,
      check_total: input.checkTotal ?? null,
    })
    .select()
    .single()
  if (error) throw error
  const goal = data as Goal

  // 立项动态：只写结构化数据，句子由前端按模板渲染（见 lib/records.ts）。
  // 写失败不阻塞主流程 —— 目标已经立上了。
  try {
    await supabase.from('records').insert({
      user_id: user.id,
      archive_id: input.archiveId,
      type: 'created',
      goal_id: goal.id,
      goal_content: goal.content,
      amount: goal.stake,
    })
  } catch {
    /* 忽略 */
  }

  // 目标单里那条移出清单。放最后做 —— 上面失败了就别去动人家的清单。
  if (input.todoId) {
    try {
      await supabase
        .from('todos')
        .update({ status: 'taken', taken_at: new Date().toISOString() })
        .eq('id', input.todoId)
        .eq('status', 'open') // 幂等：只有还在待办里的才移出
    } catch {
      /* 忽略 */
    }
  }

  return goal
}

/** 改执行区正文（随写随存） */
export async function updateGoalExec(id: string, exec: string) {
  await requireUser()
  const { error } = await supabase.from('goals').update({ exec }).eq('id', id)
  if (error) throw error
}

/**
 * 做到：返回实际加到的分（0 = 没抢到 / 已经判负了）。
 * 加分、写记录、划愿望、扣待办格子全在服务端一个函数里，原子完成。
 */
export async function completeGoal(goalId: string): Promise<number> {
  await requireUser()
  const { data, error } = await supabase.rpc('complete_goal', { p_goal_id: goalId })
  if (error) throw error
  return Number(data)
}

/**
 * 打卡一次（只有打卡型目标能打）。
 *
 * 一天只能打一次、上限 check_total、过了死线打不了 —— 这些判定全在库里，
 * 客户端只负责显示，别在这边再判一遍（两处判定迟早会不一致）。
 * 打满最后一格时库里会当场自动结算，completed 就是给这个时候的。
 */
export async function checkInGoal(
  goalId: string,
): Promise<{ done: number; total: number; completed: boolean }> {
  await requireUser()
  const { data, error } = await supabase.rpc('check_in_goal', { p_goal_id: goalId })
  if (error) throw error
  const r = data as { done: number; total: number; completed: boolean }
  return { done: Number(r.done), total: Number(r.total), completed: r.completed === true }
}

/** 做不到（主动放弃，效果同到点判负）：扣分 + 退回待办（次数不动） */
export async function giveUpGoal(goalId: string): Promise<{ lost: number; returned: boolean }> {
  await requireUser()
  const { data, error } = await supabase.rpc('giveup_goal', { p_goal_id: goalId })
  if (error) throw error
  const r = (data ?? {}) as { lost?: number; returned?: boolean }
  return { lost: Number(r.lost ?? 0), returned: r.returned === true }
}

// ---------- 愿望单 ----------

export async function getWishes(): Promise<Wish[]> {
  const { data, error } = await supabase
    .from('wishes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Wish[]
}

export async function createWish(content: string): Promise<Wish> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('wishes')
    .insert({ user_id: user.id, content: content.trim() })
    .select()
    .single()
  if (error) throw error
  return data as Wish
}

export async function updateWish(id: string, content: string) {
  await requireUser()
  const { error } = await supabase.from('wishes').update({ content: content.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteWish(id: string) {
  await requireUser()
  const { error } = await supabase.from('wishes').delete().eq('id', id)
  if (error) throw error
}

/**
 * 标记已实现（带 status='open' 条件 → 幂等，重复调用不覆盖首次的 done_at）
 */
export async function setWishDone(id: string, archiveId: string | null = null) {
  const { error } = await supabase
    .from('wishes')
    .update({ status: 'done', done_at: new Date().toISOString(), done_archive_id: archiveId })
    .eq('id', id)
    .eq('status', 'open')
  if (error) throw error
}

/** 放回愿望单（标错了 / 想再用一次） */
export async function reopenWish(id: string) {
  await requireUser()
  const { error } = await supabase
    .from('wishes')
    .update({ status: 'open', done_at: null, done_archive_id: null })
    .eq('id', id)
  if (error) throw error
}

// ---------- 待办 ----------

/** 全部待办。taken（已立项）的不返回 —— 它已经移出清单了 */
export async function getTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .neq('status', 'taken')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Todo[]
}

export async function createTodo(content: string, note = '', times = 1): Promise<Todo> {
  const user = await requireUser()
  const n = Math.max(1, Math.min(99, Math.round(times) || 1))
  const { data, error } = await supabase
    .from('todos')
    .insert({
      user_id: user.id, content: content.trim(), note: note.trim(),
      times_total: n, times_left: n,
    })
    .select()
    .single()
  if (error) throw error
  return data as Todo
}

/** 改标题与内容（备注允许清空，所以不能"只有非空才写"） */
export async function updateTodo(id: string, content: string, note = '') {
  await requireUser()
  const { error } = await supabase
    .from('todos')
    .update({ content: content.trim(), note: note.trim() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteTodo(id: string) {
  await requireUser()
  const { error } = await supabase.from('todos').delete().eq('id', id)
  if (error) throw error
}

/** 直接勾掉：不押注、不加不减分（这正是"普通 TODOLIST"那部分） */
export async function setTodoDone(id: string) {
  const { error } = await supabase
    .from('todos')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'taken') // 已立项的不能被反向勾掉；同时保证幂等
  if (error) throw error
}

/**
 * 直接改写剩余格数。给「主动减一格」用。
 *
 * 不走 RPC：它只动 todos 自己一列，没有跨表副作用，也没有并发争抢
 * （跟"目标完成时扣格"不同 —— 那个必须在 complete_goal 里跟结算同事务）。
 * 表上还有 todos_times_chk（0 ≤ left ≤ total）兜底，越界会直接被库挡回来。
 */
export async function setTodoTimesLeft(id: string, left: number) {
  await requireUser()
  const n = Math.max(0, Math.round(left) || 0)
  const { error } = await supabase
    .from('todos')
    .update({ times_left: n })
    .eq('id', id)
    .neq('status', 'taken') // 已立项的不动：它正挂在某个目标上，格子由那个目标结账
  if (error) throw error
}

/** 把勾掉的放回待办 */
export async function reopenTodo(id: string) {
  await requireUser()
  const { error } = await supabase
    .from('todos')
    .update({ status: 'open', done_at: null })
    .eq('id', id)
    .neq('status', 'taken')
  if (error) throw error
}
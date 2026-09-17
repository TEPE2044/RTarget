import { supabase } from './supabase'

// ---------- 类型（与 supabase/migrations/0001_init.sql 对应） ----------

export type NodeKind = 'A' | 'B' | 'C'
export type Tier = 'low' | 'mid' | 'high' | 'allin'
export type NodeStatus = 'bound' | 'active' | 'settled'

export interface Archive {
  id: string
  name: string
  status: 'open' | 'sealed'
  created_at: string
  sealed_at: string | null
  sealed_free: boolean | null
}

export interface GameNode {
  id: string
  archive_id: string
  user_id: string
  kind: NodeKind
  parent_id: string | null
  content: string
  tier: Tier
  stake: number
  due_at: string
  status: NodeStatus
  created_at: string
  completed_at: string | null
  compound_a_done: boolean | null
  compound_c_done: boolean | null
  /** 奖励 B 来自愿望单时有值；手输的奖励为 null（0015） */
  wish_id: string | null
  /** 目标 A 来自目标单时有值；手输的目标为 null（0016） */
  todo_id: string | null
}

// ---------- 目标单 ----------

export type TodoStatus = 'open' | 'taken' | 'done'

export interface Todo {
  id: string
  user_id: string
  content: string
  /** open 待办 / taken 已立项（移出清单）/ done 直接勾掉 */
  status: TodoStatus
  done_at: string | null
  taken_at: string | null
  created_at: string
}

// ---------- 愿望单 ----------

export type WishStatus = 'open' | 'done'

export interface Wish {
  id: string
  user_id: string
  content: string
  status: WishStatus
  done_at: string | null
  /** 在哪个存档里兑现的，仅作展示；存档删掉后会变 null */
  done_archive_id: string | null
  created_at: string
}

export interface LedgerEntry {
  id: number
  node_id: string | null
  archive_id: string | null
  reason: string | null
  note: string | null
  amount: number
  created_at: string
}

// ---------- 档位分值 ----------

export const TIER_STAKE: Record<Tier, number | null> = {
  low: 5,
  mid: 10,
  high: 20,
  allin: null, // ALL IN = 当前活力值 × 0.8，调用方传入快照
}

// ---------- 核心操作 ----------

/**
 * 取当前登录用户。
 * 这里刻意把 getUser 的 error 原样抛出（而不是统一成"未登录"）：
 * 账号被删除 / token 失效时错误里带 status（401/403），
 * 上层才能用 isAuthError() 识别出来、把人踢回登录页。
 */
async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('未登录')
  return user
}

/** 惰性结算：打开应用 / 任何关键操作后调用（幂等） */
export async function settleAll() {
  // 函数签名为 settle_all(p_user_id uuid)，必须显式传参
  // 顺带当成一次登录态体检：账号被删时，只有打到服务端的请求才会暴露问题
  const user = await requireUser()
  const { error } = await supabase.rpc('settle_all', { p_user_id: user.id })
  if (error) throw error
}

/** 当前活力值（流水求和） */
export async function getVitality(): Promise<number> {
  const { data, error } = await supabase
    .from('vitality_ledger')
    .select('amount')
  if (error) throw error
  // 四舍五入取整（文档 v1.0：积分不要小数）
  const sum = (data as { amount: number }[]).reduce((s, r) => s + Number(r.amount), 0)
  return Math.round(sum)
}

/** 流水账（最近 n 笔） */
export async function getLedger(limit = 50): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('vitality_ledger')
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as LedgerEntry[]
}

/** 开新存档 */
export async function createArchive(name: string): Promise<Archive> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('archives')
    .insert({ name, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data as Archive
}

/** 存档列表（open 在前，sealed 在后） */
export async function getArchives(): Promise<Archive[]> {
  const { data, error } = await supabase
    .from('archives')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Archive[]
}

/**
 * 设立目标：A + 预绑 B + 预绑 C，三节点原子写入
 * - 档位继承：B/C 无独立档位，分值 = A 的档位分值（ALL IN 同样继承快照）
 * - 死线各自独立：A 用 dueAt；C 用 penaltyDueAt，且**只能落在 A 之后的 1~3 天**
 *   （需求；这段就是惩罚复合体的补做窗口）；B 无时限，due_at 沿用 A 的仅作展示
 * - 奖励 B 可以来自愿望单（reward.wishId），也可以是临时手输。
 *   目标 A 可以来自目标单（todoId），同样可以临时手输。
 *   content 始终写当时的文案快照 —— 清单里以后改了名，不影响已经立过的目标
 */
export async function createGoal(input: {
  archiveId: string
  content: string
  tier: Tier
  dueAt: string
  penaltyDueAt: string
  reward: { content: string; wishId?: string | null }
  penalty: { content: string }
  vitality: number
  /** 目标 A 的来源；从目标单选的时候填，手输留空 */
  todoId?: string | null
}): Promise<string> {
  const user = await requireUser()
  // 活力值四舍五入取整（文档 v1.0：不要小数点）
  const stake = input.tier === 'allin' ? Math.round(input.vitality * 0.8) : TIER_STAKE[input.tier]!

  // C 死线只能是 A 死线之后的 1~3 天（需求），即复合体补做窗口最长 3 天
  const gapDays = Math.round(
    (new Date(input.penaltyDueAt).getTime() - new Date(input.dueAt).getTime()) / 86_400_000
  )
  if (gapDays < 1 || gapDays > 3) {
    throw new Error('惩罚 C 的死线只能设在 A 死线之后的 1~3 天内')
  }

  const { data: aNode, error: aErr } = await supabase
    .from('nodes')
    .insert({
      archive_id: input.archiveId,
      user_id: user.id,
      kind: 'A',
      content: input.content,
      todo_id: input.todoId ?? null,
      tier: input.tier,
      stake,
      due_at: input.dueAt,
      status: 'active',
    })
    .select()
    .single()
  if (aErr) throw aErr

  // B/C 继承 A 的档位与分值；C 用自己的独立死线（复合体窗口）
  const children = [
    {
      archive_id: input.archiveId,
      user_id: user.id,
      kind: 'B' as NodeKind,
      parent_id: (aNode as GameNode).id,
      content: input.reward.content,
      wish_id: input.reward.wishId ?? null,
      tier: input.tier,
      stake,
      due_at: input.dueAt, // B 无时限，仅作展示
      status: 'bound' as NodeStatus, // A 达成前 B 处于 bound
    },
    {
      archive_id: input.archiveId,
      user_id: user.id,
      kind: 'C' as NodeKind,
      parent_id: (aNode as GameNode).id,
      content: input.penalty.content,
      tier: input.tier,
      stake,
      due_at: input.penaltyDueAt, // 独立死线：A 判负后这段时间内可补做
      status: 'bound' as NodeStatus, // A 判负前 C 处于 bound
    },
  ]

  const { error: childErr } = await supabase.from('nodes').insert(children)
  if (childErr) {
    // 回滚 A（无事务支持时的手动补偿）
    await supabase.from('nodes').delete().eq('id', (aNode as GameNode).id)
    throw childErr
  }

  // 立项成功 → 把目标单里那条移出清单（taken）。
  // 放在最后做：万一上面写节点失败了，就别去动人家的清单。
  // 同样是附加效果，失败不阻塞（清单里多留一条，比目标没立成好）。
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

  return (aNode as GameNode).id
}

/** 获取某存档的全部节点 */
export async function getNodes(archiveId: string): Promise<GameNode[]> {
  const { data, error } = await supabase
    .from('nodes')
    .select('*')
    .eq('archive_id', archiveId)
    .order('created_at')
  if (error) throw error
  return data as GameNode[]
}

/** 当前用户全部节点（跨存档）——首页统计、下拉红点、历史页都用它 */
export async function getAllNodes(): Promise<GameNode[]> {
  const { data, error } = await supabase
    .from('nodes')
    .select('*')
    .order('created_at')
  if (error) throw error
  return data as GameNode[]
}

/**
 * A 是否正处在惩罚复合体里
 * 判据用 C 的状态而不是 A.completed_at：A 判负后用户补完 A 会写 completed_at，
 * 但那时复合体还没结算，卡片必须继续显示为复合体。
 */
export function inCompound(a: GameNode, c: GameNode | null): boolean {
  return a.kind === 'A' && a.status === 'settled' && a.compound_a_done === null
    && !!c && c.status !== 'bound'
}

/** 存档是否"正在进行"（还有未了结的节点）——下拉列表红点用 */
export function hasPending(nodes: GameNode[], archiveId: string): boolean {
  return nodes.some((n) => n.archive_id === archiveId && n.status === 'active')
}

/** 按存档汇总流水净额（历史页看每个档的收支） */
export async function getArchiveLedgerSums(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('vitality_ledger')
    .select('archive_id, amount')
  if (error) throw error
  const sums: Record<string, number> = {}
  for (const r of data as { archive_id: string | null; amount: number }[]) {
    if (!r.archive_id) continue
    sums[r.archive_id] = (sums[r.archive_id] ?? 0) + Number(r.amount)
  }
  return sums
}

/** 从流水里找某存档的封档扣分（note 以"封档"开头的那笔） */
export function findSealPenalty(ledger: LedgerEntry[], archiveId: string): number | null {
  const hit = ledger.find(
    (l) => l.archive_id === archiveId && (l.note ?? '').startsWith('封档')
  )
  return hit ? hit.amount : null
}

/**
 * 主动申报完成（手动结算的唯一入口）
 * - A active 时点击 → A 完成 → 开启 B（bound→active）
 * - A settled（复合体中）时点击 → 记为 A 补完，等复合体结算
 * - C active 时点击 → 记为 C 完成，等复合体结算
 * - B active 时点击 → 立刻 +B 分（流水 b_completed）
 * 完成后调用 settleAll 推进复合体结算（若条件满足）
 */
export async function completeNode(nodeId: string) {
  await requireUser() // 只做登录态体检，这里用不到 user 本身
  const { data: node, error: fetchErr } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', nodeId)
    .single()
  if (fetchErr) throw fetchErr
  const n = node as GameNode

  // 幂等守卫：已申报过 / 已进终态，直接返回
  // （修掉"完成之后完成按钮还能点"——重复点击不再产生任何副作用）
  if (n.completed_at) return
  if (n.status === 'settled' && n.compound_a_done !== null) return

  // B：确认享受完毕（分早已到账，这里只是记账标记，无时限）
  if (n.kind === 'B' && n.status === 'active') {
    const { error } = await supabase
      .from('nodes')
      .update({ status: 'settled', completed_at: new Date().toISOString() })
      .eq('id', nodeId)
    if (error) throw error
    await settleAll()
    return
  }

  // A：active → 完成，立刻奖励 B（分先到账，B 等待用户点"确认"标记，无时限）
  if (n.kind === 'A' && n.status === 'active') {
    const { error } = await supabase
      .from('nodes')
      .update({ status: 'settled', completed_at: new Date().toISOString() })
      .eq('id', nodeId)
    if (error) throw error
    // B 开启为 active（待确认），同时立刻加分
    const { data: bNode, error: bFetchErr } = await supabase
      .from('nodes')
      .select('*')
      .eq('parent_id', nodeId)
      .eq('kind', 'B')
      .eq('status', 'bound')
      .single()
    if (bFetchErr) throw bFetchErr
    const { error: bErr } = await supabase
      .from('nodes')
      .update({ status: 'active' })
      .eq('id', (bNode as GameNode).id)
    if (bErr) throw bErr
    const { error: ledErr } = await supabase.from('vitality_ledger').insert({
      user_id: n.user_id,
      node_id: (bNode as GameNode).id,
      archive_id: n.archive_id,
      reason: 'b_completed',
      amount: Math.round((bNode as GameNode).stake),
    })
    if (ledErr) throw ledErr

    // 这个奖励是从愿望单里挑的话，愿望到此兑现 → 标记已实现。
    // 附加效果：失败也不该让主流程看起来出错（分已经加过了、A 也已经完成），
    // 所以这里吞掉异常，只是愿望会留在未实现里，用户还能手动标记。
    const wishId = (bNode as GameNode).wish_id
    if (wishId) {
      try {
        await setWishDone(wishId, n.archive_id)
      } catch {
        /* 忽略 */
      }
    }

    await settleAll()
    return
  }

  // A 复合体补完 / C 完成：只记完成时间，结算交给 settleAll
  const { error } = await supabase
    .from('nodes')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', nodeId)
  if (error) throw error
  await settleAll()
}

/** 主动放弃（= 主动判负，效果等同超时；文字订正：不是"认输"） */
export async function concedeNode(nodeId: string) {
  const { data: node, error: fetchErr } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', nodeId)
    .single()
  if (fetchErr) throw fetchErr
  const n = node as GameNode

  if (n.status !== 'active') return
  if (n.completed_at) return // 已申报完成，不再接受放弃

  // 把 due_at 挪到过去，让 settleAll 走超时分支（复用同一结算路径，避免两套逻辑）
  const { error } = await supabase
    .from('nodes')
    .update({ due_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', nodeId)
  if (error) throw error
  await settleAll()
}

/** 封档：有未了结之事扣当前活力值 10%；全部了结的免费。返回扣分（负数或 0） */
export async function sealArchive(archiveId: string): Promise<number> {
  const { data, error } = await supabase.rpc('seal_archive', { p_archive_id: archiveId })
  if (error) throw error
  return Number(data)
}

/**
 * 删除一个已封档的存档。返回被解绑的流水笔数。
 * 只会删掉存档和它的节点；活力值流水保留（只断开归属），所以分数不变。
 * 未封档的存档删不掉，会由函数抛错。
 */
export async function deleteArchive(archiveId: string): Promise<number> {
  // 先做一次登录态体检，账号失效时抛出的错误带 401/403，上层才能识别并踢回登录页
  await requireUser()
  const { data, error } = await supabase.rpc('delete_archive', { p_archive_id: archiveId })
  if (error) throw error
  return Number(data)
}

// ---------- 愿望单 ----------

/**
 * 全部愿望。排序交给调用方分组（未实现 / 已实现），
 * 这里只保证同一组内新的在前。
 */
export async function getWishes(): Promise<Wish[]> {
  const { data, error } = await supabase
    .from('wishes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Wish[]
}

/** 往愿望单里加一条 */
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

/** 改文案。已实现的也能改（只是改个说法） */
export async function updateWish(id: string, content: string) {
  await requireUser()
  const { error } = await supabase
    .from('wishes')
    .update({ content: content.trim() })
    .eq('id', id)
  if (error) throw error
}

/** 彻底删掉。历史里的奖励不受影响 —— B 存的是当时的内容快照 */
export async function deleteWish(id: string) {
  await requireUser()
  const { error } = await supabase.from('wishes').delete().eq('id', id)
  if (error) throw error
}

/**
 * 标记已实现。
 * 两个入口共用：A 达成时自动标记（见 completeNode），以及用户手动标记
 * （有些愿望不是靠押注系统达成的）。
 * 带 status='open' 条件 → 幂等，重复调用不会覆盖首次的 done_at。
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

// ---------- 目标单 ----------

/**
 * 全部待办。taken（已立项）的**不返回** —— 它已经从清单里移出了，
 * 事情在「执行」页里继续。想看它去了哪，反查 nodes.todo_id。
 */
export async function getTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .neq('status', 'taken')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Todo[]
}

export async function createTodo(content: string): Promise<Todo> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('todos')
    .insert({ user_id: user.id, content: content.trim() })
    .select()
    .single()
  if (error) throw error
  return data as Todo
}

export async function updateTodo(id: string, content: string) {
  await requireUser()
  const { error } = await supabase
    .from('todos')
    .update({ content: content.trim() })
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

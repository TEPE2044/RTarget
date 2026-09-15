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

/** 惰性结算：打开应用 / 任何关键操作后调用（幂等） */
export async function settleAll() {
  // 函数签名为 settle_all(p_user_id uuid)，必须显式传参
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
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
 * 设立目标：A + 预绑 B + 预绑 C，三节点原子写入（ALL IN 档位 stake 为活力值×0.8 快照）
 * B/C 的 due_at 在设立时先设为 A 的 due_at（开启时由 UI 引导用户重设，或直接沿用）
 */
export async function createGoal(input: {
  archiveId: string
  content: string
  tier: Tier
  dueAt: string
  reward: { content: string; tier: Tier; dueAt?: string }
  penalty: { content: string; tier: Tier; dueAt?: string }
  vitality: number
}): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  // 活力值四舍五入取整（文档 v1.0：不要小数点）
  const allinStake = Math.round(input.vitality * 0.8)
  const stake = input.tier === 'allin' ? allinStake : TIER_STAKE[input.tier]!
  const bStake = input.reward.tier === 'allin' ? allinStake : TIER_STAKE[input.reward.tier]!
  const cStake = input.penalty.tier === 'allin' ? allinStake : TIER_STAKE[input.penalty.tier]!

  const { data: aNode, error: aErr } = await supabase
    .from('nodes')
    .insert({
      archive_id: input.archiveId,
      user_id: user.id,
      kind: 'A',
      content: input.content,
      tier: input.tier,
      stake,
      due_at: input.dueAt,
      status: 'active',
    })
    .select()
    .single()
  if (aErr) throw aErr

  const children = [
    {
      archive_id: input.archiveId,
      user_id: user.id,
      kind: 'B' as NodeKind,
      parent_id: (aNode as GameNode).id,
      content: input.reward.content,
      tier: input.reward.tier,
      stake: bStake,
      due_at: input.reward.dueAt ?? input.dueAt,
      status: 'bound' as NodeStatus, // A 达成前 B 处于 bound
    },
    {
      archive_id: input.archiveId,
      user_id: user.id,
      kind: 'C' as NodeKind,
      parent_id: (aNode as GameNode).id,
      content: input.penalty.content,
      tier: input.penalty.tier,
      stake: cStake,
      due_at: input.penalty.dueAt ?? input.dueAt,
      status: 'bound' as NodeStatus, // A 判负前 C 处于 bound
    },
  ]

  const { error: childErr } = await supabase.from('nodes').insert(children)
  if (childErr) {
    // 回滚 A（无事务支持时的手动补偿）
    await supabase.from('nodes').delete().eq('id', (aNode as GameNode).id)
    throw childErr
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

/**
 * 主动申报完成（手动结算的唯一入口）
 * - A active 时点击 → A 完成 → 开启 B（bound→active）
 * - A settled（复合体中）时点击 → 记为 A 补完，等复合体结算
 * - C active 时点击 → 记为 C 完成，等复合体结算
 * - B active 时点击 → 立刻 +B 分（流水 b_completed）
 * 完成后调用 settleAll 推进复合体结算（若条件满足）
 */
export async function completeNode(nodeId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const { data: node, error: fetchErr } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', nodeId)
    .single()
  if (fetchErr) throw fetchErr
  const n = node as GameNode

  // B：立刻兑现奖励
  if (n.kind === 'B' && n.status === 'active') {
    const { error } = await supabase
      .from('nodes')
      .update({ status: 'settled', completed_at: new Date().toISOString() })
      .eq('id', nodeId)
    if (error) throw error
    const { error: ledErr } = await supabase.from('vitality_ledger').insert({
      user_id: n.user_id ?? user.id,
      node_id: nodeId,
      archive_id: n.archive_id,
      reason: 'b_completed',
      amount: Math.round(n.stake),
    })
    if (ledErr) throw ledErr
    await settleAll()
    return
  }

  // A：active → 完成，立刻奖励 B（B 分直接到账，无需点击确认）
  if (n.kind === 'A' && n.status === 'active') {
    const { error } = await supabase
      .from('nodes')
      .update({ status: 'settled', completed_at: new Date().toISOString() })
      .eq('id', nodeId)
    if (error) throw error
    // B 立刻结算并加分（"立刻奖励"：A 达成即到账）
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
      .update({ status: 'settled', completed_at: new Date().toISOString() })
      .eq('id', (bNode as GameNode).id)
    if (bErr) throw bErr
    const { error: ledErr } = await supabase.from('vitality_ledger').insert({
      user_id: n.user_id,
      node_id: (bNode as GameNode).id,
      archive_id: n.archive_id,
      reason: 'b_completed',
      amount: (bNode as GameNode).stake,
    })
    if (ledErr) throw ledErr
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

/** 主动认输（点"未完成"= 主动判负，效果等同超时） */
export async function concedeNode(nodeId: string) {
  const { data: node, error: fetchErr } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', nodeId)
    .single()
  if (fetchErr) throw fetchErr
  const n = node as GameNode

  if (n.status !== 'active') return

  // 把 due_at 挪到过去，让 settleAll 走超时分支（复用同一结算路径，避免两套逻辑）
  const { error } = await supabase
    .from('nodes')
    .update({ due_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', nodeId)
  if (error) throw error
  await settleAll()
}

/** 封档：有未了结之事扣当前活力值 10%，干净封档免费。返回扣分（负数或 0） */
export async function sealArchive(archiveId: string): Promise<number> {
  const { data, error } = await supabase.rpc('seal_archive', { p_archive_id: archiveId })
  if (error) throw error
  return Number(data)
}

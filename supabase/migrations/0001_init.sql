-- ============================================================
-- 活力值奖罚系统 v1.0 —— 数据模型
-- 机制文档：docs/mechanism.md
-- 模型：A(押注) / B(回血) / C(债务) 三节点 + 惩罚复合体
-- 结算：惰性结算（打开应用时触发），无推送无倒计时
-- ============================================================

create extension if not exists "uuid-ossp";

-- ---------- 枚举 ----------

create type node_kind as enum ('A', 'B', 'C');          -- A 押注 / B 回血 / C 债务
create type tier as enum ('low', 'mid', 'high', 'allin'); -- 档位：低5 中10 高20 ALL IN
create type node_status as enum (
  'bound',    -- 已预绑（B/C 在 A 设立时绑定，尚未开启）
  'active',   -- 进行中（倒计时中，等待用户申报）
  'settled'   -- 已结算（终态：完成/作废/返还）
);
create type archive_status as enum ('open', 'sealed');
create type ledger_reason as enum (
  'a_failed',      -- A 超时/认输 → 立刻扣 A 分
  'c_entered',     -- 进入惩罚复合体 → 扣 C 分
  'b_completed',   -- B 用户点击完成 → +B 分
  'compound_fail', -- 复合体 A+C 都未完成 → 扣 A+C 分
  'compound_redeem'-- 复合体 A+C 全部完成 → 返还 A+C 分
);

-- ---------- 存档 ----------

create table archives (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status archive_status not null default 'open',
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  sealed_free boolean          -- 封档是否免费（全部走向奖励分支）
);

-- ---------- 节点 ----------
-- A 是根节点；B/C 通过 parent_id 挂在 A 上（bound → active → settled）
-- 惩罚复合体 = A 节点 + 其 C 子节点在 a_failed 之后的联合结算体

create table nodes (
  id uuid primary key default uuid_generate_v4(),
  archive_id uuid not null references archives(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind node_kind not null,
  parent_id uuid references nodes(id),  -- B/C 的 parent = A；A 的 parent = null
  content text not null,                -- 事情内容
  tier tier not null,
  stake numeric not null,               -- 实际分值：低5/中10/高20/ALL IN=活力值×0.8（写入时快照）
  due_at timestamptz not null,          -- 时限（自定义，从设立那一刻起）
  status node_status not null default 'active',
  created_at timestamptz not null default now(),
  completed_at timestamptz,             -- 用户主动点击完成的时间
  -- 惩罚复合体结算结果（仅 A 节点在复合体结算后填写）
  compound_a_done boolean,
  compound_c_done boolean
);

create index nodes_archive_idx on nodes(archive_id);
create index nodes_parent_idx on nodes(parent_id);
create index nodes_due_idx on nodes(due_at) where status = 'active';

-- ---------- 活力值流水账 ----------
-- 活力值不存当前值，只存流水；当前值 = SUM(amount)
-- 防篡改、可审计：每滴血怎么流的都有据可查

create table vitality_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid references nodes(id),   -- 关联节点（封档扣分等无节点操作为 null）
  archive_id uuid references archives(id),
  reason ledger_reason,
  note text,
  amount numeric not null,             -- 正=加（奖励/返还），负=扣
  created_at timestamptz not null default now()
);

create index ledger_user_idx on vitality_ledger(user_id, created_at);

-- ---------- 活力值当前值（物化视图，可随时重建） ----------

create materialized view vitality_current as
  select user_id, sum(amount) as vitality
  from vitality_ledger
  group by user_id;

-- ---------- RLS ----------

alter table archives enable row level security;
alter table nodes enable row level security;
alter table vitality_ledger enable row level security;

create policy "own archives" on archives
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own nodes" on nodes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own ledger" on vitality_ledger
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 初始活力值 ----------
-- 新用户首笔流水：+10

create function grant_initial_vitality()
returns trigger language plpgsql security definer as $$
begin
  insert into vitality_ledger(user_id, reason, note, amount)
  values (new.id, null, '初始活力值', 10);
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function grant_initial_vitality();

-- ---------- 惰性结算（核心引擎，打开应用时调用） ----------
-- 输入：user_id；效果：把所有该判负的节点判负，写入流水
-- 全程幂等：重复调用不重复扣分（状态先推进再记账）

create function settle_all(p_user_id uuid)
returns void language plpgsql security definer as $$
declare
  n record;
  vitality numeric;
begin
  -- 当前活力值（含本轮已发生流水）
  select coalesce(sum(amount), 0) into vitality
  from vitality_ledger where user_id = p_user_id;

  -- 1) B 过期作废（active 且超时：奖励作废，无扣分，不进惩罚）
  update nodes
    set status = 'settled', completed_at = now()
  where user_id = p_user_id and kind = 'B' and status = 'active' and due_at < now();

  -- 2) A 超时/未申报 → 立刻扣 A 分（若已扣过则 status 已推进，幂等）
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'active' and due_at < now()
  loop
    update nodes set status = 'settled', compound_a_done = false
      where id = n.id;
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      values (p_user_id, n.id, n.archive_id, 'a_failed', -n.stake);
    -- 3) 进入惩罚复合体：C 由 bound → active，扣 C 分
    update nodes set status = 'active'
      where parent_id = n.id and kind = 'C' and status = 'bound';
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      select p_user_id, id, archive_id, 'c_entered', -stake
      from nodes where parent_id = n.id and kind = 'C' and status = 'active';
  end loop;

  -- 4) 复合体结算（A 已 a_failed，C 已 active 且超时）
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'settled'
      and compound_a_done is null and due_at < now()
  loop
    -- C 状态：active 超时 = 未完成；settled 有 completed_at = 完成
    declare
      c_done boolean;
      a_done boolean := false; -- A 已超时判负，A 点视为未完成，除非用户已主动补完
      c_node record;
    begin
      select * into c_node from nodes where parent_id = n.id and kind = 'C';
      c_done := (c_node.status = 'settled' and c_node.completed_at is not null);
      -- A 补完判定：A 已结算但用户后来主动补完（复合体开启后 A 仍可点完成）
      select exists(
        select 1 from nodes where id = n.id and completed_at is not null
      ) into a_done;

      update nodes set compound_a_done = a_done, compound_c_done = c_done
        where id = n.id;

      if not a_done and not c_done then
        -- 双未完成：再扣 A + C
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_fail', -(n.stake + c_node.stake));
        update nodes set status = 'settled' where id = c_node.id and status = 'active';
      elsif a_done and c_done then
        -- 双完成：返还 A + C（把之前扣的全返）
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_redeem', (n.stake + c_node.stake));
        update nodes set status = 'settled' where id = c_node.id and status = 'active';
      end if;
      -- 完成其一：无分变动（不扣不返）
    end;
  end loop;
end $$;

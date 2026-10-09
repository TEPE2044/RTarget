-- ============================================================
-- 0020: 机制 v2.0 —— 推倒重来
--
-- 机制文档：docs/mechanism.md（v2.0）
--   一个目标 = 一个奖励 + 一个惩罚；做到 +S、做不到 −S，**一锤子结清**。
--   砍掉：A/B/C 三节点、惩罚复合体、补做窗口、返还、负值禁押高档。
--   新增行为：判负 → 来源待办**退回清单**（次数不动）。
--
-- 本迁移做四件事：
--   1) 拆旧 —— 删 nodes（含 A/B/C 全套）与相关枚举；流水 reason 改成自由文本
--   2) 清历史 —— 按 Jackie 的要求「数据只留愿望和待办，历史数据不要了」：
--      流水清空重置为初始 10；存档清空，每个用户补一个空档「现在」
--   3) 建新 —— goals（目标）+ records（动态 / 历史记录）
--   4) 换引擎 —— settle_goals / complete_goal / giveup_goal / seal_archive / delete_archive
--
-- ⚠️ 这是**不可逆**的迁移（会清掉全部目标与流水）。跑之前先确认。
-- ⚠️ 记账一律用「认领式」条件更新（见 0019 的教训）：
--      update ... where <还在旧状态> returning id into claimed;
--      if claimed is null then continue/return; end if;
--    并且 **每轮开头先把 claimed 置空** —— 影响 0 行时 returning into 不会清空变量。
-- ============================================================


-- ============================================================
-- 1) 拆旧
-- ============================================================

-- nodes 被 vitality_ledger.node_id 引用；cascade 会一并去掉那条外键，列稍后删
drop table if exists nodes cascade;

-- 流水：reason 从枚举改成自由文本（新机制的种类会变，不想每加一种就迁一次）
alter table vitality_ledger alter column reason type text using reason::text;
alter table vitality_ledger drop column if exists node_id;

drop type if exists node_kind;
drop type if exists node_status;
drop type if exists ledger_reason;


-- ============================================================
-- 2) 清历史（只留 wishes / todos）
-- ============================================================

delete from vitality_ledger;
delete from archives;   -- 目标随存档一起没了（wishes.done_archive_id 由 on delete set null 兜住）


-- ============================================================
-- 3) 建新
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'goal_status') then
    create type goal_status as enum ('active', 'done', 'failed');
  end if;
end $$;


-- ---------- 目标 ----------
-- 一个目标就是一个完整的押注单元：内容 + 死线 + 押注 + 奖励 + 惩罚 + 执行正文。
-- 没有子节点、没有第二阶段 —— 状态只有 active →（done | failed）一次跳变。

create table if not exists goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  archive_id uuid not null references archives(id) on delete cascade,
  content text not null,                 -- 目标内容（从待办来时是当时的文案快照）
  tier tier not null,                    -- 档位（沿用 0001 的枚举）
  stake integer not null,                -- 实际分值：写入时快照（ALL IN = 当时活力值 × 80%）
  due_at timestamptz not null,           -- 死线：到点即判负
  reward text not null default '',       -- 奖励（文案快照）
  reward_wish_id uuid references wishes(id) on delete set null,  -- 奖励来自愿望单时有值
  penalty text not null default '',      -- 惩罚（文案，机制上的处理是固定的）
  exec text not null default '',         -- 执行区正文（Markdown，随时可改）
  todo_id uuid references todos(id) on delete set null,          -- 目标来自待办时有值
  status goal_status not null default 'active',
  settled_at timestamptz,                -- 结清时刻（done / failed 都有值）
  created_at timestamptz not null default now()
);

create index if not exists goals_user_idx on goals(user_id, status, created_at desc);
create index if not exists goals_archive_idx on goals(archive_id, status);
create index if not exists goals_due_idx on goals(due_at) where status = 'active';
create index if not exists goals_todo_idx on goals(todo_id) where todo_id is not null;

alter table goals enable row level security;
drop policy if exists "own goals" on goals;
create policy "own goals" on goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------- 动态 / 历史记录 ----------
-- 「最近发生了什么」（首页）和「这个存档的记录」（历史页）都从这里读。
-- type 只是给前端选图标用的：created / done / failed / sealed。

create table if not exists records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  archive_id uuid references archives(id) on delete cascade,
  type text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists records_user_idx on records(user_id, created_at desc);
create index if not exists records_archive_idx on records(archive_id, created_at desc);

alter table records enable row level security;
drop policy if exists "own records" on records;
create policy "own records" on records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- 流水挂到目标上（去掉的那条 node_id 的替代）
alter table vitality_ledger add column if not exists goal_id uuid references goals(id) on delete set null;


-- ---------- 重新播种 ----------
-- 每个已有用户：流水重置为初始 10，并补一个空档「现在」

insert into vitality_ledger(user_id, reason, note, amount)
select u.id, null, '初始活力值', 10 from auth.users u;

insert into archives(user_id, name)
select u.id, '现在' from auth.users u;


-- 新用户注册时同样：送 10 分 + 开一个「现在」
create or replace function grant_initial_vitality()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into vitality_ledger(user_id, reason, note, amount)
    values (new.id, null, '初始活力值', 10);
  insert into archives(user_id, name) values (new.id, '现在');
  return new;
end $$;


-- ============================================================
-- 4) 结算引擎
-- ============================================================

-- ---------- 惰性结算：到点未申报 → 判负 ----------
-- 打开应用时调一次（幂等）。判负一次到位：扣分、写记录、退回待办。

create or replace function settle_goals(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g record;
  claimed uuid;
  v_n integer;
begin
  for g in
    select * from goals
    where user_id = p_user_id and status = 'active' and due_at < now()
    order by due_at
  loop
    claimed := null;
    -- 认领：抢不到说明另一路（或另一个请求）已经在处理这一条了
    update goals set status = 'failed', settled_at = now()
      where id = g.id and status = 'active' and due_at < now()
      returning id into claimed;
    if claimed is null then continue; end if;

    insert into vitality_ledger(user_id, goal_id, archive_id, reason, note, amount)
      values (p_user_id, g.id, g.archive_id, 'goal_failed', '没做到：' || g.content, -g.stake);

    -- 从待办来的 → 退回清单（次数不动，一格都不扣）
    v_n := 0;
    if g.todo_id is not null then
      update todos set status = 'open', taken_at = null
        where id = g.todo_id and status = 'taken';
      get diagnostics v_n = row_count;
    end if;

    insert into records(user_id, archive_id, type, text)
      values (p_user_id, g.archive_id, 'failed',
        '没做到「' || g.content || '」 · −' || g.stake || ' 活力值'
        || case when v_n > 0 then ' · 已退回待办' else '' end);
  end loop;
end $$;

grant execute on function settle_goals(uuid) to authenticated;


-- ---------- 做到：+S，奖励兑现，待办扣一格 ----------
-- 手点「完成」的唯一入口。做完这几件事在**一个函数里**，客户端断线也不会只剩一半。

create or replace function complete_goal(p_goal_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g goals%rowtype;
  claimed uuid;
  v_n integer;
begin
  select * into g from goals where id = p_goal_id;
  if g.id is null then raise exception '目标不存在'; end if;
  if g.user_id <> auth.uid() then raise exception '只能操作自己的目标'; end if;

  -- 先把可能已经过点的账结掉，免得"界面说过期、库里还 active"时白拿奖励
  perform settle_goals(g.user_id);

  claimed := null;
  -- 认领：必须是**还在跑且没到点**的，才可能被算作"做到"
  update goals set status = 'done', settled_at = now()
    where id = p_goal_id and status = 'active' and due_at > now()
    returning id into claimed;
  if claimed is null then return 0; end if;

  insert into vitality_ledger(user_id, goal_id, archive_id, reason, note, amount)
    values (g.user_id, g.id, g.archive_id, 'goal_done', '做到：' || g.content, g.stake);

  insert into records(user_id, archive_id, type, text)
    values (g.user_id, g.archive_id, 'done',
      '完成了「' || g.content || '」 · +' || g.stake || ' 活力值');

  -- 奖励是从愿望单挑的 → 当场兑现（划掉）
  if g.reward_wish_id is not null then
    update wishes set status = 'done', done_at = now(), done_archive_id = g.archive_id
      where id = g.reward_wish_id and status = 'open';
  end if;

  -- 目标是从待办挑的 → 扣掉一格；扣完这条待办就用完了
  if g.todo_id is not null then
    update todos set times_left = greatest(0, times_left - 1) where id = g.todo_id;
    update todos
      set status = case when times_left = 0 then 'done' else 'open' end,
          done_at = case when times_left = 0 then now() else null end,
          taken_at = null
      where id = g.todo_id;
  end if;

  return g.stake;
end $$;

grant execute on function complete_goal(uuid) to authenticated;


-- ---------- 做不到（主动放弃）：−S，退回待办 ----------
-- 效果与到点判负完全一致，只是提前发生。

create or replace function giveup_goal(p_goal_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g goals%rowtype;
  claimed uuid;
  v_n integer;
  v_returned boolean := false;
begin
  select * into g from goals where id = p_goal_id;
  if g.id is null then raise exception '目标不存在'; end if;
  if g.user_id <> auth.uid() then raise exception '只能操作自己的目标'; end if;

  claimed := null;
  update goals set status = 'failed', settled_at = now()
    where id = p_goal_id and status = 'active'
    returning id into claimed;
  if claimed is null then
    return jsonb_build_object('lost', 0, 'returned', false);
  end if;

  insert into vitality_ledger(user_id, goal_id, archive_id, reason, note, amount)
    values (g.user_id, g.id, g.archive_id, 'goal_failed', '没做到：' || g.content, -g.stake);

  v_n := 0;
  if g.todo_id is not null then
    update todos set status = 'open', taken_at = null
      where id = g.todo_id and status = 'taken';
    get diagnostics v_n = row_count;
    v_returned := v_n > 0;
  end if;

  insert into records(user_id, archive_id, type, text)
    values (g.user_id, g.archive_id, 'failed',
      '没做到「' || g.content || '」 · −' || g.stake || ' 活力值'
      || case when v_returned then ' · 已退回待办' else '' end);

  return jsonb_build_object('lost', g.stake, 'returned', v_returned);
end $$;

grant execute on function giveup_goal(uuid) to authenticated;


-- ---------- 封档 ----------
-- 有未了结 → 扣当前活力值 10%；全了结 → 免费。
-- 封档即收口：档内还没了结的目标一并关闭（不再单独扣分，那 10% 就是代价）。

create or replace function seal_archive(p_archive_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_name text;
  v_has_pending boolean;
  v_vitality integer;
  v_penalty integer;
  claimed uuid;
begin
  select user_id, name into v_user_id, v_name from archives where id = p_archive_id;
  if v_user_id is null then raise exception '存档不存在'; end if;
  if v_user_id <> auth.uid() then raise exception '只能封自己的存档'; end if;

  perform settle_goals(v_user_id);

  select exists(
    select 1 from goals where archive_id = p_archive_id and status = 'active'
  ) into v_has_pending;

  select coalesce(sum(amount), 0) into v_vitality
  from vitality_ledger where user_id = v_user_id;

  -- ★ 认领：open → sealed，抢不到就是并发重复提交，直接收工（别重复扣 10%）
  claimed := null;
  update archives set status = 'sealed', sealed_at = now()
    where id = p_archive_id and status = 'open'
    returning id into claimed;
  if claimed is null then return 0; end if;

  update goals set status = 'failed', settled_at = now()
    where archive_id = p_archive_id and status = 'active';

  if v_has_pending then
    -- 活力值为负时 10% 也是负的 → 取 0，绝不因为封档反而加分
    v_penalty := -greatest(0, round(v_vitality * 0.10)::int);
    if v_penalty <> 0 then
      insert into vitality_ledger(user_id, archive_id, reason, note, amount)
        values (v_user_id, p_archive_id, 'seal_penalty', '封档：有未了结之事，扣 10% 活力值', v_penalty);
    end if;
  else
    v_penalty := 0;
    update archives set sealed_free = true where id = p_archive_id;
  end if;

  insert into records(user_id, archive_id, type, text)
    values (v_user_id, p_archive_id, 'sealed',
      case when v_has_pending
        then '封档「' || v_name || '」 · 扣 ' || abs(v_penalty) || ' 活力值'
        else '封档「' || v_name || '」 · 全部完成，免费'
      end);

  return v_penalty;
end $$;

grant execute on function seal_archive(uuid) to authenticated;


-- ---------- 删除已封档的存档 ----------
-- 只删记录、不动分数：流水保留（断开关联），否则「封档扣 10% → 删档」就是刷分漏洞。

create or replace function delete_archive(p_archive_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_status archive_status;
  v_detached integer;
begin
  select user_id, status into v_user_id, v_status from archives where id = p_archive_id;
  if v_user_id is null then raise exception '存档不存在'; end if;
  if v_user_id <> auth.uid() then raise exception '只能删自己的存档'; end if;
  if v_status <> 'sealed' then
    raise exception '只能删除已封档的存档，未封档的请先封档';
  end if;

  update vitality_ledger set archive_id = null, goal_id = null
    where archive_id = p_archive_id
       or goal_id in (select g.id from goals g where g.archive_id = p_archive_id);
  get diagnostics v_detached = row_count;

  delete from goals where archive_id = p_archive_id;  -- records 由外键 cascade 一并删掉
  delete from archives where id = p_archive_id;

  return v_detached;
end $$;

grant execute on function delete_archive(uuid) to authenticated;


-- 旧引擎下岗
drop function if exists settle_all(uuid);
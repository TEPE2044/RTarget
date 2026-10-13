-- ============================================================
-- 0023: 最近动态统一 —— 库里只存数据，句子一律由前端渲染
--
-- 要解决的问题（用户点出来的）：以前把"渲染好的整句话"拼进 records.text，
-- 于是 ① 改文案改不动历史数据 ② 换措辞要重写 SQL 函数 + 跑迁移
-- ③ 点击只能靠 text.includes(目标名) 反查目标（重名取错、删过的取不到）。
--
-- 立项已经在新版前端改成"按模板现拼"了，这次把另外三条（done / failed / sealed）
-- 一起统一：四个写入处只写结构化字段，**text 列直接 drop**。
--
-- 列的含义（只有前端模板在用，所以一列一个说法）：
--   goal_id       哪条目标（created/done/failed）。目标被删档级联清掉后会是 null
--   goal_content  目标名字的**快照**。目标没了也要能显示，所以不能只靠 join
--   amount        这条动态涉及的分值：
--                   created → 押注分值（正数）· done → +stake · failed → −stake
--                   sealed  → 封档扣分（≤0），**0 表示全部完成、免费**
--   注：sealed 的存档名不存快照 —— records 对 archives 是 on delete cascade，
--       存档在记录就在，前端拿 archive_id 查一下自己的 archives 列表即可。
--
-- ⚠️ 迁移必须手动在 Supabase 里跑（同 0020 / 0021 / 0022）。
-- ============================================================


-- ---------- 1. 加结构化列 ----------

alter table records
  add column if not exists goal_id      uuid,
  add column if not exists goal_content text,
  add column if not exists amount       integer;

comment on column records.goal_id      is '哪条目标（created/done/failed）；目标被删档清掉后为 null';
comment on column records.goal_content is '目标名字快照 —— 目标没了也要能显示，不能只靠 join';
comment on column records.amount       is 'created=押注分 · done=+stake · failed=−stake · sealed=封档扣分（0=全完成免费）';


-- ---------- 2. 回填存量行（从旧 text 里把数据抽出来） ----------
--
-- 旧文案的形态是固定的，所以能抽：
--   立了「X」 · 押 5        → 名字 X、分值 5
--   完成了「X」 · +5 活力值   → 5
--   没做到「X」 · −5 活力值   → 5（注意那个减号是 U+2212，不是 ASCII 的 -）
--   封档「N」 · 扣 5 活力值   → 5；「全部完成，免费」那条抽不到数字 → 0
-- 正则从「」之后开始匹配，所以名字里带数字也不会被误抽。

update records set
  goal_content = substring(text from '「([^」]*)」'),
  amount = case
    -- 判负与封档是**扣**分，存成负数
    when type in ('failed', 'sealed')
      then -coalesce(nullif(substring(text from '」 · [^0-9]*([0-9]+)'), '')::int, 0)
    else coalesce(nullif(substring(text from '」 · [^0-9]*([0-9]+)'), '')::int, 0)
  end
where amount is null;

-- goal_id：done/failed 用"记录时间 ≈ 目标结算时间"精确对上，同名的也不会认错
update records r set goal_id = g.id
from goals g
where r.goal_id is null
  and r.type in ('done', 'failed')
  and r.goal_content = g.content
  and g.settled_at is not null
  and abs(extract(epoch from (r.created_at - g.settled_at))) < 5;

-- goal_id：created 只有在名字唯一时才敢对上（重名的留空，前端退回按名字点）
update records r set goal_id = g.id
from goals g
where r.goal_id is null
  and r.type = 'created'
  and r.goal_content = g.content
  and (select count(*) from goals g2 where g2.content = g.content) = 1;


-- ---------- 3. 补回缺的立项行 ----------
--
-- 立项行一度改成"不落库、由目标投影"，那批行被删掉了。既然现在统一走这张表，
-- 就用目标自己把缺的补回来（目标上有 created_at，时间不会错）。
-- 判重看"同档 + 同名 + 时间几乎相同"，比只看 goal_id 稳 ——
-- 上面 goal_id 回填失败的（重名）那些行也认得出来。

insert into records(user_id, archive_id, type, goal_id, goal_content, amount, created_at)
select g.user_id, g.archive_id, 'created', g.id, g.content, g.stake, g.created_at
from goals g
where not exists (
  select 1 from records r
  where r.type = 'created'
    and r.archive_id = g.archive_id
    and r.goal_content = g.content
    and abs(extract(epoch from (r.created_at - g.created_at))) < 5
);


-- ---------- 4. 四个写入处改成只写结构化字段 ----------
--
-- 顺序很重要：必须在 drop text 之前替换完，否则旧函数一被调用就会炸。

-- 4a. 做到（沿用 0022 的版本，只换 records 那几行）
--
-- ⚠️⚠️ 下面的三处 case 必须保留显式 ::todo_status —— 那是 0021 修的 bug：
--   少了它 CASE 会被推断成 text，赋给枚举列直接报
--   "column status is of type todo_status but expression is of type text"。
--    改这个函数前先读 0021 的头注释。

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

  -- 打卡型目标必须先打满。没有这道门槛，立完当天点一下「完成」就白拿 stake。
  if g.check_total is not null and g.check_done < g.check_total then
    raise exception '还没打满：% / % 次', g.check_done, g.check_total;
  end if;

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

  insert into records(user_id, archive_id, type, goal_id, goal_content, amount)
    values (g.user_id, g.archive_id, 'done', g.id, g.content, g.stake);

  -- 奖励是从愿望单挑的 → 当场兑现（划掉）
  if g.reward_wish_id is not null then
    update wishes set status = 'done', done_at = now(), done_archive_id = g.archive_id
      where id = g.reward_wish_id and status = 'open';
  end if;

  -- 目标是从待办挑的 → 扣掉一格；扣完这条待办就用完了
  if g.todo_id is not null then
    update todos set times_left = greatest(0, times_left - 1) where id = g.todo_id;
    update todos
      set status = case when times_left = 0 then 'done'::todo_status else 'open'::todo_status end,
          done_at = case when times_left = 0 then now()::timestamptz else null::timestamptz end,
          taken_at = null
      where id = g.todo_id;
  end if;

  return g.stake;
end $$;

grant execute on function complete_goal(uuid) to authenticated;


-- 4b. 到点判负

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

    -- 注：原来这里还会在句尾拼「 · 已退回待办」（v_n > 0 时）。
    -- 那句没了 —— 动态只存数据，句子由前端出。要不要把"已退回待办"也做成
    -- 结构化字段（加一列 boolean）等用户说，现在这个信息只在库里不体现了。
    insert into records(user_id, archive_id, type, goal_id, goal_content, amount)
      values (p_user_id, g.archive_id, 'failed', g.id, g.content, -g.stake);
  end loop;
end $$;

grant execute on function settle_goals(uuid) to authenticated;


-- 4c. 主动放弃

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

  insert into records(user_id, archive_id, type, goal_id, goal_content, amount)
    values (g.user_id, g.archive_id, 'failed', g.id, g.content, -g.stake);

  return jsonb_build_object('lost', g.stake, 'returned', v_returned);
end $$;

grant execute on function giveup_goal(uuid) to authenticated;


-- 4d. 封档
--
-- v_name 不再需要了（句子由前端拼，存档名前端自己查），所以连查询一起收掉。

create or replace function seal_archive(p_archive_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_has_pending boolean;
  v_vitality integer;
  v_penalty integer;
  claimed uuid;
begin
  select user_id into v_user_id from archives where id = p_archive_id;
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

  -- amount = 0 表示"全部完成、免费"（v_penalty 本来就是 ≤ 0）
  insert into records(user_id, archive_id, type, amount)
    values (v_user_id, p_archive_id, 'sealed', v_penalty);

  return v_penalty;
end $$;

grant execute on function seal_archive(uuid) to authenticated;


-- ---------- 5. 最后才 drop text ----------

alter table records drop column if exists text;
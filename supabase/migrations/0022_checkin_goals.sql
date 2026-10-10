-- ============================================================
-- 0022: 打卡型目标（长期目标）
--
-- 要解决的事：现在所有目标都是"一锤子"—— 到死线必结算（达成 / 判负）。
-- 表达不了"连续 90 天背单词、打卡 60 次"这类长期目标。
--
-- 做法（**只加 3 列，不动任何现有表结构**）：
--   · check_total     —— 总共要打几次。**null = 不是打卡目标**
--   · check_done      —— 已经打了几次
--   · last_check_on   —— 最后一次打卡是哪天（一天只能打一次）
--
-- 用 `check_total is null` 当开关，而不是加一个 kind 枚举：
-- 现有目标的这一列天然是 null，行为一字不变，迁移零风险。
--
-- 结算语义（**保持"死线必判"这条铁律不改**）：
--   · 打满 → 当场自动结算（+stake、奖励兑现、待办扣格，全复用 complete_goal）
--   · 到死线没打满 → 走现有的 settle_goals，照旧判负扣 stake
--   · 没打满不许手点「完成」—— 否则立完当天就能点完成、白拿 stake
--
-- ⚠️ 时区：一天只能打一次，用的是**北京时间的"今天"**。
--   current_date 是服务器 UTC 的日期，北京时间早上 7 点还算前一天，
--   会导致同一个北京日能打两次。所以统一用
--   (now() at time zone 'Asia/Shanghai')::date。
--
-- ⚠️ 迁移必须手动在 Supabase 里跑（同 0020 / 0021）。
-- ============================================================


-- ---------- 1. 加列 ----------

alter table goals
  add column if not exists check_total    integer,
  add column if not exists check_done     integer not null default 0,
  add column if not exists last_check_on  date;

comment on column goals.check_total is
  '打卡型目标的格子总数；null = 普通的一次性目标（现有全部目标都是 null）';
comment on column goals.check_done is '已打卡次数（上限 check_total）';
comment on column goals.last_check_on is '最后一次打卡的北京日期，用于一天只能打一次';

-- 约束：不是打卡目标就必须三列都干净；是打卡目标就必须 0 ≤ done ≤ total
alter table goals drop constraint if exists goals_check_chk;
alter table goals add constraint goals_check_chk check (
  (check_total is null and check_done = 0 and last_check_on is null)
  or (check_total is not null and check_total > 0 and check_done >= 0 and check_done <= check_total)
);


-- ---------- 2. 打卡 ----------
-- 唯一入口。认领式条件更新（同 0019 的教训）：把"还在跑 + 没到点 + 是打卡目标 +
-- 没打满 + 今天还没打"全部写进 where，靠 returning 判断有没有抢到。
-- 边界情况逐条 raise，好让客户端把原因原样显示出来，不用猜。

create or replace function check_in_goal(p_goal_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g goals%rowtype;
  claimed uuid;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select * into g from goals where id = p_goal_id;
  if g.id is null then raise exception '目标不存在'; end if;
  if g.user_id <> auth.uid() then raise exception '只能操作自己的目标'; end if;

  -- 先把过点的账结掉：过了死线的目标不该还能打卡
  perform settle_goals(g.user_id);

  claimed := null;
  update goals
    set check_done = check_done + 1,
        last_check_on = v_today
    where id = p_goal_id
      and status = 'active'
      and due_at > now()
      and check_total is not null
      and check_done < check_total
      and (last_check_on is null or last_check_on < v_today)
    returning id into claimed;

  if claimed is null then
    -- 没抢到，回去看是哪种情况，原样告诉用户
    select * into g from goals where id = p_goal_id;
    if g.status <> 'active' then raise exception '这个目标已经结清了'; end if;
    if g.check_total is null then raise exception '这不是打卡型目标'; end if;
    if g.check_done >= g.check_total then raise exception '已经打满了'; end if;
    raise exception '今天已经打过卡了';
  end if;

  select * into g from goals where id = p_goal_id;

  -- 打满就当场结算。复用 complete_goal —— 加分 / 奖励兑现 / 扣待办一格都归它管。
  -- 不自动结算的话，"打满格却忘了点完成，到点反而被判负"就是个坑。
  if g.check_done >= g.check_total then
    perform complete_goal(p_goal_id);
    return jsonb_build_object('done', g.check_done, 'total', g.check_total, 'completed', true);
  end if;

  return jsonb_build_object('done', g.check_done, 'total', g.check_total, 'completed', false);
end $$;

grant execute on function check_in_goal(uuid) to authenticated;


-- ---------- 3. complete_goal 加"打满才许结"的门槛 ----------
--
-- ⚠️⚠️ 这里整段重写了 0021 修好的 complete_goal。
--   0021 的 ::todo_status 修复**必须原样保留**（下面三处 case 的显式转换），
--   否则那个 "column status is of type todo_status but expression is of type text"
--   的 bug 会被这次重写带回来。改这个函数前先读 0021 的头注释。
--   相对 0021 只多了开头那段打卡门槛，其余一字未动。

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

  -- 打卡型目标必须先打满。没有这道门槛，立完当天点一下「完成」就白拿 stake，
  -- 「打几次」这个承诺等于形同虚设。
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

  insert into records(user_id, archive_id, type, text)
    values (g.user_id, g.archive_id, 'done',
      '完成了「' || g.content || '」 · +' || g.stake || ' 活力值');

  -- 奖励是从愿望单挑的 → 当场兑现（划掉）
  if g.reward_wish_id is not null then
    update wishes set status = 'done', done_at = now(), done_archive_id = g.archive_id
      where id = g.reward_wish_id and status = 'open';
  end if;

  -- 目标是从待办挑的 → 扣掉一格；扣完这条待办就用完了
  --
  -- 三处 case 都要显式 ::todo_status —— 少了它 CASE 会被推断成 text，
  -- 赋值给枚举列直接报错（0021 修的就是这个）。
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
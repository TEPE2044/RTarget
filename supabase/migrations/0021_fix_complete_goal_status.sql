-- ============================================================
-- 0021: 修 complete_goal 里 todo_status 的类型推断
--
-- 症状（2026-10-10 用测试号实测发现）：
--   「从待办立项的目标」点「完成」时，RPC 直接报
--     column "status" is of type todo_status but expression is of type text
--   目标留在进行中，活力值不加、待办次数也不扣 —— 等于这条路径整个跑不通。
--
-- 根因：`set status = case when times_left = 0 then 'done' else 'open' end`
--   CASE 里两个分支都是**无类型字面量**，CASE 表达式整体被推断成 text，
--   而 todos.status 是 todo_status 枚举 —— 没有隐式转换，于是报错。
--   （其它地方写的是 `set status = 'done'`，单个字面量会被 Postgres 正常
--     强转成枚举，所以只有这一处踩雷。）
--
-- 修法：给两个分支加显式类型转换。函数其余部分与 0020 完全一致，一字未改。
--
-- ⚠️ 迁移必须手动在 Supabase 里跑（跟 0020 一样）。
-- ============================================================

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
  --
  -- 这里的三处 case 都要显式 ::todo_status —— 少了它 CASE 会被推断成 text，
  -- 赋值给枚举列直接报错（就是 0021 要修的那个 bug）。done_at 那处同理给
  -- timestamptz，免得又踩一次隐式推断。
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
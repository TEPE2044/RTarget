-- ============================================================
-- 0010: 惩罚复合体给独立时限 + settle_all 重写
--
-- 背景（用户报的"重大 bug"）：
--   此前 C 的 due_at 继承 A 的，A 一到死线判负时 C 的时限已经过期，
--   于是同一次 settle_all 里复合体直接走完"都没完成"；而"完成其一"
--   分支不关闭 C，C 永远停在 active、compound_a_done 又已写死，
--   结果两边按钮点了没反应、流程不结束，只能点放弃。
--
-- 本迁移：
--   1) C 起用独立死线（由前端写入，晚于 A），复合体窗口由此成立
--   2) settle_all 重写：复合体在「C 到期」或「A/C 双完成」时结算
--   3) 结算时把 C 一并收口为 settled（终态），A 写 compound_a_done/compound_c_done
--   4) 存量修复：把历史遗留卡在 active 的 C 收口、给旧 C 补补做窗口
-- ============================================================


-- ---------- 存量修复 1：复合体已结算、C 却还挂在 active ----------
-- 这类行就是"点了没反应"的元凶。只改状态，不动分数。
update nodes c
  set status = 'settled'
from nodes a
where c.parent_id = a.id
  and c.kind = 'C'
  and c.status = 'active'
  and a.kind = 'A'
  and a.compound_a_done is not null;


-- ---------- 存量修复 2：旧 C 没有独立死线，补一个补做窗口 ----------
-- 只动还没进复合体、且死线不晚于父 A 的 C（bound/active），往后顺延 3 天。
-- 默认值仅供存量数据兜底，新建目标一律由用户自己填 C 的死线。
update nodes c
  set due_at = a.due_at + interval '3 days'
from nodes a
where c.parent_id = a.id
  and c.kind = 'C'
  and c.status in ('bound', 'active')
  and c.due_at <= a.due_at + interval '1 day';


-- ---------- settle_all 重写（v3）----------
create or replace function settle_all(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n record;
begin
  -- 1) A 到期未申报 → 判负
  --    立刻扣 A 分；开启 C 并扣 C 分。
  --    C 此时拿到的是自己的死线（晚于 A），所以不会马上被结算。
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'active' and due_at < now()
  loop
    -- 状态先推进再记账，保证重复调用不重复扣分
    update nodes set status = 'settled' where id = n.id;   -- completed_at 保持 NULL

    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      values (p_user_id, n.id, n.archive_id, 'a_failed', -n.stake);

    -- 只给"本次刚开启"的 C 记账（CTE 兜住幂等，避免重复扣 C 分）
    with opened as (
      update nodes set status = 'active'
        where parent_id = n.id and kind = 'C' and status = 'bound'
        returning id, archive_id, stake
    )
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      select p_user_id, id, archive_id, 'c_entered', -stake from opened;
  end loop;

  -- 2) 复合体结算
  --    触发条件二选一：
  --      a) C 到期（含用户主动放弃——前端把 due_at 推到过去）
  --      b) A、C 双完成 → 提前了结，立刻返还
  for n in
    select a.id as a_id, a.archive_id as a_archive, a.stake as a_stake,
           a.completed_at as a_completed,
           c.id as c_id, c.stake as c_stake, c.completed_at as c_completed
    from nodes a
    join nodes c on c.parent_id = a.id and c.kind = 'C'
    where a.user_id = p_user_id
      and a.kind = 'A'
      and a.status = 'settled'
      and a.compound_a_done is null
      and c.status in ('active', 'settled')
      and (
        (c.status = 'active' and c.due_at < now())
        or (a.completed_at is not null and c.completed_at is not null)
      )
  loop
    declare
      a_done boolean := (n.a_completed is not null);
      c_done boolean := (n.c_completed is not null);
    begin
      update nodes
        set compound_a_done = a_done, compound_c_done = c_done
        where id = n.a_id;

      -- C 一律收口为终态：这是修掉"按钮点了没反应"的关键
      update nodes set status = 'settled' where id = n.c_id;

      if not a_done and not c_done then
        -- 都没做：再扣 A + C（第三次扣，叠加）
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.a_id, n.a_archive, 'compound_fail', -(n.a_stake + n.c_stake));
      elsif a_done and c_done then
        -- 都做完：返还 A + C（把复合体时扣掉的那笔还回来）
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.a_id, n.a_archive, 'compound_redeem', (n.a_stake + n.c_stake));
      end if;
      -- 只完成其一：无分变动（已扣的不追缴、不返还）
    end;
  end loop;
end $$;

grant execute on function settle_all(uuid) to authenticated;

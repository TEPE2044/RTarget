-- ============================================================
-- 0009: 需求变更——B 生命周期 + 档位继承
-- 1) B 无时限：删除 settle_all 里 "B 过期作废" 分支（B 的 due_at 无意义）
-- 2) 档位继承由前端保证（B/C 直接写 A 的 tier/stake），后端无 schema 变更
-- 3) 存量数据修复：B/C 的 tier/stake 对齐其父 A（老数据可能不一致）
-- ============================================================

-- 存量修复：B/C 继承 A 的 tier 和 stake
update nodes child
  set tier = parent.tier, stake = parent.stake
from nodes parent
where child.parent_id = parent.id
  and child.kind in ('B', 'C')
  and (child.tier <> parent.tier or child.stake <> parent.stake);

-- 重建 settle_all：删除 B 过期分支
create or replace function settle_all(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n record;
begin
  -- A 超时/认输 → 立刻扣 A 分（compound_a_done 保持 NULL = 复合体未结算）
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'active' and due_at < now()
  loop
    update nodes set status = 'settled'
      where id = n.id;
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      values (p_user_id, n.id, n.archive_id, 'a_failed', -n.stake);
    -- 开启 C 并扣 C 分
    update nodes set status = 'active'
      where parent_id = n.id and kind = 'C' and status = 'bound';
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      select p_user_id, id, archive_id, 'c_entered', -stake
      from nodes where parent_id = n.id and kind = 'C' and status = 'active';
  end loop;

  -- 复合体结算
  -- 触发条件：C 超时/认输（active 且 due_at < now），或 A+C 双完成提前了结
  for n in
    select a.*, c.id as c_id, c.status as c_status,
           c.due_at as c_due_at, c.completed_at as c_completed_at,
           c.stake as c_stake
    from nodes a
    join nodes c on c.parent_id = a.id and c.kind = 'C'
    where a.user_id = p_user_id and a.kind = 'A'
      and a.status = 'settled' and a.compound_a_done is null
      and (
        (c.status = 'active' and c.due_at < now())
        or (c.status = 'settled' and c.completed_at is not null
            and a.completed_at is not null)
      )
  loop
    declare
      a_done boolean;
      c_done boolean;
    begin
      a_done := (n.completed_at is not null);
      c_done := (n.c_status = 'settled' and n.c_completed_at is not null);

      update nodes set compound_a_done = a_done, compound_c_done = c_done
        where id = n.id;

      if not a_done and not c_done then
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_fail', -(n.stake + n.c_stake));
        update nodes set status = 'settled' where id = n.c_id and status = 'active';
      elsif a_done and c_done then
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_redeem', (n.stake + n.c_stake));
        update nodes set status = 'settled' where id = n.c_id and status = 'active';
      end if;
    end;
  end loop;
end $$;

grant execute on function settle_all(uuid) to authenticated;

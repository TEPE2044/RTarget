-- ============================================================
-- 0005: 修复复合体永不结算的 bug
-- 根因：settle_all 第 2 步把 compound_a_done 预填为 false，
--       而第 4 步要求 compound_a_done IS NULL 才结算——永假。
-- 修复：
--   1) compound_a_done 语义统一：NULL = 复合体未结算（判负时不预填）
--   2) 复合体结算时机改为看 C 的状态：
--      - C active 且超时/认输（due_at < now）→ 结算（C 判负分支）
--      - C 已完成 且 A 已补完 → 结算（双完成返还分支）
--      - 否则等待（复合体进行中）
--   3) 修复存量脏数据：卡死的复合体重置回 NULL
-- ============================================================

-- ---------- 先修脏数据 ----------
-- A 判负时 compound_a_done 被错误预填 false、但 C 还 active（复合体卡死）→ 重置
update nodes a
  set compound_a_done = null, compound_c_done = null
where a.kind = 'A' and a.status = 'settled'
  and a.compound_a_done is not null
  and exists (
    select 1 from nodes c
    where c.parent_id = a.id and c.kind = 'C' and c.status = 'active'
  );

-- ---------- 重建 settle_all ----------
create or replace function settle_all(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n record;
begin
  -- 1) B 过期作废（奖励资格过期，不罚，分支结束）
  update nodes
    set status = 'settled', completed_at = now()
  where user_id = p_user_id and kind = 'B' and status = 'active' and due_at < now();

  -- 2) A 超时/认输 → 立刻扣 A 分（compound_a_done 保持 NULL = 复合体未结算）
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'active' and due_at < now()
  loop
    update nodes set status = 'settled'
      where id = n.id;
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      values (p_user_id, n.id, n.archive_id, 'a_failed', -n.stake);
    -- 3) 开启 C 并扣 C 分
    update nodes set status = 'active'
      where parent_id = n.id and kind = 'C' and status = 'bound';
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      select p_user_id, id, archive_id, 'c_entered', -stake
      from nodes where parent_id = n.id and kind = 'C' and status = 'active';
  end loop;

  -- 4) 复合体结算
  --    触发条件（满足其一）：
  --    a. C 超时/认输（active 且 due_at < now）→ C 判负，按 A/C 各自完成情况结算
  --    b. C 已完成 且 A 已补完 → 双完成，返还
  for n in
    select a.*, c.id as c_id, c.status as c_status,
           c.due_at as c_due_at, c.completed_at as c_completed_at,
           c.stake as c_stake
    from nodes a
    join nodes c on c.parent_id = a.id and c.kind = 'C'
    where a.user_id = p_user_id and a.kind = 'A'
      and a.status = 'settled' and a.compound_a_done is null
      and (
        (c.status = 'active' and c.due_at < now())          -- C 判负
        or (c.status = 'settled' and c.completed_at is not null
            and a.completed_at is not null)                  -- 双完成提前了结
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
        -- 双未完成：再扣 A + C
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_fail', -(n.stake + n.c_stake));
        update nodes set status = 'settled' where id = n.c_id and status = 'active';
      elsif a_done and c_done then
        -- 双完成：返还 A + C
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_redeem', (n.stake + n.c_stake));
        update nodes set status = 'settled' where id = n.c_id and status = 'active';
      end if;
      -- 完成其一：无分变动，但复合体已结算关闭
    end;
  end loop;
end $$;

grant execute on function settle_all(uuid) to authenticated;

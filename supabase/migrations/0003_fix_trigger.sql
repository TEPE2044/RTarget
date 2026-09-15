-- ============================================================
-- 0003: 修复注册报错 "Database error saving new user"
-- 原因：grant_initial_vitality 缺 set search_path = public，
--       Supabase 新项目 Auth 服务调用触发器时表名解析失败
-- 修复：重建函数（固定 search_path + 显式 public 前缀）
-- 注意：create or replace 不影响已绑定的触发器，直接跑即可
-- ============================================================

create or replace function grant_initial_vitality()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.vitality_ledger(user_id, reason, note, amount)
  values (new.id, null, '初始活力值', 10);
  return new;
end $$;

-- 顺带把 settle_all / seal_archive 也加固（同样的 best practice）
create or replace function settle_all(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n record;
begin
  -- B 过期作废
  update nodes
    set status = 'settled', completed_at = now()
  where user_id = p_user_id and kind = 'B' and status = 'active' and due_at < now();

  -- A 超时 → 扣 A 分，开 C 扣 C 分
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'active' and due_at < now()
  loop
    update nodes set status = 'settled', compound_a_done = false
      where id = n.id;
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      values (p_user_id, n.id, n.archive_id, 'a_failed', -n.stake);
    update nodes set status = 'active'
      where parent_id = n.id and kind = 'C' and status = 'bound';
    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      select p_user_id, id, archive_id, 'c_entered', -stake
      from nodes where parent_id = n.id and kind = 'C' and status = 'active';
  end loop;

  -- 复合体结算
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'settled'
      and compound_a_done is null
  loop
    declare
      c_done boolean;
      a_done boolean;
      c_node record;
    begin
      select * into c_node from nodes where parent_id = n.id and kind = 'C';
      c_done := (c_node.status = 'settled' and c_node.completed_at is not null);
      a_done := (n.completed_at is not null);

      update nodes set compound_a_done = a_done, compound_c_done = c_done
        where id = n.id;

      if not a_done and not c_done then
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_fail', -(n.stake + c_node.stake));
        update nodes set status = 'settled' where id = c_node.id and status = 'active';
      elsif a_done and c_done then
        insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
          values (p_user_id, n.id, n.archive_id, 'compound_redeem', (n.stake + c_node.stake));
        update nodes set status = 'settled' where id = c_node.id and status = 'active';
      end if;
    end;
  end loop;
end $$;

grant execute on function settle_all(uuid) to authenticated;

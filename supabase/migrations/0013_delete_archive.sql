-- ============================================================
-- 0013: 删除已封档的存档
--
-- 为什么必须走函数、不能前端直接 delete：
--   nodes.archive_id 是 on delete cascade（会跟着删），
--   但 vitality_ledger.archive_id 和 .node_id 两个外键都**没有 on delete 动作**
--   （默认 NO ACTION）→ 直接删 archives 会撞外键报错。
--
-- 设计取舍：只删记录，不动分数
--   流水的 amount 一律不改，只把 archive_id / node_id 置空（断开关联）。
--   理由：活力值是全局账本，"删历史"不该让扣掉的分回来 ——
--   否则「封档扣 10% → 把档删了」就成了刷分漏洞。
--   存档和节点删掉后，那几笔流水变成无归属的历史记录，分数不受影响。
--
-- 只能删已封档的存档；未封档的先封档再删。
--
-- 返回：解绑的流水笔数（给前端做提示用）。
-- ============================================================

create or replace function delete_archive(p_archive_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_status archive_status;
  v_detached integer;
begin
  select user_id, status into v_user_id, v_status
  from archives where id = p_archive_id;

  if v_user_id is null then raise exception '存档不存在'; end if;
  if v_user_id <> auth.uid() then raise exception '只能删自己的存档'; end if;
  if v_status <> 'sealed' then
    raise exception '只能删除已封档的存档，未封档的请先封档';
  end if;

  -- 1) 断开流水与本档的关联（金额一个都不改）
  update vitality_ledger l
     set archive_id = null,
         node_id = null
   where l.archive_id = p_archive_id
      or l.node_id in (select n.id from nodes n where n.archive_id = p_archive_id);
  get diagnostics v_detached = row_count;

  -- 2) 删节点：先删 B/C 再删 A。
  --    nodes.parent_id 是自引用外键（也没有 on delete 动作），
  --    分两步走就不用去赌级联删除时的外键检查顺序。
  delete from nodes where archive_id = p_archive_id and parent_id is not null;
  delete from nodes where archive_id = p_archive_id;

  -- 3) 删存档
  delete from archives where id = p_archive_id;

  return v_detached;
end $$;

grant execute on function delete_archive(uuid) to authenticated;

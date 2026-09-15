-- ============================================================
-- 0006: 文档 v1.0 订正
-- 1) 封档扣分四舍五入取整（不要小数点）
-- 2) 由于结算粒度改为"日"（0点），settle_all 逻辑不变——
--    due_at 本身就是 0 点时间戳，due_at < now() 语义自然成立
-- 3) 顺带：删除 B 过期作废死代码分支（B 已改为 A 达成立刻加分，
--    不存在 active 状态的 B 了）
-- ============================================================

create or replace function seal_archive(p_archive_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_has_pending boolean;
  v_vitality numeric;
  v_penalty numeric;
begin
  select user_id into v_user_id from archives where id = p_archive_id;
  if v_user_id is null then raise exception '存档不存在'; end if;
  if v_user_id <> auth.uid() then raise exception '只能封自己的存档'; end if;

  if exists (select 1 from archives where id = p_archive_id and status = 'sealed') then
    return 0;
  end if;

  perform settle_all(v_user_id);

  select exists(
    select 1 from nodes where archive_id = p_archive_id and status = 'active'
  ) into v_has_pending;

  select coalesce(sum(amount), 0) into v_vitality
  from vitality_ledger where user_id = v_user_id;

  if v_has_pending then
    -- 四舍五入取整（文档 v1.0：不要小数点）
    v_penalty := -round(coalesce(v_vitality, 0) * 0.10);
    insert into vitality_ledger(user_id, archive_id, reason, note, amount)
      values (v_user_id, p_archive_id, null, '封档：未了结之事存档，扣 10% 活力值', v_penalty);
  else
    v_penalty := 0;
    update archives set sealed_free = true where id = p_archive_id;
  end if;

  update archives set status = 'sealed', sealed_at = now() where id = p_archive_id;
  return v_penalty;
end $$;

grant execute on function seal_archive(uuid) to authenticated;

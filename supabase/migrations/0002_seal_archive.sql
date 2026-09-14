-- ============================================================
-- 0002: 封档结算（补全存档生命周期最后一块）
-- 规则：有未了结之事 → 扣当前活力值 10%；全部走向奖励分支 → 免费
-- ============================================================

-- 封档函数：幂等（已封档直接返回），RLS 下只能封自己的档
create function seal_archive(p_archive_id uuid)
returns numeric language plpgsql security definer as $$
declare
  v_user_id uuid;
  v_has_pending boolean;
  v_vitality numeric;
  v_penalty numeric;
begin
  select user_id into v_user_id from archives where id = p_archive_id;
  if v_user_id is null then
    raise exception '存档不存在';
  end if;
  if v_user_id <> auth.uid() then
    raise exception '只能封自己的存档';
  end if;

  -- 已封档：幂等返回
  if exists (select 1 from archives where id = p_archive_id and status = 'sealed') then
    return 0;
  end if;

  -- 先惰性结算一遍（把到点的账都结了，再判断存档状态）
  perform settle_all(v_user_id);

  -- 判定：该存档是否还有未了结之事（任何 active 节点）
  select exists(
    select 1 from nodes
    where archive_id = p_archive_id and status = 'active'
  ) into v_has_pending;

  select coalesce(sum(amount), 0) into v_vitality
  from vitality_ledger where user_id = v_user_id;

  if v_has_pending then
    -- 有未了结之事：扣当前活力值 10%（四舍五入到 2 位小数）
    v_penalty := -round(coalesce(v_vitality, 0) * 0.10, 2);
    insert into vitality_ledger(user_id, archive_id, reason, note, amount)
      values (v_user_id, p_archive_id, null, '封档：未了结之事存档，扣 10% 活力值', v_penalty);
  else
    v_penalty := 0;
    update archives set sealed_free = true where id = p_archive_id;
  end if;

  update archives
    set status = 'sealed', sealed_at = now()
    where id = p_archive_id;

  return v_penalty; -- 返回扣分（负数）或 0
end $$;

grant execute on function seal_archive(uuid) to authenticated;

-- settle_all 也补上执行授权（0001 漏了，客户端 rpc 需要）
grant execute on function settle_all(uuid) to authenticated;

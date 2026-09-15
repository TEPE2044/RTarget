-- ============================================================
-- 0011: 封档判定修正 —— B 待确认不算「未了结之事」
--
-- 问题：seal_archive 判断存档是否"干净"用的是 status = 'active'，
--       但 B（奖励）在 A 达成后会变成 active 并立刻加分，等你点「确认」。
--       只要没点确认，封档就会被当成"有未了结之事"，白扣当前活力值的 10%。
--
-- 与机制不符：mechanism.md 明确写了
--   「奖励过期不罚：奖励是资格不是义务」
--   「存档内全部走向奖励分支 → 封档免费」
--   B 的分早已到账、无时限、无罚则，不该计入未了结。
--
-- 修法：判定时排除 B —— 只有 A（押注未决）和 C（惩罚未了结）才算未了结。
-- 返回类型不变（integer），所以直接 create or replace。
-- ============================================================

create or replace function seal_archive(p_archive_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_has_pending boolean;
  v_vitality numeric;
  v_penalty integer;
begin
  select user_id into v_user_id from archives where id = p_archive_id;
  if v_user_id is null then raise exception '存档不存在'; end if;
  if v_user_id <> auth.uid() then raise exception '只能封自己的存档'; end if;

  if exists (select 1 from archives where id = p_archive_id and status = 'sealed') then
    return 0;
  end if;

  perform settle_all(v_user_id);

  -- 未了结 = 还有未决的押注 A，或未了结的惩罚 C。
  -- B 一律不算：分已到账、无时限、无罚则（奖励是资格不是义务）。
  select exists(
    select 1 from nodes
    where archive_id = p_archive_id
      and status = 'active'
      and kind <> 'B'
  ) into v_has_pending;

  select coalesce(sum(amount), 0) into v_vitality
  from vitality_ledger where user_id = v_user_id;

  if v_has_pending then
    v_penalty := -round(coalesce(v_vitality, 0) * 0.10)::int;
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

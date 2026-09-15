-- ============================================================
-- 0007: 活力值强制整数（文档 v1.0：四舍五入，不要小数点）
-- 1) 先删物化视图 vitality_current（它依赖 amount 列，挡住 ALTER）
-- 2) 列类型 numeric → integer（存量数据四舍五入迁移）
-- 3) 重建物化视图
-- 4) 封档函数同步取整版重建
-- ============================================================

drop materialized view if exists vitality_current;

-- 存量小数四舍五入
update vitality_ledger set amount = round(amount) where amount <> round(amount);

-- 改列类型
alter table vitality_ledger alter column amount type integer using round(amount)::int;

-- 重建物化视图
create materialized view vitality_current as
  select user_id, sum(amount) as vitality
  from vitality_ledger
  group by user_id;

-- 封档函数（返回 integer，扣分取整）
-- 返回类型从 numeric 改 integer，必须先 drop 旧函数
drop function if exists seal_archive(uuid);
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

  select exists(
    select 1 from nodes where archive_id = p_archive_id and status = 'active'
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

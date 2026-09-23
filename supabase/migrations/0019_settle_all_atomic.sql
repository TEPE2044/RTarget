-- ============================================================
-- 0019: settle_all 改成「认领式」—— 并发下不会重复记账
--
-- 背景（Jackie 报的刷分漏洞）：
--   「完成按钮没有防抖！只要我点多几次就能获得更多分数」
--
--   根因是 check-then-act：先 SELECT 读出节点状态、在内存里判断，
--   再无条件 UPDATE + INSERT 记账。并发（连点两下）时两个请求都会读到
--   `status='active'`、都通过判断，然后**各插一条流水** —— 分就多加一份。
--
--   前端已经改成"条件更新 + 影响 0 行就收工"（`claimNode`），
--   但 `settle_all` 是**服务端函数**，它的重复记账前端管不着：
--   连点「放弃」或「补做完成」会并发触发两次结算 → 可能重复扣分，
--   也可能**重复返还**（后者就是刷分）。
--
-- 改法：两处「状态推进 + 记账」都变成认领式 ——
--     update ... where <还处在旧状态> returning id into claimed;
--     if claimed is null then continue; end if;
-- Postgres 的行锁保证并发时只有一个能抢到；第二个请求等锁后重新评估 WHERE，
-- 发现状态已经变了 → 拿 0 行 → 直接跳过，不记账。
--
-- ⚠️ `update ... returning ... into` 在**影响 0 行时不会清空变量**，
--    所以每轮循环开头都要先把 claimed 置空，不能靠"这轮一定会写进去"。
--
-- 【这个迁移跑不跑的区别】
--   不跑也能用（0010 已经有 settle_all，签名没变），只是「连点放弃 / 连点补做完成」
--   仍存在很窄的并发窗口。**建议跑**，跑完这一类问题就彻底关掉了。
-- ============================================================


create or replace function settle_all(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n record;
  claimed uuid;
begin
  -- 1) A 到期未申报 → 判负：立刻扣 A 分；开启 C 并扣 C 分。
  --    C 拿的是自己的死线（晚于 A），所以不会马上被结算。
  for n in
    select * from nodes
    where user_id = p_user_id and kind = 'A' and status = 'active' and due_at < now()
  loop
    claimed := null;
    -- 认领：抢不到说明另一个请求已经在处理这一条了
    update nodes set status = 'settled'
      where id = n.id and status = 'active'
      returning id into claimed;
    if claimed is null then continue; end if;

    insert into vitality_ledger(user_id, node_id, archive_id, reason, amount)
      values (p_user_id, n.id, n.archive_id, 'a_failed', -n.stake);

    -- 只给"本次刚开启"的 C 记账（CTE 的 returning 兜住幂等）
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
  --      a) C 到期（含用户主动放弃 —— 前端把 due_at 推到过去）
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
      claimed := null;
      -- 认领：compound_a_done 从 null 变有值，只有抢到的那个请求负责记账
      update nodes
        set compound_a_done = a_done, compound_c_done = c_done
        where id = n.a_id and compound_a_done is null
        returning id into claimed;
      if claimed is null then continue; end if;

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


-- ============================================================
-- 顺带：seal_archive 也是同一类问题（连点「封档」会重复扣 10%）
--
-- 原实现：先 `if exists (status='sealed') then return 0` 判断，再**无条件**
-- 记账、最后改 status —— 并发时两个请求都读到 open，于是**各扣一次 10%**。
--
-- 改法：把「改 status」提到记账**之前**，并让它当认领 ——
-- 抢不到说明别人已经在封这个档了，直接 return 0、不记账。
-- （顺序不能反：先记账再改状态的话，并发时两边都已经把钱扣了才发现抢不到。）
--
-- 判定逻辑本身没动（B 待确认不算未了结，见 0011）。
-- ============================================================

create or replace function seal_archive(p_archive_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_has_pending boolean;
  v_vitality numeric;
  v_penalty integer;
  claimed uuid;
begin
  select user_id into v_user_id from archives where id = p_archive_id;
  if v_user_id is null then raise exception '存档不存在'; end if;
  if v_user_id <> auth.uid() then raise exception '只能封自己的存档'; end if;

  -- 提前告知（省一次写）：已经封过了
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

  -- ★ 认领：open → sealed，抢不到就是并发重复提交，直接收工
  claimed := null;
  update archives set status = 'sealed', sealed_at = now()
    where id = p_archive_id and status = 'open'
    returning id into claimed;
  if claimed is null then return 0; end if;

  if v_has_pending then
    v_penalty := -round(coalesce(v_vitality, 0) * 0.10)::int;
    insert into vitality_ledger(user_id, archive_id, reason, note, amount)
      values (v_user_id, p_archive_id, null, '封档：未了结之事存档，扣 10% 活力值', v_penalty);
  else
    v_penalty := 0;
    update archives set sealed_free = true where id = p_archive_id;
  end if;

  return v_penalty;
end $$;

grant execute on function seal_archive(uuid) to authenticated;

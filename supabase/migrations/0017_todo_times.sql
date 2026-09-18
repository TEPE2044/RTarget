-- ============================================================
-- 0017: 目标单的「次数」（电量格）
--
-- 需求（Jackie）：
--   建待办的时候可以设次数，默认 1。
--   「加入到目标的时候，如果最终这个目标完成了，TODOLIST 的目标次数会扣一格」
--   —— 扣完这条待办就算用完。
--
-- 位置很关键：**次数属于待办，不属于目标 A**。
--   它跟押注系统完全无关，只是个计数器 —— 所以 A/B/C 的机制一个字都不用改，
--   settle_all 也不用动。
--
-- 流转：
--   建待办 times=5（left=5）
--     → 立项：taken（移出清单），**格子不动**（还没做完不算）
--     → 目标 A 完成 ✓ → left=4，状态回到 open（清单里又能看到它，可以再立项）
--     → 再立项 … 直到 left=0 → 状态变 done（用完了）
--   目标 A 判负 / 放弃 → 不扣格（因为「最终没完成」），同样回到 open
-- ============================================================


alter table todos add column if not exists times_total integer not null default 1;
alter table todos add column if not exists times_left integer not null default 1;


-- 剩余不能为负，也不能超过总数。
-- 写成 do 块是为了幂等（迁移可能被重复跑）。
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'todos_times_chk') then
    alter table todos add constraint todos_times_chk
      check (times_left >= 0 and times_left <= times_total);
  end if;
end $$;


-- 存量数据不用回填：两列的 default 都是 1，老条目建出来就是"一次性的"，
-- 跟它们原本的行为完全一致。

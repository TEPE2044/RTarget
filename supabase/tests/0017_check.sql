-- ============================================================
-- 0017 自检：目标单的次数列有没有装好
--
-- 只读，**最后一条是 select** —— SQL Editor 只展示最后一条语句的结果，
-- 以 rollback 结尾会把输出全吞掉（只显示 No rows returned）。
-- 跑完应该看到一行四列。
-- ============================================================

select
  -- ① 两列都在吗
  (select count(*) = 2 from information_schema.columns
    where table_name = 'todos' and column_name in ('times_total', 'times_left'))
    as "① times_total / times_left 都在",

  -- ② 约束在吗（剩余不能为负、不能超总数）
  exists (select 1 from pg_constraint where conname = 'todos_times_chk')
    as "② 约束 todos_times_chk 在",

  -- ③ 有多少条是"多次"的（新建的默认都是 1，所以这个数一开始应该是 0）
  (select count(*) from todos where times_total > 1)
    as "③ 多次待办条数",

  -- ④ 数据有没有不一致的（剩的比总数还多 = 出问题了）
  (select count(*) from todos where times_left > times_total)
    as "④ 数据异常条数（应为 0）";

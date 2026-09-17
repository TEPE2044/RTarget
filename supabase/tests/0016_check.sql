-- ============================================================
-- 0016 自检（纯只读，跑完不留任何数据）
--
-- 用法：整段复制到 Supabase SQL Editor 跑一次，结果直接出在下面的表格里。
--
-- ⚠ 写这类脚本的铁律：最后一条语句必须是 select。
--   SQL Editor 只展示**最后一条语句**的结果，以 rollback 结尾会把前面
--   所有输出吞掉，只剩一句 "Success. No rows returned"。
-- ============================================================

select
  exists(
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'todos'
  ) as "① todos 表已建",

  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nodes' and column_name = 'todo_id'
  ) as "② nodes.todo_id 已加",

  coalesce(
    (select relrowsecurity from pg_class
      where relname = 'todos' and relnamespace = 'public'::regnamespace),
    false
  ) as "③ 已开启 RLS",

  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'todos') as "④ 策略数（应为 1）",

  (select count(*) from todos) as "目标单总数",
  (select count(*) from todos where status = 'open') as "其中待办",
  (select count(*) from todos where status = 'done') as "其中已勾掉",
  (select count(*) from todos where status = 'taken') as "其中已立项（已移出清单）",

  (select count(*) from nodes where todo_id is not null) as "从目标单立的目标 A";

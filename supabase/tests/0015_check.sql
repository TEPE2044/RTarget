-- ============================================================
-- 0015 自检（纯只读，跑完不留任何数据）
--
-- 用法：整段复制到 Supabase SQL Editor 跑一次。
-- 结果直接出在下面的表格里。
--
-- ⚠ 写这类脚本的铁律：最后一条语句必须是 select。
--   SQL Editor 只展示**最后一条语句**的结果，以 rollback 结尾会把
--   前面所有输出吞掉，只剩一句 "Success. No rows returned"。
-- ============================================================

select
  exists(
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'wishes'
  ) as "① wishes 表已建",

  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nodes' and column_name = 'wish_id'
  ) as "② nodes.wish_id 已加",

  coalesce(
    (select relrowsecurity from pg_class
      where relname = 'wishes' and relnamespace = 'public'::regnamespace),
    false
  ) as "③ 已开启 RLS",

  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'wishes') as "④ 策略数（应为 1）",

  (select count(*) from wishes) as "愿望总数",
  (select count(*) from wishes where status = 'open') as "其中未实现",
  (select count(*) from wishes where status = 'done') as "其中已实现",

  (select count(*) from nodes where wish_id is not null) as "已关联愿望的奖励 B";

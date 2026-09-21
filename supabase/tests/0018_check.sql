-- 0018 自检：待办与目标的「备忘录」两列都在
--
-- 用法：Supabase SQL Editor 里整段跑。
-- 期望：**两行** —— todos.note / nodes.note，data_type 都是 text、
--       is_nullable = NO、column_default 是 ''
--
-- 注意（踩过的规则）：SQL Editor 只展示**最后一条语句**的结果，
-- 所以最后一句必须是 select，且**绝不能以 rollback 结尾**。

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and column_name = 'note'
  and table_name in ('todos', 'nodes')
order by table_name;

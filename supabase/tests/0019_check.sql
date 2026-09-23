-- 0019 自检：settle_all / seal_archive 是不是「认领式」的新版本
--
-- 用法：Supabase SQL Editor 里整段跑。
-- 期望：**两行**（settle_all、seal_archive），两个布尔列都是 true
--
-- 注意（踩过的规则）：SQL Editor 只展示**最后一条语句**的结果，
-- 所以最后一句必须是 select，且**绝不能以 rollback 结尾**。

select p.proname as "函数",
       position('returning id into claimed' in pg_get_functiondef(p.oid)) > 0 as "是认领式版本",
       position('claimed := null' in pg_get_functiondef(p.oid)) > 0 as "有重置认领标记"
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname in ('settle_all', 'seal_archive')
order by p.proname;

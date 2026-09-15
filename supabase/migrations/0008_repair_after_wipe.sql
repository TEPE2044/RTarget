-- ============================================================
-- 0008: 清数据后的修复
-- 用户清空了 vitality_ledger / nodes / archives 数据并删除了视图
-- 本迁移：重建视图 + 补回当前登录用户的初始活力值 10 分
-- ============================================================

-- 1) 重建物化视图
create materialized view if not exists vitality_current as
  select user_id, sum(amount) as vitality
  from vitality_ledger
  group by user_id;

-- 2) 给所有 Auth 用户补初始 10 分（谁没有流水就补谁）
insert into vitality_ledger(user_id, reason, note, amount)
select u.id, null, '初始活力值（清库补录）', 10
from auth.users u
where not exists (
  select 1 from vitality_ledger l where l.user_id = u.id
);

-- 3) 触发器仍在（建用户自动 +10），但确认一下没被顺带删掉：
--    如果下面查询返回 0 行，跑注释里那句重建
-- select count(*) from pg_trigger where tgname = 'on_auth_user_created';

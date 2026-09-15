-- ============================================================
-- 0004: user_id 列加默认值兜底（RLS 兜底）
-- 前端已显式传 user_id；本迁移保证即使某处漏传，insert 也不会因
-- not null 违反直接炸掉（默认 auth.uid() 后由 RLS with check 把关）
-- ============================================================

alter table archives        alter column user_id set default auth.uid();
alter table nodes           alter column user_id set default auth.uid();
alter table vitality_ledger alter column user_id set default auth.uid();

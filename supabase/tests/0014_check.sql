-- ============================================================
-- 0014 自检（只读）
--
-- 硬规则：Supabase SQL Editor 只展示**最后一条语句**的结果，
-- 所以这个脚本必须以 select 结尾，绝不加 rollback。
-- ============================================================

select
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_password') > 0
    as "① 找到 has_password 函数",

  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_password'
    limit 1)
    as "② 是 security definer",

  (select p.proconfig::text from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_password'
    limit 1)
    as "③ search_path 设置",

  -- 直接调一下，看能不能跑通（有会话时才返回 true/false，SQL Editor 里没有 JWT → false）
  has_password() as "④ 直接调用（SQL Editor 下应为 false）",

  (select count(*) from auth.users
    where encrypted_password is null or encrypted_password = '')
    as "⑤ 没有密码的账号数（走验证码时会要求设密码）",

  (select count(*) from auth.users) as "账号总数";

-- ============================================================
-- 0014：查当前账号设过密码没有
--
-- 为什么需要它：验证码登录现在要分两种情况
--   · 账号已经有密码 → 直接放行（这就是"验证码登录"）
--   · 账号没有密码（首次验证 / 只走验证码注册过）→ 才要求设密码
-- 之前一律要求设密码是错的：老用户每次用验证码登录都被逼着重设一遍。
--
-- 为什么必须用函数：密码是否存在只有 auth.users.encrypted_password 知道，
-- 而 auth schema 客户端读不到（RLS）。所以按本项目一贯的做法 ——
-- 用 security definer 函数开一个小口子，只回答"有/没有"这一个布尔，
-- 绝不把密码哈希本身暴露出去。
-- ============================================================

create or replace function has_password()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- auth.uid() 从请求的 JWT 里取当前用户，和 security definer 无关
  select coalesce(
    (
      select u.encrypted_password is not null
         and length(u.encrypted_password) > 0
        from auth.users u
       where u.id = auth.uid()
    ),
    false
  );
$$;

-- 只给登录用户调用：匿名（anon）拿不到任何信息
revoke all on function has_password() from public;
grant execute on function has_password() to authenticated;

comment on function has_password() is
  '当前登录用户是否设过密码。验证码登录用它决定"直接放行"还是"要求设密码"。';

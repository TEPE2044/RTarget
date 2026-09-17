-- ============================================================
-- 0015: 愿望单
--
-- 需求：奖励 B 不再每次现打字，可以从"愿望单"里挑一个。
--
-- 三条已定的规则：
--   1) 愿望单是**全局的**（跨存档共用）—— 你想要什么，不因为开了哪个档而变
--   2) 愿望被兑现后**标记为已实现**、不删除（保留记录），
--      选择列表里只列还没实现的
--   3) 奖励 B 既能从愿望单选，也能临时手输
--
-- 兑现时机 = A 达成那一刻。因为机制上 B 的加分就发生在那一瞬
-- （A 达成 → B 解锁并立刻加奖励分）。A 若判负，B 永远不会开启，
-- 愿望也就一直留在未实现里。
-- ============================================================


-- ---------- 枚举（幂等，误跑第二次不会中断） ----------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'wish_status') then
    create type wish_status as enum ('open', 'done');
  end if;
end $$;


-- ---------- 愿望 ----------

create table if not exists wishes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  status wish_status not null default 'open',
  done_at timestamptz,
  -- 在哪个存档里兑现的（仅作展示）。存档被删时置空，但"已实现"状态保留
  done_archive_id uuid references archives(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wishes_user_idx on wishes(user_id, status, created_at);


-- ---------- RLS ----------

alter table wishes enable row level security;

drop policy if exists "own wishes" on wishes;
create policy "own wishes" on wishes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------- 节点记住自己用的是哪个愿望 ----------
-- 手输的奖励留空。存 wish_id 而不是靠 content 匹配：
-- 愿望文案以后可能被改，用文案匹配会认错。

alter table nodes add column if not exists wish_id uuid references wishes(id) on delete set null;

create index if not exists nodes_wish_idx on nodes(wish_id) where wish_id is not null;

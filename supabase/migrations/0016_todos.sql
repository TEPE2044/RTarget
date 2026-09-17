-- ============================================================
-- 0016: 目标单（不用积分的待办清单）
--
-- 需求（Jackie）：「就是一个普通的 TODOLIST，只不过设置这个不用任何积分，
--   在你设置目标的时候可以选择，跟愿望单一样的原理」。
--
-- 和愿望单（0015）的对称关系：
--   wishes → 奖励 B 的备选池（想要的东西）
--   todos  → 目标 A 的备选池（想做的事）
-- 所以单独一张表，不共用 —— 两者的状态流转不一样（下面有说明）。
--
-- 三态：
--   open  = 待办（在清单里显示）
--   taken = 已立项（从清单里移出，事情已经进了「执行」页）
--   done  = 直接勾掉的（不走押注系统，不加不减分）
--
-- 为什么 taken 要单独一个状态、而不是直接删掉：
--   物理删除会丢历史，而且「这条后来变成哪个目标了」就查不到了。
--   留着记录 + 不显示，成本一样、可追溯性好得多。
-- ============================================================


-- ---------- 枚举（写成 do 块以保证幂等） ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'todo_status') then
    create type todo_status as enum ('open', 'taken', 'done');
  end if;
end $$;


-- ---------- 目标单 ----------

create table if not exists todos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  status todo_status not null default 'open',
  -- 直接勾掉的时间（status = done 时有值）
  done_at timestamptz,
  -- 立项时间（status = taken 时有值）。这里刻意**不**存 archive_id：
  -- 已经通过 nodes.todo_id 反查得到，再存一份就有了两个真相来源
  taken_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists todos_user_idx on todos(user_id, status, created_at desc);


-- ---------- RLS ----------

alter table todos enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'todos' and policyname = 'own todos') then
    create policy "own todos" on todos
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;


-- ---------- 节点记住自己的来源 ----------
-- 只有 A 会用到（奖励 B 的来源是 nodes.wish_id，见 0015）。
-- 手输的目标 A 留空 —— 跟奖励 B 的处理保持一致。

alter table nodes add column if not exists todo_id uuid references todos(id) on delete set null;

create index if not exists nodes_todo_idx on nodes(todo_id) where todo_id is not null;

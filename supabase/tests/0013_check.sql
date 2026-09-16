-- ============================================================
-- 0013 落地自检（纯只读）
-- 最后一条语句是 select，结果直接出在表格里。
-- ============================================================

with f as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'delete_archive' and n.nspname = 'public'
  limit 1
)
select
  coalesce((select src is not null from f), false)
    as "① 找到 delete_archive 函数",

  -- 关键逻辑：先把流水的 archive_id / node_id 置空，再删存档
  coalesce((select strpos(src, 'archive_id = null') > 0 from f), false)
    as "② 含解绑流水逻辑",

  coalesce((select strpos(src, 'v_status <> ') > 0 from f), false)
    as "③ 含已封档校验",

  -- 下面这列是为了说明"为什么必须走函数"：
  -- a = NO ACTION（默认），意味着直接删 archives 会被流水表的外键拦住
  -- 用 concat() 而不是 || ：confdeltype 是内部类型 "char"，
  -- text || "char" 会报 "operator is not unique"
  (select string_agg(concat(c.conname, ' = ', c.confdeltype), ', ')
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
    where t.relname = 'vitality_ledger' and c.contype = 'f')
    as "流水表外键的删除动作（a=NO ACTION c=CASCADE n=SET NULL）",

  (select count(*) from archives where status = 'sealed')             as "已封档存档数",
  (select count(*) from vitality_ledger where archive_id is null)     as "无归属流水笔数";

-- ①②③ 都为 true → 0013 已落地。
-- 期望：流水表两个外键都是 a（NO ACTION），所以删除必须走 delete_archive()。

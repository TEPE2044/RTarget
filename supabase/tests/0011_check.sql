-- ============================================================
-- 0011 落地自检（纯只读）
-- 最后一条语句是 select，结果直接出在表格里。
-- ============================================================

with f as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'seal_archive' and n.nspname = 'public'
  limit 1
)
select
  coalesce((select src is not null from f), false)
    as "① 找到 seal_archive 函数",

  -- 0011 的标记：判定"未了结"时排除了 B
  coalesce((select strpos(src, 'kind <> ''B''') > 0 from f), false)
    as "② 已排除 B（含 kind <> 'B'）",

  -- 这些就是以前会被误判成"未了结"、导致白扣 10% 的节点
  (select count(*) from nodes where kind = 'B' and status = 'active')
    as "③ 待确认的 B（以前会误扣）",

  (select count(*) from archives where status = 'open')  as "未封档存档",
  (select count(*) from archives where status = 'sealed') as "已封档存档";

-- ①② 都为 true → 0011 已落地。
-- ③ 是给你对账用的：如果 > 0，说明确实存在"奖励已到账但没点确认"的存档，
--    0011 之前封这样的档会被白扣 10%。

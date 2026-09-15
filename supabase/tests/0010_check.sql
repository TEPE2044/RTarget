-- ============================================================
-- 0010 落地自检（纯只读）
--
-- 为什么是只读的：SQL Editor 只展示最后一条语句的结果。
-- 之前那版最后一句是 rollback，所以输出全被丢掉了（只会显示 No rows returned）。
-- 这一版不改任何数据，最后一条就是 select，结果直接出在表格里。
--
-- 用法：整段复制到 Supabase SQL Editor 执行，看返回的那一行。
-- ============================================================

with f as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'settle_all' and n.nspname = 'public'
  limit 1
)
select
  coalesce((select src is not null from f), false)
    as "① 找到 settle_all 函数",

  -- v3 独有：用 CTE `opened` 兜住 C 扣分的幂等（旧版是 update 完再 select，可能重复扣）
  coalesce((select strpos(src, 'with opened as') > 0 from f), false)
    as "② 是 v3（含 opened CTE）",

  -- v3 独有：结算时无条件把 C 收口为 settled（修掉"按钮点了没反应"的关键）
  coalesce((select strpos(src, 'n.c_id') > 0 from f), false)
    as "③ 含 C 收口逻辑",

  -- 0010 的存量修复 1：这类行就是当初"点了没反应"的元凶，修完应为 0
  (select count(*)
     from nodes c
     join nodes a on c.parent_id = a.id
    where c.kind = 'C' and c.status = 'active'
      and a.kind = 'A' and a.compound_a_done is not null)
    as "④ 卡死的 C（修复前 >0，修完应为 0）",

  (select count(*) from archives) as "存档总数",
  (select count(*) from nodes)    as "节点总数";

-- ------------------------------------------------------------
-- ①②③ 都为 true、且 ④ 为 0 → 0010 已正确落地。
--
-- 想再验"行为"（判负 → 复合体 → 两边做回来返还）的话，最省事的方式是直接在
-- 应用里点一遍：设一个「今天做完」的目标、死线 C 选 +1 天，
-- 到点后 A 判负；再把 A、C 两边都点完成，看活力值是不是补回来了。
-- 数据库层面的等价测试需要写数据，写在 SQL Editor 里输出会被 rollback 吞掉，不划算。
-- ------------------------------------------------------------

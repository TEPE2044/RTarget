-- ============================================================
-- 清库重置脚本（数据层）
--
-- ⚠️ 危险：会永久删除下列表的全部数据，不可恢复，没有回滚：
--      vitality_ledger（活力值流水）
--      nodes（A/B/C 节点）
--      archives（存档）
--    请先确认 Supabase Dashboard → Database → Backups 里有可用的备份。
--
-- ✅ 不动的东西（这是重点）：
--      auth.users —— 你的账号还在，不用重新注册
--      表结构 / 枚举 / 索引 / RLS 策略
--      settle_all、seal_archive、grant_initial_vitality 等函数与触发器
--      （所以 0010 / 0011 / 0012 都不用重跑，它们是 schema 层的，清数据清不掉）
--
-- 用法：整段复制到 Supabase SQL Editor 执行，最后会返回一张操作报告表。
-- ============================================================

-- 报告表（临时表，会话结束自动消失，不落库）
create temp table if not exists rt_reset_log (ord int, item text, val text);
delete from rt_reset_log;

-- ---------- 1) 清空数据 + 补回初始活力值 ----------
do $$
declare
  v_a int;
  v_n int;
  v_l int;
  v_before int;
  v_users int;
begin
  select count(*) into v_a from archives;
  select count(*) into v_n from nodes;
  select count(*) into v_l from vitality_ledger;
  select coalesce(sum(amount), 0) into v_before from vitality_ledger;

  insert into rt_reset_log values
    (1, '删除前 · 存档数',   v_a::text),
    (2, '删除前 · 节点数',   v_n::text),
    (3, '删除前 · 流水笔数', v_l::text),
    (4, '删除前 · 活力值',   v_before::text);

  -- 外键顺序：流水 → 节点 → 存档
  delete from vitality_ledger;
  delete from nodes;
  delete from archives;

  -- 账号没被删，grant_initial_vitality 触发器不会再触发，所以必须手动补回初始分
  -- （上次清库后就是漏了这步，才需要 0008 来补救）
  insert into vitality_ledger(user_id, reason, note, amount)
  select u.id, null, '初始活力值（清库重置）', 10
  from auth.users u;
  get diagnostics v_users = row_count;

  insert into rt_reset_log values
    (5, '已清空', 'archives / nodes / vitality_ledger 全部删除'),
    (6, '补回初始活力值', v_users::text || ' 个账号，各 +10');
end $$;

-- ---------- 2) 报告（最后一条必须是 select，否则输出会被吞掉）----------
select ord as "序号", item as "项目", val as "值"
from rt_reset_log

union all
select 90, '—— 清库后 ——', ''
union all select 91, '存档总数',   (select count(*)::text from archives)
union all select 92, '节点总数',   (select count(*)::text from nodes)
union all select 93, '流水笔数',   (select count(*)::text from vitality_ledger)
union all select 94, '当前活力值', (select coalesce(sum(amount), 0)::text from vitality_ledger)
order by 1;

-- 期望结果：存档 0 / 节点 0 / 流水 1（每个账号一行初始分）/ 活力值 = 10 × 账号数
-- 如果流水是 0 或者活力值是 0，说明第 1 步没跑完，别急着用。

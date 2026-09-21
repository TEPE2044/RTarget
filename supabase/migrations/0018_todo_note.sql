-- ============================================================
-- 0018: 待办与目标的「备忘录」
--
-- 需求（Jackie，2026-09-21）：「感觉待办的每一项差一个备忘录」。
--
-- 备注写在**待办**上；立项时**快照一份到目标 A**。
-- 为什么必须跟着走：待办一旦被挑去立项就变成 taken、从目标单清单里消失 ——
-- 备注不跟过去就再也看不到了（除非放弃目标把它撤回）。
--
-- 两列都是 text not null default ''，存量数据天然是"空备注"，**不用回填**。
--
-- ⚠️ 这是「不跑前端就报错」的那一类迁移（同 0015/0016/0017）：
--    前端会读写 todos.note / nodes.note，列不存在会直接报错，
--    不是静默降级。**先跑迁移，再装/更新前端。**
-- ============================================================

alter table todos add column if not exists note text not null default '';
alter table nodes add column if not exists note text not null default '';

comment on column todos.note is '备忘录：这条待办要怎么做 / 有什么要记的';
comment on column nodes.note is '备忘录快照：从待办立项时带过来（只有 A 会有值）';

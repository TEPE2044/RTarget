/* ============================================================
 * mock.js —— 全部假数据的唯一来源（原型用，无后端）
 *
 * 约定：
 * · dueAt 用「距现在的偏移毫秒」声明，载入时换算成具体时刻 ——
 *   这样倒计时永远是合理的，原型放多久都不会"过期"。
 * · 所有视图只从这里读数据，不许在别处散写硬编码。
 * ============================================================ */

const NOW = Date.now()
const mins = (m) => m * 60 * 1000
const hrs = (h) => h * 3600 * 1000
const days = (d) => d * 24 * 3600 * 1000

const DB = {
  /* 活力值：全局血池（机制保留） */
  vitality: { value: 14, initial: 10 },

  /* 存档（保留）。默认选中的 = 第一个 = 最新的 */
  archives: [
    { id: 'a3', name: '现在', status: 'open', createdAt: NOW - days(12) },
    { id: 'a2', name: '七月 · 收尾', status: 'sealed', penalty: -3, createdAt: NOW - days(70) },
    { id: 'a1', name: '五月 · 动起来', status: 'sealed', sealedFree: true, penalty: 0, createdAt: NOW - days(130) },
  ],

  /* 目标（进行中）。做到 +S / 做不到 −S，一锤子 */
  goals: [
    {
      id: 'g1', archiveId: 'a3', title: '收拾阳台和杂物，扔掉废物', tier: '中', stake: 10,
      dueAt: NOW + days(2) + hrs(4), reward: '妮姬 灰姑娘 c108 立牌', penalty: '强制执行',
      exec: '先扔垃圾袋，再分类纸箱；栏杆最后擦。\n\n- [ ] 垃圾袋 ×3\n- [ ] 纸箱拆平\n- [ ] 栏杆擦一遍',
      source: 'todo', todoId: 't1', status: 'active',
    },
    {
      id: 'g2', archiveId: 'a3', title: '把冰箱清一遍', tier: '低', stake: 5,
      dueAt: NOW + hrs(18), reward: '看一场电影', penalty: '手洗羽绒服',
      exec: '', source: 'free', status: 'active',
    },
    {
      id: 'g3', archiveId: 'a3', title: '十分钟内收拾书桌', tier: '低', stake: 5,
      dueAt: NOW + hrs(5), reward: '一杯好咖啡', penalty: '',
      exec: '', source: 'free', status: 'active',
    },
    {
      id: 'g4', archiveId: 'a3', title: '交房租 + 整理账单', tier: '中', stake: 10,
      dueAt: NOW + days(3) + hrs(2), reward: '那本画册', penalty: '周末不碰游戏',
      exec: '', source: 'free', status: 'active',
    },
    {
      id: 'g5', archiveId: 'a3', title: '写三页周报', tier: '高', stake: 20,
      dueAt: NOW + hrs(9), reward: '去漫展', penalty: '打扫卫生间',
      exec: '', source: 'todo', todoId: 't3', status: 'active',
    },
    {
      id: 'g6', archiveId: 'a3', title: '换季衣服收纳', tier: '低', stake: 5,
      dueAt: NOW + days(6), reward: '一顿火锅', penalty: '整理储物柜',
      exec: '', source: 'free', status: 'active',
    },
  ],

  /* 待办（t1 / t3 已被立成目标，移出清单） */
  todos: [
    { id: 't2', title: '清理冰箱', text: '先扔过期酱料，再擦两层隔板', times: 1, left: 1 },
    { id: 't4', title: '买猫砂', text: '', times: 1, left: 1 },
    { id: 't5', title: '预约牙医', text: '上次说智齿那边要复查', times: 1, left: 1 },
    { id: 't6', title: '还给图书馆的书', text: '', times: 1, left: 1 },
    { id: 't7', title: '整理照片到硬盘', text: '手机里 2024 年之后的先导出来', times: 1, left: 1 },
    { id: 't8', title: '换床单', text: '', times: 1, left: 1 },
    { id: 't9', title: '练琴', text: '哈农 20 分钟 + 曲目一段', times: 10, left: 7 },
    { id: 't10', title: '跑步', text: '三公里就算数', times: 8, left: 3 },
    { id: 't11', title: '把快递纸箱扔了', text: '', times: 1, left: 1 },
    { id: 't12', title: '修一下卧室的灯', text: '先看是不是灯泡问题', times: 1, left: 1 },
  ],

  /* 愿望（attachedTo = 已挂给哪个进行中的目标当奖励） */
  wishes: [
    { id: 'w1', title: '妮姬 灰姑娘 c108 立牌', status: 'open', attachedTo: '收拾阳台和杂物，扔掉废物' },
    { id: 'w2', title: '看一场电影', status: 'open' },
    { id: 'w3', title: '买那本画册', status: 'open' },
    { id: 'w4', title: '去漫展', status: 'open' },
    { id: 'w5', title: '一顿火锅', status: 'open' },
    { id: 'w6', title: '换个机械键盘', status: 'open' },
    { id: 'w7', title: '去海边看日出', status: 'open' },
    { id: 'w8', title: '拼一个高达', status: 'open' },
    { id: 'w9', title: '喝一杯手冲', status: 'open' },
    { id: 'w10', title: '买双跑鞋', status: 'open' },
    { id: 'w11', title: '买了新耳机', status: 'done', doneAt: NOW - days(9) },
    { id: 'w12', title: '看了《热辣滚烫》', status: 'done', doneAt: NOW - days(33) },
    { id: 'w13', title: '换了显示器支架', status: 'done', doneAt: NOW - days(45) },
  ],

  /* 首页动态流（最近发生了什么） */
  feed: [
    { type: 'done', text: '完成了「交上月水电费」 · +10 活力值', ts: NOW - mins(24) },
    { type: 'failed', text: '没做到「晨跑三天」 · −5 活力值 · 已退回待办', ts: NOW - hrs(3) },
    { type: 'redeemed', text: '兑现了愿望「看一场电影」', ts: NOW - hrs(6) },
    { type: 'created', text: '立了「收拾阳台和杂物，扔掉废物」 · 押 10', ts: NOW - days(1) },
    { type: 'done', text: '完成了「换床单」 · +5 活力值', ts: NOW - days(1) - hrs(5) },
    { type: 'sealed', text: '封档「七月 · 收尾」 · 扣 3 活力值', ts: NOW - days(2) },
    { type: 'created', text: '立了「写三页周报」 · 押 20', ts: NOW - days(2) - hrs(4) },
    { type: 'failed', text: '没做到「早睡一周」 · −10 活力值 · 已退回待办', ts: NOW - days(3) },
    { type: 'done', text: '完成了「给绿萝浇水」 · +5 活力值', ts: NOW - days(3) - hrs(8) },
    { type: 'redeemed', text: '兑现了愿望「买了新耳机」', ts: NOW - days(9) },
  ],

  /* 各存档的记录（历史页） */
  records: {
    a3: [
      { type: 'done', text: '完成了「交上月水电费」 · +10', ts: NOW - mins(24) },
      { type: 'failed', text: '没做到「晨跑三天」 · −5 · 已退回待办', ts: NOW - hrs(3) },
      { type: 'created', text: '立了「收拾阳台和杂物，扔掉废物」 · 押 10', ts: NOW - days(1) },
      { type: 'created', text: '立了「写三页周报」 · 押 20', ts: NOW - days(2) - hrs(4) },
      { type: 'done', text: '完成了「给绿萝浇水」 · +5', ts: NOW - days(3) - hrs(8) },
      { type: 'created', text: '立了「把冰箱清一遍」 · 押 5', ts: NOW - days(4) },
    ],
    a2: [
      { type: 'done', text: '完成了「交季度报告」 · +10', ts: NOW - days(66) },
      { type: 'failed', text: '没做到「每天读 20 页」 · −5 · 已退回待办', ts: NOW - days(68) },
      { type: 'done', text: '完成了「大扫除」 · +5', ts: NOW - days(70) },
      { type: 'sealed', text: '封档 · 未了结 ×2 · 扣 3', ts: NOW - days(70) - hrs(2) },
    ],
    a1: [
      { type: 'done', text: '完成了「连续早起 5 天」 · +20', ts: NOW - days(120) },
      { type: 'done', text: '完成了「体检」 · +10', ts: NOW - days(125) },
      { type: 'sealed', text: '封档 · 全部走奖励分支 · 免费', ts: NOW - days(130) },
    ],
  },
}
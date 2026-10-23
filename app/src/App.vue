<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showLoadingToast, showSuccessToast, showToast } from 'vant'
import { useAuth } from './lib/auth'
import { onAppResume, registerBackButton, syncSystemBars } from './lib/native'
import {
  applyUpdate, checkForUpdate, currentVersion, fetchLatest, isDesktopShell, isNative,
  isUpdateConfigured,
} from './lib/updater'
import type { LatestInfo } from './lib/updater'
import {
  check as desktopCheck, checkShell, currentBundle, download as desktopDownload,
  fetchFrontendManifest, installShell, notifyReady, relaunch as desktopRelaunch,
} from './lib/desktopUpdate'
import type { CheckOutcome, ShellUpdateInfo } from './lib/desktopUpdate'
import { useTheme } from './lib/theme'
import {
  activeGoals, bindSignOut, busy, goals, loadFail, lock, newArchive, openTodos, openWishes,
  refresh, resetAll, unlock, vitality,
} from './lib/store'
import LoginCard from './components/LoginCard.vue'
import HomePage from './components/HomePage.vue'
import TodosPage from './components/TodosPage.vue'
import GoalsPage from './components/GoalsPage.vue'
import WishesPage from './components/WishesPage.vue'
import HistoryPage from './components/HistoryPage.vue'
import GoalDetail from './components/GoalDetail.vue'
import GoalWizard from './components/GoalWizard.vue'
import UpdateGate from './components/UpdateGate.vue'
import { supabase } from './lib/supabase.ts'

const { session, loading, forceSignOut, passwordPending, setPassword } = useAuth()
const { theme, toggleTheme } = useTheme()

// 数据层出错要能把人踢回登录页 —— 把登出函数交进 store（见 store 的错误上报）
bindSignOut(forceSignOut)

const userEmail = computed(() => session.value?.user?.email ?? '')

/**
 * 桌面端：过更新闸门前不渲染主界面。
 * 浏览器和手机端永远是 false —— 这个分支完全不影响它们。
 */
const desktopGate = ref(isDesktopShell)

// ---------- 顶栏时钟 ----------

const now = ref(new Date())
const clock = computed(() => now.value.toLocaleString('zh-CN'))

// ---------- 页面 ----------

type PageKey = 'home' | 'todos' | 'goals' | 'wishes' | 'history'
const page = ref<PageKey>('home')

/** 底部导航：手机上要短，长词放不下。5 个 tab 在 390px 下每格还有 78px */
const PAGES: { key: PageKey; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'todos', label: '待办' },
  { key: 'goals', label: '目标' },
  { key: 'wishes', label: '愿望' },
  { key: 'history', label: '历史' },
]

/**
 * 各 tab 的滚动位置（window 的，不是某个容器）。
 *
 * 为什么要有这东西：五页是 v-show 常驻的（见下面模板里的注释），滚的是 window。
 * 切 tab 只换 display，**浏览器不会自己重置滚动位置** —— 于是"首页划到底、切目标、
 * 目标也到底"。而一律强制回顶又是另一种错：切过去看一眼再切回来，位置没了。
 *
 * 所以按"导航栈"的口径分开处理：
 * - 切 tab（横向移动）→ 恢复**那个 tab 自己**上次的位置，第一次进 = 顶部
 * - 点当前所在的 tab → 回顶（原生手势惯例，也给一个"从头看"的入口）
 * - 打开/关闭详情 → 什么都不用做：详情是全屏浮层，列表没被卸载，window 根本没动过
 * - 登出重登 / 冷启动 → 内存清空，自然回首页 + 顶部（这是想要的）
 */
const scrollMem = new Map<PageKey, number>()

/**
 * 切页。
 *
 * - 用户点页签 → 恢复目标页上次的位置
 * - top = true → 落到顶部。给"刚做完一个动作、要看到结果"的跳转用
 *   （比如立完目标跳去目标页，用户是要看那张新卡，不是回到他上次翻到的地方）
 *
 * 为什么必须等 nextTick：v-show 换的是 display，**文档高度要等这一步 patch 完
 * 才等于新页的高度**。在新高度生效前 scrollTo，超出部分会被浏览器截断到当时的
 * 最大高度 —— 这正是"矮页面回来时被顶到底"的成因。等一帧再滚，恢复才是准的。
 * （当然，目标页本身比首页矮时仍然只能停到它的最大高度，这是浏览器的硬限制。）
 */
function goPage(next: PageKey, opts: { top?: boolean } = {}) {
  const cur = page.value

  if (next === cur) {
    // 点已经在的这页 = 回顶。存 0，免得下次切回来又跳回原来那个位置
    scrollMem.set(cur, 0)
    window.scrollTo(0, 0)
    return
  }

  scrollMem.set(cur, window.scrollY)
  page.value = next
  const want = opts.top ? 0 : (scrollMem.get(next) ?? 0)
  if (opts.top) scrollMem.set(next, 0)
  void nextTick(() => window.scrollTo(0, want))
}

/** 还没了结的目标数 —— 挂在「目标」页签上。
    口径必须跟目标页看到的一致：只算**当前这个存档**的，
    数全部存档的话角标会跟页面上几张卡对不上。 */
const pendingGoals = computed(() => activeGoals.value.length)

/**
 * 桌面端外壳开关 —— **构建期字面量**（`vite --mode desktop` 时才为 true）。
 *
 * 所以模板里 `v-if="isDesktopPlat"` 那几段只会出现在桌面包里，
 * `v-if="!isDesktopPlat"` 那几段（顶栏 / 底部导航 / 悬浮球）在桌面包里被删掉。
 * 两套外壳**不共存**，而页面组件与下面所有逻辑只有一份，两边共用。
 */
const isDesktopPlat = import.meta.env.VITE_PLATFORM === 'desktop'

const deskTitle = computed(() => PAGES.find((p) => p.key === page.value)?.label ?? '')

/** 页头的副标题：口径必须跟各页角标对得上，别自己另算一套 */
const deskSub = computed(() => {
  if (page.value === 'home') return `进行中 ${pendingGoals.value} 件 · 共 ${goals.value.length} 个目标`
  if (page.value === 'todos') return `未完成 ${openTodos.value.length} 条`
  if (page.value === 'goals') return `进行中 ${pendingGoals.value} 件`
  if (page.value === 'wishes') return `待实现 ${openWishes.value.length} 个`
  return '封档记录与动态'
})

/**
 * 页顶的"新增"长条：待办 / 愿望 两页用。
 *
 * 这两页原来是右下角的悬浮球，它会盖住列表最后几行**右侧的删除图标**
 * —— 图标是行内右对齐的，恰好落在球的那块地方，点不到。
 * 改成钉在 appbar 下面的整宽长条：挪出了列表的可点区域，命中面积也大得多。
 */
const addBar = computed(() => {
  if (page.value === 'todos') {
    return { label: '记一条待办', run: () => todosPage.value?.openNew() }
  }
  if (page.value === 'wishes') {
    return { label: '加一个愿望', run: () => wishesPage.value?.openNew() }
  }
  return null
})

/**
 * 右下悬浮球：只剩「目标」页在用。
 *
 * 目标卡上「打卡」按钮也在行内右侧，同样有被盖的风险 —— 等真盖到再一起挪，
 * 现在先不动它。
 */
const fab = computed(() => {
  if (page.value === 'goals') {
    return { label: '立一个新目标', run: () => { showWizard.value = true } }
  }
  return null
})

const todosPage = ref<InstanceType<typeof TodosPage> | null>(null)
const wishesPage = ref<InstanceType<typeof WishesPage> | null>(null)

// ---------- 浮层 ----------

const showMore = ref(false)
const showPassword = ref(false)
const showArchive = ref(false)
const showWizard = ref(false)
const detailShow = ref(false)
const detailId = ref<string | null>(null)
/** 返回键要能走详情自己的 close()（见下面 closeModal 的注释） */
const detailRef = ref<InstanceType<typeof GoalDetail> | null>(null)

const newArchiveName = ref('')
const newPwd1 = ref('')
const newPwd2 = ref('')

function openMore() { showMore.value = true; void loadCurrentVersion() }
function openGoal(id: string) { detailId.value = id; detailShow.value = true }

/**
 * 全屏浮层开着的时候，藏掉文档那条滚动条。
 *
 * 起因：浮层宽度是 100%，而 100% 是**不含滚动条那 15px** 的 —— 桌面浏览器上
 * 浮层右边会露出文档滚动条的一条竖带。之前靠 Vant 的 lock-scroll 顺带把它藏住，
 * 但 lock-scroll 会把滚动位置挪走还不还回来（实测 350 → 84），只能关掉它。
 *
 * 换成 html{overflow:hidden}（见 style.css 的 .rt-noscroll）：
 * - 滚动条消失、条带没了 ✓
 * - 顺便把背景滚动锁回来（浮层后面还能被滚本身就是个 bug）✓
 * - 实测 scrollY 不会被重置，不像 Vant 那套会把位置弄丢 ✓
 *
 * 短抽屉不加这个：它们还留着 Vant 的 lock-scroll，滚动条本来就被藏住了。
 */
const fullOverlay = computed(() => showWizard.value || detailShow.value)
watch(fullOverlay, (on) => {
  document.documentElement.classList.toggle('rt-noscroll', on)
})

/**
 * 键盘弹起时被吃掉的那段高度，实时量给 CSS（`--rt-kb`，见 style.css 的「键盘弹起」）。
 *
 * 为什么要前端补这一手：这份工程没在 AndroidManifest 里写 windowSoftInputMode，
 * 系统自己在 adjustResize / adjustPan 里挑一个。**万一它没缩布局视口**，
 * position:fixed + height:100% 的浮层下半截就正好压在键盘底下 ——
 * 输入框往下那几行怎么都看不到，全屏底栏那个「押注设立」也点不着。
 *
 * 量法 = 布局视口高度 − 可视区高度。**系统自己缩过的时候这两个相等、算出 0**，
 * 所以同一个公式在两种行为下都成立，不用去猜这次走的是哪条路。
 */
const vv = window.visualViewport
function syncKeyboard() {
  if (!vv) return
  const kb = Math.round(window.innerHeight - vv.height)
  const on = kb > 60 // 60 以下当噪声（地址栏/滚动条那点抖动），不放行
  document.documentElement.style.setProperty('--rt-kb', `${on ? kb : 0}px`)
  document.documentElement.classList.toggle('rt-kb', on)
}

/** 开新档：名称必须自己填（自动叫「新档 3」那种名字，回头谁都认不出是哪个档） */
function openArchive() { newArchiveName.value = ''; showArchive.value = true }

/**
 * 用户点的刷新。
 *
 * `refresh()` 自己会把 busy 立起来，但那是**渲染之后**才盖到按钮上的 ——
 * 慢的时候连点两下会并排放两次全量拉取。于是这一行同步挡一道。
 */
function refreshNow() {
  if (busy.value) return
  void refresh()
}

async function onCreateArchive() {
  const n = newArchiveName.value.trim()
  if (!n) return
  if (busy.value) return // 请求锁：慢的时候连点会开出两个同名档
  await newArchive(n)
  showArchive.value = false
}

/** 向导立完目标：跳到目标页并把数据拉新（addGoal 自己只落库，不负责刷新） */
function onWizardDone() { goPage('goals', { top: true }); void refresh() }

// ---------- 应用内更新（OTA，只更前端） ----------

const updateBusy = ref(false)
/** 自检发现的待装新版（null = 没发现 / 没检查） */
const updateReady = ref<{ latest: LatestInfo; current: string } | null>(null)
const updateApplying = ref(false)
const currentVer = ref('')
/** 桌面端：「更多」里分开展示的两个版本号 */
const shellVer = ref('')
const frontVer = ref('')
let currentVerLoaded = false
/** 上次自检的时刻 —— 切回前台很频繁，别每次都打一次网络 */
let lastAutoCheck = 0
const AUTO_CHECK_GAP = 10 * 60 * 1000

/**
 * 打开应用 / 切回前台时顺手自检。**全静默** ——
 * 网络不通、桶挂了都当作"没检查过"，不弹任何东西：用户没主动要求检查，
 * 就不该被错误框打扰。发现了新版也不弹窗，只在首页挂一条横幅。
 */
async function autoCheckUpdate() {
  if (!isNative || !isUpdateConfigured) return
  if (updateReady.value) return // 已经发现了，不用再问
  if (Date.now() - lastAutoCheck < AUTO_CHECK_GAP) return
  lastAutoCheck = Date.now()
  const found = await checkForUpdate()
  if (!found) return
  updateReady.value = found
  currentVer.value = found.current
  currentVerLoaded = true
}

/** 版本号（20260918-1452）写成"9/18 14:52"；认不出来就原样显示 */
function fmtVer(v: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(v)
  if (!m) return v
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`
}

/** 点首页那条横幅：下载并切到新版（切过去时页面会立刻重载） */
async function onApplyUpdate() {
  const info = updateReady.value?.latest
  if (!info || updateApplying.value) return
  updateApplying.value = true
  const t = showLoadingToast({ message: '正在下载新版本…', forbidClick: true, duration: 0 })
  try {
    await applyUpdate(info)
  } catch (e) {
    t.close()
    updateApplying.value = false
    showFailToast(`更新失败：${(e as Error).message}`)
  }
}

/** 打开「更多」抽屉时才去问当前版本，省得每次启动都打一次原生调用 */
async function loadCurrentVersion() {
  if (currentVerLoaded || !(isNative || isDesktopShell)) return
  if (isDesktopShell) {
    // 桌面端要分开报两套号：壳（安装包）+ 前端 bundle（OTA 切过去的那份）
    try {
      shellVer.value = (await window.__TAURI__?.app?.getVersion?.()) ?? ''
    } catch {
      /* 读不到就留空，不拦着抽屉打开 */
    }
    const bundle = await currentBundle()
    frontVer.value = bundle?.version ?? ''
    currentVer.value = shellVer.value ? `桌面版 ${shellVer.value}` : '桌面版'
  } else {
    currentVer.value = await currentVersion()
  }
  currentVerLoaded = true
}

/**
 * Tauri 的 `invoke` 被拒时抛的是**字符串**（不是 Error 实例），
 * 直接取 `.message` 会得到 undefined —— 桌面端这两处提示都走它。
 */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : JSON.stringify(e)
}

/** 桌面端：这两种结局是"硬不行"，给一句明确的话；其余状态都还有下一步 */
function desktopBlockedMessage(o: { status: string; required?: string; shell?: string }): string | null {
  if (o.status === 'blacklisted') return '这个更新包之前启动失败过，已被排除，等下一个新包'
  if (o.status === 'shellTooOld') return `这个版本需要更新的安装包（要求 ${o.required}，当前 ${o.shell}）`
  return null
}

/**
 * 桌面壳（Tauri）的「检查更新」：壳、前端各查一次，一起报出来。
 *
 * 与启动闸门（UpdateGate）共用同一套底层调用，区别是这里**不强制** ——
 * 闸门是"必须更新或退出应用"，这里可以选「稍后」。
 */
async function checkUpdateOnDesktop() {
  updateBusy.value = true
  const t = showLoadingToast({ message: '正在检查…', forbidClick: true, duration: 0 })
  try {
    const [shellRes, front] = await Promise.all([
      checkShell(),
      desktopCheck().catch(() => null as CheckOutcome | null),
    ])
    t.close()

    // 顺带把抽屉里的两个版本号刷新一遍
    currentVerLoaded = false
    void loadCurrentVersion()

    const shell = shellRes.info
    const frontNew = front?.status === 'available'
    const frontStaged = front?.status === 'alreadyStaged'
    if (!shell && !frontNew && !frontStaged) {
      if (!front) return showFailToast('资源包检查失败')
      if (front.status === 'blacklisted' || front.status === 'shellTooOld') {
        return showFailToast(desktopBlockedMessage(front) ?? '更新失败')
      }
      if (!shellRes.ok) return showFailToast('桌面端检查失败（桶里还没有 latest.json？）')
      return showSuccessToast('已是最新版本')
    }

    const lines: string[] = []
    if (shell) lines.push(`桌面端 ${shell.currentVersion} → ${shell.version}`)
    if (frontNew) lines.push(`资源包 ${front!.manifest.version}`)
    if (frontStaged) lines.push(`资源包 ${front!.version} 已就绪，重启后生效`)

    // 更新说明：壳的来自 latest.json，前端的来自 manifest.notes
    const notes: string[] = []
    if (shell?.body) notes.push(...shell.body.split('\n'))
    if (frontNew) {
      const manifest = await fetchFrontendManifest()
      if (manifest?.notes) notes.push(...manifest.notes.split('\n'))
    }
    const noteLines = notes
      .map((s) => s.trim().replace(/^[-·•]\s*/, ''))
      .filter(Boolean)
      .slice(0, 5)
    if (noteLines.length) lines.push('', ...noteLines.map((l) => `· ${l}`))

    showConfirmDialog({
      title: '发现可用更新',
      message: lines.join('\n'),
      confirmButtonText: '更新',
      cancelButtonText: '稍后',
    })
      .then(() => void applyDesktopUpdate(shell, frontNew || !!frontStaged))
      .catch(() => {})
  } catch (e) {
    t.close()
    showFailToast(`检查失败：${errText(e)}`)
  } finally {
    updateBusy.value = false
  }
}

/** 确认之后的实际动作：先把前端包放到位，再装外壳（装完由安装器重启） */
async function applyDesktopUpdate(shell: ShellUpdateInfo | null, frontNeeded: boolean) {
  updateBusy.value = true
  const t = showLoadingToast({ message: '正在下载…', forbidClick: true, duration: 0 })
  try {
    if (frontNeeded) {
      try {
        const done = await desktopDownload()
        const ok = done.status === 'staged' || done.status === 'alreadyStaged'
        if (!ok && !shell) {
          t.close()
          return showFailToast(desktopBlockedMessage(done) ?? '更新失败')
        }
      } catch (e) {
        t.close()
        // 前端没下成，但壳还有更新：先把壳装上，前端留给下次启动的闸门
        if (!shell) return showFailToast(`下载失败：${errText(e)}`)
      }
    }

    if (shell) {
      t.close()
      showLoadingToast({ message: '正在安装桌面端，应用会重启…', forbidClick: true, duration: 0 })
      await installShell() // 安装器会退出并重启应用
      return
    }

    t.close()
    showConfirmDialog({
      title: '新版本已就绪',
      message: '重启后生效。',
      confirmButtonText: '立即重启',
      cancelButtonText: '下次启动',
    }).then(() => void desktopRelaunch()).catch(() => {})
  } catch (e) {
    t.close()
    showFailToast(`更新失败：${errText(e)}`)
  } finally {
    updateBusy.value = false
  }
}

async function onCheckUpdate() {
  if (updateBusy.value) return // 请求锁：慢的时候连点别打两次检查/下载
  // 桌面壳（Tauri）：走热更新那条路，不再是"装新安装包即可"
  if (isDesktopShell) return checkUpdateOnDesktop()
  if (!isUpdateConfigured) {
    return showToast('还没配更新源（VITE_UPDATE_BASE）')
  }
  updateBusy.value = true
  const t = showLoadingToast({ message: '正在检查…', forbidClick: true, duration: 0 })
  try {
    const info = await fetchLatest()
    const cur = await currentVersion()
    if (info.version === cur) {
      t.close()
      currentVer.value = cur
      currentVerLoaded = true
      updateReady.value = null // 自检可能刚好赶上一次：以手动检查的结果为准
      lastAutoCheck = Date.now()
      showSuccessToast('已是最新版本')
      return
    }
    t.close()
    showLoadingToast({ message: `发现新版 ${info.version}，正在下载…`, forbidClick: true, duration: 0 })
    // applyUpdate 内部的 set() 会立刻重载页面 —— 下面这几行正常跑不到
    await applyUpdate(info)
  } catch (e) {
    t.close()
    showFailToast((e as Error).message)
  } finally {
    updateBusy.value = false
  }
}

// ---------- 账号 ----------

async function onChangePassword() {
  if (newPwd1.value.length < 6) return showToast('密码至少 6 位')
  if (newPwd1.value !== newPwd2.value) return showToast('两次输的不一样')
  if (!lock()) return // 请求锁：慢的时候连点「保存」会发两次改密
  try {
    await setPassword(newPwd1.value)
    showSuccessToast('密码已更新，下次用新密码登录')
    showPassword.value = false
    newPwd1.value = ''
    newPwd2.value = ''
  } catch (e) {
    showFailToast((e as Error).message)
  } finally {
    unlock()
  }
}

// ---------- 登出 ---------
async function signOut() {
  await supabase.auth.signOut()
  showMore.value = false;
  passwordPending.value = false
}

// ---------- 生命周期 ----------

let settleTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
/** 30 秒内最多自动结算一次：后台刷新不该反复把界面灰掉 */
let lastAutoSettle = 0

/**
 * 应用开着的时候死线跨过去了 —— 悄悄结一次账。
 * 不做的话界面会停在"还能点完成"，而服务端其实已经判负（点下去只会回一句"已结清"）。
 */
function autoSettleIfExpired() {
  if (busy.value) return
  if (Date.now() - lastAutoSettle < 30_000) return
  const hit = goals.value.some((g) => g.status === 'active' && new Date(g.due_at).getTime() <= Date.now())
  if (!hit) return
  lastAutoSettle = Date.now()
  void refresh({ silent: true })
}

let stopResume: (() => void) | null = null

onMounted(() => {
  // 桌面壳：界面挂载后立刻提交本次 bundle 为「已知可用」。
  // **必须与闸门状态无关地调用** —— 闸门挡着时界面也已经渲染了，
  // 漏调会被插件判成"这一版没起来"，下次启动把好包拉黑并回退。
  if (isDesktopShell) void notifyReady()

  clockTimer = setInterval(() => { now.value = new Date() }, 1000)
  settleTimer = setInterval(autoSettleIfExpired, 30_000)

  // 只有装进壳里才生效，浏览器上是空操作
  registerBackButton({
    hasModalOpen: () =>
      showMore.value || showPassword.value || showArchive.value
      || showWizard.value || detailShow.value,
    closeModal: () => {
      showMore.value = false
      showPassword.value = false
      showArchive.value = false
      showWizard.value = false
      // 详情不能直接赋 false：里面有"写了没保存"的备忘，直接收掉就是**内容尽数丢失**。
      // 走它自己的 close()，该问的会问一声（干净的才直接关）。
      if (detailShow.value) detailRef.value?.close()
      else detailShow.value = false
    },
    currentPage: () => page.value,
    // 跟点页签同一套逻辑，不然从安卓返回键回首页会漏掉滚动恢复
    goHome: () => goPage('home'),
  })

  // 打开时自检一次；切回前台也再问一句（Android 上切回来不会重载 JS，
  // 光靠 onMounted 只覆盖了冷启动 —— 挂一天的应用等于从没检过）
  void autoCheckUpdate()
  stopResume = onAppResume(() => {
    void autoCheckUpdate()
    void refresh({ silent: true })
  })

  // 键盘（Android 上只有 visualViewport 知道它占了多少）。必须先量一次：
  // 挂载时可能已经有输入框拿着焦点了。
  syncKeyboard()
  vv?.addEventListener('resize', syncKeyboard)
  vv?.addEventListener('scroll', syncKeyboard)
})

onUnmounted(() => {
  if (settleTimer) clearInterval(settleTimer)
  if (clockTimer) clearInterval(clockTimer)
  stopResume?.()
  vv?.removeEventListener('resize', syncKeyboard)
  vv?.removeEventListener('scroll', syncKeyboard)
})

// 壳里让系统栏图标跟着深浅主题走（浏览器上无副作用）
watch(theme, (t) => void syncSystemBars(t), { immediate: true })

watch(session, (s) => {
  if (s) void refresh()
  else resetAll()
}, { immediate: true })
</script>

<template>
  <!-- 桌面端：先过更新闸门。没有新版 / 检查失败一律放行（见 UpdateGate.vue） -->
  <UpdateGate v-if="desktopGate" @pass="desktopGate = false" />

  <!-- 会话恢复中：先别闪一下登录页 -->
  <div v-else-if="loading" class="app-bg rt-center">
    <span class="rt-meta">载入中…</span>
  </div>

  <LoginCard v-else-if="!session || passwordPending" />

  <div v-else class="rt">
    <!-- ========== 桌面端外壳（构建期变体；手机版构建里整段不存在） ==========
         与手机端共用同一份页面组件和全部逻辑，这里只是换一层"壳"：
         手机 = 顶栏 + 底部导航 + 悬浮球；桌面 = 左侧栏 + 页头。 -->
    <aside v-if="isDesktopPlat" class="dt-side">
      <div class="dt-brand">
        <div class="dt-brand-t">RTarget</div>
        <div class="rt-meta">懒人自驱动 · 奖罚迭代</div>
      </div>

      <nav class="dt-nav">
        <button v-for="p in PAGES" :key="p.key" class="dt-navi"
          :class="{ active: page === p.key }" @click="goPage(p.key)">
          <svg v-if="p.key === 'home'" class="rt-ico" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.6 10.4 12 3.8l8.4 6.6" />
            <path d="M5.8 9.3V20h12.4V9.3" />
          </svg>
          <svg v-else-if="p.key === 'todos'" class="rt-ico" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <path d="M4.4 6.6h2.4M4.4 12h2.4M4.4 17.4h2.4" />
            <path d="M10.6 6.6h9M10.6 12h9M10.6 17.4h9" />
          </svg>
          <svg v-else-if="p.key === 'goals'" class="rt-ico" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="12" r="8.3" />
            <circle cx="12" cy="12" r="3.4" />
          </svg>
          <svg v-else-if="p.key === 'wishes'" class="rt-ico" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z" />
          </svg>
          <svg v-else class="rt-ico" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8.3" />
            <path d="M12 7.4V12l3.2 1.9" />
          </svg>
          <span class="dt-navi-tx">{{ p.label }}</span>
          <span v-if="p.key === 'todos' && openTodos.length" class="rt-meta rt-num dt-navi-n">
            {{ openTodos.length }}
          </span>
          <span v-else-if="p.key === 'goals' && pendingGoals" class="rt-meta rt-num dt-navi-n">
            {{ pendingGoals }}
          </span>
        </button>
      </nav>

      <span class="dt-gap"></span>

      <!-- 活力值是全局唯一的数：手机要回首页才看得到，桌面就让它常驻侧栏底部 -->
      <div class="dt-vital">
        <div class="rt-meta">活力值</div>
        <div class="dt-vital-n rt-num">{{ vitality }}</div>
        <div class="rt-meta">进行中 {{ pendingGoals }} 件 · 共 {{ goals.length }} 个目标</div>
      </div>

      <div class="dt-tools">
        <button class="rt-iconbtn" :disabled="busy" aria-label="刷新" @click="refreshNow()">
          <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 11.5a8 8 0 1 0-2.4 5.7" />
            <path d="M20 5.5v6h-6" />
          </svg>
        </button>
        <button class="rt-iconbtn" :aria-label="theme === 'dark' ? '切换成浅色' : '切换成深色'"
          @click="toggleTheme()">
          <svg v-if="theme === 'dark'" class="rt-ico" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
          </svg>
          <svg v-else class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />
          </svg>
        </button>
        <button class="rt-iconbtn" aria-label="更多" @click="openMore()">
          <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5.2" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="18.8" r="1.6" />
          </svg>
        </button>
      </div>

      <div class="dt-acct">
        <div class="rt-meta dt-acct-mail">{{ userEmail }}</div>
        <button class="dt-acct-out" @click="signOut()">退出登录</button>
      </div>
    </aside>

    <!-- 页头：页级动作收到右上角（桌面上不该再有悬浮球 / 整宽长条） -->
    <header v-if="isDesktopPlat" class="dt-pagebar">
      <div class="dt-pagebar-in">
        <div class="dt-pagebar-l">
          <div class="dt-page-t">{{ deskTitle }}</div>
          <div class="rt-meta">{{ deskSub }}</div>
        </div>
        <span class="rt-push"></span>
        <button class="rbtn rbtn-primary dt-pagebtn" :disabled="busy" @click="showWizard = true">
          ＋ 新目标
        </button>
        <button class="rbtn dt-pagebtn" :disabled="busy"
          @click="goPage('todos', { top: true }); todosPage?.openNew()">＋ 记待办</button>
        <span class="rt-meta rt-num dt-clock">{{ clock }}</span>
      </div>
    </header>

    <!-- ---------- 顶部窄栏（手机端） ---------- -->
    <header v-if="!isDesktopPlat" class="rt-appbar">
      <div class="rt-appbar-inner">
        <span class="rt-brand">RTarget</span>
        <span class="rt-meta rt-num" style="margin-top:3px">{{ clock }}</span>
        <span class="rt-push"></span>

        <button class="rt-iconbtn" :disabled="busy" aria-label="刷新" @click="refreshNow()">
          <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 11.5a8 8 0 1 0-2.4 5.7" />
            <path d="M20 5.5v6h-6" />
          </svg>
        </button>

        <button class="rt-iconbtn" :aria-label="theme === 'dark' ? '切换成浅色' : '切换成深色'"
          @click="toggleTheme()">
          <svg v-if="theme === 'dark'" class="rt-ico" width="19" height="19" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
          </svg>
          <svg v-else class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />
          </svg>
        </button>

        <button class="rt-iconbtn" aria-label="更多" @click="openMore()">
          <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5.2" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="18.8" r="1.6" />
          </svg>
        </button>
      </div>
    </header>

    <!-- 页顶"新增"长条（待办 / 愿望）：钉在 appbar 下面，滚列表时不会跑掉。
         放在 header 和 main 之间而不是塞进页面组件里 —— 它是页面级的动作，
         不需要每个页面自己再算一次 appbar 的高度。 -->
    <div v-if="!isDesktopPlat && addBar" class="rt-addbar">
      <div class="rt-addbar-inner">
        <button class="rt-addbtn" :disabled="busy" @click="addBar.run()">
          <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5.5v13M5.5 12h13" />
          </svg>
          {{ addBar.label }}
        </button>
      </div>
    </div>

    <main class="rt-main">
      <!-- 数据没拉到：可点重试，一直挂到拉成功为止。
           拉失败时界面上的 0 和空列表会被当成"我的数据没了"，
           只弹一个会消失的 toast 兜不住这种误解。 -->
      <button v-if="loadFail" class="rt-alert rt-alert-bad" :disabled="busy" @click="refreshNow()">
        <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 7.6v5.2M12 16.2h.01" />
        </svg>
        <span class="rt-alert-tx">
          <span class="rt-t14s">没加载出来</span>
          <span class="rt-meta rt-alert-sub">{{ loadFail }}</span>
        </span>
        <span class="rt-meta rt-push" style="white-space:nowrap">{{ busy ? '重试中…' : '重试 →' }}</span>
      </button>

      <!-- 有新版：打开应用时自检发现的。点一下直接装（装完页面会立刻重载，横幅随之消失） -->
      <button v-if="page === 'home' && updateReady" class="rt-alert rt-alert-up"
        :disabled="updateApplying" @click="onApplyUpdate()">
        <svg class="rt-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3.8v10.4M7.6 10.2 12 14.6l4.4-4.4M4.6 19.4h14.8" />
        </svg>
        <span class="rt-alert-tx">
          <span class="rt-t14s">有新版本可用</span>
          <span class="rt-meta rt-alert-sub">
            新版 {{ fmtVer(updateReady.latest.version) }} · 当前 {{ fmtVer(updateReady.current) }}
          </span>
        </span>
        <span class="rt-meta rt-push" style="white-space:nowrap">
          {{ updateApplying ? '更新中…' : '更新 →' }}
        </span>
      </button>

      <!-- 五页常驻（v-show 才保状态：待办抽屉靠 ref 调 openNew()，重挂会把引用弄丢）。
           v-show 必须挂在 div 上，**不能挂在页面组件上**——
           这些页面的模板根是 Fragment（v-if / v-else 两端里不止一个元素），
           而 Vue 只把指令作用到"元素根"上（runtime-core 的 isElementRoot 不认 Fragment），
           挂上去会被静默跳过：五页会同时渲染，页签看着就像"点了没反应"。 -->
      <div v-show="page === 'home'">
        <HomePage @wizard="showWizard = true"
          @todo="goPage('todos', { top: true }); todosPage?.openNew()" @goal="openGoal"
          @goals="goPage('goals', { top: true })" />
      </div>
      <div v-show="page === 'todos'"><TodosPage ref="todosPage" /></div>
      <div v-show="page === 'goals'">
        <GoalsPage @wizard="showWizard = true" @goal="openGoal" @archive="openArchive" />
      </div>
      <div v-show="page === 'wishes'"><WishesPage ref="wishesPage" /></div>
      <div v-show="page === 'history'"><HistoryPage /></div>
    </main>

    <!-- ---------- 底部导航 ---------- -->
    <nav v-if="!isDesktopPlat" class="rt-tabbar">
      <div class="rt-tabbar-inner">
        <button v-for="p in PAGES" :key="p.key" class="rt-tab"
          :class="{ active: page === p.key }" @click="goPage(p.key)">
          <span class="rt-tab-ico">
            <svg v-if="p.key === 'home'" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.6 10.4 12 3.8l8.4 6.6" />
              <path d="M5.8 9.3V20h12.4V9.3" />
            </svg>
            <svg v-else-if="p.key === 'todos'" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="M4.4 6.6h2.4M4.4 12h2.4M4.4 17.4h2.4" />
              <path d="M10.6 6.6h9M10.6 12h9M10.6 17.4h9" />
            </svg>
            <svg v-else-if="p.key === 'goals'" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <circle cx="12" cy="12" r="8.3" />
              <circle cx="12" cy="12" r="3.4" />
            </svg>
            <svg v-else-if="p.key === 'wishes'" class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z" />
            </svg>
            <svg v-else class="rt-ico" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="8.3" />
              <path d="M12 7.4V12l3.2 1.9" />
            </svg>
            <span v-if="p.key === 'goals' && pendingGoals > 0" class="rt-tab-badge">
              {{ pendingGoals > 99 ? '99+' : pendingGoals }}
            </span>
          </span>
          <span>{{ p.label }}</span>
        </button>
      </div>
    </nav>

    <!-- ---------- 右下悬浮球（只在能"新增"的三页出现） ---------- -->
    <div v-if="!isDesktopPlat && fab" class="rt-fabwrap">
      <div class="rt-fabwrap-inner">
        <button class="rt-fab" :disabled="busy" :aria-label="fab.label" @click="fab.run()">
          <svg class="rt-ico" width="26" height="26" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5.5v13M5.5 12h13" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- ---------- 目标详情（全屏） ---------- -->
  <GoalDetail ref="detailRef" v-model:show="detailShow" :goal-id="detailId" />

  <!-- ---------- 立项向导（6 步换页） ---------- -->
  <GoalWizard v-model:show="showWizard" @done="onWizardDone" />

  <!-- ---------- 更多（底部抽屉） ---------- -->
  <van-popup v-model:show="showMore" position="bottom" round>
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">账号</div>
      <div class="rt-sheet-body">
        <p class="rt-meta" style="margin:0">{{ userEmail }}</p>
        <div class="rt-sheetlist" style="padding:0">
          <button class="rt-sheetitem" :disabled="busy" @click="refreshNow(); showMore = false">
            刷新数据
          </button>
          <button class="rt-sheetitem" @click="showMore = false; showPassword = true">
            设置密码
          </button>
          <!-- 应用内更新：只装在壳里才有意义（浏览器刷新就是最新）。
               桌面端要分两套号：桌面端是安装包版本，资源包是 OTA bundle 版本 -->
          <button v-if="isDesktopShell" class="rt-sheetitem" :disabled="updateBusy || busy"
            @click="onCheckUpdate()">
            <span>检查更新</span>
            <span class="rt-meta rt-push rt-num">
              桌面端 {{ shellVer || '—' }} · 资源包 {{ frontVer || '—' }}
            </span>
          </button>
          <button v-else-if="isNative" class="rt-sheetitem" :disabled="updateBusy || busy"
            @click="onCheckUpdate()">
            检查更新
            <span class="rt-meta rt-push rt-num">{{ currentVer || '—' }}</span>
          </button>
          <button class="rt-sheetitem rt-sheetitem-danger" @click="signOut()">退出登录</button>
        </div>
      </div>
    </div>
  </van-popup>

  <!-- ---------- 设置 / 修改密码（底部抽屉） ----------
       close-on-click-overlay=false：抽屉里在输密码，点一下旁边的暗色遮罩就整个收掉，
       刚敲的两遍密码白打。只留「取消」能收 -->
  <van-popup v-model:show="showPassword" position="bottom" round :close-on-click-overlay="false">
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">设置密码</div>
      <div class="rt-sheet-body">
        <p class="rt-meta" style="margin:0 0 12px">
          手机和网页都用它登录，不用再收验证码。
        </p>
        <van-field v-model="newPwd1" type="password" label="新密码" placeholder="至少 6 位" />
        <van-field v-model="newPwd2" type="password" label="再输一遍" placeholder="两次要一样"
          @keyup.enter="onChangePassword" />
        <div class="rt-sheet-actions">
          <button class="rbtn-primary" :disabled="busy || !newPwd1 || !newPwd2"
            @click="onChangePassword()">保存</button>
          <button class="rbtn" @click="showPassword = false">取消</button>
        </div>
      </div>
    </div>
  </van-popup>

  <!-- ---------- 开新存档（底部抽屉） ----------
       同上：里面有输入框，点空白不收，只留「取消」 -->
  <van-popup v-model:show="showArchive" position="bottom" round :close-on-click-overlay="false">
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">开新存档</div>
      <div class="rt-sheet-body">
        <van-field v-model="newArchiveName" placeholder="存档名" @keyup.enter="onCreateArchive" />
        <p class="rt-meta" style="margin:8px 0 0">
          活力值是全局的，开新档不会重置。
        </p>
        <div class="rt-sheet-actions">
          <button class="rbtn-primary" :disabled="busy || !newArchiveName.trim()"
            @click="onCreateArchive()">创建</button>
          <button class="rbtn" @click="showArchive = false">取消</button>
        </div>
      </div>
    </div>
  </van-popup>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { showFailToast, showLoadingToast, showSuccessToast, showToast } from 'vant'
import { useAuth } from './lib/auth'
import { onAppResume, registerBackButton, syncSystemBars } from './lib/native'
import {
  applyUpdate, checkForUpdate, currentVersion, fetchLatest, isDesktopShell, isNative,
  isUpdateConfigured,
} from './lib/updater'
import type { LatestInfo } from './lib/updater'
import { useTheme } from './lib/theme'
import {
  activeGoals, bindSignOut, busy, goals, loadFail, newArchive, refresh, resetAll,
} from './lib/store'
import LoginCard from './components/LoginCard.vue'
import HomePage from './components/HomePage.vue'
import TodosPage from './components/TodosPage.vue'
import GoalsPage from './components/GoalsPage.vue'
import WishesPage from './components/WishesPage.vue'
import HistoryPage from './components/HistoryPage.vue'
import GoalDetail from './components/GoalDetail.vue'
import GoalWizard from './components/GoalWizard.vue'
import { supabase } from './lib/supabase.ts'

const { session, loading, forceSignOut, passwordPending, setPassword } = useAuth()
const { theme, toggleTheme } = useTheme()

// 数据层出错要能把人踢回登录页 —— 把登出函数交进 store（见 store 的错误上报）
bindSignOut(forceSignOut)

const userEmail = computed(() => session.value?.user?.email ?? '')

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

/** 还没了结的目标数 —— 挂在「目标」页签上。
    口径必须跟目标页看到的一致：只算**当前这个存档**的，
    数全部存档的话角标会跟页面上几张卡对不上。 */
const pendingGoals = computed(() => activeGoals.value.length)

/** 右下悬浮球：只在需要"新增"的那三页出现，动作跟着页走 */
const fab = computed(() => {
  if (page.value === 'todos') {
    return { label: '记一条待办', run: () => todosPage.value?.openNew() }
  }
  if (page.value === 'goals') {
    return { label: '立一个新目标', run: () => { showWizard.value = true } }
  }
  if (page.value === 'wishes') {
    return { label: '加一个愿望', run: () => wishesPage.value?.openNew() }
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

const newArchiveName = ref('')
const newPwd1 = ref('')
const newPwd2 = ref('')

function openMore() { showMore.value = true; void loadCurrentVersion() }
function openGoal(id: string) { detailId.value = id; detailShow.value = true }

/** 开新档：名称必须自己填（自动叫「新档 3」那种名字，回头谁都认不出是哪个档） */
function openArchive() { newArchiveName.value = ''; showArchive.value = true }

async function onCreateArchive() {
  const n = newArchiveName.value.trim()
  if (!n) return
  await newArchive(n)
  showArchive.value = false
}

/** 向导立完目标：跳到目标页并把数据拉新（addGoal 自己只落库，不负责刷新） */
function onWizardDone() { page.value = 'goals'; void refresh() }

// ---------- 应用内更新（OTA，只更前端） ----------

const updateBusy = ref(false)
/** 自检发现的待装新版（null = 没发现 / 没检查） */
const updateReady = ref<{ latest: LatestInfo; current: string } | null>(null)
const updateApplying = ref(false)
const currentVer = ref('')
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
  currentVer.value = await currentVersion()
  currentVerLoaded = true
}

async function onCheckUpdate() {
  // 桌面壳（Tauri）：没有 OTA 这条路 —— 版本号在下面显示，更新走重装安装包
  if (isDesktopShell) {
    return showToast('桌面版暂不支持在线更新：装新安装包即可')
  }
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
  busy.value = true
  try {
    await setPassword(newPwd1.value)
    showSuccessToast('密码已更新，下次用新密码登录')
    showPassword.value = false
    newPwd1.value = ''
    newPwd2.value = ''
  } catch (e) {
    showFailToast((e as Error).message)
  } finally {
    busy.value = false
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
      detailShow.value = false
    },
    currentPage: () => page.value,
    goHome: () => { page.value = 'home' },
  })

  // 打开时自检一次；切回前台也再问一句（Android 上切回来不会重载 JS，
  // 光靠 onMounted 只覆盖了冷启动 —— 挂一天的应用等于从没检过）
  void autoCheckUpdate()
  stopResume = onAppResume(() => {
    void autoCheckUpdate()
    void refresh({ silent: true })
  })
})

onUnmounted(() => {
  if (settleTimer) clearInterval(settleTimer)
  if (clockTimer) clearInterval(clockTimer)
  stopResume?.()
})

// 壳里让系统栏图标跟着深浅主题走（浏览器上无副作用）
watch(theme, (t) => void syncSystemBars(t), { immediate: true })

watch(session, (s) => {
  if (s) void refresh()
  else resetAll()
}, { immediate: true })
</script>

<template>
  <!-- 会话恢复中：先别闪一下登录页 -->
  <div v-if="loading" class="app-bg rt-center">
    <span class="rt-meta">载入中…</span>
  </div>

  <LoginCard v-else-if="!session || passwordPending" />

  <div v-else class="rt">
    <!-- ---------- 顶部窄栏 ---------- -->
    <header class="rt-appbar">
      <div class="rt-appbar-inner">
        <span class="rt-brand">RTarget</span>
        <span class="rt-meta rt-num" style="margin-top:3px">{{ clock }}</span>
        <span class="rt-push"></span>

        <button class="rt-iconbtn" :disabled="busy" aria-label="刷新" @click="refresh()">
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

    <main class="rt-main">
      <!-- 数据没拉到：可点重试，一直挂到拉成功为止。
           拉失败时界面上的 0 和空列表会被当成"我的数据没了"，
           只弹一个会消失的 toast 兜不住这种误解。 -->
      <button v-if="loadFail" class="rt-alert rt-alert-bad" :disabled="busy" @click="refresh()">
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
          @todo="page = 'todos'; todosPage?.openNew()" @goal="openGoal"
          @goals="page = 'goals'" />
      </div>
      <div v-show="page === 'todos'"><TodosPage ref="todosPage" /></div>
      <div v-show="page === 'goals'">
        <GoalsPage @wizard="showWizard = true" @goal="openGoal" @archive="openArchive" />
      </div>
      <div v-show="page === 'wishes'"><WishesPage ref="wishesPage" /></div>
      <div v-show="page === 'history'"><HistoryPage /></div>
    </main>

    <!-- ---------- 底部导航 ---------- -->
    <nav class="rt-tabbar">
      <div class="rt-tabbar-inner">
        <button v-for="p in PAGES" :key="p.key" class="rt-tab"
          :class="{ active: page === p.key }" @click="page = p.key">
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
    <div v-if="fab" class="rt-fabwrap">
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
  <GoalDetail v-model:show="detailShow" :goal-id="detailId" />

  <!-- ---------- 立项向导（6 步换页） ---------- -->
  <GoalWizard v-model:show="showWizard" @done="onWizardDone" />

  <!-- ---------- 更多（底部抽屉） ---------- -->
  <van-popup v-model:show="showMore" position="bottom" round>
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">账号</div>
      <div class="rt-sheet-body">
        <p class="rt-meta" style="margin:0">{{ userEmail }}</p>
        <div class="rt-sheetlist" style="padding:0">
          <button class="rt-sheetitem" :disabled="busy" @click="refresh(); showMore = false">
            刷新数据
          </button>
          <button class="rt-sheetitem" @click="showMore = false; showPassword = true">
            设置密码
          </button>
          <!-- 应用内更新：只装在壳里才有意义（浏览器刷新就是最新） -->
          <button v-if="isNative || isDesktopShell" class="rt-sheetitem" :disabled="updateBusy || busy"
            @click="onCheckUpdate()">
            检查更新
            <span class="rt-meta rt-push rt-num">{{ currentVer || '—' }}</span>
          </button>
          <button class="rt-sheetitem rt-sheetitem-danger" @click="signOut()">退出登录</button>
        </div>
      </div>
    </div>
  </van-popup>

  <!-- ---------- 设置 / 修改密码（底部抽屉） ---------- -->
  <van-popup v-model:show="showPassword" position="bottom" round>
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

  <!-- ---------- 开新存档（底部抽屉） ---------- -->
  <van-popup v-model:show="showArchive" position="bottom" round>
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
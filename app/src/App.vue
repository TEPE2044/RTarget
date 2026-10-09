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
import { bindSignOut, busy, goals, loadFail, refresh, resetAll } from './lib/store'
import LoginCard from './components/LoginCard.vue'
import HomePage from './components/HomePage.vue'
import TodosPage from './components/TodosPage.vue'
import GoalsPage from './components/GoalsPage.vue'
import WishesPage from './components/WishesPage.vue'
import HistoryPage from './components/HistoryPage.vue'
import GoalDetail from './components/GoalDetail.vue'
import GoalWizard from './components/GoalWizard.vue'

const { session, loading, signOut, forceSignOut, passwordPending, setPassword } = useAuth()
const { theme, toggleTheme } = useTheme()

// 数据层出错要能把人踢回登录页 —— 把登出函数交进 store（见 store 的错误上报）
bindSignOut(forceSignOut)

const userEmail = computed(() => session.value?.user?.email ?? '')

// ---------- 页面 ----------

type PageKey = 'home' | 'todos' | 'goals' | 'wishes' | 'history'
const page = ref<PageKey>('home')

function onTabChange(name: number | string) {
  page.value = name as PageKey
}

const todosPage = ref<InstanceType<typeof TodosPage> | null>(null)

// ---------- 浮层 ----------

const showMore = ref(false)
const showPassword = ref(false)
const showWizard = ref(false)
const detailShow = ref(false)
const detailId = ref<string | null>(null)

const newPwd1 = ref('')
const newPwd2 = ref('')

function openTodo() { todosPage.value?.openNew() }
function openGoal(id: string) { detailId.value = id; detailShow.value = true }
function openMore() { showMore.value = true; void loadCurrentVersion() }
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

// ---------- 生命周期 ----------

let settleTimer: ReturnType<typeof setInterval> | null = null
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
  settleTimer = setInterval(autoSettleIfExpired, 30_000)

  // 只有装进壳里才生效，浏览器上是空操作
  registerBackButton({
    hasModalOpen: () =>
      showMore.value || showPassword.value || showWizard.value || detailShow.value,
    closeModal: () => {
      showMore.value = false
      showPassword.value = false
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
  <div v-if="loading"
    style="height:100dvh;display:flex;align-items:center;justify-content:center;color:var(--ink-3);font-size:13px">
    载入中…
  </div>

  <LoginCard v-else-if="!session || passwordPending" />

  <div v-else class="app">
    <div class="views">
      <div v-show="page === 'home'" class="view">
        <HomePage @more="openMore" @wizard="showWizard = true" @todo="openTodo" @goal="openGoal" />
      </div>
      <div v-show="page === 'todos'" class="view">
        <TodosPage ref="todosPage" />
      </div>
      <div v-show="page === 'goals'" class="view">
        <GoalsPage @wizard="showWizard = true" @goal="openGoal" />
      </div>
      <div v-show="page === 'wishes'" class="view">
        <WishesPage />
      </div>
      <div v-show="page === 'history'" class="view">
        <HistoryPage />
      </div>
    </div>

    <!-- 数据没拉到：可点重试，一直挂到拉成功为止。
         拉失败时界面上的 0 和空列表会被当成"我的数据没了"，
         只弹一个会消失的 toast 兜不住这种误解。 -->
    <van-notice-bar v-if="loadFail" wrapable :scrollable="false" left-icon="warning-o"
      mode="link" :text="loadFail" @click="refresh()" />

    <!-- 有新版：打开应用时自检发现的。点一下直接装（装完页面会立刻重载，横幅随之消失） -->
    <van-notice-bar v-if="page === 'home' && updateReady" wrapable :scrollable="false"
      left-icon="down" mode="link"
      :text="`有新版本 ${fmtVer(updateReady.latest.version)}（当前 ${fmtVer(updateReady.current)}）—— 点这里更新`"
      @click="onApplyUpdate" />

    <van-tabbar :model-value="page" safe-area-inset-bottom @change="onTabChange">
      <van-tabbar-item name="home" icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item name="todos" icon="todo-list-o">待办</van-tabbar-item>
      <van-tabbar-item name="goals" icon="aim">目标</van-tabbar-item>
      <van-tabbar-item name="wishes" icon="star-o">愿望</van-tabbar-item>
      <van-tabbar-item name="history" icon="clock-o">历史</van-tabbar-item>
    </van-tabbar>
  </div>

  <!-- ---------- 目标详情（全屏） ---------- -->
  <GoalDetail v-model:show="detailShow" :goal-id="detailId" />

  <!-- ---------- 立项向导（6 步换页） ---------- -->
  <GoalWizard v-model:show="showWizard" @done="onWizardDone" />

  <!-- ---------- 更多（底部抽屉） ---------- -->
  <van-popup v-model:show="showMore" position="bottom" round>
    <div class="sheet">
      <div class="sheet-head">账号</div>
      <p style="margin:0 16px 12px;font-size:12px;color:var(--ink-3)">{{ userEmail }}</p>
      <van-cell-group inset>
        <van-cell title="刷新数据" is-link :clickable="!busy" @click="refresh(); showMore = false" />
        <van-cell title="设置密码" is-link @click="showMore = false; showPassword = true" />
        <!-- 更新：手机壳里是 OTA 检查；桌面壳里显示安装包版本、点了给"重装即更新"的提示 -->
        <van-cell v-if="isNative || isDesktopShell" title="检查更新" is-link
          :value="currentVer || '—'" :clickable="!(updateBusy || busy)" @click="onCheckUpdate" />
        <van-cell :title="theme === 'dark' ? '切换成浅色' : '切换成深色'" is-link @click="toggleTheme" />
      </van-cell-group>
      <div style="padding:14px 16px calc(12px + var(--rt-safe-bottom))">
        <van-button block plain type="danger" @click="signOut()">退出登录</van-button>
      </div>
    </div>
  </van-popup>

  <!-- ---------- 设置 / 修改密码（底部抽屉） ---------- -->
  <van-popup v-model:show="showPassword" position="bottom" round>
    <div class="sheet">
      <div class="sheet-head">设置密码</div>
      <p style="margin:0 16px 12px;font-size:12px;color:var(--ink-3)">
        设完之后手机和网页都能用这个密码登录，不用再收验证码。
      </p>
      <van-field v-model="newPwd1" type="password" label="新密码" placeholder="至少 6 位" />
      <van-field v-model="newPwd2" type="password" label="再输一遍" placeholder="两次要一样"
        @keyup.enter="onChangePassword" />
      <div style="padding:14px 16px calc(12px + var(--rt-safe-bottom))">
        <van-button block type="primary" :disabled="busy || !newPwd1 || !newPwd2"
          @click="onChangePassword">保存</van-button>
      </div>
    </div>
  </van-popup>
</template>
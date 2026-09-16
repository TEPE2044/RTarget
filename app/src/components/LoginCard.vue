<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { friendlyError, useAuth } from '../lib/auth'

/**
 * 登录 / 注册
 *
 * 两个模式：
 * - 「登录」：邮箱 + 密码，日常快速路径
 * - 「邮箱验证码」：邮箱 → 6 位验证码 → 设密码。
 *   注册、补密码、忘记密码三件事都走它（验证完一律重设密码）。
 *
 * 没有魔法链接 —— 验证码不需要点链接，任何端、任何邮件 App 都能用。
 */
const props = defineProps<{
  /** 仅 dev 预览页用：直接跳到某一步，方便无头截图看排版（不调接口） */
  devPreview?: 'login' | 'code-email' | 'code-verify' | 'code-password' | null
}>()

const {
  sendCode, verifyCode, setPassword, signInWithPassword,
  passwordPending, authError, forceSignOut,
} = useAuth()

type Mode = 'login' | 'code'
type Step = 'email' | 'verify' | 'password'

const devIsCode = props.devPreview?.startsWith('code') ?? false
const devStep = props.devPreview?.split('-')[1] as Step | undefined

const mode = ref<Mode>(devIsCode ? 'code' : 'login')
const step = ref<Step>(devIsCode ? (devStep ?? 'email') : 'email')

const email = ref('')
const password = ref('')
const token = ref('')
const pwd1 = ref('')
const pwd2 = ref('')
const error = ref('')
const busy = ref(false)

// dev 预览页填上假数据，截图才看得出真实状态（按钮该亮的时候是亮的）
if (props.devPreview) {
  email.value = 'jackie@rtarget.app'
  if (props.devPreview === 'login') password.value = 'rt-2026'
  if (props.devPreview === 'code-verify') token.value = '482913'
  if (props.devPreview === 'code-password') { pwd1.value = 'rt-2026'; pwd2.value = 'rt-2026' }
}

/** 重发冷却：Supabase 本身也是每个邮箱 60 秒一次，前端先挡住，省得白撞报错 */
const cooldown = ref(0)
let cdTimer: ReturnType<typeof setInterval> | null = null

/** 设密码的窗口：超时就登出，避免会话一直挂在一个"半注册"状态上 */
const PWD_WINDOW = 600
const pwdLeft = ref(PWD_WINDOW)
let pwdTimer: ReturnType<typeof setInterval> | null = null

const shownError = computed(() => error.value || authError.value)
const codeOk = computed(() => /^\d{6}$/.test(token.value.trim()))
const canSubmitPwd = computed(() => pwd1.value.length >= 6 && pwd1.value === pwd2.value)
const pwdLeftText = computed(() => {
  const m = Math.floor(pwdLeft.value / 60)
  const s = pwdLeft.value % 60
  return `剩余 ${m}:${String(s).padStart(2, '0')}`
})

function clearTimers() {
  if (cdTimer) { clearInterval(cdTimer); cdTimer = null }
  if (pwdTimer) { clearInterval(pwdTimer); pwdTimer = null }
}
onUnmounted(clearTimers)

function startCooldown() {
  cooldown.value = 60
  if (cdTimer) clearInterval(cdTimer)
  cdTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) { clearInterval(cdTimer!); cdTimer = null }
  }, 1000)
}

function startPwdWindow() {
  pwdLeft.value = PWD_WINDOW
  if (pwdTimer) clearInterval(pwdTimer)
  pwdTimer = setInterval(() => {
    pwdLeft.value -= 1
    if (pwdLeft.value <= 0) {
      clearInterval(pwdTimer!); pwdTimer = null
      giveUp('设置密码超时了，请重新验证一次')
    }
  }, 1000)
}

/**
 * 兜底：万一组件重新挂载时"会话已建立、密码还没设"，直接钉在设密码那步。
 *
 * 注意这里**不能改成 watch(passwordPending)** —— 那样会出大 bug：
 * verifyCode 为了避免闪屏，是「先把 passwordPending 立起来、再去验证」的，
 * 所以 watcher 会在验证还没出结果时就把界面推到"设密码"，
 * 一旦验证失败（验证码乱输），界面就停在设密码那步了 —— 看着像"乱输也能过"。
 * 推进步骤只能由 doVerify 在**确实成功之后**自己做。
 */
if (passwordPending.value) {
  mode.value = 'code'
  step.value = 'password'
  startPwdWindow()
}

function switchMode(m: Mode) {
  if (mode.value === m) return
  mode.value = m
  error.value = ''
  if (m === 'code') step.value = 'email'
  clearTimers()
}

function backToEmail() {
  step.value = 'email'
  token.value = ''
  error.value = ''
  clearTimers()
}

async function giveUp(tip = '已退出，随时可以再来') {
  clearTimers()
  await forceSignOut()
  mode.value = devIsCode ? 'code' : 'login'
  step.value = 'email'
  pwd1.value = ''
  pwd2.value = ''
  message.info(tip)
}

// ---------- 动作 ----------

async function doSendCode() {
  error.value = ''
  if (!email.value.trim()) return (error.value = '先填邮箱')
  if (cooldown.value > 0) return
  if (props.devPreview) { step.value = 'verify'; return }

  busy.value = true
  try {
    await sendCode(email.value)
    step.value = 'verify'
    startCooldown()
    message.success('验证码已发出')
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function doVerify() {
  error.value = ''
  if (!codeOk.value) return (error.value = '验证码是 6 位数字')
  if (props.devPreview) { step.value = 'password'; startPwdWindow(); return }

  busy.value = true
  try {
    await verifyCode(email.value, token.value)
    // 只有真的验证通过才推进 —— 见上面那段注释，这里不能省
    step.value = 'password'
    startPwdWindow()
  } catch (e) {
    error.value = friendlyError(e)
    // 验证失败必须把界面退回输码那一步，并停掉已经开始的倒计时
    step.value = 'verify'
    clearTimers()
    startCooldown()
  } finally {
    busy.value = false
  }
}

async function doSetPassword() {
  error.value = ''
  if (pwd1.value.length < 6) return (error.value = '密码至少 6 位')
  if (pwd1.value !== pwd2.value) return (error.value = '两次输的不一样')
  // 不靠界面状态保证安全：没有"验证过"的会话就不允许设密码
  if (!passwordPending.value && !props.devPreview) {
    step.value = 'verify'
    return (error.value = '还没验证邮箱，先输一次验证码')
  }

  busy.value = true
  try {
    if (props.devPreview) return
    await setPassword(pwd1.value)
    clearTimers()
    message.success('密码已设置，之后手机和网页都用它登录')
    // 成功后 passwordPending 变 false，App.vue 自动切到主界面
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function doLogin() {
  error.value = ''
  if (!email.value.trim() || !password.value) return (error.value = '邮箱和密码都要填')

  busy.value = true
  try {
    if (props.devPreview) return
    await signInWithPassword(email.value, password.value)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="app-bg rt-login">
    <div class="rt-login-box">
      <div class="rt-login-brand">
        <div class="rt-login-logo">RTarget</div>
        <div class="rt-meta">懒人自驱动 · 奖罚迭代</div>
      </div>

      <div class="rt-card" style="padding: 16px">
        <!-- 模式切换 -->
        <div class="rt-seg" style="margin-bottom: 16px">
          <button type="button" class="rt-segbtn" :class="{ active: mode === 'login' }"
            @click="switchMode('login')">
            <span class="rt-meta">账号密码登录</span>
          </button>
          <button type="button" class="rt-segbtn" :class="{ active: mode === 'code' }"
            @click="switchMode('code')">
            <span class="rt-meta">邮箱验证码登录</span>
            
          </button>
        </div>

        <!-- ============ 登录：邮箱 + 密码 ============ -->
        <a-form v-if="mode === 'login'" layout="vertical" @submit.prevent="doLogin">
          <a-form-item label="邮箱">
            <a-input v-model:value="email" size="large" placeholder="you@example.com"
              @pressEnter="doLogin" />
          </a-form-item>
          <a-form-item label="密码">
            <a-input-password v-model:value="password" size="large" placeholder="至少 6 位"
              @pressEnter="doLogin" />
          </a-form-item>
          <button type="button" class="rbtn-primary rbtn-lg" style="width: 100%"
            :disabled="busy || !email || !password" @click="doLogin()">
            {{ busy ? '登录中…' : '登录' }}
          </button>
          <p class="rt-meta" style="margin: 12px 0 0">
            忘了密码？切换至「邮箱验证码」即可解决！
          </p>
        </a-form>

        <!-- ============ 验证码 第 1 步：填邮箱 ============ -->
        <a-form v-else-if="step === 'email'" layout="vertical" @submit.prevent="doSendCode">
          <a-form-item label="邮箱">
            <a-input v-model:value="email" size="large" placeholder="you@example.com"
              @pressEnter="doSendCode" />
          </a-form-item>
          <button type="button" class="rbtn-primary rbtn-lg" style="width: 100%"
            :disabled="busy || !email" @click="doSendCode()">
            {{ busy ? '发送中…' : '发送验证码' }}
          </button>
          <!-- <p class="rt-meta" style="margin: 12px 0 0">
            第一次填就是注册。验证码通过后会让你设密码，设完手机和网页都能用密码登录。
          </p> -->
        </a-form>

        <!-- ============ 验证码 第 2 步：输 6 位码 ============ -->
        <a-form v-else-if="step === 'verify'" layout="vertical" @submit.prevent="doVerify">
          <p class="rt-meta" style="margin: 0 0 12px">
            验证码已发到 <span style="color: var(--rt-tx)">{{ email }}</span>
          </p>
          <a-form-item label="6 位验证码">
            <a-input v-model:value="token" class="rt-code" size="large" :maxlength="6"
              inputmode="numeric" placeholder="000000" @pressEnter="doVerify" />
          </a-form-item>
          <button type="button" class="rbtn-primary rbtn-lg" style="width: 100%"
            :disabled="busy || !codeOk" @click="doVerify()">
            {{ busy ? '验证中…' : '验证' }}
          </button>
          <div style="display: flex; gap: 8px; margin-top: 10px">
            <button type="button" class="rbtn rt-flex1" :disabled="cooldown > 0 || busy"
              @click="doSendCode()">
              {{ cooldown > 0 ? `重新发送（${cooldown}s）` : '重新发送' }}
            </button>
            <button type="button" class="rbtn rt-flex1" @click="backToEmail">换个邮箱</button>
          </div>
          <p class="rt-meta" style="margin: 12px 0 0">
            没收到？翻一下垃圾邮件。验证码 1 小时内有效，且只能用一次。
          </p>
        </a-form>

        <!-- ============ 验证码 第 3 步：设密码 ============ -->
        <a-form v-else layout="vertical" @submit.prevent="doSetPassword">
          <p class="rt-meta" style="margin: 0 0 12px">
            邮箱已验证。设一个密码 —— 手机和网页都用它登录，不用再收验证码。
          </p>
          <a-form-item label="设置密码（至少 6 位）">
            <a-input-password v-model:value="pwd1" size="large" placeholder="想一个记得住的" />
          </a-form-item>
          <a-form-item label="再输一遍">
            <a-input-password v-model:value="pwd2" size="large" @pressEnter="doSetPassword" />
          </a-form-item>
          <button type="button" class="rbtn-primary rbtn-lg" style="width: 100%"
            :disabled="busy || !canSubmitPwd" @click="doSetPassword()">
            {{ busy ? '保存中…' : '设好了，进入应用' }}
          </button>
          <div style="display: flex; align-items: center; margin-top: 10px">
            <button type="button" class="rbtn" @click="giveUp()">放弃</button>
            <span class="rt-meta rt-push">{{ pwdLeftText }}</span>
          </div>
        </a-form>

        <p v-if="shownError" class="rt-login-err">{{ shownError }}</p>
      </div>

    </div>
  </div>
</template>

<style scoped>
.rt-login {
  display: flex;
  align-items: center;
  justify-content: center;
}

.rt-login-box { width: 100%; max-width: 380px; }

.rt-login-brand { text-align: center; margin-bottom: 20px; }
.rt-login-logo { font-size: 24px; font-weight: 500; letter-spacing: 0.02em; }

/* 验证码：等宽、居中、拉开字距，一眼能数清几位 */
.rt-code :deep(input) {
  text-align: center;
  letter-spacing: 8px;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.rt-login-err {
  margin: 14px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--rt-red-bg);
  color: var(--rt-red);
  font-size: 12px;
  line-height: 1.5;
}
</style>

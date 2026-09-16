import { ref, readonly } from 'vue'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

/**
 * 登录态
 *
 * 流程定稿（2026-09-16）：**彻底不用魔法链接**，回归基本功 ——
 *
 *   1. 填邮箱 → 发 6 位验证码
 *   2. 输了验证码 → 邮箱算验证过，拿到会话
 *   3. 立刻要求设置密码 → 设完才进应用
 *
 * 为什么是这个流程：验证码就是邮件里的一串数字，不需要点链接，
 * 所以不受"邮件客户端内置浏览器拦自定义 scheme"那一类问题影响 ——
 * 手机、电脑、任何邮件 App 都一样。注册 / 补密码 / 忘记密码三件事
 * 也被这一个流程全覆盖了（验证完一律重设密码）。
 *
 * 实现注意（错一个就白干）：
 * - verifyOtp 的 type 必须是 'email'（不是 'magiclink'）
 * - 调 signInWithOtp 时**不要传 emailRedirectTo** —— 传了 Supabase 就会
 *   发链接而不是验证码
 * - 邮件模板里必须出现 {{ .Token }}（Supabase 后台改，见 README）
 */

// ---------- 状态 ----------

const session = ref<Session | null>(null)
const loading = ref(true)

/**
 * 「验证码过了、但还没设密码」。
 *
 * 存在的意义：verifyOtp 一成功，supabase 就建立会话了，主界面会立刻露出来。
 * 所以 App.vue 的登录门要按这个标记再挡一道（见 App.vue 的 v-else-if）。
 * 纯内存态：应用被杀掉后重开会话仍在、这个标记为 false，就直接进应用了 ——
 * 那时邮箱已验证，属于本人，不构成风险；想设密码可以去「更多 → 设置密码」。
 */
const passwordPending = ref(false)

/** 不是用户点按钮触发的错误（比如登录态失效）也往这里放 */
const authError = ref('')

/**
 * 把 Supabase 的英文报错翻成人话。
 * 这几个是实际会撞到的，剩下的原样透出（至少能搜）。
 */
export function friendlyError(e: unknown): string {
  const raw = (e as { message?: string })?.message ?? String(e)
  const map: [RegExp, string][] = [
    [/rate limit|too many requests/i, '发送太频繁了 —— Supabase 限制每个邮箱 60 秒一次，等一会儿再试'],
    [/token has expired or is invalid/i, '验证码不对或已过期，重新发一个吧'],
    [/invalid login credentials/i, '邮箱或密码不对'],
    [/email not confirmed/i, '这个邮箱还没验证过，请用「邮箱验证码」走一遍'],
    [/user already registered/i, '这个邮箱已经注册过了，直接用密码登录，或走验证码重设密码'],
    [/password should be at least/i, '密码太短了（至少 6 位）'],
    [/unable to validate email|invalid format/i, '邮箱格式不对'],
    [/failed to fetch|network/i, '连不上服务，检查下网络'],
  ]
  for (const [re, zh] of map) if (re.test(raw)) return zh
  return raw
}

/**
 * 本地强制登出。
 * 用 scope: 'local' 只清本地存储，不请求服务端 —— 账号已被删除时服务端调用必然失败，
 * 但只要本地清干净，界面就能回到登录页。
 */
async function forceSignOut() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // 服务端报错无所谓，本地清掉就够了
  }
  session.value = null
  passwordPending.value = false
}

supabase.auth.onAuthStateChange((event, s) => {
  // SIGNED_OUT（含 token 刷新失败后 supabase 主动登出）一律落到 null，
  // 界面随即切回登录页；此时不要再调 signOut，否则会递归触发本回调
  session.value = event === 'SIGNED_OUT' ? null : s
  loading.value = false
})

// 初始会话恢复（刷新页面后保持登录）
supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
  loading.value = false
})

/**
 * 主动校验登录态是否真的还有效。
 * 为什么需要它：账号被删除时本地 JWT 仍然"有效"，supabase 不会发任何事件，
 * 只有真正打到服务端的请求才会暴露问题。所以必须有人主动去问一次。
 */
async function validateSession(): Promise<boolean> {
  if (!session.value) return false
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      await forceSignOut()
      return false
    }
    return true
  } catch {
    await forceSignOut()
    return false
  }
}

/** 判断一个错误是不是"登录态失效"导致的 */
export function isAuthError(e: unknown): boolean {
  if (!e) return false
  const err = e as { status?: number; code?: string; message?: string; error_description?: string }
  if (err.status === 401 || err.status === 403) return true
  const text = `${err.code ?? ''} ${err.message ?? ''} ${err.error_description ?? ''}`
  return /未登录|未认证|not authenticated|invalid.*(token|jwt)|jwt expired|user ?not ?found|refresh token/i.test(text)
}

// 页面重新可见时校验一次：token 可能在后台过期，账号也可能在此期间被删掉
let validating = false
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || validating) return
  if (!session.value) return
  validating = true
  try {
    await validateSession()
  } finally {
    validating = false
  }
})

// ---------- 邮箱验证码 ----------

/**
 * 发验证码到邮箱。新邮箱会自动建号（shouldCreateUser 默认 true）——
 * 这正是想要的：先把号建出来（此时未验证、无密码、进不去任何数据），
 * 验证码一过就要求设密码，设完才算真的注册完成。
 *
 * **绝对不要传 emailRedirectTo**：传了 Supabase 就会把邮件内容换成登录链接，
 * 用户收到的就不是验证码了。
 */
async function sendCode(email: string) {
  authError.value = ''
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  })
  if (error) throw error
}

/**
 * 校验验证码。类型必须是 'email'。
 *
 * 先立门再验：verifyOtp 一成功会话就有了，如果等 await 回来才设
 * passwordPending，中间那一帧会闪进主界面。
 */
async function verifyCode(email: string, token: string) {
  passwordPending.value = true
  try {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email',
    })
    if (error) throw error
  } catch (e) {
    passwordPending.value = false
    throw e
  }
}

/**
 * 设置密码（需要有会话 —— 也就是验证码刚过那段，或已登录状态下改密码）。
 * 设完把门打开，进入应用。
 */
async function setPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  passwordPending.value = false
}

// ---------- 邮箱密码登录 ----------

async function signInWithPassword(email: string, password: string) {
  authError.value = ''
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
}

async function signOut() {
  await supabase.auth.signOut()
  passwordPending.value = false
}

export function useAuth() {
  return {
    session: readonly(session),
    loading: readonly(loading),
    passwordPending: readonly(passwordPending),
    authError: readonly(authError),
    sendCode,
    verifyCode,
    setPassword,
    signInWithPassword,
    signOut,
    forceSignOut,
    validateSession,
  }
}

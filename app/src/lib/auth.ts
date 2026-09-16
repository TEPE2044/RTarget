import { ref, readonly } from 'vue'
import { App as CapApp } from '@capacitor/app'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'
import { isNative } from './native'

// ---------- 登录态 ----------

const session = ref<Session | null>(null)
const loading = ref(true)
const sentMagicLink = ref(false)
/**
 * 深链回调失败时的提示。
 * 这类错误不是用户点按钮触发的（是邮件链接跳回来才发生的），
 * 没法走 LoginCard 自己的 try/catch，所以单独留一个出口给界面看。
 */
const authError = ref('')

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
  sentMagicLink.value = false
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

// ---------- 壳里的魔法链接回跳（深链） ----------

/**
 * 应用自己的 URL scheme。
 * 三处必须保持一致，缺一处邮件链接就点不开应用：
 *   1. 这里的常量
 *   2. android/app/src/main/AndroidManifest.xml 里的 intent-filter（scheme + host）
 *   3. Supabase 后台 Authentication → URL Configuration → Redirect URLs
 */
const NATIVE_REDIRECT = 'com.rtarget.app://login-callback'

/** 浏览器上用当前站点；壳里用自定义 scheme */
function redirectTo(): string {
  return isNative ? NATIVE_REDIRECT : window.location.origin
}

/**
 * 处理从邮件链接回跳进来的 URL。
 *
 * Supabase 验证完会把凭据塞在 fragment 里带回来：
 *   com.rtarget.app://login-callback#access_token=...&refresh_token=...
 *
 * 壳里根本没有"页面 URL"这回事，supabase 自带的 detectSessionInUrl 帮不上忙，
 * 只能自己把 token 捞出来交给 setSession。
 */
async function handleAuthDeepLink(url: string) {
  if (!url.startsWith(NATIVE_REDIRECT)) return

  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : (url.split('?')[1] ?? '')
  const params = new URLSearchParams(hash)

  // 验证失败时 Supabase 会把原因带回来。先把它抛出去 ——
  // 否则用户只会看到"点了链接没反应"，没法排查。
  const reason = params.get('error_description') ?? params.get('error')
  if (reason) throw new Error(decodeURIComponent(reason.replace(/\+/g, ' ')))

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) {
    throw new Error('回调链接里没有登录凭据，可能是链接已过期或已经用过一次了')
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (error) throw error

  sentMagicLink.value = false
}

if (isNative) {
  CapApp.addListener('appUrlOpen', async ({ url }) => {
    authError.value = ''
    try {
      await handleAuthDeepLink(url)
    } catch (e) {
      authError.value = (e as Error).message
    }
  })
}

// ---------- 魔法链接登录 ----------

/** 发送魔法链接到邮箱（单人自用：邮箱即身份） */
async function sendMagicLink(email: string) {
  sentMagicLink.value = false
  authError.value = ''
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // 从哪台设备发起就用哪边的回调地址：
      // 手机上点链接应该跳回应用，电脑上点应该跳回网页
      emailRedirectTo: redirectTo(),
    },
  })
  if (error) throw error
  sentMagicLink.value = true
}

// ---------- 邮箱密码登录（本地测试账号，绕开邮件限流） ----------

async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

async function signOut() {
  await supabase.auth.signOut()
}

export function useAuth() {
  return {
    session: readonly(session),
    loading: readonly(loading),
    sentMagicLink: readonly(sentMagicLink),
    authError: readonly(authError),
    sendMagicLink,
    signInWithPassword,
    signOut,
    forceSignOut,
    validateSession,
  }
}

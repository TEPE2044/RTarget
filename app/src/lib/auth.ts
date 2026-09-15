import { ref, readonly } from 'vue'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

// ---------- 登录态 ----------

const session = ref<Session | null>(null)
const loading = ref(true)
const sentMagicLink = ref(false)

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

// ---------- 魔法链接登录 ----------

/** 发送魔法链接到邮箱（单人自用：邮箱即身份） */
async function sendMagicLink(email: string) {
  sentMagicLink.value = false
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
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
    sendMagicLink,
    signInWithPassword,
    signOut,
    forceSignOut,
    validateSession,
  }
}

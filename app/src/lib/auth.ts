import { ref, readonly } from 'vue'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

// ---------- 登录态 ----------

const session = ref<Session | null>(null)
const loading = ref(true)

supabase.auth.onAuthStateChange((_event, s) => {
  session.value = s
  loading.value = false
})

// 初始会话恢复（刷新页面后保持登录）
supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
  loading.value = false
})

// ---------- 魔法链接登录 ----------

const sentMagicLink = ref(false)

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
  }
}

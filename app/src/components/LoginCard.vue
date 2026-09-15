<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../lib/auth'

const { sendMagicLink, sentMagicLink, signInWithPassword, loading } = useAuth()
const email = ref('')
const password = ref('')
const sending = ref(false)
const error = ref('')
const mode = ref<'magic' | 'password'>('magic')

async function submit() {
  error.value = ''
  sending.value = true
  try {
    if (mode.value === 'magic') {
      await sendMagicLink(email.value)
    } else {
      await signInWithPassword(email.value, password.value)
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 flex items-center justify-center p-6">
    <div class="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      <h2 class="text-2xl font-bold text-slate-100 mb-1 text-center">RTarget</h2>
      <p class="text-sm text-slate-500 mb-6 text-center">懒人自驱动</p>

      <!-- 模式切换 -->
      <div class="flex mb-5 rounded-lg bg-slate-800 p-1 text-sm">
        <button
          :class="mode === 'magic' ? 'bg-slate-600 text-white' : 'text-slate-400'"
          class="flex-1 py-1.5 rounded-md transition"
          @click="mode = 'magic'">魔法链接</button>
        <button
          :class="mode === 'password' ? 'bg-slate-600 text-white' : 'text-slate-400'"
          class="flex-1 py-1.5 rounded-md transition"
          @click="mode = 'password'">密码登录</button>
      </div>

      <form v-if="!sentMagicLink" @submit.prevent="submit" class="space-y-3">
        <input v-model="email" type="email" placeholder="邮箱" required
          :disabled="sending || loading"
          class="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
        <input v-if="mode === 'password'" v-model="password" type="password" placeholder="密码" required
          :disabled="sending || loading"
          class="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
        <button type="submit" :disabled="sending || loading || !email || (mode === 'password' && !password)"
          class="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-40">
          {{ sending ? '请稍候…' : mode === 'magic' ? '发送魔法链接' : '登录' }}
        </button>
      </form>

      <p v-if="sentMagicLink && mode === 'magic'" class="text-sm leading-7 text-emerald-400 text-center">
        链接已发送 → 收件箱点一下即可进入<br />
        <span class="text-slate-500 text-xs">没收到？查一下垃圾邮件</span>
      </p>
      <p v-if="error" class="text-sm text-red-400 mt-3 text-center">{{ error }}</p>
    </div>
  </div>
</template>

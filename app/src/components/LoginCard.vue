<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../lib/auth'

const { sendMagicLink, sentMagicLink, loading } = useAuth()
const email = ref('')
const sending = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  sending.value = true
  try {
    await sendMagicLink(email.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 flex items-center justify-center p-6">
    <div class="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
      <h2 class="text-2xl font-bold text-slate-100 mb-2">RTarget</h2>
      <p class="text-sm text-slate-500 mb-8">懒人自驱动 · 输入邮箱收魔法链接</p>

      <form v-if="!sentMagicLink" @submit.prevent="submit" class="space-y-3">
        <input v-model="email" type="email" placeholder="你的邮箱" required
          :disabled="sending || loading"
          class="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
        <button type="submit" :disabled="sending || loading || !email"
          class="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-40">
          {{ sending ? '发送中…' : '发送魔法链接' }}
        </button>
      </form>

      <p v-if="sentMagicLink" class="text-sm leading-7 text-emerald-400">
        链接已发送 → 收件箱点一下即可进入<br />
        <span class="text-slate-500 text-xs">没收到？查一下垃圾邮件</span>
      </p>
      <p v-if="error" class="text-sm text-red-400 mt-3">{{ error }}</p>
    </div>
  </div>
</template>

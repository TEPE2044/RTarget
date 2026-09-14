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
  <div class="login-card">
    <h2>活力值奖罚系统</h2>
    <p class="hint">懒人自驱动 · 输入邮箱收魔法链接，点一下就登录</p>

    <form v-if="!sentMagicLink" @submit.prevent="submit">
      <input
        v-model="email"
        type="email"
        placeholder="你的邮箱"
        required
        :disabled="sending || loading"
      />
      <button type="submit" :disabled="sending || loading || !email">
        {{ sending ? '发送中…' : '发送魔法链接' }}
      </button>
    </form>

    <p v-if="sentMagicLink" class="sent">
      链接已发送 → 收件箱点一下即可进入。<br />
      <small>没收到？查一下垃圾邮件文件夹。</small>
    </p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.login-card {
  max-width: 360px;
  margin: 15vh auto;
  padding: 32px;
  border-radius: 12px;
  background: #1c1f26;
  color: #e6e6e6;
  text-align: center;
}
h2 { margin: 0 0 8px; }
.hint { color: #9aa0aa; font-size: 13px; margin-bottom: 24px; }
input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #3a3f4a;
  background: #14161b;
  color: #e6e6e6;
  box-sizing: border-box;
  font-size: 14px;
}
button {
  width: 100%;
  margin-top: 12px;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: #4f7cff;
  color: white;
  font-size: 14px;
  cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
.sent { line-height: 1.7; color: #7fe08a; }
.error { color: #ff7a7a; }
</style>

<script setup lang="ts">
import { ref } from 'vue'
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons-vue'
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
  <div class="flex items-center justify-center min-h-screen p-6 app-bg">
    <a-card class="w-full" style="max-width: 380px">
      <template #title>
        <div class="text-center">
          <div class="text-2xl font-bold">RTarget</div>
          <div class="text-xs opacity-60 font-normal mt-1">懒人自驱动 · 奖罚迭代</div>
        </div>
      </template>

      <a-tabs v-model:activeKey="mode" centered>
        <a-tab-pane key="magic" tab="魔法链接" />
        <a-tab-pane key="password" tab="密码登录" />
      </a-tabs>

      <a-form v-if="!sentMagicLink" @submit.prevent="submit">
        <a-form-item>
          <a-input v-model:value="email" size="large" placeholder="邮箱"
            :disabled="sending || loading" @pressEnter="submit">
            <template #prefix><MailOutlined /></template>
          </a-input>
        </a-form-item>
        <a-form-item v-if="mode === 'password'">
          <a-input-password v-model:value="password" size="large" placeholder="密码"
            :disabled="sending || loading" @pressEnter="submit">
            <template #prefix><LockOutlined /></template>
          </a-input-password>
        </a-form-item>
        <a-form-item v-if="mode === 'magic'" class="mb-2">
          <a-input size="large" placeholder="（魔法链接模式无需密码）" disabled>
            <template #prefix><UserOutlined /></template>
          </a-input>
        </a-form-item>
        <a-button type="primary" size="large" block html-type="submit"
          :loading="sending || loading"
          :disabled="!email || (mode === 'password' && !password)">
          {{ mode === 'magic' ? '发送魔法链接' : '登录' }}
        </a-button>
      </a-form>

      <a-alert v-if="sentMagicLink && mode === 'magic'" type="success" show-icon class="mt-4"
        message="链接已发送" description="收件箱点一下即可进入。没收到请查垃圾邮件。" />
      <a-alert v-if="error" type="error" show-icon class="mt-4" :message="error" />
    </a-card>
  </div>
</template>

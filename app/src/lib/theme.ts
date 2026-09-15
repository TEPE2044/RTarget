import { ref, watchEffect } from 'vue'

// Dark/Light 模式切换（localStorage 持久化，默认 dark）
type ThemeMode = 'dark' | 'light'
const theme = ref<ThemeMode>((localStorage.getItem('rtarget-theme') as ThemeMode) || 'dark')

watchEffect(() => {
  localStorage.setItem('rtarget-theme', theme.value)
  document.documentElement.setAttribute('data-theme', theme.value)
  // antd v4 亮暗算法切换：dark 用 darkAlgorithm，light 用 defaultAlgorithm
})

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

export function useTheme() {
  return { theme, toggleTheme }
}

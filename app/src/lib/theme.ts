import { ref, watchEffect } from 'vue'

// Dark/Light 模式切换（localStorage 持久化）
type ThemeMode = 'dark' | 'light'

const THEME_KEY = 'rtarget-theme'
const MIGRATION_KEY = 'rtarget-theme-default-v1'

/**
 * 一次性迁移：默认主题从 dark 改成 light。
 *
 * 光改默认值没用 —— localStorage 里已经存了一个 'dark'，读取时它会优先于默认值，
 * 于是「改了默认」在已经用过的设备上完全看不出来。而那个 'dark' 基本不是主动选的
 * （就是旧默认值），所以这里把它清掉，让它回到新默认。
 * MIGRATION_KEY 保证只跑一次，之后用户自己选的深色不会被抹掉。
 */
function migrateDefaultTheme() {
  if (localStorage.getItem(MIGRATION_KEY)) return
  if (localStorage.getItem(THEME_KEY) === 'dark') localStorage.removeItem(THEME_KEY)
  localStorage.setItem(MIGRATION_KEY, '1')
}
migrateDefaultTheme()

const theme = ref<ThemeMode>((localStorage.getItem(THEME_KEY) as ThemeMode) || 'light')

watchEffect(() => {
  localStorage.setItem(THEME_KEY, theme.value)
  document.documentElement.setAttribute('data-theme', theme.value)
  // antd v4 亮暗算法切换：dark 用 darkAlgorithm，light 用 defaultAlgorithm
})

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

export function useTheme() {
  return { theme, toggleTheme }
}

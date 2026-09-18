import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'

/**
 * 原生壳适配层
 *
 * 全部 API 在浏览器里都是空操作 —— 浏览器优先是前提，壳只是"纯容器"。
 * 所以这里没有任何业务逻辑，只有"让容器用起来不别扭"的两件事：
 * 返回键和系统栏。
 */

export const isNative = Capacitor.isNativePlatform()

/**
 * 同步系统栏（状态栏 + 导航栏）图标的明暗。
 *
 * 用 @capacitor/core 自带的 SystemBars，而不是 @capacitor/status-bar：
 * 后者是给非全面屏时代的，只管道状态栏，导航栏（三按键/手势条）它管不着 ——
 * 浅色主题下导航栏图标会变成浅色，压在浅色底上直接看不见。
 *
 * 命名反直觉，别按字面理解（枚举注释写得很清楚）：
 *   SystemBarsStyle.Dark  = 深色背景 + 浅色图标 → 深色主题用
 *   SystemBarsStyle.Light = 浅色背景 + 深色图标 → 浅色主题用
 *
 * 不传 bar 参数，状态栏和导航栏一起设。
 * 背景色一律不设：Android 15+ 强制全面屏，系统栏是透明的，
 * 底色由页面自己透上去（.rt-appbar / .rt-tabbar），配合 --rt-safe-* 留白。
 */
export async function syncSystemBars(theme: 'dark' | 'light') {
  if (!isNative) return
  try {
    await SystemBars.setStyle({
      style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    })
  } catch {
    // 个别 ROM 会抛，忽略即可：布局已经被安全区的留白兜住了
  }
}

/**
 * 接管 Android 返回键。
 *
 * 不接管的话，因为这是个没有路由的 SPA（翻页只是切 ref，不产生 history），
 * WebView 里没有可回退的历史，按返回会直接退出应用。
 *
 * 优先级：关弹窗 → 回首页 → 退到后台
 * 最后一步用 minimizeApp 而不是 exitApp：退到后台更符合"随手切走"的直觉，
 * 不会让人有种"我把应用关了"的意外感。
 */
export function registerBackButton(handlers: {
  hasModalOpen: () => boolean
  closeModal: () => void
  currentPage: () => string
  goHome: () => void
}) {
  if (!isNative) return

  CapApp.addListener('backButton', () => {
    if (handlers.hasModalOpen()) {
      handlers.closeModal()
      return
    }
    if (handlers.currentPage() !== 'home') {
      handlers.goHome()
      return
    }
    CapApp.minimizeApp()
  })
}

/**
 * 从后台切回前台时回调（浏览器上是空操作）。
 *
 * 用于"每次打开都自检一下" —— Android 上切走再切回来**不会重载 JS**，
 * 光靠 onMounted 只覆盖了冷启动那一次。挂一天的应用等于从没检过。
 *
 * 返回一个取消函数；不需要时调用它（本应用里 App 组件不卸载，留着也无害）。
 */
export function onAppResume(cb: () => void): () => void {
  if (!isNative) return () => {}
  let remove: (() => void) | null = null
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) cb()
  }).then((handle) => {
    remove = () => void handle.remove()
  })
  return () => remove?.()
}

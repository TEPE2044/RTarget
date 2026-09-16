import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'

/**
 * 原生壳适配层
 *
 * 全部 API 在浏览器里都是空操作 —— 浏览器优先是前提，壳只是"纯容器"。
 * 所以这里没有任何业务逻辑，只有"让容器用起来不别扭"的两件事：
 * 返回键和状态栏。
 */

export const isNative = Capacitor.isNativePlatform()

/**
 * 同步状态栏图标的明暗。
 *
 * Capacitor 的命名有点反直觉：Style.Dark 指"深色背景、浅色图标"，
 * 所以深色主题用 Style.Dark。
 *
 * 只设图标风格、不设背景色：Android 15+ 强制全面屏（edge-to-edge），
 * setBackgroundColor 已经失效，背景实际由页面自己透上去 ——
 * 也就是 .rt-top 那块，配合 safe-area-inset-top 的留白。
 */
export async function syncStatusBar(theme: 'dark' | 'light') {
  if (!isNative) return
  try {
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light })
  } catch {
    // 个别 ROM 会抛，忽略即可：布局已经被安全区的 padding 兜住了
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

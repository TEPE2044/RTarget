import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 套壳配置
 *
 * 机制文档里的定位：浏览器优先，套壳只是"纯容器" —— 因为没有通知需求，
 * 壳不承担任何额外职责，随时可加可去。
 *
 * webDir 指向 Vite 的产物目录，所以流程固定是：
 *   npm run build  →  npx cap sync android  →  在 Android Studio 里跑
 */
const config: CapacitorConfig = {
  appId: 'com.rtarget.app',
  appName: 'RTarget',
  webDir: 'dist',
  server: {
    // WebView 里用 https 协议加载本地资源，避免被当成不安全来源
    androidScheme: 'https',
  },
  plugins: {
    /**
     * 系统栏（状态栏 + 导航栏）
     *
     * insetsHandling 默认就是 'css'，这里显式写出来是为了别被误改：
     * targetSdk ≥ 35 时 Android 强制 edge-to-edge，页面必然铺到系统栏底下，
     * 而 Android WebView 对 env(safe-area-inset-*) 支持不可靠（返回空值）。
     * Capacitor 内核会读真实 WindowInsets，按 dp 注入成 --safe-area-inset-*，
     * 前端 CSS 里的 --rt-safe-* 就是靠它（见 src/style.css）。
     * 关掉它（'disable'）上下两条栏会立刻被系统栏压住。
     */
    SystemBars: {
      insetsHandling: 'css',
    },

    /**
     * 应用内更新（OTA，见 src/lib/updater.ts）
     *
     * autoUpdate: 'off' —— **不让插件自己检查**，全部交给应用里那个
     * 「检查更新」按钮触发。默认值会自动去查 updateUrl，而我们要手动。
     *
     * autoDeleteFailed: 下载/启动失败的包自动清掉，免得占地方。
     * autoDeletePrevious: **保持 false（默认）** —— 留着上一版，
     * 万一新版有 bug 还能回滚，删了就只剩重装 APK 一条路。
     */
    CapacitorUpdater: {
      autoUpdate: 'off',
      autoDeleteFailed: true,
      autoDeletePrevious: false,
    },
  },
}

export default config

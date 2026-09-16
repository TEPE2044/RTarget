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
}

export default config

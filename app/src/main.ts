import { createApp } from 'vue'
import Vant from 'vant'
import 'vant/lib/index.css'
import './style.css'
import App from './App.vue'
import { markAppReady } from './lib/updater'

// 桌面端（Tauri 壳）：构建期变体，给 <html> 挂上 plat-desktop，
// 让 style.css 里那份"桌面外壳"生效（左侧栏 / 宽内容区 / 页头）。
//
// VITE_PLATFORM 会被 Vite 在构建时替换成字面量，所以手机版构建里下面这行
// 等价于 `if ('undefined' === 'desktop')` —— 会被压缩器直接删掉，桌面那套不进手机包。
const PLATFORM = import.meta.env.VITE_PLATFORM
if (PLATFORM === 'desktop') document.documentElement.classList.add('plat-desktop')

// 必须在最前面调：告诉更新插件「这一版能跑起来」。
// 晚于挂载、或者漏调，插件都会把新版本判成坏包并在下次启动时回滚。
markAppReady()

createApp(App).use(Vant).mount('#app')
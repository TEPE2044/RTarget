import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'
import App from './App.vue'
import { markAppReady } from './lib/updater'

// 必须在最前面调：告诉更新插件「这一版能跑起来」。
// 晚于挂载、或者漏调，插件都会把新版本判成坏包并在下次启动时回滚。
markAppReady()

createApp(App).use(Antd).mount('#app')

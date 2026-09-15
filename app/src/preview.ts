import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'
import PreviewApp from './preview/PreviewApp.vue'

createApp(PreviewApp).use(Antd).mount('#preview')

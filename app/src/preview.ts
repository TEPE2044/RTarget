import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'
import PreviewApp from './preview/PreviewApp.vue'

createApp(PreviewApp).use(Antd).mount('#preview')

/**
 * 交互自查：`?edit=1` 时自动把第一条待办切进编辑态，并把备注框的实际尺寸
 * 钉在页面左下角（截图里能直接读到像素值）。
 *
 * 为什么需要它：截图工具只能"看"，不能点。而"编辑态 + 多行备注"恰恰是
 * 光看代码判断不了的东西 —— 之前让「手机上备注框只有一行」的毛病溜过去，
 * 就是因为没实际点开看。
 *
 * 用法：先在 preview 的假数据里把那条待办写上多行 note，再截
 * `?tab=1&edit=1` —— 框高跟着行数走，就说明 auto-size 生效。
 * （别在这儿自动填文本：headless 里 execCommand/派发 input 都不可靠，
 *   而且那样验的是"脚本能不能填"，不是"框会不会长高"。）
 *
 * 只在 preview 这个 dev-only 页面里跑，不影响正式应用。
 */
if (new URLSearchParams(location.search).get('edit')) {
  setTimeout(() => {
    const tx = document.querySelector('.rt-todo-tx') as HTMLElement | null
    if (!tx) return
    tx.click() // 进编辑态，Vue 会渲染出输入框

    setTimeout(() => {
      const ta = document.querySelector('.rt-note-in textarea') as HTMLTextAreaElement | null
      if (!ta) return
      const r = ta.getBoundingClientRect()
      const box = document.createElement('div')
      box.style.cssText =
        'position:fixed;left:0;bottom:0;z-index:99;background:#000;color:#0f0;' +
        'font:12px/1.4 monospace;padding:2px 6px'
      box.textContent = `备注框 ${Math.round(r.width)}×${Math.round(r.height)}px`
      document.body.appendChild(box)
    }, 400)
  }, 900)
}

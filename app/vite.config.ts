import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
//
// 桌面端是**构建期变体**：同一份源码，只换输出目录与一个平台标记。
//   npm run build          → dist/        （手机，现状不变）
//   npm run build:desktop  → dist-desktop/（桌面变体）
//
// 平台标记用 `define` 从 mode 写死，**不走 .env 文件**：
// 本仓库的 .gitignore 忽略 `.env.*`（密钥规则，故意的），靠 .env 拿这个标记的话，
// 别人克隆下来构建桌面变体会拿到空值 —— 静默构建出手机版外壳、还照样输出到
// dist-desktop，这类"悄悄错"最难查。写在这里就不可能漏。
export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss()],
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify(mode === 'desktop' ? 'desktop' : ''),
  },
  build: { outDir: mode === 'desktop' ? 'dist-desktop' : 'dist' },
}))

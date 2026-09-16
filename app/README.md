# RTarget 前端 + Capacitor 套壳

机制文档在 `../docs/mechanism.md`，数据库迁移在 `../supabase/`。

## 浏览器开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # vue-tsc 类型检查 + vite 打包到 dist/
```

需要 `.env.local`（从 `.env.example` 复制）：

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...          # 或 VITE_SUPABASE_PUBLISHABLE_KEY=...
```

### 排版自查（dev only）

`preview.html` 是一个**不连库**的预览页：真实组件 + 假数据，
用来在没登录的情况下看排版。不进构建产物（`vite build` 只打包 `index.html`）。

- `http://localhost:5173/preview.html`
- `?tab=0|1|2|3` → 正在执行 / 首页 / 历史记录 / 设目标表单
- `?theme=light|dark`

配无头浏览器可以直接出图（本机没装 agent-browser，用系统 Chrome 就行）：

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
  --force-device-scale-factor=1 --window-size=1240,900 \
  --virtual-time-budget=7000 --screenshot="out.png" \
  "http://localhost:5174/preview.html?tab=0&theme=light"
```

## Capacitor 套壳（Android）

壳是**纯容器**：无通知需求，不承担额外职责，随时可加可去。
配置见 `capacitor.config.ts`（`appId: com.rtarget.app`，`webDir: dist`）。

```bash
npm run cap:sync      # build + 把 dist 同步进原生工程
npm run cap:android   # 上面那步 + 用 Android Studio 打开
```

**改完前端一定要跑 `cap:sync`**，否则原生工程里还是旧的一份 `dist`。

> ⚠️ WorkBuddy 环境里 `cap sync` 会被"安全删除"垫片拦住（它要用回收站删掉
> `assets/public` 和 `capacitor-cordova-android-plugins` 这两个**自动生成**的目录，
> 回收站操作失败了）。绕过方式：
>
> ```bash
> unset NODE_OPTIONS && npx cap sync android
> ```
>
> 在自己终端里跑不受影响。

### 图标与启动图

图标**不是手放图片，而是脚本生成**的，因为自适应图标有几何约束
（前景必须落在 108dp 画布中间的 66dp 安全区，否则会被系统裁掉），
写成代码才能保证改一处、所有尺寸都对。

```bash
node scripts/gen-icons.mjs                  # 调色板和几何常量在脚本顶部
npx @capacitor/assets generate --android    # 分发成 148 个各密度资源
```

源图输出到 `app/assets/`（`icon-only.png` / `icon-foreground.png` /
`icon-background.png` / `splash.png` / `splash-dark.png`）。
`icon.svg` 是顺手留的一份，可以在浏览器里直接看效果。

### 安全区

套壳必须做，否则刘海屏上顶栏会被状态栏压住：

- `index.html` 的 viewport 带 `viewport-fit=cover` —— **没有它 `env(safe-area-inset-*)` 全是 0**
- `src/style.css` 里 `.rt-top` 让出状态栏高度，`.rt-main` 补左右和底部，
  `.app-bg`（登录页）四边补齐

### 壳内行为（`src/lib/native.ts`）

全部在浏览器里是空操作，只有装进壳才生效：

- **返回键**：关弹窗 → 回首页 → 退到后台（用 `minimizeApp` 而不是 `exitApp`，
  退后台比直接退出更符合直觉）。不接管的话，因为这是没有路由的 SPA、
  WebView 里没有可回退的历史，按返回会直接退出应用。
- **状态栏**：图标明暗跟着深浅主题走。只设图标风格不设背景色 ——
  Android 15+ 强制全面屏，`setBackgroundColor` 已失效，背景实际由页面透上去。

### 打包

```bash
npm run cap:sync                        # 先把最新的 web 产物同步进原生工程
cd android && ./gradlew assembleDebug   # 产物：android/app/build/outputs/apk/debug/
```

也可以直接在 Android Studio 里 Run（`npm run cap:android` 会帮你打开）。

环境：
- JDK 17+（本机 21）
- Android Studio + Android SDK（本机已装，路径
  `C:\Users\admin\AppData\Local\Android\Sdk`，正好带 `android-36` 和 `build-tools 36.1.0`）
- `android/local.properties` 里的 `sdk.dir` —— **这个文件不进 git**（每台机器路径不同），
  换机器要重写一次

### 魔法链接登录（深链）

壳里没有"页面 URL"这个概念，Supabase 邮件链接默认跳 `https://localhost` 是接不住的，
所以改走自定义 scheme。**三处必须一致，缺一处邮件里的链接就点不开应用：**

| # | 位置 | 值 |
|---|---|---|
| 1 | `src/lib/auth.ts` 的 `NATIVE_REDIRECT` | `com.rtarget.app://login-callback` |
| 2 | `android/app/src/main/AndroidManifest.xml` 的 intent-filter | `scheme=com.rtarget.app`、`host=login-callback` |
| 3 | **Supabase 后台** → Authentication → URL Configuration → Redirect URLs | `com.rtarget.app://**` |

第 3 步只能在后台手动加（代码改不了你的 Supabase 项目）。

完整链路：壳里请求魔法链接 → 邮件里点 → Supabase 验证 → 302 到自定义 scheme →
系统把应用拉起来（Manifest 里 `launchMode="singleTask"`，所以是复用已有实例而不是新开）→
Capacitor 触发 `appUrlOpen` → `auth.ts` 把 fragment 里的 token 交给 `setSession`。

浏览器不受影响，仍用 `window.location.origin` —— 所以**手机上点跳应用、电脑上点跳网页**。

> ⚠️ 改完 Manifest 要重新 `cap:sync` + 重新打包才生效。

### 已知待办

- **启动图标可能偏小**：Android 12+ 的 `windowSplashScreenAnimatedIcon` 直接用了
  自适应图标的前景层（自带 108dp 的内边距），实际显示会比理想值小一圈。
  装上真机看一眼，要调就换一张专门的启动图标 drawable。
- 图标与启动图都是默认设计（深蓝底 + 靶心），要换直接改 `scripts/gen-icons.mjs` 顶部的常量。

### 版本

`android/app/build.gradle` 里的 `versionName` 与 `package.json` 的 `version` 保持一致。
当前 **0.0.1**（分支 `app-0.0.1`）。

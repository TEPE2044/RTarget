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

或者手动：

```bash
npm run build
npx cap sync android          # 重新拷贝 web 产物、同步插件
npx cap open android          # Android Studio
```

**改完前端一定要跑 `cap:sync`**，否则原生工程里还是旧的一份 `dist`。

### 环境要求

- JDK 17+（本机是 21）
- Android Studio + Android SDK（**本机未安装**，`ANDROID_HOME` 也没设）

也就是说：**原生工程已经能生成、能同步，但打 APK 需要先装 Android Studio。**
装完在 Android Studio 里直接 Run 即可。

### 已知待办

- **魔法链接登录在壳里用不了** —— `emailRedirectTo` 用的是 `window.location.origin`，
  在壳里会变成 `https://localhost`。要走深链（自定义 scheme + intent-filter）才能支持。
  目前请用「密码登录」那一栏。
- **Android 返回键**未接管，现在按返回会直接退出应用。
  浏览器里正常（走 history），壳里应该接 `@capacitor/app` 的 `backButton` 事件。
- **状态栏配色**未做，用的是系统默认。需要的话加 `@capacitor/status-bar`。
- 启动图 / 应用图标目前是 Capacitor 的默认素材（`android/app/src/main/res/`）。

### 版本

`android/app/build.gradle` 里的 `versionName` 与 `package.json` 的 `version` 保持一致。
当前 **0.0.1**（分支 `app-0.0.1`）。

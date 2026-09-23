# RTarget 前端 + Capacitor 套壳

**仓库总览在 [`../README.md`](../README.md)**（项目是什么、怎么跑、发版、文档地图）。
机制文档在 [`../docs/mechanism.md`](../docs/mechanism.md)，数据库迁移在 `../supabase/`。

这份文件是**前端与套壳的实现细节**：界面约定、打包、OTA、登录实现、踩过的坑。

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

### 界面布局（移动优先）

整个界面按手机 App 的样子来，桌面上就是居中一条 640px 的窄列：

- **顶栏**（`.rt-appbar`）：品牌 + 实时时钟 + 刷新 / 深浅色 / 更多三个图标按钮，
  吸顶、半透明磨砂
- **底部导航**（`.rt-tabbar`）：首页 / 待办 / **执行** / 愿望 / 历史，带图标和数量角标，fixed 贴底。
  「执行」放**正中间**（第 3 位）—— 它是最常点的一个，拇指最好够
- **右下主按钮**（`.rt-fab`）：只在「执行」页出现，点开设新目标
- **弹窗一律是底部抽屉**：`<a-modal wrap-class-name="rt-sheet">`，
  配 `src/style.css` 里的 `.ant-modal-wrap.rt-sheet` 实现圆角、抓手、吸底按钮
- **「更多」也是抽屉**（`.rt-sheetlist` / `.rt-sheetitem`）—— 手机上点整行比下拉菜单好按

内容区最大宽度由 `--rt-maxw` 控制，底部导航/抽屉/主按钮都跟着这个宽度对齐。

### 目标单（目标 A 的来源）

一张普通 TODOLIST，**跟押注系统完全无关**：不押注、不加分、不扣分、没有死线。
它的用处是当「目标 A 的备选池」—— 设目标时可以从这儿挑一条去立项。

三种状态在数据层：

| 状态 | 含义 | 清单里显示吗 |
|---|---|---|
| `open` | 待办 | 显示 |
| `taken` | 已立项（事情进了「执行」页） | **不显示**（移出清单） |
| `done` | 直接勾掉的，不走押注 | 显示在「做完的」里 |

立项联动：从目标单选一条后，`createGoal` 会在三节点写成功之后把那条标成 `taken`。
**放在最后做** —— 万一前面写节点失败，就别去动人家的清单。这也意味着它不影响立目标本身。

> 为什么 `taken` 是状态而不是直接删：物理删除会丢历史，而且「这条后来变成哪个目标了」
> 就查不到了。留着记录 + 不显示，成本一样、可追溯性好得多。反查用 `nodes.todo_id`。

**刻意没做的一件事**：奖励 B 手输时有「顺手存进愿望单」的勾，目标 A 手输时**没有**对应的勾。
原因是语义对不上 —— B 存进去是"以后还能再用一次这个奖励"，而 A 的条目一旦被引用就移出清单，
存进去立刻就消失，等于没存。A 想复用就直接从清单挑。

**次数（电量格）**（`0017`）：一条待办可以设「打算做几次」，默认 1。
每完成一次由它立项的目标扣一格，扣完这条就用完（变 `done`）。纯计数器，跟押注无关。
格子只在 `times_total > 1` 时显示 —— 一次性的那个格子没有信息量。

**备注（备忘录）**（`0018`）：每条待办可以写一段备注，点正文进编辑时跟文案一起改。
**立项时快照一份到目标 A**（`nodes.note`），执行页的卡片上会显示 ——
因为待办一立项就变成 `taken`、从清单里消失，备注不跟过去就再也看不到了。

> ⚠️ `0015` / `0016` / `0017` / `0018` 都属于**「不跑前端就报错」**的迁移：
> 前端会读写新表/新列，没跑的话一打开就报错（不是静默降级）。**先跑迁移再更新前端。**
>
> `0019` 不是硬门槛（`settle_all` / `seal_archive` 早就存在，它只换实现），
> 但它把两个函数改成了并发安全的「认领式」—— 不跑的话「连点完成 / 放弃 / 封档」
> 仍有很窄的重复记账窗口。**建议跑。**

数据：`supabase/migrations/0016_todos.sql`、`0017_todo_times.sql`、`0018_todo_note.sql`。

### 愿望单（奖励 B 的来源）

奖励 B 不再只能现打字 —— 底下有一张全局的愿望单（`wishes` 表，跨存档共用，
不跟着哪个档走）。设目标时在「从愿望单选 / 自己写」之间切一下：

- **从愿望单选**：挑一个待实现的愿望 → B 存下当时的**文案快照**，
  同时记下 `nodes.wish_id`。愿望以后改了名，不影响已经立过的目标
- **自己写**：临时起意也行，勾上「顺手存进愿望单」就一并加进去

**兑现时机 = A 达成那一刻**（因为机制上 B 的加分就发生在那一瞬）。
自动把愿望标成已实现、从「待实现」里划走；A 若判负，B 永远不开启，愿望留着。
这个标记是**附加效果**，失败了也不影响奖励到账，用户还能手动补标。

愿望单页里可以手动标记已实现（有些愿望不是靠押注系统达成的）、放回、删除、改文案。
**删除愿望不影响已经立过的目标** —— B 存的是快照。

数据：`supabase/migrations/0015_wishes.sql`。

### 排版自查（dev only）

`preview.html` 是一个**不连库**的预览页：真实组件 + 假数据，
用来在没登录的情况下看排版。不进构建产物（`vite build` 只打包 `index.html`）。

- `http://localhost:5173/preview.html?tab=0&theme=light`
- `?tab=0|1|2|3|4|5` → 首页 / **待办** / 执行 / **愿望** / 历史 / 设目标表单
  （顺序与 App 底部导航一致，眼见即所得）
- `?theme=light|dark`
- `?sheet=1` 打开设目标的底部抽屉，`?more=1` 打开「更多」抽屉
- `?goal=free` / `?reward=free` 让设目标抽屉里对应那栏停在「自己写」
  （默认都演示「从清单挑」）
- `?debug=1` 把横向溢出的元素列在页面上（查排版问题用）
- `?edit=1` **自动点开第一条待办的编辑态**，并把备注框的实际尺寸钉在左下角
  （截图工具不能点击，而"编辑态长什么样"光看代码判断不了 ——
  备注框"只有一行"那个毛病就是这么溜过去的）

**手机上要看排版，用 `phone.html`**（把 preview 塞进固定宽度的 iframe）：

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
  --force-device-scale-factor=2 --window-size=500,860 \
  --virtual-time-budget=8000 --screenshot="out.png" \
  "http://localhost:5174/phone.html?tab=0&theme=light&w=390"
```

> ⚠️ 无头 Chrome 的窗口**最小宽度是 500px**：直接 `--window-size=390` 只会把右边裁掉，
> 布局仍按 500px 算，看起来像"内容溢出了"，其实是假象。所以要走 iframe。


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

### 安全区（真机第一课，别再用 env()）

**结论先说：Android 上 `env(safe-area-inset-*)` 不可靠，必须读 Capacitor 注入的
`--safe-area-inset-*`。**

为什么：`targetSdkVersion` 是 36，Android 15+ 对这类应用**强制 edge-to-edge** ——
页面必然铺到状态栏和导航栏底下（这时 opt-out 的 `windowOptOutEdgeToEdgeEnforcement`
也被忽略了）。而 Android WebView 对 `env()` 的支持看版本，实测返回空值，
于是顶部压进通知栏、底部被三个虚拟按键盖住，且**两边的按钮都点不到**。

Capacitor 8.3.2+ 的内核带 `SystemBars`（`insetsHandling` 默认 `css`），会读真实
`WindowInsets`（含挖孔、IME）并按 dp 注入：

```js
document.documentElement.style.setProperty('--safe-area-inset-top', '24px')  // 等等
```

所以 `src/style.css` 里只定义一次、其余地方都用它：

```css
:root {
  --rt-safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  /* right / bottom / left 同理 */
}
```

顺序不能反：**先读注入变量 → 退回 `env()`（iOS / 新 WebView）→ 最后 0（桌面）**。

用到安全区的四类元素（改类名时一起改）：

| 元素 | 让出哪边 |
|---|---|
| `.rt-appbar` | 顶部状态栏（往下推，但背景仍铺到状态栏底下，保住磨砂观感） |
| `.rt-tabbar` | 底部导航栏 / 手势条 |
| `.rt-main` | 左右 + 底部（等于底栏高度 + 导航栏，否则最后一张卡片会被盖住） |
| `.rt-fab` / `.ant-modal-wrap.rt-sheet` | 底部导航栏 |

另外 `capacitor.config.ts` 里把 `SystemBars.insetsHandling` 显式写成 `'css'` ——
默认值就是它，写出来是防止以后被误改成 `'disable'`（一关，上下立刻被压住）。

### 壳内行为（`src/lib/native.ts`）

全部在浏览器里是空操作，只有装进壳才生效：

- **返回键**：关弹窗 → 回首页 → 退到后台（用 `minimizeApp` 而不是 `exitApp`，
  退后台比直接退出更符合直觉）。不接管的话，因为这是没有路由的 SPA、
  WebView 里没有可回退的历史，按返回会直接退出应用。
- **系统栏**：图标明暗跟着深浅主题走，**状态栏和导航栏一起设**。
  用的是 `@capacitor/core` 自带的 `SystemBars`，不是 `@capacitor/status-bar` ——
  后者只管道状态栏，导航栏的三按键图标在浅色主题下会变成浅色、直接看不见
  （那个插件已经卸掉了）。背景色一律不设：全面屏下系统栏是透明的，
  底色由页面自己透上去。注意枚举命名反直觉，`Dark` 是"深底浅图标"。

### 打包

**一条命令出包**：

```bash
npm run apk
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

它等于 `cap:sync` + `gradlew assembleDebug`，也就是「同步 + 真正出包」。

拆开看是这两步（哪一步在干什么，别搞混）：

```bash
npm run cap:sync                        # ① 构建前端 + 把 dist 拷进 android/.../assets/public
cd android && ./gradlew assembleDebug   # ② 打 APK ← 只有这一步会生成/刷新 apk 文件
```

> ⚠️ **`cap:sync` 不出包**，它只更新原生工程里的 web 产物。
> 所以跑完 `cap:sync` 看到 `app-debug.apk` 的时间没变是正常的 —— 少跑第 ② 步。
> 如果第 ② 步也跑了但 apk 时间还是没变，那说明前端产物没变化
> （文件名 `index-<hash>.js` 一样），也就是没改到东西。

也可以直接在 Android Studio 里 Run（`npm run cap:android` 会帮你打开）。

环境：
- JDK 17+（本机 21）
- Android Studio + Android SDK（本机已装，路径
  `C:\Users\admin\AppData\Local\Android\Sdk`，正好带 `android-36` 和 `build-tools 36.1.0`）
- `android/local.properties` 里的 `sdk.dir` —— **这个文件不进 git**（每台机器路径不同），
  换机器要重写一次

> 改完前端**必须先 `cap:sync` 再打包**，否则 APK 里还是旧的 web 代码。
> 校验方法：比对 `dist/assets/index-*.js` 的文件名和 APK 里 `assets/public/assets/` 下的文件名。

#### 国内镜像（重要）

默认的 `services.gradle.org` 在国内下不动（实测下到 178MB 就停住），所以换了两处：

| 位置 | 改动 |
|---|---|
| `gradle/wrapper/gradle-wrapper.properties` | `distributionUrl` → 腾讯云镜像 |
| `build.gradle` | 两个 `repositories` 里把阿里云（google / public）排在前面，`google()` / `mavenCentral()` 留作兜底 |

要换回官方：`distributionUrl` 改回
`https\://services.gradle.org/distributions/gradle-8.14.3-all.zip`，
再删掉 `build.gradle` 里那两行 `maven { url "https://maven.aliyun.com/..." }`。

#### 内存（踩过的坑）

`gradle.properties` 里把堆从模板默认的 `-Xmx1536m` 调到 `2048m`，并加了
`org.gradle.workers.max=2`。原因：这台机器同时开着 Android Studio 等大件，
dex 阶段峰值内存不够时 Gradle 守护进程会**无声无息地消失** ——
日志戛然而止、没有 OOM 堆栈，只有一句 `Gradle build daemon disappeared unexpectedly`。

遇到这个报错按顺序处理：

1. `./gradlew --stop` 停掉残留守护进程（能立刻放掉 1~2 GB）
2. 关掉不用的内存大户（Android Studio、多余的浏览器）
3. 重跑 —— 已编译的部分会命中缓存，通常几十秒就过

### 应用内更新（OTA，只更前端）

改完前端不用再装 APK —— 应用里点一下就换新版。

### 日常发版（两步）

```bash
npm run release     # 构建 + 打 zip + 生成 latest.json，产物都在 app/release/
```

然后把 `app/release/` 里的**两个文件**传到 Supabase Storage 的桶：

- `dist-<版本>.zip`
- `latest.json` ← **覆盖旧的**

`release/` 里只会留最新一份 —— 脚本会自动清掉上一次的 zip，不用手动删。

> 为什么 zip 的文件名要带版本号、不能固定成 `dist.zip`：URL 一旦固定，
> Cloudflare 会缓存它，用户可能下到旧代码。（`latest.json` 那边是靠 `?t=` 时间戳
> 绕缓存的，zip 是给插件直接下载的，不好这么干。）

手机上：「更多」→「检查更新」→ 有新版就自动下载并重载。

**不点也会告诉你**：应用**每次冷启动**、以及**从后台切回前台**（间隔超过 10 分钟）时
都会静默自检一次；发现新版就在**首页顶部挂一条蓝色的「有新版本可用」横幅**，
点一下直接下载并重载。

- 自检**永远不弹错误**：网络不通、桶挂了都当作"没检查过"，不打扰
- 两条横幅的配色分工：蓝色 = 有新版本（信息），琥珀色 = 临期提醒（警告），
  两条可以同时出现

### 一次性配置（已完成，换项目时才需要重做）

1. **建桶**：Supabase 后台 → Storage → New bucket
   - 名字 `rtarget-updater`，**要勾 Public bucket**（不公开的话应用读不到）
2. **公开地址** —— ⚠️ **这个地址后台不会直接显示，是按规则拼出来的**：
   ```
   <项目地址>/storage/v1/object/public/<桶名>
   ```
   （后台能看到的那条 `xxxx.storage.supabase.co` 是 **S3 端点**，给程序化访问用的，
   要配 access key，不是这个。别填错了 —— 已经踩过一次。）
3. **填进 `app/.env.local`**（那个文件不进 git）：
   ```
   VITE_UPDATE_BASE=https://ysmxabkhuremmuytpgqq.supabase.co/storage/v1/object/public/rtarget-updater
   ```
4. **重新打包**：`npm run apk`

   ⚠️ 地址是**构建时注入**的，不重新 build + 打包不生效。

   验证有没有生效：点「更多」→ 看「检查更新」是不是提示"已是最新"或"发现新版"，
   而不是"还没配更新源"。

### 边界（这几条别踩）

- **只能更新前端**。改动涉及原生（加插件、改包名 / 图标 / 权限）**必须重装 APK** ——
  OTA 换的只是网页那部分。
- **装了插件的这个包要先手动装一次**，之后才享受 OTA。
- 新版启动失败会**自动回滚**到上一版（`notifyAppReady` 保护），所以不容易变砖。
  为此 `capacitor.config.ts` 里 `autoDeletePrevious: false` —— 留着上一版当退路。
- 更新源地址是编译进前端的，第一次配好之后就不用再动。

### 实现

| 文件 | 干什么 |
|---|---|
| `src/lib/updater.ts` | 封装 `notifyAppReady` / `fetchLatest` / `applyUpdate`；浏览器里全是空操作 |
| `src/main.ts` | 启动时最先调 `markAppReady()` —— **漏了会让新版本被判成坏包并回滚** |
| `scripts/release.mjs` | 构建 → 打 zip → 算 sha256 → 写 latest.json |
| `capacitor.config.ts` | `CapacitorUpdater.autoUpdate: 'off'` —— 全手动，不让插件自己检查 |

两个容易搞错的地方：

- zip 里 **dist 的内容要直接铺在根**（`index.html` 打头），**不能套一层 `dist/`** —— 套了会白屏。
  `release.mjs` 用的是 `addLocalFolder`，行为就是铺进去。
- `applyUpdate()` 内部调 `CapacitorUpdater.set()` 会**立刻销毁 JS 上下文并重载**，
  所以它之后的代码不保证执行 —— 别在后面写"更新成功"的提示，写不到。

### 登录 / 注册（邮箱验证码，不用魔法链接）

**流程定稿（2026-09-16）：彻底不用魔法链接。**

```
「账号密码登录」    邮箱 + 密码 ──────────────────────────────► 进

「邮箱验证码登录」  邮箱 → 邮件里那串数字 ─┬─ 账号已有密码 ──► 直接进
                                      └─ 账号还没密码 ──► 设一次密码 ──► 进
```

验证码那条路**不再一律要求设密码** —— 已经设过密码的账号，验证码一过就放行
（这才叫"验证码登录"）。只有"没密码"的账号才会被要求设一次，于是这条流程
顺带覆盖了**注册**和**忘记密码**。

判断"有没有密码"靠数据库函数 `has_password()`（`supabase/migrations/0014`）：
密码是否存在只有 `auth.users.encrypted_password` 知道，而 auth schema 客户端读不到，
所以按本项目一贯做法用 `security definer` 开一个只回答"有/没有"的小口子。

> 查询失败时按"已有密码"处理（不拦登录）—— 宁可少让人设一次密码，
> 也不能因为一个辅助函数出问题就把人挡在门外。所以**没跑 0014 也不会登不进去**，
> 只是新账号不会被要求设密码。

技术要点（错一个就白干）：

| 点 | 值 |
|---|---|
| `verifyOtp` 的 type | 必须是 `'email'`（不是 `'magiclink'`） |
| `signInWithOtp` 的参数 | **不要传 `emailRedirectTo`** —— 传了 Supabase 就把邮件换成链接 |
| 邮件模板 | 必须包含 `{{ .Token }}` |
| **验证码位数** | **不要写死！** 后台「Email OTP Length」可配 6~10，**新项目默认 8**<br>（踩过：写死 6 位，结果邮件给 8 位，谁都登不进去） |

实现位置：`src/lib/auth.ts`（`sendCode` / `verifyCode` / `setPassword`）、
`src/components/LoginCard.vue`（三步界面）。

「验证码过了但还没设密码」这一段由 `passwordPending` 挡着（见 `App.vue` 的登录门）——
否则 `verifyOtp` 一成功会话就建立了，主界面会立刻露出来。

### 报错怎么读（两类"看起来像坏了、其实不是"）

打开应用后弹红字，先分清是下面哪一类 —— 这两类的处置**完全相反**，
别都当成"登录失效"去重新登录。

**① `Failed to fetch` / 连不上服务器 —— 网络问题**

请求压根没发出去（手机信号、切 Wi-Fi、Supabase 抖一下）。**本地会话是好的**。

- 现在会**自动重试一次**（隔 1.2 秒），大多数时候用户根本看不到报错
- 两次都失败才在首页挂一条红色的「没加载出来」，点一下重试
- **绝不登出**。以前 `validateSession()` 把网络错误也当成登录失效直接踢下线 ——
  那是 bug（2026-09-20 修），症状是"网络一抖就得重新登录"

**② `JWT issued at future` / `PGRST303` —— Supabase 平台侧的时钟漂移**

不是使用者的操作问题，也不是这个项目的 bug：

- **签 token 的是 Auth 服务，校验 token 的是 PostgREST，两台不同的机器**，
  各自靠 NTP 对时。校验那台只要比签发那台慢 **30 秒以上**，刚刷出来的 token
  就会被判成"未来签发的"而拒掉（PostgREST 的容忍窗口实测：+30s 通过、+31s 拒绝）
- Supabase 官方在 2026-08 一个月内出过**三次**同类事故，新加坡区域尤其常见
- 特征：**登录态看起来完全正常** —— `getUser()` 走的是 Auth 主机、返回 200，
  只有数据接口 401。这就是它"莫名其妙"的来源

**处置只有一个字：等。** PostgREST 的时钟追上来之后，**同一个 token 就能过**。

- **不要重新登录**：新签的 token 一样是未来 iat，登了也白登
- **不要狂重试**：官方明确说了没用，只会白打服务端
- 现在的行为：识别到这类**不登出**；首页红色横幅说明情况，**60 秒后自动重试一次**，
  也可以手动点

**怎么少撞几次：把 access token 的有效期拉长**（见下面后台配置 ④）。
漂移窗口发生时，**每个刚刷新出来的 token 都会被拒** —— 有效期越短、刷新越频繁，
被卷进去的会话就越多。

> 这只是**降低撞上的概率**，不是修好它：根因在平台侧，客户端没有可靠的绕法。

### Supabase 后台要配什么

**① Email Templates**（Authentication → Email Templates）

`signInWithOtp` 用的模板是 **Magic Link**；新用户首次请求走的是 **Confirm signup**。
**两个都改成下面这样**（只留验证码、不要留链接 —— 留着链接就等于把上面那个坑又请回来）：

```html
<h2>验证码</h2>
<p>在 RTarget 里输入下面这串数字：</p>
<p style="font-size: 28px; letter-spacing: 6px; font-weight: 500">{{ .Token }}</p>
<p>1 小时内有效，只能用一次。</p>
```

> ⚠️ 模板里**别写死位数**（"这 6 位数字"这种）—— 位数是后台可配的，
> 写错了用户会以为邮件发错了。
>
> ⚠️ **改完模板不是立刻生效**：实测保存后要等几分钟，之后发的邮件才用新模板。
> 刚保存完就发的那封，很可能还是旧的 —— 别以为没保存成功。

`Reset Password` 模板同理（如果以后做忘记密码的独立入口）。

**③ 验证码位数**（Authentication → Sign In / Providers → Email OTP Length）

范围 6~10，**新版项目默认是 8 位**（不是 6）。

> ⚠️ **前端绝对不要写死位数**。写死 `/^\d{6}$/` 会让所有真实用户登不进去，
> 而且因为在客户端就被拦下，服务端日志里什么都看不到 —— 这坑不少人踩过。
> 现在前端只做"像不像一串数字"的粗校验（6~10 位），真正的判定交给 `verifyOtp`。
>
> 用户是**复制粘贴**验证码的，常带尾随换行/空格，所以输入框会先只留数字。
> 邮件模板里的文案也别写死位数。

**② 频率限制（会被咬）**

Supabase 自带邮件服务限流很狠：**每个邮箱 60 秒一次**，免费项目每小时总共只能发几封。
调试注册时很容易撞到 `email rate limit exceeded` 然后误以为代码坏了。
要根治就配自己的 SMTP（Authentication → SMTP Settings）。

> 历史上配过深链（`com.rtarget.app://login-callback` + Manifest 的 intent-filter），
> 已经全部删除。要恢复的话看 git 历史里 `6323e8e` 这个提交。

**④ Access token 有效期**（Authentication → Sessions → Access token expiry）

默认 1 小时（3600）。**建议调到 12 小时**（43200）：Supabase 偶发
`PGRST303 / JWT issued at future`（平台侧时钟漂移），窗口期内**每个刚刷新出来的
token 都会被拒** —— 刷新越频繁，被卷进去的会话越多。详见上面「报错怎么读」。

### 已知待办

- **启动图标可能偏小**：Android 12+ 的 `windowSplashScreenAnimatedIcon` 直接用了
  自适应图标的前景层（自带 108dp 的内边距），实际显示会比理想值小一圈。
  装上真机看一眼，要调就换一张专门的启动图标 drawable。
- 图标与启动图都是默认设计（深蓝底 + 靶心），要换直接改 `scripts/gen-icons.mjs` 顶部的常量。

### 版本

`android/app/build.gradle` 里的 `versionName` 与 `package.json` 的 `version` 保持一致。
当前 **0.0.1**（分支 `app-0.0.1`）。

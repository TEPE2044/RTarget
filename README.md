# RTarget

把拖着不做的事**押上活力值**：做成了回血，没做成连本带利扣。
单人自用的「懒人自驱动」目标奖罚系统。

前端 Vue3 + Supabase，**没有服务端代码** —— 客户端 + RLS + `security definer` 函数闭环。
用 Capacitor 套成 Android 应用；纯前端改动走 OTA 直接更新，不用重新装包。

> ⚠️ **机制的唯一真相在 [`docs/mechanism.md`](docs/mechanism.md)（当前 v1.6）。**
> 要改机制，**先改它、再改代码** —— 否则文档立刻变成谎话。
> 这份 README 只讲「东西在哪、怎么跑」。

---

## 它怎么运转（30 秒版）

一个全局的**活力值**血池，所有存档共用，初始 10。

立一个目标会同时落下三个节点：

```
        ┌─ A  目标本身      押注 N 分，到死线没申报 → 判负
目标 ───┼─ B  奖励           A 达成时到账
        └─ C  惩罚           A 判负时立刻扣分，并被拉进「惩罚复合体」
```

**惩罚复合体**是这套系统的牙齿：A 一判负就进复合体，在 C 的死线之前 ——

| 你做了什么 | 结果 |
|---|---|
| A 和 C 都做回来 | 两笔扣分**全部返还** |
| 只做一个 | 不返还、也不再追扣 |
| 都没做 | **再扣一次 A + C** |

结算是**惰性**的：打开应用时才跑一次（`settle_all`），没有后台任务、不发推送。
判定用的是**死线时刻本身**，所以隔几天才打开也不会少扣 —— 只是"扣分"发生得晚。

档位、封档、次数、备注这些细节都在 [`docs/mechanism.md`](docs/mechanism.md)。

---

## 仓库结构

| 路径 | 是什么 |
|---|---|
| `app/` | 前端（Vue3 + TS + Vite + Ant Design Vue 4 + Tailwind 4），含 Capacitor 的 Android 工程。<br>**它的 [README](app/README.md) 是前端与套壳的实现文档**，很全，先看那份 |
| `docs/mechanism.md` | **机制的唯一真相**，改了机制必须先改它 |
| `docs/feedback.md` | 反馈清单 + 每条的处理情况对照表 |
| `supabase/migrations/` | 数据库迁移。**按编号顺序、手动在 SQL Editor 跑** |
| `supabase/tests/` | 迁移的自检脚本（只读，跑完看最后一条 select 的输出） |

---

## 上手

### 1. 数据库

Supabase 的 SQL Editor 里**按编号顺序**跑 `supabase/migrations/*.sql`，目前到 **`0018`**。

> ⚠️ **`0015` ~ `0018` 属于「不跑前端就报错」的硬门槛** —— 前端会读写那些新表 / 新列，
> 没跑的话一打开就报错（不是静默降级）。
> 所以顺序永远是：**先跑迁移，再更新前端。**

跑完可以单独跑对应的 `supabase/tests/00xx_check.sql` 确认，例如 0018 应该看到两行。

### 2. 前端

```bash
cd app
npm install
cp .env.example .env.local   # 然后填自己的值
npm run dev
```

`app/.env.local` **不进 git**，构建时注入。四个变量：

| 变量 | 必需 | 说明 |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | 项目 URL（Settings → API） |
| `VITE_SUPABASE_ANON_KEY` | 二选一 | 旧式 anon key（`eyJ` 开头） |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 二选一 | 新式 publishable key（`sb_publishable_` 开头） |
| `VITE_UPDATE_BASE` | 打 APK 时必需 | OTA 更新源（Supabase Storage 那个公开桶的基地址） |

改 `VITE_UPDATE_BASE` **必须重新打包**才生效。没配的话应用里会提示"还没配更新源"。

### 3. 发版

| 改了什么 | 怎么发 |
|---|---|
| **只动前端**（界面 / 逻辑 / 文案） | `npm run release` → 把 `app/release/` 里的 **zip + `latest.json`** 传到 Supabase Storage（**先传 zip，再覆盖 `latest.json`**）。手机上「更多 → 检查更新」；不点也会在打开应用时自检并挂横幅提示 |
| **动了原生**（加插件 / 改包名 / 图标 / 权限） | `npm run apk` → 产物在 `app/android/app/build/outputs/apk/debug/`。**必须重装，OTA 换不了** |

`app/release/` 里**永远只有两个文件**（脚本会自动清旧包）。
细节和踩过的坑（Cloudflare 缓存、版本号为什么必须带在文件名里、
Gradle 国内镜像、内存爆掉…）都在 [`app/README.md`](app/README.md)。

---

## 文档地图

| 想知道 | 去哪 |
|---|---|
| 机制怎么定的、为什么这么定 | [`docs/mechanism.md`](docs/mechanism.md) |
| 界面长什么样、有哪些页面 | [`app/README.md`](app/README.md) § 界面布局 |
| 登录 / 验证码怎么实现的 | 同上 § 登录 / 注册 |
| 报错 `Failed to fetch` / `JWT issued at future` 是什么意思 | 同上 § 报错怎么读 |
| 某条反馈处理没有 | [`docs/feedback.md`](docs/feedback.md) |
| 打包慢 / 内存爆 / 国内源 | 同上 § 国内镜像、§ 内存 |
| 没登录也想看排版 | 同上 § 排版自查（`preview.html` 假数据 + `phone.html` 真机宽度） |

---

## 几条铁律

- **不入库**：`reasonix.toml` / `.reasonix/`、`.env*`、`*.keystore` / `*.jks`、
  `*.apk`、`release/` —— `.gitignore` 已经挡好了，别用 `git add -A` 硬加
- **改机制 = 先改 `docs/mechanism.md`**，再改代码
- **迁移按编号手动跑**，不要跳号。注意有覆盖关系：
  `settle_all` 的当前实现看 **0010**（0001 是初版，被 0009 / 0010 覆盖过两次）
- **C 的死线必须晚于 A**（硬约束）：C 一旦早于 A，A 到点那一刻 C 就已经过期，
  复合体会在同一次结算里直接走完"都没完成"—— 这正是 0010 修掉的那个 bug
- **自检 SQL 的最后一句必须是 `select`**：SQL Editor 只展示最后一条语句的结果，
  以 `rollback` 结尾会把输出全吞掉

---

## 版本

`app/package.json` 里的 version 是**套壳版本**；线上实际跑的是 **OTA 的版本号（时间戳）**，
在手机上「更多」抽屉里能看到当前版本。

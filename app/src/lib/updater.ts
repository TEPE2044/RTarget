import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

/**
 * 应用内更新（OTA）
 *
 * 只更**前端**：Supabase Storage 里放一份 zip + latest.json，
 * 应用里点「检查更新」就拉下来、切过去、重载。
 *
 * ⚠️ 两条边界
 * - **原生改动（加插件、改包名/图标/权限）OTA 换不了**，那种必须重装 APK。
 * - 浏览器里所有 API 都是空操作 —— 浏览器本来就每次都是最新的（刷新即可）。
 */

export const isNative = Capacitor.isNativePlatform()

/**
 * 更新源地址（Supabase Storage 的公开桶基地址）。
 * 配在 `app/.env.local` 的 `VITE_UPDATE_BASE`，那个文件不进 git。
 * 例：https://xxxx.supabase.co/storage/v1/object/public/rtarget-releases
 */
const raw = (import.meta.env.VITE_UPDATE_BASE as string | undefined) ?? ''
export const UPDATE_BASE = raw.replace(/\/+$/, '')
export const isUpdateConfigured = UPDATE_BASE.length > 0

export interface LatestInfo {
  version: string
  url: string
  /** zip 的 sha256（十六进制）。capgo 下载后会校验 */
  checksum?: string
  builtAt?: string
}

/**
 * 启动时告诉插件「当前这一版跑起来了」。
 * **这个必须调** —— 否则插件会认为新版本是坏包，下次启动自动回滚。
 */
export async function markAppReady() {
  if (!isNative) return
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* 插件用不了也不该影响应用启动 */
  }
}

/** 当前正在跑的版本号（首次安装是 APK 里那个内置版本） */
export async function currentVersion(): Promise<string> {
  if (!isNative) return '浏览器'
  try {
    const cur = await CapacitorUpdater.current()
    return cur.bundle.version
  } catch {
    return '未知'
  }
}

/** 拉远端 latest.json（带时间戳，绕开 WebView 缓存） */
export async function fetchLatest(): Promise<LatestInfo> {
  if (!isUpdateConfigured) throw new Error('还没配更新源')
  const res = await fetch(`${UPDATE_BASE}/latest.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`拿不到版本信息（HTTP ${res.status}）`)
  const info = (await res.json()) as LatestInfo
  if (!info?.version || !info?.url) throw new Error('版本信息格式不对')
  return info
}

/**
 * 下载并切到新版本。
 *
 * ⚠️ `set()` 会**立刻销毁当前 JS 上下文并重载**，所以它之后的代码不保证执行 ——
 * 调用方别在它后面写"更新成功"之类的提示，写不到的。
 */
export async function applyUpdate(info: LatestInfo) {
  const bundle = await CapacitorUpdater.download({
    url: info.url,
    version: info.version,
    checksum: info.checksum,
  })
  await CapacitorUpdater.set({ id: bundle.id })
}

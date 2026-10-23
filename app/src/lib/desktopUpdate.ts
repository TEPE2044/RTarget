import { isDesktopShell } from './updater'

/**
 * 桌面端前端热更新（Tauri 壳里的 OTA）
 *
 * 与手机端（Capacitor + capgo）是**两条独立通道**：这里走 tauri-plugin-hot-update，
 * 清单由 minisign 签名、实现在壳的 Rust 里（见 rtarget-desktop/src-tauri）。
 *
 * 所有调用都只在桌面壳里有意义；浏览器 / 手机里这个模块不会被真正执行
 * （调用方 UpdateGate 也只在 isDesktopShell 时才挂上）。
 *
 * 为什么不用官方的 `tauri-plugin-hot-update-api` 包：它整份实现就是 24 行
 * invoke + listen，却要求把 `@tauri-apps/api` 作为 peer 依赖装进共享前端。
 * 这里直接用壳注入的 `window.__TAURI__`，调用字符串与官方包逐字一致
 * （`plugin:hot-update|check` 等），行为等价而零新增依赖。
 */

/** 插件的返回是「多状态一等公民」，拒绝不算异常而是 status —— 形参照官方类型定义 */
type UpdateOutcome =
  | { status: 'available'; manifest: { version: string } }
  | { status: 'staged'; seq: number; version: string }
  | { status: 'upToDate'; offered: string; watermark: string }
  | { status: 'blacklisted'; version: string }
  | { status: 'shellTooOld'; required: string; shell: string }
  | { status: 'alreadyStaged'; seq: number; version: string }

/** check 不会下载，所以永远不会返回 staged */
export type CheckOutcome = Exclude<UpdateOutcome, { status: 'staged' }>
/** download 只会返回「下载之后」的结局，不会是 available */
export type DownloadOutcome = Exclude<UpdateOutcome, { status: 'available' }>

export interface DownloadProgress {
  downloaded: number
  total: number
}

function invoke<T>(cmd: string): Promise<T> {
  return window.__TAURI__!.core!.invoke!(cmd) as Promise<T>
}

/**
 * 把本次启动的 bundle 提交为「已知可用」。
 *
 * **每次启动都必须调一次**（在界面挂载之后）：漏调的话，下次启动会判定
 * 「这版没起来」→ 把 bundle 拉黑并回退。注意在闸门界面显示时也要调 ——
 * 界面渲染出来了就说明这版是好的。
 */
export async function notifyReady(): Promise<void> {
  if (!isDesktopShell) return
  await invoke('plugin:hot-update|notify_app_ready')
}

/** 拉清单、验签名，只回答「有没有适用更新」，不下载 */
export async function check(): Promise<CheckOutcome> {
  return invoke<CheckOutcome>('plugin:hot-update|check')
}

/** 完整流水线：检查 → 下载 → 校验 → 解包 → 就位（下次冷启动生效） */
export async function download(): Promise<DownloadOutcome> {
  return invoke<DownloadOutcome>('plugin:hot-update|download')
}

/** 订阅下载进度，返回取消订阅函数 */
export async function onDownloadProgress(
  cb: (p: DownloadProgress) => void,
): Promise<() => void> {
  return window.__TAURI__!.event!.listen!('hot-update://progress', (e) => {
    cb(e.payload as DownloadProgress)
  })
}

/** 重启应用，让已就位的 bundle 生效 */
export async function relaunch(): Promise<void> {
  await invoke('relaunch')
}

/** 退出应用（发现新版但先不用） */
export async function quit(): Promise<void> {
  await invoke('quit')
}

// ---------------------------------------------------------------------------
// 整包（外壳）更新：装的是安装包，不是前端 bundle
// ---------------------------------------------------------------------------

export interface ShellUpdateInfo {
  currentVersion: string
  version: string
  /** latest.json 里的 notes */
  body?: string | null
}

export interface ShellCheckResult {
  /** false = 检查本身失败（断网 / 桶里还没 latest.json / 配置不对） */
  ok: boolean
  info: ShellUpdateInfo | null
}

/** 查外壳有没有新版。查不动时 ok=false，由调用方决定提示还是放行 */
export async function checkShell(): Promise<ShellCheckResult> {
  try {
    return { ok: true, info: await invoke<ShellUpdateInfo | null>('shell_check') }
  } catch {
    return { ok: false, info: null }
  }
}

/** 下载并安装外壳。成功时安装器会先退出应用 —— 这之后的代码不保证执行 */
export async function installShell(): Promise<void> {
  await invoke('shell_install')
}

/** 外壳下载进度。chunk = 本次块大小（累加），total = 总字节（可能为 null） */
export async function onShellProgress(
  cb: (p: { chunk: number; total: number | null }) => void,
): Promise<() => void> {
  return window.__TAURI__!.event!.listen!('shell-update://progress', (e) => {
    cb(e.payload as { chunk: number; total: number | null })
  })
}

// ---------------------------------------------------------------------------
// 更新说明：两个源的地址都由壳配置提供，前端不抄第二份
// ---------------------------------------------------------------------------

export interface UpdateUrls {
  frontendManifest: string
  shellLatest: string
}

export async function updateUrls(): Promise<UpdateUrls> {
  return invoke<UpdateUrls>('update_urls')
}

export interface FrontendManifest {
  version: string
  notes?: string
}

/**
 * 拉前端包的签名清单，**只为了读 notes**。
 * 版本判定与校验和仍由 hot-update 插件负责，这里读到什么都不影响更新本身。
 */
export async function fetchFrontendManifest(): Promise<FrontendManifest | null> {
  try {
    const { frontendManifest } = await updateUrls()
    if (!frontendManifest) return null
    const sep = frontendManifest.includes('?') ? '&' : '?'
    const res = await fetch(`${frontendManifest}${sep}t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as FrontendManifest
  } catch {
    return null
  }
}

/** 当前正在跑的前端 bundle 版本（embedded = 壳内置的那份） */
export async function currentBundle(): Promise<{ source: string; version: string } | null> {
  try {
    return await invoke<{ source: string; version: string }>(
      'plugin:hot-update|current_bundle',
    )
  } catch {
    return null
  }
}

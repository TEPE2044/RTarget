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

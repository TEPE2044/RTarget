<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  check,
  checkShell,
  currentBundle,
  download,
  fetchFrontendManifest,
  installShell,
  onDownloadProgress,
  onShellProgress,
  quit,
  relaunch,
  type ShellUpdateInfo,
} from '../lib/desktopUpdate'

/**
 * 桌面端更新闸门
 *
 * 启动时按「外壳 → 前端」的顺序查，两行一起展示：
 *
 *   外壳  0.0.5 → 0.0.6
 *   前端  0.0.7 → 0.0.8
 *
 * 谁有更新更谁。两个都有时**先下载前端包、再装外壳**：前端包只是"就位"，
 * 不重启；外壳安装器会把应用退掉并重启，重启后前端包正好接上 ——
 * 一次重启把两件事都办完。
 *
 * 强制：有更新就只有「更新并重启 / 退出应用」两条路。
 * 但检查失败、下载失败、安装失败一律**放行** —— 网络抖动或杀软拦截不该
 * 让人打不开自己的应用，下次启动再试。这条兜底不能省。
 */

type Phase = 'checking' | 'downloading' | 'ready'

const emit = defineEmits<{ pass: [] }>()

const phase = ref<Phase>('checking')
const percent = ref(0)
const downloadLabel = ref('')

const shellUpdate = ref<ShellUpdateInfo | null>(null)
/** 当前正在跑的前端 bundle 版本 */
const frontCurrent = ref('')
/** 前端待更新到的版本；空串 = 不用更 */
const frontVersion = ref('')
/** 前端包上次已经下好、只是还没重启 */
const frontStaged = ref(false)
const notes = ref('')

/** 检查阶段的硬超时：网络卡住不能把应用永远挂在"检查中" */
const CHECK_TIMEOUT_MS = 15_000

const noteLines = computed(() =>
  notes.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6),
)

function pass() {
  emit('pass')
}

/** 超时返回 null（=> 当作检查失败，放行） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

onMounted(async () => {
  // 当前前端版本（只是展示，读不到就算了）
  frontCurrent.value = (await currentBundle())?.version ?? ''

  // 壳先查 —— 外壳装不上时，前端的版本判定也还有意义，所以两条各查各的
  try {
    const shellRes = await withTimeout(checkShell(), CHECK_TIMEOUT_MS)
    shellUpdate.value = shellRes?.info ?? null
  } catch {
    shellUpdate.value = null
  }

  try {
    const outcome = await withTimeout(check(), CHECK_TIMEOUT_MS)
    if (outcome?.status === 'available') {
      frontVersion.value = outcome.manifest.version
      // 说明拉不到不影响更新本身
      const manifest = await withTimeout(fetchFrontendManifest(), 5_000)
      if (manifest?.notes) notes.value = manifest.notes
    } else if (outcome?.status === 'alreadyStaged') {
      frontVersion.value = outcome.version
      frontStaged.value = true
    }
  } catch {
    // 前端查不动：不影响外壳那条
  }

  if (shellUpdate.value?.body) {
    notes.value = notes.value
      ? `${shellUpdate.value.body}\n${notes.value}`
      : shellUpdate.value.body
  }

  if (!shellUpdate.value && !frontVersion.value) return pass()
  phase.value = 'ready'
})

/** 下载前端包到"就位"。返回 true = 已就位（含上次就位过的） */
async function runFrontendDownload(): Promise<boolean> {
  if (frontStaged.value) return true

  downloadLabel.value = '正在下载前端包…'
  percent.value = 0
  phase.value = 'downloading'
  let unlisten: (() => void) | null = null
  try {
    unlisten = await onDownloadProgress((p) => {
      percent.value = p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0
    })
    const done = await download()
    return done.status === 'staged' || done.status === 'alreadyStaged'
  } catch {
    return false
  } finally {
    unlisten?.()
  }
}

async function onUpdate() {
  phase.value = 'downloading'

  // 先把前端包放到位（只就位，不重启）
  const frontOk = frontVersion.value ? await runFrontendDownload() : false

  if (shellUpdate.value) {
    downloadLabel.value = '正在下载外壳安装包…'
    percent.value = 0
    let received = 0
    let off: (() => void) | null = null
    try {
      off = await onShellProgress((p) => {
        received += p.chunk
        if (p.total) {
          percent.value = Math.min(99, Math.round((received / p.total) * 100))
        }
      })
      // 装完安装器会退出并重启应用，这行之后的代码跑不到
      await installShell()
      return
    } catch {
      // 外壳没装成：前端要是在这儿就位了，就先重启让前端生效
      if (frontOk) {
        try {
          await relaunch()
          return
        } catch {
          /* 落到放行 */
        }
      }
      return pass()
    } finally {
      off?.()
    }
  }

  if (frontOk) {
    try {
      await relaunch()
      return
    } catch {
      /* 落到放行 */
    }
  }
  pass()
}
</script>

<template>
  <div class="app-bg rt-center">
    <div class="rt-gate">
      <div class="rt-gate-brand">RTarget</div>

      <p v-if="phase === 'checking'" class="rt-meta">正在检查更新…</p>

      <template v-else-if="phase === 'downloading'">
        <p class="rt-meta">{{ downloadLabel }}</p>
        <div class="rt-gate-bar"><i :style="{ width: percent + '%' }" /></div>
        <p class="rt-num">{{ percent }}%</p>
      </template>

      <template v-else>
        <p class="rt-meta">有新版本</p>
        <div class="rt-gate-list">
          <div v-if="shellUpdate" class="rt-gate-row">
            <span class="rt-gate-k">外壳</span>
            <span class="rt-gate-v rt-num">
              {{ shellUpdate.currentVersion }} → {{ shellUpdate.version }}
            </span>
          </div>
          <div v-if="frontVersion" class="rt-gate-row">
            <span class="rt-gate-k">前端</span>
            <span class="rt-gate-v rt-num">
              {{ frontCurrent ? frontCurrent + ' → ' : '' }}{{ frontVersion }}
            </span>
          </div>
        </div>
        <div v-if="noteLines.length" class="rt-gate-notes">
          <p v-for="(line, i) in noteLines" :key="i">{{ line }}</p>
        </div>
        <div class="rt-gate-actions">
          <button class="rbtn-primary" @click="onUpdate">更新并重启</button>
          <button class="rbtn" @click="quit()">退出应用</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rt-gate {
  width: 100%;
  max-width: 340px;
  padding: 24px;
  text-align: center;
}
.rt-gate-brand {
  margin-bottom: 20px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.rt-gate-bar {
  height: 6px;
  margin: 14px 0 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 999px;
}
.rt-gate-bar > i {
  display: block;
  height: 100%;
  background: var(--rt-accent, #4b3fe3);
  border-radius: 999px;
  transition: width 0.2s;
}
.rt-gate-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 0 4px;
}
.rt-gate-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--rt-card, rgba(255, 255, 255, 0.7));
}
.rt-gate-k {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--rt-tx3, #888);
}
.rt-gate-v {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.rt-gate-notes {
  max-height: 132px;
  margin: 8px 0 0;
  padding: 8px 12px;
  overflow-y: auto;
  text-align: left;
  border-radius: 10px;
  background: var(--rt-card, rgba(255, 255, 255, 0.7));
}
.rt-gate-notes p {
  margin: 0;
  padding: 2px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--rt-tx2, #555);
}
.rt-gate-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}
</style>

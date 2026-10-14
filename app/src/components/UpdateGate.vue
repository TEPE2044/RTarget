<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { check, download, onDownloadProgress, quit, relaunch } from '../lib/desktopUpdate'

/**
 * 桌面端更新闸门
 *
 * 启动时挡在最前面：有新版就必须更新（或退出应用），没新版/检查失败一律放行。
 *
 * **四条放行条件**（前两条来自"网络问题不能把人挡在门外"，后两条是防止永久锁死）：
 *   1. 没有新版（upToDate）
 *   2. 检查 / 下载失败（断网、404、签名校验不过、超时）
 *   3. 候选包已被拉黑（blacklisted）—— 它之前启动失败过，再挡就永远进不去
 *   4. 壳太旧（shellTooOld）—— 这个包要的新原生能力，本安装包没有，只能重装
 *
 * 判定只认「确实看到新版且已下载就位」这一种情况。
 */

type Phase = 'checking' | 'downloading' | 'ready'

const emit = defineEmits<{ pass: [] }>()

const phase = ref<Phase>('checking')
const percent = ref(0)
const version = ref('')

/** 检查阶段的硬超时：网络卡住不能把应用永远挂在"检查中" */
const CHECK_TIMEOUT_MS = 15_000

function pass() {
  emit('pass')
}

function ready(v: string) {
  version.value = v
  phase.value = 'ready'
}

/** 超时返回 null（=> 当作检查失败，放行） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

onMounted(async () => {
  try {
    const outcome = await withTimeout(check(), CHECK_TIMEOUT_MS)
    if (!outcome) return pass()
    if (outcome.status === 'available') return void runDownload()
    if (outcome.status === 'alreadyStaged') return ready(outcome.version)
    // upToDate / blacklisted / shellTooOld —— 都放行
    return pass()
  } catch {
    // 拿不到清单（断网 / 文件不存在 / 签名不过）：绝不挡门
    return pass()
  }
})

async function runDownload() {
  phase.value = 'downloading'
  let unlisten: (() => void) | null = null
  try {
    unlisten = await onDownloadProgress((p) => {
      percent.value = p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0
    })
    const outcome = await download()
    if (outcome.status === 'staged' || outcome.status === 'alreadyStaged') return ready(outcome.version)
    // upToDate / blacklisted / shellTooOld —— 放行
    return pass()
  } catch {
    // 下载或校验失败 —— 放行，不把用户锁在外面
    return pass()
  } finally {
    unlisten?.()
  }
}

async function onUpdate() {
  try {
    await relaunch()
  } catch {
    // 重启都没成：留在这一屏，用户可以再点一次或退出
  }
}
</script>

<template>
  <div class="app-bg rt-center">
    <div class="rt-gate">
      <div class="rt-gate-brand">RTarget</div>

      <p v-if="phase === 'checking'" class="rt-meta">正在检查更新…</p>

      <template v-else-if="phase === 'downloading'">
        <p class="rt-meta">正在下载新版本…</p>
        <div class="rt-gate-bar"><i :style="{ width: percent + '%' }" /></div>
        <p class="rt-num">{{ percent }}%</p>
      </template>

      <template v-else>
        <p class="rt-meta">新版本已就绪</p>
        <p class="rt-gate-ver rt-num">{{ version }}</p>
        <p class="rt-meta">重启后生效</p>
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
  max-width: 320px;
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
.rt-gate-ver {
  margin: 6px 0;
  font-size: 18px;
}
.rt-gate-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}
</style>

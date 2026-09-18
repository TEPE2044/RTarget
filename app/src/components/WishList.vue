<script setup lang="ts">
/**
 * 愿望单
 *
 * 定位：奖励 B 的备选池。设目标时从这儿挑一个，A 达成的那一刻愿望就算兑现
 * （自动标记已实现，见 game.ts 的 completeNode）。也可以手动标记 ——
 * 有些愿望不是靠押注系统达成的。
 *
 * 愿望是全局的（跨存档共用），不跟着存档走。
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { isAuthError, useAuth } from '../lib/auth'
import {
  createWish, updateWish, deleteWish, setWishDone, reopenWish,
} from '../lib/game'
import type { Wish } from '../lib/game'

const { forceSignOut } = useAuth()

const props = defineProps<{ wishes: Wish[]; busy?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const draft = ref('')
/** 正在改文案的那一条 */
const editingId = ref<string | null>(null)
const editingText = ref('')

const openWishes = computed(() => props.wishes.filter((w) => w.status === 'open'))
const doneWishes = computed(() => props.wishes.filter((w) => w.status === 'done'))

/** 统一的动作包装：登录态失效要踢回登录页，不能只弹个 toast */
async function act(fn: () => Promise<void>) {
  try {
    await fn()
  } catch (e) {
    if (isAuthError(e)) {
      await forceSignOut()
      message.warning('登录状态已失效，请重新登录')
      return
    }
    message.error((e as Error).message)
  }
}

function onAdd() {
  const text = draft.value.trim()
  if (!text) return
  return act(async () => {
    await createWish(text)
    draft.value = ''
    message.success('已加进愿望单')
    emit('refresh')
  })
}

function startEdit(w: Wish) {
  editingId.value = w.id
  editingText.value = w.content
}

function cancelEdit() {
  editingId.value = null
  editingText.value = ''
}

function saveEdit() {
  if (!editingId.value) return
  const text = editingText.value.trim()
  if (!text) return cancelEdit()
  return act(async () => {
    await updateWish(editingId.value!, text)
    cancelEdit()
    emit('refresh')
  })
}

function onDone(w: Wish) {
  return act(async () => {
    await setWishDone(w.id)
    message.success(`「${w.content}」已标记为实现`)
    emit('refresh')
  })
}

function onReopen(w: Wish) {
  return act(async () => {
    await reopenWish(w.id)
    message.success('已放回愿望单')
    emit('refresh')
  })
}

function onDelete(w: Wish) {
  return act(async () => {
    await deleteWish(w.id)
    message.success('已从愿望单删掉')
    emit('refresh')
  })
}

function dateText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('zh-CN') : ''
}
</script>

<template>
  <div>
    <!-- ---------- 加一个愿望 ---------- -->
    <div class="rt-card rt-pad">
      <div class="rt-line1">
        <span class="rt-sec">想要什么</span>
        <span class="rt-meta rt-push">{{ openWishes.length }} 个待实现</span>
      </div>
      <div class="rt-line1 rt-gap8" style="flex-wrap: nowrap">
        <a-input v-model:value="draft" placeholder="比如：看一场电影、买那本书"
          :disabled="busy" @keyup.enter="onAdd()" />
        <button class="rbtn-primary rbtn-lg" :disabled="busy || !draft.trim()" @click="onAdd()">
          加入
        </button>
      </div>
      <p class="rt-meta" style="margin: 8px 2px 0">
        设目标时可以从这儿挑一个当奖励 —— A 达成那一刻，它就算兑现了。
      </p>
    </div>

    <!-- ---------- 待实现 ---------- -->
    <div class="rt-line1 rt-gap20">
      <span class="rt-sec">还没实现的</span>
      <span class="rt-meta rt-push">{{ openWishes.length }} 个</span>
    </div>

    <div class="rt-gap8" style="display: flex; flex-direction: column; gap: 10px">
      <div v-for="w in openWishes" :key="w.id" class="rt-card rt-cardwrap">
        <div class="rt-rail rt-rail-blue"></div>
        <div class="rt-node-body rt-pad">
          <!-- 编辑态 -->
          <div v-if="editingId === w.id" class="rt-line1" style="flex-wrap: nowrap">
            <a-input v-model:value="editingText" size="small" :disabled="busy"
              @keyup.enter="saveEdit()" @keyup.esc="cancelEdit()" />
            <button class="rbtn" :disabled="busy" @click="saveEdit()">✓</button>
            <button class="rbtn" @click="cancelEdit()">✕</button>
          </div>

          <div v-else class="rt-line1" style="flex-wrap: nowrap">
            <span class="rt-t14s rt-li-main rt-wish-tx" style="cursor: pointer"
              @click="startEdit(w)">{{ w.content }}</span>
            <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy" aria-label="标记为实现"
              @click="onDone(w)">
              <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.8 12.6 9.6 17.4 19.2 6.9" />
              </svg>
            </button>
            <a-popconfirm title="从愿望单删掉？已经立过的目标不受影响。" ok-text="删除" cancel-text="取消"
              @confirm="onDelete(w)">
              <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy"
                aria-label="删除">
                <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
                </svg>
              </button>
            </a-popconfirm>
          </div>
        </div>
      </div>
    </div>

    <div v-if="openWishes.length === 0" class="rt-card rt-center-tx rt-gap8" style="padding: 26px">
      <span class="rt-meta">还没有想做的事，上面加一个。</span>
    </div>

    <!-- ---------- 已实现 ---------- -->
    <div v-if="doneWishes.length > 0" class="rt-line1 rt-gap20">
      <span class="rt-sec">已经实现的</span>
      <span class="rt-meta rt-push">{{ doneWishes.length }} 个</span>
    </div>

    <div v-if="doneWishes.length > 0" class="rt-gap8"
      style="display: flex; flex-direction: column; gap: 10px">
      <div v-for="w in doneWishes" :key="w.id" class="rt-card rt-cardwrap">
        <div class="rt-rail rt-rail-green"></div>
        <div class="rt-node-body rt-pad">
          <div class="rt-line1" style="flex-wrap: nowrap">
            <span class="rt-t14 rt-li-main rt-wish-done">{{ w.content }}</span>
            <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy" aria-label="放回愿望单"
              @click="onReopen(w)">
              <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.6 11.4a7.6 7.6 0 1 1 2.2 5.4" />
                <path d="M4.4 6.2v5.4h5.4" />
              </svg>
            </button>
            <a-popconfirm title="从愿望单删掉？已经立过的目标不受影响。" ok-text="删除" cancel-text="取消"
              @confirm="onDelete(w)">
              <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy"
                aria-label="删除">
                <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
                </svg>
              </button>
            </a-popconfirm>
          </div>
          <p class="rt-meta" style="margin: 2px 0 0">{{ dateText(w.done_at) }} 兑现</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt-wish-tx { white-space: normal; word-break: break-word; }
.rt-wish-done { color: var(--rt-tx3); white-space: normal; word-break: break-word; }
</style>

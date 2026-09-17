<script setup lang="ts">
/**
 * 目标单（普通 TODOLIST）
 *
 * 和押注系统**完全无关**：不押注、不加分、不扣分、没有死线。
 * 它的用处是当「目标 A 的备选池」——设目标时可以从这儿挑一条去立项，
 * 挑中的那条会从清单移出（taken），事情就进「执行」页了。
 *
 * 三态在数据层：open 待办 / taken 已立项 / done 直接勾掉。
 * 这里只显示 open 和 done —— taken 的已经不在清单里了。
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { isAuthError, useAuth } from '../lib/auth'
import { createTodo, updateTodo, deleteTodo, setTodoDone, reopenTodo } from '../lib/game'
import type { Todo } from '../lib/game'

const { forceSignOut } = useAuth()

const props = defineProps<{ todos: Todo[]; busy?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const draft = ref('')
const editingId = ref<string | null>(null)
const editingText = ref('')

const openTodos = computed(() => props.todos.filter((t) => t.status === 'open'))
const doneTodos = computed(() => props.todos.filter((t) => t.status === 'done'))

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
    await createTodo(text)
    draft.value = ''
    message.success('已加进目标单')
    emit('refresh')
  })
}

function startEdit(t: Todo) {
  editingId.value = t.id
  editingText.value = t.content
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
    await updateTodo(editingId.value!, text)
    cancelEdit()
    emit('refresh')
  })
}

function onDone(t: Todo) {
  return act(async () => {
    await setTodoDone(t.id)
    message.success('完成，没动分数')
    emit('refresh')
  })
}

function onReopen(t: Todo) {
  return act(async () => {
    await reopenTodo(t.id)
    message.success('已放回待办')
    emit('refresh')
  })
}

function onDelete(t: Todo) {
  return act(async () => {
    await deleteTodo(t.id)
    message.success('已删掉')
    emit('refresh')
  })
}

function dateText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('zh-CN') : ''
}
</script>

<template>
  <div>
    <!-- ---------- 加一条 ---------- -->
    <div class="rt-card rt-pad">
      <div class="rt-line1">
        <span class="rt-sec">要做的事</span>
        <span class="rt-meta rt-push">{{ openTodos.length }} 条待办</span>
      </div>
      <div class="rt-line1 rt-gap8" style="flex-wrap: nowrap">
        <a-input v-model:value="draft" placeholder="随手记一条，比如：把书桌收拾了"
          :disabled="busy" @keyup.enter="onAdd()" />
        <button class="rbtn-primary rbtn-lg" :disabled="busy || !draft.trim()" @click="onAdd()">
          加入
        </button>
      </div>
      <p class="rt-meta" style="margin: 8px 2px 0">
        这些不押注、不加分也不扣分，就是记着。想让它变成正式目标，
        去「执行」页设目标时可以从这儿挑。
      </p>
    </div>

    <!-- ---------- 待办 ---------- -->
    <div class="rt-line1 rt-gap20">
      <span class="rt-sec">还没做的</span>
      <span class="rt-meta rt-push">{{ openTodos.length }} 条</span>
    </div>

    <div class="rt-gap8" style="display: flex; flex-direction: column; gap: 10px">
      <div v-for="t in openTodos" :key="t.id" class="rt-card rt-cardwrap">
        <div class="rt-rail rt-rail-blue"></div>
        <div class="rt-node-body rt-pad">
          <div v-if="editingId === t.id" class="rt-line1" style="flex-wrap: nowrap">
            <a-input v-model:value="editingText" size="small" :disabled="busy"
              @keyup.enter="saveEdit()" @keyup.esc="cancelEdit()" />
            <button class="rbtn" :disabled="busy" @click="saveEdit()">存</button>
            <button class="rbtn" @click="cancelEdit()">撤</button>
          </div>

          <div v-else class="rt-line1" style="flex-wrap: nowrap">
            <span class="rt-t14s rt-li-main rt-todo-tx" style="cursor: pointer"
              @click="startEdit(t)">{{ t.content }}</span>
            <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy" aria-label="完成"
              @click="onDone(t)">
              <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.8 12.6 9.6 17.4 19.2 6.9" />
              </svg>
            </button>
            <a-popconfirm title="删掉这条待办？" ok-text="删除" cancel-text="取消" @confirm="onDelete(t)">
              <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy" aria-label="删除">
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

    <div v-if="openTodos.length === 0" class="rt-card rt-center-tx rt-gap8" style="padding: 26px">
      <span class="rt-meta">清单空的，上面加一条。</span>
    </div>

    <!-- ---------- 已完成 ---------- -->
    <div v-if="doneTodos.length > 0" class="rt-line1 rt-gap20">
      <span class="rt-sec">做完的</span>
      <span class="rt-meta rt-push">{{ doneTodos.length }} 条</span>
    </div>

    <div v-if="doneTodos.length > 0" class="rt-gap8"
      style="display: flex; flex-direction: column; gap: 10px">
      <div v-for="t in doneTodos" :key="t.id" class="rt-card rt-cardwrap">
        <div class="rt-rail rt-rail-gray"></div>
        <div class="rt-node-body rt-pad">
          <div class="rt-line1" style="flex-wrap: nowrap">
            <span class="rt-t14 rt-li-main rt-todo-done">{{ t.content }}</span>
            <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy" aria-label="放回待办"
              @click="onReopen(t)">
              <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.6 11.4a7.6 7.6 0 1 1 2.2 5.4" />
                <path d="M4.4 6.2v5.4h5.4" />
              </svg>
            </button>
            <a-popconfirm title="删掉这条待办？" ok-text="删除" cancel-text="取消" @confirm="onDelete(t)">
              <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy" aria-label="删除">
                <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
                </svg>
              </button>
            </a-popconfirm>
          </div>
          <p class="rt-meta" style="margin: 2px 0 0">{{ dateText(t.done_at) }} 勾掉</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt-todo-tx { white-space: normal; word-break: break-word; }
.rt-todo-done { color: var(--rt-tx3); text-decoration: line-through; white-space: normal; word-break: break-word; }
</style>

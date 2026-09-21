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
/** 新建时的次数（电量格）。默认 1 = 一次性的；> 1 就是"打算重复做的事" */
const draftTimes = ref(1)
const editingId = ref<string | null>(null)
const editingText = ref('')
/** 编辑中的备忘录。跟文案一起存，所以清空就是删掉备注（不是"不改"） */
const editingNote = ref('')

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
  const times = draftTimes.value // 先存下来：下面会重置
  return act(async () => {
    await createTodo(text, times)
    draft.value = ''
    draftTimes.value = 1
    message.success(times > 1 ? `已加进目标单（${times} 次）` : '已加进目标单')
    emit('refresh')
  })
}

function startEdit(t: Todo) {
  editingId.value = t.id
  editingText.value = t.content
  editingNote.value = t.note ?? ''
}

function cancelEdit() {
  editingId.value = null
  editingText.value = ''
  editingNote.value = ''
}

function saveEdit() {
  if (!editingId.value) return
  const text = editingText.value.trim()
  if (!text) return cancelEdit()
  return act(async () => {
    await updateTodo(editingId.value!, text, editingNote.value)
    cancelEdit()
    emit('refresh')
  })
}

function onDone(t: Todo) {
  return act(async () => {
    await setTodoDone(t.id)
    message.success('已完成该任务')
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
        <!-- 次数：打算重复做几次。默认 1，超过 1 就是"电量格"。
             addon 那个 × 是必要的 —— 不然一个孤零零的"1"看不出是什么 -->
        <a-input-number v-model:value="draftTimes" :min="1" :max="99" :controls="false"
          addon-before="×" class="rt-times-in" :disabled="busy" />
        <button class="rbtn-primary rbtn-lg" :disabled="busy || !draft.trim()" @click="onAdd()">
          加入
        </button>
      </div>
      <p class="rt-meta" style="margin: 8px 2px 0">
        这些不押注、不加分也不扣分，就是记着。想让它变成正式目标，
        去「执行」页设目标时可以从这儿挑。
      </p>
      <p class="rt-meta" style="margin: 4px 2px 0">
        中间那个数字是「打算做几次」：设成 3，就每完成一次由它立项的目标扣一格，扣完这条就用完。
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
          <div v-if="editingId === t.id" style="display: flex; flex-direction: column; gap: 8px">
            <div class="rt-line1" style="flex-wrap: nowrap">
              <a-input v-model:value="editingText" size="small" :disabled="busy"
                @keyup.enter="saveEdit()" @keyup.esc="cancelEdit()" />
              <button class="rbtn" :disabled="busy" @click="saveEdit()">✓</button>
              <button class="rbtn" @click="cancelEdit()">✕</button>
            </div>
            <!-- 备忘录跟文案一起存（清空 = 删掉备注，不是"不改"） -->
            <a-textarea v-model:value="editingNote" :rows="2" :disabled="busy"
              placeholder="备忘录（可选）：要怎么做、要注意什么" />
          </div>

          <div v-else>
            <div class="rt-line1" style="flex-wrap: nowrap">
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
            <!-- 电量格：只有多次的才显示（一次性的那个格子没信息量） -->
            <div v-if="t.times_total > 1" class="rt-line2" style="margin-top: 5px">
              <span class="rt-dots">
                <span v-for="i in t.times_total" :key="i" class="rt-dot"
                  :class="{ on: i <= t.times_left }"></span>
              </span>
              <span class="rt-meta">还剩 {{ t.times_left }} / {{ t.times_total }} 次</span>
            </div>
            <!-- 备忘录：有才显示。左边一道竖线当引用样式，跟正文分开 -->
            <p v-if="t.note" class="rt-meta rt-todo-note">{{ t.note }}</p>
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
          <p class="rt-meta" style="margin: 2px 0 0">
            {{ dateText(t.done_at) }} 勾掉<span v-if="t.times_total > 1"> · 共 {{ t.times_total }} 次</span>
          </p>
          <p v-if="t.note" class="rt-meta rt-todo-note">{{ t.note }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt-todo-tx { white-space: normal; word-break: break-word; }
.rt-todo-done { color: var(--rt-tx3); text-decoration: line-through; white-space: normal; word-break: break-word; }

/* 备忘录：左边一道竖线当引用样式，跟正文分开。多行的照原样换行 */
.rt-todo-note {
  margin: 6px 0 0;
  padding-left: 8px;
  border-left: 2px solid var(--rt-line-strong);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 新建时的次数输入：只要个数字，不要上下箭头（手机上很难点）。
   宽度算上 × 那个 addon。 */
.rt-times-in { width: 76px; flex: 0 0 auto; }
.rt-times-in :deep(input) { text-align: center; }

/* 电量格：小方块比圆点更像"格" */
.rt-dots { display: inline-flex; align-items: center; gap: 3px; }
.rt-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--rt-line-strong);
}
.rt-dot.on { background: var(--rt-blue); }
</style>

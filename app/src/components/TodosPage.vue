<script setup lang="ts">
import { reactive } from 'vue'
import { booted, busy, doneTodos, openTodos, reportError, saveTodo, toggleTodo } from '../lib/store'
import type { Todo } from '../lib/game'

/** 编辑抽屉：标题 + 内容 + 取消 / 确定（内容支持 Markdown，默认空） */
const sheet = reactive({ show: false, id: null as string | null, title: '', text: '' })

function open(t: Todo | null) {
  sheet.show = true
  sheet.id = t?.id ?? null
  sheet.title = t?.content ?? ''
  sheet.text = t?.note ?? ''
}

/** 右下悬浮球借这个入口 */
function openNew() { open(null) }
defineExpose({ openNew })

async function save() {
  if (!sheet.title.trim()) return
  try {
    await saveTodo({ id: sheet.id, title: sheet.title, text: sheet.text })
    sheet.show = false
  } catch (e) {
    await reportError(e)
  }
}
</script>

<template>
  <van-skeleton v-if="!booted" title :row="6" style="padding:16px 0" />
  <template v-else>
    <p class="rt-cap">未完成</p>
    <!-- 待办的内容以引用样式挂在标题下面（见 mechanism.md） -->
    <div class="rt-card rt-listpad">
      <div v-for="t in openTodos" :key="t.id" class="rt-li">
        <span class="rt-li-ic">
          <van-checkbox :model-value="false" @click.stop="toggleTodo(t)" />
        </span>
        <div class="rt-li-2" @click="open(t)">
          <div class="rt-li-2-t">{{ t.content }}</div>
          <!-- 带次数的待办 = 电量格：亮着的还剩几次 -->
          <div v-if="t.times_total > 1" class="rt-bar" style="margin-top:4px">
            <span class="rt-batt">
              <i v-for="i in t.times_total" :key="i" :class="{ on: i <= t.times_left }"></i>
            </span>
            <span class="rt-batt-tx">还剩 {{ t.times_left }} / {{ t.times_total }} 次</span>
          </div>
          <div v-if="t.note" class="rt-meta rt-quote">{{ t.note }}</div>
        </div>
      </div>
      <div v-if="!openTodos.length" class="rt-li">
        <span class="rt-meta">还没有待办</span>
      </div>
    </div>

    <!-- 已完成的压在下面，别跟待办的打架 -->
    <template v-if="doneTodos.length">
      <p class="rt-cap rt-gap26">已完成</p>
      <div class="rt-card rt-listpad">
        <div v-for="t in doneTodos" :key="t.id" class="rt-li rt-done">
          <span class="rt-li-ic">
            <van-checkbox :model-value="true" @click.stop="toggleTodo(t)" />
          </span>
          <div class="rt-li-2" @click="open(t)">
            <div class="rt-li-2-t">{{ t.content }}</div>
            <div v-if="t.note" class="rt-meta rt-quote">{{ t.note }}</div>
          </div>
        </div>
      </div>
    </template>
  </template>

  <!-- 编辑抽屉：只留标题 + 内容 -->
  <van-popup v-model:show="sheet.show" position="bottom" round>
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">{{ sheet.id ? '编辑待办' : '记一条待办' }}</div>
      <div class="rt-sheet-body">
        <van-field v-model="sheet.title" label="标题" placeholder="要做什么" />
        <van-field v-model="sheet.text" label="内容" type="textarea" autosize :rows="4"
          placeholder="细节、步骤，可留空" />
        <div class="rt-sheet-actions">
          <button class="rbtn-primary" :disabled="busy || !sheet.title.trim()" @click="save()">确定</button>
          <button class="rbtn" @click="sheet.show = false">取消</button>
        </div>
      </div>
    </div>
  </van-popup>
</template>
<script setup lang="ts">
import { reactive } from 'vue'
import { booted, doneTodos, openTodos, saveTodo, toggleTodo } from '../lib/store'
import type { Todo } from '../lib/game'
import { reportError } from '../lib/store'

const sheet = reactive({ show: false, id: null as string | null, title: '', text: '' })

function open(t: Todo | null) {
  sheet.show = true
  sheet.id = t?.id ?? null
  sheet.title = t?.content ?? ''
  sheet.text = t?.note ?? ''
}

/** 首页「记待办」按钮借这个入口 */
function openNew() { open(null) }
defineExpose({ openNew })

async function save() {
  try {
    await saveTodo({ id: sheet.id, title: sheet.title, text: sheet.text })
    sheet.show = false
  } catch (e) {
    await reportError(e)
  }
}
</script>

<template>
  <van-nav-bar title="待办">
    <template #right>
      <van-icon name="plus" size="20" @click="open(null)" />
    </template>
  </van-nav-bar>

  <div class="pad">
    <van-skeleton v-if="!booted" title :row="6" />
    <template v-else>
      <van-cell-group v-if="openTodos.length" inset>
        <van-cell v-for="t in openTodos" :key="t.id" :title="t.content" clickable @click="open(t)">
          <template #icon>
            <span class="cell-lead">
              <van-checkbox :model-value="false" @click.stop="toggleTodo(t)" />
            </span>
          </template>
          <template #label>
            <!-- 多次待办 = 电量格：格数 = 次数，亮着的还剩几次 -->
            <div v-if="t.times_total > 1" class="batt-line">
              <span class="batt">
                <i v-for="i in t.times_total" :key="i" :class="{ on: i <= t.times_left }"></i>
              </span>
              <span class="batt-tx">还剩 {{ t.times_left }} / {{ t.times_total }} 次</span>
            </div>
            <p v-if="t.note" class="ellip t-note">{{ t.note }}</p>
          </template>
        </van-cell>
      </van-cell-group>
      <van-empty v-else description="待办是空的 —— 想到什么就记一条" />

      <van-cell-group v-if="doneTodos.length" inset title="已勾掉">
        <van-cell v-for="t in doneTodos" :key="t.id" :title="t.content" class="muted" clickable
          @click="open(t)">
          <template #icon>
            <span class="cell-lead">
              <van-checkbox :model-value="true" @click.stop="toggleTodo(t)" />
            </span>
          </template>
        </van-cell>
      </van-cell-group>
    </template>
  </div>

  <!-- 编辑抽屉：标题 + 内容 + 取消 / 确定 -->
  <van-popup v-model:show="sheet.show" position="bottom" round>
    <div class="sheet">
      <div class="sheet-head">{{ sheet.id ? '编辑待办' : '记一条待办' }}</div>
      <van-field v-model="sheet.title" label="标题" placeholder="要做什么" />
      <van-field v-model="sheet.text" label="内容" type="textarea" autosize rows="4"
        placeholder="写计划、写细节……支持 Markdown" />
      <div class="foot">
        <van-button block plain @click="sheet.show = false">取消</van-button>
        <van-button block type="primary" @click="save">确定</van-button>
      </div>
    </div>
  </van-popup>
</template>
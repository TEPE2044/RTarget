<script setup lang="ts">
import { reactive } from 'vue'
import {
  askDeleteTodo, booted, busy, decTodoTimes, doneTodos, openTodos, reportError, saveTodo,
  toggleTodo,
} from '../lib/store'
import type { Todo } from '../lib/game'

/** 新建 / 编辑共用这一个抽屉 */
const sheet = reactive({
  show: false,
  id: null as string | null,
  title: '',
  text: '',
  /** 打算做几次（只有新建时能设，跟 0.0.1 一致） */
  times: 1,
})

function open(t: Todo | null) {
  sheet.show = true
  sheet.id = t?.id ?? null
  sheet.title = t?.content ?? ''
  sheet.text = t?.note ?? ''
  sheet.times = 1
}

/** 右下悬浮球借这个入口 */
function openNew() { open(null) }
defineExpose({ openNew })

async function save() {
  if (!sheet.title.trim()) return
  try {
    await saveTodo({
      id: sheet.id, title: sheet.title, text: sheet.text, times: sheet.times,
    })
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
        <span class="rt-li-act">
          <!-- 次数待办的「−」：主动把次数减一格（比如少做一次）。
               减到 0 就整条用完、进已完成。一次性的待办不给这个键 -->
          <button v-if="t.times_total > 1" class="rt-iconbtn rt-iconbtn-sm" :disabled="busy"
            aria-label="减少一次" @click.stop="decTodoTimes(t)">
            <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 12h12" />
            </svg>
          </button>
          <!-- 完成：勾选图标（原来这里是复选框，方框又小又难点，改回图标按钮） -->
          <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy"
            aria-label="完成" @click.stop="toggleTodo(t)">
            <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.8 12.6 9.6 17.4 19.2 6.9" />
            </svg>
          </button>
          <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy"
            aria-label="删除" @click.stop="askDeleteTodo(t)">
            <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
            </svg>
          </button>
        </span>
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
          <div class="rt-li-2" @click="open(t)">
            <div class="rt-li-2-t">{{ t.content }}</div>
            <div v-if="t.note" class="rt-meta rt-quote">{{ t.note }}</div>
          </div>
          <span class="rt-li-act">
            <!-- 放回待办：点错了得能撤回 -->
            <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy"
              aria-label="放回待办" @click.stop="toggleTodo(t)">
              <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.6 11.4a7.6 7.6 0 1 1 2.2 5.4" />
                <path d="M4.4 6.2v5.4h5.4" />
              </svg>
            </button>
            <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy"
              aria-label="删除" @click.stop="askDeleteTodo(t)">
              <svg class="rt-ico" width="19" height="19" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
              </svg>
            </button>
          </span>
        </div>
      </div>
    </template>
  </template>

  <!-- 新建 / 编辑抽屉。
       close-on-click-overlay=false：**里头是能写字的地方**，而点一下旁边那块暗色遮罩
       就把它整个收掉是很容易发生的（一只手扶着看、另一只手误碰）—— 记了一半的内容
       会连招呼都不打就没了。关掉它，只剩下面那个「取消」能收。（全屏的详情 / 向导
       本来就是这么处理的。） -->
  <van-popup v-model:show="sheet.show" position="bottom" round :close-on-click-overlay="false">
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">{{ sheet.id ? '编辑待办' : '记一条待办' }}</div>
      <div class="rt-sheet-body">
        <van-field v-model="sheet.title" label="标题" placeholder="要做什么" />
        <!-- 次数：打算重复做几次。默认 1 = 一次性的；>1 就显示电量格。
             建完不再改（后端 updateTodo 也不管这一列），所以只在新建时给 -->
        <van-field v-if="!sheet.id" label="次数" placeholder="1">
          <template #input>
            <van-stepper v-model="sheet.times" :min="1" :max="365" integer />
            <span class="rt-meta" style="margin-left:10px">
              {{ sheet.times > 1 ? `分 ${sheet.times} 次做完` : '一次性的' }}
            </span>
          </template>
        </van-field>
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

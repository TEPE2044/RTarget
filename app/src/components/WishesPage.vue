<script setup lang="ts">
import { reactive } from 'vue'
import {
  addWish, booted, busy, doneWishes, goals, openWishes, reportError, toggleWish,
} from '../lib/store'
import { fmtDay } from '../lib/format'

const sheet = reactive({ show: false, text: '' })

/** 右下悬浮球借这个入口 */
function openNew() { sheet.text = ''; sheet.show = true }
defineExpose({ openNew })

/** 这个愿望被哪条进行中的目标挂成了奖励（挂了就别乱动，等它兑现或判负） */
function attachedTo(id: string): string {
  return goals.value.find((g) => g.status === 'active' && g.reward_wish_id === id)?.content ?? ''
}

async function save() {
  const text = sheet.text.trim()
  if (!text) return
  try {
    await addWish(text)
    sheet.show = false
  } catch (e) {
    await reportError(e)
  }
}
</script>

<template>
  <van-skeleton v-if="!booted" title :row="6" style="padding:16px 0" />
  <template v-else>
    <div class="rt-card rt-listpad">
      <div v-for="w in openWishes" :key="w.id" class="rt-li">
        <span class="rt-li-ic"><van-icon name="star-o" /></span>
        <div class="rt-li-2">
          <div class="rt-li-2-t">{{ w.content }}</div>
          <!-- 别顺手写"删除、重新挑"—— 现在没有这两个入口，文案不能提前许诺 -->
          <div v-if="attachedTo(w.id)" class="rt-meta">
            已挂给「{{ attachedTo(w.id) }}」
          </div>
        </div>
        <button class="rbtn" :disabled="busy || !!attachedTo(w.id)"
          @click.stop="toggleWish(w)">兑现</button>
      </div>
      <div v-if="!openWishes.length" class="rt-li">
        <span class="rt-meta">还没有愿望</span>
      </div>
    </div>

    <template v-if="doneWishes.length">
      <p class="rt-cap rt-gap26">已实现</p>
      <div class="rt-card rt-listpad">
        <div v-for="w in doneWishes" :key="w.id" class="rt-li rt-done">
          <span class="rt-li-ic"><van-icon name="passed" /></span>
          <div class="rt-li-2">
            <div class="rt-li-2-t">{{ w.content }}</div>
            <div v-if="w.done_at" class="rt-meta">{{ fmtDay(w.done_at) }} 兑现</div>
          </div>
        </div>
      </div>
    </template>
  </template>

  <van-popup v-model:show="sheet.show" position="bottom" round>
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">加一个愿望</div>
      <div class="rt-sheet-body">
        <van-field v-model="sheet.text" placeholder="想要什么" @keyup.enter="save" />
        <div class="rt-sheet-actions">
          <button class="rbtn-primary" :disabled="busy || !sheet.text.trim()" @click="save()">确定</button>
          <button class="rbtn" @click="sheet.show = false">取消</button>
        </div>
      </div>
    </div>
  </van-popup>
</template>
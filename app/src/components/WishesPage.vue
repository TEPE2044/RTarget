<script setup lang="ts">
import { reactive } from 'vue'
import { addWish, booted, doneWishes, goals, openWishes, reportError, toggleWish } from '../lib/store'
import { fmtDay } from '../lib/format'

/**
 * 愿望单
 *
 * 原型这一页没有"加一个"的入口（原型数据是预置的），但真实现必须能加 ——
 * 否则愿望单一辈子空着，立项向导第 3 步的"从愿望挑"就成了摆设。
 * 所以照着待办页的做法补了个右上角 ＋ 与一个单字段抽屉。
 */
const sheet = reactive({ show: false, text: '' })

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
  <van-nav-bar title="愿望">
    <template #right>
      <van-icon name="plus" size="20" @click="sheet.show = true" />
    </template>
  </van-nav-bar>

  <div class="pad">
    <van-skeleton v-if="!booted" title :row="6" />
    <template v-else>
      <van-cell-group v-if="openWishes.length" inset>
        <van-cell v-for="w in openWishes" :key="w.id" :title="w.content"
          :label="attachedTo(w.id) ? '已挂给「' + attachedTo(w.id) + '」· 兑现或判负前先别动它' : ''">
          <template #right-icon>
            <van-button size="small" plain round icon="success" @click.stop="toggleWish(w)" />
          </template>
        </van-cell>
      </van-cell-group>
      <van-empty v-else description="还没想做的事 —— 加一个" />

      <van-cell-group v-if="doneWishes.length" inset title="已实现">
        <van-cell v-for="w in doneWishes" :key="w.id" :title="w.content"
          :label="w.done_at ? fmtDay(w.done_at) + ' 兑现' : ''" class="muted" />
      </van-cell-group>
    </template>
  </div>

  <van-popup v-model:show="sheet.show" position="bottom" round>
    <div class="sheet">
      <div class="sheet-head">加一个愿望</div>
      <van-field v-model="sheet.text" label="愿望" placeholder="比如：看一场电影"
        @keyup.enter="save" />
      <div class="foot">
        <van-button block plain @click="sheet.show = false">取消</van-button>
        <van-button block type="primary" :disabled="!sheet.text.trim()" @click="save">确定</van-button>
      </div>
    </div>
  </van-popup>
</template>
<script setup lang="ts">
import { reactive } from 'vue'
import {
  addWish, askDeleteWish, booted, busy, doneWishes, goals, openWishes, reportError,
  saveWish, toggleWish,
} from '../lib/store'
import { fmtDay } from '../lib/format'

/** 新建 / 编辑共用这一个抽屉：编辑态用 editId 区分 */
const sheet = reactive({ show: false, editId: null as string | null, text: '' })

/** 右下悬浮球借这个入口 */
function openNew() { sheet.text = ''; sheet.editId = null; sheet.show = true }
defineExpose({ openNew })

function openEdit(id: string, content: string) {
  sheet.text = content
  sheet.editId = id
  sheet.show = true
}

/** 这个愿望被哪条进行中的目标挂成了奖励（挂了就别乱动，等它兑现或判负） */
function attachedTo(id: string): string {
  return goals.value.find((g) => g.status === 'active' && g.reward_wish_id === id)?.content ?? ''
}

async function save() {
  const text = sheet.text.trim()
  if (!text) return
  try {
    if (sheet.editId) await saveWish(sheet.editId, text)
    else await addWish(text)
    sheet.show = false
  } catch (e) {
    await reportError(e)
  }
}
</script>

<template>
  <van-skeleton v-if="!booted" title :row="6" style="padding:16px 0" />
  <template v-else>
    <p class="rt-cap">未实现</p>
    <div class="rt-card rt-listpad">
      <div v-for="w in openWishes" :key="w.id" class="rt-li">
        <span class="rt-li-ic"><van-icon name="star-o" /></span>
        <div class="rt-li-2" @click="openEdit(w.id, w.content)">
          <div class="rt-li-2-t">{{ w.content }}</div>
          <!-- 已被某个进行中的目标挂为奖励：说清它现在为什么不能动 -->
          <div v-if="attachedTo(w.id)" class="rt-meta">
            已挂给「{{ attachedTo(w.id) }}」
          </div>
        </div>
        <span class="rt-li-act">
          <!-- 兑现 / 删除都是同款小图标按钮 —— 一行里混一个文字胶囊 + 一个裸图标，
               形状和视觉重量都对不上（0.0.1 这里两个也都是图标） -->
          <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy || !!attachedTo(w.id)"
            aria-label="兑现" @click.stop="toggleWish(w)">
            <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.8 12.6 9.6 17.4 19.2 6.9" />
            </svg>
          </button>
          <!-- 挂出去的愿望不能删：删了那个目标达成时就无处可兑 -->
          <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger"
            :disabled="busy || !!attachedTo(w.id)" aria-label="删除" @click.stop="askDeleteWish(w)">
            <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
            </svg>
          </button>
        </span>
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
          <div class="rt-li-2" @click="openEdit(w.id, w.content)">
            <div class="rt-li-2-t">{{ w.content }}</div>
            <div v-if="w.done_at" class="rt-meta">{{ fmtDay(w.done_at) }} 兑现</div>
          </div>
          <span class="rt-li-act">
            <!-- 放回愿望单：点错兑现了得能撤回（toggleWish 本来就会走 reopen 分支，
                 之前只是界面上没给入口，等于永远回不去） -->
            <button class="rt-iconbtn rt-iconbtn-sm" :disabled="busy"
              aria-label="放回愿望单" @click.stop="toggleWish(w)">
              <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.6 11.4a7.6 7.6 0 1 1 2.2 5.4" />
                <path d="M4.4 6.2v5.4h5.4" />
              </svg>
            </button>
            <button class="rt-iconbtn rt-iconbtn-sm rt-iconbtn-danger" :disabled="busy"
              aria-label="删除" @click.stop="askDeleteWish(w)">
              <svg class="rt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l1 12.2h8.8L17.4 7" />
              </svg>
            </button>
          </span>
        </div>
      </div>
    </template>
  </template>

  <!-- close-on-click-overlay=false：这点跟待办抽屉同理 —— 里面在写字，
       点一下旁边的暗色遮罩就整个收掉，写到一半的愿望就没了。只留「取消」能收 -->
  <van-popup v-model:show="sheet.show" position="bottom" round :close-on-click-overlay="false">
    <div class="rt-sheet-inner">
      <div class="rt-sheet-head">{{ sheet.editId ? '改愿望' : '加一个愿望' }}</div>
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
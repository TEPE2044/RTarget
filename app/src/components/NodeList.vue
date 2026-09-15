<script setup lang="ts">
import { computed } from 'vue'
import type { GameNode } from '../lib/game'
import { completeNode, concedeNode } from '../lib/game'

const props = defineProps<{ nodes: GameNode[]; busy?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const groups = computed(() => {
  const aNodes = props.nodes.filter((n) => n.kind === 'A')
  return aNodes.map((a) => ({
    a,
    b: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'B') ?? null,
    c: props.nodes.find((n) => n.parent_id === a.id && n.kind === 'C') ?? null,
  }))
})

const tierName: Record<string, string> = { low: '低', mid: '中', high: '高', allin: 'ALL IN' }

function statusText(n: GameNode): string {
  if (n.status === 'bound') return '未开启'
  if (n.status === 'active') return '进行中'
  if (n.completed_at) return '已完成'
  return '已结算'
}

function isOverdue(n: GameNode): boolean {
  return n.status === 'active' && new Date(n.due_at) < new Date()
}

function dueDateText(n: GameNode): string {
  const d = new Date(n.due_at)
  return `${d.getMonth() + 1}/${d.getDate()} 0点`
}

function canComplete(n: GameNode): boolean {
  if (n.status === 'active') return true
  return n.kind === 'A' && n.status === 'settled' && n.compound_a_done === null
}

function canConcede(n: GameNode): boolean {
  return n.status === 'active'
}

async function onComplete(id: string) {
  try {
    await completeNode(id)
    emit('refresh')
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onConcede(id: string) {
  try {
    await concedeNode(id)
    emit('refresh')
  } catch (e) {
    alert((e as Error).message)
  }
}

</script>

<template>
  <a-space direction="vertical" style="width: 100%" :size="16">
    <a-card v-for="g in groups" :key="g.a.id" :bordered="true"
      :body-style="{ padding: '20px' }"
      :style="g.a.status === 'settled' && !g.a.completed_at ? { borderColor: '#ff4d4f' } : {}">
      <!-- A 节点 -->
      <div class="node-block">
        <div class="flex items-center gap-2">
          <a-tag color="blue">目标</a-tag>
          <a-typography-text type="secondary" class="text-xs">{{ tierName[g.a.tier] }} · {{ g.a.stake }} 分</a-typography-text>
          <a-typography-text class="ml-auto text-xs"
            :type="isOverdue(g.a) ? 'danger' : 'secondary'"
            :strong="isOverdue(g.a)">
            {{ isOverdue(g.a) ? '已超时（待结算）' : statusText(g.a) }}
          </a-typography-text>
        </div>
        <p class="content-line">{{ g.a.content }}</p>
        <a-typography-text type="secondary" class="text-xs">到期：{{ dueDateText(g.a) }}</a-typography-text>
        <div v-if="g.a.compound_a_done !== null" style="margin-top: 4px">
          <a-typography-text type="warning" class="text-xs">
            复合体结算：A{{ g.a.compound_a_done ? '✓' : '✗' }} C{{ g.a.compound_c_done ? '✓' : '✗' }}
            <template v-if="g.a.compound_a_done && g.a.compound_c_done">（已返还）</template>
            <template v-else-if="!g.a.compound_a_done && !g.a.compound_c_done">（已再扣）</template>
            <template v-else>（无分）</template>
          </a-typography-text>
        </div>
        <a-space style="margin-top: 12px">
          <a-button v-if="canComplete(g.a)" type="primary" :disabled="busy" @click="onComplete(g.a.id)">完成</a-button>
          <a-popconfirm v-if="canConcede(g.a)" title="确认认输？效果等同超时判负。" ok-text="认输" cancel-text="取消" @confirm="onConcede(g.a.id)">
            <a-button danger :disabled="busy">认输</a-button>
          </a-popconfirm>
        </a-space>
      </div>

      <a-divider style="margin: 16px 0" />

      <!-- B 节点 -->
      <div v-if="g.b" class="node-block" :style="g.b.status === 'bound' ? { opacity: 0.55 } : {}">
        <div class="flex items-center gap-2">
          <a-tag color="green">奖励</a-tag>
          <a-typography-text type="secondary" class="text-xs">{{ tierName[g.b.tier] }} · {{ g.b.stake }} 分</a-typography-text>
          <a-typography-text type="secondary" class="ml-auto text-xs">{{ statusText(g.b) }}</a-typography-text>
        </div>
        <p class="content-line">{{ g.b.content }}</p>
        <a-typography-text v-if="g.b.status === 'bound'" type="secondary" class="text-xs">A 达成时自动加分</a-typography-text>
        <template v-else-if="g.b.status === 'active'">
          <a-typography-text type="success" class="text-xs" style="display: block; margin-bottom: 8px">+{{ g.b.stake }} 分已到账，享受完点确认</a-typography-text>
          <a-button type="primary" :disabled="busy" @click="onComplete(g.b.id)">确认</a-button>
        </template>
        <a-typography-text v-else type="success" class="text-xs">已奖励 {{ g.b.stake }} 分 ✓ 已确认</a-typography-text>
      </div>

      <template v-if="g.c">
        <a-divider style="margin: 16px 0" />
        <!-- C 节点 -->
        <div class="node-block" :style="g.c.status === 'bound' ? { opacity: 0.55 } : {}">
          <div class="flex items-center gap-2">
            <a-tag color="red">惩罚</a-tag>
            <a-typography-text type="secondary" class="text-xs">{{ tierName[g.c.tier] }} · {{ g.c.stake }} 分</a-typography-text>
            <a-typography-text class="ml-auto text-xs"
              :type="isOverdue(g.c) ? 'danger' : 'secondary'"
              :strong="isOverdue(g.c)">
              {{ isOverdue(g.c) ? '已超时（待结算）' : statusText(g.c) }}
            </a-typography-text>
          </div>
          <p class="content-line">{{ g.c.content }}</p>
          <a-typography-text v-if="g.c.status === 'active'" type="secondary" class="text-xs">到期：{{ dueDateText(g.c) }}</a-typography-text>
          <a-space v-if="g.c.status === 'active'" style="margin-top: 12px">
            <a-button type="primary" :disabled="busy" @click="onComplete(g.c.id)">把拖延的事做掉</a-button>
            <a-popconfirm title="确认认输？效果等同超时判负。" ok-text="认输" cancel-text="取消" @confirm="onConcede(g.c.id)">
              <a-button danger :disabled="busy">认输</a-button>
            </a-popconfirm>
          </a-space>
          <a-typography-text v-else-if="g.c.status === 'bound'" type="secondary" class="text-xs">A 判负后开启</a-typography-text>
          <a-typography-text v-else type="secondary" class="text-xs">{{ g.c.completed_at ? '已了结 ✓' : '复合体已结算' }}</a-typography-text>
        </div>
      </template>
    </a-card>

    <a-empty v-if="groups.length === 0" description="还没有目标。设一个，配好奖罚。" />
  </a-space>
</template>

<style scoped>
.content-line {
  font-size: 15px;
  margin: 8px 0 4px;
  line-height: 1.6;
}
</style>

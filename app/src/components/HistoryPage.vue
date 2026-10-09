<script setup lang="ts">
import { booted, historyArchiveId, loadingRecords, records, sealedArchives, selectHistory } from '../lib/store'
import { fmtDayTime, fmtTime } from '../lib/format'

const ICONS: Record<string, string> = {
  done: 'passed', failed: 'revoke', created: 'plus', sealed: 'lock',
}
</script>

<template>
  <van-nav-bar title="历史" />

  <van-skeleton v-if="!booted" title :row="6" />
  <template v-else>
    <div class="pad">
      <template v-if="sealedArchives.length">
        <p class="sec">封档记录</p>
        <div v-for="a in sealedArchives" :key="a.id" class="h-card"
          :class="{ on: a.id === historyArchiveId }" @click="selectHistory(a.id)">
          <div class="h-head">
            <van-icon name="lock" class="h-lock" />
            <span class="h-name">{{ a.name }}</span>
            <span class="h-pill" :class="a.sealed_free ? 'h-pill-free' : 'h-pill-paid'">
              {{ a.sealed_free ? '免费封档' : '扣分封档' }}
            </span>
          </div>
          <p class="h-time">{{ a.sealed_at ? fmtDayTime(a.sealed_at) + ' 封档' : '' }}</p>
        </div>

        <p class="sec">这个存档的记录</p>
        <van-skeleton v-if="loadingRecords" title :row="4" />
        <van-cell-group v-else-if="records.length" inset>
          <van-cell v-for="r in records" :key="r.id" :title="r.text" :label="fmtTime(r.created_at)">
            <template #icon>
              <span class="cell-lead">
                <van-icon :name="ICONS[r.type] || 'passed'" :class="'f-ic f-ic-' + r.type" />
              </span>
            </template>
          </van-cell>
        </van-cell-group>
        <van-empty v-else description="这个存档还没有记录" />
      </template>
      <van-empty v-else description="还没有封档记录 —— 存档封了会出现在这里" />
    </div>
  </template>
</template>
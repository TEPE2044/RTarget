<script setup lang="ts">
import {
  booted, historyArchiveId, loadingRecords, records, sealedArchives, selectHistory,
} from '../lib/store'
import { fmtDayTime, fmtTime } from '../lib/format'

const ICONS: Record<string, string> = {
  done: 'passed', failed: 'revoke', created: 'plus', sealed: 'lock',
}
</script>

<template>
  <van-skeleton v-if="!booted" title :row="6" style="padding:16px 0" />
  <template v-else>
    <template v-if="sealedArchives.length">
      <!-- 最新的排在最前（按封档时间，不是建档时间） -->
      <p class="rt-cap">封档记录</p>
      <div v-for="a in sealedArchives" :key="a.id" class="rt-card rt-hcard"
        :class="{ active: a.id === historyArchiveId }" @click="selectHistory(a.id)">
        <span class="rt-hcard-ic"><van-icon name="lock" size="18" /></span>
        <span class="rt-hname">
          <span>{{ a.name }}</span>
          <span class="rt-meta">{{ a.sealed_at ? fmtDayTime(a.sealed_at) + ' 封档' : '' }}</span>
        </span>
        <!-- 免费 = 绿、扣分 = 红：0.0.1 的封档记录就是这么标"从活力值里出没出钱"的 -->
        <span class="pill" :class="a.sealed_free ? 'p-green' : 'p-red'">
          {{ a.sealed_free ? '免费' : '扣分' }}
        </span>
      </div>

      <p class="rt-cap rt-gap26">记录</p>
      <van-skeleton v-if="loadingRecords" title :row="4" style="padding:8px 0" />
      <div v-else class="rt-card rt-listpad">
        <div v-for="r in records" :key="r.id" class="rt-li">
          <span class="rt-li-ic" :class="'rt-li-ic-' + r.type">
            <van-icon :name="ICONS[r.type] || 'passed'" />
          </span>
          <div class="rt-li-2">
            <div class="rt-li-2-t">{{ r.text }}</div>
            <div class="rt-meta">{{ fmtTime(r.created_at) }}</div>
          </div>
        </div>
        <div v-if="!records.length" class="rt-li">
          <span class="rt-meta">没有记录</span>
        </div>
      </div>
    </template>

    <p v-else class="rt-meta rt-center-tx" style="padding:28px 0">
      还没有封档记录
    </p>
  </template>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { ReplayPlayer } from '@/game/ReplayPlayer'
import type { ReplayResult } from '@/game/ReplayPlayer'

const result = ref<ReplayResult | null>(null)
const fileName = ref<string>('')
const isPlaying = ref(false)
const error = ref<string>('')
const collapsed = ref(false)

async function handleFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  result.value = null
  error.value = ''
  isPlaying.value = true
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data.initialState) {
      throw new Error('JSON 缺少 initialState 字段（请用游戏内"导出 Replay 包"按钮生成）')
    }
    const player = new ReplayPlayer({
      initialState: data.initialState,
      inputs: data.inputs ?? [],
      expectedEvents: data.expectedEvents ?? [],
    })
    const maxTicks = data.maxTicks ?? 600_000
    result.value = player.run(maxTicks)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    isPlaying.value = false
  }
}
</script>

<template>
  <div class="replay-panel" :class="{ collapsed }">
    <div class="header" @click="collapsed = !collapsed">
      <span class="title">⤿ Replay</span>
      <span class="caret">{{ collapsed ? '▸' : '▾' }}</span>
    </div>
    <div v-show="!collapsed" class="body">
      <label class="file-input">
        <input type="file" accept=".json" @change="handleFile" />
        <span>选择导出的 replay JSON…</span>
      </label>
      <div v-if="fileName" class="file-name">{{ fileName }}</div>
      <div v-if="isPlaying" class="status">回放中…</div>
      <div v-else-if="error" class="status err">❌ {{ error }}</div>
      <div v-else-if="result">
        <p v-if="result.divergedAt === null" class="status ok">
          ✅ 全部期望事件匹配（最终 tick={{ result.finalTick }}，{{ result.events.length }} 事件）
        </p>
        <p v-else class="status err">
          ❌ 第一处分叉于 tick={{ result.divergedAt }}（已记录 {{ result.events.length }} 事件）
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.replay-panel {
  position: fixed;
  bottom: 12px;
  right: 12px;
  background: rgba(10, 10, 10, 0.92);
  color: #ddd;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font: 11px var(--mono, monospace);
  width: 320px;
  z-index: 9999;
  user-select: none;
}
.header {
  padding: 6px 10px;
  display: flex;
  justify-content: space-between;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.title {
  letter-spacing: 0.08em;
  color: var(--accent, #f15b5b);
}
.body {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.file-input {
  display: block;
  cursor: pointer;
}
.file-input input {
  display: none;
}
.file-input span {
  display: block;
  padding: 6px 10px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  text-align: center;
  color: #aaa;
}
.file-input:hover span {
  border-color: var(--accent, #f15b5b);
  color: var(--accent, #f15b5b);
}
.file-name {
  color: #888;
  font-size: 10px;
  word-break: break-all;
}
.status {
  font-size: 11px;
  line-height: 1.4;
}
.status.ok {
  color: #5af087;
}
.status.err {
  color: #f15b5b;
}
</style>

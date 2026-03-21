# 时刻表弹窗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个全屏时刻表弹窗，显示列车时刻表、游戏时间、倍速控制和自定义内容（调度日志/晚点扩散警告）。

**Architecture:** 弹窗为纯展示组件（ScheduleModal.vue），所有数据在 App.vue 中预计算后通过 Props 传入。调度日志通过组合式函数 useDispatchLog 管理，在 App.vue 中采集事件。倍速系统统一为 [0,1,2,5,10]，废弃 isPaused。

**Tech Stack:** Vue 3.5 + TypeScript 5.9 + Vitest 4 + @fontsource/exo-2

**设计文档:** `docs/superpowers/specs/2026-03-21-schedule-modal-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/types.ts` | 修改 | 新增 DispatchLogEntry、DispatchEventType 类型 |
| `src/core/constants.ts` | 修改 | 新增 SCHEDULE_VISIBLE_WINDOW、SPEED_OPTIONS、DISPATCH_EVENT_LABELS、SPREAD_THRESHOLD（从 ScheduleManager 导出） |
| `src/core/ScheduleManager.ts` | 修改 | 导出 SPREAD_THRESHOLD 常量 |
| `src/composables/useDispatchLog.ts` | 新建 | 调度日志数据管理 |
| `src/components/ScheduleModal.vue` | 新建 | 弹窗主组件 |
| `src/App.vue` | 修改 | 集成弹窗、废弃 isPaused、事件采集、预计算 Props、分页状态持久化 |
| `src/components/panels/RightPanel.vue` | 修改 | 倍速按钮扩展为 [0,1,2,5,10] |
| `src/__tests__/useDispatchLog.spec.ts` | 新建 | 调度日志单元测试 |

---

### Task 1: 新增类型定义和常量

**Files:**
- Modify: `src/core/types.ts` — 在 `DelaySpread` 接口之后追加
- Modify: `src/core/constants.ts` — 在文件末尾追加
- Modify: `src/core/ScheduleManager.ts` — 将 `SPREAD_THRESHOLD` 改为从 constants 导入

- [ ] **Step 1: 在 types.ts 末尾新增调度日志类型**

在 `src/core/types.ts` 文件末尾（`DelaySpread` 接口 `}` 之后）追加：

```typescript
// --- 调度日志 ---

export type DispatchEventType = 'admit' | 'depart' | 'stop' | 'platform_stop' | 'handover'

export interface DispatchLogEntry {
  tick: number
  gameTime: string
  trainId: string
  event: DispatchEventType
}
```

- [ ] **Step 2: 在 constants.ts 末尾新增常量**

在 `src/core/constants.ts` 文件末尾追加：

```typescript
// 弹窗
export const SCHEDULE_VISIBLE_WINDOW = 30 * TICKS_PER_MINUTE // 时刻表显示未来30分钟
export const SPEED_OPTIONS = [0, 1, 2, 5, 10] as const
export const DISPATCH_LOG_MAX = 200
export const SPREAD_THRESHOLD = 1800 // 30秒，晚点扩散判定阈值

export const DISPATCH_EVENT_LABELS: Record<string, string> = {
  admit: '接入',
  depart: '发车',
  stop: '停车',
  platform_stop: '进站停靠',
  handover: '移交完成',
}
```

- [ ] **Step 3: 修改 ScheduleManager.ts 使用共享常量**

在 `src/core/ScheduleManager.ts` 中，找到 `const SPREAD_THRESHOLD = 1800`（位于文件顶部常量区），替换为：

```typescript
import { TICKS_PER_MINUTE, DWELL_TIME_MIN, DWELL_TIME_MAX, SPREAD_THRESHOLD } from './constants'
```

删除 ScheduleManager.ts 中本地的 `const SPREAD_THRESHOLD = 1800` 行。

- [ ] **Step 4: 运行类型检查和测试**

Run: `npx vue-tsc --noEmit && npx vitest run`
Expected: 全部通过

- [ ] **Step 5: 格式化和提交**

```bash
npx prettier --write src/core/types.ts src/core/constants.ts src/core/ScheduleManager.ts
git add src/core/types.ts src/core/constants.ts src/core/ScheduleManager.ts
git commit -m "feat: 新增调度日志类型定义和弹窗相关常量，统一 SPREAD_THRESHOLD"
```

---

### Task 2: 实现调度日志组合式函数

**Files:**
- Create: `src/composables/useDispatchLog.ts`
- Create: `src/__tests__/useDispatchLog.spec.ts`

- [ ] **Step 1: 编写测试**

创建 `src/__tests__/useDispatchLog.spec.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { useDispatchLog } from '../composables/useDispatchLog'

describe('useDispatchLog', () => {
  it('addLog 添加日志条目并按降序排列', () => {
    const { logs, addLog } = useDispatchLog()
    addLog({ tick: 100, gameTime: '08:00:01', trainId: 'G1', event: 'admit' })
    addLog({ tick: 200, gameTime: '08:00:03', trainId: 'G2', event: 'depart' })

    expect(logs.value).toHaveLength(2)
    expect(logs.value[0]!.trainId).toBe('G2')
    expect(logs.value[1]!.trainId).toBe('G1')
  })

  it('超过上限时移除最旧的条目', () => {
    const { logs, addLog } = useDispatchLog()
    for (let i = 0; i < 205; i++) {
      addLog({ tick: i, gameTime: `${i}`, trainId: `G${i}`, event: 'admit' })
    }
    expect(logs.value).toHaveLength(200)
    expect(logs.value[0]!.trainId).toBe('G204')
    expect(logs.value[199]!.trainId).toBe('G5')
  })

  it('clearLogs 清空所有日志', () => {
    const { logs, addLog, clearLogs } = useDispatchLog()
    addLog({ tick: 1, gameTime: '08:00:00', trainId: 'G1', event: 'stop' })
    clearLogs()
    expect(logs.value).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/__tests__/useDispatchLog.spec.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 useDispatchLog**

创建 `src/composables/useDispatchLog.ts`：

```typescript
import { ref } from 'vue'
import type { DispatchLogEntry } from '../core/types'
import { DISPATCH_LOG_MAX } from '../core/constants'

export function useDispatchLog() {
  const logs = ref<DispatchLogEntry[]>([])

  function addLog(entry: DispatchLogEntry): void {
    logs.value.unshift(entry)
    if (logs.value.length > DISPATCH_LOG_MAX) {
      logs.value.length = DISPATCH_LOG_MAX
    }
  }

  function clearLogs(): void {
    logs.value = []
  }

  return { logs, addLog, clearLogs }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/__tests__/useDispatchLog.spec.ts`
Expected: 3 tests PASS

- [ ] **Step 5: 格式化和提交**

```bash
npx prettier --write src/composables/useDispatchLog.ts src/__tests__/useDispatchLog.spec.ts
git add src/composables/useDispatchLog.ts src/__tests__/useDispatchLog.spec.ts
git commit -m "feat: 实现调度日志组合式函数 useDispatchLog"
```

---

### Task 3: 统一倍速系统（废弃 isPaused）

**Files:**
- Modify: `src/App.vue` — gameSpeed、isPaused、loop、setGameSpeed、togglePause、SPEED_KEY_MAP 使用处、goHome
- Modify: `src/components/panels/RightPanel.vue` — 倍速按钮数组

- [ ] **Step 1: 修改 App.vue — 废弃 isPaused，新增 lastNonZeroSpeed**

在 `src/App.vue` 中：

1. 找到 `const gameSpeed = ref(1)`，在其后追加：
```typescript
const lastNonZeroSpeed = ref(1) // 用于 Shift+Space 恢复上次速度
```

2. 删除 `const isPaused = ref(false)` 行

- [ ] **Step 2: 修改主循环 — 用 gameSpeed===0 替代 isPaused**

在 `loop` 函数中，找到 `if (isPaused.value) {` 块，替换为：

```typescript
  if (gameSpeed.value === 0) {
    animationFrameId = requestAnimationFrame(loop)
    return
  }
```

- [ ] **Step 3: 修改 setGameSpeed 函数**

找到 `function setGameSpeed(s: number)` 函数，替换为：

```typescript
function setGameSpeed(s: number) {
  if (s !== 0) lastNonZeroSpeed.value = s
  gameSpeed.value = s
}
```

- [ ] **Step 4: 修改 togglePause 函数**

找到 `function togglePause()` 函数，替换为：

```typescript
function togglePause() {
  if (gameSpeed.value === 0) {
    gameSpeed.value = lastNonZeroSpeed.value
    showToast('游戏继续')
  } else {
    lastNonZeroSpeed.value = gameSpeed.value
    gameSpeed.value = 0
    showToast('游戏已暂停')
  }
}
```

- [ ] **Step 5: 修改键盘倍速处理 — 统一走 setGameSpeed**

在 `handleKeyPress` 函数中，找到 Shift+number 倍速处理块：

```typescript
  if (shift) {
    const speed = SPEED_KEY_MAP[event.code]
    if (speed !== undefined) {
      event.preventDefault()
      gameSpeed.value = speed
      showToast(`倍速: ${speed}x`)
      return
    }
  }
```

将 `gameSpeed.value = speed` 替换为 `setGameSpeed(speed)`：

```typescript
  if (shift) {
    const speed = SPEED_KEY_MAP[event.code]
    if (speed !== undefined) {
      event.preventDefault()
      setGameSpeed(speed)
      showToast(`倍速: ${speed}x`)
      return
    }
  }
```

- [ ] **Step 6: 修改 goHome 函数 — 重置倍速**

在 `goHome()` 函数末尾（`scheduleManager.value = null` 之后）追加：

```typescript
  gameSpeed.value = 1
  lastNonZeroSpeed.value = 1
```

- [ ] **Step 7: 修改 RightPanel.vue 倍速按钮**

在 `src/components/panels/RightPanel.vue` 中，找到 `v-for="s in [1, 2, 5, 10]"`，替换为：

```html
       <div class="btn-grid row">
         <button
            v-for="s in [0, 1, 2, 5, 10]"
            :key="s"
            class="btn speed-btn"
            :class="{ active: gameSpeed === s }"
            @click="onSpeedChange(s)"
         >
           {{ s === 0 ? '||' : s + 'x' }}
         </button>
       </div>
```

- [ ] **Step 8: 运行类型检查和全部测试**

Run: `npx vue-tsc --noEmit && npx vitest run`
Expected: 全部 PASS（如果有引用 `isPaused` 的残余编译错误，按提示清理）

- [ ] **Step 9: 格式化和提交**

```bash
npx prettier --write src/App.vue src/components/panels/RightPanel.vue
npm run lint
git add src/App.vue src/components/panels/RightPanel.vue
git commit -m "refactor: 统一倍速系统，废弃 isPaused，新增 0x 暂停档位"
```

---

### Task 4: 安装字体依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 @fontsource/exo-2**

Run: `npm install @fontsource/exo-2`
Expected: 安装成功

- [ ] **Step 2: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 @fontsource/exo-2 字体包"
```

---

### Task 5: 实现弹窗组件 — ScheduleModal.vue

**Files:**
- Create: `src/components/ScheduleModal.vue`

注意：弹窗的 `currentPage`（分页状态）通过 prop `modalPage` + emit `update:modalPage` 管理，使其在弹窗关闭/重开后持久化（因为 `v-if` 会销毁组件内部状态）。

- [ ] **Step 1: 创建弹窗 script 部分**

创建 `src/components/ScheduleModal.vue`，先写 `<script setup>` 部分：

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import '@fontsource/exo-2/800-italic.css'
import type { ScheduleEntry, DelaySpread, DispatchLogEntry } from '../core/types'
import { SPEED_OPTIONS, SPREAD_THRESHOLD, DISPATCH_EVENT_LABELS } from '../core/constants'
import { TICKS_PER_SECOND } from '../core/constants'
import { tickToTime } from '../core/utils'

const props = defineProps<{
  visible: boolean
  gameTime: string
  gameSpeed: number
  currentTick: number
  gameStartTime: { hours: number; minutes: number; seconds: number }
  dispatchLogs: DispatchLogEntry[]
  scheduleEntries: ScheduleEntry[]
  delaySpreadMap: Record<string, DelaySpread>
  trainStatusMap: Record<string, string>
  modalPage: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'speed-change', speed: number): void
  (e: 'update:modalPage', page: number): void
}>()

// --- 鼠标 hover 状态 ---
const isMouseOutside = ref(false)

function onContainerEnter() {
  isMouseOutside.value = false
}
function onContainerLeave() {
  isMouseOutside.value = true
}
function onOverlayClick(event: MouseEvent) {
  if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
    emit('close')
  }
}

// --- 倍速控制 ---
const speedOptions = [...SPEED_OPTIONS]

function speedUp() {
  const idx = speedOptions.indexOf(props.gameSpeed)
  if (idx < speedOptions.length - 1) {
    emit('speed-change', speedOptions[idx + 1]!)
  }
}
function speedDown() {
  const idx = speedOptions.indexOf(props.gameSpeed)
  if (idx > 0) {
    emit('speed-change', speedOptions[idx - 1]!)
  }
}

const canSpeedUp = computed(() => props.gameSpeed < speedOptions[speedOptions.length - 1]!)
const canSpeedDown = computed(() => props.gameSpeed > speedOptions[0]!)
const speedLabel = computed(() => props.gameSpeed === 0 ? '||' : `${props.gameSpeed}x`)

// --- 时刻表分页 ---
const ROW_HEIGHT = 35
const HEADER_HEIGHT = 40
const tableWrapperRef = ref<HTMLElement | null>(null)
const tableHeight = ref(500)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (tableWrapperRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        tableHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(tableWrapperRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

const rowsPerPage = computed(() => Math.max(1, Math.floor((tableHeight.value - HEADER_HEIGHT) / ROW_HEIGHT)))
const totalPages = computed(() => Math.max(1, Math.ceil(props.scheduleEntries.length / rowsPerPage.value)))

// 使用 prop 的 modalPage，自动回退到有效范围
const safePage = computed(() => Math.min(props.modalPage, totalPages.value - 1))

const pagedEntries = computed(() => {
  const start = safePage.value * rowsPerPage.value
  return props.scheduleEntries.slice(start, start + rowsPerPage.value)
})

function prevPage() {
  if (safePage.value > 0) emit('update:modalPage', safePage.value - 1)
}
function nextPage() {
  if (safePage.value < totalPages.value - 1) emit('update:modalPage', safePage.value + 1)
}

// --- 时间格式化辅助 ---
function formatTickTime(tick: number): string {
  return tickToTime(tick, props.gameStartTime)
}

function formatStopDuration(ticks: number): string {
  const totalSeconds = Math.floor(ticks / TICKS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}'${String(seconds).padStart(2, '0')}`
}

function getEntryArriveTime(entry: ScheduleEntry): string {
  const effectiveTick = entry.scheduledArriveTick + entry.currentDelay
  // upcoming 和 waiting 都是尚未到达站台，显示"预计："
  const prefix = entry.status !== 'admitted' ? '预计：' : ''
  return prefix + formatTickTime(effectiveTick)
}

function getEntryDepartTime(entry: ScheduleEntry): string {
  const effectiveTick = entry.scheduledDepartTick + entry.currentDelay
  const prefix = (entry.status === 'upcoming' || entry.status === 'waiting') ? '预计：' : ''
  return prefix + formatTickTime(effectiveTick)
}

// 预计算准点情况（避免模板中重复调用）
interface PunctualityDisplay {
  text: string
  color: string
  spread: string
  spreadColor: string
}

const punctualityMap = computed<Record<string, PunctualityDisplay>>(() => {
  const map: Record<string, PunctualityDisplay> = {}
  for (const entry of props.scheduleEntries) {
    const delayMinutes = Math.round(entry.currentDelay / (TICKS_PER_SECOND * 60))
    let text: string
    let color: string

    if (delayMinutes <= -1) {
      text = `早点：${Math.abs(delayMinutes)}'`
      color = '#2ecc71'
    } else if (delayMinutes >= 1) {
      text = `晚点：${delayMinutes}'`
      color = '#e74c3c'
    } else {
      text = '准点'
      color = '#f1c40f'
    }

    let spread = ''
    let spreadColor = ''
    const ds = props.delaySpreadMap[entry.id]
    if (ds && (entry.status === 'waiting' || entry.status === 'admitted')) {
      if (ds.level === 'worsened') {
        const deltaMin = Math.ceil(Math.abs(ds.delta) / (TICKS_PER_SECOND * 60))
        spread = `▼+${deltaMin}'`
        spreadColor = '#e74c3c'
      } else if (ds.level === 'improved') {
        const deltaMin = Math.ceil(Math.abs(ds.delta) / (TICKS_PER_SECOND * 60))
        spread = `▲-${deltaMin}'`
        spreadColor = '#2ecc71'
      }
    }

    map[entry.id] = { text, color, spread, spreadColor }
  }
  return map
})

// --- 自定义窗口标签页 ---
const TAB_NAMES = ['调度日志', '晚点扩散警告'] as const
const activeTabIndex = ref(0)
const activeTabName = computed(() => TAB_NAMES[activeTabIndex.value]!)

function prevTab() {
  activeTabIndex.value = (activeTabIndex.value - 1 + TAB_NAMES.length) % TAB_NAMES.length
}
function nextTab() {
  activeTabIndex.value = (activeTabIndex.value + 1) % TAB_NAMES.length
}

// --- 晚点扩散警告数据 ---
const worsenedEntries = computed(() => {
  return props.scheduleEntries
    .filter(e => {
      const ds = props.delaySpreadMap[e.id]
      return ds && ds.level === 'worsened' && (e.status === 'waiting' || e.status === 'admitted')
    })
    .map(e => ({
      id: e.id,
      status: props.trainStatusMap[e.id] ?? '',
      delay: e.currentDelay,
      spread: props.delaySpreadMap[e.id]!,
    }))
})

const imminentEntries = computed(() => {
  return props.scheduleEntries
    .filter(e => {
      const ds = props.delaySpreadMap[e.id]
      return ds && ds.level === 'neutral' && ds.delta > 0 && (e.status === 'waiting' || e.status === 'admitted')
    })
    .map(e => {
      const ds = props.delaySpreadMap[e.id]!
      const remainingTicks = SPREAD_THRESHOLD - ds.delta
      const remainingSeconds = Math.max(0, Math.round(remainingTicks / TICKS_PER_SECOND))
      return {
        id: e.id,
        status: props.trainStatusMap[e.id] ?? '',
        remainingSeconds,
      }
    })
})

function formatDelayText(delayTicks: number): string {
  const minutes = Math.round(Math.abs(delayTicks) / (TICKS_PER_SECOND * 60))
  if (delayTicks < -TICKS_PER_SECOND * 60) return `早点 ${minutes}'`
  if (delayTicks > TICKS_PER_SECOND * 60) return `晚点 ${minutes}'`
  return '准点'
}

function delayColor(delayTicks: number): string {
  if (delayTicks < -TICKS_PER_SECOND * 60) return '#2ecc71'
  if (delayTicks > TICKS_PER_SECOND * 60) return '#e74c3c'
  return '#f1c40f'
}
</script>
```

- [ ] **Step 2: 添加 template 部分**

在同一文件中追加 `<template>` 部分：

```html
<template>
  <Transition name="modal">
    <div
      v-if="visible"
      class="modal-overlay"
      @click="onOverlayClick"
    >
      <div
        class="modal-container"
        :class="{ 'hover-outside': isMouseOutside }"
        @mouseenter="onContainerEnter"
        @mouseleave="onContainerLeave"
      >
        <!-- 关闭按钮 -->
        <button
          v-show="isMouseOutside"
          class="close-btn"
          @click="emit('close')"
        >
          &times;
        </button>

        <div class="main-area">
          <!-- 左侧：时刻表 -->
          <div class="schedule-section">
            <h2 class="modal-title">时刻表</h2>
            <div class="table-container">
              <div ref="tableWrapperRef" class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>车次</th>
                      <th>方向</th>
                      <th>进站时间</th>
                      <th>停站时间</th>
                      <th>出站时间</th>
                      <th>准点情况</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in pagedEntries" :key="entry.id">
                      <td>{{ entry.id }}</td>
                      <td>{{ entry.direction === 'up' ? '上行' : '下行' }}</td>
                      <td>{{ getEntryArriveTime(entry) }}</td>
                      <td>{{ formatStopDuration(entry.scheduledStopDuration) }}</td>
                      <td>{{ getEntryDepartTime(entry) }}</td>
                      <td>
                        <span :style="{ color: punctualityMap[entry.id]?.color }">
                          {{ punctualityMap[entry.id]?.text }}
                        </span>
                        <span
                          v-if="punctualityMap[entry.id]?.spread"
                          :style="{ color: punctualityMap[entry.id]?.spreadColor }"
                          class="spread-indicator"
                        >
                          {{ punctualityMap[entry.id]?.spread }}
                        </span>
                      </td>
                    </tr>
                    <tr v-if="pagedEntries.length === 0">
                      <td colspan="6" class="empty-row">暂无列车数据</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="pagination">
                <span class="page-arrow" :class="{ disabled: safePage <= 0 }" @click="prevPage">&larr;</span>
                <span class="page-info">{{ safePage + 1 }}/{{ totalPages }}</span>
                <span class="page-arrow" :class="{ disabled: safePage >= totalPages - 1 }" @click="nextPage">&rarr;</span>
              </div>
            </div>
          </div>

          <!-- 右侧面板 -->
          <div class="side-panel">
            <div class="game-time-box">
              <div class="time-display">{{ gameTime }}</div>
            </div>

            <div class="speed-control">
              <span class="speed-arrow" :class="{ disabled: !canSpeedDown }" @click="speedDown">&larr;</span>
              <span class="speed-label">{{ speedLabel }}</span>
              <span class="speed-arrow" :class="{ disabled: !canSpeedUp }" @click="speedUp">&rarr;</span>
            </div>

            <div class="custom-window">
              <h3 class="custom-title">{{ activeTabName }}</h3>

              <!-- 调度日志 -->
              <div v-if="activeTabIndex === 0" class="tab-content log-list">
                <div v-for="(log, i) in dispatchLogs" :key="i" class="log-entry">
                  <span class="log-time">{{ log.gameTime }}</span>
                  <span class="log-train">{{ log.trainId }}</span>
                  <span class="log-event">{{ DISPATCH_EVENT_LABELS[log.event] }}</span>
                </div>
                <div v-if="dispatchLogs.length === 0" class="empty-tab">暂无日志</div>
              </div>

              <!-- 晚点扩散警告 -->
              <div v-if="activeTabIndex === 1" class="tab-content warning-list">
                <div v-if="worsenedEntries.length > 0" class="warning-group">
                  <div class="warning-header worsened">⚠ 晚点已加剧</div>
                  <div v-for="item in worsenedEntries" :key="item.id" class="warning-item">
                    <span>{{ item.id }}({{ item.status }})</span>
                    <span :style="{ color: delayColor(item.delay) }">{{ formatDelayText(item.delay) }}</span>
                    <span class="spread-value">▼ <span style="color: #e74c3c">+{{ Math.ceil(Math.abs(item.spread.delta) / (TICKS_PER_SECOND * 60)) }}'</span></span>
                  </div>
                </div>

                <div v-if="imminentEntries.length > 0" class="warning-group">
                  <div class="warning-header imminent">⚠ 晚点即将加剧</div>
                  <div v-for="item in imminentEntries" :key="item.id" class="warning-item">
                    <span>{{ item.id }}({{ item.status }})</span>
                    <span class="remaining-label">剩余时间：</span>
                    <span class="remaining-value">{{ item.remainingSeconds }}s</span>
                  </div>
                </div>

                <div v-if="worsenedEntries.length === 0 && imminentEntries.length === 0" class="empty-tab">
                  暂无晚点扩散警告
                </div>
              </div>

              <div class="tab-switcher">
                <span class="tab-arrow" @click="prevTab">&larr;</span>
                <span class="tab-name">{{ activeTabName }}</span>
                <span class="tab-arrow" @click="nextTab">&rarr;</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
```

- [ ] **Step 3: 添加 style 部分**

在同一文件中追加 `<style scoped>` 部分：

```css
<style scoped>
.modal-container,
.modal-container * {
  font-family: 'Exo 2', 'Inter', 'Consolas', sans-serif;
  font-weight: 800;
  font-style: italic;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
}

.modal-container {
  position: relative;
  width: 75vw;
  max-width: 1935px;
  height: 78vh;
  max-height: 1125px;
  background: linear-gradient(135deg, #2A2A4A 0%, #6B6BAA 100%);
  border-radius: 6vw;
  padding: 3vh 2.5vw;
  display: flex;
  flex-direction: column;
  transition: border-top-right-radius 0.2s ease;
}

.modal-container.hover-outside {
  border-top-right-radius: 1.2vw;
}

.close-btn {
  position: absolute;
  top: -0.5vw;
  right: -0.5vw;
  width: 2vw;
  height: 2vw;
  min-width: 30px;
  min-height: 30px;
  border-radius: 50%;
  background: #FF3333;
  color: white;
  border: none;
  font-size: 1.5vw;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  line-height: 1;
}
.close-btn:hover { background: #cc0000; }

.main-area {
  display: flex;
  gap: 2vw;
  flex: 1;
  min-height: 0;
}

.schedule-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #E0DAD9;
  border-radius: 3.1vw;
  padding: 2vh 2vw;
  min-width: 0;
}

.modal-title {
  text-align: center;
  font-size: clamp(20px, 1.4vw, 36px);
  color: #000;
  margin: 0 0 1.5vh 0;
}

.table-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-wrapper {
  flex: 1;
  border: 3.5px solid #4A6FA5;
  border-radius: 2vw;
  overflow: hidden;
  min-height: 0;
}

table { width: 100%; border-collapse: collapse; table-layout: fixed; }

thead tr { background: linear-gradient(90deg, #3c3952, #86829f); }

th {
  color: #E0DAD9;
  font-size: clamp(10px, 0.65vw, 16px);
  padding: 0.6vh 0.5vw;
  text-align: left;
  white-space: nowrap;
}

td {
  color: #000;
  font-size: clamp(10px, 0.65vw, 16px);
  padding: 0.4vh 0.5vw;
  border-bottom: 1px solid rgba(0,0,0,0.08);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-row { text-align: center; color: #999; padding: 2vh 0; }

.spread-indicator { margin-left: 0.3vw; font-size: clamp(9px, 0.55vw, 14px); }

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5vw;
  padding: 0.8vh 0;
  background: linear-gradient(90deg, #3c3952, #86829f);
  border-radius: 100px;
  margin-top: 0.8vh;
}

.page-arrow {
  color: #E0DAD9;
  font-size: clamp(12px, 0.65vw, 16px);
  cursor: pointer;
  user-select: none;
}
.page-arrow.disabled { opacity: 0.3; pointer-events: none; }

.page-info { color: #E0DAD9; font-size: clamp(10px, 0.65vw, 16px); }

.side-panel {
  width: 18%;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 1.5vh;
}

.game-time-box {
  background: #E0DAD9;
  border-radius: 3.1vw;
  padding: 2vh 1vw;
  text-align: center;
}

.time-display { font-size: clamp(20px, 1.5vw, 38px); color: #000; }

.speed-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1vw;
}

.speed-arrow {
  color: #E0DAD9;
  font-size: clamp(20px, 1.4vw, 36px);
  cursor: pointer;
  user-select: none;
}
.speed-arrow.disabled { opacity: 0.3; pointer-events: none; }

.speed-label { color: #E0DAD9; font-size: clamp(16px, 1vw, 26px); }

.custom-window {
  flex: 1;
  background: #E0DAD9;
  border-radius: 3.1vw;
  padding: 1.5vh 1.2vw;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.custom-title {
  text-align: center;
  font-size: clamp(14px, 0.95vw, 24px);
  color: #000;
  margin: 0 0 1vh 0;
}

.tab-content { flex: 1; overflow-y: auto; min-height: 0; }

.log-entry {
  display: flex;
  gap: 0.5vw;
  font-size: clamp(9px, 0.55vw, 14px);
  color: #000;
  padding: 0.3vh 0;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.log-time { min-width: 4.5em; }
.log-train { min-width: 3.5em; }

.warning-group { margin-bottom: 1vh; }

.warning-header { font-size: clamp(9px, 0.52vw, 13px); margin-bottom: 0.4vh; }
.warning-header.worsened { color: #db2020; }
.warning-header.imminent { color: #c0a000; }

.warning-item {
  display: flex;
  gap: 0.4vw;
  font-size: clamp(9px, 0.55vw, 14px);
  color: #000;
  padding: 0.2vh 0;
  flex-wrap: wrap;
}

.spread-value { color: #e74c3c; }
.remaining-value { color: #c0a000; font-weight: 800; }

.empty-tab { text-align: center; color: #999; padding: 2vh 0; font-size: clamp(10px, 0.6vw, 14px); }

.tab-switcher {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8vw;
  padding-top: 0.5vh;
  border-top: 1px solid rgba(0,0,0,0.1);
  margin-top: auto;
}

.tab-arrow { cursor: pointer; font-size: clamp(12px, 0.65vw, 16px); color: #000; user-select: none; }
.tab-name { font-size: clamp(10px, 0.65vw, 16px); color: #000; }

.modal-enter-active { transition: all 1.5s ease-out; }
.modal-leave-active { transition: all 1.5s ease-in; }
.modal-enter-from { transform: translateY(100vh) scale(0.3); opacity: 0; }
.modal-leave-to { transform: translateY(100vh) scale(0.3); opacity: 0; }
</style>
```

- [ ] **Step 4: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 格式化和提交**

```bash
npx prettier --write src/components/ScheduleModal.vue
git add src/components/ScheduleModal.vue
git commit -m "feat: 实现时刻表弹窗组件 ScheduleModal"
```

---

### Task 6: 集成弹窗到 App.vue

**Files:**
- Modify: `src/App.vue`

所有修改基于 Task 3 完成后的 App.vue 状态（已废弃 isPaused）。使用函数名/上下文锚点定位，不使用绝对行号。

- [ ] **Step 1: 新增 import 和状态**

在 `src/App.vue` 的 import 区域追加：

```typescript
import ScheduleModal from './components/ScheduleModal.vue'
import { useDispatchLog } from './composables/useDispatchLog'
import type { DispatchLogEntry, DelaySpread } from './core/types'
import { SCHEDULE_VISIBLE_WINDOW } from './core/constants'
```

在 state 区域（`const scheduleManager` 附近）追加：

```typescript
// 时刻表弹窗
const showScheduleModal = ref(false)
const modalPage = ref(0)

// 调度日志
const { logs: dispatchLogs, addLog, clearLogs } = useDispatchLog()

// 进站停靠检测
const platformStopRecorded = new Set<string>()
```

- [ ] **Step 2: 新增弹窗用 computed 属性**

在现有 computed 区域（`gameTime` 之后）追加：

```typescript
// 弹窗时刻表数据
const modalScheduleEntries = computed<ScheduleEntry[]>(() => {
  void tick.value
  if (!scheduleManager.value) return []
  return scheduleManager.value.getAllEntries()
    .filter(e =>
      e.status === 'waiting' ||
      e.status === 'admitted' ||
      (e.status === 'upcoming' &&
       e.scheduledArriveTick + e.currentDelay <= tick.value + SCHEDULE_VISIBLE_WINDOW)
    )
    .sort((a, b) =>
      (a.scheduledArriveTick + a.currentDelay) - (b.scheduledArriveTick + b.currentDelay)
    )
})

const modalDelaySpreadMap = computed<Record<string, DelaySpread>>(() => {
  void tick.value
  const result: Record<string, DelaySpread> = {}
  if (!scheduleManager.value) return result
  for (const entry of modalScheduleEntries.value) {
    if (entry.status === 'waiting' || entry.status === 'admitted') {
      result[entry.id] = scheduleManager.value.computeDelaySpread(entry, tick.value)
    }
  }
  return result
})

const modalTrainStatusMap = computed<Record<string, string>>(() => {
  const result: Record<string, string> = {}
  for (const entry of modalScheduleEntries.value) {
    if (entry.status === 'waiting') {
      result[entry.id] = '等待区'
    } else if (entry.status === 'admitted') {
      const train = trains.find(t => t.scheduleEntryId === entry.id)
      if (!train) { result[entry.id] = '在站'; continue }
      const edgeId = train.currentEdgeId
      if (edgeId.includes('entry') || edgeId.includes('_in')) result[entry.id] = '进站'
      else if (edgeId.includes('out') || edgeId.includes('exit')) result[entry.id] = '正在出站'
      else result[entry.id] = '停站'
    }
  }
  return result
})
```

- [ ] **Step 3: 修改 spawnTrainIntoMap 返回是否成功**

找到 `function spawnTrainIntoMap(id: string)` 函数：

1. 将函数签名改为 `function spawnTrainIntoMap(id: string): boolean`
2. 将所有提前 `return` 改为 `return false`
3. 在函数末尾（`scheduleManager.value.markAdmitted(entry.id)` 之后）追加 `return true`

- [ ] **Step 4: 修改 handleAction 记录调度日志（仅成功时）**

找到 `function handleAction(action: TrainAction)` 函数，替换为：

```typescript
function handleAction(action: TrainAction) {
  if (!selectedTrainId.value) return

  switch (action) {
    case 'ADMIT': {
      const success = spawnTrainIntoMap(selectedTrainId.value)
      if (success) {
        addLog({ tick: tick.value, gameTime: gameTime.value, trainId: selectedTrainId.value, event: 'admit' })
      }
      break
    }

    case 'DEPART': {
      const train = trains.find(t => t.id === selectedTrainId.value)
      if (train) {
        handleDepartAction(train)
        addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'depart' })
      }
      break
    }

    case 'STOP': {
      const train = trains.find(t => t.id === selectedTrainId.value)
      if (train) {
        train.speed = 0
        train.state = 'stopped'
        addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'stop' })
      }
      break
    }
  }
}
```

- [ ] **Step 5: 在主循环中检测进站停靠事件**

在 `loop` 函数的 `while` 循环中，找到 `processExitingTrains()` 调用，在它**之前**追加：

```typescript
      // 检测进站停靠
      for (const train of trains) {
        if (train.passengerState === 'BOARDING' && !platformStopRecorded.has(train.id)) {
          platformStopRecorded.add(train.id)
          addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'platform_stop' })
        }
      }
```

- [ ] **Step 6: 在 processExitingTrains 中记录移交事件**

找到 `processExitingTrains` 函数中 `train.isHandedOver = true` 的位置，在该行**之前**追加：

```typescript
      addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'handover' })
```

- [ ] **Step 7: 修改 goHome 和 handleStationSelect 清理状态**

在 `goHome()` 函数末尾（`scheduleManager.value = null` 之后）追加：

```typescript
  showScheduleModal.value = false
  modalPage.value = 0
  platformStopRecorded.clear()
  clearLogs()
```

在 `handleStationSelect()` 函数中（`scheduleManager.value = new ScheduleManager(...)` 之后）追加：

```typescript
  platformStopRecorded.clear()
  clearLogs()
  modalPage.value = 0
```

- [ ] **Step 8: 在模板中添加弹窗触发按钮和弹窗组件**

在 `.map-header` 中（`back-btn` div 之后）追加：

```html
        <div class="schedule-btn" @click="showScheduleModal = true">时刻表</div>
```

在 `</div>` （app-layout 关闭标签）之前追加：

```html
    <ScheduleModal
      :visible="showScheduleModal"
      :gameTime="gameTime"
      :gameSpeed="gameSpeed"
      :currentTick="tick"
      :gameStartTime="gameStartTime"
      :dispatchLogs="dispatchLogs"
      :scheduleEntries="modalScheduleEntries"
      :delaySpreadMap="modalDelaySpreadMap"
      :trainStatusMap="modalTrainStatusMap"
      :modalPage="modalPage"
      @close="showScheduleModal = false"
      @speed-change="setGameSpeed"
      @update:modalPage="modalPage = $event"
    />
```

- [ ] **Step 9: 添加触发按钮样式**

在 `<style scoped>` 中追加：

```css
.schedule-btn {
  position: absolute;
  right: 20px;
  color: #777;
  font-size: 12px;
  cursor: pointer;
  letter-spacing: 2px;
  padding: 5px 10px;
  border: 1px solid #333;
  border-radius: 4px;
  transition: all 0.2s;
  z-index: 20;
}
.schedule-btn:hover {
  color: #fff;
  border-color: #555;
  background: #222;
}
```

- [ ] **Step 10: 运行类型检查和全部测试**

Run: `npx vue-tsc --noEmit && npx vitest run`
Expected: 全部通过

- [ ] **Step 11: 格式化和提交**

```bash
npx prettier --write src/App.vue
npm run lint
git add src/App.vue
git commit -m "feat: 集成时刻表弹窗到 App.vue，接入事件采集和预计算数据"
```

---

### Task 7: 手动验证和微调

**Files:**
- Possibly: `src/components/ScheduleModal.vue` (样式微调)
- Possibly: `src/App.vue` (交互微调)

- [ ] **Step 1: 启动开发服务器**

Run: `npm run dev`

- [ ] **Step 2: 手动验证清单**

逐项验证：
1. 游戏界面右上角可见"时刻表"按钮
2. 点击按钮弹窗从下方滑入（1.5s 动画）
3. 弹窗内时刻表显示列车数据，分页正常
4. 关闭再打开弹窗，分页保持上次状态
5. 右侧游戏时间实时更新
6. 倍速切换 ← → 正常（含 0x 暂停）
7. 自定义窗口标签切换（调度日志 ↔ 晚点扩散警告）
8. 鼠标移出弹窗：右上角圆角变化 + × 按钮出现
9. 点击 × 或遮罩层关闭弹窗（1.5s 退出动画）
10. 弹窗打开期间游戏不暂停
11. RightPanel 的 0x 暂停按钮正常
12. Shift+Space 暂停/恢复正常
13. 接入列车后调度日志出现"接入"记录
14. 发车后调度日志出现"发车"记录
15. 停车后调度日志出现"停车"记录
16. 列车到站后自动出现"进站停靠"记录
17. 列车移交后出现"移交完成"记录
18. 日志按时间降序排列（最新在上）
19. 未到站列车时间显示"预计："前缀
20. 管制内列车准点情况显示扩散增量 ▼

- [ ] **Step 3: 修复发现的问题（如有）**

根据手动测试结果进行微调。

- [ ] **Step 4: 最终验证**

Run: `npx vue-tsc --noEmit && npx vitest run && npm run lint`
Expected: 全部 PASS

- [ ] **Step 5: 提交（如有修改）**

```bash
git add -A
git commit -m "fix: 时刻表弹窗手动测试微调"
```

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
const speedLabel = computed(() => (props.gameSpeed === 0 ? '||' : `${props.gameSpeed}x`))

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

const rowsPerPage = computed(() =>
  Math.max(1, Math.floor((tableHeight.value - HEADER_HEIGHT) / ROW_HEIGHT)),
)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.scheduleEntries.length / rowsPerPage.value)),
)

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
  const prefix = entry.status === 'upcoming' || entry.status === 'waiting' ? '预计：' : ''
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
    .filter((e) => {
      const ds = props.delaySpreadMap[e.id]
      return ds && ds.level === 'worsened' && (e.status === 'waiting' || e.status === 'admitted')
    })
    .map((e) => ({
      id: e.id,
      status: props.trainStatusMap[e.id] ?? '',
      delay: e.currentDelay,
      spread: props.delaySpreadMap[e.id]!,
    }))
})

const imminentEntries = computed(() => {
  return props.scheduleEntries
    .filter((e) => {
      const ds = props.delaySpreadMap[e.id]
      return (
        ds &&
        ds.level === 'neutral' &&
        ds.delta > 0 &&
        (e.status === 'waiting' || e.status === 'admitted')
      )
    })
    .map((e) => {
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

<template>
  <Transition name="modal">
    <div v-if="visible" class="modal-overlay" @click="onOverlayClick">
      <div
        class="modal-container"
        :class="{ 'hover-outside': isMouseOutside }"
        @mouseenter="onContainerEnter"
        @mouseleave="onContainerLeave"
      >
        <!-- 关闭按钮 -->
        <button v-show="isMouseOutside" class="close-btn" @click="emit('close')">&times;</button>

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
                <span class="page-arrow" :class="{ disabled: safePage <= 0 }" @click="prevPage"
                  >&larr;</span
                >
                <span class="page-info">{{ safePage + 1 }}/{{ totalPages }}</span>
                <span
                  class="page-arrow"
                  :class="{ disabled: safePage >= totalPages - 1 }"
                  @click="nextPage"
                  >&rarr;</span
                >
              </div>
            </div>
          </div>

          <!-- 右侧面板 -->
          <div class="side-panel">
            <div class="game-time-box">
              <div class="time-display">{{ gameTime }}</div>
            </div>

            <div class="speed-control">
              <span class="speed-arrow" :class="{ disabled: !canSpeedDown }" @click="speedDown"
                >&larr;</span
              >
              <span class="speed-label">{{ speedLabel }}</span>
              <span class="speed-arrow" :class="{ disabled: !canSpeedUp }" @click="speedUp"
                >&rarr;</span
              >
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
                    <span :style="{ color: delayColor(item.delay) }">{{
                      formatDelayText(item.delay)
                    }}</span>
                    <span class="spread-value"
                      >▼
                      <span style="color: #e74c3c"
                        >+{{
                          Math.ceil(Math.abs(item.spread.delta) / (TICKS_PER_SECOND * 60))
                        }}'</span
                      ></span
                    >
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

                <div
                  v-if="worsenedEntries.length === 0 && imminentEntries.length === 0"
                  class="empty-tab"
                >
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
  background: linear-gradient(135deg, #2a2a4a 0%, #6b6baa 100%);
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
  background: #ff3333;
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
.close-btn:hover {
  background: #cc0000;
}

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
  background: #e0dad9;
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
  border: 3.5px solid #4a6fa5;
  border-radius: 2vw;
  overflow: hidden;
  min-height: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

thead tr {
  background: linear-gradient(90deg, #3c3952, #86829f);
}

th {
  color: #e0dad9;
  font-size: clamp(10px, 0.65vw, 16px);
  padding: 0.6vh 0.5vw;
  text-align: left;
  white-space: nowrap;
}

td {
  color: #000;
  font-size: clamp(10px, 0.65vw, 16px);
  padding: 0.4vh 0.5vw;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-row {
  text-align: center;
  color: #999;
  padding: 2vh 0;
}

.spread-indicator {
  margin-left: 0.3vw;
  font-size: clamp(9px, 0.55vw, 14px);
}

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
  color: #e0dad9;
  font-size: clamp(12px, 0.65vw, 16px);
  cursor: pointer;
  user-select: none;
}
.page-arrow.disabled {
  opacity: 0.3;
  pointer-events: none;
}

.page-info {
  color: #e0dad9;
  font-size: clamp(10px, 0.65vw, 16px);
}

.side-panel {
  width: 18%;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 1.5vh;
}

.game-time-box {
  background: #e0dad9;
  border-radius: 3.1vw;
  padding: 2vh 1vw;
  text-align: center;
}

.time-display {
  font-size: clamp(20px, 1.5vw, 38px);
  color: #000;
}

.speed-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1vw;
}

.speed-arrow {
  color: #e0dad9;
  font-size: clamp(20px, 1.4vw, 36px);
  cursor: pointer;
  user-select: none;
}
.speed-arrow.disabled {
  opacity: 0.3;
  pointer-events: none;
}

.speed-label {
  color: #e0dad9;
  font-size: clamp(16px, 1vw, 26px);
}

.custom-window {
  flex: 1;
  background: #e0dad9;
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

.tab-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.log-entry {
  display: flex;
  gap: 0.5vw;
  font-size: clamp(9px, 0.55vw, 14px);
  color: #000;
  padding: 0.3vh 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.log-time {
  min-width: 4.5em;
}
.log-train {
  min-width: 3.5em;
}

.warning-group {
  margin-bottom: 1vh;
}

.warning-header {
  font-size: clamp(9px, 0.52vw, 13px);
  margin-bottom: 0.4vh;
}
.warning-header.worsened {
  color: #db2020;
}
.warning-header.imminent {
  color: #c0a000;
}

.warning-item {
  display: flex;
  gap: 0.4vw;
  font-size: clamp(9px, 0.55vw, 14px);
  color: #000;
  padding: 0.2vh 0;
  flex-wrap: wrap;
}

.spread-value {
  color: #e74c3c;
}
.remaining-value {
  color: #c0a000;
  font-weight: 800;
}

.empty-tab {
  text-align: center;
  color: #999;
  padding: 2vh 0;
  font-size: clamp(10px, 0.6vw, 14px);
}

.tab-switcher {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8vw;
  padding-top: 0.5vh;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  margin-top: auto;
}

.tab-arrow {
  cursor: pointer;
  font-size: clamp(12px, 0.65vw, 16px);
  color: #000;
  user-select: none;
}
.tab-name {
  font-size: clamp(10px, 0.65vw, 16px);
  color: #000;
}

.modal-enter-active {
  transition: all 1.5s ease-out;
}
.modal-leave-active {
  transition: all 1.5s ease-in;
}
.modal-enter-from {
  transform: translateY(100vh) scale(0.3);
  opacity: 0;
}
.modal-leave-to {
  transform: translateY(100vh) scale(0.3);
  opacity: 0;
}
</style>

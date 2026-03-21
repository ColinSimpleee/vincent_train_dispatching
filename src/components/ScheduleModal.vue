<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
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
const speedOptions: number[] = [...SPEED_OPTIONS]

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
  window.removeEventListener('resize', updateScale)
})

// --- 等比缩放 ---
const DESIGN_W = 2560
const DESIGN_H = 1432
const modalScale = ref(1)

function updateScale() {
  const sw = window.innerWidth / DESIGN_W
  const sh = window.innerHeight / DESIGN_H
  modalScale.value = Math.min(sw, sh)
}

watch(
  () => props.visible,
  (v) => {
    if (v) updateScale()
  },
)

onMounted(() => {
  updateScale()
  window.addEventListener('resize', updateScale)
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
        :style="{ transform: `scale(${modalScale})` }"
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
/* 基准设计尺寸: 2560 x 1432，运行时通过 transform: scale() 等比缩放 */

.modal-container,
.modal-container * {
  font-family: 'Exo 2', 'Inter', 'Consolas', sans-serif;
  font-weight: 800;
  font-style: italic;
}

/* 遮罩层 */
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

/* 弹窗主体 — 固定像素尺寸，由 JS scale 缩放 */
.modal-container {
  position: relative;
  width: 1935px;
  height: 1125px;
  background: linear-gradient(to bottom, #302f39 27%, #86829f 99%);
  border-radius: 154px;
  padding: 90px;
  display: flex;
  flex-direction: column;
  transition: border-top-right-radius 0.2s ease;
  transform-origin: center center;
}

.modal-container.hover-outside {
  border-top-right-radius: 30px;
}

/* 关闭按钮 */
.close-btn {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #ff3333;
  color: white;
  border: none;
  font-size: 28px;
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

/* 主区域 flex */
.main-area {
  display: flex;
  gap: 96px;
  flex: 1;
  min-height: 0;
}

/* ====== 左侧时刻表 ====== */
.schedule-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #e0dad9;
  border-radius: 80px;
  padding: 60px 50px 25px;
  min-width: 0;
}

.modal-title {
  text-align: center;
  font-size: 36px;
  color: #000;
  margin: 0 0 20px 0;
}

.table-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-wrapper {
  flex: 1;
  border: 7px solid #000;
  border-radius: 50px;
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
  font-size: 16px;
  padding: 10px 12px;
  text-align: left;
  white-space: nowrap;
}

td {
  color: #000;
  font-size: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-row {
  text-align: center;
  color: #999;
  padding: 30px 0;
}

.spread-indicator {
  margin-left: 6px;
  font-size: 14px;
}

/* 分页 */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
  padding: 10px 0;
  background: linear-gradient(90deg, #3c3952, #86829f);
  border-radius: 100px;
  margin-top: 10px;
}

.page-arrow {
  color: #e0dad9;
  font-size: 16px;
  cursor: pointer;
  user-select: none;
}
.page-arrow.disabled {
  opacity: 0.3;
  pointer-events: none;
}

.page-info {
  color: #e0dad9;
  font-size: 16px;
}

/* ====== 右侧面板 ====== */
.side-panel {
  width: 344px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 游戏时间 */
.game-time-box {
  background: #e0dad9;
  border-radius: 80px;
  height: 165px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.time-display {
  font-size: 38px;
  color: #000;
}

/* 倍速 */
.speed-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.speed-arrow {
  color: #e0dad9;
  font-size: 36px;
  cursor: pointer;
  user-select: none;
}
.speed-arrow.disabled {
  opacity: 0.3;
  pointer-events: none;
}

.speed-label {
  color: #e0dad9;
  font-size: 26px;
}

/* 自定义窗口 */
.custom-window {
  flex: 1;
  background: #e0dad9;
  border-radius: 80px;
  padding: 25px 25px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.custom-title {
  text-align: center;
  font-size: 24px;
  color: #000;
  margin: 0 0 15px 0;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* 调度日志 */
.log-entry {
  display: flex;
  gap: 10px;
  font-size: 16px;
  color: #000;
  padding: 4px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.log-time {
  min-width: 90px;
}
.log-train {
  min-width: 60px;
}

/* 晚点扩散警告 */
.warning-group {
  margin-bottom: 12px;
}

.warning-header {
  font-size: 13px;
  margin-bottom: 6px;
}
.warning-header.worsened {
  color: #db2020;
}
.warning-header.imminent {
  color: #c0a000;
}

.warning-item {
  display: flex;
  gap: 8px;
  font-size: 14px;
  color: #000;
  padding: 3px 0;
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
  padding: 30px 0;
  font-size: 16px;
}

/* 标签切换 */
.tab-switcher {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  margin-top: auto;
}

.tab-arrow {
  cursor: pointer;
  font-size: 16px;
  color: #000;
  user-select: none;
}
.tab-name {
  font-size: 16px;
  color: #000;
}

/* ====== 动画 ====== */
.modal-enter-active {
  transition: all 1.5s ease-out;
}
.modal-leave-active {
  transition: all 1.5s ease-in;
}
.modal-enter-from {
  transform: translateY(100vh) scale(0.3) !important;
  opacity: 0;
}
.modal-leave-to {
  transform: translateY(100vh) scale(0.3) !important;
  opacity: 0;
}
</style>

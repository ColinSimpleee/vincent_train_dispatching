<script setup lang="ts">
import { ref, shallowRef, reactive, computed, onMounted, onUnmounted } from 'vue'
import GameCanvas from './components/GameCanvas.vue'
import LeftPanel from './components/panels/LeftPanel.vue'
import RightPanel from './components/panels/RightPanel.vue'
import StartScreen from './components/StartScreen.vue'
import { PhysicsEngine } from './core/PhysicsEngine'
import type { RailMap, RailNode, TrainPhysics } from './core/RailGraph'
import { ScheduleManager } from './core/ScheduleManager'
import type {
  ScheduleEntry,
  KeyboardControlConfig,
  SelectedTrainDisplay,
  TrainAction,
} from './core/types'
import { tickToTime } from './core/utils'
import type { StationConfig } from './data/stations'
import ScheduleModal from './components/ScheduleModal.vue'
import { useDispatchLog } from './composables/useDispatchLog'
import type { DelaySpread } from './core/types'
import { SCHEDULE_VISIBLE_WINDOW } from './core/constants'

// Virtual Game Time Configuration
// China Railway Operation: 06:00 - 23:00
// Start time range: 07:00 (06:00+1h) to 19:00 (23:00-4h)

// Generate random start time between 07:00 and 19:00
function generateRandomStartTime() {
  const minHour = 7
  const maxHour = 19
  const randomHour = Math.floor(Math.random() * (maxHour - minHour + 1)) + minHour
  const randomMinute = Math.floor(Math.random() * 60)
  const randomSecond = Math.floor(Math.random() * 60)
  return { hours: randomHour, minutes: randomMinute, seconds: randomSecond }
}

const gameStartTime = ref(generateRandomStartTime())

// --- State ---
const view = ref<'start' | 'game'>('start')
const activeStation = ref<StationConfig | null>(null)
const gameSpeed = ref(1) // 1x, 2x, 5x, 10x
const lastNonZeroSpeed = ref(1) // 用于 Shift+Space 恢复上次速度

// Game Data
const map = reactive<RailMap>({ nodes: {}, edges: {}, platforms: [] })
const trains = reactive<TrainPhysics[]>([])

const keyboardMode = ref(false)
const showModeToast = ref(false)
const keyMappings = ref<KeyboardControlConfig[]>([])

// Game Control State
const showActionToast = ref(false)
const actionToastMessage = ref('')

// ScheduleManager 实例（在 handleStationSelect 中初始化）
const scheduleManager = shallowRef<ScheduleManager | null>(null)

const showScheduleModal = ref(false)
const modalPage = ref(0)
const { logs: dispatchLogs, addLog, clearLogs } = useDispatchLog()
const platformStopRecorded = new Set<string>()

// 等待队列由 ScheduleManager 驱动
const waitingQueue = computed<ScheduleEntry[]>(() => {
  void tick.value
  if (!scheduleManager.value) return []
  return scheduleManager.value.getWaitingEntries()
})

const selectedTrainId = ref<string | null>(null)
const tick = ref(0)
let animationFrameId: number | null = null
let lastTime = 0
let accumulator = 0
const FIXED_STEP = 1 / 60

// --- Computed ---
const selectedTrain = computed((): TrainPhysics | SelectedTrainDisplay | null => {
  const active = trains.find((t) => t.id === selectedTrainId.value)
  if (active) return active

  const queued = waitingQueue.value.find((q) => q.id === selectedTrainId.value)
  if (queued) {
    return {
      id: queued.id,
      state: 'WAITING',
      modelType: queued.model,
      speed: 0,
      currentEdgeId: 'QUEUE',
    }
  }
  return null
})

// Virtual Game Time (HH:MM:SS format)
const gameTime = computed(() => tickToTime(tick.value, gameStartTime.value))

// 时刻表弹窗：过滤可见条目（waiting + admitted + 未来30分钟内的 upcoming），按到站时间排序
const modalScheduleEntries = computed((): ScheduleEntry[] => {
  if (!scheduleManager.value) return []
  const allEntries = scheduleManager.value.getAllEntries()
  const windowEnd = tick.value + SCHEDULE_VISIBLE_WINDOW
  return allEntries
    .filter(
      (e) =>
        e.status === 'waiting' ||
        e.status === 'admitted' ||
        (e.status === 'upcoming' && e.scheduledArriveTick <= windowEnd),
    )
    .sort((a, b) => a.scheduledArriveTick - b.scheduledArriveTick)
})

// 时刻表弹窗：为 waiting/admitted 列车预计算晚点扩散
const modalDelaySpreadMap = computed((): Record<string, DelaySpread> => {
  if (!scheduleManager.value) return {}
  const result: Record<string, DelaySpread> = {}
  for (const entry of modalScheduleEntries.value) {
    if (entry.status === 'waiting' || entry.status === 'admitted') {
      result[entry.id] = scheduleManager.value.computeDelaySpread(entry, tick.value)
    }
  }
  return result
})

// 时刻表弹窗：映射列车状态文本
const modalTrainStatusMap = computed((): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const entry of modalScheduleEntries.value) {
    if (entry.status === 'waiting') {
      result[entry.id] = '等待区'
    } else if (entry.status === 'admitted') {
      const train = trains.find((t) => t.id === entry.id)
      if (train) {
        const edgeId = train.currentEdgeId
        if (edgeId.endsWith('_out') || edgeId === 'e_exit' || edgeId === 'e_out') {
          result[entry.id] = '正在出站'
        } else if (edgeId.startsWith('t') || edgeId.includes('platform')) {
          result[entry.id] = '停站'
        } else {
          result[entry.id] = '进站'
        }
      } else {
        result[entry.id] = '进站'
      }
    }
  }
  return result
})

// --- Train Exit Processing ---

function isMainExitEdge(edgeId: string): boolean {
  return edgeId === 'e_exit' || edgeId === 'e_out' || edgeId.startsWith('e_exit')
}

function getTrainHalfLength(train: TrainPhysics): number {
  return PhysicsEngine.getTrainLength(train) / 2
}

function processExitingTrains(): void {
  const HANDOVER_BASE = 400

  for (let i = trains.length - 1; i >= 0; i--) {
    const train = trains[i]
    if (!train) continue

    const edge = map.edges[train.currentEdgeId]
    if (!edge || !isMainExitEdge(train.currentEdgeId)) continue

    // Check control handover threshold
    const handoverThreshold = HANDOVER_BASE + getTrainHalfLength(train)
    if (train.position >= handoverThreshold && !train.isHandedOver) {
      addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'handover' })
      train.isHandedOver = true
      if (scheduleManager.value && train.scheduleEntryId) {
        scheduleManager.value.markDeparted(train.scheduleEntryId, tick.value)
      }
    }

    // 移交后，整列车驶出屏幕再移除
    if (train.isHandedOver) {
      const fullTrainLength = getTrainHalfLength(train) * 2
      const removalThreshold = handoverThreshold + fullTrainLength + 200
      if (train.position >= removalThreshold) {
        trains.splice(i, 1)
      }
    }
  }
}

// --- Loop ---
function loop(timestamp: number) {
  if (view.value !== 'game') return

  if (!lastTime) lastTime = timestamp
  const rawDt = (timestamp - lastTime) / 1000
  lastTime = timestamp

  if (gameSpeed.value === 0) {
    animationFrameId = requestAnimationFrame(loop)
    return
  }

  const dt = Math.min(rawDt, 0.1)
  accumulator += dt * gameSpeed.value

  while (accumulator >= FIXED_STEP) {
    try {
      PhysicsEngine.update(trains, map, FIXED_STEP, tick.value)
      tick.value++

      if (scheduleManager.value) {
        scheduleManager.value.ensureFutureSchedule(tick.value)
        scheduleManager.value.updateDelays()
        scheduleManager.value.checkArrivals(tick.value)
      }
    } catch (e) {
      console.error(e)
      cancelAnimationFrame(animationFrameId!)
      showToast(`游戏结束: ${e instanceof Error ? e.message : '未知错误'}`)
      return
    }

    for (const train of trains) {
      if (train.passengerState === 'BOARDING' && !platformStopRecorded.has(train.id)) {
        platformStopRecorded.add(train.id)
        addLog({
          tick: tick.value,
          gameTime: gameTime.value,
          trainId: train.id,
          event: 'platform_stop',
        })
      }
    }

    processExitingTrains()
    accumulator -= FIXED_STEP
  }

  animationFrameId = requestAnimationFrame(loop)
}

function startSim() {
  if (!animationFrameId) {
    lastTime = 0
    accumulator = 0
    animationFrameId = requestAnimationFrame(loop)
  }
}

function setGameSpeed(s: number) {
  if (s !== 0) lastNonZeroSpeed.value = s
  gameSpeed.value = s
}

// --- Keyboard Control ---
function generateKeyMappings(railMap: RailMap): KeyboardControlConfig[] {
  const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  const letterKeys = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('')
  const configs: KeyboardControlConfig[] = []

  const switches: RailNode[] = []
  const signals: RailNode[] = []

  for (const node of Object.values(railMap.nodes)) {
    if (node.type === 'switch') {
      switches.push(node)
    }
    if (node.signalState !== undefined) {
      signals.push(node)
    }
  }

  switches.sort((a, b) => a.x - b.x)
  signals.sort((a, b) => a.x - b.x)

  switches.forEach((node, index) => {
    if (index < numberKeys.length) {
      configs.push({
        nodeId: node.id,
        type: 'switch',
        key: numberKeys[index] ?? '',
        position: { x: node.x, y: node.y },
        labelOffset: 'right',
      })
    }
  })

  signals.forEach((node, index) => {
    if (index < letterKeys.length) {
      configs.push({
        nodeId: node.id,
        type: 'signal',
        key: letterKeys[index] ?? '',
        position: { x: node.x, y: node.y },
        labelOffset: 'left',
      })
    }
  })

  return configs
}

// --- Navigation ---
function handleStationSelect(config: StationConfig) {
  activeStation.value = config
  gameStartTime.value = generateRandomStartTime()

  // Deep copy to avoid mutating the template
  Object.assign(map, JSON.parse(JSON.stringify(config.mapData)))

  keyMappings.value = generateKeyMappings(map)

  // 初始化 ScheduleManager
  const gst = gameStartTime.value
  const gameStartTimeOffsetTicks = (gst.hours * 60 + gst.minutes) * 3600 + gst.seconds * 60
  scheduleManager.value = new ScheduleManager(
    config.scheduleConfig,
    config.difficulty,
    tick.value,
    gameStartTimeOffsetTicks,
  )

  platformStopRecorded.clear()
  clearLogs()
  modalPage.value = 0

  view.value = 'game'
  startSim()
}

function goHome() {
  view.value = 'start'
  activeStation.value = null
  trains.splice(0, trains.length)
  selectedTrainId.value = null
  tick.value = 0
  scheduleManager.value = null
  gameSpeed.value = 1
  lastNonZeroSpeed.value = 1
  showScheduleModal.value = false
  modalPage.value = 0
  platformStopRecorded.clear()
  clearLogs()
}

// --- Actions ---
function handleSelect(id: string) {
  selectedTrainId.value = id
}

function handleTrainAction(payload: { id: string; action: string }) {
  if (payload.action === 'DEPART') {
    const t = trains.find((train) => train.id === payload.id)
    if (t) handleDepartAction(t)
  }
}

// --- Pathfinding Helper (BFS) ---
function findPath(startNodeId: string, targetNodeId: string, railMap: RailMap): string[] {
  const queue: { node: string; path: string[] }[] = [{ node: startNodeId, path: [] }]
  const visited = new Set<string>([startNodeId])

  while (queue.length > 0) {
    const { node, path } = queue.shift()!
    if (node === targetNodeId) return path

    const outgoing = Object.values(railMap.edges).filter((e) => e.fromNode === node)
    for (const edge of outgoing) {
      if (!visited.has(edge.toNode)) {
        visited.add(edge.toNode)
        queue.push({ node: edge.toNode, path: [...path, edge.id] })
      }
    }
  }
  return []
}

function getExitNodeId(): string {
  return map.nodes['n_out'] ? 'n_out' : 'n_R_out'
}

function safeFindPath(startNodeId: string, targetNodeId: string): string[] {
  try {
    return findPath(startNodeId, targetNodeId, map)
  } catch (e) {
    console.error('Pathfinding error:', e)
    return []
  }
}

function isExitingEdge(edgeId: string): boolean {
  return edgeId.endsWith('_out') || edgeId === 'e_exit' || edgeId === 'e_out'
}

function startTrainMoving(train: TrainPhysics, speed: number): void {
  train.state = 'moving'
  train.speed = speed
}

function handleDepartAction(train: TrainPhysics): void {
  const current = train.currentEdgeId
  const outbound = current + '_out'
  const reverse = current + '_rev'

  train.passengerState = undefined

  // Case 1: Already on exit track
  if (isExitingEdge(current)) {
    const edge = map.edges[current]
    train.path = edge ? safeFindPath(edge.toNode, 'n_out') : []
    startTrainMoving(train, 80)
    return
  }

  // Case 2: Terminal turnaround
  if (map.edges[reverse]) {
    const revEdge = map.edges[reverse]
    train.currentEdgeId = reverse
    train.position = 0
    const targetNode = getExitNodeId()
    train.path = safeFindPath(revEdge.toNode, targetNode)
    startTrainMoving(train, 60)
    return
  }

  // Case 3: Standard departure via outbound edge
  if (map.edges[outbound]) {
    const outEdge = map.edges[outbound]
    const targetNode = getExitNodeId()
    train.path = safeFindPath(outEdge.toNode, targetNode)
    startTrainMoving(train, 80)
    return
  }

  // Case 4: Fallback - find path from current position
  const currEdge = map.edges[current]
  if (currEdge) {
    const targetNode = getExitNodeId()
    train.path = safeFindPath(currEdge.toNode, targetNode)
    startTrainMoving(train, 60)
    return
  }

  console.error(`[DEPART] No valid departure path found for train ${train.id} at ${current}`)
}

function handleAction(action: TrainAction) {
  if (!selectedTrainId.value) return

  switch (action) {
    case 'ADMIT': {
      const success = spawnTrainIntoMap(selectedTrainId.value)
      if (success) {
        addLog({
          tick: tick.value,
          gameTime: gameTime.value,
          trainId: selectedTrainId.value,
          event: 'admit',
        })
      }
      break
    }

    case 'DEPART': {
      const train = trains.find((t) => t.id === selectedTrainId.value)
      if (train) {
        handleDepartAction(train)
        addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'depart' })
      }
      break
    }

    case 'STOP': {
      const train = trains.find((t) => t.id === selectedTrainId.value)
      if (train) {
        train.speed = 0
        train.state = 'stopped'
        addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'stop' })
      }
      break
    }
  }
}

// --- Keyboard Control Functions ---
function toggleKeyboardMode() {
  keyboardMode.value = !keyboardMode.value
  showModeToast.value = true
  setTimeout(() => {
    showModeToast.value = false
  }, 2000)
}

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

function navigateTrain(direction: 1 | -1) {
  const allTrainIds = [...waitingQueue.value.map((q) => q.id), ...trains.map((t) => t.id)]

  if (allTrainIds.length === 0) {
    showToast('没有可选择的列车')
    return
  }

  const currentIndex = selectedTrainId.value ? allTrainIds.indexOf(selectedTrainId.value) : -1

  let nextIndex: number
  if (direction === 1) {
    nextIndex = (currentIndex + 1) % allTrainIds.length
  } else {
    nextIndex = currentIndex <= 0 ? allTrainIds.length - 1 : currentIndex - 1
  }
  selectedTrainId.value = allTrainIds[nextIndex] ?? null
}

function showToast(message: string) {
  actionToastMessage.value = message
  showActionToast.value = true
  setTimeout(() => {
    showActionToast.value = false
  }, 2000)
}

// 倍速键映射
const SPEED_KEY_MAP: Record<string, number> = {
  Digit1: 1,
  Numpad1: 1,
  Digit2: 2,
  Numpad2: 2,
  Digit5: 5,
  Numpad5: 5,
  Digit0: 10,
  Numpad0: 10,
}

function handleKeyPress(event: KeyboardEvent) {
  if (view.value !== 'game') return

  const key = event.key.toLowerCase()
  const shift = event.shiftKey

  // Space key: toggle mode (works in both modes)
  if (key === ' ' && !event.ctrlKey && !shift) {
    event.preventDefault()
    toggleKeyboardMode()
    return
  }

  // Only process other keys in keyboard mode
  if (!keyboardMode.value) return

  // Shift+Space: Pause/Resume
  if (shift && key === ' ') {
    event.preventDefault()
    togglePause()
    return
  }

  // Shift+number: Speed Control
  if (shift) {
    const speed = SPEED_KEY_MAP[event.code]
    if (speed !== undefined) {
      event.preventDefault()
      setGameSpeed(speed)
      showToast(`倍速: ${speed}x`)
      return
    }
  }

  // Arrow Keys: Train Selection
  if (key === 'arrowup') {
    event.preventDefault()
    navigateTrain(-1)
    return
  }
  if (key === 'arrowdown') {
    event.preventDefault()
    navigateTrain(1)
    return
  }

  // Tab: Admit Train
  if (key === 'tab') {
    event.preventDefault()
    if (!selectedTrainId.value) {
      showToast('未选择列车')
      return
    }
    handleAction('ADMIT')
    showToast(`${selectedTrainId.value} 允许进站`)
    return
  }

  // Shift+G: Depart Signal
  if (shift && key === 'g') {
    event.preventDefault()
    if (!selectedTrainId.value) {
      showToast('未选择列车')
      return
    }
    handleAction('DEPART')
    showToast(`${selectedTrainId.value} 发车信号`)
    return
  }

  // Shift+A: Emergency Stop
  if (shift && key === 'a') {
    event.preventDefault()
    if (!selectedTrainId.value) {
      showToast('未选择列车')
      return
    }
    handleAction('STOP')
    showToast(`${selectedTrainId.value} 紧急停车`)
    return
  }

  // Skip if Shift is pressed (to avoid conflict with Shift+number speed control)
  if (shift) return

  const keyUpper = key.toUpperCase()

  // Find mapping for this key
  const mapping = keyMappings.value.find((m) => m.key === keyUpper)
  if (!mapping) return

  event.preventDefault()

  const node = map.nodes[mapping.nodeId]
  if (!node) return

  if (mapping.type === 'switch') {
    const outgoingEdges = Object.values(map.edges).filter((e) => e.fromNode === mapping.nodeId)
    if (outgoingEdges.length === 0) return

    const current = node.switchState ?? 0
    node.switchState = (current + 1) % outgoingEdges.length
  } else if (mapping.type === 'signal') {
    node.signalState = node.signalState === 'green' ? 'red' : 'green'
  }
}

function spawnTrainIntoMap(id: string): boolean {
  const entry = waitingQueue.value.find((q) => q.id === id)
  if (!entry) return false

  const platformNum = Math.floor(Math.random() * 4) + 1

  let path: string[] = []
  let currentEdgeId = ''
  const direction: 1 | -1 = 1

  if (map.nodes['n_sw_1']) {
    // --- Terminal (Ladder) ---
    currentEdgeId = 'e_in'
    const targetNode = `n_p${platformNum}_end`
    const route = findPath('n_sw_1', targetNode, map)
    if (route.length > 0) {
      path = [currentEdgeId, ...route]
    } else {
      console.error('No path found to', targetNode)
      return false
    }
  } else if (map.nodes['n_L_in']) {
    // --- Small Station (Standard) ---
    currentEdgeId = 'e_entry_L'
    path = [`e_L_t${platformNum}`, `t${platformNum}`]
  } else {
    // Fallback / Hub
    currentEdgeId = 'e_entry_L'
    path = [`e_L_t${platformNum}`, `t${platformNum}`]
  }

  const newTrain: TrainPhysics = {
    id: id,
    currentEdgeId: currentEdgeId,
    position: 0,
    speed: 60,
    state: 'moving',
    direction: direction,
    path: path,
    visitedPath: [],
    modelType: entry.model,
    isCoupled: Math.random() < 0.2,
    scheduledArriveTick: entry.scheduledArriveTick,
    scheduleEntryId: entry.id,
  }

  const spawnEdge = map.edges[currentEdgeId]
  if (!spawnEdge) {
    console.error('Invalid spawn edge', currentEdgeId)
    return false
  }

  // SPAWN SAFETY CHECK
  const isBlocked = trains.some((t) => t.currentEdgeId === currentEdgeId && t.position < 300)
  if (isBlocked) {
    showToast('入口拥堵！前车尚未驶离安全区')
    return false
  }

  spawnEdge.occupiedBy = newTrain.id
  trains.push(newTrain)

  if (scheduleManager.value) {
    scheduleManager.value.markAdmitted(entry.id)
  }

  return true
}

// --- Lifecycle Hooks ---
onMounted(() => {
  window.addEventListener('keydown', handleKeyPress)
})

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  window.removeEventListener('keydown', handleKeyPress)
})
</script>

<template>
  <!-- Start Screen -->
  <StartScreen v-if="view === 'start'" @select="handleStationSelect" />

  <!-- Game Screen -->
  <div class="app-layout" v-if="view === 'game'">
    <!-- Left -->
    <aside class="layout-side">
      <LeftPanel
        :queue="waitingQueue"
        :trains="trains"
        :selectedId="selectedTrainId"
        :onSelect="handleSelect"
        :gameStartTime="gameStartTime"
        :currentTick="tick"
        :schedule-manager="scheduleManager"
      />
    </aside>

    <!-- Center -->
    <main class="layout-center">
      <div class="map-header">
        <div class="back-btn" @click="goHome">&larr; MENU</div>
        <div class="schedule-btn" @click="showScheduleModal = true">时刻表</div>
        <h2>{{ activeStation?.name || 'GAME' }} - CONTROL CENTER</h2>
      </div>
      <div class="map-viewport">
        <GameCanvas
          :map="map"
          :trains="trains"
          :keyboardMode="keyboardMode"
          :keyMappings="keyMappings"
          @train-action="handleTrainAction"
        />
      </div>
    </main>

    <!-- Right -->
    <aside class="layout-side">
      <RightPanel
        :gameTime="gameTime"
        :selectedTrain="selectedTrain"
        :onAction="handleAction"
        :gameSpeed="gameSpeed"
        :onSpeedChange="setGameSpeed"
        :keyboardMode="keyboardMode"
      />
    </aside>

    <!-- Mode Toast Notification -->
    <div v-if="showModeToast" class="mode-toast">
      {{ keyboardMode ? '已切换为键盘控制模式' : '已切换为鼠标控制模式' }}
    </div>

    <!-- Action Toast Notification -->
    <div v-if="showActionToast" class="action-toast">
      {{ actionToastMessage }}
    </div>

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
  </div>
</template>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  height: 100%;
  min-height: 400px;
  width: 100%;
  min-width: 900px;
  background: #121212;
  overflow: hidden;
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
}

.layout-side {
  height: 100%;
  overflow: hidden;
  z-index: 10;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
}

.layout-center {
  display: flex;
  flex-direction: column;
  background: #000;
  position: relative;
}

.map-header {
  height: 40px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.back-btn {
  position: absolute;
  left: 20px;
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

.back-btn:hover {
  color: #fff;
  border-color: #555;
  background: #222;
}

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

.map-header h2 {
  color: #555;
  font-size: 14px;
  letter-spacing: 5px;
  margin: 0;
}

.map-viewport {
  flex: 1;
  position: relative;
  min-height: 200px;
  background-image:
    linear-gradient(#1a1a1a 1px, transparent 1px),
    linear-gradient(90deg, #1a1a1a 1px, transparent 1px);
  background-size: 50px 50px;
  background-color: #0d0d0d;
}

.mode-toast {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 14px 28px;
  border-radius: 6px;
  font-size: 20px;
  font-weight: 500;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.action-toast {
  position: absolute;
  top: 120px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(26, 115, 140, 0.9);
  color: white;
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 18px;
  font-weight: 500;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
</style>

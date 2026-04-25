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
import Toast from './components/Toast.vue'
import type { ToastEntry, ToastKind } from './components/Toast.vue'
import Onboarding from './components/Onboarding.vue'
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
const keyMappings = ref<KeyboardControlConfig[]>([])

// Toast 系统：栈式展示，自动消失
const toasts = ref<ToastEntry[]>([])
let toastIdCounter = 0

function pushToast(msg: string, kind: ToastKind = 'action', duration = 2400) {
  const id = ++toastIdCounter
  toasts.value.push({ id, msg, kind })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, duration)
}

// Onboarding 控制
const showOnboarding = ref(false)

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

// 当前是否为终端站（所有列车都需折返出站）
const isReverseStation = computed(() => activeStation.value?.type === 'terminal')

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
        if (
          edgeId.endsWith('_out') ||
          edgeId === 'e_exit' ||
          edgeId === 'e_out' ||
          train.direction === -1
        ) {
          // 包含终端站自然折返：dir=-1 即出站中
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

// 判断列车是否在"反向出站"状态（终端站自然折返：在入口边上 dir=-1）
function getReverseExitProgress(train: TrainPhysics): number | null {
  if (train.direction !== -1) return null
  const edge = map.edges[train.currentEdgeId]
  if (!edge) return null
  const fromNode = map.nodes[edge.fromNode]
  if (fromNode?.type !== 'endpoint') return null
  // 反向时 position 从 length 减小到 0,exitProgress = 已经走了多远
  return edge.length - train.position
}

function processExitingTrains(): void {
  const HANDOVER_BASE = 400

  for (let i = trains.length - 1; i >= 0; i--) {
    const train = trains[i]
    if (!train) continue

    const edge = map.edges[train.currentEdgeId]
    if (!edge) continue

    // 两种出站方式：(a) 通过式 — 在 _exit/_out 主出站边正向行驶
    //              (b) 终端反向 — 在入口边上反向行驶,目的地是入口端点
    let exitProgress: number
    if (isMainExitEdge(train.currentEdgeId)) {
      exitProgress = train.position
    } else {
      const rev = getReverseExitProgress(train)
      if (rev === null) continue
      exitProgress = rev
    }

    // 控制移交阈值
    const handoverThreshold = HANDOVER_BASE + getTrainHalfLength(train)
    if (exitProgress >= handoverThreshold && !train.isHandedOver) {
      addLog({ tick: tick.value, gameTime: gameTime.value, trainId: train.id, event: 'handover' })
      train.isHandedOver = true
      if (scheduleManager.value && train.scheduleEntryId) {
        scheduleManager.value.markDeparted(train.scheduleEntryId, tick.value)
      }
    }

    // 移交后,整列车驶出屏幕再移除
    if (train.isHandedOver) {
      const fullTrainLength = getTrainHalfLength(train) * 2
      const removalThreshold = handoverThreshold + fullTrainLength + 200
      if (exitProgress >= removalThreshold) {
        trains.splice(i, 1)
      }
    }
  }
}

// --- Loop ---
function loop(timestamp: number) {
  // 视图切回首页时把循环干净地停下，而不是悄悄留下一个失效的 animationFrameId，
  // 否则下次进游戏 startSim 看到非空 ID 就会跳过 requestAnimationFrame，时间不走
  if (view.value !== 'game') {
    animationFrameId = null
    return
  }

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
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
      animationFrameId = null
      showToast(`游戏结束: ${e instanceof Error ? e.message : '未知错误'}`, 'error')
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
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  lastTime = 0
  accumulator = 0
  animationFrameId = requestAnimationFrame(loop)
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
      // 联动组成员：只给 master 分配按键，其它跳过（一个键控整组）
      if (node.groupId) {
        const group = railMap.switchGroups?.find((g) => g.id === node.groupId)
        if (group && group.masterNodeId !== node.id) continue
      }
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
  showOnboarding.value = true
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
  showOnboarding.value = false
  toasts.value = []
  platformStopRecorded.clear()
  clearLogs()
}

// --- Actions ---
function handleSelect(id: string) {
  selectedTrainId.value = id
}

function onPausedAction() {
  pushToast('暂停中：信号与道岔已锁定', 'error', 1800)
}

// 联动开关组：剪式渡线 4 个角点一次切换
function toggleSwitchGroup(groupId: string) {
  if (gameSpeed.value === 0) {
    onPausedAction()
    return
  }
  const group = map.switchGroups?.find((g) => g.id === groupId)
  if (!group) return
  const master = group.members.find((m) => m.nodeId === group.masterNodeId)
  if (!master) return
  const masterNode = map.nodes[master.nodeId]
  if (!masterNode) return
  // 从 master 的当前 switchState 反查组的当前模式
  const currentState = masterNode.switchState ?? 0
  const currentMode = master.states.indexOf(currentState)
  const newMode = ((currentMode >= 0 ? currentMode : 0) + 1) % master.states.length
  for (const m of group.members) {
    const n = map.nodes[m.nodeId]
    if (n) n.switchState = m.states[newMode] ?? 0
  }
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

  // Case 0: 终端站自然折返 — 站台末端是 buffer_stop 时,翻转方向沿原路反向走出去
  // 物理引擎本身支持边的双向通行,无需独立的 _rev/_out 边
  // path 设为非空哨兵值避免触发"path 用尽就停车"的兜底,resolveNextEdge 自己能找到反向路径
  const currentEdgeData = map.edges[current]
  if (currentEdgeData?.isPlatform) {
    const endNode = map.nodes[currentEdgeData.toNode]
    if (endNode?.type === 'buffer_stop') {
      train.direction = -1
      train.path = ['__REVERSE_EXIT__']
      startTrainMoving(train, 80)
      return
    }
  }

  const targetNode = getExitNodeId()

  // Case 1: 已经在出站轨道 — 沿当前边走到出口节点
  if (isExitingEdge(current)) {
    const edge = map.edges[current]
    train.path = edge ? safeFindPath(edge.toNode, targetNode) : []
    if (train.path.length === 0) {
      console.error(`[DEPART] ${train.id} on exit edge ${current} but no path to ${targetNode}`)
    }
    startTrainMoving(train, 80)
    return
  }

  // Case 2: 终端站折返 — 经 t*_rev 调头
  if (map.edges[reverse]) {
    const revEdge = map.edges[reverse]
    train.currentEdgeId = reverse
    train.position = 0
    const route = safeFindPath(revEdge.toNode, targetNode)
    if (route.length === 0) {
      console.error(`[DEPART] ${train.id} on reverse ${reverse} but no path to ${targetNode}`)
    }
    train.path = route
    startTrainMoving(train, 60)
    return
  }

  // Case 3: 标准出站 — 经 t*_out 走到合并点再到出口
  // 关键：把 outbound 边本身放在 path 最前面，否则 path 与实际路径错位，
  //      shift 对不上，列车依赖 resolveNextEdge 兜底，BFS 一旦返回空就直接停车
  if (map.edges[outbound]) {
    const outEdge = map.edges[outbound]
    const route = safeFindPath(outEdge.toNode, targetNode)
    if (route.length === 0) {
      console.error(
        `[DEPART] ${train.id} departing via ${outbound} but no path from ${outEdge.toNode} to ${targetNode}`,
      )
    }
    train.path = [outbound, ...route]
    startTrainMoving(train, 80)
    return
  }

  // Case 4: 兜底 — 从当前边末端找路径
  const currEdge = map.edges[current]
  if (currEdge) {
    const route = safeFindPath(currEdge.toNode, targetNode)
    if (route.length === 0) {
      console.error(
        `[DEPART] ${train.id} fallback path from ${currEdge.toNode} to ${targetNode} returned empty`,
      )
    }
    train.path = route
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
  pushToast(keyboardMode.value ? '切换至键盘模式' : '切换至鼠标模式', 'mode')
}

function togglePause() {
  if (gameSpeed.value === 0) {
    gameSpeed.value = lastNonZeroSpeed.value
    pushToast('游戏继续', 'action')
  } else {
    lastNonZeroSpeed.value = gameSpeed.value
    gameSpeed.value = 0
    pushToast('游戏已暂停', 'action')
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

function showToast(message: string, kind: ToastKind = 'action') {
  pushToast(message, kind)
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

  // 暂停期间锁定信号灯与道岔
  if (gameSpeed.value === 0) {
    onPausedAction()
    return
  }

  if (mapping.type === 'switch') {
    if (node.groupId) {
      // master 键触发整组切换
      toggleSwitchGroup(node.groupId)
      return
    }
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

  if (map.nodes['n_x1']) {
    // --- 终端车站（剪式渡线 + 1-to-2 分岔）---
    // 上行从顶部入口、下行从底部入口；具体到哪条站台由玩家通过 X 道岔 + sw_U/D 控制
    const fromTop = entry.direction === 'up'
    currentEdgeId = fromTop ? 'e_entry_U' : 'e_entry_D'
    // path 仅作为"还有去向"的提示，物理引擎按 switchState 实际选边
    path = [`t${platformNum}`]
  } else if (map.nodes['n_L_in']) {
    // --- 新手教学站 ---
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
  <div class="game" v-else>
    <!-- TopBar -->
    <div class="topbar">
      <div class="top-left">
        <button class="back-btn" @click="goHome">← MENU</button>
        <div class="top-brand">Headway <em>/ dispatcher</em></div>
      </div>
      <div class="top-center">
        <span class="station-title">STATION · <b>{{ activeStation?.name }}</b></span>
      </div>
      <div class="top-right">
        <div class="top-clock">{{ gameTime }}{{ gameSpeed === 0 ? '  ■' : '' }}</div>
        <button class="sched-btn" @click="showScheduleModal = true">
          <span class="dot" />
          时刻表 / SCHEDULE
        </button>
      </div>
    </div>

    <!-- Game body -->
    <div class="game-body">
      <LeftPanel
        :queue="waitingQueue"
        :trains="trains"
        :selectedId="selectedTrainId"
        :gameStartTime="gameStartTime"
        :currentTick="tick"
        :schedule-manager="scheduleManager"
        :isReverseStation="isReverseStation"
        @select="handleSelect"
      />

      <div class="canvas-wrap" :class="{ paused: gameSpeed === 0 }">
        <GameCanvas
          :map="map"
          :trains="trains"
          :keyboardMode="keyboardMode"
          :keyMappings="keyMappings"
          :selectedTrainId="selectedTrainId"
          :paused="gameSpeed === 0"
          @train-action="handleTrainAction"
          @select="handleSelect"
          @paused-action="onPausedAction"
          @toggle-group="toggleSwitchGroup"
        />

        <div
          class="mode-badge"
          :class="keyboardMode ? 'keyboard' : 'mouse'"
          @click="toggleKeyboardMode"
        >
          <span class="dot" />
          {{ keyboardMode ? 'KEYBOARD MODE' : 'MOUSE MODE' }}
          <span class="hint">SPACE 切换</span>
        </div>

        <div class="legend">
          <span class="item"><span class="swatch" />ACTIVE</span>
          <span class="item"><span class="swatch amber" />BOARDING</span>
          <span class="item"><span class="swatch blue" />UP</span>
          <span class="item"><span class="swatch red" />STOP</span>
        </div>

        <div v-if="gameSpeed === 0" class="paused-watermark">
          <div class="bar">◼ PAUSED · TIME HELD</div>
          <div class="txt">PAUSED</div>
        </div>
      </div>

      <RightPanel
        :gameTime="gameTime"
        :selectedTrain="selectedTrain"
        :gameSpeed="gameSpeed"
        :keyboardMode="keyboardMode"
        :currentTick="tick"
        :isReverseStation="isReverseStation"
        @action="handleAction"
        @speed-change="setGameSpeed"
      />
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
      :isReverseStation="isReverseStation"
      @close="showScheduleModal = false"
      @speed-change="setGameSpeed"
      @update:modalPage="modalPage = $event"
    />

    <Onboarding v-if="showOnboarding" @close="showOnboarding = false" />
  </div>

  <Toast :toasts="toasts" />
</template>

<style scoped>
.game {
  display: grid;
  grid-template-rows: 56px 1fr;
  height: 100%;
  width: 100%;
  min-width: 900px;
  background: var(--bg);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: rgba(10, 10, 10, 0.88);
  backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid var(--divider);
  position: relative;
  z-index: 20;
}
.top-left,
.top-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.top-center {
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.back-btn {
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg-sec);
  font-family: var(--mono);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 2px;
  letter-spacing: 0.08em;
  transition: all 200ms var(--ease);
}
.back-btn:hover {
  color: var(--fg);
  border-color: var(--fg-sec);
}

.top-brand {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.top-brand em {
  color: var(--accent);
  font-style: normal;
  font-weight: 400;
}

.station-title {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-sec);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.station-title b {
  color: var(--fg);
  font-weight: 400;
}

.top-clock {
  font-family: var(--mono);
  font-size: 15px;
  color: var(--fg);
  letter-spacing: 0.06em;
  padding: 0 16px;
  border-left: 1px solid var(--divider);
  height: 56px;
  display: flex;
  align-items: center;
}

.sched-btn {
  font-family: var(--ui);
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg);
  padding: 7px 14px;
  border-radius: 2px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: all 200ms var(--ease);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.sched-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.sched-btn .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}

.game-body {
  display: grid;
  grid-template-columns: 340px 1fr 340px;
  height: 100%;
  overflow: hidden;
}

.canvas-wrap {
  position: relative;
  background: #08080a;
  overflow: hidden;
}
.canvas-wrap.paused {
  filter: saturate(0.25) brightness(0.7);
  transition: filter 400ms var(--ease);
}
.canvas-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
}

.mode-badge {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(10, 10, 10, 0.76);
  backdrop-filter: blur(10px);
  border: 1px solid var(--divider-2);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-sec);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  z-index: 5;
  cursor: pointer;
}
.mode-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}
.mode-badge.mouse .dot {
  background: var(--sig-blue);
  box-shadow: 0 0 6px var(--sig-blue);
}
.mode-badge .hint {
  color: var(--fg-ter);
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--divider-2);
}

.legend {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  gap: 12px;
  background: rgba(10, 10, 10, 0.72);
  backdrop-filter: blur(10px);
  padding: 8px 12px;
  border: 1px solid var(--divider);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-ter);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  z-index: 5;
}
.legend .item {
  display: flex;
  gap: 6px;
  align-items: center;
}
.legend .swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--accent);
}
.legend .swatch.blue {
  background: var(--sig-blue);
}
.legend .swatch.amber {
  background: var(--sig-amber);
}
.legend .swatch.red {
  background: var(--sig-red);
}

.paused-watermark {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
}
.paused-watermark .txt {
  font-size: 22vh;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: rgba(241, 91, 91, 0.18);
  font-family: var(--font);
  mix-blend-mode: screen;
  line-height: 1;
}
.paused-watermark .bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: rgba(241, 91, 91, 0.18);
  border: 1px solid rgba(241, 91, 91, 0.5);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--sig-red);
  letter-spacing: 0.24em;
}
</style>

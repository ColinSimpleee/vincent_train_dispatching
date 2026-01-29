<script setup lang="ts">
import { ref, reactive, computed, onUnmounted } from 'vue'
import GameCanvas from './components/GameCanvas.vue'
import LeftPanel from './components/panels/LeftPanel.vue'
import RightPanel from './components/panels/RightPanel.vue'
import StartScreen from './components/StartScreen.vue'
import { PhysicsEngine } from './core/PhysicsEngine'
import type { RailMap, TrainPhysics, TrainModel } from './core/RailGraph'

// Type for trains in the waiting queue
interface QueuedTrain {
  id: string
  schedule: { arriveTick: number }
  model: TrainModel
}

// Type for selected train display (union of active train or queued train info)
interface SelectedTrainDisplay {
  id: string
  state: string
  modelType: TrainModel
  speed: number
  currentEdgeId: string
}
import type { StationConfig } from './data/stations'

// Virtual Game Time Configuration
// China Railway Operation: 06:00 - 23:00
// Start time range: 07:00 (06:00+1h) to 19:00 (23:00-4h)
const TICKS_PER_SECOND = 60 // 60 ticks = 1 game second

// Generate random start time between 07:00 and 19:00
function generateRandomStartTime() {
  const minHour = 7  // 06:00 + 1 hour
  const maxHour = 19 // 23:00 - 4 hours
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

// Game Data
const map = reactive<RailMap>({ nodes: {}, edges: {}, platforms: [] }) // Init empty
const trains = reactive<TrainPhysics[]>([])

// MVP Queue (Mock Data for Left Panel)
// Correct calculation: 1 minute = 60 seconds × 60 ticks/second = 3600 ticks
// Arrival times with 5-10 min intervals: 5 min, 12 min, 20 min
const waitingQueue = reactive<QueuedTrain[]>([
  { id: 'G9528', schedule: { arriveTick: 18000 }, model: 'CR400AF' },   // 5 minutes
  { id: 'D1006', schedule: { arriveTick: 43200 }, model: 'CRH380A' },   // 12 minutes
  { id: 'G284',  schedule: { arriveTick: 72000 }, model: 'CR400BF' }    // 20 minutes
])

const selectedTrainId = ref<string | null>(null)
const tick = ref(0)
let animationFrameId: number | null = null
let lastTime = 0
let accumulator = 0
const FIXED_STEP = 1/60

// ... (existing helper functions) ...

// --- Computed ---
const selectedTrain = computed((): TrainPhysics | SelectedTrainDisplay | null => {
  // Check active trains first
  const active = trains.find(t => t.id === selectedTrainId.value)
  if (active) return active

  // Check queue - return display info for queued trains
  const queued = waitingQueue.find(q => q.id === selectedTrainId.value)
  if (queued) {
      return {
          id: queued.id,
          state: 'WAITING',
          modelType: queued.model,
          speed: 0,
          currentEdgeId: 'QUEUE'
      }
  }
  return null
})

// Virtual Game Time (HH:MM:SS format)
const gameTime = computed(() => {
  // Calculate total seconds elapsed in game
  const totalGameSeconds = Math.floor(tick.value / TICKS_PER_SECOND)
  
  // Add to start time
  let hours = gameStartTime.value.hours
  let minutes = gameStartTime.value.minutes
  let seconds = gameStartTime.value.seconds + totalGameSeconds
  
  // Handle overflow
  minutes += Math.floor(seconds / 60)
  seconds = seconds % 60
  
  hours += Math.floor(minutes / 60)
  minutes = minutes % 60
  
  hours = hours % 24 // Wrap at 24 hours
  
  // Format as HH:MM:SS
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
})

// --- Train Exit Processing ---
const CAR_PITCH = 30;

function isMainExitEdge(edgeId: string): boolean {
    return edgeId === 'e_exit' || edgeId === 'e_out' || edgeId.startsWith('e_exit');
}

function getTrainHalfLength(train: TrainPhysics): number {
    const numCars = train.isCoupled ? 16 : 8;
    return (numCars * CAR_PITCH) / 2;
}

function processExitingTrains(): void {
    const HANDOVER_BASE = 400;
    const REMOVAL_BUFFER = 50;

    for (let i = trains.length - 1; i >= 0; i--) {
        const train = trains[i];
        if (!train) continue;

        const edge = map.edges[train.currentEdgeId];
        if (!edge || !isMainExitEdge(train.currentEdgeId)) continue;

        // Check control handover threshold
        const handoverThreshold = HANDOVER_BASE + getTrainHalfLength(train);
        if (train.position >= handoverThreshold && !train.isHandedOver) {
            train.isHandedOver = true;
        }

        // Check removal threshold
        const removalThreshold = edge.length - REMOVAL_BUFFER;
        if (train.position >= removalThreshold) {
            trains.splice(i, 1);

            const queueIndex = waitingQueue.findIndex(q => q.id === train.id);
            if (queueIndex !== -1) {
                waitingQueue.splice(queueIndex, 1);
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

  // Prevent spiral of death
  const dt = Math.min(rawDt, 0.1)
  
  accumulator += dt * gameSpeed.value

  while (accumulator >= FIXED_STEP) {
      try {
        PhysicsEngine.update(trains, map, FIXED_STEP, tick.value)
        tick.value++ 
        
        // Auto refill queue (Scaled with Game Time)
        // Generate new trains 5-10 minutes in advance
        // 1 minute = 3600 ticks, so 5-10 min = 18000-36000 ticks
        if (waitingQueue.length < 5 && Math.random() < 0.005) {
            const prefix = Math.random() > 0.5 ? 'G' : 'D';
            // Rule: Rightward (Up) = Even numbers
            const num = Math.floor(Math.random() * 4500 + 500) * 2;
            const id = prefix + num;
            const advanceTime = 18000 + Math.floor(Math.random() * 18000); // 5-10 minutes
            waitingQueue.push({
                id: id,
                schedule: { arriveTick: tick.value + advanceTime },
                model: (['CR400AF', 'CR400BF', 'CRH380A'] as const)[Math.floor(Math.random()*3)] ?? 'CR400AF' 
            });
        }
      } catch (e) {
        console.error(e)
        cancelAnimationFrame(animationFrameId!)
        return 
      }
      
      // Process trains on exit edges
      processExitingTrains();
      
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
    gameSpeed.value = s
}

// --- Navigation ---
function handleStationSelect(config: StationConfig) {
    activeStation.value = config
    
    // Regenerate random start time for new game
    gameStartTime.value = generateRandomStartTime()
    
    // Load Map Data
    // Note: We deep copy to avoid mutating the template
    Object.assign(map, JSON.parse(JSON.stringify(config.mapData)))
    
    // Switch View
    view.value = 'game'
    
    // Start Logic
    startSim()
}

function goHome() {
    view.value = 'start'
    // Reset Game State
    activeStation.value = null
    trains.splice(0, trains.length)
    selectedTrainId.value = null
    tick.value = 0
    // Optional: Stop simulation loop, but existing logic handles 'start' view pause.
}

// --- Actions ---
function handleSelect(id: string) {
    selectedTrainId.value = id
}

function handleTrainAction(payload: { id: string, action: string }) {
    if (payload.action === 'DEPART') {
        const t = trains.find(train => train.id === payload.id)
        if (t) {
            // Clear passenger state to allow movement
            // PhysicsEngine loop will require currentEdgeId vs lastServicedEdgeId logic.
            // Since lastServicedEdgeId is set, it won't trigger "auto stop" again on this edge.
            // computeIntent will proceed to resolveNextEdge.
            t.passengerState = undefined; 
            t.state = 'moving';
            t.speed = 60; 
        }
    }
}

// --- Pathfinding Helper (BFS) ---
function findPath(startNodeId: string, targetNodeId: string, railMap: RailMap): string[] {
    const queue: { node: string, path: string[] }[] = [{ node: startNodeId, path: [] }];
    const visited = new Set<string>([startNodeId]);

    while (queue.length > 0) {
        const { node, path } = queue.shift()!;
        if (node === targetNodeId) return path;

        const outgoing = Object.values(railMap.edges).filter(e => e.fromNode === node);
        for (const edge of outgoing) {
            if (!visited.has(edge.toNode)) {
                visited.add(edge.toNode);
                queue.push({ node: edge.toNode, path: [...path, edge.id] });
            }
        }
    }
    return [];
}

function getExitNodeId(): string {
    return map.nodes['n_out'] ? 'n_out' : 'n_R_out';
}

function safeFindPath(startNodeId: string, targetNodeId: string): string[] {
    try {
        return findPath(startNodeId, targetNodeId, map);
    } catch (e) {
        console.error("Pathfinding error:", e);
        return [];
    }
}

function isExitingEdge(edgeId: string): boolean {
    return edgeId.endsWith('_out') || edgeId === 'e_exit' || edgeId === 'e_out';
}

function startTrainMoving(train: TrainPhysics, speed: number): void {
    train.state = 'moving';
    train.speed = speed;
}

function handleDepartAction(train: TrainPhysics): void {
    const current = train.currentEdgeId;
    const outbound = current + '_out';
    const reverse = current + '_rev';
    const currentEdge = map.edges[current];

    console.log(`[DEPART] Train ${train.id} departing from ${current}`);
    console.log(`[DEPART] Current state: ${train.state}, speed: ${train.speed}, passengerState: ${train.passengerState}`);
    console.log(`[DEPART] Position: ${train.position}, Edge length: ${currentEdge?.length}, At boundary: ${train.position >= (currentEdge?.length ?? 0)}`);

    train.passengerState = undefined;

    // Case 1: Already on exit track
    if (isExitingEdge(current)) {
        const edge = map.edges[current];
        const startNode = edge?.toNode;
        train.path = edge ? safeFindPath(edge.toNode, 'n_out') : [];
        startTrainMoving(train, 80);
        console.log(`[DEPART] Case 1: Already exiting`);
        console.log(`[DEPART] Path from ${startNode} to n_out:`, train.path);
        return;
    }

    // Case 2: Terminal turnaround
    if (map.edges[reverse]) {
        const revEdge = map.edges[reverse];
        train.currentEdgeId = reverse;
        train.position = 0;
        const startNode = revEdge.toNode;
        const targetNode = getExitNodeId();
        train.path = safeFindPath(startNode, targetNode);
        startTrainMoving(train, 60);
        console.log(`[DEPART] Case 2: Turnaround to ${reverse}`);
        console.log(`[DEPART] Path from ${startNode} to ${targetNode}:`, train.path);
        return;
    }

    // Case 3: Standard departure via outbound edge
    if (map.edges[outbound]) {
        const outEdge = map.edges[outbound];
        const startNode = outEdge.toNode;
        const targetNode = getExitNodeId();
        const pathAfter = safeFindPath(startNode, targetNode);
        train.path = pathAfter;
        startTrainMoving(train, 80);
        console.log(`[DEPART] Case 3: Standard via ${outbound}`);
        console.log(`[DEPART] Path from ${startNode} (outEdge.toNode) to ${targetNode}:`, pathAfter);
        console.log(`[DEPART] After startMoving: state=${train.state}, speed=${train.speed}`);
        return;
    }

    // Case 4: Fallback - find path from current position
    const currEdge = map.edges[current];
    if (currEdge) {
        const startNode = currEdge.toNode;
        const targetNode = getExitNodeId();
        train.path = safeFindPath(startNode, targetNode);
        startTrainMoving(train, 60);
        console.log(`[DEPART] Case 4: Fallback`);
        console.log(`[DEPART] Path from ${startNode} to ${targetNode}:`, train.path);
        return;
    }

    console.error(`[DEPART] No valid departure path found for train ${train.id} at ${current}`);
}

function handleAction(action: string) {
    if (!selectedTrainId.value) return;

    switch (action) {
        case 'ADMIT':
            spawnTrainIntoMap(selectedTrainId.value);
            break;

        case 'DEPART': {
            const train = trains.find(t => t.id === selectedTrainId.value);
            if (train) handleDepartAction(train);
            break;
        }

        case 'STOP': {
            const train = trains.find(t => t.id === selectedTrainId.value);
            if (train) {
                train.speed = 0;
                train.state = 'stopped';
            }
            break;
        }
    }
}

function spawnTrainIntoMap(id: string) {
    const qIndex = waitingQueue.findIndex(q => q.id === id)
    const platformNum = Math.floor(Math.random() * 4) + 1 // 1..4
    
    let path: string[] = []
    let currentEdgeId = ''
    
    // Determine Logic based on Map Type (Heuristic)
    if (map.nodes['n_sw_1']) {
        // --- Terminal (Ladder) ---
        currentEdgeId = 'e_in';
        // Path from Throat (sw1) to Platform End
        // findPath uses Node IDs. e_in goes to n_sw_1.
        const targetNode = `n_p${platformNum}_end`;
        // We start pathfinding from n_sw_1
        const route = findPath('n_sw_1', targetNode, map);
        if (route.length > 0) {
            path = [currentEdgeId, ...route];
        } else {
            console.error("No path found to", targetNode);
            return;
        }
    } else if (map.nodes['n_L_in']) {
        // --- Small Station (Standard) ---
        // Existing Hardcoded Logic (Verified working)
        currentEdgeId = 'e_entry_L';
        path = [`e_L_t${platformNum}`, `t${platformNum}`];
        // BFS Alternative:
        // const route = findPath('n_sw_L', `n_p${platformNum}_end`, map);
        // path = [currentEdgeId, ...route];
    } else {
        // Fallback or Hub
        currentEdgeId = 'e_entry_L'
        path = [`e_L_t${platformNum}`, `t${platformNum}`]
    }
        
    const newTrain: TrainPhysics = {
        id: id,
        currentEdgeId: currentEdgeId,
        position: 0,
        speed: 60,
        state: 'moving',
        direction: 1, // Default forward movement
        path: path,
        visitedPath: [], // Initialize empty visited path for tail rendering
        modelType: waitingQueue[qIndex]?.model ?? 'CR400AF',
        isCoupled: Math.random() < 0.2
    }

    const spawnEdge = map.edges[currentEdgeId];
    if (!spawnEdge) {
         console.error("Invalid spawn edge", currentEdgeId);
         return;
    }

    // SPAWN SAFETY CHECK (Ghost Mode)
    // Prevent spawning if another train is physically blocking the entry point (0-300px).
    const isBlocked = trains.some(t =>
        t.currentEdgeId === currentEdgeId && t.position < 300
    );

    if (isBlocked) {
        alert("入口拥堵！前车尚未驶离安全区 (Wait for clear entry)");
        return;
    }

    spawnEdge.occupiedBy = newTrain.id;
    trains.push(newTrain);
    
    if (qIndex !== -1) waitingQueue.splice(qIndex, 1) 
}

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
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
        />
    </aside>

    <!-- Center -->
    <main class="layout-center">
        <div class="map-header">
            <div class="back-btn" @click="goHome">← MENU</div>
            <h2>{{ activeStation?.name || 'GAME' }} - CONTROL CENTER</h2>
        </div>
        <div class="map-viewport">
            <GameCanvas :map="map" :trains="trains" @train-action="handleTrainAction" />
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
        />
    </aside>
  </div>
</template>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  height: 100vh;
  width: 100vw;
  background: #121212;
  overflow: hidden;
  font-family: "Segoe UI", "PingFang SC", sans-serif;
}

.layout-side {
  height: 100%;
  overflow: hidden;
  z-index: 10;
  box-shadow: 0 0 20px rgba(0,0,0,0.5);
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
  position: relative; /* For absolute positioning of Back button */
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

.map-header h2 {
  color: #555;
  font-size: 14px;
  letter-spacing: 5px;
  margin: 0;
}

.map-viewport {
  flex: 1;
  position: relative;
  /* Pattern Background for Tech Feel */
  background-image: 
    linear-gradient(#1a1a1a 1px, transparent 1px),
    linear-gradient(90deg, #1a1a1a 1px, transparent 1px);
  background-size: 50px 50px;
  background-color: #0d0d0d;
}
</style>

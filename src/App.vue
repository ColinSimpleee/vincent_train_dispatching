<script setup lang="ts">
import { ref, reactive, computed, onUnmounted } from 'vue'
import GameCanvas from './components/GameCanvas.vue'
import LeftPanel from './components/panels/LeftPanel.vue'
import RightPanel from './components/panels/RightPanel.vue'
import StartScreen from './components/StartScreen.vue'
import { PhysicsEngine } from './core/PhysicsEngine'
import type { RailMap, TrainPhysics } from './core/RailGraph'
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
const waitingQueue = reactive([
  { id: 'G9527', schedule: { arriveTick: 9 }, model: 'CR400AF' },
  { id: 'D1006', schedule: { arriveTick: 12 }, model: 'CRH380A' },
  { id: 'K284',  schedule: { arriveTick: 15 }, model: 'CR400BF' }
])

const selectedTrainId = ref<string | null>(null)
const tick = ref(0)
let animationFrameId: number | null = null
let lastTime = 0
let accumulator = 0
const FIXED_STEP = 1/60

// ... (existing helper functions) ...

// --- Computed ---
const selectedTrain = computed(() => {
  // Check active trains first
  const active = trains.find(t => t.id === selectedTrainId.value)
  if (active) return active
  
  // Check queue
  const queued = waitingQueue.find(q => q.id === selectedTrainId.value)
  if (queued) {
      // Mock a TrainPhysics object for display
      return { 
          id: queued.id, 
          state: 'WAITING',
          modelType: queued.model, 
          speed: 0, 
          currentEdgeId: 'QUEUE' 
      } as any
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
        PhysicsEngine.update(trains, map, FIXED_STEP)
        tick.value++ 
        
        // Auto refill queue (Scaled with Game Time)
        if (waitingQueue.length < 5 && Math.random() < 0.005) {
            const id = 'G' + Math.floor(Math.random() * 9000 + 1000);
            waitingQueue.push({
                id: id,
                schedule: { arriveTick: tick.value + 20 },
                model: ['CR400AF', 'CR400BF', 'CRH380A'][Math.floor(Math.random()*3)] as any 
            });
        }
      } catch (e) {
        console.error(e)
        cancelAnimationFrame(animationFrameId!)
        return 
      }
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

function handleAction(action: string) {
    if (!selectedTrainId.value) return;

    if (action === 'ADMIT') {
        spawnTrainIntoMap(selectedTrainId.value)
// --- Pathfinding Helper (BFS) ---
function findPath(startNodeId: string, targetNodeId: string, map: RailMap): string[] {
    const queue: { node: string, path: string[] }[] = [{ node: startNodeId, path: [] }];
    const visited = new Set<string>();
    visited.add(startNodeId);

    while (queue.length > 0) {
        const { node, path } = queue.shift()!;
        if (node === targetNodeId) return path;

        // Find outgoing edges
        const outgoing = Object.values(map.edges).filter(e => e.fromNode === node);
        for (const edge of outgoing) {
            if (!visited.has(edge.toNode)) {
                visited.add(edge.toNode);
                queue.push({ node: edge.toNode, path: [...path, edge.id] });
            }
        }
    }
    return []; // No path found
}

// ... existing code ...

    } else if (action === 'DEPART') {
        const t = trains.find(train => train.id === selectedTrainId.value)
        if (t) {
            const current = t.currentEdgeId;
            const outbound = current + '_out'; 
            const reverse = current + '_rev';

            // 1. Resume if already exiting
            if (current.endsWith('_out') || current === 'e_exit' || current === 'e_out') {
                 // Try to resolve path dynamically if empty
                 if (t.path.length === 0) {
                     const edge = map.edges[current];
                     t.path = findPath(edge.toNode, 'n_out', map);
                     // If still empty, maybe just move blindly (e_exit)
                     if (t.path.length === 0 && current !== 'e_exit' && current !== 'e_out') {
                         t.path = ['e_exit']; // Fallback
                     }
                 }
                 t.state = 'moving';
                 t.speed = 80;
                 return;
            }

            // 2. Terminal Turnaround
            if (map.edges[reverse]) {
                const revEdge = map.edges[reverse];
                // Teleport to the "Return" track
                t.currentEdgeId = reverse;
                t.position = 0; 
                
                // Calculate path to exit
                // Start from the END of the reverse edge (e.g. n_p1_start)
                const startNode = revEdge.toNode;
                // Target is generic 'n_out' (or 'n_R_out' for small station? No, small station uses direct)
                // Let's try 'n_out' first, if fails maybe 'n_R_out'.
                // Or define target based on station type?
                // For Terminal, target is 'n_out'. For Small, 'n_R_out'.
                const target = map.nodes['n_out'] ? 'n_out' : 'n_R_out';
                
                t.path = findPath(startNode, target, map);
                
                t.state = 'moving';
                t.speed = 60;
                return;
            }

            // 3. Standard Departure
            if (map.edges[outbound]) {
                const outEdge = map.edges[outbound];
                const target = map.nodes['n_out'] ? 'n_out' : 'n_R_out';
                t.path = [outbound, ...findPath(outEdge.toNode, target, map)];
                
                t.state = 'moving';
                t.speed = 80; 
            } else {
                // Manual Fallback
                 const target = map.nodes['n_out'] ? 'n_out' : 'n_R_out';
                 // Try to path from end of current edge
                 const currEdgeObj = map.edges[current];
                 if (currEdgeObj) {
                     t.path = findPath(currEdgeObj.toNode, target, map);
                     if (t.path.length > 0) {
                         t.state = 'moving';
                         t.speed = 60;
                     }
                 }
            }
        }
    } else if (action === 'STOP') {
        const t = trains.find(train => train.id === selectedTrainId.value)
        if (t) {
            t.speed = 0;
            t.state = 'stopped';
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
        path: path,
        modelType: (waitingQueue[qIndex]?.model as any) || 'CR400AF',
        isCoupled: Math.random() < 0.2
    }

    if (!map.edges[currentEdgeId]) {
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
    
    // if (map.edges[currentEdgeId].occupiedBy) { ... } // DISABLED old logic

    map.edges[currentEdgeId].occupiedBy = newTrain.id
    trains.push(newTrain)
    
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
            :selectedId="selectedTrainId"
            :onSelect="handleSelect"
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

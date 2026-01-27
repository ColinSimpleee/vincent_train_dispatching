<script setup lang="ts">
import { computed } from 'vue';
import type { RailMap, TrainPhysics } from '../core/RailGraph';

const props = defineProps<{
  map: RailMap;
  trains: TrainPhysics[];
}>();

const emit = defineEmits<{
  (e: 'train-action', payload: { id: string, action: string }): void
}>()

// Safe computed properties for map data
const safeEdges = computed(() => {
  if (!props.map?.edges) return [];
  try {
    return Object.values(props.map.edges).filter(e => e != null);
  } catch (error) {
    console.error('Error accessing map.edges:', error);
    return [];
  }
});

const safeNodes = computed(() => {
  if (!props.map?.nodes) return [];
  try {
    return Object.values(props.map.nodes).filter(n => n != null);
  } catch (error) {
    console.error('Error accessing map.nodes:', error);
    return [];
  }
});

// Define car pitch (car length + gap)
const TOTAL_PITCH = 30; // Example value, adjust as needed

// Helper to find coords
function getNode(id: string) {
  return props.map?.nodes?.[id] || { x: 0, y: 0 };
}

// Calculate Train Position (SVG Transform)
function getTrainTransform(train: TrainPhysics) {
  const edge = props.map.edges[train.currentEdgeId];
  if (!edge) return 'scale(0)'; // Hide if invalid

  const start = getNode(edge.fromNode);
  const end = getNode(edge.toNode);

  const t = Math.max(0, Math.min(1, train.position / edge.length));
  
  const x = start.x + (end.x - start.x) * t;
  const y = start.y + (end.y - start.y) * t;
  
  const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);

  return `translate(${x}, ${y}) rotate(${angle})`;
}

// --- Math Helpers ---
function getEdgePath(edge: any) {
    const s = getNode(edge.fromNode);
    const e = getNode(edge.toNode);
    if (edge.control1 && edge.control2) {
        return `M ${s.x} ${s.y} C ${edge.control1.x} ${edge.control1.y}, ${edge.control2.x} ${edge.control2.y}, ${e.x} ${e.y}`;
    }
    return `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
}

function cubicBezier(t: number, p0: any, p1: any, p2: any, p3: any) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    let p = { x: 0, y: 0 };
    p.x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    p.y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    return p;
}

function cubicBezierAngle(t: number, p0: any, p1: any, p2: any, p3: any) {
    const u = 1 - t;
    const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
    return Math.atan2(dy, dx) * (180 / Math.PI);
}

// --- Switch Logic ---
function getOutgoingEdges(nodeId: string) {
    // Return edges where this node is the SOURCE
    // Sort by ID to be deterministic
    if (!props.map?.edges) return [];
    
    try {
        return Object.values(props.map.edges)
            .filter(e => e?.fromNode === nodeId)
            .sort((a, b) => (a?.id || '').localeCompare(b?.id || ''));
    } catch (error) {
        console.error('Error in getOutgoingEdges:', error);
        return [];
    }
}

function getActiveEdge(node: any) {
    if (!node || node.type !== 'switch') return null;
    
    const edges = getOutgoingEdges(node.id);
    if (!edges || !Array.isArray(edges) || edges.length === 0) return null;
    
    const index = node.switchState || 0;
    return edges[index % edges.length];
}

function toggleSwitch(node: any) {
    if (!node) return;
    
    const edges = getOutgoingEdges(node.id);
    if (!edges || edges.length === 0) return;
    
    // Increment State
    const current = node.switchState || 0;
    node.switchState = (current + 1) % edges.length;
}

function toggleSignal(node: any) {
    if (!node) return;
    
    // Default is 'green' (undefined/null allowed pass)
    // Toggle: red -> green, green -> red, undefined -> red
    const current = node.signalState || 'green';
    node.signalState = (current === 'green') ? 'red' : 'green';
}

function getCarTransform(train: TrainPhysics, carIndex: number) {
  let dist = train.position - (carIndex * TOTAL_PITCH);
  let edgeId = train.currentEdgeId;
  
  // Backtracking logic
  if (dist < 0) {
     const history = train.visitedPath || [];
     let hIndex = 0;
     while (dist < 0 && hIndex < history.length) {
        const prevEdgeId = history[hIndex];
        const prevEdge = props.map.edges[prevEdgeId];
        if (!prevEdge) break; 
        edgeId = prevEdgeId;
        dist += prevEdge.length; 
        hIndex++;
     }
  }

  const edge = props.map.edges[edgeId];
  if (!edge) return 'scale(0)';

  // Virtual Tail Logic for Spawn/Entry
  if (dist < 0) {
      const startNode = props.map.nodes[edge.fromNode];
      if (startNode?.type !== 'endpoint') {
          return 'scale(0)'; 
      }
  } else if (dist > edge.length) {
      return 'scale(0)'; 
  }

  const len = edge.length || 1; 
  const t = dist / len; 
  const start = getNode(edge.fromNode);
  const end = getNode(edge.toNode);

  // Bezier Support
  if (edge.control1 && edge.control2) {
      const pos = cubicBezier(t, start, edge.control1, edge.control2, end);
      const angle = cubicBezierAngle(t, start, edge.control1, edge.control2, end);
      return `translate(${pos.x}, ${pos.y}) rotate(${angle})`;
  }

  // Linear
  const x = start.x + (end.x - start.x) * t;
  const y = start.y + (end.y - start.y) * t;
  const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);

  return `translate(${x}, ${y}) rotate(${angle})`;
}
</script>

<template>
  <div class="canvas-container">
    <svg class="rail-canvas" width="2400" height="600" viewBox="0 0 2400 600">
      <!-- Layer 0: Platforms (Concrete Islands) -->
      <g class="platforms">

        <g v-for="plat in map.platforms" :key="plat.id">
           <!-- Concrete Base -->
           <rect 
             :x="plat.rect.x" :y="plat.rect.y" 
             :width="plat.rect.w" :height="plat.rect.h"
             fill="#2c3e50"
             rx="4"
             stroke="#333"
             stroke-width="2"
           />
           <!-- Safety Line (Yellow Dashed) -->
           <rect 
             :x="plat.rect.x + 4" :y="plat.rect.y + 4" 
             :width="plat.rect.w - 8" :height="plat.rect.h - 8"
             fill="none"
             stroke="#f1c40f"
             stroke-width="2"
             stroke-dasharray="8,8"
             rx="2"
           />
           <!-- Label -->
           <text 
             :x="plat.rect.x + plat.rect.w/2" 
             :y="plat.rect.y + plat.rect.h/2" 
             fill="#95a5a6" 
             font-size="14" 
             text-anchor="middle" 
             dominant-baseline="middle"
             style="font-family: monospace;"
           >
             {{ plat.label }}
           </text>
        </g>
      </g>

      <!-- Layer 1: Track Bed (Ballast) -->
      <g class="track-bed">
        <path 
          v-for="edge in safeEdges" 
          :key="edge.id"
          :d="getEdgePath(edge)"
          stroke="#111"
          stroke-width="12"
          fill="none"
          stroke-linecap="round"
        />
      </g>
      
      <!-- Layer 2: Rails -->
      <g class="rails">
        <path 
          v-for="edge in safeEdges" 
          :key="`rail-${edge.id}`"
          :d="getEdgePath(edge)"
          stroke="#555"
          stroke-width="3"
          fill="none"
        />
      </g>
      
      <!-- Layer 5: Controls (Switches) -->
      <g class="controls">
         <template v-for="node in safeNodes" :key="node.id">
            <g 
               v-if="node.type === 'switch'"
               :transform="`translate(${node.x}, ${node.y})`"
               @click="toggleSwitch(node)"
               style="cursor: pointer;"
            >
               <!-- Switch Body -->
               <circle r="12" fill="#333" stroke="#fff" stroke-width="2" />
               <!-- Indicator -->
               <text 
                  y="4" 
                  text-anchor="middle" 
                  fill="#fff" 
                  font-size="10" 
                  font-weight="bold"
               >
                 S{{ (node.switchState || 0) + 1 }}
               </text>
               <!-- Label -->
               <text 
                  y="-18" 
                  text-anchor="middle" 
                  fill="#f1c40f" 
                  font-size="10" 
                  style="text-shadow: 1px 1px 2px black;"
               >
                 SWITCH
               </text>
            </g>
         </template>
      </g>

      <!-- Layer 5.5: Buffer Stops -->
      <g class="buffers">
         <template v-for="node in safeNodes" :key="node.id">
            <g 
               v-if="node.type === 'buffer_stop'"
               :transform="`translate(${node.x}, ${node.y})`"
            >
               <!-- Buffer Stop Visual (Red Bar) -->
               <rect x="-4" y="-12" width="8" height="24" fill="#c0392b" stroke="#000" stroke-width="2" />
               <!-- Warning Stripes -->
               <line x1="-4" y1="-12" x2="4" y2="-4" stroke="#fff" stroke-width="2" />
               <line x1="-4" y1="-4" x2="4" y2="4" stroke="#fff" stroke-width="2" />
               <line x1="-4" y1="4" x2="4" y2="12" stroke="#fff" stroke-width="2" />
            </g>
         </template>
      </g>

      <!-- Layer 6: Signals (Interactive - Topmost) -->
      <g class="signals">
         <template v-for="node in safeNodes" :key="node.id">
            <g 
               v-if="['switch', 'connector', 'endpoint'].includes(node.type) && node.signalState"
               :transform="`translate(${node.x}, ${node.y - 15})`" 
               @click="toggleSignal(node)"
               style="cursor: pointer;"
            >
               <!-- Pole -->
               <line x1="0" y1="0" x2="0" y2="15" stroke="#555" stroke-width="2" />
               <!-- Light Box -->
               <rect x="-6" y="-14" width="12" height="14" rx="2" fill="#222" stroke="#444" stroke-width="1" />
               <!-- Light -->
               <circle 
                  cx="0" cy="-7" r="4" 
                  :fill="node.signalState === 'green' ? '#2ecc71' : '#e74c3c'" 
                  stroke="#000" stroke-width="1"
                  :filter="node.signalState === 'green' ? 'url(#glow-green)' : 'url(#glow-red)'"
               />
            </g>
         </template>
      </g>
      
      <defs>
        <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
           <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
           <feMerge>
               <feMergeNode in="coloredBlur"/>
               <feMergeNode in="SourceGraphic"/>
           </feMerge>
        </filter>
        <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
           <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
           <feMerge>
               <feMergeNode in="coloredBlur"/>
               <feMergeNode in="SourceGraphic"/>
           </feMerge>
        </filter>
      </defs>
      <!-- Layer 3.5: Switch Highlights (Active Path) -->
      <g class="switch-highlights">
         <template v-for="node in map.nodes" :key="node.id">
            <path 
               v-if="node.type === 'switch' && getActiveEdge(node)"
               :d="getEdgePath(getActiveEdge(node))"
               stroke="#2ecc71"
               stroke-width="6"
               fill="none"
               stroke-opacity="0.6"
               style="pointer-events: none;"
            />
         </template>
      </g>
      <g class="trains-layer">
        <template v-for="train in trains" :key="train.id">
           <!-- Render each car individually -->
           <foreignObject
             v-for="i in (train.isCoupled ? 16 : 8)"
             :key="`${train.id}-c${i}`"
             width="28"
             height="12"
             x="-14"
             y="-6"
             :transform="getCarTransform(train, i - 1)"
             style="overflow: visible;"
           >
             <div 
               class="car"
               :class="[train.modelType, { 'first-car': i === 1, 'last-car': i === (train.isCoupled ? 16 : 8) }]"
               xmlns="http://www.w3.org/1999/xhtml"
             >
                <div class="stripe"></div>
                <div class="windows"></div>
                <!-- Label only on first car -->
                <div v-if="i === 1" class="train-label-float">{{ train.id }}</div>
             </div>
           </foreignObject>
           
           <!-- Depart Button Overlay (Follows Head) -->
           <foreignObject
              v-if="train.passengerState === 'READY'"
              width="60"
              height="30"
              x="-30"
              y="-40"
              :transform="getCarTransform(train, 0)"
              style="overflow: visible;"
           >
              <button 
                 class="depart-btn-in-scene"
                 @click.stop="emit('train-action', { id: train.id, action: 'DEPART' })"
              >
                 发车
              </button>
           </foreignObject>
        </template>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.canvas-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0f0f0f;
  border: 1px solid #333;
  overflow: hidden;
}

.rail-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* --- Train Visuals --- */
/* .train-consist removed (unused) */

.car {
  width: 100%;
  height: 100%;
  background: #ccc;
  position: relative;
  border-radius: 1px;
  overflow: hidden;
  box-shadow: 1px 1px 2px rgba(0,0,0,0.5);
}

/* Streamlined Nose */
.car:first-child {
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}
.car:last-child {
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}

.stripe {
  position: absolute;
  top: 35%;
  height: 30%;
  width: 100%;
  background: #888;
  z-index: 1;
}

.windows {
  position: absolute;
  top: 10%;
  height: 20%;
  width: 90%;
  left: 5%;
  background: #333;
  z-index: 1;
  opacity: 0.8;
  border-radius: 1px;
}

.train-label-float {
  position: absolute;
  top: -15px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: bold;
  color: #fff;
  background: rgba(0,0,0,0.7);
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}

/* --- Models --- */

/* CR400AF (Red) */
.CR400AF .car { background: #ecf0f1; }
.CR400AF .stripe { background: #c0392b; }

/* CR400BF (Gold) */
.CR400BF .car { background: #fff; }
.CR400BF .stripe { background: #f39c12; }

/* CRH380A (Blue) */
.CRH380A .car { background: #fff; }
.CRH380A .stripe { background: #2980b9; }

.depart-btn-in-scene {
   background: #2ecc71;
   color: #fff;
   border: none;
   border-radius: 4px;
   padding: 4px 8px;
   font-size: 12px;
   font-weight: bold;
   cursor: pointer;
   box-shadow: 0 2px 5px rgba(0,0,0,0.5);
   transition: transform 0.1s;
   pointer-events: auto; /* Ensure clickable */
}
.depart-btn-in-scene:hover {
   transform: scale(1.1);
   background: #27ae60;
}
.depart-btn-in-scene:active {
   transform: scale(0.95);
}
</style>

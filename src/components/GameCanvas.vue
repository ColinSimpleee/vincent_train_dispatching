<script setup lang="ts">
import { computed } from 'vue';
import type { RailMap, RailEdge, RailNode, TrainPhysics } from '../core/RailGraph';
import type { KeyboardControlConfig } from '../core/types';
import { CAR_PITCH } from '../core/constants';

interface Point {
  x: number;
  y: number;
}

const props = defineProps<{
  map: RailMap;
  trains: TrainPhysics[];
  keyboardMode: boolean;
  keyMappings: KeyboardControlConfig[];
  selectedTrainId: string | null;
  paused: boolean;
}>();

const emit = defineEmits<{
  (e: 'train-action', payload: { id: string; action: string }): void;
  (e: 'select', id: string): void;
  (e: 'paused-action'): void;
  (e: 'toggle-group', groupId: string): void;
}>();

// 站台末端是 buffer_stop 的列车在出站时会原地翻转方向，"发车"按钮要贴在尾车（新车头）
function willReverseDepart(train: TrainPhysics): boolean {
  const edge = props.map.edges[train.currentEdgeId];
  if (!edge?.isPlatform) return false;
  const end = props.map.nodes[edge.toNode];
  return end?.type === 'buffer_stop';
}

const safeEdges = computed(() => {
  if (!props.map?.edges) return [];
  return Object.values(props.map.edges).filter(Boolean);
});

const safeNodes = computed(() => {
  if (!props.map?.nodes) return [];
  return Object.values(props.map.nodes).filter(Boolean);
});

const switchKbMap = computed(() =>
  Object.fromEntries(props.keyMappings.filter((m) => m.type === 'switch').map((m) => [m.nodeId, m.key])),
);
const signalKbMap = computed(() =>
  Object.fromEntries(props.keyMappings.filter((m) => m.type === 'signal').map((m) => [m.nodeId, m.key])),
);

function getNode(id: string): { x: number; y: number } {
  return props.map?.nodes?.[id] ?? { x: 0, y: 0 };
}

function getEdgePath(edge: RailEdge): string {
  const s = getNode(edge.fromNode);
  const e = getNode(edge.toNode);
  if (edge.control1 && edge.control2) {
    return `M ${s.x} ${s.y} C ${edge.control1.x} ${edge.control1.y}, ${edge.control2.x} ${edge.control2.y}, ${e.x} ${e.y}`;
  }
  return `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
}

function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function cubicBezierAngle(t: number, p0: Point, p1: Point, p2: Point, p3: Point): number {
  const u = 1 - t;
  const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function getOutgoingEdges(nodeId: string): RailEdge[] {
  if (!props.map?.edges) return [];
  return Object.values(props.map.edges)
    .filter((e) => e?.fromNode === nodeId)
    .sort((a, b) => (a?.id || '').localeCompare(b?.id || ''));
}

function getActiveEdge(node: RailNode | undefined): RailEdge | null {
  if (!node || node.type !== 'switch') return null;
  const edges = getOutgoingEdges(node.id);
  if (edges.length === 0) return null;
  const index = node.switchState ?? 0;
  return edges[index % edges.length] ?? null;
}

function toggleSwitch(node: RailNode | undefined): void {
  if (!node) return;
  if (props.paused) {
    emit('paused-action');
    return;
  }
  if (node.groupId) {
    // 联动组：交给 App 处理整组切换
    emit('toggle-group', node.groupId);
    return;
  }
  const edges = getOutgoingEdges(node.id);
  if (edges.length === 0) return;
  const current = node.switchState ?? 0;
  node.switchState = (current + 1) % edges.length;
}


function toggleSignal(node: RailNode | undefined): void {
  if (!node) return;
  if (props.paused) {
    emit('paused-action');
    return;
  }
  node.signalState = node.signalState === 'red' ? 'green' : 'red';
}

// 反向行驶时（dir=-1），从 currentEdge.fromNode 向前一条边走（沿当前道岔状态）。
// 镜像 PhysicsEngine.resolveNextEdge 在 arrivedAtFromNode=true 时的逻辑。
function getNextReverseEdge(currentEdgeId: string): string | undefined {
  const cur = props.map.edges[currentEdgeId];
  if (!cur) return undefined;
  const node = props.map.nodes[cur.fromNode];
  if (!node) return undefined;

  const incoming: string[] = [];
  for (const e of Object.values(props.map.edges)) {
    if (e.toNode === node.id) incoming.push(e.id);
  }
  incoming.sort();
  const candidates = incoming.filter((id) => id !== currentEdgeId);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  if (node.type === 'switch') {
    const idx = node.switchState ?? 0;
    return candidates[idx % candidates.length];
  }
  return candidates[0];
}

function getCarTransform(train: TrainPhysics, carIndex: number): string {
  let dist = train.position - carIndex * CAR_PITCH;
  let edgeId = train.currentEdgeId;

  if (dist < 0) {
    if (train.direction === 1) {
      // 正向行驶：沿 visitedPath 往身后回溯（已走过的边在身后）
      const history = train.visitedPath || [];
      let hIndex = 0;
      while (dist < 0 && hIndex < history.length) {
        const prevEdgeId = history[hIndex];
        if (!prevEdgeId) break;
        const prevEdge = props.map.edges[prevEdgeId];
        if (!prevEdge) break;
        edgeId = prevEdgeId;
        dist += prevEdge.length;
        hIndex++;
      }
    } else {
      // 反向行驶：领头车厢是低 position 端,跨过 fromNode 后应在"motion 方向上的下一条边"
      // 这条边由当前道岔状态实时决定，不能用 visitedPath（visitedPath 是身后/已经离开的边）
      let safety = 0;
      while (dist < 0 && safety < 10) {
        safety++;
        const cur = props.map.edges[edgeId];
        if (!cur) break;
        const nextId = getNextReverseEdge(edgeId);
        if (!nextId) break; // 走到入口端点了，让后续走 endpoint 虚尾分支
        const next = props.map.edges[nextId];
        if (!next) break;
        // 入边的 toNode = 当前 fromNode，所以从 toNode 一侧进入新边，继续 dir=-1
        // 反向越界距离映射到新边的 length-overflow 区间
        if (next.toNode === cur.fromNode) {
          dist = next.length + dist;
        } else if (next.fromNode === cur.fromNode) {
          dist = -dist;
        } else {
          break;
        }
        edgeId = nextId;
      }
    }
  }

  const edge = props.map.edges[edgeId];
  if (!edge) return 'scale(0)';

  if (dist < 0) {
    const startNode = props.map.nodes[edge.fromNode];
    if (startNode?.type !== 'endpoint') return 'scale(0)';
  } else if (dist > edge.length) {
    return 'scale(0)';
  }

  const len = edge.length || 1;
  const t = dist / len;
  const start = getNode(edge.fromNode);
  const end = getNode(edge.toNode);

  if (edge.control1 && edge.control2) {
    const pos = cubicBezier(t, start, edge.control1, edge.control2, end);
    const angle = cubicBezierAngle(t, start, edge.control1, edge.control2, end);
    return `translate(${pos.x}, ${pos.y}) rotate(${angle})`;
  }

  const x = start.x + (end.x - start.x) * t;
  const y = start.y + (end.y - start.y) * t;
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  return `translate(${x}, ${y}) rotate(${angle})`;
}
</script>

<template>
  <div class="canvas-container">
    <svg class="rail-canvas" viewBox="0 0 2400 600" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="active-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Layer 0: Platforms -->
      <g class="platforms">
        <g v-for="plat in map.platforms" :key="plat.id">
          <rect
            class="platform-rect"
            :x="plat.rect.x"
            :y="plat.rect.y"
            :width="plat.rect.w"
            :height="plat.rect.h"
            rx="2"
          />
          <text
            class="platform-num"
            :x="plat.rect.x + 12"
            :y="plat.rect.y + plat.rect.h / 2 + 4"
          >
            {{ plat.label.split(' ')[0] }}
          </text>
          <text
            class="platform-label"
            :x="plat.rect.x + 32"
            :y="plat.rect.y + plat.rect.h / 2 + 4"
          >
            {{ plat.label.split(' ').slice(1).join(' ') }}
          </text>
        </g>
      </g>

      <!-- Layer 1: Track bed -->
      <g class="track-beds">
        <path
          v-for="edge in safeEdges"
          :key="`bed-${edge.id}`"
          class="track-base"
          :d="getEdgePath(edge)"
        />
      </g>

      <!-- Layer 2: Rails -->
      <g class="rails">
        <path
          v-for="edge in safeEdges"
          :key="`rail-${edge.id}`"
          class="track-rail"
          :d="getEdgePath(edge)"
        />
      </g>

      <!-- Layer 3: Active switch highlights -->
      <g class="switch-highlights">
        <template v-for="node in safeNodes" :key="`hl-${node.id}`">
          <path
            v-if="node.type === 'switch' && getActiveEdge(node)"
            class="track-rail active"
            :d="getEdgePath(getActiveEdge(node)!)"
          />
        </template>
      </g>

      <!-- Layer 4: Buffer stops -->
      <g class="buffers">
        <g
          v-for="node in safeNodes.filter((n) => n.type === 'buffer_stop')"
          :key="`buf-${node.id}`"
          class="buffer-stop"
          :transform="`translate(${node.x}, ${node.y})`"
        >
          <path d="M0 -14 L0 14 M4 -14 L4 14 M8 -10 L8 10" />
        </g>
      </g>

      <!-- Layer 5: Switches -->
      <g class="switches">
        <g
          v-for="node in safeNodes.filter((n) => n.type === 'switch')"
          :key="`sw-${node.id}`"
          class="switch-node"
          :transform="`translate(${node.x}, ${node.y})`"
          @click.stop="toggleSwitch(node)"
        >
          <circle r="30" fill="rgba(0,0,0,0)" />
          <circle class="ring" r="14" />
          <circle r="4" fill="var(--accent)" />
          <text class="idx" y="-22">SW · S{{ (node.switchState ?? 0) + 1 }}</text>
          <g v-if="keyboardMode && switchKbMap[node.id]" class="kb-label" transform="translate(22, -18)">
            <rect x="-11" y="-10" width="22" height="20" rx="2" />
            <text>{{ switchKbMap[node.id] }}</text>
          </g>
        </g>
      </g>

      <!-- Layer 6: Signals -->
      <g class="signals">
        <g
          v-for="node in safeNodes.filter((n) => n.signalState !== undefined)"
          :key="`sig-${node.id}`"
          :class="['signal', node.signalState]"
          :transform="`translate(${node.x}, ${node.y - 40})`"
          @click.stop="toggleSignal(node)"
        >
          <rect x="-14" y="-30" width="28" height="50" fill="rgba(0,0,0,0)" />
          <line class="pole" x1="0" y1="0" x2="0" y2="40" />
          <rect class="box" x="-8" y="-18" width="16" height="18" rx="2" />
          <circle class="lamp" cx="0" cy="-9" r="5" />
          <g
            v-if="keyboardMode && signalKbMap[node.id]"
            class="kb-label"
            transform="translate(18, -27)"
          >
            <rect x="-11" y="-10" width="22" height="20" rx="2" />
            <text>{{ signalKbMap[node.id] }}</text>
          </g>
        </g>
      </g>

      <!-- Layer 7: Trains -->
      <g class="trains-layer">
        <template v-for="train in trains" :key="train.id">
          <foreignObject
            v-for="i in train.isCoupled ? 16 : 8"
            :key="`${train.id}-c${i}`"
            width="28"
            height="14"
            x="-14"
            y="-7"
            :transform="getCarTransform(train, i - 1)"
            style="overflow: visible"
          >
            <div
              :class="[
                'car',
                train.modelType,
                {
                  'first-car': i === 1,
                  'last-car': i === (train.isCoupled ? 16 : 8),
                  'is-selected': selectedTrainId === train.id,
                  'is-boarding': train.passengerState === 'BOARDING',
                },
              ]"
              xmlns="http://www.w3.org/1999/xhtml"
              @click.stop="emit('select', train.id)"
            >
              <div class="stripe" />
              <div class="windows" />
              <div v-if="i === 1" class="train-label-float">{{ train.id }}</div>
            </div>
          </foreignObject>

          <!-- 通过式发车：按钮贴在车头右侧，箭头朝右 -->
          <foreignObject
            v-if="train.passengerState === 'READY' && !willReverseDepart(train)"
            :key="`${train.id}-depart-fwd`"
            width="60"
            height="22"
            x="14"
            y="-30"
            :transform="getCarTransform(train, 0)"
            style="overflow: visible"
          >
            <button
              class="depart-btn-in-scene"
              xmlns="http://www.w3.org/1999/xhtml"
              @click.stop="emit('train-action', { id: train.id, action: 'DEPART' })"
            >
              发车 →
            </button>
          </foreignObject>
          <!-- 终端折返发车：按钮贴在车尾(新车头)左侧，箭头朝左 -->
          <foreignObject
            v-if="train.passengerState === 'READY' && willReverseDepart(train)"
            :key="`${train.id}-depart-rev`"
            width="60"
            height="22"
            x="-74"
            y="-30"
            :transform="getCarTransform(train, train.isCoupled ? 15 : 7)"
            style="overflow: visible"
          >
            <button
              class="depart-btn-in-scene reverse"
              xmlns="http://www.w3.org/1999/xhtml"
              @click.stop="emit('train-action', { id: train.id, action: 'DEPART' })"
            >
              ← 折返
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
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rail-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* --- Tracks --- */
.track-base {
  stroke: #2a2a2f;
  stroke-width: 8;
  fill: none;
  stroke-linecap: round;
}
.track-rail {
  stroke: #6a6a70;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
}
.track-rail.active {
  stroke: var(--accent);
  stroke-width: 3;
  filter: drop-shadow(0 0 4px rgba(189, 243, 127, 0.6));
}

/* --- Platforms --- */
.platform-rect {
  fill: #1a1918;
  stroke: #3a3935;
  stroke-width: 1;
}
.platform-label {
  fill: var(--fg-sec);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
}
.platform-num {
  fill: var(--fg);
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
}

/* --- Switches --- */
.switch-node {
  cursor: pointer;
}
.switch-node .ring {
  fill: #0a0a0a;
  stroke: var(--fg-sec);
  stroke-width: 1.5;
  transition: stroke 160ms var(--ease);
}
.switch-node:hover .ring {
  stroke: var(--accent);
}
.switch-node text.idx {
  fill: var(--accent);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
}

/* --- Signals --- */
.signal {
  cursor: pointer;
}
.signal .pole {
  stroke: var(--fg-ter);
  stroke-width: 1.5;
}
.signal .box {
  fill: #151515;
  stroke: var(--fg-ter);
  stroke-width: 1;
}
.signal .lamp {
  transition: fill 200ms var(--ease);
  fill: var(--sig-green);
  filter: drop-shadow(0 0 6px var(--sig-green));
}
.signal.red .lamp {
  fill: var(--sig-red);
  filter: drop-shadow(0 0 6px var(--sig-red));
}
.signal:hover .box {
  stroke: var(--accent);
}

/* --- Buffer stops --- */
.buffer-stop path {
  stroke: var(--sig-amber);
  stroke-width: 2;
  fill: none;
}

/* --- Keyboard label badges --- */
.kb-label {
  pointer-events: none;
}
.kb-label rect {
  fill: rgba(10, 10, 10, 0.88);
  stroke: var(--accent);
  stroke-width: 1;
}
.kb-label text {
  fill: var(--accent);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  letter-spacing: 0.04em;
}

/* --- Train cars --- */
.car {
  width: 100%;
  height: 100%;
  position: relative;
  border-radius: 1px;
  overflow: hidden;
  box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  background: var(--t-af);
}
.car.first-car {
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}
.car.last-car {
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}
.car .stripe {
  position: absolute;
  top: 65%;
  height: 14%;
  width: 100%;
  background: var(--accent);
}
.car .windows {
  position: absolute;
  top: 18%;
  height: 28%;
  width: 80%;
  left: 10%;
  background: #0a0a0a;
  opacity: 0.85;
  border-radius: 1px;
}

.car.is-selected {
  outline: 2px dashed var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 8px rgba(189, 243, 127, 0.5);
}
.car.is-boarding {
  animation: car-boarding 1.6s ease-in-out infinite;
}
@keyframes car-boarding {
  0%,
  100% {
    box-shadow: 0 0 0 1px rgba(240, 194, 76, 0.3);
  }
  50% {
    box-shadow: 0 0 8px 2px rgba(240, 194, 76, 0.55);
  }
}

.train-label-float {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--fg);
  background: rgba(10, 10, 10, 0.72);
  padding: 1px 6px;
  border-radius: 2px;
  white-space: nowrap;
  pointer-events: none;
  letter-spacing: 0.04em;
}

/* Per-model train colors */
.car.CR400AF {
  background: var(--t-af);
}
.car.CR400AF .stripe {
  background: #d94a4a;
}
.car.CR400BF {
  background: #e8eef5;
}
.car.CR400BF .stripe {
  background: var(--t-bf);
}
.car.CRH380A {
  background: #f0e6d0;
}
.car.CRH380A .stripe {
  background: var(--t-380);
}

.depart-btn-in-scene {
  background: var(--accent);
  color: var(--fg-dark);
  border: none;
  border-radius: 2px;
  padding: 4px 8px;
  font-family: var(--ui);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  transition: background 160ms var(--ease);
}
.depart-btn-in-scene:hover {
  background: var(--accent-hov);
}
.depart-btn-in-scene:active {
  background: var(--accent-press);
}
/* 折返发车：用琥珀色和直行发车区分 */
.depart-btn-in-scene.reverse {
  background: var(--sig-amber);
}
.depart-btn-in-scene.reverse:hover {
  background: #ffd066;
}
.depart-btn-in-scene.reverse:active {
  background: #d9a533;
}
</style>

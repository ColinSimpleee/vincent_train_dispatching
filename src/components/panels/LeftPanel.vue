<script setup lang="ts">
import { computed } from 'vue';
import type { TrainPhysics, TrainModel } from '../../core/RailGraph';

// Type for trains in the waiting queue
interface QueuedTrain {
  id: string;
  schedule: { arriveTick: number };
  model: TrainModel;
}

const props = defineProps<{
  queue: QueuedTrain[]; // Waiting trains
  trains: TrainPhysics[]; // Active trains on map
  onSelect: (id: string) => void;
  selectedId: string | null;
  gameStartTime?: { hours: number; minutes: number; seconds: number };
  currentTick?: number;
}>();

// Convert tick to HH:MM:SS format
function tickToTime(tick: number): string {
  const TICKS_PER_SECOND = 60;
  const startTime = props.gameStartTime || { hours: 8, minutes: 0, seconds: 0 };
  
  const totalGameSeconds = Math.floor(tick / TICKS_PER_SECOND);
  
  let hours = startTime.hours;
  let minutes = startTime.minutes;
  let seconds = startTime.seconds + totalGameSeconds;
  
  minutes += Math.floor(seconds / 60);
  seconds = seconds % 60;
  
  hours += Math.floor(minutes / 60);
  minutes = minutes % 60;
  
  hours = hours % 24;
  
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

interface TrainStatusInfo {
  status: string;
  statusColor: string;
  location: string;
  estimatedTime: string;
  timeLabel: string;
  punctuality: { text: string; color: string; minutes: number };
}

const DEFAULT_PUNCTUALITY = { text: '准点', color: '#f1c40f', minutes: 0 };

function isEnteringEdge(edgeId: string): boolean {
  return edgeId.includes('entry') ||
         edgeId.includes('_L_t') ||
         edgeId.includes('_R_t') ||
         edgeId.includes('e_L_') ||
         edgeId.includes('e_R_');
}

function isExitingEdge(edgeId: string): boolean {
  return edgeId.includes('exit') || edgeId.includes('out');
}

function isPlatformEdge(edgeId: string): boolean {
  return /t\d+/.test(edgeId);
}

function getStatusForQueuedTrain(queueTrain: QueuedTrain): TrainStatusInfo {
  const arriveTick = queueTrain.schedule?.arriveTick ?? 0;
  return {
    status: '等待进站',
    statusColor: '#f39c12',
    location: '等待区',
    estimatedTime: tickToTime(arriveTick),
    timeLabel: '预计进站',
    punctuality: getPunctuality(arriveTick)
  };
}

function getStatusForActiveTrain(train: TrainPhysics): TrainStatusInfo {
  const edgeId = train.currentEdgeId || '';
  const isMoving = train.state === 'moving' || train.speed > 0;
  const isAtPlatform = train.passengerState === 'BOARDING' ||
                       (train.state === 'stopped' && isPlatformEdge(edgeId));

  if (isAtPlatform) {
    return {
      status: '停站中',
      statusColor: '#e74c3c',
      location: getTrainLocation(train),
      estimatedTime: estimateDepartureTime(train),
      timeLabel: '预计出站',
      punctuality: getPunctuality(0)
    };
  }

  if (isMoving) {
    if (isEnteringEdge(edgeId)) {
      return {
        status: '正在进站',
        statusColor: '#3498db',
        location: getTrainLocation(train),
        estimatedTime: estimateArrivalTime(),
        timeLabel: '预计进站',
        punctuality: getPunctuality(0)
      };
    }
    if (isExitingEdge(edgeId)) {
      return {
        status: '正在出站',
        statusColor: '#2ecc71',
        location: getTrainLocation(train),
        estimatedTime: estimateArrivalTime(),
        timeLabel: '预计出站',
        punctuality: getPunctuality(0)
      };
    }
    return {
      status: '运行中',
      statusColor: '#3498db',
      location: getTrainLocation(train),
      estimatedTime: estimateArrivalTime(),
      timeLabel: '预计到达',
      punctuality: getPunctuality(0)
    };
  }

  if (train.state === 'stopped') {
    return {
      status: '停车',
      statusColor: '#e67e22',
      location: getTrainLocation(train),
      estimatedTime: tickToTime(props.currentTick || 0),
      timeLabel: '当前时间',
      punctuality: DEFAULT_PUNCTUALITY
    };
  }

  return getDefaultStatus();
}

function getDefaultStatus(): TrainStatusInfo {
  return {
    status: '待命',
    statusColor: '#95a5a6',
    location: '-',
    estimatedTime: '--:--:--',
    timeLabel: '-',
    punctuality: DEFAULT_PUNCTUALITY
  };
}

function getTrainStatus(trainId: string): TrainStatusInfo {
  const activeTrain = props.trains?.find(t => t.id === trainId);
  const queueTrain = props.queue?.find(q => q.id === trainId);

  if (!activeTrain && queueTrain) {
    return getStatusForQueuedTrain(queueTrain);
  }

  if (activeTrain) {
    return getStatusForActiveTrain(activeTrain);
  }

  return getDefaultStatus();
}

// Get train location description
function getTrainLocation(train: TrainPhysics): string {
  const edge = train.currentEdgeId;
  if (edge.includes('entry')) return '进站线路';
  if (edge.includes('exit')) return '出站线路';
  if (edge.match(/t\d+/)) {
    const match = edge.match(/t(\d+)/);
    return match ? `${match[1]}站台` : '站台';
  }
  return '线路中';
}

// Estimate arrival time (simplified)
function estimateArrivalTime(): string {
  // Simplified: just show current time + 1 minute
  const currentTick = props.currentTick ?? 0;
  return tickToTime(currentTick + 3600); // +1 minute
}

// Estimate departure time
function estimateDepartureTime(train: TrainPhysics): string {
  const currentTick = props.currentTick || 0;
  // User req: Arrival + Stop + Buffer
  if (train.arrivalTick && train.stopDuration && train.stopBuffer) {
      return tickToTime(train.arrivalTick + train.stopDuration + train.stopBuffer);
  }
  // Fallback
  const remainingTicks = train.boardingTimer || 0;
  return tickToTime(currentTick + remainingTicks + 3600);
}

// Get punctuality status
function getPunctuality(scheduledTick: number) {
  const currentTick = props.currentTick || 0;
  const diffTicks = currentTick - scheduledTick;
  const diffMinutes = Math.floor(diffTicks / 3600); // 3600 ticks = 1 minute
  
  if (diffMinutes < -1) {
    // Early
    return {
      text: `早点 ${Math.abs(diffMinutes)}'`,
      color: '#2ecc71', // Green
      minutes: diffMinutes
    };
  } else if (diffMinutes > 1) {
    // Late
    return {
      text: `晚点 ${diffMinutes}'`,
      color: '#e74c3c', // Red
      minutes: diffMinutes
    };
  } else {
    // On time
    return {
      text: '准点',
      color: '#f1c40f', // Yellow
      minutes: 0
    };
  }
}

// Combine all trains (queue + active)
const allTrains = computed(() => {
  const queueIds = (props.queue || []).map(q => q?.id).filter(Boolean);
  const activeIds = (props.trains || [])
      .filter(t => t?.id && !t.isHandedOver)
      .map(t => t.id);

  const uniqueIds = new Set([...queueIds, ...activeIds]);

  return Array.from(uniqueIds).map(id => ({
    id,
    ...getTrainStatus(id)
  }));
});
</script>

<template>
  <div class="panel-left">
    <h3>列车状态</h3>
    <div class="list-container">
       <div 
         v-for="item in allTrains" 
         :key="item.id"
         class="queue-item"
         :class="{ active: selectedId === item.id }"
         @click="onSelect(item.id)"
       >
         <div class="item-header">
           <div class="train-info">
             <span class="train-id">{{ item.id }}</span>
             <span class="train-location">({{ item.location }})</span>
           </div>
           <span class="status-badge" :style="{ background: item.statusColor }">
             {{ item.status }}
           </span>
         </div>
         <div class="item-meta">
            <span class="punctuality" :style="{ color: item.punctuality.color }">
              {{ item.punctuality.text }}
            </span>
            <span class="time-info">
              {{ item.timeLabel }}: {{ item.estimatedTime }}
            </span>
         </div>
       </div>
    </div>
  </div>
</template>

<style scoped>
.panel-left {
  background: #1e1e1e;
  color: #ecf0f1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
  height: 100%;
}

h3 {
  padding: 15px;
  margin: 0;
  background: #252525;
  border-bottom: 3px solid #3498db;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.list-container {
  overflow-y: auto;
  flex: 1;
  padding: 10px;
}

.queue-item {
  background: #2c3e50;
  margin-bottom: 8px;
  padding: 10px;
  border-radius: 4px;
  cursor: pointer;
  border-left: 4px solid transparent;
  transition: all 0.2s;
}

.queue-item:hover {
  background: #34495e;
}

.queue-item.active {
  background: #34495e;
  border-left-color: #f1c40f;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.train-info {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.train-id {
  font-family: 'Consolas', monospace;
  font-weight: bold;
  font-size: 16px;
  color: #fff;
}

.train-location {
  font-size: 11px;
  color: #95a5a6;
}

.status-badge {
  color: black;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 3px;
  font-weight: bold;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  gap: 8px;
}

.punctuality {
  font-weight: bold;
  white-space: nowrap;
}

.time-info {
  color: #95a5a6;
  text-align: right;
  flex: 1;
}
</style>

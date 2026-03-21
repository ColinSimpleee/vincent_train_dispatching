<script setup lang="ts">
import { computed } from 'vue';
import type { TrainPhysics } from '../../core/RailGraph';
import type { ScheduleEntry, DelaySpread } from '../../core/types';
import type { ScheduleManager } from '../../core/ScheduleManager';
import { tickToTime as tickToTimeUtil } from '../../core/utils';

const props = defineProps<{
  queue: ScheduleEntry[];
  trains: TrainPhysics[];
  scheduleManager: ScheduleManager | null;
  onSelect: (id: string) => void;
  selectedId: string | null;
  gameStartTime?: { hours: number; minutes: number; seconds: number };
  currentTick?: number;
}>();

function tickToTime(tick: number): string {
  const startTime = props.gameStartTime || { hours: 8, minutes: 0, seconds: 0 };
  return tickToTimeUtil(tick, startTime);
}

interface PunctualityInfo {
  text: string;
  color: string;
  minutes: number;
  isDurationMode: boolean; // true = show "预计x分钟后出站", false = show punctuality
}

interface TrainStatusInfo {
  status: string;
  statusColor: string;
  location: string;
  estimatedTime: string;
  timeLabel: string;
  punctuality: PunctualityInfo;
}

const TICKS_PER_GAME_SECOND = 60;
const TICKS_PER_GAME_MINUTE = TICKS_PER_GAME_SECOND * 60;
const DEPARTURE_BUFFER_TICKS = 90 * TICKS_PER_GAME_SECOND; // 90 game-seconds

const DEFAULT_PUNCTUALITY: PunctualityInfo = { text: '准点', color: '#f1c40f', minutes: 0, isDurationMode: false };

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
  return /^t\d+$/.test(edgeId);
}

function getStatusForQueuedTrain(queueTrain: ScheduleEntry): TrainStatusInfo {
  const arriveTick = queueTrain.scheduledArriveTick ?? 0;
  return {
    status: '等待进站',
    statusColor: '#f39c12',
    location: '等待区',
    estimatedTime: tickToTime(arriveTick),
    timeLabel: '预计进站',
    punctuality: getPunctuality(arriveTick)
  };
}

function getMinutesUntilDeparture(train: TrainPhysics): number {
  const currentTick = props.currentTick ?? 0;
  const arrivalTick = train.arrivalTick ?? currentTick;
  const stopDuration = train.stopDuration ?? 0;
  const stopBuffer = train.stopBuffer ?? 0;
  const remainingTicks = (arrivalTick + stopDuration + stopBuffer) - currentTick;
  return Math.max(0, Math.ceil(remainingTicks / TICKS_PER_GAME_MINUTE));
}

function getDeparturePunctuality(train: TrainPhysics): PunctualityInfo {
  const currentTick = props.currentTick ?? 0;
  const scheduledArriveTick = train.scheduledArriveTick ?? 0;
  const stopDuration = train.stopDuration ?? 0;
  // Scheduled departure = scheduled arrive + stop duration + 90 game-seconds
  const scheduledDepartureTick = scheduledArriveTick + stopDuration + DEPARTURE_BUFFER_TICKS;
  const diffTicks = currentTick - scheduledDepartureTick;
  const diffMinutes = Math.round(diffTicks / TICKS_PER_GAME_MINUTE);

  if (diffMinutes < -1) {
    return { text: `早点 ${Math.abs(diffMinutes)}'`, color: '#2ecc71', minutes: diffMinutes, isDurationMode: false };
  }
  if (diffMinutes > 1) {
    return { text: `晚点 ${diffMinutes}'`, color: '#e74c3c', minutes: diffMinutes, isDurationMode: false };
  }
  return { text: '准点', color: '#f1c40f', minutes: 0, isDurationMode: false };
}

function getDurationPunctuality(train: TrainPhysics): PunctualityInfo {
  // 列车尚未到达站台（arrivalTick 未设置），不显示出站倒计时
  if (!train.arrivalTick) {
    return { text: '进站中...', color: '#3498db', minutes: 0, isDurationMode: true };
  }
  const minutes = getMinutesUntilDeparture(train);
  const text = minutes <= 0 ? '即将出站' : `预计${minutes}分钟后出站`;
  return { text, color: '#3498db', minutes, isDurationMode: true };
}

function getStatusForActiveTrain(train: TrainPhysics): TrainStatusInfo {
  const edgeId = train.currentEdgeId || '';
  const isMoving = train.state === 'moving' || train.speed > 0;
  const isAtPlatform = train.passengerState === 'BOARDING' ||
                       (train.state === 'stopped' && isPlatformEdge(edgeId));

  // 可以出站：上客完成，准备出发 → 显示真实准点情况
  if (train.passengerState === 'READY' && train.state === 'stopped' && isPlatformEdge(edgeId)) {
    return {
      status: '可以出站',
      statusColor: '#2ecc71',
      location: getTrainLocation(train),
      estimatedTime: getScheduledDepartTime(train),
      timeLabel: '预计出站',
      punctuality: getDeparturePunctuality(train)
    };
  }

  // 停站中（上客中）→ 显示"预计x分钟后出站"
  if (isAtPlatform) {
    return {
      status: '停站中',
      statusColor: '#e74c3c',
      location: getTrainLocation(train),
      estimatedTime: getScheduledDepartTime(train),
      timeLabel: '预计出站',
      punctuality: getDurationPunctuality(train)
    };
  }

  if (isMoving) {
    // 正在进站
    if (isEnteringEdge(edgeId)) {
      return {
        status: '正在进站',
        statusColor: '#3498db',
        location: getTrainLocation(train),
        estimatedTime: getScheduledArriveTime(train),
        timeLabel: '预计进站',
        punctuality: getDurationPunctuality(train)
      };
    }
    if (isExitingEdge(edgeId)) {
      return {
        status: '正在出站',
        statusColor: '#2ecc71',
        location: getTrainLocation(train),
        estimatedTime: getScheduledDepartTime(train),
        timeLabel: '预计出站',
        punctuality: DEFAULT_PUNCTUALITY
      };
    }
    return {
      status: '运行中',
      statusColor: '#3498db',
      location: getTrainLocation(train),
      estimatedTime: getScheduledArriveTime(train),
      timeLabel: '预计到达',
      punctuality: DEFAULT_PUNCTUALITY
    };
  }

  if (train.state === 'stopped') {
    return {
      status: '停车',
      statusColor: '#e67e22',
      location: getTrainLocation(train),
      estimatedTime: tickToTime(props.currentTick ?? 0),
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
  const platformMatch = edge.match(/^t(\d+)$/);
  if (platformMatch) {
    return `${platformMatch[1]}站台`;
  }
  return '线路中';
}

// 从时刻表获取计划到站时间（静态）
function getScheduledArriveTime(train: TrainPhysics): string {
  if (train.scheduledArriveTick != null) {
    return tickToTime(train.scheduledArriveTick);
  }
  return '--:--:--';
}

// 从时刻表获取计划出站时间（静态）
function getScheduledDepartTime(train: TrainPhysics): string {
  const entry = props.scheduleManager?.getEntryById(train.scheduleEntryId ?? train.id);
  if (entry) {
    return tickToTime(entry.scheduledDepartTick);
  }
  // 回退：用列车自身的计划到站 + 停站时长
  if (train.scheduledArriveTick != null && train.stopDuration != null) {
    const buffer = train.stopBuffer ?? 0;
    return tickToTime(train.scheduledArriveTick + train.stopDuration + buffer);
  }
  return '--:--:--';
}

// Get punctuality status for queued trains (compared to scheduled arrive tick)
function getPunctuality(scheduledTick: number): PunctualityInfo {
  const currentTick = props.currentTick ?? 0;
  const diffTicks = currentTick - scheduledTick;
  const diffMinutes = Math.floor(diffTicks / TICKS_PER_GAME_MINUTE);

  if (diffMinutes < -1) {
    return { text: `早点 ${Math.abs(diffMinutes)}'`, color: '#2ecc71', minutes: diffMinutes, isDurationMode: false };
  }
  if (diffMinutes > 1) {
    return { text: `晚点 ${diffMinutes}'`, color: '#e74c3c', minutes: diffMinutes, isDurationMode: false };
  }
  return { text: '准点', color: '#f1c40f', minutes: 0, isDurationMode: false };
}

function getDelaySpread(trainId: string): DelaySpread | null {
  if (!props.scheduleManager) return null;
  const entry = props.scheduleManager.getEntryById(trainId);
  if (!entry || entry.status === 'upcoming') return null;
  return props.scheduleManager.computeDelaySpread(entry, props.currentTick ?? 0);
}

function formatSpreadDelta(spread: DelaySpread): string {
  const minutes = Math.floor(Math.abs(spread.delta) / 3600);
  if (spread.level === 'improved') return `-${minutes}'`;
  if (spread.level === 'worsened') return `+${minutes}'`;
  return '';
}

function getSpreadColor(spread: DelaySpread): string {
  if (spread.level === 'improved') return '#2ecc71';
  if (spread.level === 'worsened') return '#e74c3c';
  return '#f1c40f';
}

function getSpreadTriangle(spread: DelaySpread): string {
  if (spread.level === 'worsened') return '▼';
  return '▲';
}

// Combine all trains (queue + active)
const allTrains = computed(() => {
  const queueIds = (props.queue || []).map(q => q?.id).filter(Boolean);
  const activeIds = (props.trains || [])
      .filter(t => t?.id && !t.isHandedOver)
      .map(t => t.id);

  const uniqueIds = new Set([...queueIds, ...activeIds]);

  const items = Array.from(uniqueIds).map(id => ({
    id,
    ...getTrainStatus(id),
    delaySpread: getDelaySpread(id)
  }));

  // 按晚点增量降序排序：恶化最多的排最前
  items.sort((a, b) => {
    const deltaA = a.delaySpread?.delta ?? -Infinity;
    const deltaB = b.delaySpread?.delta ?? -Infinity;
    return deltaB - deltaA;
  });

  return items;
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
             <span
               class="punctuality"
               :class="{ 'punctuality--duration': item.punctuality.isDurationMode }"
               :style="{ color: item.punctuality.color }"
             >
               {{ item.punctuality.text }}
             </span>
             <span
               v-if="item.delaySpread"
               class="delay-spread"
               :style="{ color: getSpreadColor(item.delaySpread) }"
             >
               {{ getSpreadTriangle(item.delaySpread) }}{{ formatSpreadDelta(item.delaySpread) }}
             </span>
             <span v-if="!item.punctuality.isDurationMode" class="time-info">
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

.punctuality--duration {
  font-size: 10px;
  font-weight: normal;
  opacity: 0.9;
}

.time-info {
  color: #95a5a6;
  text-align: right;
  flex: 1;
}

.delay-spread {
  font-weight: bold;
  font-size: 11px;
  margin-left: 4px;
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type { TrainPhysics } from '../../core/RailGraph';
import type { ScheduleEntry, DelaySpread } from '../../core/types';
import type { ScheduleManager } from '../../core/ScheduleManager';
import { tickToTime as tickToTimeUtil } from '../../core/utils';

type StatusKey =
  | 'waiting'
  | 'arriving'
  | 'boarding'
  | 'ready'
  | 'departing'
  | 'running'
  | 'stopped';

const STATUS_ZH: Record<StatusKey, string> = {
  waiting: '等待进站',
  arriving: '正在进站',
  boarding: '停站中',
  ready: '可以出站',
  departing: '正在出站',
  running: '运行中',
  stopped: '停车',
};

interface DelayInfo {
  text: string;
  cls: 'early' | 'ontime' | 'late';
}

interface SpreadInfo {
  text: string;
  cls: 'improved' | 'neutral' | 'worsened';
  delta: number;
}

interface RowItem {
  id: string;
  statusKey: StatusKey;
  loc: string;
  eta: string;
  delay: DelayInfo;
  spread: SpreadInfo | null;
}

const props = defineProps<{
  queue: ScheduleEntry[];
  trains: TrainPhysics[];
  scheduleManager: ScheduleManager | null;
  selectedId: string | null;
  gameStartTime?: { hours: number; minutes: number; seconds: number };
  currentTick?: number;
}>();

defineEmits<{
  (e: 'select', id: string): void;
}>();

const TICKS_PER_MIN = 3600;
const DEPARTURE_BUFFER_TICKS = 90 * 60;

function tickToTime(tick: number): string {
  const startTime = props.gameStartTime ?? { hours: 8, minutes: 0, seconds: 0 };
  return tickToTimeUtil(tick, startTime);
}

function tickToHHMM(tick: number): string {
  return tickToTime(tick).slice(0, 5);
}

function isEnteringEdge(edgeId: string): boolean {
  return (
    edgeId.includes('entry') ||
    edgeId.includes('_L_t') ||
    edgeId.includes('_R_t') ||
    edgeId.startsWith('e_L_') ||
    edgeId.startsWith('e_R_') ||
    edgeId === 'e_in'
  );
}

function isExitingEdge(edgeId: string): boolean {
  return edgeId.endsWith('_out') || edgeId.includes('exit') || edgeId === 'e_out';
}

function isPlatformEdge(edgeId: string): boolean {
  return /^t\d+$/.test(edgeId);
}

function getTrainLoc(train: TrainPhysics): string {
  const edge = train.currentEdgeId;
  const m = edge.match(/^t(\d+)$/);
  if (m) return `${m[1]} 站台`;
  if (isEnteringEdge(edge)) return '进站线路';
  if (isExitingEdge(edge)) return '出站线路';
  return '线路中';
}

function inferStatusKey(train: TrainPhysics): StatusKey {
  const edge = train.currentEdgeId;
  const onPlatform = isPlatformEdge(edge);

  if (train.passengerState === 'READY' && train.state === 'stopped' && onPlatform) {
    return 'ready';
  }
  if (train.passengerState === 'BOARDING' || (train.state === 'stopped' && onPlatform)) {
    return 'boarding';
  }
  if (train.state === 'stopped') return 'stopped';
  if (isExitingEdge(edge)) return 'departing';
  if (isEnteringEdge(edge)) return 'arriving';
  return 'running';
}

function classifyDelay(diffMin: number): DelayInfo {
  if (diffMin <= -2) return { text: `早点 ${Math.abs(diffMin)}'`, cls: 'early' };
  if (diffMin >= 2) return { text: `晚点 ${diffMin}'`, cls: 'late' };
  return { text: '准点', cls: 'ontime' };
}

function getQueuedDelay(entry: ScheduleEntry): DelayInfo {
  const cur = props.currentTick ?? 0;
  const diff = Math.floor((cur - entry.scheduledArriveTick) / TICKS_PER_MIN);
  return classifyDelay(diff);
}

function getActiveDelay(train: TrainPhysics): DelayInfo {
  const cur = props.currentTick ?? 0;
  const sa = train.scheduledArriveTick ?? cur;
  const stopDur = train.stopDuration ?? 0;
  const schedDep = sa + stopDur + DEPARTURE_BUFFER_TICKS;
  const diff = Math.round((cur - schedDep) / TICKS_PER_MIN);
  return classifyDelay(diff);
}

function getEta(train: TrainPhysics, statusKey: StatusKey): string {
  if (statusKey === 'arriving' || statusKey === 'running') {
    return train.scheduledArriveTick != null ? tickToHHMM(train.scheduledArriveTick) : '—';
  }
  // boarding/ready/departing → scheduled departure
  const entry = props.scheduleManager?.getEntryById(train.scheduleEntryId ?? train.id);
  if (entry) return tickToHHMM(entry.scheduledDepartTick);
  if (train.scheduledArriveTick != null && train.stopDuration != null) {
    return tickToHHMM(train.scheduledArriveTick + train.stopDuration + (train.stopBuffer ?? 0));
  }
  return '—';
}

function getSpread(id: string): SpreadInfo | null {
  if (!props.scheduleManager) return null;
  const entry = props.scheduleManager.getEntryById(id);
  if (!entry || entry.status === 'upcoming') return null;
  const spread = props.scheduleManager.computeDelaySpread(entry, props.currentTick ?? 0) as DelaySpread;
  const minutes = Math.floor(Math.abs(spread.delta) / TICKS_PER_MIN);
  if (spread.level === 'improved') {
    return { text: `▲ ${minutes}'`, cls: 'improved', delta: spread.delta };
  }
  if (spread.level === 'worsened') {
    return { text: `▼ +${minutes}'`, cls: 'worsened', delta: spread.delta };
  }
  return { text: '', cls: 'neutral', delta: 0 };
}

const rows = computed<RowItem[]>(() => {
  const queueIds = (props.queue ?? []).map((q) => q.id).filter(Boolean);
  const activeRows: RowItem[] = (props.trains ?? [])
    .filter((t) => t?.id && !t.isHandedOver)
    .map((t) => {
      const key = inferStatusKey(t);
      return {
        id: t.id,
        statusKey: key,
        loc: getTrainLoc(t),
        eta: getEta(t, key),
        delay: getActiveDelay(t),
        spread: getSpread(t.scheduleEntryId ?? t.id),
      };
    });

  const activeIdSet = new Set(activeRows.map((r) => r.id));
  const queuedRows: RowItem[] = queueIds
    .filter((id) => !activeIdSet.has(id))
    .map((id) => {
      const entry = props.queue.find((q) => q.id === id)!;
      return {
        id,
        statusKey: 'waiting' as StatusKey,
        loc: '等待区',
        eta: tickToHHMM(entry.scheduledArriveTick),
        delay: getQueuedDelay(entry),
        spread: getSpread(id),
      };
    });

  const all = [...activeRows, ...queuedRows];
  // Sort: worsened first by larger delta, then by delay severity desc
  all.sort((a, b) => {
    const sa = a.spread?.delta ?? Number.NEGATIVE_INFINITY;
    const sb = b.spread?.delta ?? Number.NEGATIVE_INFINITY;
    if (sb !== sa) return sb - sa;
    const da = a.delay.cls === 'late' ? 1 : a.delay.cls === 'early' ? -1 : 0;
    const db = b.delay.cls === 'late' ? 1 : b.delay.cls === 'early' ? -1 : 0;
    return db - da;
  });
  return all;
});
</script>

<template>
  <div class="left-panel">
    <div class="panel-head">
      <h3>调度列表 / Trains</h3>
      <span class="count">{{ rows.length }} · SORT: URGENCY</span>
    </div>

    <div v-if="rows.length === 0" class="train-list empty">
      <div>
        <div class="empty-eyebrow">NO TRAINS</div>
        <div class="empty-msg">列表为空。等待时刻表生成下一班列车。</div>
      </div>
    </div>

    <div v-else class="train-list">
      <div
        v-for="r in rows"
        :key="r.id"
        :class="['train-row', { selected: selectedId === r.id }]"
        @click="$emit('select', r.id)"
      >
        <div class="trow-top">
          <span class="trow-id">{{ r.id }}</span>
          <span :class="['trow-badge', r.statusKey]">{{ STATUS_ZH[r.statusKey] }}</span>
        </div>
        <div class="trow-bot">
          <span class="trow-loc">{{ r.loc }}</span>
          <span class="trow-meta">
            <span class="trow-eta">{{ r.eta }}</span>
            <span :class="['trow-delay', r.delay.cls]">{{ r.delay.text }}</span>
            <span v-if="r.spread && r.spread.text" :class="['trow-spread', r.spread.cls]">
              {{ r.spread.text }}
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.left-panel {
  background: var(--bg);
  border-right: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.panel-head {
  padding: 16px 18px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid var(--divider);
}
.panel-head h3 {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0;
  text-transform: uppercase;
  color: var(--fg);
}
.panel-head .count {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.08em;
}

.train-list {
  flex: 1;
  overflow-y: auto;
}
.train-list.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-ter);
  font-size: 13px;
  padding: 40px 20px;
  text-align: center;
  line-height: 1.5;
}
.empty-eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.14em;
}
.empty-msg {
  margin-top: 12px;
}

.train-row {
  padding: 12px 18px;
  border-bottom: 1px solid var(--divider);
  cursor: pointer;
  position: relative;
  transition: background 180ms var(--ease);
}
.train-row:hover {
  background: var(--bg-elev);
}
.train-row.selected {
  background: var(--bg-elev);
  box-shadow: inset 3px 0 0 var(--accent);
}
.train-row.selected::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 1px solid rgba(189, 243, 127, 0.18);
}

.trow-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.trow-id {
  font-family: var(--mono);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--fg);
}
.trow-badge {
  font-family: var(--mono);
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 2px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: var(--divider);
  color: var(--fg-sec);
}
.trow-badge.waiting {
  background: rgba(168, 167, 163, 0.16);
  color: var(--fg-sec);
}
.trow-badge.arriving {
  background: rgba(121, 180, 242, 0.18);
  color: var(--sig-blue);
}
.trow-badge.running {
  background: rgba(121, 180, 242, 0.18);
  color: var(--sig-blue);
}
.trow-badge.boarding {
  background: rgba(240, 194, 76, 0.18);
  color: var(--sig-amber);
}
.trow-badge.ready {
  background: rgba(111, 224, 122, 0.18);
  color: var(--sig-green);
}
.trow-badge.departing {
  background: rgba(189, 243, 127, 0.18);
  color: var(--accent);
}
.trow-badge.stopped {
  background: rgba(241, 91, 91, 0.18);
  color: var(--sig-red);
}

.trow-bot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.trow-loc {
  font-size: 12px;
  color: var(--fg-sec);
  letter-spacing: -0.01em;
}
.trow-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 11px;
}
.trow-eta {
  color: var(--fg-ter);
  letter-spacing: 0.04em;
}
.trow-delay {
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.trow-delay.early {
  color: var(--early);
}
.trow-delay.ontime {
  color: var(--ontime);
}
.trow-delay.late {
  color: var(--late);
}
.trow-spread {
  font-size: 10px;
  color: var(--fg-ter);
}
.trow-spread.worsened {
  color: var(--late);
}
.trow-spread.improved {
  color: var(--early);
}
</style>

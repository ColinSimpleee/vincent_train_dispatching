<script setup lang="ts">
import { computed } from 'vue';
import type { TrainPhysics } from '../../core/RailGraph';
import type { SelectedTrainDisplay, TrainAction } from '../../core/types';

const props = defineProps<{
  gameTime: string;
  selectedTrain: TrainPhysics | SelectedTrainDisplay | null;
  gameSpeed: number;
  keyboardMode: boolean;
  currentTick?: number;
  isReverseStation?: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: TrainAction): void;
  (e: 'speed-change', s: number): void;
  (e: 'export-events'): void;
}>();

const TICKS_PER_MIN = 3600;
const DEPARTURE_BUFFER_TICKS = 90 * 60;

const paused = computed(() => props.gameSpeed === 0);

const clockHM = computed(() => props.gameTime.slice(0, 5));
const clockSec = computed(() => props.gameTime.slice(6, 8));
const tickStr = computed(() => (props.currentTick ?? 0).toLocaleString());

interface ActiveTrainShape {
  id: string;
  state: string;
  modelType?: string;
  speed: number;
  currentEdgeId: string;
  scheduledArriveTick?: number;
  stopDuration?: number;
  isCoupled?: boolean;
  passengerState?: 'BOARDING' | 'READY' | undefined;
}

function isActive(t: TrainPhysics | SelectedTrainDisplay): t is TrainPhysics {
  return (t as TrainPhysics).path !== undefined;
}

const speedKmh = computed(() => {
  const t = props.selectedTrain;
  if (!t) return 0;
  return Math.round(t.speed);
});
const speedPct = computed(() => Math.min(100, (speedKmh.value / 350) * 100));

const stateLabel = computed(() => {
  const t = props.selectedTrain;
  if (!t) return '';
  if (!isActive(t)) return '等待进站';
  const train = t as ActiveTrainShape;
  if (train.passengerState === 'READY') return '可以出站';
  if (train.passengerState === 'BOARDING') return '停站中';
  if (train.state === 'stopped') return '停车';
  if (train.state === 'moving') return '运行中';
  return train.state;
});

const modelLabel = computed(() => {
  const t = props.selectedTrain;
  if (!t || !t.modelType) return '';
  const train = t as ActiveTrainShape;
  return train.isCoupled ? `${t.modelType} · 重联` : t.modelType;
});

const punctuality = computed(() => {
  const t = props.selectedTrain;
  if (!t || !isActive(t)) return { text: '—', color: 'var(--fg-ter)' };
  const train = t as ActiveTrainShape;
  const cur = props.currentTick ?? 0;
  const sa = train.scheduledArriveTick ?? cur;
  const stopDur = train.stopDuration ?? 0;
  const schedDep = sa + stopDur + DEPARTURE_BUFFER_TICKS;
  const diff = Math.round((cur - schedDep) / TICKS_PER_MIN);
  if (diff <= -2) return { text: `早点 ${Math.abs(diff)}'`, color: 'var(--early)' };
  if (diff >= 2) return { text: `晚点 ${diff}'`, color: 'var(--late)' };
  return { text: '准点', color: 'var(--ontime)' };
});

const canAdmit = computed(() => {
  const t = props.selectedTrain;
  if (!t) return false;
  return !isActive(t) && t.state === 'WAITING';
});
const canDepart = computed(() => {
  const t = props.selectedTrain;
  if (!t || !isActive(t)) return false;
  const train = t as ActiveTrainShape;
  return train.passengerState === 'READY' || train.passengerState === 'BOARDING';
});
const canStop = computed(() => {
  const t = props.selectedTrain;
  if (!t || !isActive(t)) return false;
  return (t as ActiveTrainShape).state === 'moving';
});

interface SpeedOpt {
  k: string;
  v: number;
  paused?: boolean;
}
const speedOpts: SpeedOpt[] = [
  { k: '■', v: 0, paused: true },
  { k: '1×', v: 1 },
  { k: '2×', v: 2 },
  { k: '5×', v: 5 },
  { k: '10×', v: 10 },
];

function isSpeedOn(o: SpeedOpt): boolean {
  return o.paused ? paused.value : !paused.value && props.gameSpeed === o.v;
}

function clickSpeed(o: SpeedOpt) {
  emit('speed-change', o.v);
}
</script>

<template>
  <div class="right-panel">
    <div class="big-clock">
      <div class="lbl">GAME CLOCK</div>
      <div class="t">
        <span>{{ clockHM }}</span>
        <span class="sec">:{{ clockSec }}</span>
      </div>
      <div class="sub">
        <span>TICK {{ tickStr }}</span>
        <span><b>{{ paused ? '■ PAUSED' : gameSpeed + '× RUNNING' }}</b></span>
      </div>
    </div>

    <div class="speed-row">
      <button
        v-for="o in speedOpts"
        :key="o.k"
        :class="['speed-btn', { on: isSpeedOn(o), paused: o.paused && isSpeedOn(o) }]"
        @click="clickSpeed(o)"
      >
        {{ o.k }}
      </button>
    </div>

    <div class="detail-card" v-if="selectedTrain">
      <div class="detail-eyebrow">
        <span>SELECTED TRAIN</span>
        <span class="model">{{ modelLabel }}</span>
      </div>
      <h2 class="detail-id">{{ selectedTrain.id }}</h2>

      <div class="detail-stats">
        <div class="stat">
          <div class="k">状态</div>
          <div class="v">{{ stateLabel }}</div>
        </div>
        <div class="stat">
          <div class="k">位置</div>
          <div class="v small">{{ selectedTrain.currentEdgeId || '—' }}</div>
        </div>
        <div class="stat">
          <div class="k">速度</div>
          <div class="v">{{ speedKmh }}<span class="unit">km/h</span></div>
        </div>
        <div class="stat">
          <div class="k">准点</div>
          <div class="v" :style="{ color: punctuality.color }">{{ punctuality.text }}</div>
        </div>
      </div>

      <div class="speed-bar"><div class="fill" :style="{ width: speedPct + '%' }" /></div>

      <div class="cmd-stack">
        <button class="cmd-btn admit" :disabled="!canAdmit" @click="emit('action', 'ADMIT')">
          <span>允许进站 · ADMIT</span>
          <span v-if="keyboardMode" class="kbd">TAB</span>
        </button>
        <button
          :class="['cmd-btn', 'depart', { reverse: isReverseStation }]"
          :disabled="!canDepart"
          @click="emit('action', 'DEPART')"
        >
          <span>{{ isReverseStation ? '折返发车 · REVERSE' : '发车信号 · DEPART' }}</span>
          <span v-if="keyboardMode" class="kbd">⇧G</span>
        </button>
        <button class="cmd-btn stop" :disabled="!canStop" @click="emit('action', 'STOP')">
          <span>紧急停车 · STOP</span>
          <span v-if="keyboardMode" class="kbd">⇧A</span>
        </button>
      </div>
    </div>

    <div class="detail-card" v-else>
      <div class="detail-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 7v5l3 2" />
        </svg>
        <div>
          <div class="empty-eyebrow">NO TRAIN SELECTED</div>
          <div class="empty-msg">点击画布或列表上的列车以查看详情与下达指令。</div>
        </div>
      </div>
    </div>
    <div class="export-row">
      <button class="btn-export" @click="emit('export-events')" title="导出当前局事件流为 JSON（用于复现 bug）">
        ⤓ 导出事件流
      </button>
    </div>
  </div>
</template>

<style scoped>
.export-row {
  margin-top: auto;
  padding: 8px 12px;
  border-top: 1px solid var(--divider);
}
.btn-export {
  width: 100%;
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg-sec);
  font-family: var(--mono);
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 2px;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 200ms var(--ease);
}
.btn-export:hover {
  color: var(--fg);
  border-color: var(--fg-sec);
}
.right-panel {
  background: var(--bg);
  border-left: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.big-clock {
  padding: 20px 22px;
  border-bottom: 1px solid var(--divider);
}
.big-clock .lbl {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.big-clock .t {
  font-family: var(--mono);
  font-size: 44px;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.big-clock .t .sec {
  font-size: 22px;
  color: var(--fg-sec);
}
.big-clock .sub {
  margin-top: 8px;
  font-size: 12px;
  color: var(--fg-sec);
  display: flex;
  justify-content: space-between;
}
.big-clock .sub b {
  color: var(--fg);
  font-weight: 400;
  font-family: var(--mono);
}

.speed-row {
  display: flex;
  border-bottom: 1px solid var(--divider);
}
.speed-btn {
  flex: 1;
  background: transparent;
  border: none;
  border-right: 1px solid var(--divider);
  color: var(--fg-sec);
  font-family: var(--mono);
  font-size: 13px;
  padding: 14px 0;
  letter-spacing: 0.06em;
  transition: background 160ms var(--ease), color 160ms var(--ease);
}
.speed-btn:last-child {
  border-right: none;
}
.speed-btn:hover {
  color: var(--fg);
  background: var(--bg-elev);
}
.speed-btn.on {
  color: var(--fg-dark);
  background: var(--accent);
}
.speed-btn.on.paused {
  background: var(--sig-red);
  color: var(--fg);
}

.detail-card {
  padding: 20px 22px;
  border-bottom: 1px solid var(--divider);
  flex: 1;
  overflow-y: auto;
}
.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--fg-ter);
  font-size: 13px;
  padding: 40px 20px;
  text-align: center;
  gap: 12px;
  height: 100%;
}
.detail-empty svg {
  opacity: 0.5;
}
.empty-eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--fg-ter);
}
.empty-msg {
  margin-top: 8px;
  line-height: 1.5;
}

.detail-eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
}
.detail-eyebrow .model {
  color: var(--accent);
}

.detail-id {
  font-family: var(--mono);
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  margin: 0 0 14px;
  color: var(--fg);
}

.detail-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 1px solid var(--divider);
  margin-bottom: 18px;
}
.stat {
  padding: 12px 14px;
  border-right: 1px solid var(--divider);
  border-bottom: 1px solid var(--divider);
}
.stat:nth-child(2n) {
  border-right: none;
}
.stat:nth-last-child(-n + 2) {
  border-bottom: none;
}
.stat .k {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-ter);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.stat .v {
  font-family: var(--mono);
  font-size: 18px;
  color: var(--fg);
  letter-spacing: 0.02em;
}
.stat .v.small {
  font-size: 14px;
}
.stat .v .unit {
  font-size: 11px;
  color: var(--fg-sec);
  margin-left: 3px;
}

.speed-bar {
  height: 4px;
  background: var(--bg-elev);
  border: 1px solid var(--divider);
  margin-bottom: 18px;
  position: relative;
  overflow: hidden;
}
.speed-bar .fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  transition: width 300ms var(--ease);
}

.cmd-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cmd-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px;
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg);
  font-family: var(--ui);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  border-radius: 2px;
  transition: all 180ms var(--ease);
}
.cmd-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cmd-btn:not(:disabled):hover {
  border-color: var(--fg);
}
.cmd-btn .kbd {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-ter);
  padding: 2px 6px;
  border: 1px solid var(--divider-2);
  border-radius: 2px;
  letter-spacing: 0.04em;
}
.cmd-btn.admit:not(:disabled):hover {
  border-color: var(--sig-blue);
  color: var(--sig-blue);
}
.cmd-btn.depart:not(:disabled) {
  border-color: rgba(189, 243, 127, 0.4);
  color: var(--accent);
}
.cmd-btn.depart:not(:disabled):hover {
  background: var(--accent);
  color: var(--fg-dark);
  border-color: var(--accent);
}
/* 折返发车：琥珀色，与通过式发车区分 */
.cmd-btn.depart.reverse:not(:disabled) {
  border-color: rgba(240, 194, 76, 0.5);
  color: var(--sig-amber);
}
.cmd-btn.depart.reverse:not(:disabled):hover {
  background: var(--sig-amber);
  color: var(--fg-dark);
  border-color: var(--sig-amber);
}
.cmd-btn.stop:not(:disabled) {
  border-color: rgba(241, 91, 91, 0.4);
  color: var(--sig-red);
}
.cmd-btn.stop:not(:disabled):hover {
  background: var(--sig-red);
  color: var(--fg);
  border-color: var(--sig-red);
}
</style>

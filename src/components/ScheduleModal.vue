<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ScheduleEntry, DelaySpread, DispatchLogEntry } from '../core/types';
import { SPREAD_THRESHOLD, DISPATCH_EVENT_LABELS, TICKS_PER_SECOND } from '../core/constants';
import { tickToTime } from '../core/utils';

const props = defineProps<{
  visible: boolean;
  gameTime: string;
  gameSpeed: number;
  currentTick: number;
  gameStartTime: { hours: number; minutes: number; seconds: number };
  dispatchLogs: DispatchLogEntry[];
  scheduleEntries: ScheduleEntry[];
  delaySpreadMap: Record<string, DelaySpread>;
  trainStatusMap: Record<string, string>;
  modalPage: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'speed-change', s: number): void;
  (e: 'update:modalPage', p: number): void;
}>();

function onScrimClick(event: MouseEvent) {
  if ((event.target as HTMLElement).classList.contains('modal-scrim')) {
    emit('close');
  }
}

const PAGE_SIZE = 8;
const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.scheduleEntries.length / PAGE_SIZE)),
);
const safePage = computed(() => Math.min(props.modalPage, totalPages.value - 1));
const pagedEntries = computed(() => {
  const start = safePage.value * PAGE_SIZE;
  return props.scheduleEntries.slice(start, start + PAGE_SIZE);
});

function prevPage() {
  if (safePage.value > 0) emit('update:modalPage', safePage.value - 1);
}
function nextPage() {
  if (safePage.value < totalPages.value - 1) emit('update:modalPage', safePage.value + 1);
}

const clockHM = computed(() => props.gameTime.slice(0, 5));
const clockSec = computed(() => props.gameTime.slice(6, 8));

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
const paused = computed(() => props.gameSpeed === 0);
function isSpeedOn(o: SpeedOpt) {
  return o.paused ? paused.value : !paused.value && props.gameSpeed === o.v;
}

function formatTickTime(t: number): string {
  return tickToTime(t, props.gameStartTime);
}
function formatStopDuration(ticks: number): string {
  const totalSeconds = Math.floor(ticks / TICKS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}'${String(seconds).padStart(2, '0')}`;
}
function getEntryArriveTime(entry: ScheduleEntry): { text: string; pred: boolean } {
  const effectiveTick = entry.scheduledArriveTick + entry.currentDelay;
  const pred = entry.status !== 'admitted';
  return { text: (pred ? '预计 ' : '') + formatTickTime(effectiveTick), pred };
}
function getEntryDepartTime(entry: ScheduleEntry): { text: string; pred: boolean } {
  const effectiveTick = entry.scheduledDepartTick + entry.currentDelay;
  const pred = entry.status === 'upcoming' || entry.status === 'waiting';
  return { text: (pred ? '预计 ' : '') + formatTickTime(effectiveTick), pred };
}

interface DelayCell {
  text: string;
  cls: 'early' | 'ontime' | 'late';
  spread: string;
  spreadCls: '' | 'improved' | 'worsened';
}
const delayMap = computed<Record<string, DelayCell>>(() => {
  const map: Record<string, DelayCell> = {};
  for (const entry of props.scheduleEntries) {
    const delayMin = Math.round(entry.currentDelay / (TICKS_PER_SECOND * 60));
    let cell: DelayCell;
    if (delayMin <= -1) cell = { text: `早点 ${Math.abs(delayMin)}'`, cls: 'early', spread: '', spreadCls: '' };
    else if (delayMin >= 1) cell = { text: `晚点 ${delayMin}'`, cls: 'late', spread: '', spreadCls: '' };
    else cell = { text: '准点', cls: 'ontime', spread: '', spreadCls: '' };

    const ds = props.delaySpreadMap[entry.id];
    if (ds && (entry.status === 'waiting' || entry.status === 'admitted')) {
      const dm = Math.ceil(Math.abs(ds.delta) / (TICKS_PER_SECOND * 60));
      if (ds.level === 'worsened') {
        cell.spread = `▼ +${dm}'`;
        cell.spreadCls = 'worsened';
      } else if (ds.level === 'improved') {
        cell.spread = `▲ ${dm}'`;
        cell.spreadCls = 'improved';
      }
    }
    map[entry.id] = cell;
  }
  return map;
});

const TAB_NAMES = ['调度日志', '晚点扩散警告'] as const;
const tabIdx = ref(0);
const activeTab = computed(() => TAB_NAMES[tabIdx.value]!);
function prevTab() {
  tabIdx.value = (tabIdx.value - 1 + TAB_NAMES.length) % TAB_NAMES.length;
}
function nextTab() {
  tabIdx.value = (tabIdx.value + 1) % TAB_NAMES.length;
}

const worsenedItems = computed(() => {
  return props.scheduleEntries
    .filter((e) => {
      const ds = props.delaySpreadMap[e.id];
      return ds && ds.level === 'worsened' && (e.status === 'waiting' || e.status === 'admitted');
    })
    .map((e) => {
      const ds = props.delaySpreadMap[e.id]!;
      const dm = Math.ceil(Math.abs(ds.delta) / (TICKS_PER_SECOND * 60));
      return { id: e.id, v: `+${dm}'` };
    });
});

const imminentItems = computed(() => {
  return props.scheduleEntries
    .filter((e) => {
      const ds = props.delaySpreadMap[e.id];
      return (
        ds && ds.level === 'neutral' && ds.delta > 0 && (e.status === 'waiting' || e.status === 'admitted')
      );
    })
    .map((e) => {
      const ds = props.delaySpreadMap[e.id]!;
      const remainingTicks = SPREAD_THRESHOLD - ds.delta;
      const remainingSeconds = Math.max(0, Math.round(remainingTicks / TICKS_PER_SECOND));
      return { id: e.id, v: `${remainingSeconds}s` };
    });
});

function eventClass(ev: DispatchLogEntry['event']): string {
  if (ev === 'admit') return 'admit';
  if (ev === 'depart') return 'depart';
  if (ev === 'stop') return 'stop';
  if (ev === 'handover') return 'handover';
  return '';
}
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="modal-scrim" @click="onScrimClick">
      <div class="sched-modal" @click.stop>
        <div class="sched-main">
          <div class="sched-main-head">
            <div>
              <div class="eyebrow">[ SCHEDULE ] · 当前窗口 · 接入 + 未来 30 分钟</div>
              <h2>时刻表 / Timetable</h2>
            </div>
            <div class="head-meta">
              {{ scheduleEntries.length }} trains · window 30:00
            </div>
          </div>

          <div class="sched-table">
            <table>
              <thead>
                <tr>
                  <th>车次</th>
                  <th>方向</th>
                  <th>进站</th>
                  <th>停站</th>
                  <th>出站</th>
                  <th>准点</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in pagedEntries" :key="entry.id">
                  <td class="id">{{ entry.id }}</td>
                  <td>
                    <span :class="['dir', entry.direction]">
                      {{ entry.direction === 'up' ? '↑ 上行' : '↓ 下行' }}
                    </span>
                  </td>
                  <td :class="['m', getEntryArriveTime(entry).pred ? 'pred' : 'actual']">
                    {{ getEntryArriveTime(entry).text }}
                  </td>
                  <td class="m">{{ formatStopDuration(entry.scheduledStopDuration) }}</td>
                  <td :class="['m', getEntryDepartTime(entry).pred ? 'pred' : 'actual']">
                    {{ getEntryDepartTime(entry).text }}
                  </td>
                  <td>
                    <span class="delay-cell">
                      <span :class="['v', delayMap[entry.id]?.cls]">{{ delayMap[entry.id]?.text }}</span>
                      <span
                        v-if="delayMap[entry.id]?.spread"
                        :class="['sp', delayMap[entry.id]?.spreadCls]"
                      >
                        {{ delayMap[entry.id]?.spread }}
                      </span>
                    </span>
                  </td>
                </tr>
                <tr v-if="pagedEntries.length === 0">
                  <td colspan="6" class="empty-row">暂无列车数据</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pager">
            <span class="page-info">
              显示 {{ scheduleEntries.length === 0 ? 0 : safePage * PAGE_SIZE + 1 }}–{{
                Math.min((safePage + 1) * PAGE_SIZE, scheduleEntries.length)
              }}
              / 共 {{ scheduleEntries.length }} 列
            </span>
            <div class="pager-ctrls">
              <button :disabled="safePage <= 0" @click="prevPage">← 上一页</button>
              <span class="page-num">{{ safePage + 1 }} / {{ totalPages }}</span>
              <button :disabled="safePage >= totalPages - 1" @click="nextPage">下一页 →</button>
            </div>
          </div>
        </div>

        <div class="sched-side">
          <div class="sched-side-close">
            <span>CONTROL PANEL</span>
            <button class="close-x" @click="emit('close')">✕</button>
          </div>

          <div class="sched-side-clock">
            <div class="lbl">GAME CLOCK</div>
            <div class="t">{{ clockHM }}:{{ clockSec }}</div>
          </div>

          <div class="sched-side-speed">
            <button
              v-for="o in speedOpts"
              :key="o.k"
              :class="['speed-btn', { on: isSpeedOn(o), paused: o.paused && isSpeedOn(o) }]"
              @click="emit('speed-change', o.v)"
            >
              {{ o.k }}
            </button>
          </div>

          <div class="sched-tabs">
            <button class="arr" @click="prevTab">←</button>
            <span class="tab-name">{{ activeTab }}</span>
            <button class="arr" @click="nextTab">→</button>
          </div>

          <div class="sched-tab-body">
            <template v-if="tabIdx === 0">
              <div v-for="(log, i) in dispatchLogs" :key="i" class="log-row">
                <span class="time">{{ log.gameTime }}</span>
                <span class="id">{{ log.trainId }}</span>
                <span :class="['ev', eventClass(log.event)]">{{
                  DISPATCH_EVENT_LABELS[log.event]
                }}</span>
              </div>
              <div v-if="dispatchLogs.length === 0" class="empty-side">暂无日志</div>
            </template>

            <template v-else>
              <div v-if="worsenedItems.length > 0" class="warn-group worsened">
                <h4>⚠ 晚点已加剧</h4>
                <div v-for="w in worsenedItems" :key="w.id" class="warn-item">
                  <span class="id">{{ w.id }}</span>
                  <span class="v">{{ w.v }}</span>
                </div>
              </div>
              <div v-if="imminentItems.length > 0" class="warn-group imminent">
                <h4>⚠ 晚点即将加剧</h4>
                <div v-for="w in imminentItems" :key="w.id" class="warn-item">
                  <span class="id">{{ w.id }}</span>
                  <span class="v">剩余 {{ w.v }}</span>
                </div>
              </div>
              <div
                v-if="worsenedItems.length === 0 && imminentItems.length === 0"
                class="empty-side"
              >
                暂无晚点扩散警告
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(10, 10, 10, 0.72);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: stretch;
  justify-content: center;
  animation: fade 240ms var(--ease);
}
@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.sched-modal {
  margin: 40px;
  flex: 1;
  max-width: 1400px;
  background: var(--bg);
  border: 1px solid var(--divider);
  display: grid;
  grid-template-columns: 1fr 360px;
  overflow: hidden;
}

.sched-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sched-main-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 22px 28px 18px;
  border-bottom: 1px solid var(--divider);
}
.sched-main-head h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--fg);
}
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.head-meta {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-ter);
  letter-spacing: 0.1em;
}

.sched-table {
  flex: 1;
  overflow: auto;
  padding: 0 28px;
}
.sched-table table {
  width: 100%;
  border-collapse: collapse;
}
.sched-table thead th {
  position: sticky;
  top: 0;
  background: var(--bg);
  text-align: left;
  padding: 14px 12px 10px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 400;
  border-bottom: 1px solid var(--divider);
}
.sched-table tbody td {
  padding: 14px 12px;
  border-bottom: 1px solid var(--divider);
  font-size: 13px;
  color: var(--fg);
  vertical-align: middle;
}
.sched-table tbody tr:hover {
  background: var(--bg-elev);
}
.sched-table td.id {
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: 0.02em;
}
.sched-table td.m {
  font-family: var(--mono);
  color: var(--fg-sec);
  letter-spacing: 0.03em;
}
.sched-table td.m.pred {
  color: var(--fg-ter);
}
.sched-table td.m.actual {
  color: var(--fg);
}
.sched-table .dir {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-sec);
  letter-spacing: 0.06em;
}
.sched-table .dir.up {
  color: var(--sig-blue);
}
.sched-table .dir.down {
  color: var(--sig-amber);
}
.sched-table .delay-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: 12px;
}
.sched-table .delay-cell .v {
  letter-spacing: 0.04em;
}
.sched-table .delay-cell .v.early {
  color: var(--early);
}
.sched-table .delay-cell .v.ontime {
  color: var(--ontime);
}
.sched-table .delay-cell .v.late {
  color: var(--late);
}
.sched-table .delay-cell .sp {
  font-size: 10px;
  color: var(--fg-ter);
}
.sched-table .delay-cell .sp.improved {
  color: var(--early);
}
.sched-table .delay-cell .sp.worsened {
  color: var(--late);
}
.empty-row {
  text-align: center !important;
  color: var(--fg-ter) !important;
  padding: 30px 0 !important;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  border-top: 1px solid var(--divider);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-sec);
  letter-spacing: 0.04em;
}
.pager-ctrls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pager button {
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 2px;
  letter-spacing: 0.06em;
  transition: all 160ms var(--ease);
}
.pager button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.pager button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.pager .page-info {
  color: var(--fg-ter);
}
.pager .page-num {
  color: var(--fg-sec);
}

.sched-side {
  border-left: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  overflow: hidden;
}
.sched-side-close {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--divider);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.close-x {
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg-sec);
  width: 28px;
  height: 28px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 160ms var(--ease);
}
.close-x:hover {
  border-color: var(--sig-red);
  color: var(--sig-red);
}

.sched-side-clock {
  padding: 18px 22px;
  border-bottom: 1px solid var(--divider);
}
.sched-side-clock .lbl {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-ter);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.sched-side-clock .t {
  font-family: var(--mono);
  font-size: 32px;
  letter-spacing: 0.02em;
  color: var(--fg);
}

.sched-side-speed {
  display: flex;
  border-bottom: 1px solid var(--divider);
}
.sched-side-speed .speed-btn {
  flex: 1;
  background: transparent;
  border: none;
  border-right: 1px solid var(--divider);
  color: var(--fg-sec);
  font-family: var(--mono);
  font-size: 11px;
  padding: 10px 0;
  letter-spacing: 0.06em;
  transition: background 160ms var(--ease), color 160ms var(--ease);
}
.sched-side-speed .speed-btn:last-child {
  border-right: none;
}
.sched-side-speed .speed-btn:hover {
  color: var(--fg);
  background: var(--bg);
}
.sched-side-speed .speed-btn.on {
  color: var(--fg-dark);
  background: var(--accent);
}
.sched-side-speed .speed-btn.on.paused {
  background: var(--sig-red);
  color: var(--fg);
}

.sched-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
}
.sched-tabs .arr {
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg-sec);
  width: 28px;
  height: 28px;
  border-radius: 2px;
  font-family: var(--mono);
}
.sched-tabs .arr:hover {
  color: var(--fg);
  border-color: var(--fg-sec);
}
.sched-tabs .tab-name {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.sched-tab-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.empty-side {
  text-align: center;
  color: var(--fg-ter);
  padding: 30px 18px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.log-row {
  padding: 10px 18px;
  border-bottom: 1px solid var(--divider);
  font-size: 12px;
  display: grid;
  grid-template-columns: 64px 56px 1fr;
  gap: 10px;
  align-items: baseline;
}
.log-row .time {
  font-family: var(--mono);
  color: var(--fg-ter);
  letter-spacing: 0.04em;
}
.log-row .id {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--fg);
}
.log-row .ev {
  color: var(--fg-sec);
}
.log-row .ev.admit {
  color: var(--sig-blue);
}
.log-row .ev.depart {
  color: var(--accent);
}
.log-row .ev.handover {
  color: var(--fg-ter);
}
.log-row .ev.stop {
  color: var(--sig-red);
}

.warn-group {
  padding: 16px 18px;
  border-bottom: 1px solid var(--divider);
}
.warn-group h4 {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.warn-group.worsened h4 {
  color: var(--sig-red);
}
.warn-group.imminent h4 {
  color: var(--sig-amber);
}
.warn-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-sec);
}
.warn-item .id {
  color: var(--fg);
  font-weight: 700;
}
.warn-item .v {
  letter-spacing: 0.04em;
}
.warn-group.worsened .warn-item .v {
  color: var(--sig-red);
}
.warn-group.imminent .warn-item .v {
  color: var(--sig-amber);
}

.modal-enter-active {
  transition: opacity 240ms var(--ease);
}
.modal-leave-active {
  transition: opacity 160ms var(--ease);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>

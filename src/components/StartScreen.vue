<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { allStations } from '../data/stations';
import type { StationConfig } from '../data/stations';

defineEmits<{
  (e: 'select', station: StationConfig): void;
}>();

const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date();
  }, 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const localTime = computed(() => `${pad(now.value.getHours())}:${pad(now.value.getMinutes())}`);
const availableCount = computed(() => allStations.filter((s) => s.enabled).length);

function stationLabel(idx: number): string {
  return `S${pad(idx + 1)}`;
}
</script>

<template>
  <div class="start">
    <div class="start-nav">
      <div class="brand">Headway <em>/ dispatcher</em></div>
      <div class="start-meta">
        <b>DISPATCH CENTER</b> &nbsp;·&nbsp; LOCAL {{ localTime }} &nbsp;·&nbsp; V 2.0
      </div>
    </div>

    <div class="start-hero">
      <div class="eyebrow">Train dispatcher — real-time simulator</div>
      <h1>Keep <span class="accent">every train</span> moving.</h1>
      <p>
        你是调度员。时刻表不会停。进站、停靠、发车、移交——每一个决定都直接影响准点率与安全。选择一座车站开始值班。
      </p>
    </div>

    <div class="station-head">
      <span class="idx-label">[ 01 ]&nbsp;&nbsp;Select station</span>
      <h2>{{ allStations.length }} stations / {{ availableCount }} available</h2>
    </div>

    <div class="station-grid">
      <div
        v-for="(station, idx) in allStations"
        :key="station.id"
        :class="['station-card', { disabled: !station.enabled }]"
        @click="station.enabled && $emit('select', station)"
      >
        <div class="station-card-top">
          <span class="station-idx">
            {{ stationLabel(idx) }} / {{ station.enabled ? 'AVAILABLE' : 'LOCKED' }}
          </span>
          <span :class="['station-type', station.type]">{{ station.type }}</span>
        </div>

        <div>
          <h3 class="station-name">{{ station.name }}</h3>
          <div class="station-name-en">{{ station.nameEn }}</div>
        </div>

        <p class="station-desc">{{ station.description }}</p>

        <div class="difficulty">
          <span class="difficulty-label">难度</span>
          <span
            v-for="i in 5"
            :key="i"
            :class="['diff-dot', { on: i <= station.difficulty }]"
          />
        </div>

        <div class="station-bottom">
          <div class="station-preview">
            <!-- SMALL: single line with one platform box -->
            <svg v-if="station.type === 'small'" width="92" height="28" viewBox="0 0 92 28">
              <line x1="4" y1="14" x2="88" y2="14" stroke="#3A3935" stroke-width="1.5" />
              <rect x="28" y="8" width="36" height="12" fill="none" stroke="#6E6D6A" stroke-width="1" />
            </svg>
            <!-- TERMINAL: two lines with buffer stops + 2 platforms -->
            <svg v-else-if="station.type === 'terminal'" width="92" height="28" viewBox="0 0 92 28">
              <line x1="4" y1="8" x2="76" y2="8" stroke="#3A3935" stroke-width="1.5" />
              <line x1="4" y1="20" x2="76" y2="20" stroke="#3A3935" stroke-width="1.5" />
              <path d="M76 5 L76 11 M76 17 L76 23" stroke="#F0C24C" stroke-width="1.5" />
              <rect x="20" y="4" width="40" height="8" fill="none" stroke="#6E6D6A" stroke-width="1" />
              <rect x="20" y="16" width="40" height="8" fill="none" stroke="#6E6D6A" stroke-width="1" />
            </svg>
            <!-- HUB: 3 lines + diverging switches + 2 platforms -->
            <svg v-else width="92" height="28" viewBox="0 0 92 28">
              <line x1="4" y1="6" x2="88" y2="6" stroke="#3A3935" stroke-width="1.5" />
              <line x1="4" y1="14" x2="88" y2="14" stroke="#3A3935" stroke-width="1.5" />
              <line x1="4" y1="22" x2="88" y2="22" stroke="#3A3935" stroke-width="1.5" />
              <path
                d="M22 6 L34 14 L22 22 M70 6 L58 14 L70 22"
                stroke="#6E6D6A"
                stroke-width="1"
                fill="none"
              />
              <rect x="40" y="2" width="18" height="8" fill="none" stroke="#6E6D6A" stroke-width="1" />
              <rect x="40" y="18" width="18" height="8" fill="none" stroke="#6E6D6A" stroke-width="1" />
            </svg>
          </div>
          <button :class="['enter-btn', { locked: !station.enabled }]" :disabled="!station.enabled">
            {{ station.enabled ? '进入 →' : 'LOCKED' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.start {
  position: relative;
  min-height: 100%;
  height: 100%;
  padding: 56px 56px 80px;
  color: var(--fg);
  background: var(--bg);
  overflow: auto;
}
.start::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: radial-gradient(rgba(242, 241, 238, 0.06) 1px, transparent 1px);
  background-size: 28px 28px;
  -webkit-mask-image: radial-gradient(ellipse at 50% 40%, #000 30%, transparent 80%);
  mask-image: radial-gradient(ellipse at 50% 40%, #000 30%, transparent 80%);
  pointer-events: none;
}

.start-nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 48px;
}
.brand {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.brand em {
  color: var(--accent);
  font-style: normal;
  font-weight: 400;
}
.start-meta {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-ter);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.start-meta b {
  color: var(--fg-sec);
  font-weight: 400;
}

.start-hero {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  padding: 80px 0 64px;
}
.start-hero .eyebrow {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 24px;
}
.start-hero h1 {
  font-size: clamp(56px, 9vw, 120px);
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.04em;
  margin: 0;
  max-width: 14ch;
}
.start-hero h1 .accent {
  color: var(--accent);
}
.start-hero p {
  margin-top: 32px;
  max-width: 520px;
  font-size: 18px;
  line-height: 1.5;
  letter-spacing: -0.016em;
  color: var(--fg-sec);
}

.station-head {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 48px 0 20px;
  border-bottom: 1px solid var(--divider);
}
.station-head .idx-label {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-ter);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.station-head h2 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}

.station-grid {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--divider);
  border-bottom: 1px solid var(--divider);
}
@media (max-width: 960px) {
  .station-grid {
    grid-template-columns: 1fr;
  }
}

.station-card {
  background: var(--bg);
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 300px;
  cursor: pointer;
  transition: background 200ms var(--ease);
  position: relative;
}
.station-card:hover:not(.disabled) {
  background: var(--bg-elev);
}
.station-card.disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.station-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.station-idx {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-ter);
  letter-spacing: 0.08em;
}
.station-type {
  font-family: var(--mono);
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid var(--divider-2);
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--fg-sec);
}
.station-type.terminal {
  color: var(--sig-amber);
  border-color: rgba(240, 194, 76, 0.4);
}
.station-type.hub {
  color: var(--accent);
  border-color: rgba(189, 243, 127, 0.4);
}

.station-name {
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.04;
  margin: 0;
}
.station-name-en {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.08em;
  margin-top: 6px;
}
.station-desc {
  font-size: 15px;
  line-height: 1.5;
  color: var(--fg-sec);
  margin: 0;
  letter-spacing: -0.012em;
}

.difficulty {
  display: flex;
  gap: 4px;
  align-items: center;
}
.difficulty-label {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-right: 12px;
}
.diff-dot {
  width: 8px;
  height: 8px;
  background: var(--fg-ter);
  border-radius: 1px;
}
.diff-dot.on {
  background: var(--accent);
}

.station-bottom {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 20px;
  border-top: 1px dashed var(--divider-2);
}
.station-preview svg {
  display: block;
}
.enter-btn {
  font-family: var(--ui);
  background: transparent;
  border: 1px solid var(--fg);
  color: var(--fg);
  padding: 10px 16px;
  border-radius: 2px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: all 200ms var(--ease);
}
.station-card:hover:not(.disabled) .enter-btn {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--fg-dark);
}
.enter-btn.locked {
  border-color: var(--divider-2);
  color: var(--fg-ter);
  cursor: not-allowed;
}
</style>

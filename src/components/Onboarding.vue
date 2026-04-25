<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const emit = defineEmits<{
  (e: 'close'): void;
}>();

type Target = 'left' | 'right' | 'canvas' | 'badge' | null;

interface Step {
  title: string;
  body: string;
  target: Target;
}

const steps: Step[] = [
  {
    title: '欢迎进入调度席',
    body: '你是调度员。屏幕中央是线路图，左侧是列车列表，右侧是时钟与指令。时刻表不会停——但你可以调速。准备好了就点下一步。',
    target: null,
  },
  {
    title: '列车列表 · 按紧急度排序',
    body: '所有等待 + 在站列车都在这里。列表默认按「晚点恶化程度」排序——最需要你关注的列车永远在最上。点击一行选中列车。',
    target: 'left',
  },
  {
    title: '线路图 · 道岔与信号',
    body: '点击圆形道岔可切换激活出边（高亮的石灰绿轨道）。点击信号灯切换红/绿。红灯会阻止列车通过——务必在扳道岔之前确认信号。',
    target: 'canvas',
  },
  {
    title: '下达指令',
    body: '选中列车后，右下角出现三个指令：允许进站、发车信号、紧急停车。按钮会根据列车当前状态自动启用/禁用。',
    target: 'right',
  },
  {
    title: '键盘模式 · Space',
    body: '随时按 Space 切换到键盘模式——画布上会浮出键位徽章，道岔用数字、信号灯用字母。熟练后速度是鼠标的两倍。',
    target: 'badge',
  },
];

const targetRects: Record<Exclude<Target, null>, Record<string, string | number>> = {
  left: { left: '8px', top: '64px', width: '324px', height: 'calc(100% - 72px)' },
  right: { right: '8px', top: '64px', width: '324px', height: 'calc(100% - 72px)' },
  canvas: { left: '350px', right: '350px', top: '64px', bottom: '8px' },
  badge: { left: '366px', bottom: '20px', width: '220px', height: '36px' },
};

const cardPos: Record<string, Record<string, string | number>> = {
  null: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
  left: { left: '360px', top: '120px', transform: 'none' },
  right: { right: '360px', top: '120px', transform: 'none' },
  canvas: { left: '50%', bottom: '80px', transform: 'translateX(-50%)' },
  badge: { left: '360px', bottom: '80px', transform: 'none' },
};

const i = ref(0);
const step = computed(() => steps[i.value]!);
const ringStyle = computed(() => {
  const t = step.value.target;
  return t ? targetRects[t] : null;
});
const cardStyle = computed(() => cardPos[step.value.target ?? 'null']);

function next() {
  if (i.value < steps.length - 1) {
    i.value++;
  } else {
    emit('close');
  }
}
function skip() {
  emit('close');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
</script>

<template>
  <div class="onb-scrim" />
  <div v-if="ringStyle" class="onb-ring" :style="ringStyle" />
  <div class="onb-card" :style="cardStyle">
    <div class="num">STEP {{ pad(i + 1) }} / {{ pad(steps.length) }}</div>
    <h4>{{ step.title }}</h4>
    <p>{{ step.body }}</p>
    <div class="row">
      <span class="steps">
        <span
          v-for="(_, idx) in steps"
          :key="idx"
          class="step-tick"
          :class="{ on: idx <= i }"
        />
      </span>
      <div class="btns">
        <button class="onb-btn skip" @click="skip">跳过</button>
        <button class="onb-btn next" @click="next">
          {{ i === steps.length - 1 ? '开始调度 →' : '下一步 →' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onb-scrim {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(10, 10, 10, 0.82);
  backdrop-filter: blur(6px);
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

.onb-ring {
  position: fixed;
  z-index: 96;
  border: 2px solid var(--accent);
  box-shadow:
    0 0 0 9999px rgba(10, 10, 10, 0.82),
    0 0 20px rgba(189, 243, 127, 0.5);
  pointer-events: none;
  transition: all 300ms var(--ease);
}

.onb-card {
  position: fixed;
  z-index: 97;
  background: var(--bg-elev);
  border: 1px solid var(--divider-2);
  padding: 20px 22px 18px;
  width: 340px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.onb-card .num {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.onb-card h4 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 10px;
  line-height: 1.2;
}
.onb-card p {
  font-size: 14px;
  line-height: 1.5;
  color: var(--fg-sec);
  letter-spacing: -0.01em;
  margin: 0 0 16px;
}
.onb-card .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.onb-card .steps {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-ter);
  letter-spacing: 0.1em;
}
.step-tick {
  display: inline-block;
  width: 18px;
  height: 2px;
  margin-right: 4px;
  background: var(--divider-2);
}
.step-tick.on {
  background: var(--accent);
}
.onb-card .btns {
  display: flex;
  gap: 8px;
}
.onb-btn {
  font-family: var(--ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 7px 14px;
  border-radius: 2px;
  transition: all 160ms var(--ease);
}
.onb-btn.skip {
  background: transparent;
  border: 1px solid var(--divider-2);
  color: var(--fg-sec);
}
.onb-btn.skip:hover {
  color: var(--fg);
  border-color: var(--fg-sec);
}
.onb-btn.next {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--fg-dark);
}
.onb-btn.next:hover {
  background: var(--accent-hov);
}
</style>

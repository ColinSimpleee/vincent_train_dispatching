<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
export type ToastKind = 'mode' | 'action' | 'error' | 'success';

export interface ToastEntry {
  id: number;
  msg: string;
  kind: ToastKind;
}

defineProps<{
  toasts: ToastEntry[];
}>();

function icon(kind: ToastKind): string {
  if (kind === 'error') return '✕';
  if (kind === 'mode') return '⌨';
  if (kind === 'success') return '▲';
  return '◆';
}
</script>

<template>
  <div class="toast-stack">
    <div v-for="t in toasts" :key="t.id" :class="['toast', t.kind]">
      <span class="icon">{{ icon(t.kind) }}</span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
}
.toast {
  font-family: var(--ui);
  font-size: 13px;
  letter-spacing: 0.02em;
  padding: 10px 16px;
  background: rgba(10, 10, 10, 0.92);
  border: 1px solid var(--divider-2);
  border-radius: 2px;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: 10px;
  animation: toast-in 180ms var(--ease);
}
.toast.mode {
  border-color: var(--accent);
  color: var(--accent);
}
.toast.action {
  border-color: var(--sig-blue);
  color: var(--fg);
}
.toast.error {
  border-color: var(--sig-red);
  color: var(--sig-red);
}
.toast.success {
  border-color: var(--accent);
  color: var(--accent);
}
.toast .icon {
  font-family: var(--mono);
  font-size: 11px;
  opacity: 0.8;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

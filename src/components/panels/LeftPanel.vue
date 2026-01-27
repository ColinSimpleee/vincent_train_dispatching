<script setup lang="ts">
import type { TrainPhysics } from '../../core/RailGraph';

const props = defineProps<{
  queue: any[]; // MVP simplified
  onSelect: (id: string) => void;
  selectedId: string | null;
  gameStartTime?: { hours: number; minutes: number; seconds: number }; // Game start time
  currentTick?: number; // Current game tick
}>();

// Convert tick to HH:MM:SS format
function tickToTime(tick: number): string {
  const TICKS_PER_SECOND = 60;
  const startTime = props.gameStartTime || { hours: 8, minutes: 0, seconds: 0 };
  
  // Calculate total seconds from start
  const totalGameSeconds = Math.floor(tick / TICKS_PER_SECOND);
  
  // Add to start time
  let hours = startTime.hours;
  let minutes = startTime.minutes;
  let seconds = startTime.seconds + totalGameSeconds;
  
  // Handle overflow
  minutes += Math.floor(seconds / 60);
  seconds = seconds % 60;
  
  hours += Math.floor(minutes / 60);
  minutes = minutes % 60;
  
  hours = hours % 24; // Wrap at 24 hours
  
  // Format as HH:MM:SS
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
</script>

<template>
  <div class="panel-left">
    <h3>等待进站队列</h3>
    <div class="list-container">
       <div 
         v-for="item in queue" 
         :key="item.id"
         class="queue-item"
         :class="{ active: selectedId === item.id }"
         @click="onSelect(item.id)"
       >
         <div class="item-header">
           <span class="train-id">{{ item.id }}</span>
           <span class="status-badge">进站</span>
         </div>
         <div class="item-meta">
            计划到达: {{ tickToTime(item.schedule.arriveTick) }}
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
  margin-bottom: 5px;
}

.train-id {
  font-family: 'Consolas', monospace;
  font-weight: bold;
  font-size: 16px;
  color: #fff;
}

.status-badge {
  background: #f39c12;
  color: black;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: bold;
}

.item-meta {
  font-size: 12px;
  color: #95a5a6;
}
</style>

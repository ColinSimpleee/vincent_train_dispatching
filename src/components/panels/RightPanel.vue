<script setup lang="ts">
import type { TrainPhysics } from '../../core/RailGraph';

defineProps<{
  gameTime: string; // Virtual game time in HH:MM:SS format
  selectedTrain: TrainPhysics | null; // Active or Queue item
  onAction: (action: string) => void;
  gameSpeed: number;
  onSpeedChange: (s: number) => void;
}>();
</script>

<template>
  <div class="panel-right">
    <!-- Clock Module -->
    <div class="module clock">
       <div class="label">当前时刻</div>
       <div class="digital">{{ gameTime }}</div>
    </div>

    <!-- Info Module -->
    <div class="module info" v-if="selectedTrain">
       <div class="id-card">
          <div class="model-row">{{ selectedTrain.modelType || 'Unknown' }}</div>
          <div class="train-big">{{ selectedTrain.id }}</div>
       </div>
       
       <div class="prop-row">
         <span>状态</span>
         <span class="val">{{ selectedTrain.state || 'WAITING' }}</span>
       </div>
       <div class="prop-row">
         <span>位置</span>
         <span class="val">{{ selectedTrain.currentEdgeId || 'N/A' }}</span>
       </div>
       <div class="prop-row">
         <span>速度</span>
         <span class="val">{{ selectedTrain.speed }} km/h</span>
       </div>
    </div>
    <div class="module empty" v-else>
       未选择列车
    </div>

    <!-- Controls Module -->
    <div class="module controls">
       <div class="label">调度指令</div>
       <div class="btn-grid">
         <button class="btn primary" @click="onAction('ADMIT')">允许进站</button>
         <button class="btn success" @click="onAction('DEPART')">发车信号</button>
         <button class="btn danger" @click="onAction('STOP')">紧急停车</button>
       </div>
    </div>

    <!-- Speed Module -->
    <div class="module speed-control">
       <div class="label">运行倍速</div>
       <div class="btn-grid row">
         <button 
            v-for="s in [1, 2, 5, 10]" 
            :key="s"
            class="btn speed-btn"
            :class="{ active: gameSpeed === s }"
            @click="onSpeedChange(s)"
         >
           {{ s }}x
         </button>
       </div>
    </div>
  </div>
</template>

<style scoped>
.panel-right {
  background: #1e1e1e;
  border-left: 1px solid #333;
  padding: 15px;
  color: #ecf0f1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.module {
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 15px;
}

.clock .digital {
  font-family: 'Consolas', monospace;
  font-size: 32px;
  color: #3498db;
  text-align: right;
  letter-spacing: 2px;
}

.label {
  font-size: 10px;
  text-transform: uppercase;
  color: #7f8c8d;
  margin-bottom: 5px;
}

.id-card {
  border-bottom: 1px solid #444;
  margin-bottom: 10px;
  padding-bottom: 10px;
}

.train-big {
  font-size: 24px;
  font-weight: bold;
  color: #f1c40f;
}

.prop-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 5px;
  border-bottom: 1px dashed #333;
  padding-bottom: 2px;
}

.val { font-family: monospace; color: #ecf0f1; }

.btn-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-grid.row {
  flex-direction: row;
  gap: 5px;
}

.btn {
  padding: 12px;
  border: none;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  color: #fff;
  transition: filter 0.2s;
}
.btn:hover { filter: brightness(1.2); }

.primary { background: #2980b9; }
.success { background: #27ae60; }
.danger { background: #c0392b; }

.speed-btn {
  flex: 1;
  background: #444;
  padding: 8px 0;
  font-size: 12px;
  border-radius: 2px;
}
.speed-btn.active {
  background: #f1c40f;
  color: #000;
}

.empty {
  text-align: center;
  color: #555;
  font-style: italic;
  padding: 30px 0;
}
</style>

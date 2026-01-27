<script setup lang="ts">
import { allStations } from '../data/stations';
import type { StationConfig } from '../data/stations';

defineEmits<{
  (e: 'select', station: StationConfig): void
}>();

function getStarRating(count: number) {
    return '★'.repeat(count) + '☆'.repeat(5 - count);
}
</script>

<template>
  <div class="start-screen">
    <div class="title-area">
        <h1>RAILWAY DISPATCHER</h1>
        <div class="subtitle">PHASE 3: MANUAL CONTROL</div>
    </div>
    
    <div class="station-grid">
        <div 
            v-for="station in allStations" 
            :key="station.id" 
            class="station-card"
            :class="{'disabled': !station.mapData.nodes || Object.keys(station.mapData.nodes).length === 0}"
        >
            <div class="card-header">
                <h3>{{ station.name }}</h3>
                <span class="difficulty">{{ getStarRating(station.difficulty) }}</span>
            </div>
            
            <div class="card-body">
                <p>{{ station.description }}</p>
                <div class="tags">
                    <span class="tag">{{ station.type.toUpperCase() }}</span>
                </div>
            </div>
            
            <div class="card-actions">
                <button 
                    @click="$emit('select', station)"
                    :disabled="!station.mapData.nodes || Object.keys(station.mapData.nodes).length === 0"
                >
                    ENTER STATION
                </button>
            </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.start-screen {
    width: 100vw;
    height: 100vh;
    background: #111;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: 'Segoe UI', sans-serif;
}

.title-area {
    text-align: center;
    margin-bottom: 60px;
}

h1 {
    font-size: 48px;
    letter-spacing: 10px;
    margin: 0;
    color: #eee;
    text-transform: uppercase;
}
.subtitle {
    color: #666;
    letter-spacing: 5px;
    margin-top: 10px;
}

.station-grid {
    display: flex;
    gap: 30px;
    max-width: 1200px;
}

.station-card {
    background: #1a1a1a;
    width: 300px;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 20px;
    transition: transform 0.2s, border-color 0.2s;
}

.station-card:not(.disabled):hover {
    transform: translateY(-5px);
    border-color: #3498db;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

.station-card.disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    border-bottom: 1px solid #333;
    padding-bottom: 10px;
}

.card-header h3 {
    margin: 0;
    font-size: 18px;
    color: #ddd;
}

.difficulty {
    color: #f1c40f;
    font-size: 14px;
}

.card-body p {
    color: #999;
    font-size: 14px;
    line-height: 1.5;
    height: 60px; /* fixed height for alignment */
}

.tags {
    margin: 15px 0;
}

.tag {
    background: #222;
    color: #666;
    padding: 4px 8px;
    font-size: 10px;
    border-radius: 2px;
    border: 1px solid #333;
}

button {
    width: 100%;
    padding: 12px;
    background: #2c3e50;
    color: #fff;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    font-weight: bold;
    letter-spacing: 1px;
    transition: background 0.2s;
}

.station-card:not(.disabled) button:hover {
    background: #3498db;
}

.station-card.disabled button {
    background: #333;
    color: #555;
    cursor: not-allowed;
}
</style>

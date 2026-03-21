import type { TrainModel } from './RailGraph'

// --- 共享接口 ---

export interface KeyboardControlConfig {
  nodeId: string
  type: 'switch' | 'signal'
  key: string
  position: { x: number; y: number }
  labelOffset: 'right' | 'left'
}

export interface SelectedTrainDisplay {
  id: string
  state: string
  modelType: TrainModel
  speed: number
  currentEdgeId: string
}

// --- 调度动作 ---

export type TrainAction = 'ADMIT' | 'DEPART' | 'STOP'

// --- 时刻表 ---

export interface ScheduleConfig {
  peakIntervalRange: [number, number]
  offPeakIntervalRange: [number, number]
  peakWindows: [number, number][]
  directionRatio: number
  lines?: string[]
  lineTrafficWeight?: Record<string, number>
}

export type ScheduleEntryStatus = 'upcoming' | 'waiting' | 'admitted' | 'departed'

export interface ScheduleEntry {
  id: string
  direction: 'up' | 'down'
  model: TrainModel
  line?: string

  scheduledArriveTick: number
  scheduledStopDuration: number
  scheduledDepartTick: number

  currentDelay: number

  handoverDelay?: number
  handoverTick?: number
  reactionGraceTicks?: number
  finalDelay?: number

  status: ScheduleEntryStatus
}

export interface DelaySpread {
  delta: number
  level: 'improved' | 'neutral' | 'worsened'
}

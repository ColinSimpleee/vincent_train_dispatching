export enum TrainType {
  THROUGH = 'through',
  ORIGINATING = 'originating',
  TERMINATING = 'terminating'
}

export enum TrainState {
  WAITING_ENTRY = 'waiting_entry',       // In throat, waiting for platform assignment
  MOVING_TO_PLATFORM = 'moving_to_platform', // Transitioning into station
  AT_PLATFORM = 'at_platform',           // Stopped at platform (Boarding/Alighting)
  WAITING_DEPART = 'waiting_depart',     // Service done, waiting for release command
  DEPARTED = 'departed',                 // Exiting station
  FINISHED = 'finished'                  // Terminated or fully left map
}

export interface Schedule {
  arriveTick: number; // When it appears in waiting queue
  stopDuration: number; // How long it takes to service (ticks)
  turnaroundDuration?: number; // Only for Terminating -> Originating
}

export interface Train {
  id: string;
  type: TrainType;
  schedule: Schedule;
  state: TrainState;
  currentPlatformId: number | null;
  
  // Timers
  timer: number; // General purpose timer for current state
  entryDuration: number; // Constant: time to enter
  exitDuration: number;  // Constant: time to exit
  
  // Late tracking
  actualArriveTick: number | null;
  actualDepartTick: number | null;
}

export interface Platform {
  id: number;
  isOccupied: boolean;
  occupiedBy: string | null; // Train ID
  // For turnaround logic, we might need a "Ghost" lock even if train is conceptually "finished"
  lockedUntilTick: number | null; 
}

export interface Station {
  tick: number;
  platforms: Platform[];
  waitingQueue: Train[];
  activeTrains: Train[]; // On map (moving or at platform)
  departedTrains: Train[];
  score: number;
  isGameOver: boolean;
  config: {
    turnaroundLockTime: number;
  };
}

import type { TrainModel } from './RailGraph'

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

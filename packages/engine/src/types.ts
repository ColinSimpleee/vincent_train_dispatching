import type { PRNGState } from './prng'

// ============================================================================
// 1. 物理与拓扑（从 src/core/RailGraph.ts 复刻；阶段一并存，阶段二删除原版）
// ============================================================================

export interface RailNode {
  id: string
  x: number
  y: number
  type: 'switch' | 'endpoint' | 'connector' | 'buffer_stop'
  switchState?: number
  signalState?: 'red' | 'green'
  groupId?: string
}

export interface SwitchGroupMember {
  nodeId: string
  states: number[]
}
export interface SwitchGroup {
  id: string
  masterNodeId: string
  members: SwitchGroupMember[]
}

export interface RailEdge {
  id: string
  fromNode: string
  toNode: string
  length: number
  occupiedBy: string | null
  isPlatform?: boolean
  control1?: { x: number; y: number }
  control2?: { x: number; y: number }
}

export interface PlatformZone {
  id: string
  label: string
  rect: { x: number; y: number; w: number; h: number }
}

export interface RailMap {
  nodes: Record<string, RailNode>
  edges: Record<string, RailEdge>
  platforms: PlatformZone[]
  switchGroups?: SwitchGroup[]
}

export type TrainModel = 'CR400AF' | 'CR400BF' | 'CRH380A'

export interface TrainPhysics {
  id: string
  modelType: TrainModel
  isCoupled: boolean
  currentEdgeId: string
  position: number
  speed: number
  state: 'moving' | 'stopped'
  direction: 1 | -1
  path: string[]
  visitedPath: string[]
  nextMoveIntent?: { targetEdgeId: string; overflowDistance: number }
  passengerState?: 'BOARDING' | 'READY'
  boardingTimer?: number
  lastServicedEdgeId?: string
  isHandedOver?: boolean
  scheduleEntryId?: string
  scheduledArriveTick?: number
  arrivalTick?: number
  stopDuration?: number
  stopBuffer?: number
  /** 不变量观察用：连续静止的 tick 数；commit phase 维护。 */
  staleStoppedTicks?: number
  /** 不变量观察用：移交后已存在的 tick 数。 */
  postHandoverTicks?: number
  /** 不变量观察用：连续可恢复但未恢复的 tick 数。 */
  stuckResumableTicks?: number
}

// ============================================================================
// 2. 引擎对外契约
// ============================================================================

export interface EngineState {
  /** 已完成的 tick 计数 */
  tick: number
  trains: TrainPhysics[]
  railMap: RailMap
  rng: PRNGState
}

/** 由 TrainSpawner 构造、admit 输入携带的列车规格。 */
export interface TrainSpawnSpec {
  id: string
  modelType: TrainModel
  isCoupled: boolean
  currentEdgeId: string
  path: string[]
  direction: 1 | -1
  speed: number
  scheduleEntryId?: string
  scheduledArriveTick?: number
}

export type EngineInput =
  | { tick: number; type: 'admit'; payload: { trainSpec: TrainSpawnSpec } }
  | { tick: number; type: 'depart'; payload: { trainId: string; targetExitNodeId: string } }
  | { tick: number; type: 'stop'; payload: { trainId: string } }
  | { tick: number; type: 'switch_toggle'; payload: { nodeId: string } }
  | { tick: number; type: 'signal_toggle'; payload: { nodeId: string } }

export type EngineEvent =
  | { tick: number; kind: 'spawn'; trainId: string; modelType: TrainModel; entrance: string }
  | { tick: number; kind: 'admit'; trainId: string; edgeId: string }
  | { tick: number; kind: 'enter_edge'; trainId: string; from: string; to: string }
  | {
      tick: number
      kind: 'signal_pass'
      trainId: string
      nodeId: string
      signalState: 'red' | 'green'
    }
  | { tick: number; kind: 'dwell_start'; trainId: string; edgeId: string; duration: number }
  | { tick: number; kind: 'dwell_end'; trainId: string; edgeId: string }
  | {
      tick: number
      kind: 'depart'
      trainId: string
      strategy: 'direct' | 'reverse' | 'standard' | 'fallback'
    }
  | { tick: number; kind: 'handover'; trainId: string; edgeId: string }
  | { tick: number; kind: 'remove'; trainId: string; edgeId: string }
  | { tick: number; kind: 'stop_command'; trainId: string }
  | { tick: number; kind: 'switch_toggled'; nodeId: string; newState: number }
  | { tick: number; kind: 'signal_toggled'; nodeId: string; newState: 'red' | 'green' }
  | { tick: number; kind: 'collision'; trainA: string; trainB: string; edgeId: string }
  | {
      tick: number
      kind: 'invariant_violation'
      rule: string
      detail: Record<string, unknown>
    }

export interface Invariant {
  rule: string
  detail: Record<string, unknown>
}

export interface StepResult {
  next: EngineState
  events: EngineEvent[]
  violations: Invariant[]
}

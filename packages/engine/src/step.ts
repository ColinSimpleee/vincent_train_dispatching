import { buildAdjacency } from './adjacency'
import { TICKS_PER_SECOND } from './constants'
import { assertInvariants, isDevMode } from './invariants'
import { detectCollisions } from './phases/collision'
import { commitMoves } from './phases/commit'
import { resolveConflicts } from './phases/conflict'
import { computeIntent, tryResume } from './phases/intent'
import { handlePassenger } from './phases/passenger'
import { clonePRNG } from './prng'
import type {
  EngineEvent,
  EngineInput,
  EngineState,
  StepResult,
  TrainPhysics,
} from './types'

const FIXED_DT = 1 / TICKS_PER_SECOND

/**
 * 引擎主入口。
 * - 输入：state（不会被修改）+ inputs（本 tick 玩家行为）
 * - 输出：next（深拷贝；mutates 仅发生在内部副本）+ events + violations
 *
 * 不变量校验在 Task 15 接入。本任务先返回空 violations。
 */
export function step(state: EngineState, inputs: EngineInput[]): StepResult {
  const next = cloneState(state)
  const events: EngineEvent[] = []
  const tick = next.tick

  applyInputs(next, inputs, events)

  const adj = buildAdjacency(next.railMap)

  for (const train of next.trains) {
    handlePassenger(train, tick, events)
  }
  for (const train of next.trains) {
    if (train.state === 'moving') {
      computeIntent(train, next.railMap, adj, FIXED_DT, tick, events, next.rng)
    } else {
      tryResume(train, next.railMap, adj)
    }
  }
  detectCollisions(next.trains, tick, events)
  resolveConflicts(next.trains, tick, events)
  commitMoves(next.trains, next.railMap, tick, events)

  // 维护不变量观察用计数器
  for (const t of next.trains) {
    if (t.speed === 0) {
      t.staleStoppedTicks = (t.staleStoppedTicks ?? 0) + 1
    } else {
      t.staleStoppedTicks = 0
    }
    const stoppedNoPassenger = t.state === 'stopped' && t.passengerState === undefined
    if (stoppedNoPassenger) {
      t.stuckResumableTicks = (t.stuckResumableTicks ?? 0) + 1
    } else {
      t.stuckResumableTicks = 0
    }
    if (t.isHandedOver) {
      t.postHandoverTicks = (t.postHandoverTicks ?? 0) + 1
    } else {
      t.postHandoverTicks = 0
    }
  }

  next.tick = tick + 1

  const violations = assertInvariants(next, adj)
  if (violations.length > 0) {
    for (const v of violations) {
      events.push({
        tick: next.tick,
        kind: 'invariant_violation',
        rule: v.rule,
        detail: v.detail,
      })
    }
    if (isDevMode()) {
      throw new Error(
        `Invariant violations at tick ${next.tick}: ${violations.map((v) => v.rule).join(', ')}`,
      )
    }
  }

  return { next, events, violations }
}

function cloneState(state: EngineState): EngineState {
  return {
    tick: state.tick,
    trains: state.trains.map((t) => ({
      ...t,
      path: [...t.path],
      visitedPath: [...t.visitedPath],
    })),
    railMap: cloneRailMap(state.railMap),
    rng: clonePRNG(state.rng),
  }
}

function cloneRailMap(map: EngineState['railMap']): EngineState['railMap'] {
  const nodes: typeof map.nodes = {}
  for (const k of Object.keys(map.nodes)) nodes[k] = { ...map.nodes[k]! }
  const edges: typeof map.edges = {}
  for (const k of Object.keys(map.edges)) edges[k] = { ...map.edges[k]! }
  return { ...map, nodes, edges }
}

function applyInputs(
  state: EngineState,
  inputs: EngineInput[],
  events: EngineEvent[],
): void {
  for (const input of inputs) {
    if (input.type === 'switch_toggle') {
      const node = state.railMap.nodes[input.payload.nodeId]
      if (!node) continue
      const outCount = countOutgoingEdges(state.railMap, node.id)
      const cur = node.switchState ?? 0
      const newState = outCount > 0 ? (cur + 1) % outCount : cur
      node.switchState = newState
      events.push({
        tick: state.tick,
        kind: 'switch_toggled',
        nodeId: node.id,
        newState,
      })
    } else if (input.type === 'signal_toggle') {
      const node = state.railMap.nodes[input.payload.nodeId]
      if (!node) continue
      node.signalState = node.signalState === 'green' ? 'red' : 'green'
      events.push({
        tick: state.tick,
        kind: 'signal_toggled',
        nodeId: node.id,
        newState: node.signalState,
      })
    } else if (input.type === 'admit') {
      const spec = input.payload.trainSpec
      const train: TrainPhysics = {
        id: spec.id,
        modelType: spec.modelType,
        isCoupled: spec.isCoupled,
        currentEdgeId: spec.currentEdgeId,
        position: 0,
        speed: spec.speed,
        state: 'moving',
        direction: spec.direction,
        path: [...spec.path],
        visitedPath: [],
        scheduleEntryId: spec.scheduleEntryId,
        scheduledArriveTick: spec.scheduledArriveTick,
      }
      state.trains.push(train)
      const edge = state.railMap.edges[spec.currentEdgeId]
      if (edge) edge.occupiedBy = spec.id
      events.push({
        tick: state.tick,
        kind: 'admit',
        trainId: spec.id,
        edgeId: spec.currentEdgeId,
      })
    } else if (input.type === 'depart') {
      const train = state.trains.find((t) => t.id === input.payload.trainId)
      if (!train) continue
      train.passengerState = undefined
      train.boardingTimer = 0
      events.push({
        tick: state.tick,
        kind: 'depart',
        trainId: train.id,
        strategy: 'standard',
      })
    } else if (input.type === 'stop') {
      const train = state.trains.find((t) => t.id === input.payload.trainId)
      if (!train) continue
      train.speed = 0
      train.state = 'stopped'
      events.push({ tick: state.tick, kind: 'stop_command', trainId: train.id })
    }
  }
}

function countOutgoingEdges(map: EngineState['railMap'], nodeId: string): number {
  let count = 0
  for (const e of Object.values(map.edges)) if (e.fromNode === nodeId) count++
  return count
}

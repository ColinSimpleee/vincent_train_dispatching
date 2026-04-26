import type { AdjacencyIndex } from '../adjacency'
import { resolveNextEdge } from '../adjacency'
import {
  BUFFER_TIME_MAX,
  BUFFER_TIME_MIN,
  DWELL_TIME_MAX,
  DWELL_TIME_MIN,
  PLATFORM_BUFFER_STOP_SAFETY,
  RESUME_SPEED,
} from '../constants'
import { randomInt, type PRNGState } from '../prng'
import type { EngineEvent, RailMap, TrainPhysics } from '../types'

/**
 * Phase 1：意图计算 + 站台自动停车。
 * mutates train。所有随机性走 rng；所有错误通过 events 反馈，不抛错。
 */
export function computeIntent(
  train: TrainPhysics,
  map: RailMap,
  adj: AdjacencyIndex,
  dt: number,
  tick: number,
  events: EngineEvent[],
  rng: PRNGState,
): void {
  if (train.state !== 'moving' || train.speed === 0) return

  const dir = train.direction
  const distToMove = train.speed * dt
  const tPos = train.position + distToMove * dir
  const currentEdge = map.edges[train.currentEdgeId]

  if (!currentEdge) {
    train.state = 'stopped'
    events.push({
      tick,
      kind: 'invariant_violation',
      rule: 'invalid_current_edge',
      detail: { trainId: train.id, edgeId: train.currentEdgeId },
    })
    return
  }

  const isArriving =
    (dir === 1 && tPos >= currentEdge.length) || (dir === -1 && tPos <= 0)

  if (!isArriving) {
    train.position = tPos
    train.nextMoveIntent = undefined
    return
  }

  const overflow = dir === 1 ? tPos - currentEdge.length : Math.abs(tPos)

  // 站台自动停车
  if (currentEdge.isPlatform && train.lastServicedEdgeId !== train.currentEdgeId) {
    const endNode = map.nodes[currentEdge.toNode]
    const startNode = map.nodes[currentEdge.fromNode]
    const stopPos =
      dir === 1
        ? endNode?.type === 'buffer_stop'
          ? currentEdge.length - PLATFORM_BUFFER_STOP_SAFETY
          : currentEdge.length
        : startNode?.type === 'buffer_stop'
          ? PLATFORM_BUFFER_STOP_SAFETY
          : 0
    train.position = stopPos
    train.speed = 0
    train.state = 'stopped'

    train.passengerState = 'BOARDING'
    train.arrivalTick = tick
    const dwell = randomInt(rng, DWELL_TIME_MIN, DWELL_TIME_MAX - 1)
    train.boardingTimer = dwell
    train.stopDuration = dwell
    train.stopBuffer = randomInt(rng, BUFFER_TIME_MIN, BUFFER_TIME_MAX - 1)
    train.lastServicedEdgeId = train.currentEdgeId

    events.push({
      tick,
      kind: 'dwell_start',
      trainId: train.id,
      edgeId: train.currentEdgeId,
      duration: dwell,
    })
    return
  }

  // path 用尽
  if (!train.path || train.path.length === 0) {
    train.position = dir === 1 ? currentEdge.length : 0
    train.speed = 0
    train.state = 'stopped'
    return
  }

  const nextNodeId = dir === 1 ? currentEdge.toNode : currentEdge.fromNode
  const nextNode = map.nodes[nextNodeId]
  if (!nextNode) {
    train.state = 'stopped'
    events.push({
      tick,
      kind: 'invariant_violation',
      rule: 'invalid_next_node',
      detail: { trainId: train.id, nodeId: nextNodeId },
    })
    return
  }

  const nextEdgeId = resolveNextEdge(nextNode, train.currentEdgeId, adj)

  // 红灯停车
  if (nextNode.signalState === 'red') {
    train.position = dir === 1 ? currentEdge.length : 0
    train.speed = 0
    train.state = 'stopped'
    events.push({
      tick,
      kind: 'signal_pass',
      trainId: train.id,
      nodeId: nextNode.id,
      signalState: 'red',
    })
    return
  }

  if (!nextEdgeId) {
    train.position = dir === 1 ? currentEdge.length : 0
    train.speed = 0
    train.state = 'stopped'
    return
  }

  // 通过绿灯，记下事件
  events.push({
    tick,
    kind: 'signal_pass',
    trainId: train.id,
    nodeId: nextNode.id,
    signalState: 'green',
  })
  train.nextMoveIntent = { targetEdgeId: nextEdgeId, overflowDistance: overflow }
}

/**
 * Phase 1（停车列车的恢复检查）。mutates train。
 */
export function tryResume(
  train: TrainPhysics,
  map: RailMap,
  adj: AdjacencyIndex,
): void {
  const currentEdge = map.edges[train.currentEdgeId]
  if (!currentEdge) return

  // 停站期间不 resume（DEPART 命令通过 DispatchController 清空 passengerState 后才能动）
  if (train.passengerState === 'BOARDING' || train.passengerState === 'READY') return

  const dir = train.direction
  const distToBound = dir === 1 ? currentEdge.length - train.position : train.position
  if (distToBound > 0.1) return

  const nextNodeId = dir === 1 ? currentEdge.toNode : currentEdge.fromNode
  const nextNode = map.nodes[nextNodeId]
  if (!nextNode) return

  const nextEdgeId = resolveNextEdge(nextNode, train.currentEdgeId, adj)
  if (!nextEdgeId) return
  if (nextNode.signalState === 'red') return

  train.state = 'moving'
  train.speed = RESUME_SPEED
}

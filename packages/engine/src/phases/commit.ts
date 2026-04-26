import type { EngineEvent, RailMap, TrainPhysics } from '../types'

/**
 * Phase 3：把意图提交为状态变化。
 * - 释放旧边占用；占用新边
 * - 根据新边拓扑自动设 direction
 * - 维护 visitedPath（保留最近 20 段，用于尾部渲染）
 * - 消费 path[0] 当且仅当其匹配 nextEdgeId
 */
export function commitMoves(
  trains: TrainPhysics[],
  map: RailMap,
  tick: number,
  events: EngineEvent[],
): void {
  for (const train of trains) {
    if (!train.nextMoveIntent) continue

    const oldEdgeId = train.currentEdgeId
    const oldEdge = map.edges[oldEdgeId]
    if (oldEdge && oldEdge.occupiedBy === train.id) {
      oldEdge.occupiedBy = null
    }

    train.visitedPath = train.visitedPath ?? []
    train.visitedPath.unshift(oldEdgeId)
    if (train.visitedPath.length > 20) train.visitedPath.pop()

    const currentEdge = map.edges[oldEdgeId]
    if (!currentEdge) {
      train.nextMoveIntent = undefined
      continue
    }

    const arrivalNodeId =
      train.direction === 1 ? currentEdge.toNode : currentEdge.fromNode

    const nextEdgeId = train.nextMoveIntent.targetEdgeId
    const nextEdge = map.edges[nextEdgeId]
    if (!nextEdge) {
      train.state = 'stopped'
      train.nextMoveIntent = undefined
      events.push({
        tick,
        kind: 'invariant_violation',
        rule: 'commit_missing_next_edge',
        detail: { trainId: train.id, edgeId: nextEdgeId },
      })
      continue
    }

    nextEdge.occupiedBy = train.id

    if (nextEdge.fromNode === arrivalNodeId) {
      train.direction = 1
      train.position = train.nextMoveIntent.overflowDistance
    } else if (nextEdge.toNode === arrivalNodeId) {
      train.direction = -1
      train.position = nextEdge.length - train.nextMoveIntent.overflowDistance
    } else {
      events.push({
        tick,
        kind: 'invariant_violation',
        rule: 'edge_discontinuity',
        detail: { trainId: train.id, from: oldEdgeId, to: nextEdgeId },
      })
      train.position = train.nextMoveIntent.overflowDistance
    }

    train.currentEdgeId = nextEdgeId

    if (train.path && train.path.length > 0 && train.path[0] === nextEdgeId) {
      train.path.shift()
    }

    events.push({
      tick,
      kind: 'enter_edge',
      trainId: train.id,
      from: oldEdgeId,
      to: nextEdgeId,
    })

    train.nextMoveIntent = undefined
  }
}

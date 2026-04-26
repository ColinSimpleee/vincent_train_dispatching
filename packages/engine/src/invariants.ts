import type { AdjacencyIndex } from './adjacency'
import { resolveNextEdge } from './adjacency'
import type { EngineState, Invariant } from './types'

let DEV_MODE = false

export function setDevMode(on: boolean): void {
  DEV_MODE = on
}

export function isDevMode(): boolean {
  return DEV_MODE
}

export interface InvariantCtx {
  state: EngineState
  adj: AdjacencyIndex
}

type Check = (ctx: InvariantCtx, out: Invariant[]) => void
const CHECKS: Check[] = []

export function _registerCheck(check: Check): void {
  CHECKS.push(check)
}

/**
 * 检查所有不变量；返回违反列表。
 * 调用方决定是否抛错（dev throw / prod emit event）。
 */
export function assertInvariants(state: EngineState, adj: AdjacencyIndex): Invariant[] {
  const violations: Invariant[] = []
  const ctx: InvariantCtx = { state, adj }
  for (const check of CHECKS) check(ctx, violations)
  return violations
}

// ============================================================================
// 不变量规则
// ============================================================================

const R1_THRESHOLD_TICKS = 60

/** R1: 列车 state=moving 但 speed=0 持续超过阈值 */
export function invariantR1MovingButZeroSpeed(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if (t.state === 'moving' && t.speed === 0 && (t.staleStoppedTicks ?? 0) > R1_THRESHOLD_TICKS) {
      out.push({
        rule: 'R1_moving_zero_speed',
        detail: { trainId: t.id, ticks: t.staleStoppedTicks },
      })
    }
  }
}
_registerCheck(invariantR1MovingButZeroSpeed)

const R2_THRESHOLD_TICKS = 120

/** R2: stopped 列车应能恢复但持续未恢复 */
export function invariantR2StuckResumable(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if (t.state !== 'stopped') continue
    if ((t.stuckResumableTicks ?? 0) <= R2_THRESHOLD_TICKS) continue
    const edge = ctx.state.railMap.edges[t.currentEdgeId]
    if (!edge) continue
    const dir = t.direction
    const distToBound = dir === 1 ? edge.length - t.position : t.position
    if (distToBound > 0.1) continue
    const nextNodeId = dir === 1 ? edge.toNode : edge.fromNode
    const nextNode = ctx.state.railMap.nodes[nextNodeId]
    if (!nextNode) continue
    if (nextNode.signalState === 'red') continue
    const nextEdgeId = resolveNextEdge(nextNode, t.currentEdgeId, ctx.adj)
    if (!nextEdgeId) continue
    out.push({
      rule: 'R2_stuck_resumable',
      detail: { trainId: t.id, ticks: t.stuckResumableTicks, edgeId: t.currentEdgeId },
    })
  }
}
_registerCheck(invariantR2StuckResumable)

const R3_THRESHOLD_TICKS = 3600

/** R3: handover 后超时未移除 */
export function invariantR3HandoverNotRemoved(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if (t.isHandedOver && (t.postHandoverTicks ?? 0) > R3_THRESHOLD_TICKS) {
      out.push({
        rule: 'R3_handover_not_removed',
        detail: { trainId: t.id, ticks: t.postHandoverTicks },
      })
    }
  }
}
_registerCheck(invariantR3HandoverNotRemoved)

/** R4: path 空但仍 moving */
export function invariantR4EmptyPathMoving(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if ((!t.path || t.path.length === 0) && t.state === 'moving') {
      out.push({
        rule: 'R4_empty_path_moving',
        detail: { trainId: t.id, edgeId: t.currentEdgeId },
      })
    }
  }
}
_registerCheck(invariantR4EmptyPathMoving)

/** R5: 边占用与列车 currentEdgeId 不一致 */
export function invariantR5OccupancyMismatch(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if (t.isHandedOver) continue
    const edge = ctx.state.railMap.edges[t.currentEdgeId]
    if (!edge) continue
    if (edge.occupiedBy !== null && edge.occupiedBy !== t.id) {
      out.push({
        rule: 'R5_occupancy_mismatch',
        detail: { trainId: t.id, edgeId: t.currentEdgeId, occupiedBy: edge.occupiedBy },
      })
    }
  }
}
_registerCheck(invariantR5OccupancyMismatch)

/** R6: direction 取值非法 */
export function invariantR6BadDirection(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if (t.direction !== 1 && t.direction !== -1) {
      out.push({
        rule: 'R6_bad_direction',
        detail: { trainId: t.id, direction: t.direction },
      })
    }
  }
}
_registerCheck(invariantR6BadDirection)

/** R7: currentEdgeId 必须存在于 railMap */
export function invariantR7MissingEdge(ctx: InvariantCtx, out: Invariant[]): void {
  for (const t of ctx.state.trains) {
    if (!ctx.state.railMap.edges[t.currentEdgeId]) {
      out.push({
        rule: 'R7_missing_edge',
        detail: { trainId: t.id, edgeId: t.currentEdgeId },
      })
    }
  }
}
_registerCheck(invariantR7MissingEdge)

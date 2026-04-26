import type { EngineEvent, TrainPhysics } from '../types'

/**
 * Phase 0：乘客逻辑。
 * BOARDING 状态每 tick 递减 boardingTimer；归零转 READY 并发出 dwell_end 事件。
 * mutates train。
 */
export function handlePassenger(
  train: TrainPhysics,
  tick: number,
  events: EngineEvent[],
): void {
  if (train.passengerState !== 'BOARDING') return
  const next = (train.boardingTimer ?? 0) - 1
  train.boardingTimer = next > 0 ? next : 0
  if (train.boardingTimer === 0) {
    train.passengerState = 'READY'
    events.push({
      tick,
      kind: 'dwell_end',
      trainId: train.id,
      edgeId: train.currentEdgeId,
    })
  }
}

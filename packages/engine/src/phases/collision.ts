import { CAR_PITCH } from '../constants'
import type { EngineEvent, TrainPhysics } from '../types'

export function getTrainLength(train: TrainPhysics): number {
  const carCount = train.isCoupled ? 16 : 8
  return carCount * CAR_PITCH
}

function overlap(h1: number, t1: number, h2: number, t2: number): boolean {
  // train head 在前进方向的端点；tail = head - length。
  // h1/t1/h2/t2 都是同一坐标系下的标量；位置区间 [t,h]。
  const completelyBefore = h1 < t2
  const completelyAfter = t1 > h2
  return !(completelyBefore || completelyAfter)
}

/**
 * Phase 1.5：物理碰撞检测。
 * 同一边上两列重叠 → 发 collision 事件（不抛错；step 由调用方统一处理后果）。
 */
export function detectCollisions(
  trains: TrainPhysics[],
  tick: number,
  events: EngineEvent[],
): void {
  for (let i = 0; i < trains.length; i++) {
    for (let j = i + 1; j < trains.length; j++) {
      const a = trains[i]!
      const b = trains[j]!
      if (a.isHandedOver || b.isHandedOver) continue
      if (a.currentEdgeId !== b.currentEdgeId) continue
      const aHead = a.position
      const aTail = a.position - getTrainLength(a)
      const bHead = b.position
      const bTail = b.position - getTrainLength(b)
      if (overlap(aHead, aTail, bHead, bTail)) {
        events.push({
          tick,
          kind: 'collision',
          trainA: a.id,
          trainB: b.id,
          edgeId: a.currentEdgeId,
        })
      }
    }
  }
}

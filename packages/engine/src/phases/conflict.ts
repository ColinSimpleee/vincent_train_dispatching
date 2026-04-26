import type { EngineEvent, TrainPhysics } from '../types'

/**
 * Phase 2：解决"同 tick 抢占同一目标边"的竞争条件。
 * 第二个声明同一目标的列车作为 trainA（"撞上来的那个"），先到的为 trainB。
 */
export function resolveConflicts(
  trains: TrainPhysics[],
  tick: number,
  events: EngineEvent[],
): void {
  const claims = new Map<string, string>()
  for (const train of trains) {
    if (!train.nextMoveIntent) continue
    const target = train.nextMoveIntent.targetEdgeId
    if (claims.has(target)) {
      events.push({
        tick,
        kind: 'collision',
        trainA: train.id,
        trainB: claims.get(target)!,
        edgeId: target,
      })
    }
    claims.set(target, train.id)
  }
}

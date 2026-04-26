import { describe, expect, it } from 'vitest'
import type { EngineEvent, TrainPhysics } from '@engine'
import { resolveConflicts } from '@engine/phases/conflict'

function trainWithIntent(id: string, target: string): TrainPhysics {
  return {
    id,
    modelType: 'CR400AF',
    isCoupled: false,
    currentEdgeId: 'src',
    position: 50,
    speed: 60,
    state: 'moving',
    direction: 1,
    path: [],
    visitedPath: [],
    nextMoveIntent: { targetEdgeId: target, overflowDistance: 5 },
  }
}

describe('resolveConflicts', () => {
  it('两列声明同一目标边 → 发出 collision 事件', () => {
    const a = trainWithIntent('A', 'e_target')
    const b = trainWithIntent('B', 'e_target')
    const events: EngineEvent[] = []
    resolveConflicts([a, b], 100, events)
    expect(events.find((e) => e.kind === 'collision')).toMatchObject({
      kind: 'collision',
      trainA: 'B',
      trainB: 'A',
      edgeId: 'e_target',
    })
  })

  it('目标边不同 → 无冲突', () => {
    const a = trainWithIntent('A', 'e1')
    const b = trainWithIntent('B', 'e2')
    const events: EngineEvent[] = []
    resolveConflicts([a, b], 100, events)
    expect(events.filter((e) => e.kind === 'collision')).toHaveLength(0)
  })

  it('无意图的列车不参与', () => {
    const a = trainWithIntent('A', 'e1')
    a.nextMoveIntent = undefined
    const b = trainWithIntent('B', 'e1')
    const events: EngineEvent[] = []
    resolveConflicts([a, b], 100, events)
    expect(events.filter((e) => e.kind === 'collision')).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { EngineEvent, TrainPhysics } from '@engine'
import { detectCollisions, getTrainLength } from '@engine/phases/collision'

function train(over: Partial<TrainPhysics>): TrainPhysics {
  return {
    id: 't',
    modelType: 'CR400AF',
    isCoupled: false,
    currentEdgeId: 'e1',
    position: 0,
    speed: 0,
    state: 'stopped',
    direction: 1,
    path: [],
    visitedPath: [],
    ...over,
  }
}

describe('detectCollisions', () => {
  it('两列同边重叠 → 发出 collision 事件', () => {
    const t1 = train({ id: 't1', position: 100, currentEdgeId: 'e1', isCoupled: false })
    const t2 = train({ id: 't2', position: 110, currentEdgeId: 'e1', isCoupled: false })
    const events: EngineEvent[] = []
    detectCollisions([t1, t2], 7, events)
    expect(events.find((e) => e.kind === 'collision')).toMatchObject({
      kind: 'collision',
      trainA: 't1',
      trainB: 't2',
      edgeId: 'e1',
    })
  })

  it('不同边的两列不碰撞', () => {
    const t1 = train({ id: 't1', currentEdgeId: 'e1', position: 100 })
    const t2 = train({ id: 't2', currentEdgeId: 'e2', position: 100 })
    const events: EngineEvent[] = []
    detectCollisions([t1, t2], 7, events)
    expect(events.filter((e) => e.kind === 'collision')).toHaveLength(0)
  })

  it('已移交的列车跳过碰撞检测', () => {
    const t1 = train({ id: 't1', position: 100, currentEdgeId: 'e1', isHandedOver: true })
    const t2 = train({ id: 't2', position: 105, currentEdgeId: 'e1' })
    const events: EngineEvent[] = []
    detectCollisions([t1, t2], 7, events)
    expect(events.filter((e) => e.kind === 'collision')).toHaveLength(0)
  })

  it('isCoupled=true → 列车长度翻倍', () => {
    expect(getTrainLength({ ...train({}), isCoupled: false })).toBe(8 * 30)
    expect(getTrainLength({ ...train({}), isCoupled: true })).toBe(16 * 30)
  })

  it('间距大于双方车长之和 → 不碰撞', () => {
    const t1 = train({ id: 't1', position: 100, currentEdgeId: 'e1' })
    const t2 = train({ id: 't2', position: 500, currentEdgeId: 'e1' })
    const events: EngineEvent[] = []
    detectCollisions([t1, t2], 7, events)
    expect(events.filter((e) => e.kind === 'collision')).toHaveLength(0)
  })
})

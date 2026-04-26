import { describe, expect, it } from 'vitest'
import type { EngineEvent, RailMap, TrainPhysics } from '@engine'
import { commitMoves } from '@engine/phases/commit'

function makeMap(): RailMap {
  return {
    nodes: {
      a: { id: 'a', x: 0, y: 0, type: 'connector' },
      b: { id: 'b', x: 1, y: 0, type: 'connector' },
      c: { id: 'c', x: 2, y: 0, type: 'connector' },
    },
    edges: {
      e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 100, occupiedBy: null },
      e_bc: { id: 'e_bc', fromNode: 'b', toNode: 'c', length: 100, occupiedBy: null },
    },
    platforms: [],
  }
}

function makeTrain(over: Partial<TrainPhysics> = {}): TrainPhysics {
  return {
    id: 't1',
    modelType: 'CR400AF',
    isCoupled: false,
    currentEdgeId: 'e_ab',
    position: 100,
    speed: 60,
    state: 'moving',
    direction: 1,
    path: ['e_bc'],
    visitedPath: [],
    nextMoveIntent: { targetEdgeId: 'e_bc', overflowDistance: 5 },
    ...over,
  }
}

describe('commitMoves', () => {
  it('迁移到新边 + 释放旧边占用 + 占用新边', () => {
    const map = makeMap()
    map.edges.e_ab!.occupiedBy = 't1'
    const t = makeTrain()
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.currentEdgeId).toBe('e_bc')
    expect(map.edges.e_ab!.occupiedBy).toBeNull()
    expect(map.edges.e_bc!.occupiedBy).toBe('t1')
    expect(t.position).toBe(5)
    expect(t.nextMoveIntent).toBeUndefined()
  })

  it('从 b.outgoing(e_bc) 进入 e_bc → direction=1', () => {
    const map = makeMap()
    const t = makeTrain()
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.direction).toBe(1)
  })

  it('反向到达节点 → 自动设 direction=-1', () => {
    const map: RailMap = {
      nodes: {
        a: { id: 'a', x: 0, y: 0, type: 'connector' },
        b: { id: 'b', x: 1, y: 0, type: 'connector' },
        c: { id: 'c', x: 2, y: 0, type: 'connector' },
      },
      edges: {
        e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 100, occupiedBy: null },
        e_cb: { id: 'e_cb', fromNode: 'c', toNode: 'b', length: 100, occupiedBy: null },
      },
      platforms: [],
    }
    const t = makeTrain({
      currentEdgeId: 'e_ab',
      direction: 1,
      position: 100,
      path: ['e_cb'],
      nextMoveIntent: { targetEdgeId: 'e_cb', overflowDistance: 5 },
    })
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.direction).toBe(-1)
    expect(t.position).toBe(95)
  })

  it('发出 enter_edge 事件', () => {
    const map = makeMap()
    const t = makeTrain()
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(events.find((e) => e.kind === 'enter_edge')).toMatchObject({
      from: 'e_ab',
      to: 'e_bc',
      trainId: 't1',
    })
  })

  it('visitedPath 记录历史，最多 20 条', () => {
    const map = makeMap()
    const t = makeTrain({ visitedPath: new Array(20).fill('old') })
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.visitedPath).toHaveLength(20)
    expect(t.visitedPath[0]).toBe('e_ab')
  })

  it('path 顶端正是 nextEdge → 消费 path', () => {
    const map = makeMap()
    const t = makeTrain({ path: ['e_bc', 'e_cd'] })
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.path).toEqual(['e_cd'])
  })

  it('目标边不存在 → 停车并发 invariant_violation', () => {
    const map = makeMap()
    const t = makeTrain({
      nextMoveIntent: { targetEdgeId: 'no_such', overflowDistance: 5 },
    })
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.state).toBe('stopped')
    expect(events.find((e) => e.kind === 'invariant_violation')).toBeDefined()
  })

  it('无意图 → 不变更', () => {
    const map = makeMap()
    const t = makeTrain({ nextMoveIntent: undefined })
    const events: EngineEvent[] = []
    commitMoves([t], map, 100, events)
    expect(t.currentEdgeId).toBe('e_ab')
  })
})

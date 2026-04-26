import { describe, expect, it } from 'vitest'
import type { EngineEvent, RailMap, TrainPhysics } from '@engine'
import { buildAdjacency, createPRNG } from '@engine'
import { computeIntent, tryResume } from '@engine/phases/intent'

function makeMap(): RailMap {
  return {
    nodes: {
      a: { id: 'a', x: 0, y: 0, type: 'connector', signalState: 'green' },
      b: { id: 'b', x: 100, y: 0, type: 'connector', signalState: 'green' },
      c: { id: 'c', x: 200, y: 0, type: 'connector', signalState: 'green' },
    },
    edges: {
      e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 100, occupiedBy: null },
      e_bc: {
        id: 'e_bc',
        fromNode: 'b',
        toNode: 'c',
        length: 100,
        occupiedBy: null,
        isPlatform: true,
      },
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
    position: 0,
    speed: 60,
    state: 'moving',
    direction: 1,
    path: [],
    visitedPath: [],
    ...over,
  }
}

describe('computeIntent — 常规移动', () => {
  it('未到边界，position 前进 speed*dt', () => {
    const map = makeMap()
    const t = makeTrain({ position: 0, speed: 60, direction: 1 })
    const adj = buildAdjacency(map)
    const events: EngineEvent[] = []
    const rng = createPRNG(1)
    computeIntent(t, map, adj, 1, 100, events, rng)
    expect(t.position).toBe(60)
    expect(t.nextMoveIntent).toBeUndefined()
  })

  it('到达边界 + 下一节点 signal=green → 设置 nextMoveIntent', () => {
    const map = makeMap()
    const t = makeTrain({ position: 95, speed: 60, direction: 1, path: ['e_bc'] })
    const adj = buildAdjacency(map)
    const events: EngineEvent[] = []
    const rng = createPRNG(1)
    computeIntent(t, map, adj, 1, 100, events, rng)
    expect(t.nextMoveIntent).toBeDefined()
    expect(t.nextMoveIntent!.targetEdgeId).toBe('e_bc')
  })

  it('到达边界 + 下一节点 signal=red → 停车并发出 signal_pass', () => {
    const map = makeMap()
    map.nodes.b!.signalState = 'red'
    const t = makeTrain({ position: 95, speed: 60, direction: 1, path: ['e_bc'] })
    const adj = buildAdjacency(map)
    const events: EngineEvent[] = []
    const rng = createPRNG(1)
    computeIntent(t, map, adj, 1, 100, events, rng)
    expect(t.state).toBe('stopped')
    expect(t.position).toBe(100)
    expect(t.speed).toBe(0)
    expect(events.find((e) => e.kind === 'signal_pass')).toBeDefined()
  })

  it('到达 platform 边 + 未服务过 → 停车进入 BOARDING + 发 dwell_start', () => {
    const map = makeMap()
    const t = makeTrain({ currentEdgeId: 'e_bc', position: 95, direction: 1 })
    const adj = buildAdjacency(map)
    const events: EngineEvent[] = []
    const rng = createPRNG(7)
    computeIntent(t, map, adj, 1, 100, events, rng)
    expect(t.state).toBe('stopped')
    expect(t.passengerState).toBe('BOARDING')
    expect(t.lastServicedEdgeId).toBe('e_bc')
    expect(events.find((e) => e.kind === 'dwell_start')).toBeDefined()
  })

  it('platform 已服务过 → 不触发停站', () => {
    const map = makeMap()
    const t = makeTrain({ currentEdgeId: 'e_bc', position: 0, lastServicedEdgeId: 'e_bc' })
    const adj = buildAdjacency(map)
    const events: EngineEvent[] = []
    const rng = createPRNG(1)
    computeIntent(t, map, adj, 1, 100, events, rng)
    expect(t.state).toBe('moving')
  })

  it('当前边 ID 无效 → 停车并发出 invariant_violation', () => {
    const map = makeMap()
    const t = makeTrain({ currentEdgeId: 'no_such_edge' })
    const adj = buildAdjacency(map)
    const events: EngineEvent[] = []
    const rng = createPRNG(1)
    computeIntent(t, map, adj, 1, 100, events, rng)
    expect(t.state).toBe('stopped')
    expect(events.find((e) => e.kind === 'invariant_violation')).toBeDefined()
  })

  it('停站 dwell 时长由 PRNG 决定（确定性）', () => {
    const make = (seed: number) => {
      const map = makeMap()
      const t = makeTrain({ currentEdgeId: 'e_bc', position: 95, direction: 1 })
      const adj = buildAdjacency(map)
      const events: EngineEvent[] = []
      const rng = createPRNG(seed)
      computeIntent(t, map, adj, 1, 100, events, rng)
      return t.boardingTimer
    }
    expect(make(1)).toBe(make(1))
    expect(make(1)).not.toBe(make(2))
  })
})

describe('tryResume', () => {
  it('停站中 boardingTimer 未到不恢复', () => {
    const map = makeMap()
    const t = makeTrain({
      state: 'stopped',
      speed: 0,
      currentEdgeId: 'e_ab',
      position: 100,
      passengerState: 'BOARDING',
      boardingTimer: 100,
    })
    const adj = buildAdjacency(map)
    tryResume(t, map, adj)
    expect(t.state).toBe('stopped')
  })

  it('passengerState=READY 仍阻止 resume（设计如此：要等 DEPART 命令清除）', () => {
    const map = makeMap()
    const t = makeTrain({
      state: 'stopped',
      speed: 0,
      currentEdgeId: 'e_ab',
      position: 100,
      passengerState: 'READY',
    })
    const adj = buildAdjacency(map)
    tryResume(t, map, adj)
    expect(t.state).toBe('stopped')
  })

  it('无 passengerState + 边界 + 下条边 signal=green → resume', () => {
    const map = makeMap()
    const t = makeTrain({
      state: 'stopped',
      speed: 0,
      currentEdgeId: 'e_ab',
      position: 100,
    })
    const adj = buildAdjacency(map)
    tryResume(t, map, adj)
    expect(t.state).toBe('moving')
    expect(t.speed).toBeGreaterThan(0)
  })

  it('signal=red 时不 resume', () => {
    const map = makeMap()
    map.nodes.b!.signalState = 'red'
    const t = makeTrain({
      state: 'stopped',
      speed: 0,
      currentEdgeId: 'e_ab',
      position: 100,
    })
    const adj = buildAdjacency(map)
    tryResume(t, map, adj)
    expect(t.state).toBe('stopped')
  })
})

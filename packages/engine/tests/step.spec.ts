import { describe, expect, it } from 'vitest'
import type { EngineState, RailMap, TrainPhysics } from '@engine'
import { createPRNG, step } from '@engine'

function makeRailMap(): RailMap {
  return {
    nodes: {
      a: { id: 'a', x: 0, y: 0, type: 'connector', signalState: 'green' },
      b: { id: 'b', x: 1, y: 0, type: 'connector', signalState: 'green' },
      c: { id: 'c', x: 2, y: 0, type: 'connector', signalState: 'green' },
    },
    edges: {
      e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 60, occupiedBy: null },
      e_bc: { id: 'e_bc', fromNode: 'b', toNode: 'c', length: 60, occupiedBy: null },
    },
    platforms: [],
  }
}

function makeTrain(): TrainPhysics {
  return {
    id: 't1',
    modelType: 'CR400AF',
    isCoupled: false,
    currentEdgeId: 'e_ab',
    position: 0,
    speed: 60,
    state: 'moving',
    direction: 1,
    path: ['e_bc'],
    visitedPath: [],
  }
}

function initialState(): EngineState {
  const map = makeRailMap()
  map.edges.e_ab!.occupiedBy = 't1'
  return {
    tick: 0,
    trains: [makeTrain()],
    railMap: map,
    rng: createPRNG(1),
  }
}

describe('step', () => {
  it('一个 tick 推进 tick 计数', () => {
    const s = initialState()
    const r = step(s, [])
    expect(r.next.tick).toBe(1)
  })

  it('黄金路径：列车经 e_ab → e_bc，最终在 e_bc', () => {
    let s = initialState()
    for (let i = 0; i < 65; i++) {
      const r = step(s, [])
      s = r.next
    }
    expect(s.trains[0]!.currentEdgeId).toBe('e_bc')
  })

  it('确定性：相同 seed + 相同输入 → 相同结果', () => {
    let a = initialState()
    let b = initialState()
    for (let i = 0; i < 200; i++) {
      a = step(a, []).next
      b = step(b, []).next
    }
    expect(a.trains[0]!.position).toBe(b.trains[0]!.position)
    expect(a.trains[0]!.currentEdgeId).toBe(b.trains[0]!.currentEdgeId)
    expect(a.rng.state).toBe(b.rng.state)
  })

  it('signal_toggle 输入切换信号灯', () => {
    const s = initialState()
    const r = step(s, [{ tick: 0, type: 'signal_toggle', payload: { nodeId: 'b' } }])
    expect(r.next.railMap.nodes.b!.signalState).toBe('red')
    expect(r.events.find((e) => e.kind === 'signal_toggled')).toBeDefined()
  })

  it('switch_toggle 输入循环 switchState', () => {
    const s = initialState()
    s.railMap.nodes.b!.type = 'switch'
    s.railMap.nodes.b!.switchState = 0
    s.railMap.edges.e_bc2 = {
      id: 'e_bc2',
      fromNode: 'b',
      toNode: 'c',
      length: 60,
      occupiedBy: null,
    }
    const r = step(s, [{ tick: 0, type: 'switch_toggle', payload: { nodeId: 'b' } }])
    expect(r.next.railMap.nodes.b!.switchState).toBe(1)
  })

  it('events 中包含 enter_edge 当列车跨边时', () => {
    let s = initialState()
    let crossed = false
    for (let i = 0; i < 70 && !crossed; i++) {
      const r = step(s, [])
      s = r.next
      if (r.events.some((e) => e.kind === 'enter_edge')) crossed = true
    }
    expect(crossed).toBe(true)
  })
})

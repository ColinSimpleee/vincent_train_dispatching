import { describe, expect, it } from 'vitest'
import type { EngineState, RailMap, TrainPhysics } from '@engine'
import { createPRNG } from '@engine'
import { assertInvariants, isDevMode, setDevMode } from '@engine/invariants'
import { buildAdjacency } from '@engine/adjacency'

function emptyState(): EngineState {
  return {
    tick: 0,
    trains: [],
    rng: createPRNG(1),
    railMap: { nodes: {}, edges: {}, platforms: [] },
  }
}

function stateWith(over: Partial<TrainPhysics>, mapOver?: Partial<RailMap>): EngineState {
  const base: TrainPhysics = {
    id: 't1',
    modelType: 'CR400AF',
    isCoupled: false,
    currentEdgeId: 'e_ab',
    position: 50,
    speed: 0,
    state: 'stopped',
    direction: 1,
    path: [],
    visitedPath: [],
  }
  const map: RailMap = mapOver ?? {
    nodes: {
      a: { id: 'a', x: 0, y: 0, type: 'connector', signalState: 'green' },
      b: { id: 'b', x: 100, y: 0, type: 'connector', signalState: 'green' },
    },
    edges: {
      e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 100, occupiedBy: null },
    },
    platforms: [],
  }
  return {
    tick: 0,
    trains: [{ ...base, ...over }],
    rng: createPRNG(1),
    railMap: map,
  }
}

describe('assertInvariants 框架', () => {
  it('空状态无违反', () => {
    const s = emptyState()
    expect(assertInvariants(s, buildAdjacency(s.railMap))).toEqual([])
  })

  it('setDevMode/isDevMode 切换可读', () => {
    const before = isDevMode()
    setDevMode(true)
    expect(isDevMode()).toBe(true)
    setDevMode(false)
    expect(isDevMode()).toBe(false)
    setDevMode(before)
  })
})

describe('R1 — moving 但 speed=0', () => {
  it('staleStoppedTicks > 60 报', () => {
    const s = stateWith({ state: 'moving', speed: 0, staleStoppedTicks: 61 })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R1_moving_zero_speed')).toBeDefined()
  })
  it('staleStoppedTicks ≤ 60 不报', () => {
    const s = stateWith({ state: 'moving', speed: 0, staleStoppedTicks: 60 })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R1_moving_zero_speed')).toBeUndefined()
  })
})

describe('R2 — stuck stopped 应能恢复但持续未恢复', () => {
  it('stuckResumableTicks > 120 + 边界 + signal=green → 报', () => {
    const map: RailMap = {
      nodes: {
        a: { id: 'a', x: 0, y: 0, type: 'connector', signalState: 'green' },
        b: { id: 'b', x: 100, y: 0, type: 'connector', signalState: 'green' },
        c: { id: 'c', x: 200, y: 0, type: 'connector', signalState: 'green' },
      },
      edges: {
        e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 100, occupiedBy: null },
        e_bc: { id: 'e_bc', fromNode: 'b', toNode: 'c', length: 100, occupiedBy: null },
      },
      platforms: [],
    }
    const s = stateWith(
      {
        state: 'stopped',
        speed: 0,
        currentEdgeId: 'e_ab',
        position: 100,
        stuckResumableTicks: 121,
      },
      map,
    )
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R2_stuck_resumable')).toBeDefined()
  })
})

describe('R3 — handover 后未移除', () => {
  it('postHandoverTicks > 3600 → 报', () => {
    const s = stateWith({ isHandedOver: true, postHandoverTicks: 3601 })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R3_handover_not_removed')).toBeDefined()
  })
})

describe('R4 — path 空但 moving', () => {
  it('path=[] + state=moving → 报', () => {
    const s = stateWith({ state: 'moving', speed: 60, path: [] })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R4_empty_path_moving')).toBeDefined()
  })
  it('path=[] + state=stopped → 不报', () => {
    const s = stateWith({ state: 'stopped', speed: 0, path: [] })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R4_empty_path_moving')).toBeUndefined()
  })
})

describe('R5 — occupiedBy 与 currentEdgeId 不一致', () => {
  it('列车在 e_ab，但 e_ab.occupiedBy 是别人 → 报', () => {
    const s = stateWith({})
    s.railMap.edges.e_ab!.occupiedBy = 'OTHER'
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R5_occupancy_mismatch')).toBeDefined()
  })
})

describe('R6 — direction 取值非法', () => {
  it('direction=0 → 报', () => {
    const s = stateWith({ direction: 0 as 1 | -1 })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R6_bad_direction')).toBeDefined()
  })
})

describe('R7 — currentEdgeId 必须存在', () => {
  it('列车在不存在的边 → 报', () => {
    const s = stateWith({ currentEdgeId: 'no_such' })
    const v = assertInvariants(s, buildAdjacency(s.railMap))
    expect(v.find((x) => x.rule === 'R7_missing_edge')).toBeDefined()
  })
})

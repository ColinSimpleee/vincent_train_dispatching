import { describe, expect, it } from 'vitest'
import { ReplayPlayer } from '@/game/ReplayPlayer'
import type { EngineEvent, EngineInput, EngineState, RailMap } from '@engine'
import { createPRNG } from '@engine'

function emptyMap(): RailMap {
  return {
    nodes: { a: { id: 'a', x: 0, y: 0, type: 'connector', signalState: 'green' } },
    edges: {},
    platforms: [],
  }
}

describe('ReplayPlayer', () => {
  it('给定 seed + 0 输入 + 100 tick → 与原引擎跑出相同事件', () => {
    const seed = 42
    const initialState: EngineState = {
      tick: 0,
      trains: [],
      railMap: emptyMap(),
      rng: createPRNG(seed),
    }
    const player = new ReplayPlayer({ initialState, inputs: [], expectedEvents: [] })
    const result = player.run(100)
    expect(result.divergedAt).toBeNull()
    expect(result.finalTick).toBe(100)
  })

  it('期望事件流不匹配 → 返回 divergedAt = 第一处分叉 tick', () => {
    const initialState: EngineState = {
      tick: 0,
      trains: [],
      railMap: emptyMap(),
      rng: createPRNG(1),
    }
    const fakeExpected: EngineEvent[] = [
      { tick: 5, kind: 'collision', trainA: 'X', trainB: 'Y', edgeId: 'e' },
    ]
    const player = new ReplayPlayer({
      initialState,
      inputs: [],
      expectedEvents: fakeExpected,
    })
    const r = player.run(10)
    expect(r.divergedAt).toBe(5)
  })

  it('喂 signal_toggle 输入后下一 tick 信号变红', () => {
    const initialState: EngineState = {
      tick: 0,
      trains: [],
      railMap: emptyMap(),
      rng: createPRNG(1),
    }
    const inputs: EngineInput[] = [
      { tick: 0, type: 'signal_toggle', payload: { nodeId: 'a' } },
    ]
    const player = new ReplayPlayer({ initialState, inputs, expectedEvents: [] })
    player.run(1)
    expect(player.currentState.railMap.nodes.a!.signalState).toBe('red')
  })
})

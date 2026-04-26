import { describe, expect, it } from 'vitest'
import {
  createPRNG,
  randomChoice,
  randomFloat,
  setDevMode,
  step,
  type EngineInput,
  type EngineState,
  type RailMap,
} from '@engine'

function buildSyntheticMap(): RailMap {
  return {
    nodes: {
      n_in: { id: 'n_in', x: 0, y: 0, type: 'connector', signalState: 'green' },
      n_sw: {
        id: 'n_sw',
        x: 100,
        y: 0,
        type: 'switch',
        signalState: 'green',
        switchState: 0,
      },
      n_t1e: { id: 'n_t1e', x: 200, y: -10, type: 'connector' },
      n_t2e: { id: 'n_t2e', x: 200, y: 10, type: 'connector' },
      n_out: { id: 'n_out', x: 300, y: 0, type: 'endpoint' },
    },
    edges: {
      e_in: { id: 'e_in', fromNode: 'n_in', toNode: 'n_sw', length: 100, occupiedBy: null },
      t1: {
        id: 't1',
        fromNode: 'n_sw',
        toNode: 'n_t1e',
        length: 100,
        occupiedBy: null,
        isPlatform: true,
      },
      t2: {
        id: 't2',
        fromNode: 'n_sw',
        toNode: 'n_t2e',
        length: 100,
        occupiedBy: null,
        isPlatform: true,
      },
      t1_out: {
        id: 't1_out',
        fromNode: 'n_t1e',
        toNode: 'n_out',
        length: 100,
        occupiedBy: null,
      },
      t2_out: {
        id: 't2_out',
        fromNode: 'n_t2e',
        toNode: 'n_out',
        length: 100,
        occupiedBy: null,
      },
    },
    platforms: [],
  }
}

function initialState(seed: number): EngineState {
  return { tick: 0, trains: [], railMap: buildSyntheticMap(), rng: createPRNG(seed) }
}

function randomInput(state: EngineState, tick: number): EngineInput | null {
  const r = randomFloat(state.rng)
  if (r < 0.5) return null
  if (r < 0.8) {
    const switches = ['n_sw']
    return {
      tick,
      type: 'switch_toggle',
      payload: { nodeId: randomChoice(state.rng, switches) },
    }
  }
  const signals = ['n_in', 'n_sw']
  return {
    tick,
    type: 'signal_toggle',
    payload: { nodeId: randomChoice(state.rng, signals) },
  }
}

function runFuzz(seedCount: number, ticksPerRun: number): { violations: number } {
  setDevMode(false)
  let totalViolations = 0
  for (let seed = 1; seed <= seedCount; seed++) {
    let s = initialState(seed)
    for (let i = 0; i < ticksPerRun; i++) {
      const input = randomInput(s, s.tick)
      const r = step(s, input ? [input] : [])
      s = r.next
      for (const e of r.events) {
        if (e.kind === 'invariant_violation') totalViolations++
      }
    }
  }
  return { violations: totalViolations }
}

describe('Fuzz smoke：10 局 × 1k tick（默认跑）', () => {
  it('不触发不变量违反', () => {
    const { violations } = runFuzz(10, 1_000)
    expect(violations).toBe(0)
  }, 60_000)
})

describe('Fuzz：100 局 × 100k tick（CI 跑，需 RUN_FUZZ=1）', () => {
  it.skipIf(!process.env.RUN_FUZZ)('100 seeds passes invariants', () => {
    const { violations } = runFuzz(100, 100_000)
    expect(violations).toBe(0)
  }, 600_000)
})

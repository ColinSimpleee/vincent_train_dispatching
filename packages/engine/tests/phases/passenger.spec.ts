import { describe, expect, it } from 'vitest'
import type { EngineEvent, TrainPhysics } from '@engine'
import { handlePassenger } from '@engine/phases/passenger'

function baseTrain(over: Partial<TrainPhysics> = {}): TrainPhysics {
  return {
    id: 't1',
    modelType: 'CR400AF',
    isCoupled: false,
    currentEdgeId: 't1',
    position: 0,
    speed: 0,
    state: 'stopped',
    direction: 1,
    path: [],
    visitedPath: [],
    ...over,
  }
}

describe('handlePassenger', () => {
  it('BOARDING + boardingTimer > 0 → 递减 1，状态不变', () => {
    const t = baseTrain({ passengerState: 'BOARDING', boardingTimer: 100, currentEdgeId: 't1' })
    const events: EngineEvent[] = []
    handlePassenger(t, 50, events)
    expect(t.boardingTimer).toBe(99)
    expect(t.passengerState).toBe('BOARDING')
    expect(events).toHaveLength(0)
  })

  it('BOARDING + boardingTimer 到 0 → 转 READY 并发出 dwell_end', () => {
    const t = baseTrain({ passengerState: 'BOARDING', boardingTimer: 1, currentEdgeId: 't1' })
    const events: EngineEvent[] = []
    handlePassenger(t, 50, events)
    expect(t.boardingTimer).toBe(0)
    expect(t.passengerState).toBe('READY')
    expect(events).toEqual([{ tick: 50, kind: 'dwell_end', trainId: 't1', edgeId: 't1' }])
  })

  it('非 BOARDING 状态不动', () => {
    const t = baseTrain({ passengerState: 'READY', boardingTimer: 100 })
    const events: EngineEvent[] = []
    handlePassenger(t, 50, events)
    expect(t.boardingTimer).toBe(100)
    expect(events).toHaveLength(0)
  })

  it('boardingTimer 未定义视作 0 → 立即 READY', () => {
    const t = baseTrain({ passengerState: 'BOARDING' })
    const events: EngineEvent[] = []
    handlePassenger(t, 50, events)
    expect(t.passengerState).toBe('READY')
    expect(events).toHaveLength(1)
  })
})

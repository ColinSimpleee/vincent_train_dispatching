import { describe, expect, it } from 'vitest'
import { InputRecorder } from '@/game/InputRecorder'

describe('InputRecorder', () => {
  it('record + take 清空 pending 但保留 full 流', () => {
    const r = new InputRecorder()
    r.record({ tick: 0, type: 'stop', payload: { trainId: 't' } })
    r.record({ tick: 0, type: 'stop', payload: { trainId: 'u' } })
    expect(r.take()).toHaveLength(2)
    expect(r.take()).toHaveLength(0)
    expect(r.snapshot()).toHaveLength(2)
  })

  it('reset 清空全流', () => {
    const r = new InputRecorder()
    r.record({ tick: 0, type: 'stop', payload: { trainId: 't' } })
    r.reset()
    expect(r.snapshot()).toHaveLength(0)
    expect(r.take()).toHaveLength(0)
  })
})

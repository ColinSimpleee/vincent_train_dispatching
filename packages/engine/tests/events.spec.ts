import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '@engine'
import { EventBuffer } from '@engine/events'

function ev(tick: number): EngineEvent {
  return { tick, kind: 'spawn', trainId: 't', modelType: 'CR400AF', entrance: 'L' }
}

describe('EventBuffer', () => {
  it('push 后 snapshot 顺序与压入顺序一致', () => {
    const b = new EventBuffer(10)
    b.push(ev(1))
    b.push(ev(2))
    b.push(ev(3))
    expect(b.snapshot().map((e) => e.tick)).toEqual([1, 2, 3])
  })

  it('超过容量时丢弃最早的事件', () => {
    const b = new EventBuffer(3)
    for (let i = 1; i <= 5; i++) b.push(ev(i))
    expect(b.snapshot().map((e) => e.tick)).toEqual([3, 4, 5])
  })

  it('size 跟踪当前长度', () => {
    const b = new EventBuffer(3)
    expect(b.size).toBe(0)
    b.push(ev(1))
    b.push(ev(2))
    expect(b.size).toBe(2)
    b.push(ev(3))
    b.push(ev(4))
    expect(b.size).toBe(3)
  })

  it('clear 清空但保留容量', () => {
    const b = new EventBuffer(3)
    b.push(ev(1))
    b.clear()
    expect(b.size).toBe(0)
    b.push(ev(2))
    expect(b.snapshot().map((e) => e.tick)).toEqual([2])
  })

  it('snapshot 返回独立副本（外部修改不影响内部）', () => {
    const b = new EventBuffer(3)
    b.push(ev(1))
    const s = b.snapshot()
    s.push(ev(99))
    expect(b.snapshot()).toHaveLength(1)
  })

  it('toJSON 序列化为有序数组', () => {
    const b = new EventBuffer(3)
    b.push(ev(1))
    b.push(ev(2))
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify([ev(1), ev(2)]))
  })
})

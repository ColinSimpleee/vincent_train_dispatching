import { describe, expect, it } from 'vitest'
import { EventBus } from '@/game/EventBus'
import type { EngineEvent } from '@engine'

function ev(tick: number): EngineEvent {
  return { tick, kind: 'spawn', trainId: 't', modelType: 'CR400AF', entrance: 'L' }
}

describe('EventBus', () => {
  it('emit 把事件推入缓冲且通知订阅者', () => {
    const bus = new EventBus(100)
    const seen: EngineEvent[] = []
    const off = bus.subscribe((e) => seen.push(e))
    bus.emit([ev(1), ev(2)])
    expect(seen).toHaveLength(2)
    expect(bus.snapshot()).toHaveLength(2)
    off()
    bus.emit([ev(3)])
    expect(seen).toHaveLength(2)
  })

  it('exportJSON 返回带元数据的 JSON 字符串', () => {
    const bus = new EventBus(10)
    bus.emit([ev(1)])
    const json = bus.exportJSON({ seed: 42, engineVersion: '0.1.0' })
    const obj = JSON.parse(json)
    expect(obj.seed).toBe(42)
    expect(obj.engineVersion).toBe('0.1.0')
    expect(obj.events).toHaveLength(1)
  })

  it('clear 清空但保留订阅者', () => {
    const bus = new EventBus(10)
    bus.emit([ev(1)])
    bus.clear()
    expect(bus.snapshot()).toHaveLength(0)
    let count = 0
    bus.subscribe(() => count++)
    bus.emit([ev(2)])
    expect(count).toBe(1)
  })
})

import type { EngineEvent } from './types'

/**
 * 环形事件缓冲。最近 N 条事件，超出容量丢弃最旧。
 * 不与 Vue / DOM 耦合；UI 侧通过 snapshot() 取副本驱动渲染。
 */
export class EventBuffer {
  private readonly capacity: number
  private buf: (EngineEvent | undefined)[]
  private head = 0
  private count = 0

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`EventBuffer: capacity 必须为正整数，收到 ${capacity}`)
    }
    this.capacity = capacity
    this.buf = new Array(capacity)
  }

  get size(): number {
    return this.count
  }

  push(event: EngineEvent): void {
    this.buf[this.head] = event
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** 返回时间序快照副本。 */
  snapshot(): EngineEvent[] {
    const result: EngineEvent[] = new Array(this.count)
    const start = this.count < this.capacity ? 0 : this.head
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.capacity]!
    }
    return result
  }

  clear(): void {
    this.buf = new Array(this.capacity)
    this.head = 0
    this.count = 0
  }

  toJSON(): EngineEvent[] {
    return this.snapshot()
  }
}

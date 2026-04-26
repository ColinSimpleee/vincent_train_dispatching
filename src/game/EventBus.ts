import type { EngineEvent } from '@engine'
import { EventBuffer } from '@engine'

export type EventListener = (event: EngineEvent) => void

export interface ExportMeta {
  seed: number
  engineVersion: string
  stationId?: string
  stationVersion?: string
  startedAt?: string
}

/**
 * UI 层事件总线：累积引擎事件、广播给订阅者、提供导出。
 * 不与引擎内部状态耦合；引擎用 EventBuffer，这里也用一份独立 EventBuffer。
 */
export class EventBus {
  private buffer: EventBuffer
  private listeners: Set<EventListener> = new Set()

  constructor(capacity: number) {
    this.buffer = new EventBuffer(capacity)
  }

  emit(events: EngineEvent[]): void {
    for (const e of events) {
      this.buffer.push(e)
      for (const l of this.listeners) l(e)
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot(): EngineEvent[] {
    return this.buffer.snapshot()
  }

  clear(): void {
    this.buffer.clear()
  }

  exportJSON(meta: ExportMeta): string {
    return JSON.stringify({ ...meta, events: this.buffer.snapshot() }, null, 2)
  }
}

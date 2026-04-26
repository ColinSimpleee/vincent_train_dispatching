import type { EngineEvent, EngineInput, EngineState } from '@engine'
import { step } from '@engine'

export interface ReplayInit {
  initialState: EngineState
  inputs: EngineInput[]
  expectedEvents: EngineEvent[]
}

export interface ReplayResult {
  /** 第一处事件不一致的 tick；null 表示全程一致或没有期望事件 */
  divergedAt: number | null
  finalTick: number
  events: EngineEvent[]
}

/**
 * 回放器：给定初始 state + 输入流 + 期望事件流，
 * 以 step() 为唯一推进函数复现局面，并在第一处事件分叉时停下。
 */
export class ReplayPlayer {
  private state: EngineState
  private readonly byTickInputs: Map<number, EngineInput[]>
  private readonly expected: EngineEvent[]
  private allEvents: EngineEvent[] = []

  constructor(init: ReplayInit) {
    this.state = JSON.parse(JSON.stringify(init.initialState))
    this.byTickInputs = new Map()
    for (const i of init.inputs) {
      const arr = this.byTickInputs.get(i.tick) ?? []
      arr.push(i)
      this.byTickInputs.set(i.tick, arr)
    }
    this.expected = init.expectedEvents
  }

  get currentState(): EngineState {
    return this.state
  }

  /** 推进 ticks 个 tick 或直到分叉。 */
  run(ticks: number): ReplayResult {
    let cmpIdx = 0
    for (let i = 0; i < ticks; i++) {
      const t = this.state.tick
      const inputs = this.byTickInputs.get(t) ?? []
      const r = step(this.state, inputs)
      this.state = r.next
      this.allEvents.push(...r.events)
      // 比对期望：取属于该 tick 的期望事件子集
      while (cmpIdx < this.expected.length && this.expected[cmpIdx]!.tick === t) {
        const exp = this.expected[cmpIdx]!
        const got = r.events.find(
          (e) =>
            e.kind === exp.kind && e.tick === exp.tick && JSON.stringify(e) === JSON.stringify(exp),
        )
        if (!got) {
          return {
            divergedAt: t,
            finalTick: this.state.tick,
            events: this.allEvents,
          }
        }
        cmpIdx++
      }
    }
    return { divergedAt: null, finalTick: this.state.tick, events: this.allEvents }
  }
}

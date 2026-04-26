import type { EngineInput } from '@engine'

/**
 * 输入流采集：
 * - record(input)：把玩家输入加入 pending 与 full 两个队列
 * - take()：取走当前 pending（喂给下一次 step）；不影响 full
 * - snapshot()：返回开局至今的全部输入（用于导出）
 * - reset()：开新局时清空两个队列
 */
export class InputRecorder {
  private pending: EngineInput[] = []
  private full: EngineInput[] = []

  record(input: EngineInput): void {
    this.pending.push(input)
    this.full.push(input)
  }

  take(): EngineInput[] {
    const r = this.pending
    this.pending = []
    return r
  }

  snapshot(): EngineInput[] {
    return [...this.full]
  }

  reset(): void {
    this.pending = []
    this.full = []
  }
}

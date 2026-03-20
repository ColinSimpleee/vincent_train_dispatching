import type { TrainModel } from './RailGraph'
import type { ScheduleConfig, ScheduleEntry, DelaySpread } from './types'

// 60 ticks/sec * 60 sec/min = 3600 ticks per game minute
const TICKS_PER_MINUTE = 3600
const FUTURE_WINDOW = 30 * TICKS_PER_MINUTE // 30 分钟 = 108000 ticks
const DWELL_MIN = 1800 // 30 秒
const DWELL_MAX = 3600 // 60 秒
const DELAY_LIMIT = 36000 // ±10 分钟
const DELAY_DRIFT_PROBABILITY = 0.002
const DELAY_DRIFT_AMPLITUDE = 30
const SPREAD_THRESHOLD = 1800 // 30 秒
const MAX_DEPARTED_KEPT = 50

const TRAIN_MODELS: TrainModel[] = ['CR400AF', 'CR400BF', 'CRH380A']

export class ScheduleManager {
  private entries: ScheduleEntry[] = []
  private config: ScheduleConfig
  private difficulty: number
  private lastGeneratedTick: number = 0
  private nextTrainNumber: number = 500
  private difficultyCounter: number = 0
  private gameStartTimeOffsetTicks: number

  constructor(
    config: ScheduleConfig,
    difficulty: number,
    startTick: number,
    gameStartTimeOffsetTicks: number,
  ) {
    this.config = config
    this.difficulty = difficulty
    this.gameStartTimeOffsetTicks = gameStartTimeOffsetTicks
    this.lastGeneratedTick = startTick
    this.generateUpTo(startTick + FUTURE_WINDOW)
  }

  private generateUpTo(endTick: number): void {
    let cursor = this.lastGeneratedTick

    while (cursor < endTick) {
      const intervalMinutes = this.getInterval(cursor)
      const intervalTicks = Math.floor(intervalMinutes * TICKS_PER_MINUTE)
      cursor += intervalTicks

      if (cursor > endTick) break

      const entry = this.createEntry(cursor)
      this.entries.push(entry)
    }

    this.lastGeneratedTick = cursor
  }

  private getInterval(tick: number): number {
    const gameMinute = this.tickToGameMinute(tick)
    const isPeak = this.config.peakWindows.some(
      ([start, end]) => gameMinute >= start && gameMinute < end,
    )

    const [min, max] = isPeak
      ? this.config.peakIntervalRange
      : this.config.offPeakIntervalRange

    return min + Math.random() * (max - min)
  }

  private tickToGameMinute(tick: number): number {
    const absoluteTicks = this.gameStartTimeOffsetTicks + tick
    const totalMinutes = absoluteTicks / TICKS_PER_MINUTE
    return totalMinutes % 1440
  }

  private createEntry(arriveTick: number): ScheduleEntry {
    const isUp = Math.random() < this.config.directionRatio
    const direction: 'up' | 'down' = isUp ? 'up' : 'down'

    const baseNum = this.nextTrainNumber++
    const num = isUp ? baseNum * 2 : baseNum * 2 + 1

    const prefix = Math.random() > 0.5 ? 'G' : 'D'
    const id = `${prefix}${num}`

    const model = TRAIN_MODELS[Math.floor(Math.random() * TRAIN_MODELS.length)]!
    const stopDuration =
      DWELL_MIN + Math.floor(Math.random() * (DWELL_MAX - DWELL_MIN + 1))

    const maxInitialDelay = this.difficulty * 1800
    const initialDelay = Math.floor(
      -maxInitialDelay + Math.random() * 2 * maxInitialDelay,
    )

    const line = this.assignLine()

    return {
      id,
      direction,
      model,
      line,
      scheduledArriveTick: arriveTick,
      scheduledStopDuration: stopDuration,
      scheduledDepartTick: arriveTick + stopDuration,
      currentDelay: initialDelay,
      status: 'upcoming',
    }
  }

  private assignLine(): string | undefined {
    const { lines, lineTrafficWeight } = this.config
    if (!lines || lines.length === 0) return undefined

    if (lineTrafficWeight) {
      const totalWeight = Object.values(lineTrafficWeight).reduce(
        (a, b) => a + b,
        0,
      )
      let r = Math.random() * totalWeight
      for (const line of lines) {
        r -= lineTrafficWeight[line] ?? 1
        if (r <= 0) return line
      }
    }

    return lines[Math.floor(Math.random() * lines.length)]
  }

  ensureFutureSchedule(currentTick: number): void {
    const targetTick = currentTick + FUTURE_WINDOW
    if (this.lastGeneratedTick < targetTick) {
      this.generateUpTo(targetTick)
    }
  }

  updateDelays(_currentTick: number): void {
    for (const entry of this.entries) {
      if (entry.status !== 'upcoming') continue

      if (Math.random() < DELAY_DRIFT_PROBABILITY) {
        const drift = Math.floor(
          (Math.random() * 2 - 1) * DELAY_DRIFT_AMPLITUDE * this.difficulty,
        )
        entry.currentDelay = Math.max(
          -DELAY_LIMIT,
          Math.min(DELAY_LIMIT, entry.currentDelay + drift),
        )
      }
    }
  }

  checkArrivals(currentTick: number): void {
    for (const entry of this.entries) {
      if (entry.status !== 'upcoming') continue

      const effectiveArriveTick = entry.scheduledArriveTick + entry.currentDelay
      if (currentTick >= effectiveArriveTick) {
        entry.status = 'waiting'
        entry.handoverDelay = entry.currentDelay
        entry.handoverTick = currentTick
        entry.reactionGraceTicks = this.computeGraceTicks(currentTick)
      }
    }
  }

  getWaitingEntries(): ScheduleEntry[] {
    return this.entries.filter((e) => e.status === 'waiting')
  }

  getEntryById(id: string): ScheduleEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  getAllEntries(): ScheduleEntry[] {
    return [...this.entries]
  }

  markAdmitted(entryId: string, _currentTick: number): void {
    const entry = this.entries.find((e) => e.id === entryId)
    if (entry && entry.status === 'waiting') {
      entry.status = 'admitted'
    }
  }

  markDeparted(entryId: string, currentTick: number): void {
    const entry = this.entries.find((e) => e.id === entryId)
    if (entry && entry.status === 'admitted') {
      entry.status = 'departed'
      entry.finalDelay = currentTick - entry.scheduledDepartTick
      this.updateDifficultyCounter(entry, currentTick)
      this.cleanupOldEntries()
    }
  }

  computeDelaySpread(entry: ScheduleEntry, currentTick: number): DelaySpread {
    const handoverDelay = entry.handoverDelay ?? 0
    const graceTicks = entry.reactionGraceTicks ?? 0
    const baseline = handoverDelay + graceTicks

    let currentDelay: number
    if (entry.status === 'departed' && entry.finalDelay !== undefined) {
      currentDelay = entry.finalDelay
    } else {
      currentDelay = currentTick - entry.scheduledDepartTick
    }

    const delta = currentDelay - baseline

    let level: DelaySpread['level']
    if (delta <= -SPREAD_THRESHOLD) {
      level = 'improved'
    } else if (delta >= SPREAD_THRESHOLD) {
      level = 'worsened'
    } else {
      level = 'neutral'
    }

    return { delta, level }
  }

  private computeGraceTicks(currentTick: number): number {
    const windowEntries = this.entries.filter(
      (e) =>
        (e.status === 'upcoming' || e.status === 'waiting') &&
        e.scheduledArriveTick <= currentTick + FUTURE_WINDOW,
    )
    const density = windowEntries.length

    const maxDensity = 15
    const ratio = Math.min(density / maxDensity, 1)

    let grace = Math.floor(3600 - ratio * 1800)

    if (this.difficultyCounter >= 8) {
      const extra = Math.min((this.difficultyCounter - 7) * 900, 1800)
      grace += extra
    }

    return grace
  }

  private updateDifficultyCounter(
    entry: ScheduleEntry,
    currentTick: number,
  ): void {
    const spread = this.computeDelaySpread(entry, currentTick)
    if (spread.delta > 0) {
      this.difficultyCounter++
    } else {
      this.difficultyCounter = Math.max(0, this.difficultyCounter - 1)
    }
  }

  private cleanupOldEntries(): void {
    const departedEntries = this.entries.filter((e) => e.status === 'departed')
    if (departedEntries.length > MAX_DEPARTED_KEPT) {
      const toRemove = departedEntries.length - MAX_DEPARTED_KEPT
      let removed = 0
      this.entries = this.entries.filter((e) => {
        if (e.status === 'departed' && removed < toRemove) {
          removed++
          return false
        }
        return true
      })
    }
  }
}

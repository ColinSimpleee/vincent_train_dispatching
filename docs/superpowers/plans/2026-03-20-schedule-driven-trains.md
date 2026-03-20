# 时刻表驱动列车生成 + 晚点扩散指示器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将列车生成从随机概率模式改为时刻表驱动模式，并在左侧面板新增晚点扩散三角形指示器。

**Architecture:** 新建 `ScheduleManager` 类负责时刻表生成、延误模拟和晚点扩散计算。App.vue 的随机队列逻辑替换为 ScheduleManager 调用。LeftPanel.vue 在准点文字后渲染三角形指示器。

**Tech Stack:** Vue 3 + TypeScript, Vitest 测试框架

**Spec:** `docs/superpowers/specs/2026-03-20-schedule-driven-trains-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/types.ts` | 修改 | 新增 ScheduleEntry、DelaySpread、ScheduleConfig 类型 |
| `src/core/RailGraph.ts` | 修改 | TrainPhysics 新增 scheduleEntryId 字段 |
| `src/core/ScheduleManager.ts` | 新建 | 时刻表管理器：生成、延误模拟、状态管理、delta 计算 |
| `src/data/stations.ts` | 修改 | StationConfig 新增 scheduleConfig，各车站配置 |
| `src/App.vue` | 修改 | 删除 QueuedTrain 和随机队列，集成 ScheduleManager |
| `src/components/panels/LeftPanel.vue` | 修改 | 新增三角形指示器，接收 ScheduleEntry 数据 |
| `src/__tests__/ScheduleManager.spec.ts` | 新建 | ScheduleManager 单元测试 |

---

### Task 1: 新增类型定义

**Files:**
- Modify: `src/core/types.ts`（在文件末尾追加）
- Modify: `src/core/RailGraph.ts:42-79`（TrainPhysics 接口新增一个字段）

- [ ] **Step 1: 在 types.ts 末尾新增 ScheduleEntry、DelaySpread、ScheduleConfig 接口**

```typescript
// 在 src/core/types.ts 文件末尾追加

import type { TrainModel } from './RailGraph'

export interface ScheduleConfig {
  peakIntervalRange: [number, number]       // 高峰间隔（分钟），如 [2, 3]
  offPeakIntervalRange: [number, number]    // 低谷间隔（分钟），如 [6, 10]
  peakWindows: [number, number][]           // 高峰时段（游戏分钟），如 [[420, 540], [1020, 1140]]
  directionRatio: number                    // 上行列车占比，如 0.5 均分
  lines?: string[]                          // 多线路车站的线路列表
  lineTrafficWeight?: Record<string, number> // 各线路流量权重
}

export type ScheduleEntryStatus = 'upcoming' | 'waiting' | 'admitted' | 'departed'

export interface ScheduleEntry {
  id: string
  direction: 'up' | 'down'
  model: TrainModel
  line?: string

  scheduledArriveTick: number               // 单位: tick (1 tick = 1/60 秒)
  scheduledStopDuration: number             // 1800-3600 ticks (30-60 秒)
  scheduledDepartTick: number               // = arriveTick + stopDuration

  currentDelay: number                      // 正=晚点, 负=早点 (ticks)

  handoverDelay?: number                    // 交接时刻锁定的延误值
  handoverTick?: number                     // 交接时刻的 tick
  reactionGraceTicks?: number               // 反应时间宽限 (1800-3600 ticks)
  finalDelay?: number                       // 出站移交时的最终延误

  status: ScheduleEntryStatus
}

export interface DelaySpread {
  delta: number                             // 单位 ticks
  level: 'improved' | 'neutral' | 'worsened'
}
```

注意：`ScheduleConfig` 不包含 `difficulty`，难度系数从 `StationConfig.difficulty` 获取，避免重复定义。

- [ ] **Step 2: 在 RailGraph.ts 的 TrainPhysics 接口中新增 scheduleEntryId 字段**

在 `src/core/RailGraph.ts` 的 TrainPhysics 接口中，`isHandedOver` 字段（第 72 行）后面追加：

```typescript
  scheduleEntryId?: string; // Links back to ScheduleEntry for delay tracking
```

- [ ] **Step 3: 运行类型检查确认无报错**

Run: `npx vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
git add src/core/types.ts src/core/RailGraph.ts
git commit -m "feat: 新增 ScheduleEntry、DelaySpread、ScheduleConfig 类型定义"
```

---

### Task 2: 新建 ScheduleManager — 核心实现

**Files:**
- Create: `src/core/ScheduleManager.ts`
- Create: `src/__tests__/ScheduleManager.spec.ts`

- [ ] **Step 1: 编写时刻表生成的测试**

创建 `src/__tests__/ScheduleManager.spec.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { ScheduleManager } from '../core/ScheduleManager'
import type { ScheduleConfig } from '../core/types'

const baseConfig: ScheduleConfig = {
  peakIntervalRange: [2, 3],
  offPeakIntervalRange: [6, 10],
  peakWindows: [[420, 540], [1020, 1140]], // 7:00-9:00, 17:00-19:00
  directionRatio: 0.5,
}

// gameStartTime 7:00 = 420 游戏分钟 = 420 * 3600 ticks 偏移
// startTick=0 对应游戏时间 07:00（高峰）
const peakStartTimeOffset = 420 * 3600

// gameStartTime 10:00 = 600 游戏分钟
// startTick=0 对应游戏时间 10:00（低谷）
const offPeakStartTimeOffset = 600 * 3600

describe('ScheduleManager', () => {
  describe('时刻表生成', () => {
    it('构造时生成未来 30 分钟的时刻表', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, peakStartTimeOffset)
      const entries = manager.getAllEntries()

      expect(entries.length).toBeGreaterThan(0)

      const futureLimit = 108000 // 30 分钟
      for (const entry of entries) {
        expect(entry.scheduledArriveTick).toBeGreaterThanOrEqual(0)
        expect(entry.scheduledArriveTick).toBeLessThanOrEqual(futureLimit)
      }
    })

    it('高峰时段生成间隔为 2-3 分钟', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, peakStartTimeOffset)
      const entries = manager.getAllEntries()

      for (let i = 1; i < entries.length; i++) {
        const gap = entries[i]!.scheduledArriveTick - entries[i - 1]!.scheduledArriveTick
        const gapMinutes = gap / 3600
        expect(gapMinutes).toBeGreaterThanOrEqual(2)
        expect(gapMinutes).toBeLessThanOrEqual(3)
      }
    })

    it('低谷时段生成间隔为 6-10 分钟', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, offPeakStartTimeOffset)
      const entries = manager.getAllEntries()

      for (let i = 1; i < entries.length; i++) {
        const gap = entries[i]!.scheduledArriveTick - entries[i - 1]!.scheduledArriveTick
        const gapMinutes = gap / 3600
        expect(gapMinutes).toBeGreaterThanOrEqual(6)
        expect(gapMinutes).toBeLessThanOrEqual(10)
      }
    })

    it('所有条目初始状态为 upcoming', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      for (const entry of manager.getAllEntries()) {
        expect(entry.status).toBe('upcoming')
      }
    })

    it('偶数编号为上行，奇数编号为下行', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      for (const entry of manager.getAllEntries()) {
        const num = parseInt(entry.id.replace(/\D/g, ''))
        if (entry.direction === 'up') {
          expect(num % 2).toBe(0)
        } else {
          expect(num % 2).toBe(1)
        }
      }
    })

    it('scheduledDepartTick = scheduledArriveTick + scheduledStopDuration', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      for (const entry of manager.getAllEntries()) {
        expect(entry.scheduledDepartTick).toBe(
          entry.scheduledArriveTick + entry.scheduledStopDuration
        )
      }
    })

    it('停站时长在 1800-3600 ticks 范围内', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      for (const entry of manager.getAllEntries()) {
        expect(entry.scheduledStopDuration).toBeGreaterThanOrEqual(1800)
        expect(entry.scheduledStopDuration).toBeLessThanOrEqual(3600)
      }
    })
  })

  describe('滚动补充', () => {
    it('ensureFutureSchedule 补充到未来 30 分钟', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const initialCount = manager.getAllEntries().length

      manager.ensureFutureSchedule(36000)
      const afterCount = manager.getAllEntries().length

      expect(afterCount).toBeGreaterThanOrEqual(initialCount)

      const entries = manager.getAllEntries()
      const lastEntry = entries[entries.length - 1]!
      expect(lastEntry.scheduledArriveTick).toBeLessThanOrEqual(36000 + 108000)
    })

    it('节流：连续调用不会重复生成', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      manager.ensureFutureSchedule(100)
      const count1 = manager.getAllEntries().length
      manager.ensureFutureSchedule(101)
      const count2 = manager.getAllEntries().length
      expect(count2).toBe(count1)
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/__tests__/ScheduleManager.spec.ts`
Expected: FAIL — ScheduleManager 模块不存在

- [ ] **Step 3: 实现 ScheduleManager**

创建 `src/core/ScheduleManager.ts`：

```typescript
import type { TrainModel } from './RailGraph'
import type { ScheduleConfig, ScheduleEntry, DelaySpread } from './types'

// 60 ticks/sec * 60 sec/min = 3600 ticks per game minute
const TICKS_PER_MINUTE = 3600
const FUTURE_WINDOW = 30 * TICKS_PER_MINUTE // 30 分钟 = 108000 ticks
const DWELL_MIN = 1800  // 30 秒
const DWELL_MAX = 3600  // 60 秒
const DELAY_LIMIT = 36000 // ±10 分钟
const DELAY_DRIFT_PROBABILITY = 0.002
const DELAY_DRIFT_AMPLITUDE = 30
const SPREAD_THRESHOLD = 1800 // 30 秒
const MAX_DEPARTED_KEPT = 50  // 保留最近 50 条已出站记录

const TRAIN_MODELS: TrainModel[] = ['CR400AF', 'CR400BF', 'CRH380A']

export class ScheduleManager {
  private entries: ScheduleEntry[] = []
  private config: ScheduleConfig
  private difficulty: number
  private lastGeneratedTick: number = 0
  private nextTrainNumber: number = 500
  private difficultyCounter: number = 0
  private gameStartTimeOffsetTicks: number // tick=0 对应的游戏绝对时刻 (ticks)

  /**
   * @param config 车站时刻表配置
   * @param difficulty 难度系数 (来自 StationConfig.difficulty, 1-5)
   * @param startTick 当前游戏 tick
   * @param gameStartTimeOffsetTicks 游戏起始时间偏移 (gameStartTime 转换为 ticks)
   *   例: gameStartTime={hours:7,minutes:30} → 7*60*3600 + 30*3600 = 1620000
   */
  constructor(
    config: ScheduleConfig,
    difficulty: number,
    startTick: number,
    gameStartTimeOffsetTicks: number
  ) {
    this.config = config
    this.difficulty = difficulty
    this.gameStartTimeOffsetTicks = gameStartTimeOffsetTicks
    this.lastGeneratedTick = startTick
    this.generateUpTo(startTick + FUTURE_WINDOW)
  }

  // --- 时刻表生成 ---

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
      ([start, end]) => gameMinute >= start && gameMinute < end
    )

    const [min, max] = isPeak
      ? this.config.peakIntervalRange
      : this.config.offPeakIntervalRange

    return min + Math.random() * (max - min)
  }

  /**
   * 将游戏 tick 转换为一天中的游戏分钟 (0-1440)
   * 考虑 gameStartTime 偏移量
   */
  private tickToGameMinute(tick: number): number {
    const absoluteTicks = this.gameStartTimeOffsetTicks + tick
    const totalMinutes = absoluteTicks / TICKS_PER_MINUTE
    return totalMinutes % 1440
  }

  private createEntry(arriveTick: number): ScheduleEntry {
    const isUp = Math.random() < this.config.directionRatio
    const direction: 'up' | 'down' = isUp ? 'up' : 'down'

    // 编号：上行偶数，下行奇数
    const baseNum = this.nextTrainNumber++
    const num = isUp ? baseNum * 2 : baseNum * 2 + 1

    const prefix = Math.random() > 0.5 ? 'G' : 'D'
    const id = `${prefix}${num}`

    const model = TRAIN_MODELS[Math.floor(Math.random() * TRAIN_MODELS.length)]!
    const stopDuration = DWELL_MIN + Math.floor(Math.random() * (DWELL_MAX - DWELL_MIN + 1))

    // 初始延误
    const maxInitialDelay = this.difficulty * 1800
    const initialDelay = Math.floor(-maxInitialDelay + Math.random() * 2 * maxInitialDelay)

    // 线路分配
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
      const totalWeight = Object.values(lineTrafficWeight).reduce((a, b) => a + b, 0)
      let r = Math.random() * totalWeight
      for (const line of lines) {
        r -= lineTrafficWeight[line] ?? 1
        if (r <= 0) return line
      }
    }

    return lines[Math.floor(Math.random() * lines.length)]
  }

  // --- 主循环方法 ---

  ensureFutureSchedule(currentTick: number): void {
    const targetTick = currentTick + FUTURE_WINDOW
    if (this.lastGeneratedTick < targetTick) {
      this.generateUpTo(targetTick)
    }
  }

  updateDelays(currentTick: number): void {
    for (const entry of this.entries) {
      if (entry.status !== 'upcoming') continue

      if (Math.random() < DELAY_DRIFT_PROBABILITY) {
        const drift = Math.floor(
          (Math.random() * 2 - 1) * DELAY_DRIFT_AMPLITUDE * this.difficulty
        )
        entry.currentDelay = Math.max(
          -DELAY_LIMIT,
          Math.min(DELAY_LIMIT, entry.currentDelay + drift)
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

  // --- 查询方法 ---

  getWaitingEntries(): ScheduleEntry[] {
    return this.entries.filter(e => e.status === 'waiting')
  }

  getEntryById(id: string): ScheduleEntry | undefined {
    return this.entries.find(e => e.id === id)
  }

  getAllEntries(): ScheduleEntry[] {
    return [...this.entries]
  }

  // --- 状态转移 ---

  markAdmitted(entryId: string, currentTick: number): void {
    const entry = this.entries.find(e => e.id === entryId)
    if (entry && entry.status === 'waiting') {
      entry.status = 'admitted'
    }
  }

  markDeparted(entryId: string, currentTick: number): void {
    const entry = this.entries.find(e => e.id === entryId)
    if (entry && entry.status === 'admitted') {
      entry.status = 'departed'
      entry.finalDelay = currentTick - entry.scheduledDepartTick
      this.updateDifficultyCounter(entry, currentTick)
      this.cleanupOldEntries()
    }
  }

  // --- 晚点扩散计算 ---

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

  // --- 反应时间宽限 ---

  private computeGraceTicks(currentTick: number): number {
    const windowEntries = this.entries.filter(
      e =>
        (e.status === 'upcoming' || e.status === 'waiting') &&
        e.scheduledArriveTick <= currentTick + FUTURE_WINDOW
    )
    const density = windowEntries.length

    // 高峰 30 分钟 / 2 分钟间隔 ≈ 15 辆
    const maxDensity = 15
    const ratio = Math.min(density / maxDensity, 1)

    // lerp(3600, 1800, ratio) — 低密度 60 秒, 高密度 30 秒
    let grace = Math.floor(3600 - ratio * 1800)

    // 自适应：困难计数器 ≥ 8 时额外加宽限
    if (this.difficultyCounter >= 8) {
      const extra = Math.min((this.difficultyCounter - 7) * 900, 1800)
      grace += extra
    }

    return grace
  }

  private updateDifficultyCounter(entry: ScheduleEntry, currentTick: number): void {
    const spread = this.computeDelaySpread(entry, currentTick)
    if (spread.delta > 0) {
      this.difficultyCounter++
    } else {
      this.difficultyCounter = Math.max(0, this.difficultyCounter - 1)
    }
  }

  /** 清理过旧的 departed 条目，避免数组无限增长 */
  private cleanupOldEntries(): void {
    const departedEntries = this.entries.filter(e => e.status === 'departed')
    if (departedEntries.length > MAX_DEPARTED_KEPT) {
      const toRemove = departedEntries.length - MAX_DEPARTED_KEPT
      let removed = 0
      this.entries = this.entries.filter(e => {
        if (e.status === 'departed' && removed < toRemove) {
          removed++
          return false
        }
        return true
      })
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/__tests__/ScheduleManager.spec.ts`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/ScheduleManager.ts src/__tests__/ScheduleManager.spec.ts
git commit -m "feat: 新建 ScheduleManager 时刻表管理器，含生成、延误、delta 计算"
```

---

### Task 3: 补充 ScheduleManager 测试 — 延误、delta、自适应宽限、多线路

**Files:**
- Modify: `src/__tests__/ScheduleManager.spec.ts`

- [ ] **Step 1: 追加测试用例**

在测试文件末尾的 `describe('ScheduleManager')` 块内追加：

```typescript
  describe('延误模拟', () => {
    it('updateDelays 只影响 upcoming 状态的列车', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const entries = manager.getAllEntries()
      const firstId = entries[0]!.id
      const firstArrive = entries[0]!.scheduledArriveTick + entries[0]!.currentDelay
      manager.checkArrivals(firstArrive)

      const delayBefore = manager.getEntryById(firstId)!.currentDelay

      for (let i = 0; i < 10000; i++) {
        manager.updateDelays(firstArrive + i)
      }

      expect(manager.getEntryById(firstId)!.currentDelay).toBe(delayBefore)
    })

    it('延误不超过 ±36000 ticks 上限', () => {
      const manager = new ScheduleManager(baseConfig, 4, 0, 0)

      for (let i = 0; i < 100000; i++) {
        manager.updateDelays(i)
      }

      for (const entry of manager.getAllEntries()) {
        if (entry.status === 'upcoming') {
          expect(Math.abs(entry.currentDelay)).toBeLessThanOrEqual(36000)
        }
      }
    })
  })

  describe('状态转换', () => {
    it('checkArrivals 在正确时刻将 upcoming → waiting', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const entries = manager.getAllEntries()
      const first = entries[0]!
      const effectiveArrive = first.scheduledArriveTick + first.currentDelay

      manager.checkArrivals(effectiveArrive - 1)
      expect(manager.getEntryById(first.id)!.status).toBe('upcoming')

      manager.checkArrivals(effectiveArrive)
      const updated = manager.getEntryById(first.id)!
      expect(updated.status).toBe('waiting')
      expect(updated.handoverDelay).toBe(first.currentDelay)
      expect(updated.handoverTick).toBe(effectiveArrive)
    })

    it('markAdmitted 和 markDeparted 正确转移状态', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const entries = manager.getAllEntries()
      const first = entries[0]!
      const arriveTick = first.scheduledArriveTick + first.currentDelay

      manager.checkArrivals(arriveTick)
      manager.markAdmitted(first.id, arriveTick + 100)
      expect(manager.getEntryById(first.id)!.status).toBe('admitted')

      const departTick = first.scheduledDepartTick + 3600
      manager.markDeparted(first.id, departTick)
      const departed = manager.getEntryById(first.id)!
      expect(departed.status).toBe('departed')
      expect(departed.finalDelay).toBeDefined()
    })
  })

  describe('晚点扩散 delta 计算', () => {
    it('宽限期内 delta 为负（改善）', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const entries = manager.getAllEntries()
      const first = entries[0]!
      const arriveTick = first.scheduledArriveTick + first.currentDelay

      manager.checkArrivals(arriveTick)
      manager.markAdmitted(first.id, arriveTick)

      const earlyTick = first.scheduledDepartTick - 1800
      const spread = manager.computeDelaySpread(
        manager.getEntryById(first.id)!,
        earlyTick
      )
      expect(spread.delta).toBeLessThan(0)
    })

    it('departed 状态 delta 固定不变', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const entries = manager.getAllEntries()
      const first = entries[0]!
      const arriveTick = first.scheduledArriveTick + first.currentDelay

      manager.checkArrivals(arriveTick)
      manager.markAdmitted(first.id, arriveTick)
      manager.markDeparted(first.id, first.scheduledDepartTick + 7200)

      const entry = manager.getEntryById(first.id)!
      const spread1 = manager.computeDelaySpread(entry, first.scheduledDepartTick + 10000)
      const spread2 = manager.computeDelaySpread(entry, first.scheduledDepartTick + 50000)

      expect(spread1.delta).toBe(spread2.delta)
    })

    it('level 判定：改善 ≥ 30 秒为 improved', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)
      const entries = manager.getAllEntries()
      const first = entries[0]!
      const arriveTick = first.scheduledArriveTick + first.currentDelay

      manager.checkArrivals(arriveTick)
      manager.markAdmitted(first.id, arriveTick)
      manager.markDeparted(first.id, first.scheduledDepartTick - 18000)

      const entry = manager.getEntryById(first.id)!
      const spread = manager.computeDelaySpread(entry, 0)
      expect(spread.level).toBe('improved')
    })
  })

  describe('自适应宽限', () => {
    it('连续恶化后宽限增加', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, 0)

      // 让 9 趟列车依次到达、接入、晚点出站 → difficultyCounter >= 8
      for (let i = 0; i < 9; i++) {
        const entries = manager.getAllEntries()
        const upcoming = entries.filter(e => e.status === 'upcoming')
        if (upcoming.length === 0) break
        const entry = upcoming[0]!
        const arriveTick = entry.scheduledArriveTick + entry.currentDelay
        manager.checkArrivals(arriveTick)
        const graceBeforeAccumulate = entry.reactionGraceTicks ?? 0
        manager.markAdmitted(entry.id, arriveTick)
        // 大幅晚点出站
        manager.markDeparted(entry.id, entry.scheduledDepartTick + 36000)
      }

      // 下一趟到达时宽限应比基础值大
      const remaining = manager.getAllEntries().filter(e => e.status === 'upcoming')
      if (remaining.length > 0) {
        const nextEntry = remaining[0]!
        const nextArrive = nextEntry.scheduledArriveTick + nextEntry.currentDelay
        manager.checkArrivals(nextArrive)
        const grace = manager.getEntryById(nextEntry.id)!.reactionGraceTicks ?? 0
        // 基础最小宽限 1800，加上额外至少 900
        expect(grace).toBeGreaterThan(1800)
      }
    })
  })

  describe('多线路权重', () => {
    it('按权重分配线路标签', () => {
      const multiLineConfig: ScheduleConfig = {
        ...baseConfig,
        lines: ['京沪', '沪昆'],
        lineTrafficWeight: { '京沪': 3, '沪昆': 1 },
      }
      const manager = new ScheduleManager(multiLineConfig, 1, 0, offPeakStartTimeOffset)
      const entries = manager.getAllEntries()

      // 所有条目都应有线路标签
      for (const entry of entries) {
        expect(entry.line).toBeDefined()
        expect(['京沪', '沪昆']).toContain(entry.line)
      }

      // 京沪占比应大于沪昆 (3:1 权重，样本量足够大时应明显)
      const jinghu = entries.filter(e => e.line === '京沪').length
      const hukun = entries.filter(e => e.line === '沪昆').length
      if (entries.length >= 4) {
        expect(jinghu).toBeGreaterThan(hukun)
      }
    })
  })
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run src/__tests__/ScheduleManager.spec.ts`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/__tests__/ScheduleManager.spec.ts
git commit -m "test: 补充延误、delta、自适应宽限、多线路权重测试"
```

---

### Task 4: 车站配置增加 scheduleConfig

**Files:**
- Modify: `src/data/stations.ts:1-10`（import 和 StationConfig 接口）
- Modify: `src/data/stations.ts`（各车站定义追加配置）

- [ ] **Step 1: 扩展 StationConfig 接口**

```typescript
import type { RailMap } from '../core/RailGraph';
import type { ScheduleConfig } from '../core/types';

export interface StationConfig {
    id: string;
    name: string;
    description: string;
    difficulty: number;
    type: 'small' | 'hub' | 'terminal';
    mapData: RailMap;
    scheduleConfig: ScheduleConfig;
}
```

- [ ] **Step 2: 为 stationSmall 添加 scheduleConfig**

```typescript
    scheduleConfig: {
        peakIntervalRange: [4, 6],
        offPeakIntervalRange: [8, 12],
        peakWindows: [[420, 540], [1020, 1140]],
        directionRatio: 0.5,
    },
```

- [ ] **Step 3: 为 stationTerminal 添加 scheduleConfig**

```typescript
    scheduleConfig: {
        peakIntervalRange: [3, 5],
        offPeakIntervalRange: [6, 10],
        peakWindows: [[420, 540], [1020, 1140]],
        directionRatio: 0.6,
    },
```

- [ ] **Step 4: 为 stationHub 添加 scheduleConfig（含多线路）**

```typescript
    scheduleConfig: {
        peakIntervalRange: [2, 3],
        offPeakIntervalRange: [4, 6],
        peakWindows: [[420, 540], [1020, 1140]],
        directionRatio: 0.5,
        lines: ['京沪', '沪昆', '沪宁城际'],
        lineTrafficWeight: { '京沪': 3, '沪昆': 2, '沪宁城际': 1 },
    },
```

- [ ] **Step 5: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: 提交**

```bash
git add src/data/stations.ts
git commit -m "feat: 各车站配置增加 scheduleConfig"
```

---

### Task 5: App.vue 集成 ScheduleManager，替换随机队列

**Files:**
- Modify: `src/App.vue`

**关键改动点：**
- 第 11-15 行：删除 `QueuedTrain` 接口
- 第 74-78 行：删除硬编码 `waitingQueue`
- 第 96 行：`waitingQueue.find()` 字段访问路径变更
- 第 199-213 行：替换随机补充逻辑
- 第 505, 526 行：`waitingQueue.map()` 适配 computed
- 第 701-772 行：ADMIT 函数对接（方向、入口选择）
- 第 145-173 行：出站移交逻辑对接

- [ ] **Step 1: 删除 QueuedTrain，新增 ScheduleManager import 和实例化**

1. 删除 `QueuedTrain` 接口（第 11-15 行）
2. 新增 import：
```typescript
import { ScheduleManager } from './core/ScheduleManager'
import type { ScheduleEntry } from './core/types'
```
3. 新增变量：
```typescript
let scheduleManager: ScheduleManager | null = null
```
4. 删除硬编码 `waitingQueue`（第 74-78 行），替换为 computed：
```typescript
const waitingQueue = computed<ScheduleEntry[]>(() => {
  if (!scheduleManager) return []
  return scheduleManager.getWaitingEntries()
})
```

- [ ] **Step 2: 在 handleStationSelect() 中初始化 ScheduleManager**

在 `handleStationSelect()` 函数（第 306-325 行）中，`startSim()` 调用之前，新增：

```typescript
// 计算 gameStartTime 的 tick 偏移量
const gst = gameStartTime.value
const gameStartTimeOffsetTicks = (gst.hours * 60 + gst.minutes) * 3600 + gst.seconds * 60
scheduleManager = new ScheduleManager(
  config.scheduleConfig,
  config.difficulty,
  tick.value,
  gameStartTimeOffsetTicks
)
```

在 `goHome()` 函数（第 327-335 行）中新增重置：
```typescript
scheduleManager = null
```

- [ ] **Step 3: 替换主循环中的随机补充逻辑**

将第 199-213 行替换为：

```typescript
        // 时刻表驱动
        if (scheduleManager) {
          scheduleManager.ensureFutureSchedule(tick.value)
          scheduleManager.updateDelays(tick.value)
          scheduleManager.checkArrivals(tick.value)
        }
```

- [ ] **Step 4: 更新 selectedTrain computed 中的队列查找**

第 96 行原来是 `waitingQueue.find(q => q.id === ...)`，因为 `waitingQueue` 现在是 computed，需要改为 `waitingQueue.value.find(...)`。同时字段访问从 `queued.model` 改为 `queued.model`（ScheduleEntry 也有 model 字段，无需变更）:

```typescript
const queued = waitingQueue.value.find(q => q.id === selectedTrainId.value)
if (queued) {
    return {
        id: queued.id,
        state: 'WAITING',
        modelType: queued.model,
        speed: 0,
        currentEdgeId: 'QUEUE'
    }
}
```

- [ ] **Step 5: 更新 selectNextTrain/selectPreviousTrain 中的队列引用**

第 505 行和第 526 行：`waitingQueue.map(q => q.id)` 改为 `waitingQueue.value.map(q => q.id)`

- [ ] **Step 6: 重写 spawnTrainIntoMap (ADMIT) 函数**

关键改造：
1. 从 `waitingQueue.value` 查找 ScheduleEntry
2. 根据 `entry.direction` 选择入口轨道和设置方向
3. 新增 `scheduleEntryId` 字段映射
4. 调用 `scheduleManager.markAdmitted()`
5. 删除 `waitingQueue.splice()` — ScheduleManager 管理状态

```typescript
function spawnTrainIntoMap(id: string) {
    const entry = waitingQueue.value.find(q => q.id === id)
    if (!entry) return

    const platformNum = Math.floor(Math.random() * 4) + 1

    let path: string[] = []
    let currentEdgeId = ''
    let direction: 1 | -1 = 1

    // 根据列车方向选择入口
    const isUpbound = entry.direction === 'up' // up=向右=从左入口进

    if (map.nodes['n_sw_1']) {
        // --- Terminal (Ladder) --- 终端站只有一个入口
        currentEdgeId = 'e_in'
        direction = 1
        const targetNode = `n_p${platformNum}_end`
        const route = findPath('n_sw_1', targetNode, map)
        if (route.length > 0) {
            path = [currentEdgeId, ...route]
        } else {
            console.error("No path found to", targetNode)
            return
        }
    } else if (map.nodes['n_L_in']) {
        // --- Small Station (Standard) ---
        if (isUpbound) {
            // 上行：从左侧入口进
            currentEdgeId = 'e_entry_L'
            direction = 1
            path = [`e_L_t${platformNum}`, `t${platformNum}`]
        } else {
            // 下行：从右侧入口进
            currentEdgeId = 'e_entry_R'
            direction = -1
            path = [`e_R_in_t${platformNum}`, `t${platformNum}`]
        }
    } else {
        // Fallback / Hub
        currentEdgeId = isUpbound ? 'e_entry_L' : 'e_entry_R'
        direction = isUpbound ? 1 : -1
        path = [`e_L_t${platformNum}`, `t${platformNum}`]
    }

    const newTrain: TrainPhysics = {
        id: id,
        currentEdgeId: currentEdgeId,
        position: 0,
        speed: 60,
        state: 'moving',
        direction: direction,
        path: path,
        visitedPath: [],
        modelType: entry.model,
        isCoupled: Math.random() < 0.2,
        scheduledArriveTick: entry.scheduledArriveTick,
        scheduleEntryId: entry.id,
    }

    const spawnEdge = map.edges[currentEdgeId]
    if (!spawnEdge) {
        console.error("Invalid spawn edge", currentEdgeId)
        return
    }

    // SPAWN SAFETY CHECK
    const isBlocked = trains.some(t =>
        t.currentEdgeId === currentEdgeId && t.position < 300
    )
    if (isBlocked) {
        alert("入口拥堵！前车尚未驶离安全区")
        return
    }

    spawnEdge.occupiedBy = newTrain.id
    trains.push(newTrain)

    // 通知 ScheduleManager 状态变更（不再操作 waitingQueue 数组）
    if (scheduleManager) {
        scheduleManager.markAdmitted(entry.id, tick.value)
    }
}
```

- [ ] **Step 7: 修改 processExitingTrains 出站移交逻辑**

在 `processExitingTrains()` 中：

1. 在 `train.isHandedOver = true` 后新增 ScheduleManager 通知：
```typescript
if (train.position >= handoverThreshold && !train.isHandedOver) {
    train.isHandedOver = true;
    if (scheduleManager && train.scheduleEntryId) {
        scheduleManager.markDeparted(train.scheduleEntryId, tick.value)
    }
}
```

2. 删除第 167-170 行清理 waitingQueue 的逻辑（`waitingQueue.findIndex` / `splice`）

- [ ] **Step 8: 更新 LeftPanel props 传递**

找到模板中 `<LeftPanel>` 使用处，新增 `schedule-manager` prop：

```html
<LeftPanel
  :queue="waitingQueue"
  :trains="trains"
  :schedule-manager="scheduleManager"
  :on-select="handleSelect"
  :selected-id="selectedTrainId"
  :game-start-time="gameStartTime"
  :current-tick="tick"
/>
```

- [ ] **Step 9: 运行开发服务器手动验证**

Run: `npm run dev`
Expected: 游戏启动后列车按时刻表间隔出现，上行从左入口、下行从右入口

- [ ] **Step 10: 提交**

```bash
git add src/App.vue
git commit -m "feat: App.vue 集成 ScheduleManager，替换随机队列，支持双向入口"
```

---

### Task 6: LeftPanel.vue 新增三角形晚点扩散指示器

**Files:**
- Modify: `src/components/panels/LeftPanel.vue`

**关键改动点：**
- 第 6-10 行：删除 `QueuedTrain`，导入 `ScheduleEntry`
- 第 12-19 行：props 新增 `scheduleManager`
- `getTrainStatus` 函数：字段访问路径从 `q.schedule.arriveTick` → `q.scheduledArriveTick`
- 模板第 316-322 行：准点文字后追加三角形
- 样式：新增 `.delay-spread`

- [ ] **Step 1: 替换类型和 props**

1. 删除 `QueuedTrain` 接口定义（第 6-10 行）
2. 新增 import：
```typescript
import type { ScheduleEntry, DelaySpread } from '../../core/types'
import type { ScheduleManager } from '../../core/ScheduleManager'
```
3. 更新 props：
```typescript
const props = defineProps<{
  queue: ScheduleEntry[];
  trains: TrainPhysics[];
  scheduleManager: ScheduleManager | null;
  onSelect: (id: string) => void;
  selectedId: string | null;
  gameStartTime?: { hours: number; minutes: number; seconds: number };
  currentTick?: number;
}>();
```

- [ ] **Step 2: 更新 getTrainStatus 中的字段访问路径**

在 `getTrainStatus` 函数内，所有引用 `queueTrain.schedule.arriveTick` 的地方改为 `queueTrain.scheduledArriveTick`。具体搜索 `schedule.arriveTick` 替换为 `scheduledArriveTick`，`q.schedule` 替换为直接访问 ScheduleEntry 字段。

- [ ] **Step 3: 新增 getDelaySpread 等辅助函数**

```typescript
function getDelaySpread(trainId: string): DelaySpread | null {
  if (!props.scheduleManager) return null
  const entry = props.scheduleManager.getEntryById(trainId)
  if (!entry || entry.status === 'upcoming') return null
  return props.scheduleManager.computeDelaySpread(entry, props.currentTick ?? 0)
}

function formatSpreadDelta(spread: DelaySpread): string {
  const minutes = Math.floor(Math.abs(spread.delta) / 3600)
  if (spread.level === 'improved') return `-${minutes}'`
  if (spread.level === 'worsened') return `+${minutes}'`
  return ''
}

function getSpreadColor(spread: DelaySpread): string {
  if (spread.level === 'improved') return '#2ecc71'
  if (spread.level === 'worsened') return '#e74c3c'
  return '#f1c40f'
}

function getSpreadTriangle(spread: DelaySpread): string {
  if (spread.level === 'worsened') return '▼'
  return '▲'
}
```

- [ ] **Step 4: 在 getTrainStatus 返回值中增加 delaySpread**

在 `allTrains` computed 或 `getTrainStatus` 的返回对象中增加：

```typescript
delaySpread: getDelaySpread(id)
```

- [ ] **Step 5: 在模板中准点文字后渲染三角形**

在 `<span class="punctuality">` 后面（第 322 行之后）追加：

```html
<span
  v-if="item.delaySpread"
  class="delay-spread"
  :style="{ color: getSpreadColor(item.delaySpread) }"
>
  {{ getSpreadTriangle(item.delaySpread) }}{{ formatSpreadDelta(item.delaySpread) }}
</span>
```

- [ ] **Step 6: 新增样式**

在 `<style scoped>` 中追加：

```css
.delay-spread {
  font-weight: bold;
  font-size: 11px;
  margin-left: 4px;
  white-space: nowrap;
}
```

- [ ] **Step 7: 运行开发服务器验证三角形**

Run: `npm run dev`
Expected:
- 列车到达等待区后，准点文字后出现三角形
- 宽限期内三角形为黄色 ▲
- 调度缓慢 → 红色 ▼+X'
- 快速调度 → 绿色 ▲-X'

- [ ] **Step 8: 提交**

```bash
git add src/components/panels/LeftPanel.vue
git commit -m "feat: 左侧面板新增三角形晚点扩散指示器"
```

---

### Task 7: 全局验证和类型检查

**Files:**
- 所有已修改文件

- [ ] **Step 1: 运行 git diff --stat 确认变更文件**

Run: `git diff --stat HEAD~6`
Expected: 列出所有修改的文件，确认无遗漏

- [ ] **Step 2: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 运行所有测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 4: 运行 lint 和格式化**

Run: `npm run lint && npm run format`
Expected: 无错误

- [ ] **Step 5: 运行构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 6: 手动集成测试**

Run: `npm run dev`
验证清单：
1. 游戏启动后列车按时刻表间隔出现（非随机）
2. 上行列车从左入口进，下行列车从右入口进
3. 等待区列车准点文字正确（早点/晚点/准点）
4. 三角形指示器在交接后显示
5. 快速调度 → 绿色 ▲（改善）
6. 延迟调度 → 红色 ▼（恶化）
7. 变化 < 30 秒 → 黄色 ▲（不显示时间）
8. 出站后三角形固定不变
9. 倍速 1x/2x/5x/10x 下均正常
10. 高峰时段列车更密集，低谷时段更稀疏

- [ ] **Step 7: 最终提交（如有 lint/格式修复）**

```bash
git add -A
git commit -m "style: lint 和格式化修复"
```

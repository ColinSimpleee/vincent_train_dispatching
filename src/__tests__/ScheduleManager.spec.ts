import { describe, it, expect } from 'vitest'
import { ScheduleManager } from '../core/ScheduleManager'
import type { ScheduleConfig } from '../core/types'

const baseConfig: ScheduleConfig = {
  peakIntervalRange: [2, 3],
  offPeakIntervalRange: [6, 10],
  peakWindows: [[420, 540], [1020, 1140]],
  directionRatio: 0.5,
}

const peakStartTimeOffset = 420 * 3600
const offPeakStartTimeOffset = 600 * 3600

describe('ScheduleManager', () => {
  describe('时刻表生成', () => {
    it('构造时生成未来 30 分钟的时刻表', () => {
      const manager = new ScheduleManager(baseConfig, 1, 0, peakStartTimeOffset)
      const entries = manager.getAllEntries()
      expect(entries.length).toBeGreaterThan(0)
      const futureLimit = 108000
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
        expect(entry.scheduledDepartTick).toBe(entry.scheduledArriveTick + entry.scheduledStopDuration)
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

      for (let i = 0; i < 9; i++) {
        const entries = manager.getAllEntries()
        const upcoming = entries.filter(e => e.status === 'upcoming')
        if (upcoming.length === 0) break
        const entry = upcoming[0]!
        const arriveTick = entry.scheduledArriveTick + entry.currentDelay
        manager.checkArrivals(arriveTick)
        manager.markAdmitted(entry.id, arriveTick)
        manager.markDeparted(entry.id, entry.scheduledDepartTick + 36000)
      }

      const remaining = manager.getAllEntries().filter(e => e.status === 'upcoming')
      if (remaining.length > 0) {
        const nextEntry = remaining[0]!
        const nextArrive = nextEntry.scheduledArriveTick + nextEntry.currentDelay
        manager.checkArrivals(nextArrive)
        const grace = manager.getEntryById(nextEntry.id)!.reactionGraceTicks ?? 0
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

      for (const entry of entries) {
        expect(entry.line).toBeDefined()
        expect(['京沪', '沪昆']).toContain(entry.line)
      }

      const jinghu = entries.filter(e => e.line === '京沪').length
      const hukun = entries.filter(e => e.line === '沪昆').length
      if (entries.length >= 4) {
        expect(jinghu).toBeGreaterThan(hukun)
      }
    })
  })
})

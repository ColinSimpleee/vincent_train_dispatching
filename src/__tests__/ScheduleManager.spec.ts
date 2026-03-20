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
})

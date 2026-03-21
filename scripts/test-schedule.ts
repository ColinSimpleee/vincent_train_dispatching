/**
 * 时刻表测试脚本
 * 用法: npx tsx scripts/test-schedule.ts
 *
 * 模拟游戏运行，每隔 1 分钟（游戏时间）输出时刻表状态。
 * 默认模拟 30 分钟，可通过参数调整：
 *   npx tsx scripts/test-schedule.ts 60    # 模拟 60 分钟
 */

import { ScheduleManager } from '../src/core/ScheduleManager'
import type { ScheduleConfig, ScheduleEntry } from '../src/core/types'

const TICKS_PER_SECOND = 60
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60

// ── 配置 ──
const config: ScheduleConfig = {
  peakIntervalRange: [2, 3],
  offPeakIntervalRange: [6, 10],
  peakWindows: [
    [420, 540],  // 07:00-09:00
    [1020, 1140], // 17:00-19:00
  ],
  directionRatio: 0.5,
}

const difficulty = 1
const startTick = 0
// 默认从 08:00 高峰期开始，方便观察密集时刻表
const gameStartHour = 8
const gameStartTimeOffsetTicks = gameStartHour * 60 * TICKS_PER_MINUTE

const simulateMinutes = parseInt(process.argv[2] ?? '30', 10)

// ── 工具函数 ──
function tickToTimeStr(tick: number, offsetTicks: number): string {
  const total = offsetTicks + tick
  const totalSeconds = Math.floor(total / TICKS_PER_SECOND)
  const h = Math.floor(totalSeconds / 3600) % 24
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function delayStr(delayTicks: number): string {
  const seconds = Math.round(delayTicks / TICKS_PER_SECOND)
  if (seconds === 0) return '准点'
  const abs = Math.abs(seconds)
  const min = Math.floor(abs / 60)
  const sec = abs % 60
  const sign = seconds > 0 ? '晚' : '早'
  if (min > 0) return `${sign}${min}分${sec > 0 ? sec + '秒' : ''}`
  return `${sign}${sec}秒`
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    upcoming: '即将到达',
    waiting: '等待接入',
    admitted: '已接入',
    departed: '已发车',
  }
  return map[status] ?? status
}

function directionLabel(dir: string): string {
  return dir === 'up' ? '上行 →' : '下行 ←'
}

function printTable(entries: ScheduleEntry[], currentTick: number) {
  // 表头
  const header = [
    '车次'.padEnd(8),
    '方向'.padEnd(6),
    '车型'.padEnd(10),
    '计划到站'.padEnd(10),
    '计划发车'.padEnd(10),
    '当前延误'.padEnd(12),
    '状态'.padEnd(10),
  ].join(' │ ')

  const separator = '─'.repeat(header.length)

  console.log(separator)
  console.log(header)
  console.log(separator)

  for (const e of entries) {
    const row = [
      e.id.padEnd(8),
      directionLabel(e.direction).padEnd(6),
      e.model.padEnd(10),
      tickToTimeStr(e.scheduledArriveTick, gameStartTimeOffsetTicks).padEnd(10),
      tickToTimeStr(e.scheduledDepartTick, gameStartTimeOffsetTicks).padEnd(10),
      delayStr(e.currentDelay).padEnd(12),
      statusLabel(e.status).padEnd(10),
    ].join(' │ ')
    console.log(row)
  }

  console.log(separator)
}

function printStats(entries: ScheduleEntry[]) {
  const counts = { upcoming: 0, waiting: 0, admitted: 0, departed: 0 }
  for (const e of entries) {
    counts[e.status]++
  }
  console.log(
    `  统计: 即将到达=${counts.upcoming}  等待接入=${counts.waiting}  已接入=${counts.admitted}  已发车=${counts.departed}  总计=${entries.length}`,
  )
}

// ── 主模拟 ──
console.log('╔══════════════════════════════════════════╗')
console.log('║        时刻表模拟测试脚本                ║')
console.log('╚══════════════════════════════════════════╝')
console.log()
console.log(`  游戏起始时间: ${tickToTimeStr(0, gameStartTimeOffsetTicks)}`)
console.log(`  模拟时长: ${simulateMinutes} 分钟`)
console.log(`  难度: ${difficulty}`)
console.log(`  高峰时段: 07:00-09:00, 17:00-19:00`)
console.log()

const manager = new ScheduleManager(config, difficulty, startTick, gameStartTimeOffsetTicks)

for (let minute = 0; minute <= simulateMinutes; minute++) {
  const currentTick = minute * TICKS_PER_MINUTE

  // 滚动补充 + 延误更新
  manager.ensureFutureSchedule(currentTick)

  // 模拟这一分钟内的延误漂移（3600 ticks）
  for (let t = 0; t < TICKS_PER_MINUTE; t++) {
    manager.updateDelays()
  }

  // 检查到站
  manager.checkArrivals(currentTick)

  // 模拟玩家操作：自动接入等待中的列车，2 分钟后自动发车
  const waiting = manager.getWaitingEntries()
  for (const w of waiting) {
    manager.markAdmitted(w.id)
  }

  const allEntries = manager.getAllEntries()
  for (const e of allEntries) {
    if (e.status === 'admitted' && currentTick >= e.scheduledDepartTick + (e.currentDelay || 0)) {
      manager.markDeparted(e.id, currentTick)
    }
  }

  // 输出
  const gameTime = tickToTimeStr(currentTick, gameStartTimeOffsetTicks)
  console.log(`\n⏱  游戏时间: ${gameTime}  (第 ${minute} 分钟, tick=${currentTick})`)

  const entries = manager
    .getAllEntries()
    .sort((a, b) => a.scheduledArriveTick - b.scheduledArriveTick)

  // 只显示非 departed 的条目 + 最近 5 条 departed
  const active = entries.filter((e) => e.status !== 'departed')
  const departed = entries.filter((e) => e.status === 'departed').slice(-5)
  const display = [...departed, ...active]

  printTable(display, currentTick)
  printStats(entries)
}

console.log('\n模拟结束。')

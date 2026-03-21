import { TICKS_PER_SECOND } from './constants'

/**
 * 将游戏 tick 转为 HH:MM:SS 字符串
 */
export function tickToTime(
  tick: number,
  startTime: { hours: number; minutes: number; seconds: number },
): string {
  const totalGameSeconds = Math.floor(tick / TICKS_PER_SECOND)

  let hours = startTime.hours
  let minutes = startTime.minutes
  let seconds = startTime.seconds + totalGameSeconds

  minutes += Math.floor(seconds / 60)
  seconds = seconds % 60

  hours += Math.floor(minutes / 60)
  minutes = minutes % 60

  hours = hours % 24

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

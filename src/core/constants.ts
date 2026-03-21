// 游戏全局常量 — 单一来源

// 时间
export const TICKS_PER_SECOND = 60
export const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60 // 3600

// 列车物理
export const CAR_PITCH = 30 // 车厢间距（单位长度）
export const RESUME_SPEED = 60 // 恢复运行速度（单位/秒）

// 停站时间（ticks）
export const DWELL_TIME_MIN = 1800 // 30秒
export const DWELL_TIME_MAX = 3600 // 60秒

// 发车缓冲（ticks）
export const BUFFER_TIME_MIN = 3600 // 60秒
export const BUFFER_TIME_MAX = 5400 // 90秒

// 弹窗
export const SCHEDULE_VISIBLE_WINDOW = 30 * TICKS_PER_MINUTE // 时刻表显示未来30分钟
export const SPEED_OPTIONS = [0, 1, 2, 5, 10] as const
export const DISPATCH_LOG_MAX = 200
export const SPREAD_THRESHOLD = 1800 // 30秒，晚点扩散判定阈值

export const DISPATCH_EVENT_LABELS: Record<string, string> = {
  admit: '接入',
  depart: '发车',
  stop: '停车',
  platform_stop: '进站停靠',
  handover: '移交完成',
}

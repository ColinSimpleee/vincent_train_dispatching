import { describe, it, expect } from 'vitest'
import { useDispatchLog } from '../composables/useDispatchLog'

describe('useDispatchLog', () => {
  it('addLog 添加日志条目并按降序排列', () => {
    const { logs, addLog } = useDispatchLog()
    addLog({ tick: 100, gameTime: '08:00:01', trainId: 'G1', event: 'admit' })
    addLog({ tick: 200, gameTime: '08:00:03', trainId: 'G2', event: 'depart' })

    expect(logs.value).toHaveLength(2)
    expect(logs.value[0]!.trainId).toBe('G2')
    expect(logs.value[1]!.trainId).toBe('G1')
  })

  it('超过上限时移除最旧的条目', () => {
    const { logs, addLog } = useDispatchLog()
    for (let i = 0; i < 205; i++) {
      addLog({ tick: i, gameTime: `${i}`, trainId: `G${i}`, event: 'admit' })
    }
    expect(logs.value).toHaveLength(200)
    expect(logs.value[0]!.trainId).toBe('G204')
    expect(logs.value[199]!.trainId).toBe('G5')
  })

  it('clearLogs 清空所有日志', () => {
    const { logs, addLog, clearLogs } = useDispatchLog()
    addLog({ tick: 1, gameTime: '08:00:00', trainId: 'G1', event: 'stop' })
    clearLogs()
    expect(logs.value).toHaveLength(0)
  })
})

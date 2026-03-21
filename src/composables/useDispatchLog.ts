import { ref } from 'vue'
import type { DispatchLogEntry } from '../core/types'
import { DISPATCH_LOG_MAX } from '../core/constants'

export function useDispatchLog() {
  const logs = ref<DispatchLogEntry[]>([])

  function addLog(entry: DispatchLogEntry): void {
    logs.value.unshift(entry)
    if (logs.value.length > DISPATCH_LOG_MAX) {
      logs.value.length = DISPATCH_LOG_MAX
    }
  }

  function clearLogs(): void {
    logs.value = []
  }

  return { logs, addLog, clearLogs }
}

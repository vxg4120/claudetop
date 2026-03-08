import { listProcesses } from './processes'
import { ClaudeProcess, RunawayThresholds, DEFAULT_THRESHOLDS } from './types'

export function watchProcesses(
  intervalMs: number,
  callback: (processes: ClaudeProcess[]) => void,
  thresholds: RunawayThresholds = DEFAULT_THRESHOLDS
): () => void {
  let active = true

  const tick = async () => {
    if (!active) return
    try {
      const processes = await listProcesses(thresholds)
      if (active) callback(processes)
    } catch {
      // listProcesses failed (e.g., ps unavailable) — skip this tick, keep watching
    }
    if (active) setTimeout(tick, intervalMs)
  }

  tick()

  return () => { active = false }
}

/**
 * Send a signal to a Claude process.
 * @throws {Error} ESRCH if the process does not exist — callers should handle this.
 */
export function killProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  process.kill(pid, signal)
}

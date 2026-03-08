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
    const processes = await listProcesses(thresholds)
    if (active) callback(processes)
    if (active) setTimeout(tick, intervalMs)
  }

  tick()

  return () => { active = false }
}

export function killProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  process.kill(pid, signal)
}

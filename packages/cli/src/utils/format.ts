export function formatMemory(bytes: number): string {
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${parseFloat(gb.toFixed(1))} GB`
  const mb = bytes / (1024 ** 2)
  return `${Math.round(mb)} MB`
}

export function formatRuntime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function formatStatus(isRunaway: boolean, status: string): string {
  if (isRunaway) return 'RUNAWAY'
  return status === 'running' || status === 'sleeping' ? 'ok' : status
}

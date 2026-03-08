import { useState, useEffect } from 'react'

interface ClaudeProcess {
  pid: number
  ppid: number
  memory: { rss: number; vms: number }
  cpu: number
  runtime: number
  status: string
  cwd: string
  args: string[]
  isRunaway: boolean
  logPath?: string
}

declare global {
  interface Window {
    claudetop: {
      listProcesses: () => Promise<ClaudeProcess[]>
      killProcess: (pid: number, signal?: string) => Promise<void>
      securityScan: (pid?: number) => Promise<unknown>
      onProcessUpdate: (cb: (processes: ClaudeProcess[]) => void) => () => void
    }
  }
}

export function useProcesses() {
  const [processes, setProcesses] = useState<ClaudeProcess[]>([])
  const [selected, setSelected] = useState<ClaudeProcess | null>(null)

  useEffect(() => {
    // Initial fetch
    window.claudetop.listProcesses().then(setProcesses)
    // Subscribe to live updates
    const unsub = window.claudetop.onProcessUpdate(setProcesses)
    return unsub
  }, [])

  // Keep selected in sync with updated data
  useEffect(() => {
    if (selected) {
      const updated = processes.find((p) => p.pid === selected.pid)
      setSelected(updated ?? null)
    }
  }, [processes])

  const killProcess = async (pid: number, force = false) => {
    await window.claudetop.killProcess(pid, force ? 'SIGKILL' : 'SIGTERM')
  }

  return { processes, selected, setSelected, killProcess }
}

export type { ClaudeProcess }

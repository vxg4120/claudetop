import si from 'systeminformation'
import { ClaudeProcess, RunawayThresholds, DEFAULT_THRESHOLDS } from './types'

export function isRunaway(
  memory: { rss: number; vms: number },
  runtime: number,
  thresholds: RunawayThresholds = DEFAULT_THRESHOLDS
): boolean {
  return (
    memory.rss > thresholds.memoryRssBytes ||
    runtime > thresholds.runtimeSeconds
  )
}

export async function listProcesses(
  thresholds: RunawayThresholds = DEFAULT_THRESHOLDS
): Promise<ClaudeProcess[]> {
  const allProcesses = await si.processes()

  const claudeProcs = allProcesses.list.filter(
    (p) => {
      if (p.name === 'claude') return true
      // Match 'claude' as a word boundary in the command — avoids matching
      // paths like /home/claudette/bin/node or --config claude.json
      return /(?:^|\/)claude(?:\s|$)/.test(p.command ?? '')
    }
  )

  return claudeProcs.map((p) => {
    const memory = {
      rss: (p.memRss ?? 0) * 1024,  // systeminformation returns KB
      vms: (p.memVsz ?? 0) * 1024,
    }
    const cpu = p.cpu ?? 0
    const runtime = p.started
      ? (Date.now() - new Date(p.started).getTime()) / 1000
      : 0

    return {
      pid: p.pid,
      ppid: p.parentPid ?? 0,
      memory,
      cpu,
      runtime,
      status: mapStatus(p.state ?? ''),
      cwd: p.path ?? 'unknown',
      args: parseArgs(p.params ?? ''),
      isRunaway: isRunaway(memory, runtime, thresholds),
      logPath: undefined,
    }
  })
}

function mapStatus(state: string): ClaudeProcess['status'] {
  const map: Record<string, ClaudeProcess['status']> = {
    R: 'running',
    S: 'sleeping',
    T: 'stopped',
    Z: 'zombie',
    sleeping: 'sleeping',
    running: 'running',
    stopped: 'stopped',
    zombie: 'zombie',
  }
  return map[state] ?? 'unknown'
}

function parseArgs(params: string): string[] {
  return params.trim().split(/\s+/).filter(Boolean)
}

import si from 'systeminformation'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { ClaudeProcess, RunawayThresholds, DEFAULT_THRESHOLDS } from './types'

const execFileAsync = promisify(execFile)

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

/** Use lsof to get the actual working directory of each process (best-effort). */
async function getProcessCwds(pids: number[]): Promise<Map<number, string>> {
  const cwds = new Map<number, string>()
  if (pids.length === 0) return cwds
  try {
    const { stdout } = await execFileAsync('lsof', ['-d', 'cwd', '-Fn', '-p', pids.join(',')])
    let currentPid = 0
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        currentPid = parseInt(line.slice(1), 10)
      } else if (line.startsWith('n') && currentPid && !cwds.has(currentPid)) {
        const candidate = line.slice(1).trim()
        // Only accept absolute paths — reject network addrs, hex pointers, etc.
        if (candidate.startsWith('/')) cwds.set(currentPid, candidate)
      }
    }
  } catch { /* lsof may be unavailable or lack permissions — fall back to p.path */ }
  return cwds
}

/** Return the mtime (ms) of the most recent JSONL for a CWD, or null if not found. */
function getLastJsonlMtimeMs(cwd: string): number | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const decoded = decodeURIComponent(dir)
      if (decoded !== cwd && decoded !== `/${cwd}`) continue
      let latest = 0
      const dirPath = path.join(projectsDir, dir)
      for (const f of fs.readdirSync(dirPath)) {
        if (!f.endsWith('.jsonl')) continue
        try {
          const mtime = fs.statSync(path.join(dirPath, f)).mtimeMs
          if (mtime > latest) latest = mtime
        } catch { /* ignore */ }
      }
      return latest > 0 ? latest : null
    }
  } catch { /* ignore */ }
  return null
}

/** Return set of all CWDs that have Claude session data (for orphan detection). */
function getKnownClaudeCwds(): Set<string> {
  const cwds = new Set<string>()
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const decoded = decodeURIComponent(dir)
      if (decoded.startsWith('/')) cwds.add(decoded)
    }
  } catch { /* ignore */ }
  return cwds
}

function cwdProject(cwd: string): string {
  // Show last 2 meaningful path segments: "repos/claudetop"
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join('/')
  return parts[parts.length - 1] ?? cwd
}

export async function listProcesses(
  thresholds: RunawayThresholds = DEFAULT_THRESHOLDS
): Promise<ClaudeProcess[]> {
  const allProcesses = await si.processes()
  const now = Date.now()

  // First pass: collect Claude main process PIDs
  const claudePids = new Set<number>()
  const claudeProcs: (typeof allProcesses.list)[number][] = []
  for (const p of allProcesses.list) {
    if (p.name === 'claude' || /(?:^|\/)claude(?:\s|$)/.test(p.command ?? '')) {
      claudePids.add(p.pid)
      claudeProcs.push(p)
    }
  }

  // Second pass: find direct children of Claude processes (subtasks / tool executions)
  const childProcs = allProcesses.list.filter(
    (p) => p.parentPid != null && claudePids.has(p.parentPid) && !claudePids.has(p.pid)
  )

  // Third pass: detect orphaned subprocesses — processes whose parent PID no longer exists
  // AND which are in a known Claude project directory. On macOS, when a parent dies the child
  // is reparented to PID 1 instantly, so we can't distinguish via PPID alone — we rely on
  // the CWD check as the primary filter. We only check common tool process names to limit cost.
  const allPidSet = new Set(allProcesses.list.map((p) => p.pid))
  const knownClaudeCwds = getKnownClaudeCwds()
  const trackedPids = new Set([...claudePids, ...childProcs.map((p) => p.pid)])
  // Common tool processes that Claude spawns (bash tools, dev servers, etc.)
  const TOOL_NAMES = new Set(['node', 'python', 'python3', 'ruby', 'go', 'bash', 'sh', 'zsh', 'npm', 'pnpm', 'bun', 'deno', 'uvicorn', 'gunicorn', 'rails'])
  const orphanProcs = allProcesses.list.filter((p) => {
    if (trackedPids.has(p.pid) || claudePids.has(p.pid)) return false
    // Only check known tool process names to avoid scanning every process
    if (!TOOL_NAMES.has(p.name ?? '')) return false
    // Parent must be gone (reparented to 1 on macOS, or PID not in list)
    const orphaned = p.parentPid === 1 || (p.parentPid != null && !allPidSet.has(p.parentPid))
    if (!orphaned) return false
    // Must have been running long enough to not be a coincidence (>5 min)
    const runtime = p.started ? (now - new Date(p.started).getTime()) / 1000 : 0
    if (runtime < 300) return false
    return true
  }).slice(0, 20) // cap at 20 to limit lsof call size

  const allRelevant = [...claudeProcs, ...childProcs, ...orphanProcs]
  const allPids = allRelevant.map((p) => p.pid)
  const cwds = await getProcessCwds(allPids)

  // Resolve orphan CWDs and filter to only those in known Claude project dirs
  const resolvedOrphans = orphanProcs.filter((p) => {
    const cwd = cwds.get(p.pid) ?? ''
    return cwd && knownClaudeCwds.has(cwd)
  })
  const orphanPidSet = new Set(resolvedOrphans.map((p) => p.pid))

  const relevant = [...claudeProcs, ...childProcs, ...resolvedOrphans]

  return relevant.map((p) => {
    const cwd = cwds.get(p.pid) ?? p.path ?? 'unknown'
    const memory = {
      rss: (p.memRss ?? 0) * 1024,  // systeminformation returns KB
      vms: (p.memVsz ?? 0) * 1024,
    }
    const cpu = p.cpu ?? 0
    const rawRuntime = p.started
      ? (now - new Date(p.started).getTime()) / 1000
      : 0
    const runtime = Number.isFinite(rawRuntime) && rawRuntime >= 0 ? rawRuntime : 0

    // API-idle detection: for non-child processes, check when JSONL was last written
    let apiIdleMinutes: number | undefined
    if (!claudePids.has(p.parentPid ?? -1) && cwd !== 'unknown') {
      const lastActivity = getLastJsonlMtimeMs(cwd)
      if (lastActivity !== null) {
        const idleMs = now - lastActivity
        apiIdleMinutes = Math.floor(idleMs / 60_000)
      }
    }

    return {
      pid: p.pid,
      ppid: p.parentPid ?? 0,
      name: p.name ?? 'unknown',
      project: cwd !== 'unknown' ? cwdProject(cwd) : undefined,
      memory,
      cpu,
      runtime,
      status: mapStatus(p.state ?? ''),
      cwd,
      args: parseArgs(p.params ?? ''),
      isRunaway: isRunaway(memory, runtime, thresholds),
      isChild: claudePids.has(p.parentPid ?? -1),
      isOrphaned: orphanPidSet.has(p.pid),
      apiIdleMinutes,
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

# claudetop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build claudetop — a process manager for Claude CLI tasks — as a pnpm monorepo with three packages: `@claudetop/core` (process inspection), `claudetop` (CLI), and an Electron desktop app.

**Architecture:** Shared core library handles all process inspection via `systeminformation` and `node-pty`. CLI consumes core via `commander` + `ink`. Electron app consumes core in its main process and sends data to the React renderer via IPC. Data flows one direction: core → consumers.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (tests), `systeminformation`, `node-pty`, `commander`, `ink`, Electron, React, `electron-builder`

**Design doc:** `docs/plans/2026-03-08-claudetop-design.md`

---

## Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/cli/package.json`
- Create: `packages/app/package.json`

**Step 1: Install pnpm if not already installed**

```bash
npm install -g pnpm
pnpm --version
```

Expected: version number printed (8.x or higher)

**Step 2: Write root `package.json`**

```json
{
  "name": "claudetop",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "dev:cli": "pnpm --filter cli dev",
    "dev:app": "pnpm --filter app dev"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0"
  }
}
```

**Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

**Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 5: Write `packages/core/package.json`**

```json
{
  "name": "@claudetop/core",
  "version": "0.1.0",
  "description": "Core process inspection library for claudetop",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "systeminformation": "^5.22.0",
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "@types/node": "^20.0.0"
  }
}
```

**Step 6: Write `packages/cli/package.json`**

```json
{
  "name": "claudetop",
  "version": "0.1.0",
  "description": "Claude CLI process manager",
  "bin": {
    "claudetop": "dist/index.js"
  },
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@claudetop/core": "workspace:*",
    "commander": "^12.0.0",
    "ink": "^4.4.1",
    "react": "^18.2.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0"
  }
}
```

**Step 7: Write `packages/app/package.json`**

```json
{
  "name": "claudetop-app",
  "version": "0.1.0",
  "description": "claudetop Electron desktop app",
  "main": "dist/electron/main.js",
  "scripts": {
    "build": "tsc && vite build",
    "dev": "concurrently \"tsc --watch\" \"vite\" \"electron .\"",
    "test": "vitest run",
    "package": "electron-builder"
  },
  "dependencies": {
    "@claudetop/core": "workspace:*",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "electron": "^29.0.0",
    "electron-builder": "^24.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "concurrently": "^8.0.0"
  }
}
```

**Step 8: Install all dependencies**

```bash
pnpm install
```

Expected: lockfile created, `node_modules` populated in root and packages

**Step 9: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

Write identical tsconfigs for `packages/cli/` and `packages/app/` (same content, they can share the base).

**Step 10: Commit**

```bash
git add .
git commit -m "feat: scaffold pnpm monorepo with core, cli, app packages"
```

---

## Task 2: Core — Types & Permissions Module

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/permissions.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/__tests__/permissions.test.ts`

**Step 1: Write `packages/core/src/types.ts`**

```typescript
export interface ClaudeProcess {
  pid: number
  ppid: number
  memory: {
    rss: number   // bytes
    vms: number   // bytes
  }
  cpu: number           // percentage
  runtime: number       // seconds
  status: 'running' | 'sleeping' | 'stopped' | 'zombie' | 'unknown'
  cwd: string
  args: string[]
  isRunaway: boolean
  logPath?: string
}

export interface PermissionReport {
  canListOwnProcesses: boolean
  canReadCwd: boolean
  canReadNetworkConnections: boolean
  canReadFileDescriptors: boolean
  isElevated: boolean
  platform: NodeJS.Platform
}

export interface SecurityReport {
  pid?: number
  scannedAt: Date
  networkConnections: NetworkConnection[]
  suspiciousConnections: NetworkConnection[]
  openFiles: string[]
  flaggedFiles: string[]
  childProcessCount: number
  anomalies: string[]
}

export interface NetworkConnection {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
}

export interface RunawayThresholds {
  memoryRssBytes: number    // default: 2GB
  runtimeSeconds: number    // default: 7200 (2h)
  cpuPercent: number        // default: 80
  cpuSustainedSeconds: number // default: 60
}

export const DEFAULT_THRESHOLDS: RunawayThresholds = {
  memoryRssBytes: 2 * 1024 * 1024 * 1024,
  runtimeSeconds: 7200,
  cpuPercent: 80,
  cpuSustainedSeconds: 60,
}
```

**Step 2: Write failing test `packages/core/src/__tests__/permissions.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { checkPermissions } from '../permissions'

describe('checkPermissions', () => {
  it('returns a valid PermissionReport', async () => {
    const report = await checkPermissions()
    expect(report).toMatchObject({
      canListOwnProcesses: expect.any(Boolean),
      canReadCwd: expect.any(Boolean),
      canReadNetworkConnections: expect.any(Boolean),
      canReadFileDescriptors: expect.any(Boolean),
      isElevated: expect.any(Boolean),
      platform: expect.any(String),
    })
  })

  it('correctly detects the platform', async () => {
    const report = await checkPermissions()
    expect(['darwin', 'linux']).toContain(report.platform)
  })

  it('always allows listing own processes', async () => {
    const report = await checkPermissions()
    expect(report.canListOwnProcesses).toBe(true)
  })
})
```

**Step 3: Run test to verify it fails**

```bash
cd packages/core && pnpm test
```

Expected: FAIL — `Cannot find module '../permissions'`

**Step 4: Write `packages/core/src/permissions.ts`**

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'
import { PermissionReport } from './types'

const execAsync = promisify(exec)

export async function checkPermissions(): Promise<PermissionReport> {
  const platform = process.platform as NodeJS.Platform
  const isElevated = process.getuid?.() === 0 || false

  // Test cwd reading by trying lsof on our own pid
  let canReadCwd = false
  let canReadNetworkConnections = false
  let canReadFileDescriptors = false

  try {
    if (platform === 'darwin') {
      await execAsync(`lsof -p ${process.pid} -a -d cwd 2>/dev/null`)
      canReadCwd = true
    } else {
      // Linux: /proc is always readable for own processes
      canReadCwd = true
    }
  } catch {
    canReadCwd = false
  }

  try {
    if (platform === 'darwin') {
      await execAsync(`lsof -p ${process.pid} -a -i 2>/dev/null`)
      canReadNetworkConnections = true
    } else {
      await execAsync(`cat /proc/net/tcp 2>/dev/null`)
      canReadNetworkConnections = true
    }
  } catch {
    canReadNetworkConnections = false
  }

  try {
    if (platform === 'darwin') {
      await execAsync(`lsof -p ${process.pid} 2>/dev/null`)
      canReadFileDescriptors = true
    } else {
      canReadFileDescriptors = true // /proc/pid/fd always readable for own process
    }
  } catch {
    canReadFileDescriptors = false
  }

  return {
    canListOwnProcesses: true, // always available
    canReadCwd,
    canReadNetworkConnections,
    canReadFileDescriptors,
    isElevated,
    platform,
  }
}
```

**Step 5: Write `packages/core/src/index.ts`**

```typescript
export * from './types'
export * from './permissions'
```

**Step 6: Run tests to verify they pass**

```bash
cd packages/core && pnpm test
```

Expected: PASS — 3 tests pass

**Step 7: Commit**

```bash
git add packages/core/src/
git commit -m "feat(core): add types and permissions module"
```

---

## Task 3: Core — Process Listing

**Files:**
- Create: `packages/core/src/processes.ts`
- Create: `packages/core/src/__tests__/processes.test.ts`

**Step 1: Write failing tests `packages/core/src/__tests__/processes.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { listProcesses, isRunaway } from '../processes'
import { DEFAULT_THRESHOLDS } from '../types'

describe('listProcesses', () => {
  it('returns an array', async () => {
    const processes = await listProcesses()
    expect(Array.isArray(processes)).toBe(true)
  })

  it('each process has required fields', async () => {
    const processes = await listProcesses()
    // May be empty if no claude is running, but structure must be valid
    for (const p of processes) {
      expect(p).toMatchObject({
        pid: expect.any(Number),
        ppid: expect.any(Number),
        memory: {
          rss: expect.any(Number),
          vms: expect.any(Number),
        },
        cpu: expect.any(Number),
        runtime: expect.any(Number),
        status: expect.any(String),
        cwd: expect.any(String),
        args: expect.any(Array),
        isRunaway: expect.any(Boolean),
      })
    }
  })
})

describe('isRunaway', () => {
  it('flags high memory as runaway', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, memoryRssBytes: 100 }
    expect(isRunaway({ rss: 200, vms: 0 }, 0, 0, thresholds)).toBe(true)
  })

  it('flags long runtime as runaway', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, runtimeSeconds: 10 }
    expect(isRunaway({ rss: 0, vms: 0 }, 0, 20, thresholds)).toBe(true)
  })

  it('does not flag normal processes', () => {
    expect(isRunaway({ rss: 100_000, vms: 0 }, 5, 60, DEFAULT_THRESHOLDS)).toBe(false)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test
```

Expected: FAIL — `Cannot find module '../processes'`

**Step 3: Write `packages/core/src/processes.ts`**

```typescript
import si from 'systeminformation'
import { ClaudeProcess, RunawayThresholds, DEFAULT_THRESHOLDS } from './types'

export function isRunaway(
  memory: { rss: number; vms: number },
  cpu: number,
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
    (p) => p.name === 'claude' || p.command?.includes('claude')
  )

  return claudeProcs.map((p) => {
    const memory = {
      rss: p.memRss * 1024,  // systeminformation returns KB
      vms: p.memVsz * 1024,
    }
    const cpu = p.pcpu ?? 0
    const runtime = p.started ? (Date.now() - new Date(p.started).getTime()) / 1000 : 0

    return {
      pid: p.pid,
      ppid: p.parentPid,
      memory,
      cpu,
      runtime,
      status: mapStatus(p.state),
      cwd: p.path ?? 'unknown',
      args: parseArgs(p.params ?? ''),
      isRunaway: isRunaway(memory, cpu, runtime, thresholds),
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
```

**Step 4: Export from index**

Add to `packages/core/src/index.ts`:

```typescript
export * from './processes'
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/core && pnpm test
```

Expected: PASS — all tests pass

**Step 6: Commit**

```bash
git add packages/core/src/
git commit -m "feat(core): add process listing with runaway detection"
```

---

## Task 4: Core — Watch & Kill

**Files:**
- Create: `packages/core/src/watch.ts`
- Create: `packages/core/src/__tests__/watch.test.ts`

**Step 1: Write failing test `packages/core/src/__tests__/watch.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { watchProcesses } from '../watch'

describe('watchProcesses', () => {
  it('returns an unsubscribe function', () => {
    const unsubscribe = watchProcesses(100, vi.fn())
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('calls callback with process list', async () => {
    const callback = vi.fn()
    const unsubscribe = watchProcesses(100, callback)
    await new Promise((r) => setTimeout(r, 150))
    unsubscribe()
    expect(callback).toHaveBeenCalled()
    expect(Array.isArray(callback.mock.calls[0][0])).toBe(true)
  })

  it('stops calling callback after unsubscribe', async () => {
    const callback = vi.fn()
    const unsubscribe = watchProcesses(100, callback)
    await new Promise((r) => setTimeout(r, 150))
    const countBeforeUnsub = callback.mock.calls.length
    unsubscribe()
    await new Promise((r) => setTimeout(r, 200))
    expect(callback.mock.calls.length).toBe(countBeforeUnsub)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test
```

Expected: FAIL — `Cannot find module '../watch'`

**Step 3: Write `packages/core/src/watch.ts`**

```typescript
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
```

**Step 4: Export from index**

Add to `packages/core/src/index.ts`:

```typescript
export * from './watch'
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/core && pnpm test
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/
git commit -m "feat(core): add watchProcesses and killProcess"
```

---

## Task 5: Core — Log Tailing

**Files:**
- Create: `packages/core/src/logs.ts`

Note: `node-pty` creates a pseudo-terminal to attach to a process's output. This is not easily unit-testable without a real process, so we write an integration-style implementation and manual test.

**Step 1: Write `packages/core/src/logs.ts`**

```typescript
import { EventEmitter } from 'events'
import * as pty from 'node-pty'

export interface LogTailer extends EventEmitter {
  dispose(): void
}

/**
 * Tails stdout/stderr of a process by PID using node-pty.
 * Emits 'data' events with string chunks and 'error' on failure.
 * Call dispose() to stop tailing.
 */
export function tailLog(pid: number): LogTailer {
  const emitter = new EventEmitter() as LogTailer

  let disposed = false

  // Use `tail -f /proc/<pid>/fd/1` on Linux, `lsof` approach on macOS
  // Most reliable cross-platform: spawn `strace`/`dtruss` is too invasive
  // Instead, read from /proc/pid/fd/1 (Linux) or use a shell trick
  // For v1: tail the claude log file from ~/.claude/logs/ if it exists
  const platform = process.platform

  let ptyProcess: pty.IPty | null = null

  try {
    if (platform === 'linux') {
      ptyProcess = pty.spawn('tail', ['-f', `/proc/${pid}/fd/1`], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME ?? '/',
        env: process.env as Record<string, string>,
      })
    } else {
      // macOS: try to find the log file
      const logPath = `${process.env.HOME}/.claude/logs/`
      ptyProcess = pty.spawn('sh', ['-c', `ls -t ${logPath}*.log 2>/dev/null | head -1 | xargs tail -f`], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME ?? '/',
        env: process.env as Record<string, string>,
      })
    }

    ptyProcess.onData((data) => {
      if (!disposed) emitter.emit('data', data)
    })

    ptyProcess.onExit(() => {
      if (!disposed) emitter.emit('end')
    })
  } catch (err) {
    emitter.emit('error', err)
  }

  emitter.dispose = () => {
    disposed = true
    ptyProcess?.kill()
  }

  return emitter
}
```

**Step 2: Export from index**

Add to `packages/core/src/index.ts`:

```typescript
export * from './logs'
```

**Step 3: Commit**

```bash
git add packages/core/src/logs.ts packages/core/src/index.ts
git commit -m "feat(core): add log tailing via node-pty"
```

---

## Task 6: Core — Security Scan

**Files:**
- Create: `packages/core/src/scan.ts`
- Create: `packages/core/src/__tests__/scan.test.ts`

**Step 1: Write failing test `packages/core/src/__tests__/scan.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { parseNetworkConnections, isSuspiciousConnection, isFlaggedFile } from '../scan'

describe('parseNetworkConnections', () => {
  it('parses lsof network output', () => {
    const lsofOutput = `claude  1234  user  12u  IPv4  0x1  0t0  TCP localhost:52341->api.anthropic.com:443 (ESTABLISHED)`
    const connections = parseNetworkConnections(lsofOutput)
    expect(connections).toHaveLength(1)
    expect(connections[0].remoteAddress).toBe('api.anthropic.com')
    expect(connections[0].remotePort).toBe(443)
  })

  it('returns empty array for no connections', () => {
    expect(parseNetworkConnections('')).toEqual([])
  })
})

describe('isSuspiciousConnection', () => {
  it('allows anthropic.com connections', () => {
    expect(isSuspiciousConnection({ remoteAddress: 'api.anthropic.com', remotePort: 443 } as any)).toBe(false)
  })

  it('flags non-standard ports', () => {
    expect(isSuspiciousConnection({ remoteAddress: 'unknown.xyz', remotePort: 4444 } as any)).toBe(true)
  })

  it('flags unknown hosts on standard ports', () => {
    expect(isSuspiciousConnection({ remoteAddress: 'unknown-random.xyz', remotePort: 443 } as any)).toBe(true)
  })
})

describe('isFlaggedFile', () => {
  it('flags sensitive system files', () => {
    expect(isFlaggedFile('/etc/passwd')).toBe(true)
    expect(isFlaggedFile('/etc/shadow')).toBe(true)
  })

  it('allows normal claude files', () => {
    expect(isFlaggedFile('/Users/user/.claude/history.jsonl')).toBe(false)
    expect(isFlaggedFile('/tmp/claude-abc123')).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test
```

Expected: FAIL — `Cannot find module '../scan'`

**Step 3: Write `packages/core/src/scan.ts`**

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'
import { SecurityReport, NetworkConnection } from './types'

const execAsync = promisify(exec)

const ALLOWED_HOSTS = [
  'api.anthropic.com',
  'sentry.io',
  'statsig.com',
  'localhost',
  '127.0.0.1',
  '::1',
]

const FLAGGED_FILE_PATTERNS = [
  /^\/etc\/passwd$/,
  /^\/etc\/shadow$/,
  /^\/etc\/sudoers/,
  /^\/.ssh\//,
  /^\/private\/etc\//,
]

export function isSuspiciousConnection(conn: NetworkConnection): boolean {
  if (ALLOWED_HOSTS.some((h) => conn.remoteAddress.endsWith(h))) {
    return false
  }
  return true
}

export function isFlaggedFile(filePath: string): boolean {
  return FLAGGED_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
}

export function parseNetworkConnections(lsofOutput: string): NetworkConnection[] {
  const connections: NetworkConnection[] = []
  const lines = lsofOutput.split('\n')

  for (const line of lines) {
    // Match: address:port->address:port (ESTABLISHED)
    const match = line.match(/(\S+):(\d+)->(\S+):(\d+)\s+\((\w+)\)/)
    if (!match) continue

    connections.push({
      localAddress: match[1],
      localPort: parseInt(match[2]),
      remoteAddress: match[3],
      remotePort: parseInt(match[4]),
      state: match[5],
    })
  }

  return connections
}

export async function securityScan(pid?: number): Promise<SecurityReport> {
  const platform = process.platform
  const anomalies: string[] = []
  let networkConnections: NetworkConnection[] = []
  let openFiles: string[] = []

  try {
    if (platform === 'darwin') {
      const pidFlag = pid ? `-p ${pid}` : '-c claude'
      const { stdout: netOut } = await execAsync(`lsof ${pidFlag} -a -i 2>/dev/null || true`)
      networkConnections = parseNetworkConnections(netOut)

      const { stdout: fileOut } = await execAsync(`lsof ${pidFlag} -a -d 0-999 2>/dev/null || true`)
      openFiles = fileOut.split('\n').slice(1).map((l) => l.split(/\s+/).pop() ?? '').filter(Boolean)
    } else {
      // Linux: read /proc
      if (pid) {
        const { stdout } = await execAsync(`ls -la /proc/${pid}/fd 2>/dev/null || true`)
        openFiles = stdout.split('\n').map((l) => l.split('->').pop()?.trim() ?? '').filter(Boolean)
      }
    }
  } catch {
    anomalies.push('Could not complete full scan — try with elevated permissions')
  }

  const suspiciousConnections = networkConnections.filter(isSuspiciousConnection)
  const flaggedFiles = openFiles.filter(isFlaggedFile)

  if (suspiciousConnections.length > 0) {
    anomalies.push(`${suspiciousConnections.length} suspicious network connection(s) detected`)
  }
  if (flaggedFiles.length > 0) {
    anomalies.push(`${flaggedFiles.length} sensitive file(s) accessed`)
  }

  return {
    pid,
    scannedAt: new Date(),
    networkConnections,
    suspiciousConnections,
    openFiles,
    flaggedFiles,
    childProcessCount: 0,
    anomalies,
  }
}
```

**Step 4: Export from index**

Add to `packages/core/src/index.ts`:

```typescript
export * from './scan'
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/core && pnpm test
```

Expected: PASS — all tests pass

**Step 6: Build core to verify TypeScript compiles**

```bash
cd packages/core && pnpm build
```

Expected: `dist/` directory created with `.js` and `.d.ts` files

**Step 7: Commit**

```bash
git add packages/core/src/
git commit -m "feat(core): add security scanning"
```

---

## Task 7: CLI — Setup & List Command

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/list.ts`
- Create: `packages/cli/src/utils/format.ts`
- Create: `packages/cli/src/__tests__/format.test.ts`
- Create: `packages/cli/tsconfig.json`

**Step 1: Write `packages/cli/tsconfig.json`**

Same as core:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react"
  },
  "include": ["src/**/*"]
}
```

**Step 2: Write failing test `packages/cli/src/__tests__/format.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { formatMemory, formatRuntime, formatStatus } from '../utils/format'

describe('formatMemory', () => {
  it('formats bytes as MB', () => {
    expect(formatMemory(500 * 1024 * 1024)).toBe('500 MB')
  })
  it('formats bytes as GB', () => {
    expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})

describe('formatRuntime', () => {
  it('formats seconds as minutes', () => {
    expect(formatRuntime(125)).toBe('2m 05s')
  })
  it('formats hours', () => {
    expect(formatRuntime(7333)).toBe('2h 02m')
  })
})

describe('formatStatus', () => {
  it('marks runaway processes', () => {
    expect(formatStatus(true, 'running')).toContain('RUNAWAY')
  })
  it('shows ok for normal processes', () => {
    expect(formatStatus(false, 'running')).toBe('ok')
  })
})
```

**Step 3: Run test to verify it fails**

```bash
cd packages/cli && pnpm test
```

Expected: FAIL

**Step 4: Write `packages/cli/src/utils/format.ts`**

```typescript
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
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/cli && pnpm test
```

Expected: PASS

**Step 6: Write `packages/cli/src/commands/list.ts`**

```typescript
import { listProcesses } from '@claudetop/core'
import { formatMemory, formatRuntime, formatStatus } from '../utils/format'

export async function listCommand(options: { json?: boolean } = {}) {
  const processes = await listProcesses()

  if (options.json) {
    console.log(JSON.stringify(processes, null, 2))
    return
  }

  if (processes.length === 0) {
    console.log('No Claude processes found.')
    return
  }

  const header = ['PID', 'MEM', 'CPU', 'RUNTIME', 'STATUS', 'ARGS']
  const rows = processes.map((p) => [
    String(p.pid),
    formatMemory(p.memory.rss),
    `${p.cpu.toFixed(1)}%`,
    formatRuntime(p.runtime),
    formatStatus(p.isRunaway, p.status),
    p.args.join(' ').substring(0, 40) || '—',
  ])

  // Calculate column widths
  const cols = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  )

  const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(cols[i])).join('  ')

  console.log(fmt(header))
  console.log(cols.map((w) => '-'.repeat(w)).join('  '))
  rows.forEach((row, i) => {
    const isRunaway = processes[i].isRunaway
    const line = fmt(row)
    // Highlight runaway rows
    if (isRunaway) {
      console.log(`\x1b[31m${line}\x1b[0m`)
    } else {
      console.log(line)
    }
  })
}
```

**Step 7: Write `packages/cli/src/index.ts`**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { listCommand } from './commands/list'

const program = new Command()

program
  .name('claudetop')
  .description('Claude CLI process manager')
  .version('0.1.0')

program
  .command('list', { isDefault: true })
  .description('List all Claude processes')
  .option('--json', 'Output as JSON')
  .action((options) => listCommand(options))

program.parse()
```

**Step 8: Build and smoke test**

```bash
cd packages/cli && pnpm build && node dist/index.js list
```

Expected: Either "No Claude processes found." or a table of processes

**Step 9: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add list command with runaway highlighting"
```

---

## Task 8: CLI — Kill, Inspect, Scan Commands

**Files:**
- Create: `packages/cli/src/commands/kill.ts`
- Create: `packages/cli/src/commands/inspect.ts`
- Create: `packages/cli/src/commands/scan.ts`
- Create: `packages/cli/src/commands/logs.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Write `packages/cli/src/commands/kill.ts`**

```typescript
import * as readline from 'readline'
import { listProcesses, killProcess } from '@claudetop/core'

export async function killCommand(pid: number, options: { force?: boolean } = {}) {
  const signal = options.force ? 'SIGKILL' : 'SIGTERM'

  // Verify the process exists and is a claude process
  const processes = await listProcesses()
  const target = processes.find((p) => p.pid === pid)

  if (!target) {
    console.error(`No Claude process found with PID ${pid}`)
    process.exit(1)
  }

  // Confirmation prompt
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise<void>((resolve) => {
    rl.question(`Kill PID ${pid} (${signal})? [y/N] `, (answer) => {
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.')
        process.exit(0)
      }
      resolve()
    })
  })

  killProcess(pid, signal)
  console.log(`Sent ${signal} to PID ${pid}`)
}

export async function killAllCommand() {
  const processes = await listProcesses()

  if (processes.length === 0) {
    console.log('No Claude processes found.')
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise<void>((resolve) => {
    rl.question(`Kill ALL ${processes.length} Claude process(es)? [y/N] `, (answer) => {
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.')
        process.exit(0)
      }
      resolve()
    })
  })

  for (const p of processes) {
    killProcess(p.pid, 'SIGTERM')
    console.log(`Sent SIGTERM to PID ${p.pid}`)
  }
}
```

**Step 2: Write `packages/cli/src/commands/inspect.ts`**

```typescript
import { listProcesses, checkPermissions } from '@claudetop/core'
import { formatMemory, formatRuntime } from '../utils/format'

export async function inspectCommand(pid: number) {
  const [processes, permissions] = await Promise.all([listProcesses(), checkPermissions()])
  const target = processes.find((p) => p.pid === pid)

  if (!target) {
    console.error(`No Claude process found with PID ${pid}`)
    process.exit(1)
  }

  console.log(`\n── PID ${target.pid} ──────────────────────`)
  console.log(`  Status:    ${target.status}${target.isRunaway ? ' ⚠ RUNAWAY' : ''}`)
  console.log(`  Memory:    ${formatMemory(target.memory.rss)} RSS / ${formatMemory(target.memory.vms)} VMS`)
  console.log(`  CPU:       ${target.cpu.toFixed(1)}%`)
  console.log(`  Runtime:   ${formatRuntime(target.runtime)}`)
  console.log(`  CWD:       ${target.cwd}`)
  console.log(`  Args:      ${target.args.join(' ') || '(none)'}`)
  console.log(`  PPID:      ${target.ppid}`)

  if (!permissions.canReadNetworkConnections) {
    console.log('\n  🔒 Network connections: requires elevated access')
  }
  if (!permissions.canReadFileDescriptors) {
    console.log('  🔒 File descriptors: requires elevated access')
  }
  console.log('')
}
```

**Step 3: Write `packages/cli/src/commands/scan.ts`**

```typescript
import { securityScan } from '@claudetop/core'

export async function scanCommand(pid?: number) {
  console.log(`\nRunning security scan${pid ? ` on PID ${pid}` : ' on all Claude processes'}...\n`)

  const report = await securityScan(pid)

  console.log(`Scanned at: ${report.scannedAt.toISOString()}`)
  console.log(`Network connections: ${report.networkConnections.length}`)
  console.log(`Suspicious connections: ${report.suspiciousConnections.length}`)
  console.log(`Open files checked: ${report.openFiles.length}`)
  console.log(`Flagged files: ${report.flaggedFiles.length}`)

  if (report.anomalies.length === 0) {
    console.log('\n✓ No anomalies detected')
  } else {
    console.log('\n⚠ Anomalies:')
    report.anomalies.forEach((a) => console.log(`  - ${a}`))
  }

  if (report.suspiciousConnections.length > 0) {
    console.log('\nSuspicious connections:')
    report.suspiciousConnections.forEach((c) => {
      console.log(`  ${c.remoteAddress}:${c.remotePort} (${c.state})`)
    })
  }

  if (report.flaggedFiles.length > 0) {
    console.log('\nFlagged files:')
    report.flaggedFiles.forEach((f) => console.log(`  ${f}`))
  }

  console.log('')
}
```

**Step 4: Write `packages/cli/src/commands/logs.ts`**

```typescript
import { tailLog } from '@claudetop/core'

export function logsCommand(pid: number) {
  console.log(`Tailing logs for PID ${pid}... (Ctrl+C to stop)\n`)

  const tailer = tailLog(pid)

  tailer.on('data', (chunk: string) => process.stdout.write(chunk))
  tailer.on('error', (err: Error) => {
    console.error(`Error tailing logs: ${err.message}`)
    process.exit(1)
  })
  tailer.on('end', () => {
    console.log('\nProcess ended.')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    tailer.dispose()
    process.exit(0)
  })
}
```

**Step 5: Update `packages/cli/src/index.ts` with all commands**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { listCommand } from './commands/list'
import { killCommand, killAllCommand } from './commands/kill'
import { inspectCommand } from './commands/inspect'
import { scanCommand } from './commands/scan'
import { logsCommand } from './commands/logs'

const program = new Command()

program
  .name('claudetop')
  .description('Claude CLI process manager')
  .version('0.1.0')

program
  .command('list', { isDefault: true })
  .description('List all Claude processes')
  .option('--json', 'Output as JSON')
  .action((options) => listCommand(options))

program
  .command('watch')
  .description('Live-refreshing process list')
  .action(() => {
    // TODO: implement with ink in Task 9
    console.log('watch mode coming soon')
  })

program
  .command('inspect <pid>')
  .description('Detailed view of a process')
  .action((pid) => inspectCommand(parseInt(pid)))

program
  .command('kill <pid>')
  .description('Kill a Claude process')
  .option('--force', 'Use SIGKILL instead of SIGTERM')
  .action((pid, options) => killCommand(parseInt(pid), options))

program
  .command('killall')
  .description('Kill all Claude processes')
  .action(() => killAllCommand())

program
  .command('logs <pid>')
  .description('Tail logs for a process')
  .action((pid) => logsCommand(parseInt(pid)))

program
  .command('scan [pid]')
  .description('Security scan')
  .option('--sudo', 'Run with elevated permissions')
  .action((pid, options) => {
    if (options.sudo) {
      console.error('Re-run with sudo for elevated scan.')
      process.exit(1)
    }
    scanCommand(pid ? parseInt(pid) : undefined)
  })

program.parse()
```

**Step 6: Build and test**

```bash
cd packages/cli && pnpm build
node dist/index.js --help
node dist/index.js scan
```

Expected: Help text printed, scan runs without errors

**Step 7: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): add kill, inspect, scan, and logs commands"
```

---

## Task 9: CLI — Watch Mode with Ink

**Files:**
- Create: `packages/cli/src/components/ProcessTable.tsx`
- Create: `packages/cli/src/commands/watch.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Write `packages/cli/src/components/ProcessTable.tsx`**

```tsx
import React, { useState, useEffect } from 'react'
import { Text, Box } from 'ink'
import { ClaudeProcess, watchProcesses } from '@claudetop/core'
import { formatMemory, formatRuntime, formatStatus } from '../utils/format'

export function ProcessTable() {
  const [processes, setProcesses] = useState<ClaudeProcess[]>([])
  const [lastUpdated, setLastUpdated] = useState(new Date())

  useEffect(() => {
    const unsubscribe = watchProcesses(2000, (procs) => {
      setProcesses(procs)
      setLastUpdated(new Date())
    })
    return unsubscribe
  }, [])

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>claudetop </Text>
        <Text dimColor>— updated {lastUpdated.toLocaleTimeString()}</Text>
      </Box>

      <Box>
        {['PID', 'MEM', 'CPU', 'RUNTIME', 'STATUS', 'ARGS'].map((h) => (
          <Box key={h} width={h === 'ARGS' ? 40 : 12}>
            <Text bold>{h}</Text>
          </Box>
        ))}
      </Box>

      {processes.length === 0 ? (
        <Text dimColor>No Claude processes found.</Text>
      ) : (
        processes.map((p) => (
          <Box key={p.pid}>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{p.pid}</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{formatMemory(p.memory.rss)}</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{p.cpu.toFixed(1)}%</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : undefined}>{formatRuntime(p.runtime)}</Text></Box>
            <Box width={12}><Text color={p.isRunaway ? 'red' : 'green'}>{formatStatus(p.isRunaway, p.status)}</Text></Box>
            <Box width={40}><Text>{p.args.join(' ').substring(0, 38) || '—'}</Text></Box>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
```

**Step 2: Write `packages/cli/src/commands/watch.ts`**

```typescript
import React from 'react'
import { render } from 'ink'
import { ProcessTable } from '../components/ProcessTable'

export function watchCommand() {
  render(React.createElement(ProcessTable))
}
```

**Step 3: Update watch stub in `packages/cli/src/index.ts`**

Replace:
```typescript
program
  .command('watch')
  .description('Live-refreshing process list')
  .action(() => {
    // TODO: implement with ink in Task 9
    console.log('watch mode coming soon')
  })
```

With:
```typescript
import { watchCommand } from './commands/watch'

program
  .command('watch')
  .description('Live-refreshing process list')
  .action(() => watchCommand())
```

**Step 4: Build and test**

```bash
cd packages/cli && pnpm build && node dist/index.js watch
```

Expected: Live-refreshing table appears. Ctrl+C exits cleanly.

**Step 5: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add ink-based watch mode"
```

---

## Task 10: Electron App — Scaffolding

**Files:**
- Create: `packages/app/tsconfig.json`
- Create: `packages/app/vite.config.ts`
- Create: `packages/app/electron/main.ts`
- Create: `packages/app/electron/preload.ts`
- Create: `packages/app/src/App.tsx`
- Create: `packages/app/src/main.tsx`
- Create: `packages/app/index.html`
- Create: `packages/app/electron-builder.yml`

**Step 1: Write `packages/app/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["electron/**/*", "src/**/*"]
}
```

**Step 2: Write `packages/app/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
  },
  server: {
    port: 5173,
  },
})
```

**Step 3: Write `packages/app/electron/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('claudetop', {
  listProcesses: () => ipcRenderer.invoke('list-processes'),
  killProcess: (pid: number, signal?: string) => ipcRenderer.invoke('kill-process', pid, signal),
  securityScan: (pid?: number) => ipcRenderer.invoke('security-scan', pid),
  onProcessUpdate: (callback: (processes: unknown[]) => void) => {
    ipcRenderer.on('process-update', (_event, processes) => callback(processes))
    return () => ipcRenderer.removeAllListeners('process-update')
  },
})
```

**Step 4: Write `packages/app/electron/main.ts`**

```typescript
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import path from 'path'
import { listProcesses, killProcess, securityScan, watchProcesses } from '@claudetop/core'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function setupTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('claudetop')
  tray.on('click', () => mainWindow?.show())
}

function setupIPC() {
  ipcMain.handle('list-processes', () => listProcesses())
  ipcMain.handle('kill-process', (_event, pid: number, signal?: string) => {
    killProcess(pid, (signal as 'SIGTERM' | 'SIGKILL') ?? 'SIGTERM')
  })
  ipcMain.handle('security-scan', (_event, pid?: number) => securityScan(pid))
}

function setupWatcher() {
  watchProcesses(2000, (processes) => {
    const runawayCount = processes.filter((p) => p.isRunaway).length
    tray?.setTitle(runawayCount > 0 ? `${runawayCount}` : '')
    mainWindow?.webContents.send('process-update', processes)
  })
}

app.whenReady().then(() => {
  createWindow()
  setupTray()
  setupIPC()
  setupWatcher()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

**Step 5: Write `packages/app/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>claudetop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Write `packages/app/src/main.tsx`**

```typescript
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
```

**Step 7: Write `packages/app/src/App.tsx`** (minimal shell — detail in Task 11)

```tsx
import React from 'react'

export function App() {
  return (
    <div style={{ fontFamily: 'monospace', padding: 20 }}>
      <h1>claudetop</h1>
      <p>Loading...</p>
    </div>
  )
}
```

**Step 8: Write `packages/app/electron-builder.yml`**

```yaml
appId: com.claudetop.app
productName: claudetop
directories:
  output: dist/release
files:
  - dist/**
  - package.json
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [x64, arm64]
linux:
  target:
    - target: AppImage
    - target: deb
  category: Development
```

**Step 9: Start the app in dev mode**

```bash
cd packages/app && pnpm dev
```

Expected: Electron window opens with "claudetop / Loading..."

**Step 10: Commit**

```bash
git add packages/app/
git commit -m "feat(app): scaffold Electron app with IPC and tray"
```

---

## Task 11: Electron App — React UI

**Files:**
- Create: `packages/app/src/components/ProcessList.tsx`
- Create: `packages/app/src/components/DetailPanel.tsx`
- Create: `packages/app/src/components/Sidebar.tsx`
- Create: `packages/app/src/hooks/useProcesses.ts`
- Create: `packages/app/src/styles.css`
- Modify: `packages/app/src/App.tsx`

**Step 1: Write `packages/app/src/hooks/useProcesses.ts`**

```typescript
import { useState, useEffect } from 'react'
import { ClaudeProcess } from '@claudetop/core'

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
    window.claudetop.listProcesses().then(setProcesses)
    const unsub = window.claudetop.onProcessUpdate(setProcesses)
    return unsub
  }, [])

  // Keep selected in sync with updated process data
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
```

**Step 2: Write `packages/app/src/styles.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0d0d0d;
  color: #e0e0e0;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  overflow: hidden;
}

.layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  height: 100vh;
}

.sidebar {
  background: #111;
  border-right: 1px solid #222;
  padding: 16px 0;
}

.sidebar-item {
  padding: 8px 16px;
  cursor: pointer;
  border-radius: 4px;
  margin: 2px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-item:hover { background: #1a1a1a; }
.sidebar-item.active { background: #1d2735; color: #4a9eff; }

.badge {
  background: #e53e3e;
  color: white;
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 11px;
}

.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.process-table {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

table { width: 100%; border-collapse: collapse; }
th { text-align: left; color: #666; padding: 6px 12px; border-bottom: 1px solid #222; }
td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; cursor: pointer; }
tr:hover td { background: #111; }
tr.runaway td { color: #fc8181; }
tr.selected td { background: #1d2735; }

.detail-panel {
  height: 300px;
  border-top: 1px solid #222;
  padding: 16px;
  overflow-y: auto;
  background: #0a0a0a;
}

.detail-row { display: flex; gap: 16px; margin: 4px 0; }
.detail-label { color: #666; width: 100px; flex-shrink: 0; }

.kill-btn {
  background: #742a2a;
  color: #feb2b2;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 8px;
}
.kill-btn:hover { background: #9b2c2c; }

.kill-btn.force { background: #1a0000; color: #fc8181; }
```

**Step 3: Write `packages/app/src/components/ProcessList.tsx`**

```tsx
import React from 'react'
import { ClaudeProcess } from '@claudetop/core'

function formatMemory(bytes: number) {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function formatRuntime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

interface Props {
  processes: ClaudeProcess[]
  selected: ClaudeProcess | null
  onSelect: (p: ClaudeProcess) => void
}

export function ProcessList({ processes, selected, onSelect }: Props) {
  return (
    <div className="process-table">
      <table>
        <thead>
          <tr>
            <th>PID</th><th>MEM</th><th>CPU</th><th>RUNTIME</th><th>STATUS</th><th>ARGS</th>
          </tr>
        </thead>
        <tbody>
          {processes.length === 0 ? (
            <tr><td colSpan={6} style={{ color: '#444', textAlign: 'center', padding: 24 }}>
              No Claude processes found
            </td></tr>
          ) : (
            processes.map((p) => (
              <tr
                key={p.pid}
                className={`${p.isRunaway ? 'runaway' : ''} ${selected?.pid === p.pid ? 'selected' : ''}`}
                onClick={() => onSelect(p)}
              >
                <td>{p.pid}</td>
                <td>{formatMemory(p.memory.rss)}</td>
                <td>{p.cpu.toFixed(1)}%</td>
                <td>{formatRuntime(p.runtime)}</td>
                <td>{p.isRunaway ? '⚠ RUNAWAY' : 'ok'}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.args.join(' ') || '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
```

**Step 4: Write `packages/app/src/components/DetailPanel.tsx`**

```tsx
import React, { useState } from 'react'
import { ClaudeProcess } from '@claudetop/core'

interface Props {
  process: ClaudeProcess | null
  onKill: (pid: number, force?: boolean) => void
}

export function DetailPanel({ process, onKill }: Props) {
  const [confirming, setConfirming] = useState<'soft' | 'force' | null>(null)

  if (!process) {
    return (
      <div className="detail-panel" style={{ color: '#444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Select a process to inspect
      </div>
    )
  }

  const formatMemory = (b: number) => b >= 1024**3 ? `${(b/1024**3).toFixed(1)} GB` : `${Math.round(b/1024**2)} MB`

  return (
    <div className="detail-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 'bold' }}>PID {process.pid}</span>
        <div>
          {confirming === 'soft' ? (
            <>
              <span style={{ color: '#f6ad55', marginRight: 8 }}>Kill with SIGTERM?</span>
              <button className="kill-btn" onClick={() => { onKill(process.pid); setConfirming(null) }}>Yes</button>
              <button className="kill-btn" onClick={() => setConfirming(null)}>No</button>
            </>
          ) : confirming === 'force' ? (
            <>
              <span style={{ color: '#fc8181', marginRight: 8 }}>Force kill with SIGKILL?</span>
              <button className="kill-btn force" onClick={() => { onKill(process.pid, true); setConfirming(null) }}>Yes</button>
              <button className="kill-btn" onClick={() => setConfirming(null)}>No</button>
            </>
          ) : (
            <>
              <button className="kill-btn" onClick={() => setConfirming('soft')}>Kill</button>
              <button className="kill-btn force" onClick={() => setConfirming('force')}>Force Kill</button>
            </>
          )}
        </div>
      </div>
      <div className="detail-row"><span className="detail-label">Memory</span><span>{formatMemory(process.memory.rss)} RSS</span></div>
      <div className="detail-row"><span className="detail-label">CPU</span><span>{process.cpu.toFixed(1)}%</span></div>
      <div className="detail-row"><span className="detail-label">Status</span><span>{process.status}</span></div>
      <div className="detail-row"><span className="detail-label">CWD</span><span style={{ color: '#a0aec0' }}>{process.cwd}</span></div>
      <div className="detail-row"><span className="detail-label">Args</span><span style={{ color: '#a0aec0' }}>{process.args.join(' ') || '(none)'}</span></div>
      <div className="detail-row"><span className="detail-label">PPID</span><span>{process.ppid}</span></div>
    </div>
  )
}
```

**Step 5: Write `packages/app/src/components/Sidebar.tsx`**

```tsx
import React from 'react'
import { ClaudeProcess } from '@claudetop/core'

interface Props {
  processes: ClaudeProcess[]
  activeFilter: 'all' | 'runaway'
  onFilterChange: (filter: 'all' | 'runaway') => void
}

export function Sidebar({ processes, activeFilter, onFilterChange }: Props) {
  const runawayCount = processes.filter((p) => p.isRunaway).length

  return (
    <div className="sidebar">
      <div style={{ padding: '8px 16px 16px', color: '#4a9eff', fontWeight: 'bold', fontSize: 15 }}>
        claudetop
      </div>
      <div
        className={`sidebar-item ${activeFilter === 'all' ? 'active' : ''}`}
        onClick={() => onFilterChange('all')}
      >
        <span>All</span>
        <span style={{ color: '#666' }}>{processes.length}</span>
      </div>
      <div
        className={`sidebar-item ${activeFilter === 'runaway' ? 'active' : ''}`}
        onClick={() => onFilterChange('runaway')}
      >
        <span>Runaway</span>
        {runawayCount > 0 && <span className="badge">{runawayCount}</span>}
      </div>
    </div>
  )
}
```

**Step 6: Update `packages/app/src/App.tsx`**

```tsx
import React, { useState } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { ProcessList } from './components/ProcessList'
import { DetailPanel } from './components/DetailPanel'
import { useProcesses } from './hooks/useProcesses'

export function App() {
  const { processes, selected, setSelected, killProcess } = useProcesses()
  const [filter, setFilter] = useState<'all' | 'runaway'>('all')

  const filtered = filter === 'runaway' ? processes.filter((p) => p.isRunaway) : processes

  return (
    <div className="layout">
      <Sidebar processes={processes} activeFilter={filter} onFilterChange={setFilter} />
      <div className="main">
        <ProcessList processes={filtered} selected={selected} onSelect={setSelected} />
        <DetailPanel process={selected} onKill={killProcess} />
      </div>
    </div>
  )
}
```

**Step 7: Run the app**

```bash
cd packages/app && pnpm dev
```

Expected: Electron window with sidebar (All / Runaway), process table, detail panel at bottom

**Step 8: Commit**

```bash
git add packages/app/src/
git commit -m "feat(app): implement process list, detail panel, and sidebar UI"
```

---

## Task 12: GitHub Actions — CI & Release

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm -r build
      - run: pnpm -r test
```

**Step 2: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm -r build

      - name: Build Electron app
        run: cd packages/app && pnpm package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: claudetop-${{ matrix.os }}
          path: packages/app/dist/release/**

  publish-npm:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm -r build
      - run: pnpm publish --filter @claudetop/core --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - run: pnpm publish --filter claudetop --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Step 3: Push and verify CI passes**

```bash
git add .github/
git commit -m "ci: add GitHub Actions CI and release workflows"
git push
```

Then visit `https://github.com/<you>/claudetop/actions` — CI job should pass.

---

## Done

At completion you will have:
- `@claudetop/core` — publishable npm library
- `claudetop` — CLI with `list`, `watch`, `kill`, `killall`, `inspect`, `scan`, `logs`
- Electron desktop app with sidebar, process table, detail panel, and system tray
- GitHub Actions CI (test on PR) and Release (build + publish on tag)

Run `claudetop` for the CLI or launch the app via `pnpm dev` in `packages/app`.

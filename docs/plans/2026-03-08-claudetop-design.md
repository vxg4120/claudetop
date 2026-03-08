# claudetop — Design Document
*Date: 2026-03-08*

## Overview

claudetop is a process manager and monitor for Claude CLI tasks — think `htop` meets Lens/Conduktor. It surfaces all running Claude processes with rich metadata (memory, CPU, runtime, args, log output) and lets you inspect, tail, and kill them. A security scan detects anomalous behavior.

**Platforms:** macOS + Linux
**Repo:** GitHub (open source)
**Model:** Download locally, optional auth/paid tier at app layer later

---

## Architecture

Monorepo with 3 packages (pnpm workspaces):

```
claudetop/
├── packages/
│   ├── core/     # @claudetop/core — npm publishable, pure Node.js
│   ├── cli/      # claudetop — npm publishable, thin CLI consumer
│   └── app/      # Electron desktop app
├── .github/
│   └── workflows/
│       ├── ci.yml       # lint + test on PR
│       └── release.yml  # build + sign + publish on tag
└── pnpm-workspace.yaml
```

Data flows one direction: `core` → `cli` or `core` → Electron main process → renderer via IPC.

Auth/paid tier hooks live at the `app` layer only. Core and CLI stay open source and free.

---

## Package 1: `@claudetop/core`

Pure Node.js library. No UI dependencies. Independently publishable to npm.

### Process Model

```ts
interface ClaudeProcess {
  pid: number
  ppid: number
  memory: { rss: number, vms: number }
  cpu: number           // % over sample interval
  runtime: number       // seconds since spawn
  status: 'running' | 'sleeping' | 'stopped' | 'zombie'
  cwd: string
  args: string[]        // argv after 'claude'
  isRunaway: boolean    // memory > threshold OR runtime > threshold
  logPath?: string      // detected log file if any
}
```

### API

```ts
listProcesses(): ClaudeProcess[]
watchProcesses(interval: number, callback: (processes: ClaudeProcess[]) => void): () => void
killProcess(pid: number, signal?: 'SIGTERM' | 'SIGKILL'): void
tailLog(pid: number): EventEmitter       // streams stdout/stderr via node-pty
securityScan(pid?: number): SecurityReport
checkPermissions(): PermissionReport
```

### Runaway Detection Thresholds (configurable via `~/.claudetop.json`)

- Memory RSS > 2GB
- Runtime > 2 hours
- CPU > 80% sustained for 60s

### Source Files

```
packages/core/src/
├── processes.ts      # list, watch, kill
├── logs.ts           # node-pty log tailing
├── scan.ts           # security scanning
└── permissions.ts    # permission checks
```

---

## Package 2: `claudetop` CLI

Thin consumer of `@claudetop/core`. Uses `commander` for argument parsing, `ink` (React for terminals) for live watch mode. Degrades gracefully to plain output in non-TTY environments (pipe-friendly).

### Commands

```bash
claudetop                        # default: list view
claudetop list                   # explicit list
claudetop watch                  # live-refreshing table
claudetop inspect <pid>          # detailed view
claudetop kill <pid>             # SIGTERM with confirmation
claudetop kill <pid> --force     # SIGKILL
claudetop killall                # kill all (confirmation required)
claudetop scan                   # security scan all
claudetop scan <pid>             # security scan one process
claudetop scan --sudo            # full scan with elevated access
claudetop logs <pid>             # live tail stdout/stderr
```

### List Output Format

```
PID    MEM      CPU   RUNTIME   STATUS    ARGS
12345  1.2 GB   45%   2h 13m    RUNAWAY   chat --resume abc123
12346  240 MB   2%    4m 02s    ok
12347  890 MB   12%   47m 15s   ok        --model opus
```

Runaway processes highlighted in red. JSON output available via `--json` flag for scripting.

---

## Package 3: Electron App

Lens/Conduktor-inspired desktop app. Main process uses `@claudetop/core` directly. Renderer is React. Packaged via `electron-builder`.

### Layout

```
┌─────────────────────────────────────────────────┐
│ sidebar     │  main panel                        │
│             │                                    │
│ All (3)     │  PID    MEM    CPU   RUNTIME        │
│ Runaway (1) │  12345  1.2GB  45%   2h13m  RUNAWAY │
│ Scan        │  12346  240MB  2%    4m02s  ok      │
│             │  12347  890MB  12%   47m15s ok      │
│             │                                    │
│             │  ── selected process ──            │
│             │  Memory graph (sparkline)          │
│             │  Args / CWD                        │
│             │  Network connections               │
│             │  Live log tail (node-pty terminal) │
└─────────────────────────────────────────────────┘
```

### UX Details

- Auto-refreshes every 2s (configurable)
- Runaway processes pulse red with sidebar badge count
- Click process → detail panel (single-view, no navigation)
- Kill button with inline confirmation (no modal dialogs)
- System tray icon — shows runaway badge count, click to raise window
- `claudetop` CLI can optionally launch the app if installed

### Packaging & Distribution

- macOS: `.dmg` + auto-update via `electron-updater` → GitHub Releases
- Linux: `.AppImage` + `.deb` → GitHub Releases
- GitHub Actions: build + sign + publish on version tag push

---

## Permissions

| Feature | macOS | Linux | Elevated? |
|---|---|---|---|
| List own processes | `sysinfo` | `/proc` | No |
| Memory/CPU/runtime | `sysinfo` | `/proc` | No |
| Working directory | `lsof` | `/proc/pid/cwd` | No (same user) |
| Network connections | `lsof -p` | `/proc/net/tcp` | Partial |
| Open file descriptors | `lsof -p` | `/proc/pid/fd` | No (same user) |
| Kill process | `kill` | `kill` | No (same user) |
| Log tail / attach | `node-pty` | `node-pty` | No (same user) |
| Other users' processes | — | — | Root required |

### Permission Flow

- First launch: `checkPermissions()` runs, surfaces what's limited
- Graceful degradation: restricted features show lock icon + explanation, never crash
- macOS entitlements: ships with required sandbox exceptions
- Sudo escalation: `claudetop scan --sudo` re-execs with sudo — explicit opt-in only, never automatic
- No SIP bypass: SIP-protected processes are explicitly out of scope

---

## Security Scan

Checks per-process or across all Claude processes:

### What It Checks

**Network connections**
- Expected: `api.anthropic.com:443`
- Flagged: unknown hosts, non-standard ports

**Open file descriptors**
- Expected: `~/.claude/*`, `/tmp/claude-*`
- Flagged: sensitive system files (`/etc/passwd`, `/etc/shadow`, etc.)

**Process behavior**
- Flagged: excessive child process spawning
- Flagged: long-running process with no stdin (zombie session)

### Scan Modes

- `claudetop scan` — fast, no elevated perms
- `claudetop scan --sudo` — full visibility
- In-app: continuous scan panel, badges sidebar on anomaly
- Scheduled: `claudetop scan --schedule` sets up `launchd` (macOS) / `systemd` timer (Linux)

### Output

JSON (`--json`) or human-readable table. Designed to pipe into other tools or log to file.

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Core | Node.js + TypeScript, `systeminformation`, `node-pty` |
| CLI | `commander`, `ink` (React for terminals) |
| App | Electron, React, `electron-builder`, `electron-updater` |
| Monorepo | pnpm workspaces |
| CI/CD | GitHub Actions |
| Distribution | GitHub Releases (binaries), npm (CLI + core) |

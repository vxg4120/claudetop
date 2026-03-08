# claudetop v2: Agent Productivity Monitor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session analytics, cost tracking, LLM-powered insights, and an agent standup to claudetop — turning it from a process monitor into an agent productivity dashboard.

**Architecture:** Four new modules in `@claudetop/core` (sessions, analytics, insights, standup) backed by a local SQLite DB at `~/.claudetop/sessions.db`. CLI gets 4 new commands (sessions, report, standup, prune). The Electron app gets 3 new panels (Sessions, Analytics, Standup) added to the existing sidebar navigation.

**Tech Stack:** better-sqlite3 (local DB, sync), chokidar@3 (JSONL file watcher, CJS compat), @anthropic-ai/sdk (LLM insights), recharts (Electron charts), vitest (tests)

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/app/package.json`

**Step 1: Add packages to core**

```bash
cd packages/core
pnpm add better-sqlite3 chokidar@3 @anthropic-ai/sdk
pnpm add -D @types/better-sqlite3
```

**Step 2: Add recharts to app**

```bash
cd packages/app
pnpm add recharts
```

**Step 3: Verify install**

```bash
cd /path/to/claudetop && pnpm install
```

Expected: No errors, lockfile updated.

**Step 4: Commit**

```bash
git add packages/core/package.json packages/app/package.json pnpm-lock.yaml
git commit -m "feat: add v2 dependencies (better-sqlite3, chokidar, @anthropic-ai/sdk, recharts)"
```

---

### Task 2: Add session types to types.ts

**Files:**
- Modify: `packages/core/src/types.ts`

**Step 1: Append new interfaces to types.ts**

Add after the existing `DEFAULT_THRESHOLDS` export:

```typescript
export interface TokenUsage {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
}

export interface ClaudeSession {
  sessionId: string
  projectSlug: string       // URL-decoded directory name
  cwd: string
  gitBranch: string | null
  model: string | null
  startedAt: Date | null
  endedAt: Date | null
  durationSeconds: number | null
  usage: TokenUsage
  estimatedCostUsd: number
  isSidechain: boolean
  parentSessionId: string | null
  summary: string | null    // LLM-generated, null until requested
  permissionMode: string | null
}

export interface SessionFilter {
  project?: string
  since?: Date
  until?: Date
  model?: string
  limit?: number
}

export interface CostReport {
  totalUsd: number
  byProject: Array<{ project: string; usd: number; sessions: number }>
  byModel: Array<{ model: string; usd: number; sessions: number }>
  byDay: Array<{ date: string; usd: number; sessions: number }>
  period: { from: Date; to: Date }
}

export interface StandupReport {
  generatedAt: Date
  done: Array<{ project: string; summary: string; sessions: number; costUsd: number }>
  inProgress: Array<{ sessionId: string; project: string; model: string | null; runtimeMinutes: number; branch: string | null }>
  blockers: Array<{ sessionId: string; project: string; description: string }>
  llmUsage: LlmUsageRecord
}

export interface LlmUsageRecord {
  id?: number
  timestamp: Date
  feature: 'standup' | 'summarize' | 'insights'
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  sessionId: string | null
}
```

**Step 2: Build core to verify no type errors**

```bash
cd packages/core && pnpm build 2>&1 | tail -5
```

Expected: Builds cleanly.

**Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add session, analytics, and standup types"
```

---

### Task 3: JSONL parser + cost calculator (sessions.ts)

**Files:**
- Create: `packages/core/src/sessions.ts`
- Create: `packages/core/src/__tests__/sessions.test.ts`

**Step 1: Write failing test**

```typescript
// packages/core/src/__tests__/sessions.test.ts
import { describe, it, expect } from 'vitest'
import { calculateCost, MODEL_PRICING } from '../sessions'

describe('calculateCost', () => {
  it('calculates opus input cost correctly', () => {
    const cost = calculateCost('claude-opus-4-6', {
      input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    })
    expect(cost).toBeCloseTo(15.0)
  })

  it('calculates sonnet output cost correctly', () => {
    const cost = calculateCost('claude-sonnet-4-6', {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(15.0)
  })

  it('returns 0 for unknown model', () => {
    const cost = calculateCost('unknown-model', {
      input_tokens: 1000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 100,
    })
    expect(cost).toBe(0)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- --reporter=verbose 2>&1 | head -20
```

Expected: FAIL with "Cannot find module '../sessions'"

**Step 3: Implement sessions.ts**

```typescript
// packages/core/src/sessions.ts
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ClaudeSession, TokenUsage } from './types'

export const MODEL_PRICING: Record<string, {
  input: number; cacheWrite: number; cacheRead: number; output: number
}> = {
  'claude-opus-4-6':   { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },
  'claude-opus-4-5':   { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },
  'claude-sonnet-4-6': { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
  'claude-sonnet-4-5': { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
  'claude-haiku-3-5':  { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  const M = 1_000_000
  return (
    usage.input_tokens * pricing.input +
    usage.cache_creation_input_tokens * pricing.cacheWrite +
    usage.cache_read_input_tokens * pricing.cacheRead +
    usage.output_tokens * pricing.output
  ) / M
}

interface JsonlRecord {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  isSidechain?: boolean
  parentUuid?: string
  cwd?: string
  gitBranch?: string
  permissionMode?: string
  message?: {
    role?: string
    model?: string
    usage?: {
      input_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      output_tokens?: number
    }
  }
}

export function parseSessionFile(filePath: string): ClaudeSession | null {
  let lines: string[]
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return null
  }

  const sessionId = path.basename(filePath, '.jsonl')
  const projectDir = path.basename(path.dirname(filePath))
  const projectSlug = decodeURIComponent(projectDir).replace(/^\//, '').replace(/\//g, '-')

  const usage: TokenUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  }

  let model: string | null = null
  let cwd = ''
  let gitBranch: string | null = null
  let startedAt: Date | null = null
  let endedAt: Date | null = null
  let isSidechain = false
  let parentSessionId: string | null = null
  let permissionMode: string | null = null
  let sessionIdFromRecord: string | null = null

  for (const line of lines) {
    let record: JsonlRecord
    try { record = JSON.parse(line) } catch { continue }

    if (record.sessionId && !sessionIdFromRecord) sessionIdFromRecord = record.sessionId
    if (record.cwd && !cwd) cwd = record.cwd
    if (record.gitBranch && !gitBranch) gitBranch = record.gitBranch
    if (record.permissionMode && !permissionMode) permissionMode = record.permissionMode
    if (record.isSidechain) isSidechain = true
    if (record.parentUuid && !parentSessionId) parentSessionId = record.parentUuid

    if (record.timestamp) {
      const ts = new Date(record.timestamp)
      if (!isNaN(ts.getTime())) {
        if (!startedAt || ts < startedAt) startedAt = ts
        if (!endedAt || ts > endedAt) endedAt = ts
      }
    }

    if (record.message?.model) model = record.message.model
    if (record.message?.usage) {
      const u = record.message.usage
      usage.input_tokens += u.input_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
    }
  }

  const durationSeconds =
    startedAt && endedAt
      ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
      : null

  return {
    sessionId: sessionIdFromRecord ?? sessionId,
    projectSlug,
    cwd: cwd || projectSlug.replace(/-/g, '/'),
    gitBranch,
    model,
    startedAt,
    endedAt,
    durationSeconds,
    usage,
    estimatedCostUsd: model ? calculateCost(model, usage) : 0,
    isSidechain,
    parentSessionId,
    summary: null,
    permissionMode,
  }
}

export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

export function listSessionFiles(claudeDir = getClaudeProjectsDir()): string[] {
  if (!fs.existsSync(claudeDir)) return []
  const files: string[] = []
  for (const projectDir of fs.readdirSync(claudeDir)) {
    const projectPath = path.join(claudeDir, projectDir)
    try {
      if (!fs.statSync(projectPath).isDirectory()) continue
    } catch { continue }
    for (const file of fs.readdirSync(projectPath)) {
      if (file.endsWith('.jsonl')) files.push(path.join(projectPath, file))
    }
  }
  return files
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter=verbose
```

Expected: All calculateCost tests PASS.

**Step 5: Commit**

```bash
git add packages/core/src/sessions.ts packages/core/src/__tests__/sessions.test.ts
git commit -m "feat(core): add JSONL parser and cost calculator"
```

---

### Task 4: SQLite schema (db.ts)

**Files:**
- Create: `packages/core/src/db.ts`
- Create: `packages/core/src/__tests__/db.test.ts`

**Step 1: Write failing test**

```typescript
// packages/core/src/__tests__/db.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { openDb, closeDb } from '../db'

const testDbPath = path.join(os.tmpdir(), `claudetop-test-${Date.now()}.db`)

afterEach(() => { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath) })

describe('openDb', () => {
  it('creates the db file and both tables', () => {
    const db = openDb(testDbPath)
    expect(fs.existsSync(testDbPath)).toBe(true)
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('sessions')
    expect(names).toContain('llm_usage')
    closeDb(db)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- --reporter=verbose 2>&1 | grep -A3 "openDb"
```

Expected: FAIL "Cannot find module '../db'"

**Step 3: Implement db.ts**

```typescript
// packages/core/src/db.ts
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type Db = Database.Database

export function getDefaultDbPath(): string {
  const dir = path.join(os.homedir(), '.claudetop')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'sessions.db')
}

export function openDb(dbPath = getDefaultDbPath()): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createSchema(db)
  return db
}

export function closeDb(db: Db): void {
  db.close()
}

function createSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id            TEXT PRIMARY KEY,
      project_slug          TEXT NOT NULL,
      cwd                   TEXT NOT NULL DEFAULT '',
      git_branch            TEXT,
      model                 TEXT,
      started_at            TEXT,
      ended_at              TEXT,
      duration_seconds      INTEGER,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd    REAL NOT NULL DEFAULT 0,
      is_sidechain          INTEGER NOT NULL DEFAULT 0,
      parent_session_id     TEXT,
      summary               TEXT,
      permission_mode       TEXT,
      indexed_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project    ON sessions(project_slug);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp           TEXT NOT NULL DEFAULT (datetime('now')),
      feature             TEXT NOT NULL,
      input_tokens        INTEGER NOT NULL DEFAULT 0,
      output_tokens       INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd  REAL NOT NULL DEFAULT 0,
      session_id          TEXT
    );
  `)
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter=verbose
```

Expected: db tests PASS, all previous tests still PASS.

**Step 5: Commit**

```bash
git add packages/core/src/db.ts packages/core/src/__tests__/db.test.ts
git commit -m "feat(core): add SQLite schema and db module"
```

---

### Task 5: Indexer + file watcher (indexer.ts)

**Files:**
- Create: `packages/core/src/indexer.ts`
- Create: `packages/core/src/__tests__/indexer.test.ts`

**Step 1: Write failing test**

```typescript
// packages/core/src/__tests__/indexer.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildIndex, upsertSession } from '../indexer'
import { openDb, closeDb } from '../db'

const testDbPath = path.join(os.tmpdir(), `claudetop-idx-${Date.now()}.db`)
const testClaudeDir = path.join(os.tmpdir(), `claude-test-${Date.now()}`)

function makeSessionFile(dir: string, sessionId: string, lines: object[]): string {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'))
  return filePath
}

afterEach(() => {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
  if (fs.existsSync(testClaudeDir)) fs.rmSync(testClaudeDir, { recursive: true })
})

describe('upsertSession', () => {
  it('inserts a parsed session into the db', () => {
    const db = openDb(testDbPath)
    const projectDir = path.join(testClaudeDir, '-Users-test-myproject')
    const filePath = makeSessionFile(projectDir, 'abc-123', [
      { type: 'user', sessionId: 'abc-123', timestamp: '2026-01-01T10:00:00Z', cwd: '/Users/test/myproject' },
      { type: 'assistant', sessionId: 'abc-123', timestamp: '2026-01-01T10:01:00Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 } } },
    ])
    upsertSession(db, filePath)
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get('abc-123') as Record<string, unknown>
    expect(row).toBeDefined()
    expect(row.model).toBe('claude-sonnet-4-6')
    expect(row.input_tokens).toBe(100)
    closeDb(db)
  })
})

describe('buildIndex', () => {
  it('indexes all JSONL files in a claude projects directory', () => {
    const db = openDb(testDbPath)
    const projectDir = path.join(testClaudeDir, '-Users-test-proj')
    makeSessionFile(projectDir, 'sess-1', [
      { type: 'user', sessionId: 'sess-1', timestamp: '2026-01-01T10:00:00Z', cwd: '/Users/test/proj' },
    ])
    makeSessionFile(projectDir, 'sess-2', [
      { type: 'user', sessionId: 'sess-2', timestamp: '2026-01-02T10:00:00Z', cwd: '/Users/test/proj' },
    ])
    const count = buildIndex(db, testClaudeDir)
    expect(count).toBe(2)
    closeDb(db)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- --reporter=verbose 2>&1 | grep -A3 "upsertSession"
```

Expected: FAIL "Cannot find module '../indexer'"

**Step 3: Implement indexer.ts**

```typescript
// packages/core/src/indexer.ts
import * as path from 'path'
import { Db } from './db'
import { parseSessionFile, getClaudeProjectsDir, listSessionFiles } from './sessions'
import { ClaudeSession } from './types'

function sessionToRow(s: ClaudeSession): Record<string, unknown> {
  return {
    session_id:             s.sessionId,
    project_slug:           s.projectSlug,
    cwd:                    s.cwd,
    git_branch:             s.gitBranch ?? null,
    model:                  s.model ?? null,
    started_at:             s.startedAt?.toISOString() ?? null,
    ended_at:               s.endedAt?.toISOString() ?? null,
    duration_seconds:       s.durationSeconds ?? null,
    input_tokens:           s.usage.input_tokens,
    cache_creation_tokens:  s.usage.cache_creation_input_tokens,
    cache_read_tokens:      s.usage.cache_read_input_tokens,
    output_tokens:          s.usage.output_tokens,
    estimated_cost_usd:     s.estimatedCostUsd,
    is_sidechain:           s.isSidechain ? 1 : 0,
    parent_session_id:      s.parentSessionId ?? null,
    permission_mode:        s.permissionMode ?? null,
  }
}

const UPSERT_SQL = `
  INSERT OR REPLACE INTO sessions (
    session_id, project_slug, cwd, git_branch, model,
    started_at, ended_at, duration_seconds,
    input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
    estimated_cost_usd, is_sidechain, parent_session_id, permission_mode,
    summary, indexed_at
  ) VALUES (
    @session_id, @project_slug, @cwd, @git_branch, @model,
    @started_at, @ended_at, @duration_seconds,
    @input_tokens, @cache_creation_tokens, @cache_read_tokens, @output_tokens,
    @estimated_cost_usd, @is_sidechain, @parent_session_id, @permission_mode,
    (SELECT summary FROM sessions WHERE session_id = @session_id),
    datetime('now')
  )
`

export function upsertSession(db: Db, filePath: string): boolean {
  const session = parseSessionFile(filePath)
  if (!session) return false
  db.prepare(UPSERT_SQL).run(sessionToRow(session))
  return true
}

export function buildIndex(db: Db, claudeDir = getClaudeProjectsDir()): number {
  const files = listSessionFiles(claudeDir)
  const insert = db.transaction((paths: string[]) => {
    let count = 0
    for (const p of paths) { if (upsertSession(db, p)) count++ }
    return count
  })
  return insert(files)
}

export function startWatcher(db: Db, claudeDir = getClaudeProjectsDir()): () => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chokidar = require('chokidar')
  const watcher = chokidar.watch(`${claudeDir}/**/*.jsonl`, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  })
  watcher.on('add', (f: string) => upsertSession(db, f))
  watcher.on('change', (f: string) => upsertSession(db, f))
  return () => watcher.close()
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter=verbose
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/core/src/indexer.ts packages/core/src/__tests__/indexer.test.ts
git commit -m "feat(core): add JSONL indexer and chokidar file watcher"
```

---

### Task 6: Analytics queries (analytics.ts)

**Files:**
- Create: `packages/core/src/analytics.ts`
- Create: `packages/core/src/__tests__/analytics.test.ts`

**Step 1: Write failing test**

```typescript
// packages/core/src/__tests__/analytics.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { openDb, closeDb, Db } from '../db'
import { querySessions, getCostReport } from '../analytics'

const testDbPath = path.join(os.tmpdir(), `claudetop-analytics-${Date.now()}.db`)

function insertSession(db: Db, overrides: Record<string, unknown> = {}) {
  const row = {
    session_id: `sess-${Math.random()}`,
    project_slug: 'myproject',
    cwd: '/Users/test/myproject',
    model: 'claude-sonnet-4-6',
    started_at: '2026-01-01T10:00:00Z',
    ended_at: '2026-01-01T10:30:00Z',
    duration_seconds: 1800,
    input_tokens: 1000,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    output_tokens: 500,
    estimated_cost_usd: 0.01,
    is_sidechain: 0,
    ...overrides,
  }
  db.prepare(`
    INSERT OR REPLACE INTO sessions
      (session_id, project_slug, cwd, model, started_at, ended_at, duration_seconds,
       input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, estimated_cost_usd, is_sidechain)
    VALUES
      (@session_id, @project_slug, @cwd, @model, @started_at, @ended_at, @duration_seconds,
       @input_tokens, @cache_creation_tokens, @cache_read_tokens, @output_tokens, @estimated_cost_usd, @is_sidechain)
  `).run(row)
}

let db: Db
beforeEach(() => { db = openDb(testDbPath) })
afterEach(() => { closeDb(db); fs.unlinkSync(testDbPath) })

describe('querySessions', () => {
  it('filters by project', () => {
    insertSession(db, { session_id: 'a', project_slug: 'cann' })
    insertSession(db, { session_id: 'b', project_slug: 'other' })
    const results = querySessions(db, { project: 'cann' })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('a')
  })
})

describe('getCostReport', () => {
  it('aggregates cost by project', () => {
    insertSession(db, { session_id: 'x', project_slug: 'proj-a', estimated_cost_usd: 0.05, started_at: new Date().toISOString() })
    insertSession(db, { session_id: 'y', project_slug: 'proj-a', estimated_cost_usd: 0.10, started_at: new Date().toISOString() })
    insertSession(db, { session_id: 'z', project_slug: 'proj-b', estimated_cost_usd: 0.03, started_at: new Date().toISOString() })
    const report = getCostReport(db, {})
    expect(report.totalUsd).toBeCloseTo(0.18)
    const projA = report.byProject.find((p) => p.project === 'proj-a')
    expect(projA?.usd).toBeCloseTo(0.15)
    expect(projA?.sessions).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- --reporter=verbose 2>&1 | grep -A3 "querySessions"
```

Expected: FAIL "Cannot find module '../analytics'"

**Step 3: Implement analytics.ts**

```typescript
// packages/core/src/analytics.ts
import { Db } from './db'
import { ClaudeSession, SessionFilter, CostReport } from './types'

function rowToSession(row: Record<string, unknown>): ClaudeSession {
  return {
    sessionId:       row.session_id as string,
    projectSlug:     row.project_slug as string,
    cwd:             row.cwd as string,
    gitBranch:       row.git_branch as string | null,
    model:           row.model as string | null,
    startedAt:       row.started_at ? new Date(row.started_at as string) : null,
    endedAt:         row.ended_at ? new Date(row.ended_at as string) : null,
    durationSeconds: row.duration_seconds as number | null,
    usage: {
      input_tokens:                row.input_tokens as number,
      cache_creation_input_tokens: row.cache_creation_tokens as number,
      cache_read_input_tokens:     row.cache_read_tokens as number,
      output_tokens:               row.output_tokens as number,
    },
    estimatedCostUsd: row.estimated_cost_usd as number,
    isSidechain:      (row.is_sidechain as number) === 1,
    parentSessionId:  row.parent_session_id as string | null,
    summary:          row.summary as string | null,
    permissionMode:   row.permission_mode as string | null,
  }
}

export function querySessions(db: Db, filter: SessionFilter): ClaudeSession[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter.project) {
    conditions.push('project_slug LIKE @project')
    params.project = `%${filter.project}%`
  }
  if (filter.since) {
    conditions.push('started_at >= @since')
    params.since = filter.since.toISOString()
  }
  if (filter.until) {
    conditions.push('started_at <= @until')
    params.until = filter.until.toISOString()
  }
  if (filter.model) {
    conditions.push('model = @model')
    params.model = filter.model
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter.limit ? `LIMIT ${filter.limit}` : ''
  const sql = `SELECT * FROM sessions ${where} ORDER BY started_at DESC ${limit}`
  const rows = db.prepare(sql).all(params) as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function getCostReport(db: Db, filter: SessionFilter): CostReport {
  const since = filter.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const until = filter.until ?? new Date()
  const conditions = ['started_at >= @since', 'started_at <= @until']
  const params: Record<string, unknown> = {
    since: since.toISOString(),
    until: until.toISOString(),
  }
  if (filter.project) {
    conditions.push('project_slug LIKE @project')
    params.project = `%${filter.project}%`
  }
  const where = `WHERE ${conditions.join(' AND ')}`

  const total = db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM sessions ${where}`
  ).get(params) as { total: number }

  const byProject = db.prepare(`
    SELECT project_slug as project, SUM(estimated_cost_usd) as usd, COUNT(*) as sessions
    FROM sessions ${where} GROUP BY project_slug ORDER BY usd DESC
  `).all(params) as Array<{ project: string; usd: number; sessions: number }>

  const byModel = db.prepare(`
    SELECT model, SUM(estimated_cost_usd) as usd, COUNT(*) as sessions
    FROM sessions ${where} GROUP BY model ORDER BY usd DESC
  `).all(params) as Array<{ model: string; usd: number; sessions: number }>

  const byDay = db.prepare(`
    SELECT date(started_at) as date, SUM(estimated_cost_usd) as usd, COUNT(*) as sessions
    FROM sessions ${where} GROUP BY date(started_at) ORDER BY date ASC
  `).all(params) as Array<{ date: string; usd: number; sessions: number }>

  return { totalUsd: total.total, byProject, byModel, byDay, period: { from: since, to: until } }
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter=verbose
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/core/src/analytics.ts packages/core/src/__tests__/analytics.test.ts
git commit -m "feat(core): add analytics query module"
```

---

### Task 7: LLM insights client (insights.ts)

**Files:**
- Create: `packages/core/src/insights.ts`
- Create: `packages/core/src/__tests__/insights.test.ts`

**Step 1: Write failing test**

```typescript
// packages/core/src/__tests__/insights.test.ts
import { describe, it, expect } from 'vitest'
import { estimateInsightCost, readClaudeApiKey } from '../insights'

describe('estimateInsightCost', () => {
  it('returns a positive cost estimate for non-zero tokens', () => {
    const est = estimateInsightCost(1000, 'claude-sonnet-4-6')
    expect(est).toBeGreaterThan(0)
    expect(est).toBeLessThan(0.01)
  })
})

describe('readClaudeApiKey', () => {
  it('returns null if the claude dir does not exist', () => {
    const key = readClaudeApiKey('/tmp/nonexistent-claude-dir-xyz')
    expect(key).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- --reporter=verbose 2>&1 | grep -A3 "estimateInsightCost"
```

Expected: FAIL "Cannot find module '../insights'"

**Step 3: Implement insights.ts**

```typescript
// packages/core/src/insights.ts
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Anthropic from '@anthropic-ai/sdk'
import { Db } from './db'
import { LlmUsageRecord } from './types'
import { calculateCost } from './sessions'

const INSIGHTS_MODEL = 'claude-sonnet-4-6'

export function readClaudeApiKey(claudeDir = path.join(os.homedir(), '.claude')): string | null {
  // Try credentials.json (Claude Code stores key here)
  const credPath = path.join(claudeDir, 'credentials.json')
  if (fs.existsSync(credPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
      if (creds.claudeApiKey) return creds.claudeApiKey
      if (creds.api_key) return creds.api_key
    } catch { /* ignore */ }
  }
  // Try config.json
  const configPath = path.join(claudeDir, 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.claudeApiKey) return config.claudeApiKey
    } catch { /* ignore */ }
  }
  // Fall back to env var (same as Claude Code uses)
  return process.env.ANTHROPIC_API_KEY ?? null
}

export function estimateInsightCost(estimatedInputTokens: number, model = INSIGHTS_MODEL): number {
  return calculateCost(model, {
    input_tokens: estimatedInputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: Math.round(estimatedInputTokens * 0.3),
  })
}

export interface InsightResult {
  text: string
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
}

export async function callInsightsApi(
  prompt: string,
  systemPrompt: string,
  apiKey: string
): Promise<InsightResult> {
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: INSIGHTS_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
  const costUsd = calculateCost(INSIGHTS_MODEL, {
    input_tokens: response.usage.input_tokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: response.usage.output_tokens,
  })
  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd,
    },
  }
}

export function logLlmUsage(db: Db, record: Omit<LlmUsageRecord, 'id' | 'timestamp'>): void {
  db.prepare(`
    INSERT INTO llm_usage (feature, input_tokens, output_tokens, estimated_cost_usd, session_id)
    VALUES (@feature, @inputTokens, @outputTokens, @estimatedCostUsd, @sessionId)
  `).run({
    feature: record.feature,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostUsd: record.estimatedCostUsd,
    sessionId: record.sessionId ?? null,
  })
}

export function getLlmUsageSummary(db: Db): { totalCostUsd: number; totalCalls: number } {
  const row = db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total, COUNT(*) as cnt FROM llm_usage`
  ).get() as { total: number; cnt: number }
  return { totalCostUsd: row.total, totalCalls: row.cnt }
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter=verbose
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/core/src/insights.ts packages/core/src/__tests__/insights.test.ts
git commit -m "feat(core): add LLM insights client with API key reader"
```

---

### Task 8: Standup generator + update core exports

**Files:**
- Create: `packages/core/src/standup.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Implement standup.ts**

```typescript
// packages/core/src/standup.ts
import { Db } from './db'
import { querySessions } from './analytics'
import { callInsightsApi, logLlmUsage, readClaudeApiKey } from './insights'
import { StandupReport, ClaudeSession } from './types'

const SYSTEM_PROMPT = `You are a technical assistant summarizing Claude Code agent activity for a developer standup.
Be concise. Focus on outcomes. Use past tense for completed work.
Output ONLY valid JSON — no markdown, no code fences, no explanation.`

function buildStandupPrompt(completed: ClaudeSession[]): string {
  const byProject: Record<string, ClaudeSession[]> = {}
  for (const s of completed) {
    if (!byProject[s.projectSlug]) byProject[s.projectSlug] = []
    byProject[s.projectSlug].push(s)
  }

  const lines = Object.entries(byProject).map(([proj, sessions]) => {
    const totalTokens = sessions.reduce((sum, s) => sum + s.usage.input_tokens + s.usage.output_tokens, 0)
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0)
    const branches = [...new Set(sessions.map((s) => s.gitBranch).filter(Boolean))].join(', ') || 'unknown'
    return `Project: ${proj}\nSessions: ${sessions.length}\nTokens: ${totalTokens}\nCost: $${totalCost.toFixed(4)}\nBranches: ${branches}`
  })

  return `Summarize this Claude Code activity as a standup.

COMPLETED SESSIONS (last 24h):
${lines.join('\n\n') || 'None'}

Return JSON with this exact shape:
{"done": [{"project": "string", "summary": "string", "sessions": 1, "costUsd": 0.01}], "blockers": []}`
}

export async function generateStandup(db: Db): Promise<StandupReport> {
  const apiKey = readClaudeApiKey()
  if (!apiKey) throw new Error('No Claude API key found. Set ANTHROPIC_API_KEY or configure Claude Code.')

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const completed = querySessions(db, { since, limit: 100 })

  const result = await callInsightsApi(buildStandupPrompt(completed), SYSTEM_PROMPT, apiKey)

  logLlmUsage(db, {
    feature: 'standup',
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.costUsd,
    sessionId: null,
  })

  let parsed: { done: unknown[]; blockers: unknown[] } = { done: [], blockers: [] }
  try { parsed = JSON.parse(result.text) } catch { /* use empty */ }

  return {
    generatedAt: new Date(),
    done: (parsed.done ?? []) as StandupReport['done'],
    inProgress: [],
    blockers: (parsed.blockers ?? []) as StandupReport['blockers'],
    llmUsage: {
      timestamp: new Date(),
      feature: 'standup',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.costUsd,
      sessionId: null,
    },
  }
}
```

**Step 2: Update packages/core/src/index.ts**

Replace the entire file:

```typescript
export * from './types'
export * from './permissions'
export * from './processes'
export * from './watch'
export * from './logs'
export * from './scan'
export * from './sessions'
export * from './db'
export * from './indexer'
export * from './analytics'
export * from './insights'
export * from './standup'
```

**Step 3: Build and test**

```bash
cd packages/core && pnpm build && pnpm test
```

Expected: Build succeeds, all tests PASS.

**Step 4: Commit**

```bash
git add packages/core/src/standup.ts packages/core/src/index.ts
git commit -m "feat(core): add standup generator and update exports"
```

---

### Task 9: CLI — sessions and report commands

**Files:**
- Create: `packages/cli/src/commands/sessions.ts`
- Create: `packages/cli/src/commands/report.ts`

**Step 1: Implement sessions.ts**

```typescript
// packages/cli/src/commands/sessions.ts
import { openDb, closeDb, buildIndex, querySessions } from '@claudetop/core'
import chalk from 'chalk'
import { formatRuntime } from '../utils/format'

interface SessionsOptions {
  project?: string
  since?: string
  json?: boolean
  limit?: string
}

function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(d|w|m)$/)
  if (!match) return new Date(since)
  const [, n, unit] = match
  const ms = parseInt(n) * ({ d: 86400000, w: 604800000, m: 2592000000 } as Record<string, number>)[unit]
  return new Date(Date.now() - ms)
}

export async function sessionsCommand(sessionId: string | undefined, options: SessionsOptions) {
  const db = openDb()
  buildIndex(db)

  if (sessionId) {
    const all = querySessions(db, { limit: 10000 })
    const session = all.find((s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId))
    closeDb(db)
    if (!session) { console.error(chalk.red(`Session not found: ${sessionId}`)); process.exit(1) }
    if (options.json) { console.log(JSON.stringify(session, null, 2)); return }
    console.log(chalk.bold('\nSession Detail'))
    console.log(`  ID:       ${session.sessionId}`)
    console.log(`  Project:  ${session.projectSlug}`)
    console.log(`  CWD:      ${session.cwd}`)
    console.log(`  Branch:   ${session.gitBranch ?? '—'}`)
    console.log(`  Model:    ${session.model ?? '—'}`)
    console.log(`  Started:  ${session.startedAt?.toLocaleString() ?? '—'}`)
    console.log(`  Duration: ${session.durationSeconds ? formatRuntime(session.durationSeconds) : '—'}`)
    console.log(`  Tokens:   in=${session.usage.input_tokens.toLocaleString()} out=${session.usage.output_tokens.toLocaleString()}`)
    console.log(`  Cost:     ${chalk.green('$' + session.estimatedCostUsd.toFixed(4))}`)
    return
  }

  const limit = options.limit ? parseInt(options.limit) : 20
  const since = options.since ? parseSince(options.since) : undefined
  const sessions = querySessions(db, { project: options.project, since, limit })
  closeDb(db)

  if (options.json) { console.log(JSON.stringify(sessions, null, 2)); return }
  if (!sessions.length) { console.log(chalk.gray('No sessions found.')); return }

  console.log(chalk.gray(`\n  ${'ID'.padEnd(10)} ${'PROJECT'.padEnd(22)} ${'MODEL'.padEnd(22)} ${'DUR'.padEnd(8)} ${'COST'.padEnd(9)} STARTED`))
  for (const s of sessions) {
    const id = s.sessionId.slice(0, 8)
    const proj = s.projectSlug.slice(0, 20).padEnd(22)
    const model = (s.model ?? '—').slice(0, 20).padEnd(22)
    const dur = (s.durationSeconds ? formatRuntime(s.durationSeconds) : '—').padEnd(8)
    const cost = ('$' + s.estimatedCostUsd.toFixed(4)).padEnd(9)
    const started = s.startedAt ? s.startedAt.toLocaleDateString() : '—'
    console.log(`  ${chalk.cyan(id.padEnd(10))} ${proj} ${chalk.yellow(model)} ${dur} ${chalk.green(cost)} ${chalk.gray(started)}`)
  }
}
```

**Step 2: Implement report.ts**

```typescript
// packages/cli/src/commands/report.ts
import { openDb, closeDb, buildIndex, getCostReport } from '@claudetop/core'
import chalk from 'chalk'

interface ReportOptions { period?: string; project?: string; json?: boolean }

export async function reportCommand(options: ReportOptions) {
  const db = openDb()
  buildIndex(db)

  const periodMs: Record<string, number> = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 }
  const ms = periodMs[options.period ?? 'week'] ?? periodMs.week
  const since = new Date(Date.now() - ms)
  const report = getCostReport(db, { since, project: options.project })
  closeDb(db)

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return }

  const totalSessions = report.byProject.reduce((s, p) => s + p.sessions, 0)
  console.log(chalk.bold(`\n  Cost Report — last ${options.period ?? 'week'}`))
  console.log(`  Total: ${chalk.green('$' + report.totalUsd.toFixed(4))} · ${totalSessions} sessions\n`)

  if (report.byProject.length) {
    console.log(chalk.gray('  By Project:'))
    for (const p of report.byProject) {
      console.log(`    ${p.project.padEnd(28)} ${chalk.green(('$' + p.usd.toFixed(4)).padEnd(12))} ${p.sessions} sessions`)
    }
  }
  if (report.byModel.length) {
    console.log(chalk.gray('\n  By Model:'))
    for (const m of report.byModel) {
      console.log(`    ${(m.model ?? '—').padEnd(28)} ${chalk.yellow(('$' + m.usd.toFixed(4)).padEnd(12))} ${m.sessions} sessions`)
    }
  }
}
```

**Step 3: Build**

```bash
cd packages/cli && pnpm build 2>&1 | tail -5
```

Expected: No TypeScript errors.

**Step 4: Commit**

```bash
git add packages/cli/src/commands/sessions.ts packages/cli/src/commands/report.ts
git commit -m "feat(cli): add sessions and report commands"
```

---

### Task 10: CLI — standup + prune commands + register all in index.ts

**Files:**
- Create: `packages/cli/src/commands/standup.ts`
- Create: `packages/cli/src/commands/prune.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Implement standup.ts**

```typescript
// packages/cli/src/commands/standup.ts
import { openDb, closeDb, buildIndex, generateStandup, estimateInsightCost, getLlmUsageSummary } from '@claudetop/core'
import chalk from 'chalk'
import * as readline from 'readline'

interface StandupOptions { yes?: boolean; json?: boolean }

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => { rl.close(); resolve(a.toLowerCase().startsWith('y')) })
  })
}

export async function standupCommand(options: StandupOptions) {
  const db = openDb()
  buildIndex(db)

  const estimatedCost = estimateInsightCost(2000)
  const usage = getLlmUsageSummary(db)

  if (!options.yes) {
    console.log(chalk.bold('\n  Agent Standup'))
    console.log(`  Estimated cost: ${chalk.yellow('~$' + estimatedCost.toFixed(4))}`)
    console.log(`  Total claudetop LLM spend: ${chalk.gray('$' + usage.totalCostUsd.toFixed(4))} (${usage.totalCalls} calls)`)
    const ok = await confirm('\n  Generate? [y/N] ')
    if (!ok) { console.log(chalk.gray('  Cancelled.')); closeDb(db); return }
  }

  console.log(chalk.gray('\n  Generating...'))
  let report
  try {
    report = await generateStandup(db)
  } catch (err: unknown) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`))
    closeDb(db); process.exit(1)
  }
  closeDb(db)

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return }

  console.log(chalk.bold('\n  📋 Agent Standup — ' + new Date().toLocaleDateString()))

  if (report.done.length) {
    console.log(chalk.green('\n  ✅ Done (last 24h)'))
    for (const d of report.done) {
      console.log(`    ${chalk.cyan(d.project.padEnd(18))} ${d.summary}  ${chalk.gray('$' + d.costUsd.toFixed(4))}`)
    }
  } else {
    console.log(chalk.gray('\n  No completed sessions in last 24h.'))
  }

  if (report.blockers.length) {
    console.log(chalk.red('\n  ⚠️  Blockers'))
    for (const b of report.blockers) {
      console.log(`    ${chalk.cyan(b.project.padEnd(18))} ${b.description}`)
    }
  }

  const used = report.llmUsage.inputTokens + report.llmUsage.outputTokens
  console.log(chalk.gray(`\n  💰 Used ~${used} tokens ($${report.llmUsage.estimatedCostUsd.toFixed(4)})`))
}
```

**Step 2: Implement prune.ts**

```typescript
// packages/cli/src/commands/prune.ts
import { openDb, closeDb, buildIndex, querySessions, getClaudeProjectsDir } from '@claudetop/core'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import * as readline from 'readline'

function confirm(q: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, (a) => { rl.close(); resolve(a.toLowerCase().startsWith('y')) })
  })
}

export async function pruneCommand(options: { dryRun?: boolean }) {
  const db = openDb()
  buildIndex(db)
  const sessions = querySessions(db, { limit: 50000 })
  const claudeDir = getClaudeProjectsDir()
  const orphaned: string[] = []

  for (const s of sessions) {
    let found = false
    if (fs.existsSync(claudeDir)) {
      for (const dir of fs.readdirSync(claudeDir)) {
        if (fs.existsSync(path.join(claudeDir, dir, `${s.sessionId}.jsonl`))) { found = true; break }
      }
    }
    if (!found) orphaned.push(s.sessionId)
  }
  closeDb(db)

  if (!orphaned.length) { console.log(chalk.green('  Nothing to prune.')); return }

  console.log(chalk.bold(`\n  Found ${orphaned.length} orphaned session(s) in DB`))
  if (options.dryRun) { console.log(chalk.yellow('  Dry run — no changes made.')); return }

  const ok = await confirm(`\n  Remove ${orphaned.length} orphaned session(s) from DB? [y/N] `)
  if (!ok) { console.log(chalk.gray('  Cancelled.')); return }

  const db2 = openDb()
  const stmt = db2.prepare('DELETE FROM sessions WHERE session_id = ?')
  for (const id of orphaned) stmt.run(id)
  closeDb(db2)
  console.log(chalk.green(`\n  Pruned ${orphaned.length} session(s).`))
}
```

**Step 3: Update packages/cli/src/index.ts**

Add imports at the top (after existing imports):

```typescript
import { sessionsCommand } from './commands/sessions'
import { reportCommand } from './commands/report'
import { standupCommand } from './commands/standup'
import { pruneCommand } from './commands/prune'
```

Add commands before `program.parse()`:

```typescript
program
  .command('sessions [sessionId]')
  .description('Browse historical Claude sessions')
  .option('--project <name>', 'Filter by project name')
  .option('--since <period>', 'e.g. 7d, 2w, 1m')
  .option('--limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action((sessionId, options) => sessionsCommand(sessionId, options))

program
  .command('report')
  .description('Cost and usage report')
  .option('--period <period>', 'day | week | month', 'week')
  .option('--project <name>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action((options) => reportCommand(options))

program
  .command('standup')
  .description('AI-powered agent standup (done/doing/blockers)')
  .option('--yes', 'Skip cost confirmation')
  .option('--json', 'Output as JSON')
  .action((options) => standupCommand(options))

program
  .command('prune')
  .description('Remove orphaned session records from DB')
  .option('--dry-run', 'Show what would be removed without removing')
  .action((options) => pruneCommand(options))
```

**Step 4: Build**

```bash
cd packages/cli && pnpm build 2>&1 | tail -10
```

Expected: No TypeScript errors.

**Step 5: Commit**

```bash
git add packages/cli/src/commands/standup.ts packages/cli/src/commands/prune.ts packages/cli/src/index.ts
git commit -m "feat(cli): add standup, prune commands and register all new commands"
```

---

### Task 11: Electron IPC handlers + preload expansion

**Files:**
- Modify: `packages/app/electron/main.ts`
- Modify: `packages/app/electron/preload.ts`

**Step 1: Update main.ts**

Add import at top (after existing imports):

```typescript
import {
  openDb, buildIndex, querySessions, getCostReport,
  generateStandup, estimateInsightCost, getLlmUsageSummary,
  SessionFilter,
} from '@claudetop/core'
```

Add `analyticsDb` variable and `getDb()` helper before `createWindow`:

```typescript
let analyticsDb: ReturnType<typeof openDb> | null = null

function getDb() {
  if (!analyticsDb) {
    analyticsDb = openDb()
    buildIndex(analyticsDb)
  }
  return analyticsDb
}
```

Replace the body of `setupIPC()` with:

```typescript
function setupIPC() {
  ipcMain.handle('list-processes', () => listProcesses())
  ipcMain.handle('kill-process', (_event, pid: number, signal?: string) => {
    killProcess(pid, (signal as 'SIGTERM' | 'SIGKILL') ?? 'SIGTERM')
  })
  ipcMain.handle('security-scan', (_event, pid?: number) => securityScan(pid))

  ipcMain.handle('get-sessions', (_event, filter: SessionFilter) =>
    querySessions(getDb(), filter))
  ipcMain.handle('get-cost-report', (_event, filter: SessionFilter) =>
    getCostReport(getDb(), filter))
  ipcMain.handle('estimate-standup-cost', () => estimateInsightCost(2000))
  ipcMain.handle('generate-standup', async (_event, confirmed: boolean) => {
    if (!confirmed) return { error: 'Not confirmed', estimatedCost: estimateInsightCost(2000) }
    try { return await generateStandup(getDb()) }
    catch (err: unknown) { return { error: err instanceof Error ? err.message : String(err) } }
  })
  ipcMain.handle('get-llm-usage', () => getLlmUsageSummary(getDb()))
  ipcMain.handle('refresh-index', () => { buildIndex(getDb()); return true })
}
```

Add before `app.on('window-all-closed', ...)`:

```typescript
app.on('before-quit', () => { analyticsDb?.close() })
```

**Step 2: Replace preload.ts**

```typescript
// packages/app/electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('claudetop', {
  // Existing
  listProcesses: () => ipcRenderer.invoke('list-processes'),
  killProcess: (pid: number, signal?: string) => ipcRenderer.invoke('kill-process', pid, signal),
  securityScan: (pid?: number) => ipcRenderer.invoke('security-scan', pid),
  onProcessUpdate: (callback: (processes: unknown[]) => void) => {
    ipcRenderer.on('process-update', (_event, processes) => callback(processes))
    return () => ipcRenderer.removeAllListeners('process-update')
  },
  // v2
  getSessions: (filter: unknown) => ipcRenderer.invoke('get-sessions', filter),
  getCostReport: (filter: unknown) => ipcRenderer.invoke('get-cost-report', filter),
  estimateStandupCost: () => ipcRenderer.invoke('estimate-standup-cost'),
  generateStandup: (confirmed: boolean) => ipcRenderer.invoke('generate-standup', confirmed),
  getLlmUsage: () => ipcRenderer.invoke('get-llm-usage'),
  refreshIndex: () => ipcRenderer.invoke('refresh-index'),
})
```

**Step 3: Build electron**

```bash
cd packages/app && pnpm build 2>&1 | tail -10
```

Expected: No TypeScript errors.

**Step 4: Commit**

```bash
git add packages/app/electron/main.ts packages/app/electron/preload.ts
git commit -m "feat(app): add v2 IPC handlers for sessions, analytics, standup"
```

---

### Task 12: Renderer — Sessions, Analytics, Standup panels

**Files:**
- Create: `packages/app/src/components/SessionsPanel.tsx`
- Create: `packages/app/src/components/AnalyticsPanel.tsx`
- Create: `packages/app/src/components/StandupPanel.tsx`

**Step 1: Create SessionsPanel.tsx**

```typescript
// packages/app/src/components/SessionsPanel.tsx
import React, { useState, useEffect } from 'react'

interface Session {
  sessionId: string; projectSlug: string; model: string | null
  startedAt: string | null; durationSeconds: number | null
  estimatedCostUsd: number; gitBranch: string | null
  usage: { input_tokens: number; output_tokens: number }
}

function fmt(s: number | null): string {
  if (!s) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function SessionsPanel() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<Session | null>(null)
  const [project, setProject] = useState('')
  const [since, setSince] = useState('7d')

  useEffect(() => {
    const f: Record<string, unknown> = {}
    if (project) f.project = project
    if (since) {
      const ms = since === '1d' ? 86400000 : since === '7d' ? 7 * 86400000 : 30 * 86400000
      f.since = new Date(Date.now() - ms)
    }
    ;(window as unknown as { claudetop: { getSessions: (f: unknown) => Promise<Session[]> } })
      .claudetop.getSessions(f).then(setSessions)
  }, [project, since])

  return (
    <div className="panel-container">
      <div className="panel-toolbar">
        <input className="filter-input" placeholder="Filter by project..." value={project} onChange={(e) => setProject(e.target.value)} />
        <select className="filter-select" value={since} onChange={(e) => setSince(e.target.value)}>
          <option value="1d">24h</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="">All time</option>
        </select>
      </div>
      <div className="sessions-list">
        <table>
          <thead><tr><th>ID</th><th>Project</th><th>Model</th><th>Duration</th><th>Cost</th><th>Started</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.sessionId} className={selected?.sessionId === s.sessionId ? 'selected' : ''} onClick={() => setSelected(s)}>
                <td style={{ color: '#4a9eff', fontFamily: 'monospace' }}>{s.sessionId.slice(0, 8)}</td>
                <td>{s.projectSlug}</td>
                <td style={{ color: '#f6ad55' }}>{s.model ?? '—'}</td>
                <td>{fmt(s.durationSeconds)}</td>
                <td style={{ color: '#68d391' }}>${s.estimatedCostUsd.toFixed(4)}</td>
                <td style={{ color: '#666' }}>{s.startedAt ? new Date(s.startedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="detail-panel">
          <div className="detail-header"><span style={{ color: '#4a9eff' }}>{selected.sessionId}</span></div>
          <div className="detail-row"><span className="detail-label">Project</span><span className="detail-value">{selected.projectSlug}</span></div>
          <div className="detail-row"><span className="detail-label">Model</span><span className="detail-value">{selected.model ?? '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Branch</span><span className="detail-value">{selected.gitBranch ?? '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Duration</span><span className="detail-value">{fmt(selected.durationSeconds)}</span></div>
          <div className="detail-row"><span className="detail-label">Input tokens</span><span className="detail-value">{selected.usage.input_tokens.toLocaleString()}</span></div>
          <div className="detail-row"><span className="detail-label">Output tokens</span><span className="detail-value">{selected.usage.output_tokens.toLocaleString()}</span></div>
          <div className="detail-row"><span className="detail-label">Est. cost</span><span className="detail-value" style={{ color: '#68d391' }}>${selected.estimatedCostUsd.toFixed(4)}</span></div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Create AnalyticsPanel.tsx**

```typescript
// packages/app/src/components/AnalyticsPanel.tsx
import React, { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface CostReport {
  totalUsd: number
  byProject: Array<{ project: string; usd: number; sessions: number }>
  byModel: Array<{ model: string; usd: number; sessions: number }>
  byDay: Array<{ date: string; usd: number; sessions: number }>
}

const COLORS = ['#4a9eff', '#68d391', '#f6ad55', '#fc8181', '#b794f4']

export function AnalyticsPanel() {
  const [report, setReport] = useState<CostReport | null>(null)
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week')

  useEffect(() => {
    const ms = period === 'day' ? 86400000 : period === 'week' ? 7 * 86400000 : 30 * 86400000
    const filter = { since: new Date(Date.now() - ms) }
    ;(window as unknown as { claudetop: { getCostReport: (f: unknown) => Promise<CostReport> } })
      .claudetop.getCostReport(filter).then(setReport)
  }, [period])

  if (!report) return <div className="empty-state">Loading...</div>

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
      <div className="panel-toolbar" style={{ marginBottom: 16, padding: 0, border: 'none' }}>
        <span style={{ color: '#e0e0e0', fontWeight: 'bold', marginRight: 16 }}>
          Total: <span style={{ color: '#68d391' }}>${report.totalUsd.toFixed(4)}</span>
        </span>
        {(['day', 'week', 'month'] as const).map((p) => (
          <button key={p} className="kill-btn"
            style={{ background: period === p ? '#1d2735' : undefined, marginRight: 4 }}
            onClick={() => setPeriod(p)}>{p}</button>
        ))}
      </div>

      {report.byDay.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: '#666', marginBottom: 8, fontSize: 11, textTransform: 'uppercase' }}>Daily Cost</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={report.byDay}>
              <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 10 }} />
              <YAxis tick={{ fill: '#666', fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']} contentStyle={{ background: '#111', border: '1px solid #222', color: '#e0e0e0' }} />
              <Bar dataKey="usd" fill="#4a9eff" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ color: '#666', marginBottom: 8, fontSize: 11, textTransform: 'uppercase' }}>By Project</div>
          {report.byProject.slice(0, 6).map((p, i) => (
            <div key={p.project} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS[i % COLORS.length] }}>{p.project.slice(0, 22)}</span>
              <span style={{ color: '#68d391' }}>${p.usd.toFixed(4)}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ color: '#666', marginBottom: 8, fontSize: 11, textTransform: 'uppercase' }}>By Model</div>
          {report.byModel.map((m, i) => (
            <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS[i % COLORS.length] }}>{(m.model ?? '—').replace('claude-', '')}</span>
              <span style={{ color: '#f6ad55' }}>${m.usd.toFixed(4)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Create StandupPanel.tsx**

```typescript
// packages/app/src/components/StandupPanel.tsx
import React, { useState } from 'react'

interface StandupReport {
  generatedAt: string
  done: Array<{ project: string; summary: string; sessions: number; costUsd: number }>
  inProgress: Array<{ project: string; model: string | null; runtimeMinutes: number; branch: string | null }>
  blockers: Array<{ project: string; description: string }>
  llmUsage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }
}

type CT = { estimateStandupCost: () => Promise<number>; getLlmUsage: () => Promise<{ totalCostUsd: number; totalCalls: number }>; generateStandup: (c: boolean) => Promise<StandupReport & { error?: string }> }

export function StandupPanel() {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle')
  const [report, setReport] = useState<StandupReport | null>(null)
  const [error, setError] = useState('')
  const [estCost, setEstCost] = useState(0)
  const [llmUsage, setLlmUsage] = useState<{ totalCostUsd: number; totalCalls: number } | null>(null)

  async function onGenerate() {
    const ct = (window as unknown as { claudetop: CT }).claudetop
    const [cost, usage] = await Promise.all([ct.estimateStandupCost(), ct.getLlmUsage()])
    setEstCost(cost); setLlmUsage(usage); setPhase('confirm')
  }

  async function onConfirm() {
    setPhase('loading')
    const ct = (window as unknown as { claudetop: CT }).claudetop
    const result = await ct.generateStandup(true)
    if (result.error) { setError(result.error); setPhase('error') }
    else { setReport(result); setPhase('done') }
  }

  return (
    <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 'bold' }}>Agent Standup</span>
        {(phase === 'idle' || phase === 'done' || phase === 'error') && (
          <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }} onClick={onGenerate}>
            {phase === 'done' ? '↻ Regenerate' : '✨ Generate'}
          </button>
        )}
      </div>

      {phase === 'confirm' && (
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <div>Estimated cost: <span style={{ color: '#f6ad55' }}>${estCost.toFixed(4)}</span></div>
            {llmUsage && <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>Total claudetop LLM spend: ${llmUsage.totalCostUsd.toFixed(4)} ({llmUsage.totalCalls} calls)</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }} onClick={onConfirm}>Confirm</button>
            <button className="kill-btn" onClick={() => setPhase('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'loading' && <div className="empty-state">Generating standup...</div>}

      {phase === 'error' && (
        <div className="empty-state" style={{ color: '#fc8181' }}>
          {error}<br /><span style={{ fontSize: 11, color: '#555' }}>Is ANTHROPIC_API_KEY set or Claude Code configured?</span>
        </div>
      )}

      {phase === 'done' && report && (
        <>
          {report.done.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#68d391', fontWeight: 'bold', marginBottom: 8 }}>✅ Done (last 24h)</div>
              {report.done.map((d) => (
                <div key={d.project} style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                  <span style={{ color: '#4a9eff', flexShrink: 0, width: 130 }}>{d.project}</span>
                  <span style={{ color: '#a0aec0' }}>{d.summary}</span>
                  <span style={{ color: '#444', fontSize: 11, flexShrink: 0 }}>${d.costUsd.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
          {report.blockers.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#fc8181', fontWeight: 'bold', marginBottom: 8 }}>⚠️ Blockers</div>
              {report.blockers.map((b, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: '#4a9eff', display: 'inline-block', width: 130 }}>{b.project}</span>
                  <span style={{ color: '#fc8181' }}>{b.description}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ color: '#333', fontSize: 11, borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
            {new Date(report.generatedAt).toLocaleString()} · {report.llmUsage.inputTokens + report.llmUsage.outputTokens} tokens (${report.llmUsage.estimatedCostUsd.toFixed(4)})
          </div>
        </>
      )}

      {phase === 'idle' && (
        <div className="empty-state">Click "Generate" for an AI-powered standup<br /><span style={{ fontSize: 11 }}>Done / Blockers for the last 24h</span></div>
      )}
    </div>
  )
}
```

**Step 4: Build**

```bash
cd packages/app && pnpm build 2>&1 | tail -5
```

Expected: No errors.

**Step 5: Commit**

```bash
git add packages/app/src/components/SessionsPanel.tsx packages/app/src/components/AnalyticsPanel.tsx packages/app/src/components/StandupPanel.tsx
git commit -m "feat(app): add Sessions, Analytics, and Standup panels"
```

---

### Task 13: Wire up App.tsx navigation + update Sidebar + add CSS

**Files:**
- Modify: `packages/app/src/App.tsx`
- Modify: `packages/app/src/components/Sidebar.tsx`
- Modify: `packages/app/src/styles.css`

**Step 1: Replace App.tsx**

```typescript
// packages/app/src/App.tsx
import React, { useState } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { ProcessList } from './components/ProcessList'
import { DetailPanel } from './components/DetailPanel'
import { SessionsPanel } from './components/SessionsPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { StandupPanel } from './components/StandupPanel'
import { useProcesses } from './hooks/useProcesses'

export type View = 'all' | 'runaway' | 'sessions' | 'analytics' | 'standup'

export function App() {
  const { processes, selected, setSelected, killProcess } = useProcesses()
  const [view, setView] = useState<View>('all')
  const filtered = view === 'runaway' ? processes.filter((p) => p.isRunaway) : processes

  return (
    <div className="layout">
      <Sidebar processes={processes} activeView={view} onViewChange={setView} />
      <div className="main">
        {view === 'sessions'  ? <SessionsPanel /> :
         view === 'analytics' ? <AnalyticsPanel /> :
         view === 'standup'   ? <StandupPanel /> : (
          <>
            <ProcessList processes={filtered} selected={selected} onSelect={setSelected} />
            <DetailPanel process={selected} onKill={killProcess} />
          </>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Replace Sidebar.tsx**

```typescript
// packages/app/src/components/Sidebar.tsx
import React from 'react'
import { ClaudeProcess } from '../hooks/useProcesses'
import { View } from '../App'

interface Props {
  processes: ClaudeProcess[]
  activeView: View
  onViewChange: (view: View) => void
}

export function Sidebar({ processes, activeView, onViewChange }: Props) {
  const runawayCount = processes.filter((p) => p.isRunaway).length

  const item = (label: string, view: View, badge?: React.ReactNode) => (
    <div className={`sidebar-item ${activeView === view ? 'active' : ''}`} onClick={() => onViewChange(view)}>
      <span>{label}</span>
      {badge}
    </div>
  )

  return (
    <div className="sidebar">
      <div className="sidebar-title">claudetop</div>
      <div className="sidebar-section-label">Live</div>
      {item('All', 'all', <span style={{ color: '#666' }}>{processes.length}</span>)}
      {item('Runaway', 'runaway', runawayCount > 0 ? <span className="badge">{runawayCount}</span> : null)}
      <div className="sidebar-section-label">History</div>
      {item('Sessions', 'sessions')}
      {item('Analytics', 'analytics')}
      <div className="sidebar-section-label">Agent AI</div>
      {item('Standup ✨', 'standup')}
    </div>
  )
}
```

**Step 3: Append to styles.css**

```css
.sidebar-section-label {
  padding: 12px 16px 4px;
  color: #444;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  -webkit-app-region: drag;
}

.panel-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.panel-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid #222;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.filter-input, .filter-select {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #e0e0e0;
  padding: 4px 10px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.sessions-list { flex: 1; overflow-y: auto; padding: 0 16px; }
```

**Step 4: Full build**

```bash
cd /path/to/claudetop && pnpm -r build 2>&1 | tail -20
```

Expected: All 3 packages build with no errors.

**Step 5: Run full test suite**

```bash
pnpm -r test 2>&1 | tail -20
```

Expected: All tests pass.

**Step 6: Commit and push**

```bash
git add packages/app/src/App.tsx packages/app/src/components/Sidebar.tsx packages/app/src/styles.css
git commit -m "feat(app): wire up Sessions/Analytics/Standup navigation"
git push origin main
```

Expected: CI passes on GitHub Actions.

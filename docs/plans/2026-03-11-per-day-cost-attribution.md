# Per-Day Cost Attribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `session_days` table so analytics attributes each API call's cost to the exact calendar day it happened, rather than dumping the whole session cost onto one day.

**Architecture:** During JSONL parsing, accumulate tokens per local-date into a `dayMap`. The indexer writes these per-day rows alongside each session upsert. Analytics `byDay` query reads from `session_days` instead of `sessions`.

**Tech Stack:** TypeScript, better-sqlite3, Vitest

---

### Task 1: Add `session_days` table to schema

**Files:**
- Modify: `packages/core/src/db.ts`

**Step 1: Write the failing test**

In `packages/core/src/__tests__/db.test.ts`, add:

```typescript
it('creates session_days table', () => {
  const tmpPath = path.join(os.tmpdir(), `claudetop-db-days-${Date.now()}.db`)
  const db = openDb(tmpPath)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  const names = tables.map((t) => t.name)
  expect(names).toContain('session_days')
  closeDb(db)
  fs.unlinkSync(tmpPath)
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test -- --reporter=verbose db.test.ts
```
Expected: FAIL — `session_days` not in table list.

**Step 3: Add table to `createSchema` in `db.ts`**

Inside the `db.exec(...)` call, after the `llm_usage` table, add:

```sql
CREATE TABLE IF NOT EXISTS session_days (
  session_id            TEXT NOT NULL,
  date                  TEXT NOT NULL,
  usd                   REAL NOT NULL DEFAULT 0,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, date)
);
CREATE INDEX IF NOT EXISTS idx_session_days_date ON session_days(date);
```

**Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test -- --reporter=verbose db.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/db.ts packages/core/src/__tests__/db.test.ts
git commit -m "feat(db): add session_days table for per-day cost attribution"
```

---

### Task 2: Track per-day tokens in the JSONL parser

**Files:**
- Modify: `packages/core/src/sessions.ts`
- Modify: `packages/core/src/types.ts`

**Step 1: Add `dayMap` to `ClaudeSession` type**

In `packages/core/src/types.ts`, add one field to `ClaudeSession`:

```typescript
dayMap?: Map<string, TokenUsage>   // keyed by YYYY-MM-DD local date
```

**Step 2: Write the failing test**

In `packages/core/src/__tests__/sessions.test.ts`, add a new `describe` block:

```typescript
describe('parseSessionFile dayMap', () => {
  it('splits tokens across days based on message timestamps', () => {
    const tmpDir = path.join(os.tmpdir(), `claude-test-${Date.now()}`, '-Users-test-proj')
    fs.mkdirSync(tmpDir, { recursive: true })
    const filePath = path.join(tmpDir, 'day-sess.jsonl')

    const usage = { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 }
    fs.writeFileSync(filePath, [
      JSON.stringify({ type: 'user', sessionId: 'day-sess', timestamp: '2026-03-08T10:00:00Z', cwd: '/Users/test/proj' }),
      JSON.stringify({ type: 'assistant', sessionId: 'day-sess', timestamp: '2026-03-08T23:00:00Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6', usage } }),
      JSON.stringify({ type: 'assistant', sessionId: 'day-sess', timestamp: '2026-03-09T01:00:00Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6', usage } }),
    ].join('\n'))

    const session = parseSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.dayMap).toBeDefined()
    // Two distinct dates (may differ by timezone but must sum to total)
    const days = Array.from(session!.dayMap!.entries())
    const totalOut = days.reduce((s, [, u]) => s + u.output_tokens, 0)
    expect(totalOut).toBe(100)   // 2 messages × 50 output_tokens
    fs.rmSync(path.dirname(tmpDir), { recursive: true })
  })
})
```

**Step 3: Run to verify failure**

```bash
cd packages/core && pnpm test -- --reporter=verbose sessions.test.ts
```
Expected: FAIL — `session.dayMap` is `undefined`.

**Step 4: Add `dayMap` tracking to the parser state**

In `packages/core/src/sessions.ts`:

1. In `makeSessionState`, add to the returned object:
```typescript
dayMap: new Map<string, TokenUsage>(),
```

2. In `processRecord`, inside the `if (record.message?.usage)` block, add after the global token accumulation:
```typescript
if (record.timestamp) {
  const localDate = new Date(record.timestamp).toLocaleDateString('en-CA') // YYYY-MM-DD
  const existing = state.dayMap.get(localDate) ?? {
    input_tokens: 0, cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0, output_tokens: 0,
  }
  const u = record.message.usage
  state.dayMap.set(localDate, {
    input_tokens:                existing.input_tokens + (u.input_tokens ?? 0),
    cache_creation_input_tokens: existing.cache_creation_input_tokens + (u.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:     existing.cache_read_input_tokens + (u.cache_read_input_tokens ?? 0),
    output_tokens:               existing.output_tokens + (u.output_tokens ?? 0),
  })
}
```

3. In `finalizeSession`, add to the returned object:
```typescript
dayMap: state.dayMap.size > 0 ? state.dayMap : undefined,
```

**Step 5: Run to verify pass**

```bash
cd packages/core && pnpm test -- --reporter=verbose sessions.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/sessions.ts packages/core/src/types.ts packages/core/src/__tests__/sessions.test.ts
git commit -m "feat(sessions): track per-day token usage in dayMap"
```

---

### Task 3: Write `session_days` rows in the indexer

**Files:**
- Modify: `packages/core/src/indexer.ts`
- Modify: `packages/core/src/__tests__/indexer.test.ts`

**Step 1: Write failing test**

In `packages/core/src/__tests__/indexer.test.ts`, add to the `upsertSession` describe block:

```typescript
it('writes session_days rows for each distinct day', () => {
  const db = openDb(testDbPath)
  const projectDir = path.join(testClaudeDir, '-Users-test-days')
  const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 }
  const filePath = makeSessionFile(projectDir, 'days-test', [
    { type: 'user', sessionId: 'days-test', timestamp: '2026-03-08T10:00:00Z', cwd: '/Users/test/days' },
    { type: 'assistant', sessionId: 'days-test', timestamp: '2026-03-08T12:00:00Z',
      message: { role: 'assistant', model: 'claude-sonnet-4-6', usage } },
    { type: 'assistant', sessionId: 'days-test', timestamp: '2026-03-09T12:00:00Z',
      message: { role: 'assistant', model: 'claude-sonnet-4-6', usage } },
  ])
  upsertSession(db, filePath)
  const rows = db.prepare('SELECT * FROM session_days WHERE session_id = ? ORDER BY date').all('days-test') as Record<string, unknown>[]
  expect(rows.length).toBeGreaterThanOrEqual(1)
  const totalOut = rows.reduce((s, r) => s + (r.output_tokens as number), 0)
  expect(totalOut).toBe(10)  // 2 messages × 5 output_tokens
  closeDb(db)
})
```

**Step 2: Run to verify failure**

```bash
cd packages/core && pnpm test -- --reporter=verbose indexer.test.ts
```
Expected: FAIL — `session_days` table empty.

**Step 3: Add `upsertDays` helper and call it in the indexer**

In `packages/core/src/indexer.ts`:

1. Add the SQL constant:
```typescript
const UPSERT_DAY_SQL = `
  INSERT OR REPLACE INTO session_days
    (session_id, date, usd, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens)
  VALUES (@session_id, @date, @usd, @input_tokens, @cache_creation_tokens, @cache_read_tokens, @output_tokens)
`
```

2. Add the helper function (place after `upsertRow`):
```typescript
function upsertDays(db: Db, session: ClaudeSession): void {
  if (!session.dayMap?.size) return
  db.prepare('DELETE FROM session_days WHERE session_id = ?').run(session.sessionId)
  const stmt = db.prepare(UPSERT_DAY_SQL)
  for (const [date, usage] of session.dayMap) {
    stmt.run({
      session_id:            session.sessionId,
      date,
      usd:                   session.model ? calculateCost(session.model, usage) : 0,
      input_tokens:          usage.input_tokens,
      cache_creation_tokens: usage.cache_creation_input_tokens,
      cache_read_tokens:     usage.cache_read_input_tokens,
      output_tokens:         usage.output_tokens,
    })
  }
}
```

3. Import `calculateCost` at the top:
```typescript
import { parseSessionFile, parseSessionFileStreamed, getClaudeProjectsDir, listSessionFiles } from './sessions'
import { calculateCost } from './sessions'
```
(Combine into one import line.)

4. In `upsertRow`, call `upsertDays` after the existing upsert:
```typescript
function upsertRow(db: Db, session: ClaudeSession): void {
  db.prepare(UPSERT_SQL).run(sessionToRow(session))
  upsertDays(db, session)
}
```

5. In `upsertSession` (watcher path), call `upsertDays` after the existing run:
```typescript
db.prepare(UPSERT_SQL).run(sessionToRow(session))
upsertDays(db, session)
```

**Step 4: Run to verify pass**

```bash
cd packages/core && pnpm test -- --reporter=verbose indexer.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/indexer.ts packages/core/src/__tests__/indexer.test.ts
git commit -m "feat(indexer): write session_days rows during indexing"
```

---

### Task 4: Update analytics to read from `session_days`

**Files:**
- Modify: `packages/core/src/analytics.ts`
- Modify: `packages/core/src/__tests__/analytics.test.ts`

**Step 1: Write failing tests**

In `packages/core/src/__tests__/analytics.test.ts`, add a helper and new tests:

```typescript
function insertSessionDay(db: Db, sessionId: string, date: string, usd: number) {
  db.prepare(`
    INSERT OR REPLACE INTO session_days (session_id, date, usd, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens)
    VALUES (?, ?, ?, 0, 0, 0, 0)
  `).run(sessionId, date, usd)
}

describe('getCostReport byDay from session_days', () => {
  it('attributes cost to the actual day of work, not session start', () => {
    // Session started Mar 6, but work happened Mar 8 and Mar 9
    insertSession(db, {
      session_id: 'multi-day',
      started_at: '2026-03-06T10:00:00Z',
      ended_at: '2026-03-09T10:00:00Z',
      estimated_cost_usd: 30.00,
    })
    insertSessionDay(db, 'multi-day', '2026-03-08', 20.00)
    insertSessionDay(db, 'multi-day', '2026-03-09', 10.00)

    const report = getCostReport(db, {
      since: new Date('2026-03-07T00:00:00Z'),
      until: new Date('2026-03-10T00:00:00Z'),
    })

    const mar8 = report.byDay.find((d) => d.date === '2026-03-08')
    const mar9 = report.byDay.find((d) => d.date === '2026-03-09')
    const mar6 = report.byDay.find((d) => d.date === '2026-03-06')
    expect(mar8?.usd).toBeCloseTo(20.00)
    expect(mar9?.usd).toBeCloseTo(10.00)
    expect(mar6).toBeUndefined()  // no work on Mar 6
  })
})
```

**Step 2: Run to verify failure**

```bash
cd packages/core && pnpm test -- --reporter=verbose analytics.test.ts
```
Expected: FAIL — `byDay` still reads from `sessions`.

**Step 3: Update `getCostReport` byDay query and period filter**

Replace the `byDay` query and update the period `conditions` in `packages/core/src/analytics.ts`:

```typescript
export function getCostReport(db: Db, filter: SessionFilter): CostReport {
  const since = filter.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const until = filter.until ?? new Date()

  // Date strings for session_days (YYYY-MM-DD, used as prefix match)
  const sinceDate = since.toISOString().slice(0, 10)
  const untilDate = until.toISOString().slice(0, 10)

  const params: Record<string, unknown> = {
    since: since.toISOString(),
    until: until.toISOString(),
    sinceDate,
    untilDate,
  }

  // For total/byProject/byModel: sessions that had ANY work days in the window
  // Join to session_days to find sessions with work in range
  const sessionConditions = [
    'sd.date >= @sinceDate',
    'sd.date <= @untilDate',
  ]
  if (filter.project) {
    sessionConditions.push('s.project_slug LIKE @project')
    params.project = `%${filter.project}%`
  }
  const sessionJoin = `
    FROM sessions s
    JOIN session_days sd ON sd.session_id = s.session_id
    WHERE ${sessionConditions.join(' AND ')}
  `

  const total = db.prepare(
    `SELECT COALESCE(SUM(sd.usd), 0) as total ${sessionJoin}`
  ).get(params) as { total: number }

  const byProject = db.prepare(`
    SELECT s.project_slug as project, SUM(sd.usd) as usd, COUNT(DISTINCT s.session_id) as sessions
    ${sessionJoin} GROUP BY s.project_slug ORDER BY usd DESC
  `).all(params) as Array<{ project: string; usd: number; sessions: number }>

  const byModel = db.prepare(`
    SELECT s.model as model, SUM(sd.usd) as usd, COUNT(DISTINCT s.session_id) as sessions
    ${sessionJoin} GROUP BY s.model ORDER BY usd DESC
  `).all(params) as Array<{ model: string; usd: number; sessions: number }>

  const byDay = db.prepare(`
    SELECT sd.date as date, SUM(sd.usd) as usd, COUNT(DISTINCT sd.session_id) as sessions
    ${sessionJoin} GROUP BY sd.date ORDER BY sd.date ASC
  `).all(params) as Array<{ date: string; usd: number; sessions: number }>

  return { totalUsd: total.total, byProject, byModel, byDay, period: { from: since, to: until } }
}
```

Note: also remove the old `querySessions` `since`/`until` conditions that referenced `started_at` — those remain as-is since they're for the Sessions panel, not analytics.

**Step 4: Run all core tests**

```bash
cd packages/core && pnpm test
```
Expected: all PASS

**Step 5: Commit**

```bash
git add packages/core/src/analytics.ts packages/core/src/__tests__/analytics.test.ts
git commit -m "feat(analytics): read byDay costs from session_days table"
```

---

### Task 5: Build and verify end-to-end

**Files:**
- Build: `packages/core`, `packages/app`

**Step 1: Build core**

```bash
cd /path/to/claudetop && pnpm --filter @claudetop/core build
```
Expected: no TypeScript errors.

**Step 2: Build app electron**

```bash
cd packages/app && pnpm build
```
Expected: build succeeds.

**Step 3: Run full test suite**

```bash
cd /path/to/claudetop && pnpm --filter @claudetop/core test
```
Expected: all tests PASS.

**Step 4: Commit and push**

```bash
git push
```

**Step 5: Manual verification**

Restart the Electron app. The indexer will re-index all sessions (indexed_at was reset earlier). After "Indexed N sessions" appears in the status bar:
- Open Analytics → check the "week" view daily chart
- Sessions that spanned multiple days should now show distributed cost across those days
- Running sessions with ongoing API calls should show today's cost on today's bar

---

### Notes

- Sessions with no `dayMap` (e.g. sessions with no timestamped usage records) will have no `session_days` rows. The analytics query uses `JOIN` so these sessions are excluded from totals in the byDay/byProject/byModel views. This is correct — sessions with no cost data should not appear.
- The `querySessions` function (used by the Sessions panel) is unchanged — it still reads from `sessions` directly.
- All 3,389 sessions will be re-indexed on next startup since `indexed_at` was reset to `2000-01-01` in a prior fix.

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
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
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
  it('returns all sessions when no filter', () => {
    insertSession(db, { session_id: 'a' })
    insertSession(db, { session_id: 'b' })
    const results = querySessions(db, {})
    expect(results).toHaveLength(2)
  })

  it('filters by project', () => {
    insertSession(db, { session_id: 'a', project_slug: 'cann' })
    insertSession(db, { session_id: 'b', project_slug: 'other' })
    const results = querySessions(db, { project: 'cann' })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('a')
  })

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) insertSession(db, { session_id: `s${i}` })
    const results = querySessions(db, { limit: 3 })
    expect(results).toHaveLength(3)
  })
})

function insertSessionDay(db: Db, sessionId: string, date: string, usd: number) {
  db.prepare(`
    INSERT OR REPLACE INTO session_days (session_id, date, usd, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens)
    VALUES (?, ?, ?, 0, 0, 0, 0)
  `).run(sessionId, date, usd)
}

describe('getCostReport', () => {
  it('aggregates total cost', () => {
    const today = new Date().toISOString().slice(0, 10)
    insertSession(db, { session_id: 'x', estimated_cost_usd: 0.05 })
    insertSessionDay(db, 'x', today, 0.05)
    insertSession(db, { session_id: 'y', estimated_cost_usd: 0.10 })
    insertSessionDay(db, 'y', today, 0.10)
    const report = getCostReport(db, {})
    expect(report.totalUsd).toBeCloseTo(0.15)
  })

  it('aggregates cost by project', () => {
    const today = new Date().toISOString().slice(0, 10)
    insertSession(db, { session_id: 'x', project_slug: 'proj-a', estimated_cost_usd: 0.05 })
    insertSessionDay(db, 'x', today, 0.05)
    insertSession(db, { session_id: 'y', project_slug: 'proj-a', estimated_cost_usd: 0.10 })
    insertSessionDay(db, 'y', today, 0.10)
    insertSession(db, { session_id: 'z', project_slug: 'proj-b', estimated_cost_usd: 0.03 })
    insertSessionDay(db, 'z', today, 0.03)
    const report = getCostReport(db, {})
    const projA = report.byProject.find((p) => p.project === 'proj-a')
    expect(projA?.usd).toBeCloseTo(0.15)
    expect(projA?.sessions).toBe(2)
  })
})

describe('getCostReport byDay from session_days', () => {
  it('attributes cost to the actual day of work, not session start', () => {
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
    expect(mar6).toBeUndefined()
  })
})

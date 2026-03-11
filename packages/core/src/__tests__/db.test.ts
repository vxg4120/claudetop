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

  it('creates session_days table', () => {
    const tmpPath = path.join(os.tmpdir(), `claudetop-db-days-${Date.now()}.db`)
    const db = openDb(tmpPath)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('session_days')
    closeDb(db)
    fs.unlinkSync(tmpPath)
  })

  it('creates sessions table with required columns', () => {
    const db = openDb(testDbPath)
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('session_id')
    expect(colNames).toContain('project_slug')
    expect(colNames).toContain('estimated_cost_usd')
    expect(colNames).toContain('is_sidechain')
    closeDb(db)
  })
})

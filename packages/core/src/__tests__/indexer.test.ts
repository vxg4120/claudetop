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
  it('indexes all JSONL files in a directory', () => {
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

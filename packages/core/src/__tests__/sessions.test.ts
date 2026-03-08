import { describe, it, expect } from 'vitest'
import { calculateCost, MODEL_PRICING, parseSessionFile } from '../sessions'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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

describe('parseSessionFile', () => {
  it('parses a session file and accumulates tokens', () => {
    const tmpDir = path.join(os.tmpdir(), `claude-test-${Date.now()}`, '-Users-test-myproject')
    fs.mkdirSync(tmpDir, { recursive: true })
    const filePath = path.join(tmpDir, 'abc-123.jsonl')
    fs.writeFileSync(filePath, [
      JSON.stringify({ type: 'user', sessionId: 'abc-123', timestamp: '2026-01-01T10:00:00Z', cwd: '/Users/test/myproject' }),
      JSON.stringify({ type: 'assistant', sessionId: 'abc-123', timestamp: '2026-01-01T10:01:00Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 } } }),
    ].join('\n'))

    const session = parseSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.sessionId).toBe('abc-123')
    expect(session!.model).toBe('claude-sonnet-4-6')
    expect(session!.usage.input_tokens).toBe(100)
    expect(session!.usage.output_tokens).toBe(50)
    expect(session!.estimatedCostUsd).toBeGreaterThan(0)

    fs.rmSync(path.dirname(tmpDir), { recursive: true })
  })

  it('returns null for non-existent file', () => {
    const result = parseSessionFile('/nonexistent/path/file.jsonl')
    expect(result).toBeNull()
  })
})

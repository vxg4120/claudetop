import { describe, it, expect } from 'vitest'
import { estimateInsightCost, readClaudeApiKey } from '../insights'

describe('estimateInsightCost', () => {
  it('returns a positive cost estimate for non-zero tokens', () => {
    const est = estimateInsightCost(1000, 'claude-sonnet-4-6')
    expect(est).toBeGreaterThan(0)
    expect(est).toBeLessThan(0.01)
  })

  it('returns 0 for 0 tokens', () => {
    const est = estimateInsightCost(0, 'claude-sonnet-4-6')
    expect(est).toBe(0)
  })
})

describe('readClaudeApiKey', () => {
  it('returns null if the claude dir does not exist', () => {
    const key = readClaudeApiKey('/tmp/nonexistent-claude-dir-xyz-12345')
    expect(key).toBeNull()
  })
})

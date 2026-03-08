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
  it('formats seconds as minutes and seconds', () => {
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
  it('passes through non-running statuses', () => {
    expect(formatStatus(false, 'zombie')).toBe('zombie')
    expect(formatStatus(false, 'stopped')).toBe('stopped')
  })
})

import { describe, it, expect } from 'vitest'
import { listProcesses, isRunaway } from '../processes'
import { DEFAULT_THRESHOLDS } from '../types'

describe('listProcesses', () => {
  it('returns an array', async () => {
    const processes = await listProcesses()
    expect(Array.isArray(processes)).toBe(true)
  })

  it('each process has required fields', async () => {
    const processes = await listProcesses()
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
    expect(isRunaway({ rss: 200, vms: 0 }, 0, thresholds)).toBe(true)
  })

  it('flags long runtime as runaway', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, runtimeSeconds: 10 }
    expect(isRunaway({ rss: 0, vms: 0 }, 20, thresholds)).toBe(true)
  })

  it('does not flag normal processes', () => {
    expect(isRunaway({ rss: 100_000, vms: 0 }, 60, DEFAULT_THRESHOLDS)).toBe(false)
  })
})

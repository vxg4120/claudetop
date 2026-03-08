import { describe, it, expect, vi } from 'vitest'
import { watchProcesses } from '../watch'

describe('watchProcesses', () => {
  it('returns an unsubscribe function', () => {
    const unsubscribe = watchProcesses(100, vi.fn())
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('calls callback with process list', async () => {
    const callback = vi.fn()
    const unsubscribe = watchProcesses(100, callback)
    await new Promise((r) => setTimeout(r, 150))
    unsubscribe()
    expect(callback).toHaveBeenCalled()
    expect(Array.isArray(callback.mock.calls[0][0])).toBe(true)
  })

  it('stops calling callback after unsubscribe', async () => {
    const callback = vi.fn()
    const unsubscribe = watchProcesses(100, callback)
    await new Promise((r) => setTimeout(r, 150))
    const countBeforeUnsub = callback.mock.calls.length
    unsubscribe()
    await new Promise((r) => setTimeout(r, 200))
    expect(callback.mock.calls.length).toBe(countBeforeUnsub)
  })
})

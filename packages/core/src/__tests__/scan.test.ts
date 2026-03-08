import { describe, it, expect } from 'vitest'
import { parseNetworkConnections, isSuspiciousConnection, isFlaggedFile } from '../scan'

describe('parseNetworkConnections', () => {
  it('parses lsof network output', () => {
    const lsofOutput = `claude  1234  user  12u  IPv4  0x1  0t0  TCP localhost:52341->api.anthropic.com:443 (ESTABLISHED)`
    const connections = parseNetworkConnections(lsofOutput)
    expect(connections).toHaveLength(1)
    expect(connections[0].remoteAddress).toBe('api.anthropic.com')
    expect(connections[0].remotePort).toBe(443)
  })

  it('returns empty array for no connections', () => {
    expect(parseNetworkConnections('')).toEqual([])
  })
})

describe('isSuspiciousConnection', () => {
  it('allows anthropic.com connections', () => {
    expect(isSuspiciousConnection({ remoteAddress: 'api.anthropic.com', remotePort: 443 } as any)).toBe(false)
  })

  it('flags unknown hosts', () => {
    expect(isSuspiciousConnection({ remoteAddress: 'unknown-random.xyz', remotePort: 443 } as any)).toBe(true)
  })

  it('flags non-standard ports on unknown hosts', () => {
    expect(isSuspiciousConnection({ remoteAddress: 'unknown.xyz', remotePort: 4444 } as any)).toBe(true)
  })
})

describe('isFlaggedFile', () => {
  it('flags sensitive system files', () => {
    expect(isFlaggedFile('/etc/passwd')).toBe(true)
    expect(isFlaggedFile('/etc/shadow')).toBe(true)
  })

  it('allows normal claude files', () => {
    expect(isFlaggedFile('/Users/user/.claude/history.jsonl')).toBe(false)
    expect(isFlaggedFile('/tmp/claude-abc123')).toBe(false)
  })
})

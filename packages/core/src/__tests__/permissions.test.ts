import { describe, it, expect } from 'vitest'
import { checkPermissions } from '../permissions'

describe('checkPermissions', () => {
  it('returns a valid PermissionReport', async () => {
    const report = await checkPermissions()
    expect(report).toMatchObject({
      canListOwnProcesses: expect.any(Boolean),
      canReadCwd: expect.any(Boolean),
      canReadNetworkConnections: expect.any(Boolean),
      canReadFileDescriptors: expect.any(Boolean),
      isElevated: expect.any(Boolean),
      platform: expect.any(String),
    })
  })

  it('correctly detects the platform', async () => {
    const report = await checkPermissions()
    expect(['darwin', 'linux']).toContain(report.platform)
  })

  it('always allows listing own processes', async () => {
    const report = await checkPermissions()
    expect(report.canListOwnProcesses).toBe(true)
  })
})

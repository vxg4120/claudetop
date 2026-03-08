import { exec } from 'child_process'
import { promisify } from 'util'
import { PermissionReport } from './types'

const execAsync = promisify(exec)

export async function checkPermissions(): Promise<PermissionReport> {
  const platform = process.platform as NodeJS.Platform
  const isElevated = process.getuid?.() === 0 || false

  let canReadCwd = false
  let canReadNetworkConnections = false
  let canReadFileDescriptors = false

  try {
    if (platform === 'darwin') {
      await execAsync(`lsof -p ${process.pid} -a -d cwd 2>/dev/null`)
      canReadCwd = true
    } else {
      canReadCwd = true // Linux /proc always readable for own processes
    }
  } catch {
    canReadCwd = false
  }

  try {
    if (platform === 'darwin') {
      await execAsync(`lsof -p ${process.pid} -a -i 2>/dev/null`)
      canReadNetworkConnections = true
    } else {
      await execAsync(`cat /proc/net/tcp 2>/dev/null`)
      canReadNetworkConnections = true
    }
  } catch {
    canReadNetworkConnections = false
  }

  try {
    if (platform === 'darwin') {
      await execAsync(`lsof -p ${process.pid} 2>/dev/null`)
      canReadFileDescriptors = true
    } else {
      canReadFileDescriptors = true // /proc/pid/fd readable for own process
    }
  } catch {
    canReadFileDescriptors = false
  }

  return {
    canListOwnProcesses: true,
    canReadCwd,
    canReadNetworkConnections,
    canReadFileDescriptors,
    isElevated,
    platform,
  }
}

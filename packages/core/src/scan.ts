import { execFile } from 'child_process'
import { promisify } from 'util'
import { SecurityReport, NetworkConnection } from './types'

const execFileAsync = promisify(execFile)

const ALLOWED_HOSTS = [
  'api.anthropic.com',
  'sentry.io',
  'statsig.com',
  'localhost',
  '127.0.0.1',
  '::1',
]

const FLAGGED_FILE_PATTERNS = [
  /^\/etc\/passwd$/,
  /^\/etc\/shadow$/,
  /^\/etc\/sudoers/,
  /\/.ssh\//,
  /^\/private\/etc\//,
]

export function isSuspiciousConnection(conn: NetworkConnection): boolean {
  return !ALLOWED_HOSTS.some((h) => conn.remoteAddress === h || conn.remoteAddress.endsWith(`.${h}`))
}

export function isFlaggedFile(filePath: string): boolean {
  return FLAGGED_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
}

export function parseNetworkConnections(lsofOutput: string): NetworkConnection[] {
  const connections: NetworkConnection[] = []
  const lines = lsofOutput.split('\n')

  for (const line of lines) {
    // Match: address:port->address:port (STATE)
    const match = line.match(/(\S+):(\d+)->(\S+):(\d+)\s+\((\w+)\)/)
    if (!match) continue

    connections.push({
      localAddress: match[1],
      localPort: parseInt(match[2], 10),
      remoteAddress: match[3],
      remotePort: parseInt(match[4], 10),
      state: match[5],
    })
  }

  return connections
}

export async function securityScan(pid?: number): Promise<SecurityReport> {
  const platform = process.platform
  const anomalies: string[] = []
  let networkConnections: NetworkConnection[] = []
  let openFiles: string[] = []

  // Validate pid is a safe integer before using in any command
  const safePid = pid !== undefined && Number.isInteger(pid) && pid > 0 ? pid : undefined

  try {
    if (platform === 'darwin') {
      // Use execFile (array args, no shell) to prevent injection
      const pidArgs: string[] = safePid ? ['-p', String(safePid)] : ['-c', 'claude']
      const { stdout: netOut } = await execFileAsync('lsof', [...pidArgs, '-a', '-i'])
        .catch(() => ({ stdout: '' }))
      networkConnections = parseNetworkConnections(netOut)

      const { stdout: fileOut } = await execFileAsync('lsof', pidArgs)
        .catch(() => ({ stdout: '' }))
      openFiles = fileOut
        .split('\n')
        .slice(1) // skip header
        .map((l) => l.split(/\s+/).pop() ?? '')
        .filter(Boolean)
        .filter((f) => f.startsWith('/')) // only filesystem paths
    } else {
      // Linux: read /proc via fs, not shell
      if (safePid) {
        const { stdout } = await execFileAsync('ls', ['-la', `/proc/${safePid}/fd`])
          .catch(() => ({ stdout: '' }))
        openFiles = stdout
          .split('\n')
          .map((l) => l.split(' -> ').pop()?.trim() ?? '')
          .filter((f) => f.startsWith('/'))
      }
    }
  } catch {
    anomalies.push('Could not complete full scan — try with elevated permissions (sudo)')
  }

  const suspiciousConnections = networkConnections.filter(isSuspiciousConnection)
  const flaggedFiles = openFiles.filter(isFlaggedFile)

  if (suspiciousConnections.length > 0) {
    anomalies.push(`${suspiciousConnections.length} suspicious network connection(s) detected`)
  }
  if (flaggedFiles.length > 0) {
    anomalies.push(`${flaggedFiles.length} sensitive file(s) accessed`)
  }

  return {
    pid,
    scannedAt: new Date(),
    networkConnections,
    suspiciousConnections,
    openFiles,
    flaggedFiles,
    childProcessCount: 0,
    anomalies,
  }
}

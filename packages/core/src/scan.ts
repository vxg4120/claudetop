import { exec } from 'child_process'
import { promisify } from 'util'
import { SecurityReport, NetworkConnection } from './types'

const execAsync = promisify(exec)

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
  /^\/.ssh\//,
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

  try {
    if (platform === 'darwin') {
      const pidFlag = pid ? `-p ${pid}` : '-c claude'
      const { stdout: netOut } = await execAsync(`lsof ${pidFlag} -a -i 2>/dev/null || true`)
      networkConnections = parseNetworkConnections(netOut)

      const { stdout: fileOut } = await execAsync(`lsof ${pidFlag} 2>/dev/null || true`)
      openFiles = fileOut
        .split('\n')
        .slice(1) // skip header
        .map((l) => l.split(/\s+/).pop() ?? '')
        .filter(Boolean)
        .filter((f) => f.startsWith('/')) // only filesystem paths
    } else {
      // Linux: read /proc
      if (pid) {
        const { stdout } = await execAsync(`ls -la /proc/${pid}/fd 2>/dev/null || true`)
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

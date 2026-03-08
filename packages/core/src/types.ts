export interface ClaudeProcess {
  pid: number
  ppid: number
  memory: {
    rss: number   // bytes
    vms: number   // bytes
  }
  cpu: number           // percentage
  runtime: number       // seconds
  status: 'running' | 'sleeping' | 'stopped' | 'zombie' | 'unknown'
  cwd: string
  args: string[]
  isRunaway: boolean
  logPath?: string
}

export interface PermissionReport {
  canListOwnProcesses: boolean
  canReadCwd: boolean
  canReadNetworkConnections: boolean
  canReadFileDescriptors: boolean
  isElevated: boolean
  platform: NodeJS.Platform
}

export interface SecurityReport {
  pid?: number
  scannedAt: Date
  networkConnections: NetworkConnection[]
  suspiciousConnections: NetworkConnection[]
  openFiles: string[]
  flaggedFiles: string[]
  childProcessCount: number
  anomalies: string[]
}

export interface NetworkConnection {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
}

export interface RunawayThresholds {
  memoryRssBytes: number    // default: 2GB
  runtimeSeconds: number    // default: 7200 (2h)
  cpuPercent: number        // default: 80
  cpuSustainedSeconds: number // default: 60
}

export const DEFAULT_THRESHOLDS: RunawayThresholds = {
  memoryRssBytes: 2 * 1024 * 1024 * 1024,
  runtimeSeconds: 7200,
  cpuPercent: 80,
  cpuSustainedSeconds: 60,
}

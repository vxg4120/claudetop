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

export interface TokenUsage {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
}

export interface ClaudeSession {
  sessionId: string
  projectSlug: string       // URL-decoded directory name
  cwd: string
  gitBranch: string | null
  model: string | null
  startedAt: Date | null
  endedAt: Date | null
  durationSeconds: number | null
  usage: TokenUsage
  estimatedCostUsd: number
  isSidechain: boolean
  parentSessionId: string | null
  summary: string | null    // LLM-generated, null until requested
  permissionMode: string | null
}

export interface SessionFilter {
  project?: string
  since?: Date
  until?: Date
  model?: string
  limit?: number
}

export interface CostReport {
  totalUsd: number
  byProject: Array<{ project: string; usd: number; sessions: number }>
  byModel: Array<{ model: string; usd: number; sessions: number }>
  byDay: Array<{ date: string; usd: number; sessions: number }>
  period: { from: Date; to: Date }
}

export interface StandupReport {
  generatedAt: Date
  done: Array<{ project: string; summary: string; sessions: number; costUsd: number }>
  inProgress: Array<{ sessionId: string; project: string; model: string | null; runtimeMinutes: number; branch: string | null }>
  blockers: Array<{ sessionId: string; project: string; description: string }>
  llmUsage: LlmUsageRecord
}

export interface LlmUsageRecord {
  id?: number
  timestamp: Date
  feature: 'standup' | 'summarize' | 'insights'
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  sessionId: string | null
}

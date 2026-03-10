import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'
import { getClaudeProjectsDir } from './sessions'

export type BurnAlertType = 'high-rate' | 'sustained-rate' | 'session-cost-exceeded'

export interface BurnAlert {
  project: string
  sessionFile: string
  tokensPerMinute: number
  costPerHour: number
  windowMinutes: number
  totalTokensInWindow: number
  alertType: BurnAlertType
  sessionTotalCostUsd?: number   // populated for session-cost-exceeded
  consecutiveHighWindows?: number // populated for sustained-rate
}

export interface TokenMonitorOptions {
  windowMinutes?: number          // sliding window for rate calc (default: 5)
  tpmThreshold?: number           // tokens/min to trigger alert (default: 20000)
  costPerHourThreshold?: number   // $/hour to trigger alert (default: 0.5)
  maxSessionCostUsd?: number      // alert when single session total exceeds this (default: disabled)
  sustainedWindowsThreshold?: number // consecutive high-rate windows before "sustained" alert (default: 3)
  pollIntervalMs?: number         // how often to scan (default: 15000)
  alertCooldownMs?: number        // min ms between alerts for same session (default: 120000)
}

interface SessionRecord {
  timestamp?: string
  message?: {
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

function avgCostPerToken(model: string): number {
  if (model.includes('opus'))   return (5.00 + 25.00) / 2 / 1_000_000
  if (model.includes('sonnet')) return (3.00 + 15.00) / 2 / 1_000_000
  if (model.includes('haiku'))  return (0.80 +  4.00) / 2 / 1_000_000
  return 0.000010
}

export class TokenMonitor extends EventEmitter {
  private opts: Required<TokenMonitorOptions>
  private timer: ReturnType<typeof setInterval> | null = null
  private lastAlerted = new Map<string, number>()     // filePath → timestamp of last alert
  private consecutiveHighWindows = new Map<string, number>() // filePath → consecutive high-rate scan count

  constructor(options: TokenMonitorOptions = {}) {
    super()
    this.opts = {
      windowMinutes: options.windowMinutes ?? 5,
      tpmThreshold: options.tpmThreshold ?? 20_000,
      costPerHourThreshold: options.costPerHourThreshold ?? 0.5,
      maxSessionCostUsd: options.maxSessionCostUsd ?? 0,  // 0 = disabled
      sustainedWindowsThreshold: options.sustainedWindowsThreshold ?? 3,
      pollIntervalMs: options.pollIntervalMs ?? 15_000,
      alertCooldownMs: options.alertCooldownMs ?? 120_000,
    }
  }

  start(): void {
    this.scan()
    this.timer = setInterval(() => this.scan(), this.opts.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private scan(): void {
    const projectsDir = getClaudeProjectsDir()
    if (!fs.existsSync(projectsDir)) return

    const windowMs = this.opts.windowMinutes * 60_000
    const now = Date.now()

    for (const projectDir of fs.readdirSync(projectsDir)) {
      const projectPath = path.join(projectsDir, projectDir)
      try { if (!fs.statSync(projectPath).isDirectory()) continue } catch { continue }

      for (const file of fs.readdirSync(projectPath)) {
        if (!file.endsWith('.jsonl')) continue
        const filePath = path.join(projectPath, file)

        // Skip files not modified recently
        try {
          const { mtimeMs } = fs.statSync(filePath)
          if (now - mtimeMs > windowMs * 2) continue
        } catch { continue }

        this.analyzeFile(filePath, projectDir, windowMs, now)
      }
    }
  }

  private analyzeFile(filePath: string, projectDir: string, windowMs: number, now: number): void {
    let content: string
    try { content = fs.readFileSync(filePath, 'utf8') } catch { return }

    const windowStart = now - windowMs
    let windowTokens = 0
    let totalSessionTokens = 0
    let model = 'claude-sonnet-4-6'

    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      let r: SessionRecord
      try { r = JSON.parse(line) } catch { continue }

      if (!r.timestamp) continue
      const ts = new Date(r.timestamp).getTime()
      if (isNaN(ts)) continue

      if (r.message?.model) model = r.message.model
      if (r.message?.usage) {
        const u = r.message.usage
        const tokens =
          (u.input_tokens ?? 0) +
          (u.output_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0)
        totalSessionTokens += tokens
        if (ts >= windowStart) windowTokens += tokens
      }
    }

    const windowMinutes = windowMs / 60_000
    const tpm = windowTokens / windowMinutes
    const costPerHour = tpm * 60 * avgCostPerToken(model)
    const sessionTotalCostUsd = totalSessionTokens * avgCostPerToken(model)

    const project = decodeURIComponent(projectDir).replace(/^\//, '').replace(/\//g, '-')

    // Check session total cost threshold (separate cooldown key)
    if (this.opts.maxSessionCostUsd > 0 && sessionTotalCostUsd >= this.opts.maxSessionCostUsd) {
      const costAlertKey = `cost:${filePath}`
      const lastCostAlert = this.lastAlerted.get(costAlertKey) ?? 0
      if (now - lastCostAlert >= this.opts.alertCooldownMs) {
        this.lastAlerted.set(costAlertKey, now)
        this.emit('alert', {
          project, sessionFile: filePath, tokensPerMinute: Math.round(tpm),
          costPerHour, windowMinutes, totalTokensInWindow: windowTokens,
          alertType: 'session-cost-exceeded' as BurnAlertType,
          sessionTotalCostUsd,
        } satisfies BurnAlert)
      }
    }

    const isHighRate = tpm >= this.opts.tpmThreshold || costPerHour >= this.opts.costPerHourThreshold
    if (!isHighRate) {
      this.consecutiveHighWindows.delete(filePath)
      return
    }

    // Track consecutive high-rate windows for sustained alert
    const prevCount = this.consecutiveHighWindows.get(filePath) ?? 0
    const newCount = prevCount + 1
    this.consecutiveHighWindows.set(filePath, newCount)

    const lastAlert = this.lastAlerted.get(filePath) ?? 0
    if (now - lastAlert < this.opts.alertCooldownMs) return
    this.lastAlerted.set(filePath, now)

    // Distinguish sustained vs. initial high-rate alert
    const alertType: BurnAlertType =
      newCount >= this.opts.sustainedWindowsThreshold ? 'sustained-rate' : 'high-rate'

    this.emit('alert', {
      project, sessionFile: filePath, tokensPerMinute: Math.round(tpm),
      costPerHour, windowMinutes, totalTokensInWindow: windowTokens,
      alertType,
      consecutiveHighWindows: newCount,
    } satisfies BurnAlert)
  }
}

export function watchTokenBurnRate(
  options: TokenMonitorOptions,
  onAlert: (alert: BurnAlert) => void
): () => void {
  const monitor = new TokenMonitor(options)
  monitor.on('alert', onAlert)
  monitor.start()
  return () => monitor.stop()
}

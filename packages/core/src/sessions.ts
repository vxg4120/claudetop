import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ClaudeSession, TokenUsage } from './types'

// Pricing per 1M tokens. Updated Feb 2026: Opus 4.6 reduced from $15/$75 → $5/$25.
// Source: platform.claude.com/docs/about-claude/pricing
export const MODEL_PRICING: Record<string, {
  input: number; cacheWrite: number; cacheRead: number; output: number
}> = {
  'claude-opus-4-6':   { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
  'claude-opus-4-5':   { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
  'claude-sonnet-4-6': { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
  'claude-sonnet-4-5': { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
  'claude-haiku-3-5':  { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  const M = 1_000_000
  return (
    usage.input_tokens * pricing.input +
    usage.cache_creation_input_tokens * pricing.cacheWrite +
    usage.cache_read_input_tokens * pricing.cacheRead +
    usage.output_tokens * pricing.output
  ) / M
}

interface JsonlRecord {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  isSidechain?: boolean
  parentUuid?: string
  cwd?: string
  gitBranch?: string
  permissionMode?: string
  message?: {
    role?: string
    model?: string
    usage?: {
      input_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      output_tokens?: number
    }
  }
}

export function parseSessionFile(filePath: string): ClaudeSession | null {
  let lines: string[]
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    if (lines.length > 20000) lines = lines.slice(0, 20000) // cap to avoid OOM on huge files
  } catch {
    return null
  }

  const sessionId = path.basename(filePath, '.jsonl')

  // Handle subagent path: <claudeDir>/<projectSlug>/<parentSessionId>/subagents/<agentId>.jsonl
  const isSubagentPath = path.basename(path.dirname(filePath)) === 'subagents'
  const projectDir = isSubagentPath
    ? path.basename(path.dirname(path.dirname(path.dirname(filePath))))
    : path.basename(path.dirname(filePath))
  const projectSlug = decodeURIComponent(projectDir).replace(/^\//, '').replace(/\//g, '-')

  const usage: TokenUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  }

  let model: string | null = null
  let cwd = ''
  let gitBranch: string | null = null
  let startedAt: Date | null = null
  let endedAt: Date | null = null
  let isSidechain = isSubagentPath
  let parentSessionId: string | null = isSubagentPath
    ? path.basename(path.dirname(path.dirname(filePath)))
    : null
  let permissionMode: string | null = null
  let sessionIdFromRecord: string | null = null

  for (const line of lines) {
    let record: JsonlRecord
    try { record = JSON.parse(line) } catch { continue }

    if (record.sessionId && !sessionIdFromRecord) sessionIdFromRecord = record.sessionId
    if (record.cwd && !cwd) cwd = record.cwd
    if (record.gitBranch && !gitBranch) gitBranch = record.gitBranch
    if (record.permissionMode && !permissionMode) permissionMode = record.permissionMode
    if (record.isSidechain) isSidechain = true
    if (record.parentUuid && !parentSessionId) parentSessionId = record.parentUuid

    if (record.timestamp) {
      const ts = new Date(record.timestamp)
      if (!isNaN(ts.getTime())) {
        if (!startedAt || ts < startedAt) startedAt = ts
        if (!endedAt || ts > endedAt) endedAt = ts
      }
    }

    if (record.message?.model) model = record.message.model
    if (record.message?.usage) {
      const u = record.message.usage
      usage.input_tokens += u.input_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
    }
  }

  const durationSeconds =
    startedAt && endedAt
      ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
      : null

  return {
    sessionId: sessionIdFromRecord ?? sessionId,
    projectSlug,
    cwd: cwd || projectSlug.replace(/-/g, '/'),
    gitBranch,
    model,
    startedAt,
    endedAt,
    durationSeconds,
    usage,
    estimatedCostUsd: model ? calculateCost(model, usage) : 0,
    isSidechain,
    parentSessionId,
    summary: null,
    permissionMode,
  }
}

export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

export function listSessionFiles(claudeDir = getClaudeProjectsDir()): string[] {
  if (!fs.existsSync(claudeDir)) return []
  const files: string[] = []
  for (const projectDir of fs.readdirSync(claudeDir)) {
    const projectPath = path.join(claudeDir, projectDir)
    try {
      if (!fs.statSync(projectPath).isDirectory()) continue
    } catch { continue }
    for (const entry of fs.readdirSync(projectPath)) {
      const entryPath = path.join(projectPath, entry)
      if (entry.endsWith('.jsonl')) {
        files.push(entryPath)
      } else {
        // Check for subagents: <project>/<session-uuid>/subagents/*.jsonl
        const subagentsPath = path.join(entryPath, 'subagents')
        try {
          if (!fs.statSync(entryPath).isDirectory()) continue
          if (!fs.existsSync(subagentsPath)) continue
          for (const sub of fs.readdirSync(subagentsPath)) {
            if (sub.endsWith('.jsonl')) files.push(path.join(subagentsPath, sub))
          }
        } catch { continue }
      }
    }
  }
  return files
}

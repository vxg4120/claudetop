import * as fs from 'fs'
import * as readline from 'readline'
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

function makeSessionState(filePath: string) {
  const sessionId = path.basename(filePath, '.jsonl')
  const isSubagentPath = path.basename(path.dirname(filePath)) === 'subagents'
  const projectDir = isSubagentPath
    ? path.basename(path.dirname(path.dirname(path.dirname(filePath))))
    : path.basename(path.dirname(filePath))
  const projectSlug = decodeURIComponent(projectDir).replace(/^\//, '').replace(/\//g, '-')
  return {
    sessionId,
    projectSlug,
    isSubagentPath,
    usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } as TokenUsage,
    model: null as string | null,
    cwd: '',
    gitBranch: null as string | null,
    startedAt: null as Date | null,
    endedAt: null as Date | null,
    isSidechain: isSubagentPath,
    parentSessionId: isSubagentPath ? path.basename(path.dirname(path.dirname(filePath))) : null as string | null,
    permissionMode: null as string | null,
    sessionIdFromRecord: null as string | null,
  }
}

function processRecord(state: ReturnType<typeof makeSessionState>, record: JsonlRecord) {
  if (record.sessionId && !state.sessionIdFromRecord) state.sessionIdFromRecord = record.sessionId
  if (record.cwd && !state.cwd) state.cwd = record.cwd
  if (record.gitBranch && !state.gitBranch) state.gitBranch = record.gitBranch
  if (record.permissionMode && !state.permissionMode) state.permissionMode = record.permissionMode
  if (record.isSidechain) state.isSidechain = true
  if (record.parentUuid && !state.parentSessionId) state.parentSessionId = record.parentUuid
  if (record.timestamp) {
    const ts = new Date(record.timestamp)
    if (!isNaN(ts.getTime())) {
      if (!state.startedAt || ts < state.startedAt) state.startedAt = ts
      if (!state.endedAt || ts > state.endedAt) state.endedAt = ts
    }
  }
  if (record.message?.model) state.model = record.message.model
  if (record.message?.usage) {
    const u = record.message.usage
    state.usage.input_tokens += u.input_tokens ?? 0
    state.usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
    state.usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
    state.usage.output_tokens += u.output_tokens ?? 0
  }
}

function finalizeSession(state: ReturnType<typeof makeSessionState>, filePath: string): ClaudeSession {
  const durationSeconds = state.startedAt && state.endedAt
    ? Math.round((state.endedAt.getTime() - state.startedAt.getTime()) / 1000)
    : null
  return {
    // Subagent files carry the parent's sessionId in their records; keep the file-based ID.
    sessionId: state.isSubagentPath ? state.sessionId : (state.sessionIdFromRecord ?? state.sessionId),
    projectSlug: state.projectSlug,
    cwd: state.cwd || state.projectSlug.replace(/-/g, '/'),
    gitBranch: state.gitBranch,
    model: state.model,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    durationSeconds,
    usage: state.usage,
    estimatedCostUsd: state.model ? calculateCost(state.model, state.usage) : 0,
    isSidechain: state.isSidechain,
    parentSessionId: state.parentSessionId,
    summary: null,
    permissionMode: state.permissionMode,
  }
}

export function parseSessionFile(filePath: string): ClaudeSession | null {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    const state = makeSessionState(filePath)
    for (const line of lines) {
      try { processRecord(state, JSON.parse(line)) } catch { /* skip bad lines */ }
    }
    return finalizeSession(state, filePath)
  } catch {
    return null
  }
}

export async function parseSessionFileStreamed(filePath: string): Promise<ClaudeSession | null> {
  return new Promise((resolve) => {
    let stream: fs.ReadStream
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' })
    } catch {
      return resolve(null)
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    const state = makeSessionState(filePath)
    rl.on('line', (line) => {
      if (!line.trim()) return
      try { processRecord(state, JSON.parse(line)) } catch { /* skip bad lines */ }
    })
    rl.on('close', () => resolve(finalizeSession(state, filePath)))
    rl.on('error', () => resolve(null))
    stream.on('error', () => { rl.close(); resolve(null) })
  })
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

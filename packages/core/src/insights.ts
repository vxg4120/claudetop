import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Anthropic from '@anthropic-ai/sdk'
import { Db } from './db'
import { LlmUsageRecord } from './types'
import { calculateCost } from './sessions'

const INSIGHTS_MODEL = 'claude-sonnet-4-6'

export function readClaudeApiKey(claudeDir = path.join(os.homedir(), '.claude')): string | null {
  // 1. claudetop settings file (user-configured via UI)
  const claudetopSettings = path.join(os.homedir(), '.claudetop', 'settings.json')
  if (fs.existsSync(claudetopSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(claudetopSettings, 'utf8'))
      if (s.anthropicApiKey) return s.anthropicApiKey
    } catch { /* ignore */ }
  }
  // 2. Try credentials.json (Claude Code stores key here in older versions)
  const credPath = path.join(claudeDir, 'credentials.json')
  if (fs.existsSync(credPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
      if (creds.claudeApiKey) return creds.claudeApiKey
      if (creds.api_key) return creds.api_key
    } catch { /* ignore */ }
  }
  // 3. Try config.json
  const configPath = path.join(claudeDir, 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.claudeApiKey) return config.claudeApiKey
    } catch { /* ignore */ }
  }
  // 4. Fall back to env var
  return process.env.ANTHROPIC_API_KEY ?? null
}

export function estimateInsightCost(estimatedInputTokens: number, model = INSIGHTS_MODEL): number {
  return calculateCost(model, {
    input_tokens: estimatedInputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: Math.round(estimatedInputTokens * 0.3),
  })
}

export interface InsightResult {
  text: string
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
}

export async function callInsightsApi(
  prompt: string,
  systemPrompt: string,
  apiKey: string | null,
  onChunk?: (text: string) => void
): Promise<InsightResult> {
  // Prefer spawning the Claude CLI (uses Keychain auth automatically, no API key needed)
  // Fall back to Anthropic SDK if CLI is unavailable
  const { result: cliResult, error: cliError } = await tryClaudeCli(prompt, systemPrompt, onChunk)
  if (cliResult) return cliResult

  if (!apiKey) {
    throw new Error(
      cliError
        ? `Claude CLI failed: ${cliError}. Add an API key in Settings, or ensure 'claude' is in your PATH.`
        : 'No Claude API key configured. Add one in Settings or ensure the claude CLI is installed.'
    )
  }
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: INSIGHTS_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
  const costUsd = calculateCost(INSIGHTS_MODEL, {
    input_tokens: response.usage.input_tokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: response.usage.output_tokens,
  })
  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd,
    },
  }
}

async function tryClaudeCli(
  prompt: string,
  systemPrompt: string,
  onChunk?: (text: string) => void
): Promise<{ result: InsightResult | null; error: string }> {
  const { spawn, execFileSync } = await import('child_process')
  const fullPrompt = `${systemPrompt}\n\n${prompt}`

  // Unset CLAUDECODE so the CLI doesn't refuse to run inside another Claude Code session
  const env = { ...process.env }
  delete env.CLAUDECODE
  // Ensure common install locations are in PATH (Electron may inherit a minimal PATH)
  const extraPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.nvm', 'current', 'bin'),
    path.join(os.homedir(), '.volta', 'bin'),
    path.join(os.homedir(), '.fnm', 'current', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ]
  env.PATH = [...extraPaths, env.PATH ?? ''].join(':')

  // Resolve 'claude' to an absolute path so we don't rely on PATH at spawn time
  let claudeBin = 'claude'
  try {
    claudeBin = execFileSync('which', ['claude'], { env, encoding: 'utf8' }).trim() || 'claude'
  } catch { /* claude not in PATH, will try anyway and surface ENOENT */ }

  return new Promise((resolve) => {
    let output = ''
    let stderrOutput = ''
    let inputTokens = 0
    let outputTokens = 0

    const proc = spawn(claudeBin, [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', INSIGHTS_MODEL,
    ], { stdio: ['pipe', 'pipe', 'pipe'], env })

    // Write prompt via stdin — avoids command-line arg length limits and is more reliable
    proc.stdin?.write(fullPrompt)
    proc.stdin?.end()

    // 90-second timeout — prevents analyze/summarize from hanging forever
    const timeout = setTimeout(() => {
      console.error('[claude-cli] timeout after 90s, killing')
      proc.kill()
      resolve({ result: null, error: 'timed out after 90s' })
    }, 90_000)

    proc.stderr?.on('data', (chunk: Buffer) => { stderrOutput += chunk.toString() })
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          // stream-json: assistant messages have content array
          if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
            for (const block of msg.message.content) {
              if (block.type === 'text') {
                output += block.text
                try { if (onChunk) onChunk(block.text) } catch { /* renderer may be gone */ }
              }
            }
          }
          // result message has usage and final text
          if (msg.type === 'result') {
            inputTokens = msg.usage?.input_tokens ?? 0
            outputTokens = msg.usage?.output_tokens ?? 0
            // Use result.result as fallback if we didn't capture streamed text
            if (!output && typeof msg.result === 'string') output = msg.result
          }
        } catch { /* non-JSON line, skip */ }
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timeout)
      const msg = err.message.includes('ENOENT')
        ? `'claude' binary not found — install Claude Code CLI or add it to PATH`
        : err.message
      console.error('[claude-cli] spawn error:', msg)
      resolve({ result: null, error: msg })
    })
    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        const errMsg = stderrOutput.slice(0, 300).trim() || `exit code ${code}`
        console.error(`[claude-cli] exit ${code}; stderr: ${errMsg}`)
        resolve({ result: null, error: errMsg }); return
      }
      if (!output) {
        const errMsg = stderrOutput.slice(0, 200).trim() || 'no output received'
        console.error('[claude-cli] no output; stderr:', errMsg)
        resolve({ result: null, error: errMsg }); return
      }
      resolve({
        result: {
          text: output,
          usage: {
            inputTokens,
            outputTokens,
            costUsd: calculateCost(INSIGHTS_MODEL, {
              input_tokens: inputTokens,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: outputTokens,
            }),
          },
        },
        error: '',
      })
    })
  })
}

export function logLlmUsage(db: Db, record: Omit<LlmUsageRecord, 'id' | 'timestamp'>): void {
  db.prepare(`
    INSERT INTO llm_usage (feature, input_tokens, output_tokens, estimated_cost_usd, session_id)
    VALUES (@feature, @inputTokens, @outputTokens, @estimatedCostUsd, @sessionId)
  `).run({
    feature: record.feature,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostUsd: record.estimatedCostUsd,
    sessionId: record.sessionId ?? null,
  })
}

export function getLlmUsageSummary(db: Db): { totalCostUsd: number; totalCalls: number } {
  const row = db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total, COUNT(*) as cnt FROM llm_usage`
  ).get() as { total: number; cnt: number }
  return { totalCostUsd: row.total, totalCalls: row.cnt }
}

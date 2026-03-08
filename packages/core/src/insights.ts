import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Anthropic from '@anthropic-ai/sdk'
import { Db } from './db'
import { LlmUsageRecord } from './types'
import { calculateCost } from './sessions'

const INSIGHTS_MODEL = 'claude-sonnet-4-6'

export function readClaudeApiKey(claudeDir = path.join(os.homedir(), '.claude')): string | null {
  // Try credentials.json (Claude Code stores key here)
  const credPath = path.join(claudeDir, 'credentials.json')
  if (fs.existsSync(credPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
      if (creds.claudeApiKey) return creds.claudeApiKey
      if (creds.api_key) return creds.api_key
    } catch { /* ignore */ }
  }
  // Try config.json
  const configPath = path.join(claudeDir, 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.claudeApiKey) return config.claudeApiKey
    } catch { /* ignore */ }
  }
  // Fall back to env var (same as Claude Code uses)
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
  apiKey: string
): Promise<InsightResult> {
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

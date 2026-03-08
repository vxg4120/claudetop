import { Db } from './db'
import { querySessions } from './analytics'
import { callInsightsApi, logLlmUsage, readClaudeApiKey } from './insights'
import { StandupReport, ClaudeSession } from './types'

const SYSTEM_PROMPT = `You are a technical assistant summarizing Claude Code agent activity for a developer standup.
Be concise. Focus on outcomes. Use past tense for completed work.
Output ONLY valid JSON — no markdown, no code fences, no explanation.`

function buildStandupPrompt(completed: ClaudeSession[]): string {
  const byProject: Record<string, ClaudeSession[]> = {}
  for (const s of completed) {
    if (!byProject[s.projectSlug]) byProject[s.projectSlug] = []
    byProject[s.projectSlug].push(s)
  }

  const lines = Object.entries(byProject).map(([proj, sessions]) => {
    const totalTokens = sessions.reduce((sum, s) => sum + s.usage.input_tokens + s.usage.output_tokens, 0)
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0)
    const branches = [...new Set(sessions.map((s) => s.gitBranch).filter(Boolean))].join(', ') || 'unknown'
    return `Project: ${proj}\nSessions: ${sessions.length}\nTokens: ${totalTokens}\nCost: $${totalCost.toFixed(4)}\nBranches: ${branches}`
  })

  return `Summarize this Claude Code activity as a standup.

COMPLETED SESSIONS (last 24h):
${lines.join('\n\n') || 'None'}

Return JSON with this exact shape:
{"done": [{"project": "string", "summary": "string", "sessions": 1, "costUsd": 0.01}], "blockers": []}`
}

export async function generateStandup(db: Db): Promise<StandupReport> {
  const apiKey = readClaudeApiKey()
  if (!apiKey) throw new Error('No Claude API key found. Set ANTHROPIC_API_KEY or configure Claude Code.')

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const completed = querySessions(db, { since, limit: 100 })

  const result = await callInsightsApi(buildStandupPrompt(completed), SYSTEM_PROMPT, apiKey)

  logLlmUsage(db, {
    feature: 'standup',
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.costUsd,
    sessionId: null,
  })

  let parsed: { done: unknown[]; blockers: unknown[] } = { done: [], blockers: [] }
  try { parsed = JSON.parse(result.text) } catch { /* use empty */ }

  return {
    generatedAt: new Date(),
    done: (parsed.done ?? []) as StandupReport['done'],
    inProgress: [],
    blockers: (parsed.blockers ?? []) as StandupReport['blockers'],
    llmUsage: {
      timestamp: new Date(),
      feature: 'standup',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.costUsd,
      sessionId: null,
    },
  }
}

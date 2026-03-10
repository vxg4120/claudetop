import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Db } from './db'
import { querySessions } from './analytics'
import { callInsightsApi, logLlmUsage } from './insights'
import { StandupReport, ClaudeSession } from './types'
import { getClaudeProjectsDir } from './sessions'

const execFileAsync = promisify(execFile)

function cwdLabel(sessions: ClaudeSession[], fallback: string): string {
  const cwd = sessions.find((s) => s.cwd)?.cwd
  if (!cwd) return fallback
  return cwd.replace(os.homedir(), '~')
}

function cwdPath(sessions: ClaudeSession[]): string | null {
  return sessions.find((s) => s.cwd)?.cwd ?? null
}

async function getGitLog(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'log', '--oneline', '-8', '--no-merges'], { timeout: 3000 })
    return stdout.trim()
  } catch { return '' }
}

function extractUserPrompts(projectSlug: string, sessionIds: string[]): string[] {
  const projectsDir = getClaudeProjectsDir()
  const prompts: string[] = []

  for (const dir of fs.readdirSync(projectsDir)) {
    if (!dir.includes(encodeURIComponent(projectSlug.replace(/~/g, os.homedir()).replace(/\//g, '')).slice(0, 20)) &&
        !projectSlug.includes(dir.slice(0, 20))) continue
    const projectPath = path.join(projectsDir, dir)
    try {
      if (!fs.statSync(projectPath).isDirectory()) continue
    } catch { continue }

    for (const sessionId of sessionIds) {
      // Validate sessionId is a safe alphanumeric/UUID string before using in file path
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) continue
      const filePath = path.join(projectPath, `${sessionId}.jsonl`)
      if (!fs.existsSync(filePath)) continue
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
      for (const line of lines.slice(0, 30)) {
        try {
          const r = JSON.parse(line)
          if ((r.type === 'human' || r.message?.role === 'user') && Array.isArray(r.message?.content)) {
            const text = r.message.content
              .filter((b: {type: string}) => b.type === 'text')
              .map((b: {text: string}) => b.text)
              .join(' ').trim().slice(0, 300)
            if (text && text.length > 20) prompts.push(text)
          }
        } catch { /* skip */ }
      }
      if (prompts.length >= 5) break
    }
    if (prompts.length > 0) break
  }

  return prompts.slice(0, 5)
}

async function buildStandupPrompt(completed: ClaudeSession[]): Promise<string> {
  const byProject: Record<string, ClaudeSession[]> = {}
  for (const s of completed) {
    if (!byProject[s.projectSlug]) byProject[s.projectSlug] = []
    byProject[s.projectSlug].push(s)
  }

  const sections = await Promise.all(Object.entries(byProject).map(async ([proj, sessions]) => {
    const totalTokens = sessions.reduce((sum, s) => sum + s.usage.input_tokens + s.usage.output_tokens, 0)
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0)
    const branches = [...new Set(sessions.map((s) => s.gitBranch).filter(Boolean))].join(', ') || 'unknown'
    const label = cwdLabel(sessions, proj)
    const cwd = cwdPath(sessions)

    const [gitLog, userPrompts] = await Promise.all([
      cwd ? getGitLog(cwd) : Promise.resolve(''),
      Promise.resolve(extractUserPrompts(proj, sessions.map((s) => s.sessionId))),
    ])

    const lines = [
      `PROJECT: ${label}`,
      `Sessions: ${sessions.length} | Tokens: ${totalTokens.toLocaleString()} | Cost: $${totalCost.toFixed(2)}`,
      `Branches: ${branches}`,
    ]
    if (gitLog) lines.push(`Recent commits:\n${gitLog}`)
    if (userPrompts.length > 0) lines.push(`What the user asked Claude to do:\n${userPrompts.map((p) => `- ${p}`).join('\n')}`)

    return lines.join('\n')
  }))

  return `Summarize Claude Code agent activity for a developer standup. Be specific and actionable.

ACTIVITY (last 24h):
${sections.join('\n\n---\n\n') || 'No sessions found'}

Return JSON with this exact shape (all fields required):
{
  "done": [{"project": "string", "summary": "2-3 specific sentences about what was accomplished", "sessions": 1, "costUsd": 0.01}],
  "nextUp": [{"project": "string", "description": "what appears to be planned or in progress next, based on recent prompts and unfinished work"}],
  "blockers": [{"project": "string", "description": "specific technical blockers, errors, or unresolved issues mentioned"}]
}

If there are no blockers or next steps, return empty arrays. Infer nextUp from the most recent user prompts and any incomplete threads.`
}

const SYSTEM_PROMPT = `You are a technical assistant generating a developer standup from Claude Code session data.
Be specific — name files, features, bugs, and decisions. Avoid vague summaries like "worked on the project".
Output ONLY valid JSON. No markdown, no code fences.`

export async function generateStandup(db: Db, onChunk?: (text: string) => void): Promise<StandupReport> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const completed = querySessions(db, { since, limit: 100 })

  const prompt = await buildStandupPrompt(completed)
  const result = await callInsightsApi(prompt, SYSTEM_PROMPT, null, onChunk)

  logLlmUsage(db, {
    feature: 'standup',
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.costUsd,
    sessionId: null,
  })

  let parsed: { done: unknown[]; nextUp: unknown[]; blockers: unknown[] } = { done: [], nextUp: [], blockers: [] }
  try {
    const text = result.text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? text)
  } catch { /* use empty */ }

  return {
    generatedAt: new Date(),
    done: (parsed.done ?? []) as StandupReport['done'],
    nextUp: (parsed.nextUp ?? []) as StandupReport['nextUp'],
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

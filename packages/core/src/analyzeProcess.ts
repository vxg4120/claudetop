import * as fs from 'fs'
import * as path from 'path'
import { callInsightsApi } from './insights'
import { getClaudeProjectsDir } from './sessions'

export interface ProcessAnalysis {
  assessment: string   // short verdict: "safe" | "likely stuck" | "runaway loop" | etc.
  explanation: string  // 2-3 sentences
  recommendation: 'leave' | 'kill' | 'investigate'
}

function findRecentSessionSummary(cwd: string): string | null {
  try {
    const projectsDir = getClaudeProjectsDir()
    // Match project dir from cwd (encoded as URL path)
    const encoded = encodeURIComponent(cwd).replace(/%2F/g, '%2F')
    for (const dir of fs.readdirSync(projectsDir)) {
      const decoded = decodeURIComponent(dir)
      if (decoded === cwd || decoded === `/${cwd}` || cwd.endsWith(decoded.replace(/^\//, ''))) {
        const projectPath = path.join(projectsDir, dir)
        const files = fs.readdirSync(projectPath)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => ({ f, mtime: fs.statSync(path.join(projectPath, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
        if (!files[0]) return null

        const filePath = path.join(projectPath, files[0].f)
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
        const recent = lines.slice(-20)
        const texts: string[] = []
        for (const line of recent) {
          try {
            const r = JSON.parse(line)
            if (r.message?.role === 'user' && Array.isArray(r.message?.content)) {
              const text = r.message.content
                .filter((b: {type: string}) => b.type === 'text')
                .map((b: {text: string}) => b.text)
                .join(' ').slice(0, 200)
              if (text) texts.push(`USER: ${text}`)
            }
          } catch { /* skip */ }
        }
        return texts.slice(-5).join('\n') || null
      }
    }
  } catch { /* best-effort */ }
  return null
}

export async function analyzeRunawayProcess(p: {
  pid: number
  cwd: string
  args: string[]
  runtime: number
  memory: { rss: number }
  cpu: number
}): Promise<ProcessAnalysis> {
  const runtimeHours = (p.runtime / 3600).toFixed(1)
  const memMb = Math.round(p.memory.rss / 1024 / 1024)
  const recentActivity = findRecentSessionSummary(p.cwd)

  const prompt = `A Claude Code agent process has been flagged as potentially runaway.

Process info:
- CWD: ${p.cwd}
- Runtime: ${runtimeHours} hours
- Memory: ${memMb} MB RSS
- CPU: ${p.cpu.toFixed(1)}%
- Args: ${p.args.slice(0, 3).join(' ') || '(none)'}
${recentActivity ? `\nRecent session activity:\n${recentActivity}` : ''}

Is this process likely stuck in a loop, legitimately working, or just an old idle session?

Respond with JSON only:
{"assessment": "one of: legitimately working | likely idle | possibly stuck | runaway loop", "explanation": "2 sentences max", "recommendation": "one of: leave | investigate | kill"}`

  const system = 'You analyze Claude Code agent processes to determine if they are runaway or working normally. Be concise. Output only valid JSON.'

  try {
    const result = await callInsightsApi(prompt, system, null)
    // The response might be raw JSON or JSON embedded in text
    const text = result.text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch?.[0] ?? text)
    return {
      assessment: parsed.assessment ?? 'unknown',
      explanation: parsed.explanation ?? '',
      recommendation: parsed.recommendation ?? 'investigate',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      assessment: 'error',
      explanation: `Analysis failed: ${msg}`,
      recommendation: 'investigate',
    }
  }
}

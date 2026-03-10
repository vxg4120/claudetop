import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { callInsightsApi } from './insights'
import { getClaudeProjectsDir } from './sessions'

interface JsonlRecord {
  type?: string
  message?: {
    role?: string
    content?: unknown
    usage?: unknown
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: unknown) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
      .map((b: unknown) => (b as Record<string, unknown>).text as string)
      .join(' ')
  }
  return ''
}

function findSessionFile(sessionId: string): string | null {
  const projectsDir = getClaudeProjectsDir()
  if (!fs.existsSync(projectsDir)) return null
  for (const projectDir of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, projectDir, `${sessionId}.jsonl`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export async function summarizeSession(sessionId: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error('Invalid session ID format')
  const filePath = findSessionFile(sessionId)
  if (!filePath) throw new Error(`Session file not found for ${sessionId}`)

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)

  const turns: string[] = []
  for (const line of lines) {
    let r: JsonlRecord
    try { r = JSON.parse(line) } catch { continue }
    if (r.type === 'human' || r.message?.role === 'user') {
      const text = extractText(r.message?.content).trim().slice(0, 300)
      if (text) turns.push(`USER: ${text}`)
    } else if (r.type === 'assistant' || r.message?.role === 'assistant') {
      const text = extractText(r.message?.content).trim().slice(0, 300)
      if (text) turns.push(`CLAUDE: ${text}`)
    }
    if (turns.length >= 20) break // keep prompt short
  }

  if (turns.length === 0) return 'No conversation content found in this session.'

  const projectDir = path.basename(path.dirname(filePath))
  const cwd = decodeURIComponent(projectDir).replace(/^\//, '')
  const project = cwd.split('/').slice(-2).join('/') || cwd

  const prompt = `Session in ${project}. Summarize what was accomplished in 2-3 sentences:

${turns.join('\n')}

Be specific about what was built, fixed, or changed. Focus on outcomes.`

  const system = 'You are summarizing a Claude Code session. Be concise and specific. 2-3 sentences max.'

  const result = await callInsightsApi(prompt, system, null)
  return result.text.trim()
}

export function findRecentSessionFile(projectSlug: string): string | null {
  const projectsDir = getClaudeProjectsDir()
  const projectPath = path.join(projectsDir, projectSlug)
  if (!fs.existsSync(projectPath)) return null
  const files = fs.readdirSync(projectPath)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(projectPath, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files[0] ? path.join(projectPath, files[0].f) : null
}

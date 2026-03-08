import * as path from 'path'
import { Db } from './db'
import { parseSessionFile, getClaudeProjectsDir, listSessionFiles } from './sessions'
import { ClaudeSession } from './types'

function sessionToRow(s: ClaudeSession): Record<string, unknown> {
  return {
    session_id:             s.sessionId,
    project_slug:           s.projectSlug,
    cwd:                    s.cwd,
    git_branch:             s.gitBranch ?? null,
    model:                  s.model ?? null,
    started_at:             s.startedAt?.toISOString() ?? null,
    ended_at:               s.endedAt?.toISOString() ?? null,
    duration_seconds:       s.durationSeconds ?? null,
    input_tokens:           s.usage.input_tokens,
    cache_creation_tokens:  s.usage.cache_creation_input_tokens,
    cache_read_tokens:      s.usage.cache_read_input_tokens,
    output_tokens:          s.usage.output_tokens,
    estimated_cost_usd:     s.estimatedCostUsd,
    is_sidechain:           s.isSidechain ? 1 : 0,
    parent_session_id:      s.parentSessionId ?? null,
    permission_mode:        s.permissionMode ?? null,
  }
}

const UPSERT_SQL = `
  INSERT OR REPLACE INTO sessions (
    session_id, project_slug, cwd, git_branch, model,
    started_at, ended_at, duration_seconds,
    input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
    estimated_cost_usd, is_sidechain, parent_session_id, permission_mode,
    summary, indexed_at
  ) VALUES (
    @session_id, @project_slug, @cwd, @git_branch, @model,
    @started_at, @ended_at, @duration_seconds,
    @input_tokens, @cache_creation_tokens, @cache_read_tokens, @output_tokens,
    @estimated_cost_usd, @is_sidechain, @parent_session_id, @permission_mode,
    (SELECT summary FROM sessions WHERE session_id = @session_id),
    datetime('now')
  )
`

export function upsertSession(db: Db, filePath: string): boolean {
  const session = parseSessionFile(filePath)
  if (!session) return false
  db.prepare(UPSERT_SQL).run(sessionToRow(session))
  return true
}

export function buildIndex(db: Db, claudeDir = getClaudeProjectsDir()): number {
  const files = listSessionFiles(claudeDir)
  const insert = db.transaction((paths: string[]) => {
    let count = 0
    for (const p of paths) { if (upsertSession(db, p)) count++ }
    return count
  })
  return insert(files)
}

export function startWatcher(db: Db, claudeDir = getClaudeProjectsDir()): () => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chokidar = require('chokidar')
  const watcher = chokidar.watch(`${claudeDir}/**/*.jsonl`, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  })
  watcher.on('add', (f: string) => upsertSession(db, f))
  watcher.on('change', (f: string) => upsertSession(db, f))
  return () => watcher.close()
}

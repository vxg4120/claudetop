import * as fs from 'fs'
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

  // Re-index any file that is new OR whose mtime is newer than its indexed_at timestamp,
  // so sessions that accumulated tokens while the app was not running are refreshed.
  const indexedAt = new Map(
    (db.prepare('SELECT session_id, indexed_at FROM sessions').all() as { session_id: string; indexed_at: string }[])
      .map((r) => [r.session_id, new Date(r.indexed_at).getTime()])
  )

  const MAX_FILE_BYTES = 50 * 1024 * 1024 // skip files > 50 MB to avoid OOM

  const staleFiles = files.filter((f) => {
    try {
      const stat = fs.statSync(f)
      if (stat.size > MAX_FILE_BYTES) return false
      const id = path.basename(f, '.jsonl')
      const lastIndexed = indexedAt.get(id)
      if (!lastIndexed) return true // new file
      return stat.mtimeMs > lastIndexed
    } catch {
      return false
    }
  })
  if (staleFiles.length === 0) return 0

  // Process in batches to avoid OOM with large initial indexes (9000+ subagent files)
  const BATCH_SIZE = 200
  let total = 0
  const insertBatch = db.transaction((paths: string[]) => {
    let count = 0
    for (const p of paths) {
      try {
        if (upsertSession(db, p)) count++
      } catch { /* skip unparseable files */ }
    }
    return count
  })
  for (let i = 0; i < staleFiles.length; i += BATCH_SIZE) {
    total += insertBatch(staleFiles.slice(i, i + BATCH_SIZE))
  }
  return total
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

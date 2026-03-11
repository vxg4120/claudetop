import * as fs from 'fs'
import * as path from 'path'
import { Db } from './db'
import { parseSessionFile, parseSessionFileStreamed, getClaudeProjectsDir, listSessionFiles } from './sessions'
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
  try {
    const stat = fs.statSync(filePath)
    // For large files changed by the watcher, parse synchronously but they're rare in live sessions
    const session = stat.size > 10 * 1024 * 1024
      ? null // skip huge live files; they'll be streamed on next full buildIndex
      : parseSessionFile(filePath)
    if (!session) return false
    db.prepare(UPSERT_SQL).run(sessionToRow(session))
    return true
  } catch {
    return false
  }
}

// Sync upsert for small files (used by watcher)
function upsertRow(db: Db, session: ClaudeSession): void {
  db.prepare(UPSERT_SQL).run(sessionToRow(session))
}

export async function buildIndex(db: Db, claudeDir = getClaudeProjectsDir()): Promise<number> {
  const files = listSessionFiles(claudeDir)

  const indexedAt = new Map(
    (db.prepare('SELECT session_id, indexed_at FROM sessions').all() as { session_id: string; indexed_at: string }[])
      // Append ' UTC' so JS parses SQLite's datetime('now') string as UTC, not local time.
      .map((r) => [r.session_id, new Date(r.indexed_at + ' UTC').getTime()])
  )

  const STREAM_THRESHOLD = 10 * 1024 * 1024 // stream files > 10 MB

  const staleFiles: Array<{ path: string; stream: boolean }> = []
  for (const f of files) {
    try {
      const stat = fs.statSync(f)
      const id = path.basename(f, '.jsonl')
      const lastIndexed = indexedAt.get(id)
      if (lastIndexed && stat.mtimeMs <= lastIndexed) continue
      staleFiles.push({ path: f, stream: stat.size > STREAM_THRESHOLD })
    } catch { /* skip inaccessible files */ }
  }
  if (staleFiles.length === 0) return 0

  // Separate small (sync) and large (streamed) files
  const small = staleFiles.filter((f) => !f.stream).map((f) => f.path)
  const large = staleFiles.filter((f) => f.stream).map((f) => f.path)

  // Batch-insert small files synchronously
  const BATCH_SIZE = 200
  let total = 0
  const insertBatch = db.transaction((paths: string[]) => {
    let count = 0
    for (const p of paths) {
      try {
        const session = parseSessionFile(p)
        if (session) { upsertRow(db, session); count++ }
      } catch { /* skip */ }
    }
    return count
  })
  for (let i = 0; i < small.length; i += BATCH_SIZE) {
    total += insertBatch(small.slice(i, i + BATCH_SIZE))
  }

  // Stream large files one at a time to stay memory-safe
  for (const p of large) {
    try {
      const session = await parseSessionFileStreamed(p)
      if (session) { upsertRow(db, session); total++ }
    } catch { /* skip */ }
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

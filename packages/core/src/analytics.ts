import { Db } from './db'
import { ClaudeSession, SessionFilter, CostReport } from './types'

function rowToSession(row: Record<string, unknown>): ClaudeSession {
  return {
    sessionId:       row.session_id as string,
    projectSlug:     row.project_slug as string,
    cwd:             row.cwd as string,
    gitBranch:       row.git_branch as string | null,
    model:           row.model as string | null,
    startedAt:       row.started_at ? new Date(row.started_at as string) : null,
    endedAt:         row.ended_at ? new Date(row.ended_at as string) : null,
    durationSeconds: row.duration_seconds as number | null,
    usage: {
      input_tokens:                row.input_tokens as number,
      cache_creation_input_tokens: row.cache_creation_tokens as number,
      cache_read_input_tokens:     row.cache_read_tokens as number,
      output_tokens:               row.output_tokens as number,
    },
    estimatedCostUsd: row.estimated_cost_usd as number,
    isSidechain:      (row.is_sidechain as number) === 1,
    parentSessionId:  row.parent_session_id as string | null,
    summary:          row.summary as string | null,
    permissionMode:   row.permission_mode as string | null,
  }
}

export function querySessions(db: Db, filter: SessionFilter): ClaudeSession[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter.project) {
    conditions.push('project_slug LIKE @project')
    params.project = `%${filter.project}%`
  }
  if (filter.since) {
    conditions.push('started_at >= @since')
    params.since = filter.since.toISOString()
  }
  if (filter.until) {
    conditions.push('started_at <= @until')
    params.until = filter.until.toISOString()
  }
  if (filter.model) {
    conditions.push('model = @model')
    params.model = filter.model
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter.limit ? `LIMIT ${filter.limit}` : ''
  const sql = `SELECT * FROM sessions ${where} ORDER BY started_at DESC ${limit}`
  const rows = db.prepare(sql).all(params) as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function getCostReport(db: Db, filter: SessionFilter): CostReport {
  const since = filter.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const until = filter.until ?? new Date()
  const conditions = ['(started_at >= @since OR started_at IS NULL)', 'started_at <= @until']
  const params: Record<string, unknown> = {
    since: since.toISOString(),
    until: until.toISOString(),
  }
  if (filter.project) {
    conditions.push('project_slug LIKE @project')
    params.project = `%${filter.project}%`
  }
  const where = `WHERE ${conditions.join(' AND ')}`

  const total = db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM sessions ${where}`
  ).get(params) as { total: number }

  const byProject = db.prepare(`
    SELECT project_slug as project, SUM(estimated_cost_usd) as usd, COUNT(*) as sessions
    FROM sessions ${where} GROUP BY project_slug ORDER BY usd DESC
  `).all(params) as Array<{ project: string; usd: number; sessions: number }>

  const byModel = db.prepare(`
    SELECT model, SUM(estimated_cost_usd) as usd, COUNT(*) as sessions
    FROM sessions ${where} GROUP BY model ORDER BY usd DESC
  `).all(params) as Array<{ model: string; usd: number; sessions: number }>

  const byDay = db.prepare(`
    SELECT date(started_at, 'localtime') as date, SUM(estimated_cost_usd) as usd, COUNT(*) as sessions
    FROM sessions ${where} GROUP BY date(started_at, 'localtime') ORDER BY date ASC
  `).all(params) as Array<{ date: string; usd: number; sessions: number }>

  return { totalUsd: total.total, byProject, byModel, byDay, period: { from: since, to: until } }
}

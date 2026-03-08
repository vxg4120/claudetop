import { openDb, closeDb, buildIndex, querySessions } from '@claudetop/core'
import chalk from 'chalk'
import { formatRuntime } from '../utils/format.js'

interface SessionsOptions {
  project?: string
  since?: string
  json?: boolean
  limit?: string
}

function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(d|w|m)$/)
  if (!match) return new Date(since)
  const [, n, unit] = match
  const ms = parseInt(n) * ({ d: 86400000, w: 604800000, m: 2592000000 } as Record<string, number>)[unit]
  return new Date(Date.now() - ms)
}

export async function sessionsCommand(sessionId: string | undefined, options: SessionsOptions) {
  const db = openDb()
  buildIndex(db)

  if (sessionId) {
    const all = querySessions(db, { limit: 50000 })
    const session = all.find((s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId))
    closeDb(db)
    if (!session) { console.error(chalk.red(`Session not found: ${sessionId}`)); process.exit(1) }
    if (options.json) { console.log(JSON.stringify(session, null, 2)); return }
    console.log(chalk.bold('\nSession Detail'))
    console.log(`  ID:       ${session.sessionId}`)
    console.log(`  Project:  ${session.projectSlug}`)
    console.log(`  CWD:      ${session.cwd}`)
    console.log(`  Branch:   ${session.gitBranch ?? '—'}`)
    console.log(`  Model:    ${session.model ?? '—'}`)
    console.log(`  Started:  ${session.startedAt?.toLocaleString() ?? '—'}`)
    console.log(`  Duration: ${session.durationSeconds ? formatRuntime(session.durationSeconds) : '—'}`)
    console.log(`  Tokens:   in=${session.usage.input_tokens.toLocaleString()} out=${session.usage.output_tokens.toLocaleString()}`)
    console.log(`  Cost:     ${chalk.green('$' + session.estimatedCostUsd.toFixed(4))}`)
    return
  }

  const limit = options.limit ? parseInt(options.limit) : 20
  const since = options.since ? parseSince(options.since) : undefined
  const sessions = querySessions(db, { project: options.project, since, limit })
  closeDb(db)

  if (options.json) { console.log(JSON.stringify(sessions, null, 2)); return }
  if (!sessions.length) { console.log(chalk.gray('No sessions found.')); return }

  console.log(chalk.gray(`\n  ${'ID'.padEnd(10)} ${'PROJECT'.padEnd(22)} ${'MODEL'.padEnd(22)} ${'DUR'.padEnd(8)} ${'COST'.padEnd(9)} STARTED`))
  for (const s of sessions) {
    const id = s.sessionId.slice(0, 8)
    const proj = s.projectSlug.slice(0, 20).padEnd(22)
    const model = (s.model ?? '—').slice(0, 20).padEnd(22)
    const dur = (s.durationSeconds ? formatRuntime(s.durationSeconds) : '—').padEnd(8)
    const cost = ('$' + s.estimatedCostUsd.toFixed(4)).padEnd(9)
    const started = s.startedAt ? s.startedAt.toLocaleDateString() : '—'
    console.log(`  ${chalk.cyan(id.padEnd(10))} ${proj} ${chalk.yellow(model)} ${dur} ${chalk.green(cost)} ${chalk.gray(started)}`)
  }
}

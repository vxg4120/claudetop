import { openDb, closeDb, buildIndex, getCostReport } from '@claudetop/core'
import chalk from 'chalk'

interface ReportOptions { period?: string; project?: string; json?: boolean }

export async function reportCommand(options: ReportOptions) {
  const db = openDb()
  buildIndex(db)

  const periodMs: Record<string, number> = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 }
  const ms = periodMs[options.period ?? 'week'] ?? periodMs.week
  const since = new Date(Date.now() - ms)
  const report = getCostReport(db, { since, project: options.project })
  closeDb(db)

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return }

  const totalSessions = report.byProject.reduce((s, p) => s + p.sessions, 0)
  console.log(chalk.bold(`\n  Cost Report — last ${options.period ?? 'week'}`))
  console.log(`  Total: ${chalk.green('$' + report.totalUsd.toFixed(4))} · ${totalSessions} sessions\n`)

  if (report.byProject.length) {
    console.log(chalk.gray('  By Project:'))
    for (const p of report.byProject) {
      console.log(`    ${p.project.padEnd(28)} ${chalk.green(('$' + p.usd.toFixed(4)).padEnd(12))} ${p.sessions} sessions`)
    }
  }
  if (report.byModel.length) {
    console.log(chalk.gray('\n  By Model:'))
    for (const m of report.byModel) {
      console.log(`    ${(m.model ?? '—').padEnd(28)} ${chalk.yellow(('$' + m.usd.toFixed(4)).padEnd(12))} ${m.sessions} sessions`)
    }
  }
}

import { openDb, closeDb, buildIndex, querySessions, getClaudeProjectsDir } from '@claudetop/core'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import * as readline from 'readline'

function confirm(q: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, (a) => { rl.close(); resolve(a.toLowerCase().startsWith('y')) })
  })
}

export async function pruneCommand(options: { dryRun?: boolean }) {
  const db = openDb()
  buildIndex(db)
  const sessions = querySessions(db, { limit: 50000 })
  const claudeDir = getClaudeProjectsDir()
  const orphaned: string[] = []

  for (const s of sessions) {
    let found = false
    if (fs.existsSync(claudeDir)) {
      for (const dir of fs.readdirSync(claudeDir)) {
        if (fs.existsSync(path.join(claudeDir, dir, `${s.sessionId}.jsonl`))) { found = true; break }
      }
    }
    if (!found) orphaned.push(s.sessionId)
  }
  closeDb(db)

  if (!orphaned.length) { console.log(chalk.green('  Nothing to prune.')); return }

  console.log(chalk.bold(`\n  Found ${orphaned.length} orphaned session(s) in DB`))
  if (options.dryRun) { console.log(chalk.yellow('  Dry run — no changes made.')); return }

  const ok = await confirm(`\n  Remove ${orphaned.length} orphaned session(s) from DB? [y/N] `)
  if (!ok) { console.log(chalk.gray('  Cancelled.')); return }

  const db2 = openDb()
  const stmt = db2.prepare('DELETE FROM sessions WHERE session_id = ?')
  for (const id of orphaned) stmt.run(id)
  closeDb(db2)
  console.log(chalk.green(`\n  Pruned ${orphaned.length} session(s).`))
}

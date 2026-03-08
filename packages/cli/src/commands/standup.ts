import { openDb, closeDb, buildIndex, generateStandup, estimateInsightCost, getLlmUsageSummary } from '@claudetop/core'
import chalk from 'chalk'
import * as readline from 'readline'

interface StandupOptions { yes?: boolean; json?: boolean }

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => { rl.close(); resolve(a.toLowerCase().startsWith('y')) })
  })
}

export async function standupCommand(options: StandupOptions) {
  const db = openDb()
  buildIndex(db)

  const estimatedCost = estimateInsightCost(2000)
  const usage = getLlmUsageSummary(db)

  if (!options.yes) {
    console.log(chalk.bold('\n  Agent Standup'))
    console.log(`  Estimated cost: ${chalk.yellow('~$' + estimatedCost.toFixed(4))}`)
    console.log(`  Total claudetop LLM spend: ${chalk.gray('$' + usage.totalCostUsd.toFixed(4))} (${usage.totalCalls} calls)`)
    const ok = await confirm('\n  Generate? [y/N] ')
    if (!ok) { console.log(chalk.gray('  Cancelled.')); closeDb(db); return }
  }

  console.log(chalk.gray('\n  Generating...'))
  let report
  try {
    report = await generateStandup(db)
  } catch (err: unknown) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`))
    closeDb(db); process.exit(1)
  }
  closeDb(db)

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return }

  console.log(chalk.bold('\n  📋 Agent Standup — ' + new Date().toLocaleDateString()))

  if (report.done.length) {
    console.log(chalk.green('\n  ✅ Done (last 24h)'))
    for (const d of report.done) {
      console.log(`    ${chalk.cyan(d.project.padEnd(18))} ${d.summary}  ${chalk.gray('$' + d.costUsd.toFixed(4))}`)
    }
  } else {
    console.log(chalk.gray('\n  No completed sessions in last 24h.'))
  }

  if (report.blockers.length) {
    console.log(chalk.red('\n  ⚠️  Blockers'))
    for (const b of report.blockers) {
      console.log(`    ${chalk.cyan(b.project.padEnd(18))} ${b.description}`)
    }
  }

  const used = report.llmUsage.inputTokens + report.llmUsage.outputTokens
  console.log(chalk.gray(`\n  💰 Used ~${used} tokens ($${report.llmUsage.estimatedCostUsd.toFixed(4)})`))
}

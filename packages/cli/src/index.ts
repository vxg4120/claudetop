#!/usr/bin/env node
import { Command } from 'commander'
import { listCommand } from './commands/list.js'
import { killCommand, killAllCommand } from './commands/kill.js'
import { inspectCommand } from './commands/inspect.js'
import { scanCommand } from './commands/scan.js'
import { logsCommand } from './commands/logs.js'
import { watchCommand } from './commands/watch.js'
import { sessionsCommand } from './commands/sessions.js'
import { reportCommand } from './commands/report.js'
import { standupCommand } from './commands/standup.js'
import { pruneCommand } from './commands/prune.js'

const program = new Command()

program
  .name('claudetop')
  .description('Claude CLI process manager')
  .version('0.1.0')

program
  .command('list', { isDefault: true })
  .description('List all Claude processes')
  .option('--json', 'Output as JSON')
  .action((options) => listCommand(options))

program
  .command('watch')
  .description('Live-refreshing process list')
  .action(() => watchCommand())

program
  .command('inspect <pid>')
  .description('Detailed view of a process')
  .action((pid) => inspectCommand(parseInt(pid, 10)))

program
  .command('kill <pid>')
  .description('Kill a Claude process')
  .option('--force', 'Use SIGKILL instead of SIGTERM')
  .action((pid, options) => killCommand(parseInt(pid, 10), options))

program
  .command('killall')
  .description('Kill all Claude processes')
  .action(() => killAllCommand())

program
  .command('logs <pid>')
  .description('Tail logs for a process')
  .action((pid) => logsCommand(parseInt(pid, 10)))

program
  .command('scan [pid]')
  .description('Security scan Claude processes')
  .option('--sudo', 'Hint: re-run with sudo for elevated access')
  .action((pid, options) => {
    if (options.sudo) {
      console.log('Re-run this command prefixed with sudo for elevated scan.')
    }
    scanCommand(pid ? parseInt(pid, 10) : undefined)
  })

program
  .command('sessions [sessionId]')
  .description('Browse historical Claude sessions')
  .option('--project <name>', 'Filter by project name')
  .option('--since <period>', 'e.g. 7d, 2w, 1m')
  .option('--limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action((sessionId, options) => sessionsCommand(sessionId, options))

program
  .command('report')
  .description('Cost and usage report')
  .option('--period <period>', 'day | week | month', 'week')
  .option('--project <name>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action((options) => reportCommand(options))

program
  .command('standup')
  .description('AI-powered agent standup (done/doing/blockers)')
  .option('--yes', 'Skip cost confirmation')
  .option('--json', 'Output as JSON')
  .action((options) => standupCommand(options))

program
  .command('prune')
  .description('Remove orphaned session records from DB')
  .option('--dry-run', 'Show what would be removed without removing')
  .action((options) => pruneCommand(options))

program.parse()

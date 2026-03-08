#!/usr/bin/env node
import { Command } from 'commander'
import { listCommand } from './commands/list'
import { killCommand, killAllCommand } from './commands/kill'
import { inspectCommand } from './commands/inspect'
import { scanCommand } from './commands/scan'
import { logsCommand } from './commands/logs'

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
  .action(() => {
    console.log('watch mode coming in next task')
  })

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

program.parse()

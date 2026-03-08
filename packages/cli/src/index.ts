#!/usr/bin/env node
import { Command } from 'commander'
import { listCommand } from './commands/list'

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

program.parse()

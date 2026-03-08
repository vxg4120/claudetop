import { listProcesses } from '@claudetop/core'
import { formatMemory, formatRuntime, formatStatus } from '../utils/format.js'

export async function listCommand(options: { json?: boolean } = {}) {
  const processes = await listProcesses()

  if (options.json) {
    console.log(JSON.stringify(processes, null, 2))
    return
  }

  if (processes.length === 0) {
    console.log('No Claude processes found.')
    return
  }

  const header = ['PID', 'MEM', 'CPU', 'RUNTIME', 'STATUS', 'ARGS']
  const rows = processes.map((p) => [
    String(p.pid),
    formatMemory(p.memory.rss),
    `${p.cpu.toFixed(1)}%`,
    formatRuntime(p.runtime),
    formatStatus(p.isRunaway, p.status),
    p.args.join(' ').substring(0, 40) || '—',
  ])

  // Calculate column widths
  const cols = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  )

  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(cols[i])).join('  ')

  console.log(fmt(header))
  console.log(cols.map((w) => '-'.repeat(w)).join('  '))

  rows.forEach((row, idx) => {
    const isRunaway = processes[idx].isRunaway
    const line = fmt(row)
    if (isRunaway) {
      console.log(`\x1b[31m${line}\x1b[0m`) // red for runaway
    } else {
      console.log(line)
    }
  })
}

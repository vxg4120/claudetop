import { listProcesses, checkPermissions } from '@claudetop/core'
import { formatMemory, formatRuntime } from '../utils/format.js'

export async function inspectCommand(pid: number) {
  const [processes, permissions] = await Promise.all([listProcesses(), checkPermissions()])
  const target = processes.find((p) => p.pid === pid)

  if (!target) {
    console.error(`No Claude process found with PID ${pid}`)
    process.exit(1)
  }

  console.log(`\n── PID ${target.pid} ──────────────────────`)
  console.log(`  Status:    ${target.status}${target.isRunaway ? ' ⚠ RUNAWAY' : ''}`)
  console.log(`  Memory:    ${formatMemory(target.memory.rss)} RSS / ${formatMemory(target.memory.vms)} VMS`)
  console.log(`  CPU:       ${target.cpu.toFixed(1)}%`)
  console.log(`  Runtime:   ${formatRuntime(target.runtime)}`)
  console.log(`  CWD:       ${target.cwd}`)
  console.log(`  Args:      ${target.args.join(' ') || '(none)'}`)
  console.log(`  PPID:      ${target.ppid}`)

  if (!permissions.canReadNetworkConnections) {
    console.log('\n  🔒 Network connections: requires elevated access')
  }
  if (!permissions.canReadFileDescriptors) {
    console.log('  🔒 File descriptors: requires elevated access')
  }
  console.log('')
}

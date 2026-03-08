import * as readline from 'readline'
import { listProcesses, killProcess } from '@claudetop/core'

export async function killCommand(pid: number, options: { force?: boolean } = {}) {
  const signal = options.force ? 'SIGKILL' : 'SIGTERM'

  const processes = await listProcesses()
  const target = processes.find((p) => p.pid === pid)

  if (!target) {
    console.error(`No Claude process found with PID ${pid}`)
    process.exit(1)
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise<void>((resolve) => {
    rl.question(`Kill PID ${pid} (${signal})? [y/N] `, (answer) => {
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.')
        process.exit(0)
      }
      resolve()
    })
  })

  try {
    killProcess(pid, signal)
    console.log(`Sent ${signal} to PID ${pid}`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Failed to kill PID ${pid}: ${message}`)
    process.exit(1)
  }
}

export async function killAllCommand() {
  const processes = await listProcesses()

  if (processes.length === 0) {
    console.log('No Claude processes found.')
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise<void>((resolve) => {
    rl.question(`Kill ALL ${processes.length} Claude process(es)? [y/N] `, (answer) => {
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.')
        process.exit(0)
      }
      resolve()
    })
  })

  for (const p of processes) {
    try {
      killProcess(p.pid, 'SIGTERM')
      console.log(`Sent SIGTERM to PID ${p.pid}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Failed to kill PID ${p.pid}: ${message}`)
    }
  }
}

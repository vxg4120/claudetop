import { tailLog } from '@claudetop/core'

export function logsCommand(pid: number) {
  console.log(`Tailing logs for PID ${pid}... (Ctrl+C to stop)\n`)

  const tailer = tailLog(pid)

  tailer.on('data', (chunk: string) => process.stdout.write(chunk))
  tailer.on('error', (err: Error) => {
    console.error(`Error tailing logs: ${err.message}`)
    process.exit(1)
  })
  tailer.on('end', () => {
    console.log('\nProcess ended.')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    tailer.dispose()
    process.exit(0)
  })
}

import { EventEmitter } from 'events'
import * as pty from 'node-pty'

export interface LogTailer extends EventEmitter {
  dispose(): void
}

/**
 * Tails output of a Claude process by PID using node-pty.
 * Emits 'data' events with string chunks and 'error' on failure.
 * Call dispose() to stop tailing.
 *
 * Strategy:
 * - Linux: tail -f /proc/<pid>/fd/1 (stdout file descriptor)
 * - macOS: tail the most recent log file from ~/.claude/logs/
 */
export function tailLog(pid: number): LogTailer {
  const emitter = new EventEmitter() as LogTailer
  let disposed = false
  let ptyProcess: pty.IPty | null = null

  const platform = process.platform

  try {
    if (platform === 'linux') {
      ptyProcess = pty.spawn('tail', ['-f', `/proc/${pid}/fd/1`], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME ?? '/',
        env: process.env as Record<string, string>,
      })
    } else {
      // macOS: find the most recent log file in ~/.claude/logs/
      const logDir = `${process.env.HOME}/.claude/logs/`
      ptyProcess = pty.spawn(
        'sh',
        ['-c', `ls -t "${logDir}"*.log 2>/dev/null | head -1 | xargs tail -f 2>/dev/null || echo "No log file found for PID ${pid}"`],
        {
          name: 'xterm-color',
          cols: 80,
          rows: 30,
          cwd: process.env.HOME ?? '/',
          env: process.env as Record<string, string>,
        }
      )
    }

    ptyProcess.onData((data) => {
      if (!disposed) emitter.emit('data', data)
    })

    ptyProcess.onExit(() => {
      if (!disposed) emitter.emit('end')
    })
  } catch (err) {
    // Emit async so callers have time to attach error listener
    setImmediate(() => emitter.emit('error', err))
  }

  emitter.dispose = () => {
    disposed = true
    try {
      ptyProcess?.kill()
    } catch {
      // process may already be dead
    }
  }

  return emitter
}

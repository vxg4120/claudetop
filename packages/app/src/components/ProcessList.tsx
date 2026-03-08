import React from 'react'
import { ClaudeProcess } from '../hooks/useProcesses'

function formatMemory(bytes: number) {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function formatRuntime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

interface Props {
  processes: ClaudeProcess[]
  selected: ClaudeProcess | null
  onSelect: (p: ClaudeProcess) => void
}

export function ProcessList({ processes, selected, onSelect }: Props) {
  return (
    <div className="process-table">
      <table>
        <thead>
          <tr>
            <th>PID</th><th>MEM</th><th>CPU</th><th>RUNTIME</th><th>STATUS</th><th>ARGS</th>
          </tr>
        </thead>
        <tbody>
          {processes.length === 0 ? (
            <tr><td colSpan={6} className="empty-state">No Claude processes found</td></tr>
          ) : (
            processes.map((p) => (
              <tr
                key={p.pid}
                className={`${p.isRunaway ? 'runaway' : ''} ${selected?.pid === p.pid ? 'selected' : ''}`}
                onClick={() => onSelect(p)}
              >
                <td>{p.pid}</td>
                <td>{formatMemory(p.memory.rss)}</td>
                <td>{p.cpu.toFixed(1)}%</td>
                <td>{formatRuntime(p.runtime)}</td>
                <td>{p.isRunaway ? 'RUNAWAY' : 'ok'}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.args.join(' ') || '\u2014'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

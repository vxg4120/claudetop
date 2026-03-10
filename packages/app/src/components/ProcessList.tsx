import React, { useState } from 'react'
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

type SortKey = 'project' | 'mem' | 'cpu' | 'runtime' | 'status'

interface Props {
  processes: ClaudeProcess[]
  selected: ClaudeProcess | null
  onSelect: (p: ClaudeProcess) => void
}

export function ProcessList({ processes, selected, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('runtime')
  const [sortAsc, setSortAsc] = useState(false)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const claudePids = new Set(processes.filter((p) => !p.isChild).map((p) => p.pid))

  // Sort only the parent processes; children stay attached to their parent
  const parents = processes.filter((p) => !p.isChild && !p.isOrphaned).slice().sort((a, b) => {
    let cmp = 0
    if (sortKey === 'project') cmp = (a.project ?? '').localeCompare(b.project ?? '')
    else if (sortKey === 'mem') cmp = a.memory.rss - b.memory.rss
    else if (sortKey === 'cpu') cmp = a.cpu - b.cpu
    else if (sortKey === 'runtime') cmp = a.runtime - b.runtime
    else if (sortKey === 'status') cmp = (a.isRunaway ? 1 : 0) - (b.isRunaway ? 1 : 0)
    return sortAsc ? cmp : -cmp
  })

  const childrenOf = new Map<number, ClaudeProcess[]>()
  for (const p of processes) {
    if (p.isChild && claudePids.has(p.ppid)) {
      const arr = childrenOf.get(p.ppid) ?? []
      arr.push(p)
      childrenOf.set(p.ppid, arr)
    }
  }

  const rows: { process: ClaudeProcess; indent: boolean; orphaned: boolean }[] = []
  for (const parent of parents) {
    rows.push({ process: parent, indent: false, orphaned: false })
    for (const child of childrenOf.get(parent.pid) ?? []) {
      rows.push({ process: child, indent: true, orphaned: false })
    }
  }
  for (const p of processes) {
    if (p.isChild && !claudePids.has(p.ppid)) rows.push({ process: p, indent: false, orphaned: false })
    if (p.isOrphaned) rows.push({ process: p, indent: false, orphaned: true })
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''
  const thStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none' }

  return (
    <div className="process-table">
      <table>
        <thead>
          <tr>
            <th style={thStyle} onClick={() => toggleSort('project')}>PROJECT / CWD{arrow('project')}</th>
            <th>PID</th>
            <th style={thStyle} onClick={() => toggleSort('mem')}>MEM{arrow('mem')}</th>
            <th style={thStyle} onClick={() => toggleSort('cpu')}>CPU{arrow('cpu')}</th>
            <th style={thStyle} onClick={() => toggleSort('runtime')}>RUNTIME{arrow('runtime')}</th>
            <th style={thStyle} onClick={() => toggleSort('status')}>STATUS{arrow('status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="empty-state">No Claude processes found</td></tr>
          ) : (
            rows.map(({ process: p, indent, orphaned }) => (
              <tr
                key={p.pid}
                className={`${p.isRunaway || orphaned ? 'runaway' : ''} ${selected?.pid === p.pid ? 'selected' : ''}`}
                onClick={() => onSelect(p)}
              >
                <td style={{ paddingLeft: indent ? 24 : undefined }}>
                  {indent ? (
                    <>
                      <span style={{ color: '#444', marginRight: 4 }}>↳</span>
                      <span style={{ color: '#666', fontFamily: 'monospace', fontSize: 11 }}>{p.name}</span>
                    </>
                  ) : (
                    <>
                      <span title={p.cwd}>{p.project ?? p.cwd ?? '—'}</span>
                      {orphaned && (
                        <span title="Orphaned: parent process is gone" style={{ marginLeft: 6, fontSize: 10, color: '#fc8181', fontWeight: 'bold' }}>ORPHAN</span>
                      )}
                      {!orphaned && p.apiIdleMinutes !== undefined && p.apiIdleMinutes >= 10 && (
                        <span title={`No API activity for ${p.apiIdleMinutes}m`} style={{ marginLeft: 6, fontSize: 10, color: '#555' }}>
                          idle {p.apiIdleMinutes}m
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td style={{ color: '#555', fontFamily: 'monospace' }}>{p.pid}</td>
                <td>{formatMemory(p.memory.rss)}</td>
                <td style={{ color: p.cpu > 50 ? '#fc8181' : p.cpu > 10 ? '#f6ad55' : undefined }}>
                  {p.cpu.toFixed(1)}%
                </td>
                <td>{formatRuntime(p.runtime)}</td>
                <td style={{ color: p.isRunaway || orphaned ? '#fc8181' : '#444', fontWeight: p.isRunaway || orphaned ? 'bold' : undefined }}>
                  {p.isRunaway ? 'RUNAWAY' : orphaned ? 'ORPHAN' : 'ok'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

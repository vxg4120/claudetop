import React, { useState } from 'react'
import { ClaudeProcess } from '../hooks/useProcesses'

interface Props {
  process: ClaudeProcess | null
  onKill: (pid: number, force?: boolean) => void
}

function formatMemory(b: number) {
  return b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`
}

function formatRuntime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}

export function DetailPanel({ process, onKill }: Props) {
  const [confirming, setConfirming] = useState<'soft' | 'force' | null>(null)

  if (!process) {
    return <div className="detail-panel empty-state">Select a process to inspect</div>
  }

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span style={{ fontWeight: 'bold' }}>PID {process.pid}</span>
        <div>
          {confirming === 'soft' ? (
            <>
              <span className="confirm-text">Kill with SIGTERM?</span>
              <button className="kill-btn" onClick={() => { onKill(process.pid); setConfirming(null) }}>Yes</button>
              <button className="kill-btn" onClick={() => setConfirming(null)}>No</button>
            </>
          ) : confirming === 'force' ? (
            <>
              <span className="confirm-text force-text">Force kill with SIGKILL?</span>
              <button className="kill-btn force" onClick={() => { onKill(process.pid, true); setConfirming(null) }}>Yes</button>
              <button className="kill-btn" onClick={() => setConfirming(null)}>No</button>
            </>
          ) : (
            <>
              <button className="kill-btn" onClick={() => setConfirming('soft')}>Kill</button>
              <button className="kill-btn force" onClick={() => setConfirming('force')}>Force Kill</button>
            </>
          )}
        </div>
      </div>
      <div className="detail-row"><span className="detail-label">Memory</span><span className="detail-value">{formatMemory(process.memory.rss)} RSS / {formatMemory(process.memory.vms)} VMS</span></div>
      <div className="detail-row"><span className="detail-label">CPU</span><span className="detail-value">{process.cpu.toFixed(1)}%</span></div>
      <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value">{process.status}{process.isRunaway ? ' — RUNAWAY' : ''}</span></div>
      <div className="detail-row"><span className="detail-label">Runtime</span><span className="detail-value">{formatRuntime(process.runtime)}</span></div>
      <div className="detail-row"><span className="detail-label">CWD</span><span className="detail-value">{process.cwd}</span></div>
      <div className="detail-row"><span className="detail-label">Args</span><span className="detail-value">{process.args.join(' ') || '(none)'}</span></div>
      <div className="detail-row"><span className="detail-label">PPID</span><span className="detail-value">{process.ppid}</span></div>
    </div>
  )
}

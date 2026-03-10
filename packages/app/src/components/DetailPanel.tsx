import React, { useState } from 'react'
import { ClaudeProcess } from '../hooks/useProcesses'

interface ProcessAnalysis {
  assessment: string
  explanation: string
  recommendation: 'leave' | 'kill' | 'investigate'
}

type CT = { analyzeProcess: (p: unknown) => Promise<ProcessAnalysis> }
function ct(): CT { return (window as unknown as { claudetop: CT }).claudetop }

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
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

const RECOMMENDATION_COLOR = { leave: '#68d391', investigate: '#f6ad55', kill: '#fc8181' }

export function DetailPanel({ process, onKill }: Props) {
  const [confirming, setConfirming] = useState<'soft' | 'force' | null>(null)
  const [analysis, setAnalysis] = useState<ProcessAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  async function onAnalyze() {
    if (!process) return
    setAnalysis(null)
    setAnalyzing(true)
    const result = await ct().analyzeProcess({
      pid: process.pid,
      cwd: process.cwd,
      args: process.args,
      runtime: process.runtime,
      memory: process.memory,
      cpu: process.cpu,
    })
    setAnalysis(result)
    setAnalyzing(false)
  }

  if (!process) {
    return <div className="detail-panel empty-state">Select a process to inspect</div>
  }

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span style={{ fontWeight: 'bold' }}>PID {process.pid}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className="kill-btn"
            style={{ background: '#1a1a2e', color: '#b794f4' }}
            onClick={onAnalyze}
            disabled={analyzing}
          >
            {analyzing ? '...' : '🔍 Analyze'}
          </button>
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

      {analysis && (
        <div style={{
          margin: '8px 0', padding: '10px 12px',
          background: '#0d0d1a', border: `1px solid ${RECOMMENDATION_COLOR[analysis.recommendation] ?? '#333'}`,
          borderRadius: 4,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: RECOMMENDATION_COLOR[analysis.recommendation], fontWeight: 'bold', fontSize: 12 }}>
              {analysis.assessment}
            </span>
            <span style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: 1,
              color: RECOMMENDATION_COLOR[analysis.recommendation],
            }}>
              → {analysis.recommendation}
            </span>
          </div>
          <div style={{ color: '#a0aec0', fontSize: 12, lineHeight: 1.5 }}>{analysis.explanation}</div>
        </div>
      )}

      <div className="detail-row"><span className="detail-label">Project</span><span className="detail-value">{process.project ?? '—'}</span></div>
      <div className="detail-row"><span className="detail-label">CWD</span><span className="detail-value" style={{ fontSize: 11, color: '#666' }}>{process.cwd}</span></div>
      <div className="detail-row"><span className="detail-label">Runtime</span><span className="detail-value" style={{ color: process.isRunaway ? '#fc8181' : undefined }}>{formatRuntime(process.runtime)}</span></div>
      <div className="detail-row"><span className="detail-label">Memory</span><span className="detail-value">{formatMemory(process.memory.rss)} RSS / {formatMemory(process.memory.vms)} VMS</span></div>
      <div className="detail-row"><span className="detail-label">CPU</span><span className="detail-value">{process.cpu.toFixed(1)}%</span></div>
      <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value" style={{ color: process.isRunaway || process.isOrphaned ? '#fc8181' : undefined }}>
        {process.status}{process.isRunaway ? ' — RUNAWAY' : ''}{process.isOrphaned ? ' — ORPHANED' : ''}
      </span></div>
      {process.apiIdleMinutes !== undefined && (
        <div className="detail-row"><span className="detail-label">API Activity</span><span className="detail-value" style={{ color: process.apiIdleMinutes >= 10 ? '#f6ad55' : '#68d391' }}>
          {process.apiIdleMinutes === 0 ? 'Active now' : `Idle ${process.apiIdleMinutes}m`}
        </span></div>
      )}
      <div className="detail-row"><span className="detail-label">Args</span><span className="detail-value" style={{ fontSize: 11, color: '#555' }}>{process.args.slice(0, 5).join(' ') || '(none)'}</span></div>
      <div className="detail-row"><span className="detail-label">PPID</span><span className="detail-value">{process.ppid}</span></div>
    </div>
  )
}

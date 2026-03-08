import React, { useState, useEffect } from 'react'

interface Session {
  sessionId: string; projectSlug: string; model: string | null
  startedAt: string | null; durationSeconds: number | null
  estimatedCostUsd: number; gitBranch: string | null
  usage: { input_tokens: number; output_tokens: number }
}

type ClaudeTop = {
  getSessions: (f: unknown) => Promise<Session[]>
}

function fmt(s: number | null): string {
  if (!s) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function SessionsPanel() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<Session | null>(null)
  const [project, setProject] = useState('')
  const [since, setSince] = useState('7d')

  useEffect(() => {
    const f: Record<string, unknown> = {}
    if (project) f.project = project
    if (since) {
      const ms = since === '1d' ? 86400000 : since === '7d' ? 7 * 86400000 : 30 * 86400000
      f.since = new Date(Date.now() - ms)
    }
    ;(window as unknown as { claudetop: ClaudeTop }).claudetop.getSessions(f).then(setSessions)
  }, [project, since])

  return (
    <div className="panel-container">
      <div className="panel-toolbar">
        <input className="filter-input" placeholder="Filter by project..." value={project} onChange={(e) => setProject(e.target.value)} />
        <select className="filter-select" value={since} onChange={(e) => setSince(e.target.value)}>
          <option value="1d">24h</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="">All time</option>
        </select>
      </div>
      <div className="sessions-list">
        <table>
          <thead><tr><th>ID</th><th>Project</th><th>Model</th><th>Duration</th><th>Cost</th><th>Started</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.sessionId} className={selected?.sessionId === s.sessionId ? 'selected' : ''} onClick={() => setSelected(s)}>
                <td style={{ color: '#4a9eff', fontFamily: 'monospace' }}>{s.sessionId.slice(0, 8)}</td>
                <td>{s.projectSlug}</td>
                <td style={{ color: '#f6ad55' }}>{s.model ?? '—'}</td>
                <td>{fmt(s.durationSeconds)}</td>
                <td style={{ color: '#68d391' }}>${s.estimatedCostUsd.toFixed(4)}</td>
                <td style={{ color: '#666' }}>{s.startedAt ? new Date(s.startedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="detail-panel">
          <div className="detail-header"><span style={{ color: '#4a9eff' }}>{selected.sessionId}</span></div>
          <div className="detail-row"><span className="detail-label">Project</span><span className="detail-value">{selected.projectSlug}</span></div>
          <div className="detail-row"><span className="detail-label">Model</span><span className="detail-value">{selected.model ?? '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Branch</span><span className="detail-value">{selected.gitBranch ?? '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Duration</span><span className="detail-value">{fmt(selected.durationSeconds)}</span></div>
          <div className="detail-row"><span className="detail-label">Input tokens</span><span className="detail-value">{selected.usage.input_tokens.toLocaleString()}</span></div>
          <div className="detail-row"><span className="detail-label">Output tokens</span><span className="detail-value">{selected.usage.output_tokens.toLocaleString()}</span></div>
          <div className="detail-row"><span className="detail-label">Est. cost</span><span className="detail-value" style={{ color: '#68d391' }}>${selected.estimatedCostUsd.toFixed(4)}</span></div>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface CostReport {
  totalUsd: number
  byProject: Array<{ project: string; usd: number; sessions: number }>
  byModel: Array<{ model: string; usd: number; sessions: number }>
  byDay: Array<{ date: string; usd: number; sessions: number }>
}

type ClaudeTop = {
  getCostReport: (f: unknown) => Promise<CostReport>
  onIndexingComplete: (cb: (count: number) => void) => () => void
}

const COLORS = ['#4a9eff', '#68d391', '#f6ad55', '#fc8181', '#b794f4']

// Slugs are encoded paths like "-Users-username-Development-repos-my-project"
// Show the last 2 meaningful segments, e.g. "repos/claudetop"
function projectLabel(slug: string): string {
  const parts = slug.replace(/^-/, '').split('-').filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join('/') : slug
}

export function AnalyticsPanel({ isIndexing }: { isIndexing?: boolean }) {
  const [report, setReport] = useState<CostReport | null>(null)
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week')
  const ct = () => (window as unknown as { claudetop: ClaudeTop }).claudetop

  const load = (p: typeof period) => {
    const ms = p === 'day' ? 86400000 : p === 'week' ? 7 * 86400000 : 30 * 86400000
    ct().getCostReport({ since: new Date(Date.now() - ms) }).then(setReport)
  }

  useEffect(() => { load(period) }, [period])

  // Auto-reload when background indexing finishes
  useEffect(() => {
    const cleanup = ct().onIndexingComplete(() => load(period))
    return cleanup
  }, [period])

  if (!report) return <div className="empty-state">{isIndexing ? 'Indexing sessions…' : 'Loading...'}</div>

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
      <div className="panel-toolbar" style={{ marginBottom: 16, padding: 0, border: 'none' }}>
        <span style={{ color: '#e0e0e0', fontWeight: 'bold', marginRight: 16 }}>
          Total: <span style={{ color: '#68d391' }}>${report.totalUsd.toFixed(2)}</span>
        </span>
        {(['day', 'week', 'month'] as const).map((p) => (
          <button key={p} className="kill-btn"
            style={{ background: period === p ? '#1d2735' : undefined, marginRight: 4 }}
            onClick={() => setPeriod(p)}>{p}</button>
        ))}
        {isIndexing && (
          <span style={{ marginLeft: 12, fontSize: 11, color: '#4a9eff' }}>⟳ indexing…</span>
        )}
      </div>

      {report.byDay.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: '#666', marginBottom: 8, fontSize: 11, textTransform: 'uppercase' }}>Daily Cost</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={report.byDay}>
              <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 10 }} />
              <YAxis tick={{ fill: '#666', fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']} contentStyle={{ background: '#111', border: '1px solid #222', color: '#e0e0e0' }} />
              <Bar dataKey="usd" fill="#4a9eff" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ color: '#666', marginBottom: 8, fontSize: 11, textTransform: 'uppercase' }}>By Project</div>
          {report.byProject.slice(0, 6).map((p, i) => (
            <div key={p.project} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS[i % COLORS.length] }} title={p.project}>{projectLabel(p.project)}</span>
              <span style={{ color: '#68d391' }}>${p.usd.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ color: '#666', marginBottom: 8, fontSize: 11, textTransform: 'uppercase' }}>By Model</div>
          {report.byModel.map((m, i) => (
            <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS[i % COLORS.length] }}>{(m.model ?? '—').replace('claude-', '')}</span>
              <span style={{ color: '#f6ad55' }}>${m.usd.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

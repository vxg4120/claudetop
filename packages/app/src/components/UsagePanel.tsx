import React, { useState, useEffect } from 'react'

interface CostReport {
  totalUsd: number
  byProject: Array<{ project: string; usd: number; sessions: number }>
  byModel: Array<{ model: string; usd: number; sessions: number }>
  byDay: Array<{ date: string; usd: number; sessions: number }>
}

function ct() {
  return (window as unknown as { claudetop: { getCostReport: (f: unknown) => Promise<CostReport> } }).claudetop
}

interface PeriodData {
  day: CostReport | null
  week: CostReport | null
  month: CostReport | null
}

function StatBox({ label, value, sub, color = '#e2e8f0' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{ flex: 1, padding: '10px 14px', borderRight: '1px solid #1a1a1a' }}>
      <div style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 'bold' }}>{value}</div>
      {sub && <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function BurnBar({ label, usd, maxUsd }: { label: string; usd: number; maxUsd: number }) {
  const pct = maxUsd > 0 ? Math.min((usd / maxUsd) * 100, 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#888', fontSize: 12 }}>{label}</span>
        <span style={{ color: '#68d391', fontSize: 12 }}>${usd.toFixed(2)}</span>
      </div>
      <div style={{ height: 4, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 2,
          background: pct > 80 ? '#fc8181' : pct > 50 ? '#f6ad55' : '#4a9eff',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

export function UsagePanel() {
  const [data, setData] = useState<PeriodData>({ day: null, week: null, month: null })
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const now = Date.now()
    const [day, week, month] = await Promise.all([
      ct().getCostReport({ since: new Date(now - 86400000) }),
      ct().getCostReport({ since: new Date(now - 7 * 86400000) }),
      ct().getCostReport({ since: new Date(now - 30 * 86400000) }),
    ])
    setData({ day, week, month })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div style={{ padding: 16, flex: 1 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 20 }}>Usage</div>
      <div className="empty-state">Loading...</div>
    </div>
  )

  const { day, week, month } = data
  const monthMax = month?.totalUsd ?? 1

  return (
    <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 'bold' }}>Usage</span>
        <button className="kill-btn" onClick={load} title="Refresh">↻</button>
      </div>

      {/* Top stats */}
      <div style={{ display: 'flex', border: '1px solid #1a1a1a', borderRadius: 6, marginBottom: 20, overflow: 'hidden' }}>
        <StatBox label="Today" value={`$${day?.totalUsd.toFixed(2) ?? '0.00'}`} sub={`${day?.byDay[0]?.sessions ?? 0} sessions`} color="#68d391" />
        <StatBox label="7 days" value={`$${week?.totalUsd.toFixed(2) ?? '0.00'}`} sub={`${week?.byDay.reduce((s, d) => s + d.sessions, 0) ?? 0} sessions`} color="#4a9eff" />
        <div style={{ flex: 1, padding: '10px 14px' }}>
          <div style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>30 days</div>
          <div style={{ color: '#f6ad55', fontSize: 18, fontWeight: 'bold' }}>${month?.totalUsd.toFixed(2) ?? '0.00'}</div>
          <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>{month?.byDay.reduce((s, d) => s + d.sessions, 0) ?? 0} sessions</div>
        </div>
      </div>

      {/* Burn by model */}
      {(month?.byModel?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>By Model (30d)</div>
          {month!.byModel.map((m) => (
            <BurnBar key={m.model} label={(m.model ?? '—').replace('claude-', '')} usd={m.usd} maxUsd={monthMax} />
          ))}
        </div>
      )}

      {/* Top projects */}
      {(month?.byProject?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Top Projects (30d)</div>
          {month!.byProject.slice(0, 6).map((p) => {
            const parts = p.project.replace(/^-/, '').split('-').filter(Boolean)
            const label = parts.length >= 2 ? parts.slice(-2).join('/') : p.project
            return <BurnBar key={p.project} label={label} usd={p.usd} maxUsd={monthMax} />
          })}
        </div>
      )}

      {/* Daily trend */}
      {(week?.byDay?.length ?? 0) > 0 && (
        <div>
          <div style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Daily (7d)</div>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 48 }}>
            {(() => {
              const days = week!.byDay
              const max = Math.max(...days.map((d) => d.usd), 0.001)
              return days.map((d) => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', background: '#4a9eff', borderRadius: '2px 2px 0 0', height: `${(d.usd / max) * 40}px`, minHeight: 1 }} title={`$${d.usd.toFixed(2)}`} />
                  <div style={{ color: '#333', fontSize: 9 }}>{d.date.slice(5)}</div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {month?.totalUsd === 0 && (
        <div className="empty-state" style={{ marginTop: 20 }}>No usage data in the last 30 days</div>
      )}
    </div>
  )
}

import React, { useState, useEffect } from 'react'

interface Session {
  sessionId: string
  projectSlug: string
  cwd: string
  model: string | null
  startedAt: string | Date | null
  durationSeconds: number | null
  estimatedCostUsd: number
  gitBranch: string | null
  usage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
    output_tokens: number
  }
}

type ClaudeTop = {
  getSessions: (f: unknown) => Promise<Session[]>
  summarizeSession: (id: string) => Promise<{ summary?: string; error?: string }>
  refreshIndex: () => Promise<boolean>
}

// Pricing per 1M tokens. Updated Feb 2026: Opus 4.6 reduced from $15/$75 → $5/$25.
const MODEL_PRICING: Record<string, { input: number; cacheWrite: number; cacheRead: number; output: number }> = {
  'claude-opus-4-6':   { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
  'claude-opus-4-5':   { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
  'claude-sonnet-4-6': { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
  'claude-sonnet-4-5': { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
  'claude-haiku-3-5':  { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
}

function fmt(s: number | null): string {
  if (!s) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function projectName(cwd: string, slug: string): string {
  // cwd is something like /Users/vgupta/Development/repos/cann/nevergreen-ui
  if (cwd) {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  // fall back to last dash-segment of slug
  const slugParts = slug.split('-').filter(Boolean)
  return slugParts[slugParts.length - 1] ?? slug
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

interface CostLineProps {
  label: string
  tokens: number
  rate: number
  cost: number
}
function CostLine({ label, tokens, rate, cost }: CostLineProps) {
  if (tokens === 0) return null
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value" style={{ fontSize: 11 }}>
        <span style={{ color: '#aaa' }}>{fmtTokens(tokens)} tok × ${rate}/M</span>
        <span style={{ color: '#68d391', marginLeft: 8 }}>${cost.toFixed(2)}</span>
      </span>
    </div>
  )
}

function computeStats(sessions: Session[]) {
  const totalCost = sessions.reduce((s, x) => s + x.estimatedCostUsd, 0)
  const totalInputTokens = sessions.reduce((s, x) => s + x.usage.input_tokens, 0)
  const totalOutputTokens = sessions.reduce((s, x) => s + x.usage.output_tokens, 0)
  const totalCacheTokens = sessions.reduce((s, x) => s + x.usage.cache_read_input_tokens, 0)
  const byModel: Record<string, { cost: number; sessions: number }> = {}
  for (const s of sessions) {
    const m = s.model ?? 'unknown'
    if (!byModel[m]) byModel[m] = { cost: 0, sessions: 0 }
    byModel[m].cost += s.estimatedCostUsd
    byModel[m].sessions++
  }
  return { totalCost, totalInputTokens, totalOutputTokens, totalCacheTokens, byModel, count: sessions.length }
}

const ct = () => (window as unknown as { claudetop: ClaudeTop }).claudetop

// Normalize startedAt which may arrive as Date object or ISO string via IPC
function toMs(d: string | Date | null | undefined): number {
  if (!d) return 0
  if (d instanceof Date) return d.getTime()
  const t = new Date(d).getTime()
  return isNaN(t) ? 0 : t
}
function toDateStr(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

type SortKey = 'id' | 'project' | 'model' | 'duration' | 'cost' | 'started'

export function SessionsPanel() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<Session | null>(null)
  const [project, setProject] = useState('')
  const [since, setSince] = useState('7d')
  const [summary, setSummary] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('started')
  const [sortAsc, setSortAsc] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''
  const thStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none' }

  async function onRefreshIndex() {
    setIndexing(true)
    await ct().refreshIndex()
    // Re-fetch sessions after a short delay to allow indexer to complete
    setTimeout(() => {
      const f: Record<string, unknown> = {}
      if (project) f.project = project
      if (since) {
        const ms = since === '1d' ? 86400000 : since === '7d' ? 7 * 86400000 : 30 * 86400000
        f.since = new Date(Date.now() - ms)
      }
      ct().getSessions(f)
        .then((data) => {
          const normalized = data.map((s) => ({
            ...s,
            startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
          }))
          setSessions(normalized)
        })
        .catch((err: unknown) => console.error('[SessionsPanel] refresh failed:', err))
        .finally(() => setIndexing(false))
    }, 2000)
  }

  async function onSummarize(sessionId: string) {
    setSummary(null)
    setSummarizing(true)
    const res = await ct().summarizeSession(sessionId)
    setSummarizing(false)
    setSummary(res.error ? `Error: ${res.error}` : (res.summary ?? ''))
  }

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    const f: Record<string, unknown> = {}
    if (project) f.project = project
    if (since) {
      const ms = since === '1d' ? 86400000 : since === '7d' ? 7 * 86400000 : 30 * 86400000
      f.since = new Date(Date.now() - ms)
    }
    ct().getSessions(f)
      .then((data) => {
        // Normalize Date objects from IPC structured clone to ISO strings
        const normalized = data.map((s) => ({
          ...s,
          startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
        }))
        setSessions(normalized)
        setLoading(false)
      })
      .catch((err: unknown) => {
        console.error('[SessionsPanel] getSessions failed:', err)
        setLoadError(String(err))
        setLoading(false)
      })
  }, [project, since])

  const sorted = sessions.slice().sort((a, b) => {
    let cmp = 0
    if (sortKey === 'id') cmp = a.sessionId.localeCompare(b.sessionId)
    else if (sortKey === 'project') cmp = projectName(a.cwd, a.projectSlug).localeCompare(projectName(b.cwd, b.projectSlug))
    else if (sortKey === 'model') cmp = (a.model ?? '').localeCompare(b.model ?? '')
    else if (sortKey === 'duration') cmp = (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0)
    else if (sortKey === 'cost') cmp = a.estimatedCostUsd - b.estimatedCostUsd
    else if (sortKey === 'started') cmp = toMs(a.startedAt) - toMs(b.startedAt)
    return sortAsc ? cmp : -cmp
  })

  const stats = computeStats(sessions)
  const modelEntries = Object.entries(stats.byModel).sort((a, b) => b[1].cost - a[1].cost)

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
        <button className="kill-btn" onClick={onRefreshIndex} disabled={indexing} style={{ marginLeft: 8, fontSize: 11 }}>
          {indexing ? 'Indexing...' : '⟳ Refresh'}
        </button>
      </div>

      {/* Summary stats bar */}
      {sessions.length > 0 && (
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
          <div style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid #1a1a1a' }}>
            <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Total Cost</div>
            <div style={{ color: '#68d391', fontSize: 20, fontWeight: 'bold' }}>${stats.totalCost.toFixed(2)}</div>
            <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>{stats.count} sessions</div>
          </div>
          <div style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid #1a1a1a' }}>
            <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Tokens</div>
            <div style={{ color: '#e2e8f0', fontSize: 14 }}>{fmtTokens(stats.totalInputTokens + stats.totalOutputTokens)}</div>
            <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>
              {fmtTokens(stats.totalInputTokens)} in · {fmtTokens(stats.totalOutputTokens)} out
              {stats.totalCacheTokens > 0 && ` · ${fmtTokens(stats.totalCacheTokens)} cached`}
            </div>
          </div>
          <div style={{ flex: 2, padding: '10px 16px' }}>
            <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>By Model</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {modelEntries.slice(0, 3).map(([model, data]) => {
                const pct = stats.totalCost > 0 ? (data.cost / stats.totalCost) * 100 : 0
                return (
                  <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 60, height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#4a9eff', borderRadius: 2 }} />
                    </div>
                    <span style={{ color: '#f6ad55', fontSize: 11 }}>{model.replace('claude-', '')}</span>
                    <span style={{ color: '#555', fontSize: 11 }}>${data.cost.toFixed(2)} · {data.sessions}s</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <div className="sessions-list">
        {loading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#444' }}>Loading...</div>
        ) : loadError ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#fc8181' }}>
            <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Error loading sessions</div>
            <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{loadError}</div>
            <div style={{ marginTop: 12, color: '#555', fontSize: 12 }}>This may mean the sessions DB failed to open. Check Electron console for details.</div>
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#444' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
            <div style={{ color: '#666', marginBottom: 8 }}>No sessions found for this time range.</div>
            <div style={{ color: '#444', fontSize: 12 }}>Sessions are indexed from <code style={{ color: '#555' }}>~/.claude/projects/</code>. Try "All time" or click ⟳ Refresh.</div>
          </div>
        ) : (
          <table>
            <thead><tr>
              <th style={thStyle} onClick={() => toggleSort('id')}>ID{arrow('id')}</th>
              <th style={thStyle} onClick={() => toggleSort('project')}>Project{arrow('project')}</th>
              <th style={thStyle} onClick={() => toggleSort('model')}>Model{arrow('model')}</th>
              <th style={thStyle} onClick={() => toggleSort('duration')}>Duration{arrow('duration')}</th>
              <th style={thStyle} onClick={() => toggleSort('cost')}>Cost{arrow('cost')}</th>
              <th style={thStyle} onClick={() => toggleSort('started')}>Started{arrow('started')}</th>
            </tr></thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.sessionId} className={selected?.sessionId === s.sessionId ? 'selected' : ''} onClick={() => { setSelected(s); setSummary(null) }}>
                  <td style={{ color: '#4a9eff', fontFamily: 'monospace' }}>{s.sessionId.slice(0, 8)}</td>
                  <td title={s.cwd}>{projectName(s.cwd, s.projectSlug)}</td>
                  <td style={{ color: '#f6ad55' }}>{s.model ?? '—'}</td>
                  <td>{fmt(s.durationSeconds)}</td>
                  <td style={{ color: '#68d391' }}>${s.estimatedCostUsd.toFixed(2)}</td>
                  <td style={{ color: '#666' }}>{toDateStr(s.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {selected && (() => {
        const pricing = MODEL_PRICING[selected.model ?? '']
        const u = selected.usage
        const M = 1_000_000
        return (
          <div className="detail-panel">
            <div className="detail-header"><span style={{ color: '#4a9eff', fontFamily: 'monospace' }}>{selected.sessionId}</span></div>
            <div className="detail-row"><span className="detail-label">Project</span><span className="detail-value" title={selected.cwd}>{projectName(selected.cwd, selected.projectSlug)}</span></div>
            <div className="detail-row"><span className="detail-label">Model</span><span className="detail-value">{selected.model ?? '—'}</span></div>
            <div className="detail-row"><span className="detail-label">Branch</span><span className="detail-value">{selected.gitBranch ?? '—'}</span></div>
            <div className="detail-row"><span className="detail-label">Duration</span><span className="detail-value">{fmt(selected.durationSeconds)}</span></div>
            <div className="detail-row"><span className="detail-label" style={{ color: '#888', fontSize: 11 }}>— Cost breakdown —</span></div>
            {pricing ? (
              <>
                <CostLine label="Input" tokens={u.input_tokens} rate={pricing.input} cost={u.input_tokens * pricing.input / M} />
                <CostLine label="Cache write" tokens={u.cache_creation_input_tokens} rate={pricing.cacheWrite} cost={u.cache_creation_input_tokens * pricing.cacheWrite / M} />
                <CostLine label="Cache read" tokens={u.cache_read_input_tokens} rate={pricing.cacheRead} cost={u.cache_read_input_tokens * pricing.cacheRead / M} />
                <CostLine label="Output" tokens={u.output_tokens} rate={pricing.output} cost={u.output_tokens * pricing.output / M} />
              </>
            ) : (
              <>
                <div className="detail-row"><span className="detail-label">Input tokens</span><span className="detail-value">{fmtTokens(u.input_tokens)}</span></div>
                <div className="detail-row"><span className="detail-label">Cache write</span><span className="detail-value">{fmtTokens(u.cache_creation_input_tokens)}</span></div>
                <div className="detail-row"><span className="detail-label">Cache read</span><span className="detail-value">{fmtTokens(u.cache_read_input_tokens)}</span></div>
                <div className="detail-row"><span className="detail-label">Output tokens</span><span className="detail-value">{fmtTokens(u.output_tokens)}</span></div>
              </>
            )}
            <div className="detail-row"><span className="detail-label">Total cost</span><span className="detail-value" style={{ color: '#68d391', fontWeight: 'bold' }}>${selected.estimatedCostUsd.toFixed(2)}</span></div>
            <div className="detail-row" style={{ marginTop: 8 }}>
              <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }}
                onClick={() => onSummarize(selected.sessionId)} disabled={summarizing}>
                {summarizing ? '...' : '✨ Summarize'}
              </button>
            </div>
            {summary && (
              <div style={{ margin: '8px 0', padding: '8px 10px', background: '#0d1a0d', border: '1px solid #1a3a1a', borderRadius: 4, color: '#a0aec0', fontSize: 12, lineHeight: 1.5 }}>
                {summary}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

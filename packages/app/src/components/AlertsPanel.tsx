import React, { useState, useEffect } from 'react'

interface ScopeWarning {
  cwd: string
  project: string
  type: 'no-claudeignore' | 'large-directory' | 'both'
  fileCount: number
  hasClaudeIgnore: boolean
  hasGitIgnore: boolean
  severity: 'warning' | 'critical'
}

interface BurnAlert {
  project: string
  tokensPerMinute: number
  costPerHour: number
  sessionFile?: string
  alertType?: 'high-rate' | 'sustained-rate' | 'session-cost-exceeded'
  sessionTotalCostUsd?: number
  consecutiveHighWindows?: number
}

export interface Alert {
  id: string
  type: 'scope' | 'burn' | 'runaway'
  severity: 'warning' | 'critical'
  title: string
  body: string
  cwd?: string
  dismissedAt?: number
}

type CT = {
  listProcesses: () => Promise<Array<{ cwd: string; isRunaway: boolean; isOrphaned?: boolean; project?: string; runtime: number; name: string }>>
  checkScopeWarnings: (cwds: string[]) => Promise<ScopeWarning[]>
}
function ct(): CT { return (window as unknown as { claudetop: CT }).claudetop }

function severityColor(s: 'warning' | 'critical') {
  return s === 'critical' ? '#fc8181' : '#f6ad55'
}

interface Props {
  burnAlerts: BurnAlert[]
  onDismissBurn: () => void
}

export function AlertsPanel({ burnAlerts, onDismissBurn }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try {
      const processes = await ct().listProcesses()
      const runningCwds = [...new Set(processes.map((p) => p.cwd).filter((c) => c && c.startsWith('/')))]
      const scopeWarnings = await ct().checkScopeWarnings(runningCwds)

      const next: Alert[] = []

      // Scope warnings
      for (const w of scopeWarnings) {
        const id = `scope:${w.cwd}`
        const fileCountStr = w.fileCount >= 50_000 ? '50k+' : `${w.fileCount.toLocaleString()}`
        let title = ''
        let body = ''
        if (w.type === 'both') {
          title = `Large directory without .claudeignore`
          body = `${w.project} has ${fileCountStr} files and no .claudeignore — Claude may read far more context than needed, burning tokens fast.`
        } else if (w.type === 'no-claudeignore') {
          title = `No .claudeignore found`
          body = `${w.project} has no .claudeignore${w.hasGitIgnore ? ' (has .gitignore but Claude ignores that)' : ''}. Add one to limit context scope.`
        } else {
          title = `Large directory`
          body = `${w.project} has ${fileCountStr} tracked files. Consider a .claudeignore to reduce context.`
        }
        next.push({ id, type: 'scope', severity: w.severity, title, body, cwd: w.cwd })
      }

      // Runaway processes
      for (const p of processes.filter((p) => p.isRunaway)) {
        const id = `runaway:${p.cwd}:${Math.floor(p.runtime / 3600)}`
        const hrs = Math.round(p.runtime / 3600)
        next.push({
          id,
          type: 'runaway',
          severity: hrs > 48 ? 'critical' : 'warning',
          title: 'Runaway agent detected',
          body: `${p.project ?? p.cwd} has been running for ${hrs}h. Use the All view to inspect and kill if needed.`,
          cwd: p.cwd,
        })
      }

      // Orphaned subprocesses (parent process is dead)
      for (const p of processes.filter((p) => p.isOrphaned)) {
        const id = `orphan:${p.cwd}:${p.name}`
        const hrs = Math.round((p.runtime ?? 0) / 3600)
        const label = p.project ?? p.cwd
        next.push({
          id,
          type: 'runaway',
          severity: 'warning',
          title: 'Orphaned subprocess',
          body: `${p.name} in ${label} is still running (${hrs}h) — its Claude parent process has exited. Check if it should be killed.`,
          cwd: p.cwd,
        })
      }

      setAlerts(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const visible = alerts.filter((a) => !dismissed.has(a.id))
  const allAlerts: Array<Alert & { isBurn?: boolean }> = [
    ...burnAlerts.map((b, i) => {
      const proj = b.project.replace(/^-/, '').split('-').filter(Boolean).slice(-2).join('/')
      const isSustained = b.alertType === 'sustained-rate'
      const isCostExceeded = b.alertType === 'session-cost-exceeded'
      const title = isSustained
        ? `Sustained high token burn (${b.consecutiveHighWindows ?? '?'}+ windows)`
        : isCostExceeded
          ? `Session cost exceeded $${b.sessionTotalCostUsd?.toFixed(2) ?? '?'}`
          : 'High token burn rate'
      const body = isCostExceeded
        ? `${proj} — session total: $${b.sessionTotalCostUsd?.toFixed(2) ?? '?'} · currently ${b.tokensPerMinute.toLocaleString()} tok/min`
        : `${proj} — ${b.tokensPerMinute.toLocaleString()} tok/min · $${b.costPerHour.toFixed(2)}/hr`
      return {
        id: `burn:${i}`,
        type: 'burn' as const,
        severity: (isSustained ? 'critical' : 'warning') as 'warning' | 'critical',
        title,
        body,
        isBurn: true,
      }
    }),
    ...visible,
  ]

  return (
    <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 'bold' }}>Alerts</span>
        <button className="kill-btn" onClick={refresh} title="Refresh">↻</button>
      </div>

      {loading && <div className="empty-state">Scanning...</div>}

      {!loading && allAlerts.length === 0 && (
        <div className="empty-state">No alerts — all clear</div>
      )}

      {allAlerts.map((a) => (
        <div key={a.id} style={{
          marginBottom: 12, padding: '10px 12px',
          background: '#111', border: `1px solid ${severityColor(a.severity)}33`,
          borderLeft: `3px solid ${severityColor(a.severity)}`,
          borderRadius: 4,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: severityColor(a.severity), fontWeight: 'bold', fontSize: 12 }}>
              {a.type === 'burn' ? '⚡' : a.type === 'runaway' ? '🔴' : '⚠️'} {a.title}
            </span>
            <button
              className="kill-btn"
              style={{ fontSize: 10, padding: '1px 6px' }}
              onClick={() => {
                if (a.isBurn) onDismissBurn()
                else setDismissed((d) => new Set([...d, a.id]))
              }}
            >✕</button>
          </div>
          <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>{a.body}</div>
          {a.type === 'scope' && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#555' }}>
              Fix: <code style={{ color: '#aaa' }}>touch {a.cwd}/.claudeignore</code>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

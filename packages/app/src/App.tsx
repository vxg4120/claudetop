import React, { useState, useEffect, Component, ReactNode } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { ProcessList } from './components/ProcessList'
import { DetailPanel } from './components/DetailPanel'
import { SessionsPanel } from './components/SessionsPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { StandupPanel } from './components/StandupPanel'
import { UsagePanel } from './components/UsagePanel'
import { AlertsPanel } from './components/AlertsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useProcesses } from './hooks/useProcesses'

export type View = 'all' | 'runaway' | 'sessions' | 'analytics' | 'standup' | 'usage' | 'alerts' | 'settings'

class PanelErrorBoundary extends Component<{ view: string; children: ReactNode }, { error: string | null }> {
  constructor(props: { view: string; children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  componentDidUpdate(prev: { view: string }) {
    if (prev.view !== this.props.view && this.state.error) this.setState({ error: null })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#fc8181' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Panel error</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11 }}>{this.state.error}</div>
        </div>
      )
    }
    return this.props.children
  }
}

interface BurnAlert {
  project: string
  tokensPerMinute: number
  costPerHour: number
  alertType?: 'high-rate' | 'sustained-rate' | 'session-cost-exceeded'
  sessionTotalCostUsd?: number
  consecutiveHighWindows?: number
}

type CT = { onTokenBurnAlert: (cb: (a: unknown) => void) => () => void }
function ct(): CT { return (window as unknown as { claudetop: CT }).claudetop }

export function App() {
  const { processes, selected, setSelected, killProcess } = useProcesses()
  const [view, setView] = useState<View>('all')
  const [burnAlerts, setBurnAlerts] = useState<BurnAlert[]>([])
  const filtered = view === 'runaway' ? processes.filter((p) => p.isRunaway) : processes

  useEffect(() => {
    const cleanup = ct().onTokenBurnAlert((alert) => {
      setBurnAlerts((prev) => [...prev, alert as BurnAlert])
    })
    return cleanup
  }, [])

  return (
    <div className="layout">
      <Sidebar
        processes={processes}
        activeView={view}
        onViewChange={setView}
        alertCount={burnAlerts.length}
      />
      <div className="main">
        <PanelErrorBoundary view={view}>
          {view === 'sessions'  ? <SessionsPanel /> :
           view === 'analytics' ? <AnalyticsPanel /> :
           view === 'standup'   ? <StandupPanel /> :
           view === 'usage'     ? <UsagePanel /> :
           view === 'alerts'    ? <AlertsPanel burnAlerts={burnAlerts} onDismissBurn={() => setBurnAlerts([])} /> :
           view === 'settings'  ? <SettingsPanel /> : (
            <>
              <ProcessList processes={filtered} selected={selected} onSelect={setSelected} />
              <DetailPanel process={selected} onKill={killProcess} />
            </>
          )}
        </PanelErrorBoundary>
      </div>
    </div>
  )
}

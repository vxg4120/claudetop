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

type CT = {
  onTokenBurnAlert: (cb: (a: unknown) => void) => () => void
  onIndexingStarted: (cb: () => void) => () => void
  onIndexingComplete: (cb: (count: number) => void) => () => void
}
function ct(): CT { return (window as unknown as { claudetop: CT }).claudetop }

export function App() {
  const { processes, selected, setSelected, killProcess } = useProcesses()
  const [view, setView] = useState<View>('all')
  const [burnAlerts, setBurnAlerts] = useState<BurnAlert[]>([])
  const [isIndexing, setIsIndexing] = useState(false)
  const [lastIndexCount, setLastIndexCount] = useState<number | null>(null)
  const filtered = view === 'runaway' ? processes.filter((p) => p.isRunaway) : processes

  useEffect(() => {
    const c1 = ct().onTokenBurnAlert((alert) => {
      setBurnAlerts((prev) => [...prev, alert as BurnAlert])
    })
    const c2 = ct().onIndexingStarted(() => {
      setIsIndexing(true)
      setLastIndexCount(null)
    })
    const c3 = ct().onIndexingComplete((count) => {
      setIsIndexing(false)
      setLastIndexCount(count)
    })
    return () => { c1(); c2(); c3() }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          processes={processes}
          activeView={view}
          onViewChange={setView}
          alertCount={burnAlerts.length}
        />
        <div className="main" style={{ flex: 1 }}>
          <PanelErrorBoundary view={view}>
            {view === 'sessions'  ? <SessionsPanel isIndexing={isIndexing} /> :
             view === 'analytics' ? <AnalyticsPanel isIndexing={isIndexing} /> :
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
      {(isIndexing || lastIndexCount !== null) && (
        <div style={{
          padding: '5px 16px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8,
          background: '#0d1117', borderTop: '1px solid #1e2a3a', color: '#555', flexShrink: 0,
        }}>
          {isIndexing ? (
            <>
              <span style={{ color: '#4a9eff', animation: 'pulse 1.2s ease-in-out infinite' }}>⟳</span>
              <span>Indexing sessions… this may take a moment on first run</span>
            </>
          ) : lastIndexCount !== null && lastIndexCount > 0 ? (
            <>
              <span style={{ color: '#68d391' }}>✓</span>
              <span>Indexed {lastIndexCount} new session{lastIndexCount !== 1 ? 's' : ''}</span>
            </>
          ) : lastIndexCount === 0 ? (
            <span>Index up to date</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

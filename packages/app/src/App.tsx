import React, { useState } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { ProcessList } from './components/ProcessList'
import { DetailPanel } from './components/DetailPanel'
import { SessionsPanel } from './components/SessionsPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { StandupPanel } from './components/StandupPanel'
import { useProcesses } from './hooks/useProcesses'

export type View = 'all' | 'runaway' | 'sessions' | 'analytics' | 'standup'

export function App() {
  const { processes, selected, setSelected, killProcess } = useProcesses()
  const [view, setView] = useState<View>('all')
  const filtered = view === 'runaway' ? processes.filter((p) => p.isRunaway) : processes

  return (
    <div className="layout">
      <Sidebar processes={processes} activeView={view} onViewChange={setView} />
      <div className="main">
        {view === 'sessions'  ? <SessionsPanel /> :
         view === 'analytics' ? <AnalyticsPanel /> :
         view === 'standup'   ? <StandupPanel /> : (
          <>
            <ProcessList processes={filtered} selected={selected} onSelect={setSelected} />
            <DetailPanel process={selected} onKill={killProcess} />
          </>
        )}
      </div>
    </div>
  )
}

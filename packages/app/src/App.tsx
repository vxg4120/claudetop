import React, { useState } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { ProcessList } from './components/ProcessList'
import { DetailPanel } from './components/DetailPanel'
import { useProcesses } from './hooks/useProcesses'

export function App() {
  const { processes, selected, setSelected, killProcess } = useProcesses()
  const [filter, setFilter] = useState<'all' | 'runaway'>('all')

  const filtered = filter === 'runaway' ? processes.filter((p) => p.isRunaway) : processes

  return (
    <div className="layout">
      <Sidebar processes={processes} activeFilter={filter} onFilterChange={setFilter} />
      <div className="main">
        <ProcessList processes={filtered} selected={selected} onSelect={setSelected} />
        <DetailPanel process={selected} onKill={killProcess} />
      </div>
    </div>
  )
}

import React from 'react'
import { ClaudeProcess } from '../hooks/useProcesses'

interface Props {
  processes: ClaudeProcess[]
  activeFilter: 'all' | 'runaway'
  onFilterChange: (filter: 'all' | 'runaway') => void
}

export function Sidebar({ processes, activeFilter, onFilterChange }: Props) {
  const runawayCount = processes.filter((p) => p.isRunaway).length

  return (
    <div className="sidebar">
      <div className="sidebar-title">claudetop</div>
      <div
        className={`sidebar-item ${activeFilter === 'all' ? 'active' : ''}`}
        onClick={() => onFilterChange('all')}
      >
        <span>All</span>
        <span style={{ color: '#666' }}>{processes.length}</span>
      </div>
      <div
        className={`sidebar-item ${activeFilter === 'runaway' ? 'active' : ''}`}
        onClick={() => onFilterChange('runaway')}
      >
        <span>Runaway</span>
        {runawayCount > 0 && <span className="badge">{runawayCount}</span>}
      </div>
    </div>
  )
}

import React from 'react'
import { ClaudeProcess } from '../hooks/useProcesses'
import { View } from '../App'

interface Props {
  processes: ClaudeProcess[]
  activeView: View
  onViewChange: (view: View) => void
}

export function Sidebar({ processes, activeView, onViewChange }: Props) {
  const runawayCount = processes.filter((p) => p.isRunaway).length

  const item = (label: string, view: View, badge?: React.ReactNode) => (
    <div className={`sidebar-item ${activeView === view ? 'active' : ''}`} onClick={() => onViewChange(view)}>
      <span>{label}</span>
      {badge}
    </div>
  )

  return (
    <div className="sidebar">
      <div className="sidebar-title">claudetop</div>
      <div className="sidebar-section-label">Live</div>
      {item('All', 'all', <span style={{ color: '#666' }}>{processes.length}</span>)}
      {item('Runaway', 'runaway', runawayCount > 0 ? <span className="badge">{runawayCount}</span> : null)}
      <div className="sidebar-section-label">History</div>
      {item('Sessions', 'sessions')}
      {item('Analytics', 'analytics')}
      <div className="sidebar-section-label">Agent AI</div>
      {item('Standup ✨', 'standup')}
    </div>
  )
}

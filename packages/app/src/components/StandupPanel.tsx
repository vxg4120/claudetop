import React, { useState, useEffect, useRef } from 'react'

interface StandupReport {
  generatedAt: string
  done: Array<{ project: string; summary: string; sessions: number; costUsd: number }>
  nextUp: Array<{ project: string; description: string }>
  inProgress: Array<{ project: string; model: string | null; runtimeMinutes: number; branch: string | null }>
  blockers: Array<{ project: string; description: string }>
  llmUsage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }
}

type CT = {
  estimateStandupCost: () => Promise<number>
  getLlmUsage: () => Promise<{ totalCostUsd: number; totalCalls: number }>
  generateStandup: (c: boolean) => Promise<StandupReport & { error?: string }>
  onStandupChunk: (cb: (chunk: string) => void) => () => void
}

function ct(): CT { return (window as unknown as { claudetop: CT }).claudetop }

export function StandupPanel() {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle')
  const [report, setReport] = useState<StandupReport | null>(null)
  const [error, setError] = useState('')
  const [estCost, setEstCost] = useState(0)
  const [llmUsage, setLlmUsage] = useState<{ totalCostUsd: number; totalCalls: number } | null>(null)
  const [streamText, setStreamText] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)

  async function onGenerate() {
    const [cost, usage] = await Promise.all([ct().estimateStandupCost(), ct().getLlmUsage()])
    setEstCost(cost); setLlmUsage(usage); setPhase('confirm')
  }

  async function onConfirm() {
    setStreamText('')
    setPhase('loading')
    const result = await ct().generateStandup(true)
    if (result.error) {
      setError(result.error)
      setPhase('error')
    } else {
      setReport(result); setPhase('done')
    }
  }

  // Subscribe to streaming chunks during loading
  useEffect(() => {
    if (phase !== 'loading') return
    const unsub = ct().onStandupChunk((chunk) => {
      setStreamText((prev) => prev + chunk)
      // Auto-scroll
      setTimeout(() => {
        if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
      }, 0)
    })
    return unsub
  }, [phase])

  return (
    <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 'bold' }}>Agent Standup</span>
        {(phase === 'idle' || phase === 'done' || phase === 'error') && (
          <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }} onClick={onGenerate}>
            {phase === 'done' ? '↻ Regenerate' : '✨ Generate'}
          </button>
        )}
      </div>

      {phase === 'confirm' && (
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <div>Estimated cost: <span style={{ color: '#f6ad55' }}>${estCost.toFixed(2)}</span></div>
            {llmUsage && <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>Total claudetop LLM spend: ${llmUsage.totalCostUsd.toFixed(2)} ({llmUsage.totalCalls} calls)</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }} onClick={onConfirm}>Confirm</button>
            <button className="kill-btn" onClick={() => setPhase('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div>
          <div style={{ color: '#555', fontSize: 11, marginBottom: 8 }}>Generating via Claude CLI...</div>
          {streamText ? (
            <div ref={streamRef} style={{
              background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4,
              padding: '10px 12px', fontFamily: 'monospace', fontSize: 11,
              color: '#68d391', lineHeight: 1.6, maxHeight: 300, overflowY: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {streamText}
              <span style={{ display: 'inline-block', width: 8, height: 12, background: '#68d391', marginLeft: 2, animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom' }} />
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '20px 0' }}>Waiting for response...</div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="empty-state" style={{ color: '#fc8181' }}>
          {error}
        </div>
      )}

      {phase === 'done' && report && (
        <>
          {report.done.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#68d391', fontWeight: 'bold', marginBottom: 8 }}>✅ Done (last 24h)</div>
              {report.done.map((d) => (
                <div key={d.project} style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                  <span style={{ color: '#4a9eff', flexShrink: 0, width: 200 }}>{d.project}</span>
                  <span style={{ color: '#a0aec0' }}>{d.summary}</span>
                  <span style={{ color: '#444', fontSize: 11, flexShrink: 0 }}>${d.costUsd.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          {report.inProgress && report.inProgress.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#f6ad55', fontWeight: 'bold', marginBottom: 8 }}>🔄 In Progress</div>
              {report.inProgress.map((p, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: '#4a9eff', display: 'inline-block', width: 200 }}>{p.project}</span>
                  <span style={{ color: '#888' }}>{p.runtimeMinutes}m · {p.model ?? 'unknown model'}{p.branch ? ` · ${p.branch}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          {report.nextUp && report.nextUp.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#4a9eff', fontWeight: 'bold', marginBottom: 8 }}>🔜 Next Up</div>
              {report.nextUp.map((n, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: '#4a9eff', display: 'inline-block', width: 200 }}>{n.project}</span>
                  <span style={{ color: '#a0aec0' }}>{n.description}</span>
                </div>
              ))}
            </div>
          )}
          {report.blockers.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#fc8181', fontWeight: 'bold', marginBottom: 8 }}>⚠️ Blockers</div>
              {report.blockers.map((b, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: '#4a9eff', display: 'inline-block', width: 200 }}>{b.project}</span>
                  <span style={{ color: '#fc8181' }}>{b.description}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ color: '#333', fontSize: 11, borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
            {new Date(report.generatedAt).toLocaleString()} · {report.llmUsage.inputTokens + report.llmUsage.outputTokens} tokens (${report.llmUsage.estimatedCostUsd.toFixed(2)})
          </div>
        </>
      )}

      {phase === 'idle' && (
        <div className="empty-state">Click "Generate" for an AI-powered standup<br /><span style={{ fontSize: 11 }}>Done / In Progress / Blockers for the last 24h · uses Claude CLI auth</span></div>
      )}
    </div>
  )
}

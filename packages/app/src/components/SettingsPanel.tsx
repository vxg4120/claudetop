import React, { useState, useEffect } from 'react'

interface Settings {
  anthropicApiKey?: string
  claudeSessionKey?: string
  alertThresholds?: {
    tpmThreshold: number
    costPerHourThreshold: number
    alertCooldownMs: number
  }
}

interface PermissionStatus {
  notifications: 'granted' | 'denied' | 'not-determined' | 'unsupported'
  processAccess: boolean   // can we read process list
  claudeDir: boolean       // can we read ~/.claude/
}

type CT = {
  getSettings: () => Promise<Settings>
  setSettings: (patch: Record<string, unknown>) => Promise<boolean>
  getPermissionStatus: () => Promise<PermissionStatus>
  openSystemPreferences: (pane: string) => Promise<void>
  testNotification: () => Promise<boolean>
}
function ct(): CT { return (window as unknown as { claudetop: CT }).claudetop }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1a1a1a' }}>
      <div style={{ width: 180, flexShrink: 0 }}>
        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: ok ? '#68d391' : '#fc8181' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? '#68d391' : '#fc8181', display: 'inline-block' }} />
      {label}
    </span>
  )
}

export function SettingsPanel() {
  const [settings, setSettingsState] = useState<Settings>({})
  const [perms, setPerms] = useState<PermissionStatus | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [tpm, setTpm] = useState(20000)
  const [costPerHr, setCostPerHr] = useState(0.5)
  const [cooldownMin, setCooldownMin] = useState(2)

  useEffect(() => {
    ct().getSettings().then((s) => {
      setSettingsState(s)
      if (s.alertThresholds) {
        setTpm(s.alertThresholds.tpmThreshold)
        setCostPerHr(s.alertThresholds.costPerHourThreshold)
        setCooldownMin(Math.round(s.alertThresholds.alertCooldownMs / 60_000))
      }
    })
    ct().getPermissionStatus().then(setPerms)
  }, [])

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return
    await ct().setSettings({ anthropicApiKey: apiKeyInput.trim() })
    setApiKeyInput('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function saveThresholds() {
    await ct().setSettings({
      alertThresholds: {
        tpmThreshold: tpm,
        costPerHourThreshold: costPerHr,
        alertCooldownMs: cooldownMin * 60_000,
      }
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function clearApiKey() {
    await ct().setSettings({ anthropicApiKey: undefined })
    setSettingsState((s) => ({ ...s, anthropicApiKey: undefined }))
  }

  return (
    <div style={{ padding: 24, flex: 1, overflowY: 'auto', maxWidth: 720 }}>
      <div style={{ fontWeight: 'bold', fontSize: 15, marginBottom: 24 }}>Settings</div>

      {/* Permissions section */}
      <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>System Permissions</div>

      <Row label="Desktop Notifications">
        <div style={{ marginBottom: 8 }}>
          {perms ? (
            <StatusDot
              ok={perms.notifications === 'granted'}
              label={perms.notifications === 'granted' ? 'Granted' : perms.notifications === 'denied' ? 'Denied' : 'Not set'}
            />
          ) : <span style={{ color: '#555', fontSize: 12 }}>Checking...</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
          {perms?.notifications !== 'granted' && (
            <button className="kill-btn" onClick={() => ct().openSystemPreferences('notifications')}>
              Open System Settings → Notifications
            </button>
          )}
          <button className="kill-btn" onClick={() => ct().testNotification()}>
            Test Notification
          </button>
        </div>
        <div style={{ color: '#444', fontSize: 11, marginTop: 6 }}>Required for burn rate and scope warning alerts.</div>
      </Row>

      <Row label="Process Access">
        <div style={{ marginBottom: 8 }}>
          {perms ? (
            <StatusDot ok={perms.processAccess} label={perms.processAccess ? 'Working' : 'Limited — grant Full Disk Access'} />
          ) : <span style={{ color: '#555', fontSize: 12 }}>Checking...</span>}
        </div>
        {perms && !perms.processAccess && (
          <button className="kill-btn" onClick={() => ct().openSystemPreferences('privacy-full-disk-access')}>
            Open System Settings → Privacy → Full Disk Access
          </button>
        )}
        <div style={{ color: '#444', fontSize: 11, marginTop: 6 }}>Used to read process CWDs via lsof for project names and scope warnings.</div>
      </Row>

      <Row label="Claude Directory">
        <div style={{ marginBottom: 8 }}>
          {perms ? (
            <StatusDot ok={perms.claudeDir} label={perms.claudeDir ? '~/.claude/ readable' : '~/.claude/ not found'} />
          ) : <span style={{ color: '#555', fontSize: 12 }}>Checking...</span>}
        </div>
        <div style={{ color: '#444', fontSize: 11 }}>Session JSONL files, used for analytics and standup generation.</div>
      </Row>

      {/* Alert thresholds */}
      <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 }}>Alert Thresholds</div>

      <Row label="Token Burn Rate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <input
            type="number" min={1000} step={1000}
            value={tpm}
            onChange={(e) => setTpm(Number(e.target.value))}
            style={{ width: 100, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', color: '#e2e8f0', fontSize: 12 }}
          />
          <span style={{ color: '#666', fontSize: 12 }}>tokens / minute</span>
        </div>
        <div style={{ color: '#444', fontSize: 11 }}>Alert when any session exceeds this rate. Default: 20,000 tok/min.</div>
      </Row>

      <Row label="Cost Burn Rate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: '#666', fontSize: 12 }}>$</span>
          <input
            type="number" min={0.1} step={0.1}
            value={costPerHr}
            onChange={(e) => setCostPerHr(Number(e.target.value))}
            style={{ width: 80, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', color: '#e2e8f0', fontSize: 12 }}
          />
          <span style={{ color: '#666', fontSize: 12 }}>/ hour</span>
        </div>
        <div style={{ color: '#444', fontSize: 11 }}>Alert when projected hourly cost exceeds this. Default: $0.50/hr.</div>
      </Row>

      <Row label="Alert Cooldown">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <input
            type="number" min={1} max={60}
            value={cooldownMin}
            onChange={(e) => setCooldownMin(Number(e.target.value))}
            style={{ width: 60, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', color: '#e2e8f0', fontSize: 12 }}
          />
          <span style={{ color: '#666', fontSize: 12 }}>minutes between repeat alerts</span>
        </div>
        <div style={{ color: '#444', fontSize: 11 }}>Prevents the same session from alerting more than once per interval. Default: 2 min.</div>
      </Row>

      <div style={{ marginBottom: 24 }}>
        <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }} onClick={saveThresholds}>
          Save Thresholds
        </button>
        {saved && <span style={{ color: '#68d391', fontSize: 12, marginLeft: 10 }}>Saved</span>}
      </div>

      {/* API key section */}
      <div style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>API Key (Optional)</div>

      <Row label="Anthropic API Key">
        {settings.anthropicApiKey ? (
          <div>
            <StatusDot ok={true} label="Configured" />
            <button className="kill-btn" style={{ marginLeft: 12, fontSize: 11 }} onClick={clearApiKey}>Clear</button>
            <div style={{ color: '#444', fontSize: 11, marginTop: 6 }}>Used as fallback if the Claude CLI is unavailable.</div>
          </div>
        ) : (
          <div>
            <div style={{ color: '#555', fontSize: 12, marginBottom: 8 }}>Not set — Claude CLI auth is used by default (recommended).</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password" placeholder="sk-ant-api03-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
                style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, padding: '6px 10px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}
              />
              <button className="kill-btn" style={{ background: '#1d3a1d', color: '#68d391' }} onClick={saveApiKey}>Save</button>
            </div>
            <div style={{ color: '#333', fontSize: 11, marginTop: 6 }}>Stored in ~/.claudetop/settings.json</div>
          </div>
        )}
      </Row>
    </div>
  )
}

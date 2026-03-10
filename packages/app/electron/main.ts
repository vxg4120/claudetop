import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, net, Notification, systemPreferences, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { Worker } from 'worker_threads'
import { listProcesses, killProcess, securityScan, watchProcesses } from '@claudetop/core'
import {
  openDb, querySessions, getCostReport, getDefaultDbPath,
  generateStandup, estimateInsightCost, getLlmUsageSummary,
  watchTokenBurnRate, BurnAlert, summarizeSession, analyzeRunawayProcess, checkScopeWarnings,
} from '@claudetop/core'

// ~/.claudetop/settings.json for user-configured preferences (e.g. API key)
function getSettingsPath() {
  return path.join(os.homedir(), '.claudetop', 'settings.json')
}
function readSettings(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')) } catch { return {} }
}
function writeSettings(settings: Record<string, unknown>): void {
  const dir = path.dirname(getSettingsPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

app.setName('claudetop')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

let analyticsDb: ReturnType<typeof openDb> | null = null

function getDb() {
  if (!analyticsDb) analyticsDb = openDb()
  return analyticsDb
}

function startIndexWorker() {
  const workerPath = path.join(__dirname, 'indexer.worker.js')
  if (!fs.existsSync(workerPath)) return
  const worker = new Worker(workerPath, { workerData: { dbPath: getDefaultDbPath() } })
  worker.on('message', (msg: { type: string; count: number }) => {
    if (msg.type === 'done') {
      console.log(`[indexer] Indexed ${msg.count} new sessions`)
      mainWindow?.webContents.send('indexing-complete', msg.count)
    }
  })
  worker.on('error', (err) => console.error('[indexer] Worker error:', err))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    const port = process.env.VITE_PORT ?? '5173'
    mainWindow.loadURL(`http://localhost:${port}`)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function setupTray() {
  // Create a simple tray icon (16x16 transparent)
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('claudetop')
  tray.on('click', () => mainWindow?.show())
}

function setupIPC() {
  ipcMain.handle('list-processes', () => listProcesses())
  ipcMain.handle('kill-process', (_event, pid: number, signal?: string) => {
    const safeSignal: 'SIGTERM' | 'SIGKILL' = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
    killProcess(pid, safeSignal)
  })
  ipcMain.handle('security-scan', (_event, pid?: number) => securityScan(pid))

  ipcMain.handle('get-sessions', (_event, filter: Record<string, unknown>) => {
    try {
      if (filter?.since) filter.since = filter.since instanceof Date ? filter.since : new Date(filter.since as string)
      if (filter?.until) filter.until = filter.until instanceof Date ? filter.until : new Date(filter.until as string)
      const sessions = querySessions(getDb(), filter as Parameters<typeof querySessions>[1])
      // Serialize Date objects to ISO strings so the renderer gets plain strings
      return sessions.map((s) => ({
        ...s,
        startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
        endedAt:   s.endedAt   instanceof Date ? s.endedAt.toISOString()   : s.endedAt,
      }))
    } catch (err) {
      console.error('[get-sessions] error:', err)
      throw err
    }
  })
  ipcMain.handle('get-cost-report', (_event, filter: Record<string, unknown>) => {
    if (filter?.since) filter.since = new Date(filter.since as string)
    if (filter?.until) filter.until = new Date(filter.until as string)
    return getCostReport(getDb(), filter as Parameters<typeof getCostReport>[1])
  })
  ipcMain.handle('estimate-standup-cost', () => estimateInsightCost(2000))
  ipcMain.handle('generate-standup', async (_event, confirmed: boolean) => {
    if (!confirmed) return { error: 'Not confirmed', estimatedCost: estimateInsightCost(2000) }
    try {
      return await generateStandup(getDb(), (chunk) => {
        mainWindow?.webContents.send('standup-chunk', chunk)
      })
    }
    catch (err: unknown) { return { error: err instanceof Error ? err.message : String(err) } }
  })
  ipcMain.handle('get-llm-usage', () => getLlmUsageSummary(getDb()))
  ipcMain.handle('get-permission-status', async () => {
    let notificationStatus: string = 'unsupported'
    if (Notification.isSupported()) {
      // On macOS, Electron manages notification permission via the OS automatically.
      // We infer granted if Notification.isSupported() — actual permission is requested on first notify.
      notificationStatus = 'not-determined'
      try {
        // Try posting a silent test — if it doesn't throw, permission is likely granted
        const test = new Notification({ title: '', body: '', silent: true })
        void test // just constructing is enough to check
        notificationStatus = 'granted'
      } catch { notificationStatus = 'denied' }
    }
    let processAccess = false
    try {
      const procs = await listProcesses()
      processAccess = procs.some((p) => p.cwd && p.cwd.startsWith('/'))
    } catch { /* no access */ }
    const claudeDir = fs.existsSync(path.join(os.homedir(), '.claude'))
    return { notifications: notificationStatus, processAccess, claudeDir }
  })
  ipcMain.handle('open-system-preferences', async (_event, pane: string) => {
    const urls: Record<string, string> = {
      'notifications': 'x-apple.systempreferences:com.apple.preference.notifications',
      'privacy-full-disk-access': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    }
    await shell.openExternal(urls[pane] ?? 'x-apple.systempreferences:')
  })
  ipcMain.handle('check-scope-warnings', async (_event, cwds: string[]) => {
    return checkScopeWarnings(cwds)
  })
  ipcMain.handle('analyze-process', async (_event, p: Parameters<typeof analyzeRunawayProcess>[0]) => {
    try { return await analyzeRunawayProcess(p) }
    catch (err: unknown) { return { assessment: 'error', explanation: err instanceof Error ? err.message : String(err), recommendation: 'investigate' } }
  })
  ipcMain.handle('summarize-session', async (_event, sessionId: string) => {
    try { return { summary: await summarizeSession(sessionId) } }
    catch (err: unknown) { return { error: err instanceof Error ? err.message : String(err) } }
  })
  ipcMain.handle('refresh-index', () => { startIndexWorker(); return true })
  ipcMain.handle('get-settings', () => readSettings())
  ipcMain.handle('set-settings', (_event, patch: Record<string, unknown>) => {
    writeSettings({ ...readSettings(), ...patch })
    return true
  })
  ipcMain.handle('test-notification', () => {
    notify('claudetop', 'Desktop notifications are working!')
    return true
  })

  ipcMain.handle('get-usage-limits', async () => {
    // Prefer sessionKey cookie from settings (set by user from browser DevTools)
    const settings = readSettings()
    const sessionKey = settings.claudeSessionKey as string | undefined

    if (!sessionKey) return { error: 'No session key configured', source: null }

    const headers: Record<string, string> = {
      'Cookie': `sessionKey=${sessionKey}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://claude.ai/',
      'Origin': 'https://claude.ai',
    }

    // Get org UUID first
    let orgUuid: string | null = null
    try {
      const res = await net.fetch('https://claude.ai/api/organizations', { headers })
      console.log(`[usage] /api/organizations → ${res.status}`)
      if (res.ok) {
        const orgs = await res.json() as Array<{ uuid?: string; id?: string }>
        orgUuid = orgs?.[0]?.uuid ?? orgs?.[0]?.id ?? null
        console.log(`[usage] orgUuid = ${orgUuid}`)
      }
    } catch (e) { console.log('[usage] orgs error:', e) }

    const urlsToTry = [
      ...(orgUuid ? [`https://claude.ai/api/organizations/${orgUuid}/rate_limits`] : []),
      'https://claude.ai/api/rate_limits',
    ]
    for (const url of urlsToTry) {
      try {
        const res = await net.fetch(url, { headers })
        console.log(`[usage] ${url} → ${res.status}`)
        if (res.ok) {
          const data = await res.json()
          return { data, source: url }
        }
      } catch (e) { console.log(`[usage] ${url} error:`, e) }
    }

    return { error: 'Session key may be invalid or expired — please re-enter it', source: null }
  })
}

const notifiedOrphans = new Set<string>()

function setupWatcher() {
  watchProcesses(2000, (processes) => {
    const runawayCount = processes.filter((p) => p.isRunaway || p.isOrphaned).length
    tray?.setTitle(runawayCount > 0 ? `${runawayCount}` : '')
    mainWindow?.webContents.send('process-update', processes)

    // Notify about newly detected orphaned subprocesses
    for (const p of processes.filter((x) => x.isOrphaned)) {
      const key = `${p.cwd}:${p.name}`
      if (!notifiedOrphans.has(key)) {
        notifiedOrphans.add(key)
        const label = p.project ?? p.cwd
        notify('👻 Orphaned Subprocess', `${p.name} in ${label} is still running — Claude parent exited`)
      }
    }
  })
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

function setupTokenMonitor() {
  watchTokenBurnRate(
    { tpmThreshold: 20_000, costPerHourThreshold: 0.5, pollIntervalMs: 15_000, alertCooldownMs: 120_000 },
    (alert: BurnAlert) => {
      mainWindow?.webContents.send('token-burn-alert', alert)
      const project = alert.project.replace(/^-/, '').split('-').filter(Boolean).slice(-2).join('/')
      if (alert.alertType === 'session-cost-exceeded') {
        notify('💸 Session Cost Exceeded', `${project}: $${alert.sessionTotalCostUsd?.toFixed(2) ?? '?'} total · ${alert.tokensPerMinute.toLocaleString()} tok/min`)
      } else if (alert.alertType === 'sustained-rate') {
        notify('🔥 Sustained High Token Burn', `${project}: ${alert.tokensPerMinute.toLocaleString()} tok/min for ${alert.consecutiveHighWindows ?? '?'}+ windows · $${alert.costPerHour.toFixed(2)}/hr`)
      } else {
        notify('⚡ High Token Burn Rate', `${project}: ${alert.tokensPerMinute.toLocaleString()} tok/min · $${alert.costPerHour.toFixed(2)}/hr`)
      }
    }
  )
}

function setupScopeMonitor() {
  const notified = new Set<string>()

  async function check() {
    let processes: Awaited<ReturnType<typeof listProcesses>>
    try { processes = await listProcesses() } catch { return }
    const cwds = [...new Set(processes.map((p) => p.cwd).filter((c) => c && c.startsWith('/')))]
    if (cwds.length === 0) return

    const warnings = await checkScopeWarnings(cwds)
    for (const w of warnings) {
      if (notified.has(w.cwd)) continue
      // Only notify for warning/critical
      if (w.severity === 'info') continue
      notified.add(w.cwd)
      mainWindow?.webContents.send('scope-warning', w)
      notify(
        w.severity === 'critical' ? '🔴 claudetop: Scope Warning' : '⚠️ claudetop: Scope Warning',
        `${w.project}: ${w.headline}`
      )
    }
  }

  // Check after a short delay so processes are loaded, then every 5 minutes
  setTimeout(check, 10_000)
  setInterval(check, 5 * 60_000)
}

app.whenReady().then(() => {
  createWindow()
  setupTray()
  setupIPC()
  setupWatcher()
  setupTokenMonitor()
  setupScopeMonitor()
  startIndexWorker()
})

app.on('before-quit', () => { analyticsDb?.close() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

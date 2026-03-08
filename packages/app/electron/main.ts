import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import * as path from 'path'
import { listProcesses, killProcess, securityScan, watchProcesses } from '@claudetop/core'
import {
  openDb, buildIndex, querySessions, getCostReport,
  generateStandup, estimateInsightCost, getLlmUsageSummary,
} from '@claudetop/core'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

let analyticsDb: ReturnType<typeof openDb> | null = null

function getDb() {
  if (!analyticsDb) {
    analyticsDb = openDb()
    buildIndex(analyticsDb)
  }
  return analyticsDb
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
    mainWindow.loadURL('http://localhost:5173')
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
    killProcess(pid, (signal as 'SIGTERM' | 'SIGKILL') ?? 'SIGTERM')
  })
  ipcMain.handle('security-scan', (_event, pid?: number) => securityScan(pid))

  ipcMain.handle('get-sessions', (_event, filter: unknown) =>
    querySessions(getDb(), filter as Parameters<typeof querySessions>[1]))
  ipcMain.handle('get-cost-report', (_event, filter: unknown) =>
    getCostReport(getDb(), filter as Parameters<typeof getCostReport>[1]))
  ipcMain.handle('estimate-standup-cost', () => estimateInsightCost(2000))
  ipcMain.handle('generate-standup', async (_event, confirmed: boolean) => {
    if (!confirmed) return { error: 'Not confirmed', estimatedCost: estimateInsightCost(2000) }
    try { return await generateStandup(getDb()) }
    catch (err: unknown) { return { error: err instanceof Error ? err.message : String(err) } }
  })
  ipcMain.handle('get-llm-usage', () => getLlmUsageSummary(getDb()))
  ipcMain.handle('refresh-index', () => { buildIndex(getDb()); return true })
}

function setupWatcher() {
  watchProcesses(2000, (processes) => {
    const runawayCount = processes.filter((p) => p.isRunaway).length
    tray?.setTitle(runawayCount > 0 ? `${runawayCount}` : '')
    mainWindow?.webContents.send('process-update', processes)
  })
}

app.whenReady().then(() => {
  createWindow()
  setupTray()
  setupIPC()
  setupWatcher()
})

app.on('before-quit', () => { analyticsDb?.close() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

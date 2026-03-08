import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import * as path from 'path'
import { listProcesses, killProcess, securityScan, watchProcesses } from '@claudetop/core'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

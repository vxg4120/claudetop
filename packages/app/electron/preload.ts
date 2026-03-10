import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('claudetop', {
  // Existing
  listProcesses: () => ipcRenderer.invoke('list-processes'),
  killProcess: (pid: number, signal?: string) => ipcRenderer.invoke('kill-process', pid, signal),
  securityScan: (pid?: number) => ipcRenderer.invoke('security-scan', pid),
  onProcessUpdate: (callback: (processes: unknown[]) => void) => {
    ipcRenderer.on('process-update', (_event, processes) => callback(processes))
    return () => ipcRenderer.removeAllListeners('process-update')
  },
  // v2
  getSessions: (filter: unknown) => ipcRenderer.invoke('get-sessions', filter),
  getCostReport: (filter: unknown) => ipcRenderer.invoke('get-cost-report', filter),
  estimateStandupCost: () => ipcRenderer.invoke('estimate-standup-cost'),
  generateStandup: (confirmed: boolean) => ipcRenderer.invoke('generate-standup', confirmed),
  getLlmUsage: () => ipcRenderer.invoke('get-llm-usage'),
  refreshIndex: () => ipcRenderer.invoke('refresh-index'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('set-settings', patch),
  getUsageLimits: () => ipcRenderer.invoke('get-usage-limits'),
  getPermissionStatus: () => ipcRenderer.invoke('get-permission-status'),
  openSystemPreferences: (pane: string) => ipcRenderer.invoke('open-system-preferences', pane),
  checkScopeWarnings: (cwds: string[]) => ipcRenderer.invoke('check-scope-warnings', cwds),
  analyzeProcess: (p: unknown) => ipcRenderer.invoke('analyze-process', p),
  summarizeSession: (sessionId: string) => ipcRenderer.invoke('summarize-session', sessionId),
  onTokenBurnAlert: (callback: (alert: unknown) => void) => {
    ipcRenderer.on('token-burn-alert', (_event, alert) => callback(alert))
    return () => ipcRenderer.removeAllListeners('token-burn-alert')
  },
  onScopeWarning: (callback: (warning: unknown) => void) => {
    ipcRenderer.on('scope-warning', (_event, warning) => callback(warning))
    return () => ipcRenderer.removeAllListeners('scope-warning')
  },
  onStandupChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('standup-chunk', (_event, chunk) => callback(chunk))
    return () => ipcRenderer.removeAllListeners('standup-chunk')
  },
  testNotification: () => ipcRenderer.invoke('test-notification'),
})

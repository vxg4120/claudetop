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
})

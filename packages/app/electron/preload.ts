import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('claudetop', {
  listProcesses: () => ipcRenderer.invoke('list-processes'),
  killProcess: (pid: number, signal?: string) => ipcRenderer.invoke('kill-process', pid, signal),
  securityScan: (pid?: number) => ipcRenderer.invoke('security-scan', pid),
  onProcessUpdate: (callback: (processes: unknown[]) => void) => {
    ipcRenderer.on('process-update', (_event, processes) => callback(processes))
    return () => ipcRenderer.removeAllListeners('process-update')
  },
})

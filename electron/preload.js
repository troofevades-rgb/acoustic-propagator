const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openWavFile: () => ipcRenderer.invoke('open-wav-file'),
  openKmzFile: () => ipcRenderer.invoke('open-kmz-file'),
  saveSession: (data) => ipcRenderer.invoke('save-session', data),
  loadSession: () => ipcRenderer.invoke('load-session'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveScreenshot: (dataUrl) => ipcRenderer.invoke('save-screenshot', dataUrl),
});

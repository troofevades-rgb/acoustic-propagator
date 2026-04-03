const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openWavFile: () => ipcRenderer.invoke("open-wav-file"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  loadConfig: () => ipcRenderer.invoke("load-config"),
});

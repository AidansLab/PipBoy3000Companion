const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pipboyApi', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  flashFirmware: () => ipcRenderer.invoke('flash-firmware'),
  onLog: (callback) => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('status', handler);
    return () => ipcRenderer.removeListener('status', handler);
  },
});

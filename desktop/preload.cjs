const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('closedcodeDesktop', Object.freeze({
  getConnection: () => ipcRenderer.invoke('closedcode:get-connection'),
  chooseDirectory: () => ipcRenderer.invoke('closedcode:choose-directory'),
  getVersion: () => ipcRenderer.invoke('closedcode:get-version'),
  openLocalPreview: (url) => ipcRenderer.invoke('closedcode:open-local-preview', url),
}));

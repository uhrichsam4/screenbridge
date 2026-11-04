'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenbridge', {
  getState: () => ipcRenderer.invoke('get-state'),
  startShare: () => ipcRenderer.invoke('start-share'),
  stopShare: () => ipcRenderer.invoke('stop-share'),
  newPassword: () => ipcRenderer.invoke('new-password'),
  openSettings: (kind) => ipcRenderer.invoke('open-settings', kind),
  connect: (address, password, gameMode) => ipcRenderer.invoke('connect', { address, password, gameMode }),
  onShareEvent: (cb) => {
    ipcRenderer.on('share-event', (_e, msg) => cb(msg));
  },
});

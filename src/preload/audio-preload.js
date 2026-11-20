const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lecternAudio', {
  init: () => ipcRenderer.invoke('audio/init'),
  onConfig(cb) { ipcRenderer.on('audio/config', (_e, c) => cb(c)); },
  onAudio(cb) { ipcRenderer.on('input/audio', (_e, m) => cb(m)); },
});

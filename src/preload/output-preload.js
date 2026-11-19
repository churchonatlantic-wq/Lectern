const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lecternOutput', {
  init: () => ipcRenderer.invoke('output/init'),
  onRender(cb) {
    ipcRenderer.on('render', (_e, payload) => cb(payload));
  },
});

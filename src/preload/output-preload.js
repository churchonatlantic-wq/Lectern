const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lecternOutput', {
  init: () => ipcRenderer.invoke('output/init'),
  onRender(cb) {
    ipcRenderer.on('render', (_e, payload) => cb(payload));
  },
});
// Full-size NDI input frames for the inputs this window shows.
contextBridge.exposeInMainWorld('lecternInput', {
  want: (ids) => ipcRenderer.send('input/want', ids),
  onFrame(cb) { ipcRenderer.on('input/frame', (_e, f) => cb(f)); },
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lectern', {
  async action(type, payload) {
    const r = await ipcRenderer.invoke('action', { type, payload });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  onState(cb) {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.removeListener('state', h);
  },
});

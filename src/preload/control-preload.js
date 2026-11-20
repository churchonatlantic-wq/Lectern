const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  onEvent(cb) {
    const h = (_e, ev) => cb(ev);
    ipcRenderer.on('event', h);
    return () => ipcRenderer.removeListener('event', h);
  },
  // Path of a file dropped from the desktop.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
// Small NDI input previews for the Inputs panel and monitors.
contextBridge.exposeInMainWorld('lecternInput', {
  want: (ids) => ipcRenderer.send('input/preview-want', ids),
  onFrame(cb) { ipcRenderer.on('input/preview', (_e, f) => cb(f)); },
});

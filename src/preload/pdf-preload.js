const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lecternPdf', {
  data: () => ipcRenderer.invoke('pdf/data'),
  page: (n, png) => ipcRenderer.invoke('pdf/page', n, png),
  done: (count) => ipcRenderer.send('pdf/done', count),
  fail: (message) => ipcRenderer.send('pdf/fail', message),
});

const { app, BrowserWindow, ipcMain, dialog, protocol, net, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Slides = require('../common/slides');
const bible = require('./bible');
const { Store, uid, LOOK_DEFAULTS } = require('./store');
const { OutputManager } = require('./outputs');
const { RemoteServer } = require('./remote');
const ndi = require('./ndi');

protocol.registerSchemesAsPrivileged([
  { scheme: 'lectern', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

// Offscreen outputs must keep rendering while the app is in the background.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.env.LECTERN_USER_DATA) app.setPath('userData', process.env.LECTERN_USER_DATA);

let store, outputs, remote, control;
const runtime = {
  live: { itemId: null, slide: 0 },
  layers: { slide: true, media: true, props: true, msg: false, stage: false },
  message: 'Overflow parking is open on Elm Street.',
  stageMessage: 'Wrap up · 2 minutes',
  timer: { durationMs: 35 * 60000, running: false, startedAt: 0, accumulatedMs: 0 },
  status: { outputs: [], ndi: null, displays: [], remote: null },
  usageLogged: new Set(),
  dirty: false,
};

function fullState() {
  const d = store.data;
  return {
    library: d.library, service: d.service, servicePath: d.servicePath, settings: d.settings, outputs: d.outputs, usageCount: d.usage.length,
    live: runtime.live, layers: runtime.layers, message: runtime.message, stageMessage: runtime.stageMessage, timer: runtime.timer,
    status: runtime.status, media: store.listMedia(), dirty: runtime.dirty, platform: process.platform,
  };
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    const st = fullState();
    if (control && !control.isDestroyed()) control.webContents.send('state', st);
    const rs = Slides.buildRenderState(st);
    outputs.broadcast('render', { rs, outputs: st.outputs });
  });
}

function changed({ persist = false, dirty = false } = {}) {
  if (persist) store.save();
  if (dirty) runtime.dirty = true;
  broadcast();
}

// ---------- live helpers ----------
const items = () => store.data.service.items;
const slidesOf = (it) => Slides.itemSlides(it, store.data.library);

function goLive(itemId, slide) {
  const it = items().find((x) => x.id === itemId);
  if (!it) return;
  const n = slidesOf(it).length;
  runtime.live = { itemId, slide: Math.max(0, Math.min(slide | 0, Math.max(0, n - 1))) };
  runtime.layers.slide = true;
  if (it.type === 'song' && !runtime.usageLogged.has(it.songId)) {
    runtime.usageLogged.add(it.songId);
    const song = store.data.library.songs.find((s) => s.id === it.songId);
    if (song) { store.data.usage.push({ date: new Date().toISOString(), title: song.title, author: song.author || '', ccli: song.ccli || '' }); store.save(); }
  }
  changed();
}

function step(dir) {
  const list = items();
  let i = list.findIndex((x) => x.id === runtime.live.itemId);
  if (i < 0) { if (list.length && dir > 0) goLive(list[0].id, 0); return; }
  let s = runtime.live.slide + dir;
  const n = slidesOf(list[i]).length;
  if (s >= 0 && s < n) return goLive(list[i].id, s);
  // move across items, skipping empty ones
  for (i += dir; i >= 0 && i < list.length; i += dir) {
    const m = slidesOf(list[i]).length;
    if (m) return goLive(list[i].id, dir > 0 ? 0 : m - 1);
  }
}

function timerElapsed(t) { return t.accumulatedMs + (t.running ? Date.now() - t.startedAt : 0); }

// ---------- service files ----------
async function saveServiceAs() {
  const r = await dialog.showSaveDialog(control, {
    title: 'Save service', defaultPath: (store.data.service.name || 'Service') + '.lectern',
    filters: [{ name: 'Lectern service', extensions: ['lectern'] }],
  });
  if (r.canceled || !r.filePath) return false;
  store.data.servicePath = r.filePath;
  return writeService(r.filePath);
}
function writeService(file) {
  // A service file is self-contained: it embeds the songs it uses.
  const used = new Set(items().filter((i) => i.type === 'song').map((i) => i.songId));
  const songs = store.data.library.songs.filter((s) => used.has(s.id));
  fs.writeFileSync(file, JSON.stringify({ format: 'lectern-service', version: 1, service: store.data.service, songs }, null, 1));
  runtime.dirty = false;
  store.save();
  return true;
}
async function confirmDiscard() {
  if (!runtime.dirty) return true;
  const r = await dialog.showMessageBox(control, {
    type: 'question', buttons: ['Save', 'Don’t save', 'Cancel'], defaultId: 0, cancelId: 2,
    message: 'Save changes to “' + store.data.service.name + '”?',
  });
  if (r.response === 2) return false;
  if (r.response === 0) return store.data.servicePath ? writeService(store.data.servicePath) : saveServiceAs();
  return true;
}
async function openService(file) {
  if (!file) {
    const r = await dialog.showOpenDialog(control, { title: 'Open service', properties: ['openFile'], filters: [{ name: 'Lectern service', extensions: ['lectern', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return;
    file = r.filePaths[0];
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.format !== 'lectern-service') throw new Error('That file is not a Lectern service.');
  const lib = store.data.library.songs;
  for (const s of j.songs || []) {
    const i = lib.findIndex((x) => x.id === s.id);
    if (i >= 0) lib[i] = s; else lib.push(s);
  }
  store.data.service = j.service;
  store.data.servicePath = file;
  runtime.live = { itemId: null, slide: 0 };
  runtime.dirty = false;
  runtime.usageLogged.clear();
  app.addRecentDocument(file);
  changed({ persist: true });
}

// ---------- media ----------
async function importMedia() {
  const r = await dialog.showOpenDialog(control, {
    title: 'Import media', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images and video', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'm4v', 'webm', 'mkv'] }],
  });
  if (r.canceled) return [];
  const added = [];
  for (const f of r.filePaths) {
    let name = path.basename(f).replace(/[^\w.\- ]+/g, '_');
    const ext = path.extname(name), base = name.slice(0, -ext.length);
    let n = 1;
    while (fs.existsSync(path.join(store.mediaDir, name))) name = base + ' (' + ++n + ')' + ext;
    fs.copyFileSync(f, path.join(store.mediaDir, name));
    added.push(name);
  }
  changed();
  return added;
}

// ---------- songs ----------
async function importSongs() {
  const r = await dialog.showOpenDialog(control, {
    title: 'Import songs (plain text)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (r.canceled) return 0;
  let count = 0;
  for (const f of r.filePaths) {
    const text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
    // SongSelect-style text: title on line 1, sections as "Verse 1" lines, CCLI line at the end.
    const lines = text.replace(/\r/g, '').split('\n');
    const title = (lines.shift() || path.basename(f, '.txt')).trim();
    let ccli = '', author = '', copyright = '';
    const body = [];
    for (const ln of lines) {
      const t = ln.trim();
      let m;
      if ((m = t.match(/^CCLI Song #?\s*(\d+)/i))) { ccli = m[1]; continue; }
      if (/^CCLI License/i.test(t) || /^For use solely with the SongSelect/i.test(t)) continue;
      if ((m = t.match(/^©\s*(.+)/))) { copyright = m[1]; continue; }
      if (/^(Verse|Chorus|Pre-?Chorus|Bridge|Tag|Intro|Outro|Ending|Interlude|Refrain|Instrumental)(\s*\d+)?$/i.test(t)) { body.push('', '[' + t + ']'); continue; }
      body.push(ln);
    }
    // The author line usually sits just before the CCLI number at the end.
    for (let i = body.length - 1; i >= 0; i--) {
      const t = body[i].trim();
      if (!t) continue;
      if (!t.startsWith('[') && /,| \| /.test(t) && i > body.length - 4) { author = t.replace(/\s\|\s/g, ', '); body.splice(i, 1); }
      break;
    }
    store.data.library.songs.push({ id: uid(), title, author, copyright, ccli, lyrics: body.join('\n').replace(/\n{3,}/g, '\n\n').trim(), arrangement: '' });
    count++;
  }
  changed({ persist: true });
  return count;
}

async function exportUsage() {
  const r = await dialog.showSaveDialog(control, { title: 'Export CCLI usage', defaultPath: 'ccli-usage.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return false;
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['Date', 'Title', 'Author', 'CCLI Song #'].map(q).join(',')].concat(store.data.usage.map((u) => [u.date.slice(0, 10), u.title, u.author, u.ccli].map(q).join(',')));
  fs.writeFileSync(r.filePath, rows.join('\r\n'));
  return true;
}

// ---------- action dispatcher ----------
async function dispatch(type, p = {}) {
  const d = store.data;
  const findItem = (id) => d.service.items.find((x) => x.id === id);
  switch (type) {
    case 'state/get': return fullState();

    case 'service/new':
      if (!(await confirmDiscard())) return false;
      d.service = { name: 'New Service', items: [] }; d.servicePath = null;
      runtime.live = { itemId: null, slide: 0 }; runtime.dirty = false; runtime.usageLogged.clear();
      changed({ persist: true }); return true;
    case 'service/open': if (!(await confirmDiscard())) return false; await openService(p.file); return true;
    case 'service/save': { const ok = d.servicePath ? writeService(d.servicePath) : await saveServiceAs(); changed(); return ok; }
    case 'service/saveAs': { const ok = await saveServiceAs(); changed(); return ok; }
    case 'service/rename': d.service.name = String(p.name || '').slice(0, 120) || 'Service'; changed({ persist: true, dirty: true }); return true;

    case 'item/add': {
      const it = { id: uid(), ...p.item };
      const at = p.after ? d.service.items.findIndex((x) => x.id === p.after) + 1 : d.service.items.length;
      d.service.items.splice(at || d.service.items.length, 0, it);
      changed({ persist: true, dirty: true }); return it.id;
    }
    case 'item/update': { const it = findItem(p.id); if (it) Object.assign(it, p.patch); changed({ persist: true, dirty: true }); return true; }
    case 'item/remove':
      d.service.items = d.service.items.filter((x) => x.id !== p.id);
      if (runtime.live.itemId === p.id) runtime.live = { itemId: null, slide: 0 };
      changed({ persist: true, dirty: true }); return true;
    case 'item/move': {
      const list = d.service.items, i = list.findIndex((x) => x.id === p.id);
      const j = p.to != null ? p.to : i + (p.dir || 0);
      if (i < 0 || j < 0 || j >= list.length) return false;
      const [it] = list.splice(i, 1); list.splice(j, 0, it);
      changed({ persist: true, dirty: true }); return true;
    }

    case 'song/save': {
      const s = { ...p.song };
      if (!s.title || !s.title.trim()) throw new Error('A song needs a title.');
      if (!s.id) { s.id = uid(); d.library.songs.push(s); } else {
        const i = d.library.songs.findIndex((x) => x.id === s.id);
        if (i >= 0) d.library.songs[i] = s; else d.library.songs.push(s);
      }
      changed({ persist: true }); return s.id;
    }
    case 'song/delete':
      if (d.service.items.some((x) => x.type === 'song' && x.songId === p.id)) throw new Error('This song is in the current service. Remove it from the service first.');
      d.library.songs = d.library.songs.filter((x) => x.id !== p.id); changed({ persist: true }); return true;
    case 'song/import': return importSongs();

    case 'bible/lookup': return bible.lookup(p.ref);
    case 'bible/books': return bible.bookNames();

    case 'live/go': {
      if (p.itemId) goLive(p.itemId, p.slide || 0);
      else if (p.itemIndex != null && items()[p.itemIndex]) goLive(items()[p.itemIndex].id, p.slide || 0);
      return true;
    }
    case 'live/next': step(1); return true;
    case 'live/prev': step(-1); return true;

    case 'layer/toggle': { const k = p.layer; if (k in runtime.layers) runtime.layers[k] = p.value != null ? !!p.value : !runtime.layers[k]; changed(); return true; }
    case 'layer/clearAll': Object.assign(runtime.layers, { slide: false, media: false, props: false, msg: false, stage: false }); changed(); return true;
    case 'layer/restore': Object.assign(runtime.layers, { slide: true, media: true, props: true }); changed(); return true;

    case 'message/set': runtime.message = String(p.text || '').slice(0, 300); if (p.show != null) runtime.layers.msg = !!p.show; changed(); return true;
    case 'stageMessage/set': runtime.stageMessage = String(p.text != null ? p.text : runtime.stageMessage).slice(0, 200); runtime.layers.stage = p.show != null ? !!p.show : true; changed(); return true;

    case 'timer/start': { const t = runtime.timer; if (!t.running) { t.running = true; t.startedAt = Date.now(); } changed(); return true; }
    case 'timer/stop': { const t = runtime.timer; if (t.running) { t.accumulatedMs = timerElapsed(t); t.running = false; } changed(); return true; }
    case 'timer/reset': Object.assign(runtime.timer, { running: false, accumulatedMs: 0, startedAt: 0 }); changed(); return true;
    case 'timer/duration': runtime.timer.durationMs = Math.max(1, Math.min(600, Number(p.minutes) || 35)) * 60000; d.settings.timerMinutes = runtime.timer.durationMs / 60000; changed({ persist: true }); return true;

    case 'output/update': {
      const o = d.outputs[p.index];
      if (!o) return false;
      const patch = { ...p.patch };
      if (patch.look && patch.look !== o.look && LOOK_DEFAULTS[patch.look]) Object.assign(patch, { ...LOOK_DEFAULTS[patch.look], ...p.patch });
      if (patch.name != null) patch.name = String(patch.name).replace(/[()]/g, '').slice(0, 40) || o.name;
      Object.assign(o, patch);
      changed({ persist: true });
      await outputs.runners[p.index].apply(o);
      return true;
    }
    case 'settings/update': {
      const before = d.settings;
      d.settings = { ...before, ...p.patch, theme: { ...before.theme, ...(p.patch.theme || {}) }, prop: { ...before.prop, ...(p.patch.prop || {}) } };
      changed({ persist: true });
      if ('ndiRuntimePath' in p.patch || 'ndiPrefix' in p.patch) await outputs.restartAllNdi();
      if ('remotePort' in p.patch || 'remotePin' in p.patch || 'remoteEnabled' in p.patch) startRemote();
      return true;
    }

    case 'media/import': return importMedia();
    case 'media/remove': {
      const f = path.join(store.mediaDir, path.basename(p.name));
      if (fs.existsSync(f)) fs.unlinkSync(f);
      changed(); return true;
    }
    case 'media/reveal': shell.showItemInFolder(path.join(store.mediaDir, path.basename(p.name || ''))); return true;

    case 'usage/export': return exportUsage();
    case 'usage/clear': d.usage = []; changed({ persist: true }); return true;
    case 'app/openExternal': if (/^https:\/\//.test(p.url)) shell.openExternal(p.url); return true;
    case 'app/retryNdi': await outputs.restartAllNdi(); return true;
    default: throw new Error('Unknown action ' + type);
  }
}

function startRemote() {
  const s = store.data.settings;
  if (s.remoteEnabled) remote.start(s.remotePort, s.remotePin); else remote.stop();
  setTimeout(() => { runtime.status.remote = s.remoteEnabled ? remote.info() : null; broadcast(); }, 300);
}

function refreshDisplays() {
  runtime.status.displays = screen.getAllDisplays().map((x, i) => ({
    id: String(x.id), label: (x.label || 'Display ' + (i + 1)) + ' · ' + x.size.width + '×' + x.size.height + (x.id === screen.getPrimaryDisplay().id ? ' (primary)' : ''),
  }));
  broadcast();
}

function probeNdi() {
  try {
    const l = ndi.load(store.data.settings.ndiRuntimePath || undefined);
    runtime.status.ndi = { ok: true, version: l.version, path: l.libPath };
  } catch (e) {
    runtime.status.ndi = { ok: false, error: e.message };
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (type, payload) => () => dispatch(type, payload).catch((e) => dialog.showErrorBox('Lectern', e.message));
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File', submenu: [
        { label: 'New Service', accelerator: 'CmdOrCtrl+N', click: send('service/new') },
        { label: 'Open Service…', accelerator: 'CmdOrCtrl+O', click: send('service/open') },
        { label: 'Save Service', accelerator: 'CmdOrCtrl+S', click: send('service/save') },
        { label: 'Save Service As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('service/saveAs') },
        { type: 'separator' },
        { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: send('media/import') },
        { label: 'Import Songs (text)…', click: send('song/import') },
        { label: 'Export CCLI Usage…', click: send('usage/export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Live', submenu: [
        { label: 'Next Slide', accelerator: 'Right', registerAccelerator: false, click: send('live/next') },
        { label: 'Previous Slide', accelerator: 'Left', registerAccelerator: false, click: send('live/prev') },
        { type: 'separator' },
        { label: 'Clear All', accelerator: 'F1', registerAccelerator: false, click: send('layer/clearAll') },
        { label: 'Clear Media', accelerator: 'F2', registerAccelerator: false, click: send('layer/toggle', { layer: 'media', value: false }) },
        { label: 'Clear Slide', accelerator: 'F3', registerAccelerator: false, click: send('layer/toggle', { layer: 'slide', value: false }) },
        { label: 'Clear Props', accelerator: 'F4', registerAccelerator: false, click: send('layer/toggle', { layer: 'props', value: false }) },
        { label: 'Clear Messages', accelerator: 'F6', registerAccelerator: false, click: send('layer/toggle', { layer: 'msg', value: false }) },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help', submenu: [
        { label: 'Get the NDI Runtime / NDI Tools', click: () => shell.openExternal('https://ndi.video/tools/') },
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createControl() {
  control = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700, backgroundColor: '#0e1116', title: 'Lectern',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'control-preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  control.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'));
  control.on('close', async (e) => {
    if (runtime.dirty && !control.forceClose) {
      e.preventDefault();
      if (await confirmDiscard()) { control.forceClose = true; control.close(); }
    }
  });
  control.on('closed', () => { control = null; app.quit(); });
}

app.whenReady().then(async () => {
  protocol.handle('lectern', (req) => {
    const u = new URL(req.url);
    if (u.hostname !== 'media') return new Response('Not found', { status: 404 });
    const name = path.basename(decodeURIComponent(u.pathname));
    return net.fetch(pathToFileURL(path.join(store.mediaDir, name)).toString(), { headers: req.headers });
  });

  store = new Store(app.getPath('userData'), bible);
  runtime.timer.durationMs = (store.data.settings.timerMinutes || 35) * 60000;
  if (process.env.LECTERN_DISABLE_NDI) store.data.outputs.forEach((o) => { o.ndi = false; });
  probeNdi();

  outputs = new OutputManager({
    getOutputs: () => store.data.outputs,
    getSettings: () => store.data.settings,
    onStatus: (s) => { runtime.status.outputs = s; broadcast(); },
  });
  remote = new RemoteServer({ getState: () => ({ state: fullState(), slides: Slides }), dispatch });

  ipcMain.handle('action', async (_e, { type, payload }) => {
    try { return { ok: true, value: await dispatch(type, payload) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('output/init', () => {
    const st = fullState();
    return { rs: Slides.buildRenderState(st), outputs: st.outputs };
  });

  buildMenu();
  createControl();
  refreshDisplays();
  screen.on('display-added', () => { refreshDisplays(); outputs.runners.forEach((r) => r.cfg && r.cfg.display && r.restartDisplay()); });
  screen.on('display-removed', () => { refreshDisplays(); outputs.runners.forEach((r) => r.cfg && r.cfg.display && r.restartDisplay()); });
  startRemote();
  await outputs.sync();
  broadcast();

  // Debug: LECTERN_CAPTURE=/dir writes PNGs of the control window and any screen outputs every 4 s.
  if (process.env.LECTERN_CAPTURE) {
    let n = 0;
    setInterval(async () => {
      n++;
      const dir = process.env.LECTERN_CAPTURE;
      if (control) fs.writeFileSync(path.join(dir, 'control-' + n + '.png'), (await control.webContents.capturePage()).toPNG());
      for (const r of outputs.runners) {
        if (r.lastImage) fs.writeFileSync(path.join(dir, 'ndi' + (r.index + 1) + '-' + n + '.png'), r.lastImage.toPNG());
        if (r.displayWin) fs.writeFileSync(path.join(dir, 'output' + (r.index + 1) + '-' + n + '.png'), (await r.displayWin.webContents.capturePage()).toPNG());
      }
      fs.writeFileSync(path.join(dir, 'status-' + n + '.json'), JSON.stringify({ outputs: outputs.statuses(), ndi: runtime.status.ndi, remote: remote.info() }, null, 1));
    }, 4000);
  }
});

app.on('open-file', (e, file) => { e.preventDefault(); if (store) dispatch('service/open', { file }).catch(() => {}); });

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  try { store && store.flush(); } catch { /* ignore */ }
  try { remote && remote.stop(); } catch { /* ignore */ }
  try { outputs && (await outputs.destroy()); } catch { /* ignore */ }
  app.exit(0);
});
app.on('window-all-closed', () => app.quit());

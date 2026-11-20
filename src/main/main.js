const { app, BrowserWindow, ipcMain, dialog, protocol, net, screen, Menu, shell, session, safeStorage, clipboard, crashReporter } = require('electron');
const log = require('./log');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Slides = require('../common/slides');
const bible = require('./bible');
const { Store, uid, LOOK_DEFAULTS } = require('./store');
const { OutputManager } = require('./outputs');
const { RemoteServer } = require('./remote');
const ndi = require('./ndi');
const { InputManager } = require('./inputs');
const { Bridge } = require('./bridge');
const { Chat } = require('./chat');
const pptx = require('./pptx');

protocol.registerSchemesAsPrivileged([
  { scheme: 'lectern', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

// Offscreen outputs must keep rendering while the app is in the background.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.env.LECTERN_USER_DATA) app.setPath('userData', process.env.LECTERN_USER_DATA);

// Crash records: native crash dumps stay on this computer (nothing is uploaded), and errors
// and crashes are written to <data folder>/logs/lectern.log.
crashReporter.start({ uploadToServer: false });
log.init(path.join(app.getPath('userData'), 'logs'));
log.info('Lectern ' + app.getVersion() + ' starting on ' + process.platform + ' ' + process.arch + ' (' + require('os').release() + '), Electron ' + process.versions.electron);
process.on('uncaughtException', (e) => log.error('Uncaught error in main process:', e));
process.on('unhandledRejection', (e) => log.error('Unhandled promise rejection in main process:', e instanceof Error ? e : String(e)));
app.on('render-process-gone', (_e, wc, details) => log.error('A window stopped (' + details.reason + ', exit code ' + details.exitCode + '): ' + (wc && !wc.isDestroyed() ? wc.getURL().replace(/^.*\/renderer\//, '') : 'unknown')));
app.on('child-process-gone', (_e, details) => log.error('Helper process stopped: ' + details.type + ' (' + details.reason + ', exit code ' + details.exitCode + ')' + (details.name ? ' ' + details.name : '')));

let store, outputs, remote, control, inputs, audioWin, bridge, chat;
const runtime = {
  live: { itemId: null, slide: 0 },
  layers: { slide: true, media: true, props: true, msg: false, stage: false },
  message: 'Overflow parking is open on Elm Street.',
  stageMessage: 'Wrap up · 2 minutes',
  timer: { durationMs: 35 * 60000, running: false, startedAt: 0, accumulatedMs: 0 },
  status: { outputs: [], ndi: null, displays: [], remote: null, inputs: { sources: [], error: null, inputs: {} } },
  usageLogged: new Set(),
  dirty: false,
};

function fullState() {
  const d = store.data;
  return {
    bibles: bible.list(),
    library: d.library, service: d.service, servicePath: d.servicePath, settings: d.settings, outputs: d.outputs, usageCount: d.usage.length,
    live: runtime.live, layers: runtime.layers, message: runtime.message, stageMessage: runtime.stageMessage, timer: runtime.timer,
    status: runtime.status, media: store.listMedia(), dirty: runtime.dirty, platform: process.platform,
    claude: { hasKey: !!d.settings.claudeKey, mcpEnabled: d.settings.mcpEnabled !== false, canUndo: bridge ? bridge.canUndo() : null },
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
    sendAudioConfig();
  });
}

// ---------- audio window (NDI input audio) ----------
function audioConfig() {
  const s = store.data.settings;
  return { device: s.audioDevice || '', inputs: (s.inputs || []).map((x) => ({ id: x.id, audio: !!x.audio, volume: x.volume == null ? 1 : x.volume })) };
}
let lastAudioCfg = '';
function sendAudioConfig() {
  const cfg = audioConfig();
  const key = JSON.stringify(cfg);
  if (key === lastAudioCfg || !audioWin || audioWin.isDestroyed()) return;
  lastAudioCfg = key;
  audioWin.webContents.send('audio/config', cfg);
}
function createAudioWindow() {
  audioWin = new BrowserWindow({
    show: false, width: 200, height: 100, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'audio-preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  audioWin.loadFile(path.join(__dirname, '..', 'renderer', 'audio.html'));
  audioWin.webContents.on('render-process-gone', () => { lastAudioCfg = ''; setTimeout(() => { if (audioWin && !audioWin.isDestroyed()) audioWin.reload(); }, 1000); });
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
const MEDIA_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'm4v', 'webm', 'mkv'];
async function importMedia(paths) {
  if (!paths) {
    const r = await dialog.showOpenDialog(control, {
      title: 'Import media', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and video', extensions: MEDIA_EXT }],
    });
    if (r.canceled) return [];
    paths = r.filePaths;
  }
  const added = [];
  for (const f of paths) {
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('File not found: ' + f);
    if (!MEDIA_EXT.includes(path.extname(f).slice(1).toLowerCase())) throw new Error('Not an image or video Lectern can use: ' + path.basename(f));
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
async function importSongs(paths) {
  if (!paths) {
    const r = await dialog.showOpenDialog(control, {
      title: 'Import songs (plain text)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (r.canceled) return 0;
    paths = r.filePaths;
  }
  let count = 0;
  for (const f of paths) {
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

// ---------- PowerPoint ----------
async function pickPowerPoint() {
  const r = await dialog.showOpenDialog(control, { title: 'Import PowerPoint', properties: ['openFile'], filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt'] }] });
  return r.canceled ? null : r.filePaths[0];
}

// Renders each page of a PDF to PNG files in a hidden window (pdf.js).
const pdfJobs = new Map();
function renderPdf(pdfFile, outDir) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false, width: 800, height: 600,
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'pdf-preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    const files = [];
    const finish = (err) => {
      pdfJobs.delete(win.webContents.id);
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err); else resolve(files.sort());
    };
    const timer = setTimeout(() => finish(new Error('Turning the slides into pictures took too long.')), 5 * 60000);
    pdfJobs.set(win.webContents.id, { pdfFile, outDir, files, finish });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'pdfrender.html'));
  });
}

async function importPowerPoint(file, mode, after) {
  if (!file || !fs.existsSync(file)) throw new Error('PowerPoint file not found: ' + file);
  const tmp = pptx.tempDir();
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  try {
    let item;
    if (mode === 'pictures') {
      let pngs = await pptx.exportWithPowerPoint(file, tmp);
      if (!pngs) {
        const pdf = await pptx.convertWithLibreOffice(file, tmp, 'pdf').catch((e) => { throw new Error('LibreOffice could not convert the file. ' + (e.stderr || e.message || '')); });
        if (!pdf) throw new Error('Importing slides as pictures needs PowerPoint (Windows) or the free LibreOffice. Install LibreOffice from libreoffice.org, then try again.');
        pngs = await renderPdf(pdf, tmp);
      }
      if (!pngs.length) throw new Error('No slides were found in that file.');
      const slides = [];
      const safe = base.replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'Slides';
      pngs.forEach((src, i) => {
        let name = safe + ' - Slide ' + String(i + 1).padStart(2, '0') + '.png';
        let n = 1;
        while (fs.existsSync(path.join(store.mediaDir, name))) name = safe + ' (' + ++n + ') - Slide ' + String(i + 1).padStart(2, '0') + '.png';
        fs.copyFileSync(src, path.join(store.mediaDir, name));
        slides.push(name);
      });
      item = { type: 'deck', title: base, slides };
    } else {
      const src = await pptx.ensurePptx(file, tmp);
      const slides = pptx.extractText(src);
      if (!slides.length) throw new Error('No text was found in that file. Try importing it as pictures.');
      item = { type: 'announce', title: base, text: pptx.toAnnounceText(slides), lobby: false };
    }
    const id = await dispatch('item/add', { item, after });
    return { id, slides: item.type === 'deck' ? item.slides.length : Slides.itemSlides(item).length, mode };
  } finally {
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
}

// ---------- Claude ----------
function getClaudeKey() {
  const enc = store.data.settings.claudeKey;
  if (!enc) return '';
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : ''; } catch { return ''; }
}
function bridgeConfigFile() { return path.join(app.getPath('userData'), 'bridge.json'); }
// What to paste into the Claude desktop app's settings (claude_desktop_config.json).
function mcpConfig() {
  const script = path.join(app.getAppPath(), 'src', 'mcp', 'lectern-mcp.js');
  return { mcpServers: { lectern: { command: process.execPath, args: [script, '--config', bridgeConfigFile()], env: { ELECTRON_RUN_AS_NODE: '1' } } } };
}
function startBridge() {
  const s = store.data.settings;
  if (!s.bridgeToken) { s.bridgeToken = require('crypto').randomBytes(24).toString('hex'); store.save(); }
  if (s.mcpEnabled === false) bridge.stop(); else bridge.start(bridgeConfigFile(), s.bridgeToken);
}
async function confirmClaude(text, { live, source }) {
  const r = await dialog.showMessageBox(control, {
    type: live ? 'warning' : 'question',
    title: 'Claude',
    message: (live ? 'Claude wants to change what is on screen:' : 'Claude wants to make this change:'),
    detail: text + '\n\nRequested from the ' + source + '. You can undo it from Edit > Undo Claude Change.',
    buttons: ['Allow', 'Don’t allow'], defaultId: live ? 1 : 0, cancelId: 1, noLink: true,
    ...(live ? {} : { checkboxLabel: 'Don’t ask again for changes that are not on screen (until Lectern restarts)' }),
  });
  return { ok: r.response === 0, skipChanges: !!r.checkboxChecked };
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
    case 'song/import': return importSongs(p.paths);

    case 'bible/lookup': return { ...bible.lookup(p.ref, p.translation || d.settings.bibleTranslation), copyright: bible.copyright(p.translation || d.settings.bibleTranslation) };
    case 'bible/list': return bible.list();
    case 'bible/pick': {
      const r = await dialog.showOpenDialog(control, { title: 'Import a Bible translation', properties: ['openFile'], filters: [{ name: 'Bible files', extensions: ['xml', 'osis', 'json', 'gz'] }, { name: 'All files', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      return { path: r.filePaths[0], ...bible.inspect(r.filePaths[0]) };
    }
    case 'bible/import': { const r = bible.importFile(p.path, p); changed(); return r; }
    case 'bible/remove': bible.remove(p.id); if (d.settings.bibleTranslation === String(p.id).toUpperCase()) d.settings.bibleTranslation = 'KJV'; changed({ persist: true }); return true;

    // Folders in the song and media libraries. Songs keep their folder on the song; media files
    // are mapped to a folder by name. Deleting a folder moves its contents to Unfiled.
    case 'folder/create': {
      const key = p.kind === 'media' ? 'mediaFolders' : 'songFolders';
      const name = String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!name) throw new Error('A folder needs a name.');
      const list = d.settings[key] = d.settings[key] || [];
      if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) list.push(name);
      list.sort((a, b) => a.localeCompare(b));
      changed({ persist: true }); return name;
    }
    case 'folder/rename': {
      const key = p.kind === 'media' ? 'mediaFolders' : 'songFolders';
      const to = String(p.to || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!to) throw new Error('A folder needs a name.');
      const list = d.settings[key] || [];
      const i = list.indexOf(p.from);
      if (i < 0) return false;
      if (list.some((x, j) => j !== i && x.toLowerCase() === to.toLowerCase())) throw new Error('There is already a folder called “' + to + '”.');
      list[i] = to; list.sort((a, b) => a.localeCompare(b));
      if (p.kind === 'media') { for (const [f, fo] of Object.entries(d.settings.mediaFolder || {})) if (fo === p.from) d.settings.mediaFolder[f] = to; }
      else d.library.songs.forEach((s) => { if (s.folder === p.from) s.folder = to; });
      changed({ persist: true }); return to;
    }
    case 'folder/delete': {
      const key = p.kind === 'media' ? 'mediaFolders' : 'songFolders';
      d.settings[key] = (d.settings[key] || []).filter((x) => x !== p.name);
      if (p.kind === 'media') { for (const [f, fo] of Object.entries(d.settings.mediaFolder || {})) if (fo === p.name) delete d.settings.mediaFolder[f]; }
      else d.library.songs.forEach((s) => { if (s.folder === p.name) delete s.folder; });
      changed({ persist: true }); return true;
    }
    case 'folder/assign': {
      const folder = p.folder || null;
      const key = p.kind === 'media' ? 'mediaFolders' : 'songFolders';
      if (folder && !(d.settings[key] || []).includes(folder)) await dispatch('folder/create', { kind: p.kind, name: folder });
      for (const id of p.items || []) {
        if (p.kind === 'media') {
          const m = d.settings.mediaFolder = d.settings.mediaFolder || {};
          const name = path.basename(String(id));
          if (folder) m[name] = folder; else delete m[name];
        } else {
          const s = d.library.songs.find((x) => x.id === id);
          if (s) { if (folder) s.folder = folder; else delete s.folder; }
        }
      }
      changed({ persist: true }); return true;
    }
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
      if ('ndiRuntimePath' in p.patch) await inputs.sync();
      return true;
    }

    case 'media/import': {
      const added = await importMedia(p.paths);
      if (p.folder && added.length) await dispatch('folder/assign', { kind: 'media', items: added, folder: p.folder });
      return added;
    }
    case 'media/remove': {
      const f = path.join(store.mediaDir, path.basename(p.name));
      if (fs.existsSync(f)) fs.unlinkSync(f);
      if (d.settings.mediaFolder) delete d.settings.mediaFolder[path.basename(p.name)];
      store.save();
      changed(); return true;
    }
    case 'media/reveal': shell.showItemInFolder(path.join(store.mediaDir, path.basename(p.name || ''))); return true;

    case 'media/options': {
      const name = path.basename(String(p.name || ''));
      d.service.mediaOptions = d.service.mediaOptions || {};
      const speed = Math.max(0.5, Math.min(2, Number(p.speed) || 1));
      if (speed === 1 && p.audioFollow !== false) delete d.service.mediaOptions[name];
      else d.service.mediaOptions[name] = { speed, audioFollow: p.audioFollow !== false };
      changed({ persist: true, dirty: true }); return true;
    }

    // Background dropped on a slide: used from that slide onward (null removes it).
    case 'item/bgChange': {
      const it = findItem(p.id);
      if (!it) return false;
      const changes = { ...(it.bgChanges || {}) };
      if (p.media) changes[String(p.slide | 0)] = p.media; else delete changes[String(p.slide | 0)];
      it.bgChanges = Object.keys(changes).length ? changes : undefined;
      changed({ persist: true, dirty: true }); return true;
    }

    // Text layouts: a preset id, an inline { boxes } layout, or null for the built-in look.
    case 'layout/apply': {
      const layout = p.layout && typeof p.layout === 'object' ? { boxes: p.layout.boxes } : p.layout || null;
      if (p.scope === 'all') {
        d.service.textLayout = layout;
        d.service.items.forEach((it) => { delete it.textLayout; });
      } else if (p.scope === 'service') d.service.textLayout = layout;
      else { const it = findItem(p.itemId); if (it) { if (layout) it.textLayout = layout; else delete it.textLayout; } }
      changed({ persist: true, dirty: true }); return true;
    }
    case 'preset/save': {
      const list = d.settings.textPresets = d.settings.textPresets || [];
      const name = String(p.name || '').trim().slice(0, 60);
      if (!name) throw new Error('A text preset needs a name.');
      let preset = list.find((x) => x.id === p.id) || list.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!preset) { preset = { id: uid() }; list.push(preset); }
      Object.assign(preset, { name, boxes: (p.layout && p.layout.boxes) || [] });
      changed({ persist: true }); return preset.id;
    }
    case 'preset/delete': {
      d.settings.textPresets = (d.settings.textPresets || []).filter((x) => x.id !== p.id);
      if (d.service.textLayout === p.id) d.service.textLayout = null;
      d.service.items.forEach((it) => { if (it.textLayout === p.id) delete it.textLayout; });
      changed({ persist: true }); return true;
    }

    // NDI inputs
    case 'input/add': {
      const list = d.settings.inputs = d.settings.inputs || [];
      if (!p.source) throw new Error('Choose an NDI source.');
      const inp = { id: uid(), source: String(p.source), name: String(p.name || p.source).replace(/^.*\(([^)]+)\)\s*$/, '$1').slice(0, 40), audio: false, volume: 1 };
      list.push(inp);
      changed({ persist: true });
      await inputs.sync();
      return inp.id;
    }
    case 'input/update': {
      const inp = (d.settings.inputs || []).find((x) => x.id === p.id);
      if (!inp) return false;
      const patch = { ...p.patch };
      if (patch.volume != null) patch.volume = Math.max(0, Math.min(2, Number(patch.volume)));
      if (patch.name != null) patch.name = String(patch.name).slice(0, 40) || inp.name;
      Object.assign(inp, patch);
      changed({ persist: true });
      await inputs.sync();
      return true;
    }
    case 'input/remove':
      d.settings.inputs = (d.settings.inputs || []).filter((x) => x.id !== p.id);
      changed({ persist: true });
      await inputs.sync();
      return true;
    case 'input/discover': inputs.startDiscovery(); return true;
    case 'input/resume': await inputs.setPaused(false); return true;

    // PowerPoint
    case 'pptx/pick': return pickPowerPoint();
    case 'pptx/import': return importPowerPoint(p.path, p.mode, p.after);

    // Claude
    case 'claude/setKey': {
      const key = String(p.key || '').trim();
      if (key && !safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot store the key securely, so it was not saved.');
      d.settings.claudeKey = key ? safeStorage.encryptString(key).toString('base64') : '';
      changed({ persist: true }); return true;
    }
    case 'claude/mcp': {
      d.settings.mcpEnabled = !!p.enabled;
      startBridge();
      changed({ persist: true }); return true;
    }
    case 'claude/copyConfig': clipboard.writeText(JSON.stringify(mcpConfig(), null, 2)); return mcpConfig();
    case 'claude/undo': { const label = await bridge.undo(); changed(); return label; }
    case 'chat/send': {
      const send = (ev) => { if (control && !control.isDestroyed()) control.webContents.send('event', ev); };
      const r = await chat.send(String(p.text || '').slice(0, 4000), (step) => send({ type: 'chat/step', text: step }));
      changed();
      return r;
    }
    case 'chat/reset': chat.reset(); return true;

    case 'test/capture': {
      // Test hook (only with LECTERN_CAPTURE): saves a screenshot of the control window.
      if (!process.env.LECTERN_CAPTURE) throw new Error('Unknown action ' + type);
      const img = await control.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.LECTERN_CAPTURE, 'shot-' + String(p.name).replace(/[^\w-]/g, '') + '.png'), img.toPNG());
      return true;
    }
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
    log.info('NDI runtime ' + l.version + ' at ' + l.libPath);
  } catch (e) {
    runtime.status.ndi = { ok: false, error: e.message };
    log.warn('NDI runtime not available: ' + e.message);
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
        { label: 'Import PowerPoint…', click: () => control && control.webContents.send('event', { type: 'pptx/import' }) },
        { label: 'Export CCLI Usage…', click: send('usage/export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Undo Claude Change', click: () => dispatch('claude/undo').then((label) => control && control.webContents.send('event', { type: 'toast', text: 'Undone: ' + label })).catch((e) => dialog.showErrorBox('Lectern', e.message)) },
      ],
    },
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
    {
      label: 'View', submenu: [
        { label: 'Reset Panel Layout', click: () => control && control.webContents.send('event', { type: 'layout/reset' }) },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help', submenu: [
        { label: 'Get the NDI Runtime / NDI Tools', click: () => shell.openExternal('https://ndi.video/tools/') },
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Open Log Folder', click: () => shell.openPath(log.dir() || app.getPath('userData')) },
        { label: 'Open Crash Reports Folder', click: () => shell.openPath(app.getPath('crashDumps')) },
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
  control.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) log.error('Control window: ' + message + ' (' + String(source || '').replace(/^.*\/renderer\//, '') + ':' + line + ')');
  });
  // If the control window's page crashes, reload it instead of leaving a blank window.
  control.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    setTimeout(() => { if (control && !control.isDestroyed()) control.reload(); }, 1000);
  });
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

  bible.init(path.join(app.getPath('userData'), 'bibles'));
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

  // Let the control window list audio devices by name and route audio to them.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['media', 'speaker-selection', 'clipboard-sanitized-write'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'speaker-selection', 'clipboard-sanitized-write'].includes(permission)));

  const sendTo = (wcId, channel, payload) => {
    const wc = require('electron').webContents.fromId(wcId);
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  };
  inputs = new InputManager({
    getInputs: () => store.data.settings.inputs || [],
    getSettings: () => store.data.settings,
    onStatus: (s) => { runtime.status.inputs = s; broadcast(); },
    sendFull: (wcId, frame) => sendTo(wcId, 'input/frame', frame),
    sendPreview: (frame) => { if (control && !control.isDestroyed()) control.webContents.send('input/preview', frame); },
    sendAudio: (m) => { if (audioWin && !audioWin.isDestroyed()) audioWin.webContents.send('input/audio', m); },
    guardFile: path.join(app.getPath('userData'), 'inputs-running.flag'),
  });
  ipcMain.on('input/want', (e, ids) => inputs.setWant(e.sender.id, Array.isArray(ids) ? ids.map(String) : []));
  ipcMain.on('input/preview-want', (_e, ids) => inputs.setPreview(Array.isArray(ids) ? ids.map(String) : []));
  ipcMain.handle('audio/init', () => { lastAudioCfg = JSON.stringify(audioConfig()); return audioConfig(); });

  ipcMain.handle('pdf/data', (e) => { const j = pdfJobs.get(e.sender.id); return j ? new Uint8Array(fs.readFileSync(j.pdfFile)) : null; });
  ipcMain.handle('pdf/page', (e, n, png) => {
    const j = pdfJobs.get(e.sender.id);
    if (!j) return false;
    const f = path.join(j.outDir, 'slide-' + String(n).padStart(3, '0') + '.png');
    fs.writeFileSync(f, Buffer.from(png));
    j.files.push(f);
    return true;
  });
  ipcMain.on('pdf/done', (e) => { const j = pdfJobs.get(e.sender.id); if (j) j.finish(); });
  ipcMain.on('pdf/fail', (e, msg) => { const j = pdfJobs.get(e.sender.id); if (j) j.finish(new Error('Could not read the slides: ' + msg)); });

  bridge = new Bridge({
    store, runtime, dispatch, slides: Slides, confirm: confirmClaude, bibles: () => bible.list(),
    importers: { media: (paths) => importMedia(paths), songs: (paths) => importSongs(paths), powerpoint: (file, mode) => importPowerPoint(file, mode) },
    onApplied: () => broadcast(),
    onRestore: async () => { runtime.dirty = true; store.save(); await outputs.sync(); await inputs.sync(); broadcast(); },
  });
  chat = new Chat({ bridge, getKey: getClaudeKey });

  ipcMain.handle('action', async (_e, { type, payload }) => {
    try { return { ok: true, value: await dispatch(type, payload) }; } catch (e) { log.warn('Action ' + type + ' failed: ' + e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('output/init', () => {
    const st = fullState();
    return { rs: Slides.buildRenderState(st), outputs: st.outputs };
  });

  buildMenu();
  createControl();
  createAudioWindow();
  startBridge();
  inputs.startDiscovery();
  inputs.sync();
  refreshDisplays();
  screen.on('display-added', () => { refreshDisplays(); outputs.runners.forEach((r) => r.cfg && r.cfg.display && r.restartDisplay()); });
  screen.on('display-removed', () => { refreshDisplays(); outputs.runners.forEach((r) => r.cfg && r.cfg.display && r.restartDisplay()); });
  startRemote();
  await outputs.sync();
  broadcast();

  // Test hook: LECTERN_TEST_SCRIPT=/file.js runs that script in the control window once it has loaded.
  if (process.env.LECTERN_TEST_SCRIPT && process.env.LECTERN_CAPTURE) {
    control.webContents.on('console-message', (_e, _level, message) => { if (/TEST|Uncaught|Error/.test(message)) process.stdout.write(message + '\n'); });
    control.webContents.once('did-finish-load', () => setTimeout(() => {
      control.webContents.executeJavaScript(fs.readFileSync(process.env.LECTERN_TEST_SCRIPT, 'utf8')).catch((e) => console.log('TEST ERROR', e.message));
    }, 1500));
  }
  // Test hook: LECTERN_AUTOCONFIRM=1 approves Claude changes without a dialog (headless tests only).
  if (process.env.LECTERN_AUTOCONFIRM && process.env.LECTERN_CAPTURE) bridge.ctx.confirm = async () => ({ ok: true });

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
  log.info('Lectern quitting');
  e.preventDefault();
  quitting = true;
  try { store && store.flush(); } catch { /* ignore */ }
  try { remote && remote.stop(); } catch { /* ignore */ }
  try { bridge && bridge.stop(); } catch { /* ignore */ }
  try { inputs && (await inputs.destroy()); } catch { /* ignore */ }
  try { outputs && (await outputs.destroy()); } catch { /* ignore */ }
  app.exit(0);
});
app.on('window-all-closed', () => app.quit());

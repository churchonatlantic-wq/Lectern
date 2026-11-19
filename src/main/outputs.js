// Runs the six outputs. Each enabled output can have:
//   - an offscreen renderer whose frames go to an NDI sender (worker thread), and/or
//   - a fullscreen window on a physical display (HDMI/projector).
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { NdiSender } = require('./ndi-sender');

const OUTPUT_HTML = path.join(__dirname, '..', 'renderer', 'output.html');
const OUTPUT_PRELOAD = path.join(__dirname, '..', 'preload', 'output-preload.js');

// Fields that require the renderer / sender to be rebuilt when changed.
const NDI_KEYS = ['enabled', 'ndi', 'name', 'groups', 'width', 'height', 'fps', 'alpha', 'audio'];
const DISPLAY_KEYS = ['enabled', 'display', 'alpha', 'audio'];

class OutputRunner {
  constructor(manager, index) {
    this.m = manager;
    this.index = index;
    this.cfg = null;
    this.osr = null;
    this.sender = null;
    this.displayWin = null;
    this.status = { ndi: 'off', connections: 0, tally: '', error: null, display: null, fps: 0 };
    this.frames = 0;
  }

  sourceName(cfg) {
    return (this.m.getSettings().ndiPrefix || 'LECTERN') + ' ' + cfg.id + ' (' + cfg.name + ')';
  }

  async apply(cfg) {
    const prev = this.cfg;
    this.cfg = { ...cfg };
    const changed = (keys) => !prev || keys.some((k) => prev[k] !== cfg[k]);
    if (changed(NDI_KEYS)) await this.restartNdi();
    if (changed(DISPLAY_KEYS)) this.restartDisplay();
  }

  async restartNdi() {
    await this.stopNdi();
    const cfg = this.cfg;
    if (!cfg.enabled || !cfg.ndi) { this.setStatus({ ndi: 'off', connections: 0, tally: '', error: null }); return; }

    const width = Math.max(320, Math.min(3840, cfg.width | 0));
    const height = Math.max(180, Math.min(2160, cfg.height | 0));
    const sender = new NdiSender({
      name: this.sourceName(cfg), groups: cfg.groups || null, width, height, fps: cfg.fps,
      alpha: !!cfg.alpha, libPath: this.m.getSettings().ndiRuntimePath || undefined,
    });
    this.sender = sender;
    sender.on('status', (s) => {
      this.setStatus({ ndi: s.state, connections: s.connections || 0, tally: s.tally || '', error: s.error || null });
      if (s.state === 'error' && this.sender === sender && !process.env.LECTERN_CAPTURE) {
        // NDI unavailable: release the renderer, keep the error visible.
        this.destroyOsr();
      }
    });

    const osr = new BrowserWindow({
      show: false, width, height, useContentSize: true, frame: false, transparent: !!cfg.alpha,
      backgroundColor: cfg.alpha ? '#00000000' : '#000000', paintWhenInitiallyHidden: true,
      webPreferences: { offscreen: true, preload: OUTPUT_PRELOAD, backgroundThrottling: false, contextIsolation: true },
    });
    this.osr = osr;
    osr.setContentSize(width, height);
    osr.webContents.setAudioMuted(!cfg.audio || !!cfg.display);
    osr.webContents.setFrameRate(Math.min(60, Math.ceil(parseFloat(cfg.fps) || 30)));
    osr.webContents.on('paint', (_e, _dirty, image) => {
      if (!this.sender) return;
      let img = image;
      const sz = img.getSize();
      if (sz.width !== width || sz.height !== height) img = img.resize({ width, height, quality: 'good' });
      this.sender.pushBGRA(img.toBitmap());
      this.frames++;
      if (process.env.LECTERN_CAPTURE) this.lastImage = img;
    });
    osr.webContents.on('render-process-gone', () => {
      if (this.osr === osr) setTimeout(() => this.restartNdi(), 1000);
    });
    osr.loadFile(OUTPUT_HTML, { query: { i: String(this.index), mode: 'ndi' } });
  }

  destroyOsr() {
    if (this.osr && !this.osr.isDestroyed()) this.osr.destroy();
    this.osr = null;
  }

  async stopNdi() {
    this.destroyOsr();
    const s = this.sender;
    this.sender = null;
    if (s) await s.stop();
  }

  restartDisplay() {
    this.stopDisplay();
    const cfg = this.cfg;
    if (!cfg.enabled || cfg.display == null || cfg.display === '') { this.setStatus({ display: null }); return; }
    const d = screen.getAllDisplays().find((x) => String(x.id) === String(cfg.display));
    if (!d) { this.setStatus({ display: 'missing' }); return; }
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, fullscreen: process.platform !== 'darwin', simpleFullscreen: process.platform === 'darwin',
      backgroundColor: '#000000', show: false, skipTaskbar: true, alwaysOnTop: false, title: 'Output ' + cfg.id,
      webPreferences: { preload: OUTPUT_PRELOAD, backgroundThrottling: false, contextIsolation: true },
    });
    win.setMenuBarVisibility(false);
    win.webContents.setAudioMuted(!cfg.audio);
    win.loadFile(OUTPUT_HTML, { query: { i: String(this.index), mode: 'display' } });
    win.once('ready-to-show', () => {
      win.setBounds(d.bounds);
      if (process.platform === 'darwin') win.setSimpleFullScreen(true);
      win.showInactive();
    });
    win.on('closed', () => { if (this.displayWin === win) { this.displayWin = null; this.setStatus({ display: null }); } });
    this.displayWin = win;
    this.setStatus({ display: d.label || 'Display ' + d.id });
  }

  stopDisplay() {
    const w = this.displayWin;
    this.displayWin = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  send(channel, payload) {
    for (const w of [this.osr, this.displayWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.m.onStatus();
  }

  async destroy() {
    this.stopDisplay();
    await this.stopNdi();
  }
}

class OutputManager {
  constructor({ getOutputs, getSettings, onStatus }) {
    this.getOutputs = getOutputs;
    this.getSettings = getSettings;
    this._onStatus = onStatus;
    this.runners = [0, 1, 2, 3, 4, 5].map((i) => new OutputRunner(this, i));
    this.statusTimer = null;
    setInterval(() => {
      for (const r of this.runners) { r.status.fps = r.frames; r.frames = 0; }
    }, 1000).unref?.();
  }
  onStatus() {
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this._onStatus(this.statuses()), 100);
  }
  statuses() { return this.runners.map((r) => ({ ...r.status })); }
  async sync() {
    const outs = this.getOutputs();
    for (let i = 0; i < 6; i++) await this.runners[i].apply(outs[i]);
  }
  async restartAllNdi() {
    for (const r of this.runners) if (r.cfg) await r.restartNdi();
  }
  broadcast(channel, payload) { for (const r of this.runners) r.send(channel, payload); }
  async destroy() { for (const r of this.runners) await r.destroy(); }
}

module.exports = { OutputManager };

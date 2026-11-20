// NDI inputs: finds sources on the network and runs one receiver worker per configured input.
// Video goes to the windows that show the input; previews go to the control window;
// audio goes to the audio window while the input's audio is on.
const { Worker } = require('worker_threads');
const path = require('path');
const ndi = require('./ndi');
const log = require('./log');

class InputReceiver {
  constructor(manager, cfg) {
    this.m = manager;
    this.cfg = { ...cfg };
    this.ctrl = new Int32Array(new SharedArrayBuffer(16));
    this.status = { state: 'connecting', fps: 0, w: 0, h: 0, error: null };
    this.worker = new Worker(path.join(__dirname, 'input-worker.js'), {
      workerData: { source: cfg.source, libPath: manager.getSettings().ndiRuntimePath || undefined, recvName: 'Lectern ' + cfg.name, ctrl: this.ctrl.buffer },
    });
    this.worker.on('message', (msg) => this.onMessage(msg));
    this.worker.on('error', (e) => { log.error('NDI input "' + cfg.source + '" worker error:', e); this.status = { ...this.status, state: 'error', error: String(e && e.message || e) }; this.m.statusChanged(); });
    this.worker.on('exit', (code) => { if (code) log.warn('NDI input "' + cfg.source + '" worker exited with code ' + code); });
    this.applyFlags();
  }
  onMessage(msg) {
    const id = this.cfg.id;
    if (msg.type === 'full') this.m.onFull(id, msg);
    else if (msg.type === 'preview') this.m.onPreview(id, msg);
    else if (msg.type === 'audio') this.m.onAudio(id, msg);
    else if (msg.type === 'status') {
      const state = msg.fps > 0 ? 'live' : 'no signal';
      if (state !== this.status.state || msg.w !== this.status.w || Math.abs(msg.fps - this.status.fps) > 1) {
        this.status = { state, fps: msg.fps, w: msg.w, h: msg.h, error: null };
        this.m.statusChanged();
      }
    } else if (msg.type === 'error') { this.status = { ...this.status, state: 'error', error: msg.message }; this.m.statusChanged(); }
  }
  applyFlags() {
    const id = this.cfg.id;
    Atomics.store(this.ctrl, 1, this.m.fullWanted(id) ? 1 : 0);
    Atomics.store(this.ctrl, 2, this.m.previewIds.has(id) ? 1 : 0);
    Atomics.store(this.ctrl, 3, this.cfg.audio ? 1 : 0);
  }
  async stop() {
    Atomics.store(this.ctrl, 0, 1);
    const w = this.worker;
    await Promise.race([new Promise((r) => w.once('exit', r)), new Promise((r) => setTimeout(r, 1500))]);
    try { await w.terminate(); } catch { /* gone */ }
  }
}

const fs = require('fs');

class InputManager {
  // guardFile: present while receivers run; if it is still there at the next start, Lectern
  // stopped unexpectedly while receiving, so inputs start paused instead of reconnecting.
  constructor({ getInputs, getSettings, onStatus, sendFull, sendPreview, sendAudio, guardFile }) {
    Object.assign(this, { getInputs, getSettings, onStatus, sendFull, sendPreview, sendAudio, guardFile });
    this.paused = false;
    try { if (guardFile && fs.existsSync(guardFile)) { this.paused = true; log.warn('Lectern did not close normally while NDI inputs were running. Inputs start paused.'); } } catch { /* ignore */ }
    this.receivers = new Map();
    this.wants = new Map(); // webContents id -> Set(input ids)
    this.previewIds = new Set();
    this.sources = [];
    this.finder = null;
    this.findTimer = null;
    this.error = null;
  }
  lib() { return ndi.load(this.getSettings().ndiRuntimePath || undefined); }

  // Keep a finder running so the Inputs panel can list sources.
  startDiscovery() {
    if (this.findTimer) return;
    const poll = () => {
      try {
        const lib = this.lib();
        if (!this.finder) this.finder = lib.api.findCreate({ show_local_sources: true, p_groups: null, p_extra_ips: null });
        const list = ndi.listSources(lib, this.finder).sort();
        this.error = null;
        if (list.join('\n') !== this.sources.join('\n')) { this.sources = list; this.statusChanged(); }
      } catch (e) {
        if (this.error !== e.message) { this.error = e.message; log.warn('NDI source discovery: ' + e.message); this.statusChanged(); }
      }
    };
    poll();
    this.findTimer = setInterval(poll, 3000);
    this.findTimer.unref?.();
  }

  setPaused(paused) { this.paused = !!paused; return this.sync(); }
  writeGuard() {
    if (!this.guardFile) return;
    try { if (this.receivers.size) fs.writeFileSync(this.guardFile, new Date().toISOString()); else if (fs.existsSync(this.guardFile)) fs.unlinkSync(this.guardFile); } catch { /* ignore */ }
  }
  async sync() {
    const list = this.paused ? [] : (this.getInputs() || []);
    const ids = new Set(list.map((x) => x.id));
    for (const [id, r] of this.receivers) {
      const cfg = list.find((x) => x.id === id);
      if (!ids.has(id) || !cfg || cfg.source !== r.cfg.source) { this.receivers.delete(id); await r.stop(); }
    }
    let lib = null;
    try { lib = list.length ? this.lib() : null; } catch (e) { this.error = e.message; }
    for (const cfg of list) {
      const r = this.receivers.get(cfg.id);
      if (r) { r.cfg = { ...cfg }; r.applyFlags(); continue; }
      if (lib && cfg.source) {
        log.info('Starting NDI input "' + cfg.source + '"');
        this.receivers.set(cfg.id, new InputReceiver(this, cfg));
      }
    }
    this.writeGuard();
    this.statusChanged();
  }

  fullWanted(id) { for (const set of this.wants.values()) if (set.has(id)) return true; return false; }
  setWant(wcId, ids) {
    if (ids && ids.length) this.wants.set(wcId, new Set(ids)); else this.wants.delete(wcId);
    for (const r of this.receivers.values()) r.applyFlags();
  }
  setPreview(ids) {
    this.previewIds = new Set(ids || []);
    for (const r of this.receivers.values()) r.applyFlags();
  }
  onFull(id, frame) {
    for (const [wcId, set] of this.wants) if (set.has(id)) this.sendFull(wcId, { id, w: frame.w, h: frame.h, data: frame.data });
  }
  onPreview(id, frame) { this.sendPreview({ id, w: frame.w, h: frame.h, data: frame.data }); }
  onAudio(id, msg) { this.sendAudio({ id, sampleRate: msg.sampleRate, data: msg.data }); }

  statusChanged() {
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.onStatus(this.statuses()), 150);
  }
  statuses() {
    const per = {};
    for (const [id, r] of this.receivers) per[id] = { ...r.status };
    return { sources: this.sources, error: this.error, inputs: per, paused: this.paused };
  }
  async destroy() {
    clearInterval(this.findTimer);
    for (const r of this.receivers.values()) await r.stop();
    this.receivers.clear();
    this.writeGuard();
    try { if (this.finder) this.lib().api.findDestroy(this.finder); } catch { /* ignore */ }
  }
}

module.exports = { InputManager };

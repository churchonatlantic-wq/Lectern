// Main-process handle for one NDI output. Owns the worker thread and the shared frame slots.
const { Worker } = require('worker_threads');
const path = require('path');
const { EventEmitter } = require('events');

const FPS = {
  '23.976': [24000, 1001], '24': [24, 1], '25': [25, 1], '29.97': [30000, 1001], '30': [30, 1],
  '50': [50, 1], '59.94': [60000, 1001], '60': [60, 1],
};

class NdiSender extends EventEmitter {
  constructor({ name, groups, width, height, fps, alpha, libPath }) {
    super();
    this.width = width;
    this.height = height;
    this.frameBytes = width * height * 4;
    this.ctrlBuf = new SharedArrayBuffer(16);
    this.ctrl = new Int32Array(this.ctrlBuf);
    this.ctrl[1] = -1;
    this.ctrl[2] = -1;
    this.slotBufs = [0, 1, 2].map(() => new SharedArrayBuffer(this.frameBytes));
    this.slots = this.slotBufs.map((b) => new Uint8Array(b));
    const [fpsN, fpsD] = FPS[String(fps)] || FPS['29.97'];
    this.status = { state: 'starting', connections: 0, tally: '', error: null };
    this.worker = new Worker(path.join(__dirname, 'ndi-worker.js'), {
      workerData: { name, groups, libPath, width, height, fpsN, fpsD, alpha: !!alpha, ctrl: this.ctrlBuf, slots: this.slotBufs },
    });
    this.worker.on('message', (m) => {
      if (m.type === 'ready') Object.assign(this.status, { state: 'sending', error: null, version: m.version });
      else if (m.type === 'status') Object.assign(this.status, { connections: m.connections, tally: m.tally });
      else if (m.type === 'error') Object.assign(this.status, { state: 'error', error: m.message, code: m.code });
      else if (m.type === 'stopped') this.status.state = 'stopped';
      this.emit('status', this.status);
    });
    this.worker.on('error', (e) => {
      Object.assign(this.status, { state: 'error', error: String(e && e.message || e) });
      this.emit('status', this.status);
    });
  }

  // Accepts a BGRA buffer of width*height*4 bytes.
  pushBGRA(buf) {
    if (!buf || buf.length < this.frameBytes) return false;
    const latest = Atomics.load(this.ctrl, 1);
    const reading = Atomics.load(this.ctrl, 2);
    let s = 0;
    while (s === latest || s === reading) s++;
    this.slots[s].set(buf.length === this.frameBytes ? buf : buf.subarray(0, this.frameBytes));
    Atomics.store(this.ctrl, 1, s);
    Atomics.add(this.ctrl, 3, 1);
    return true;
  }

  async stop() {
    Atomics.store(this.ctrl, 0, 1);
    const w = this.worker;
    await Promise.race([
      new Promise((r) => w.once('exit', r)),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    try { await w.terminate(); } catch { /* already gone */ }
  }
}

module.exports = { NdiSender, FPS };

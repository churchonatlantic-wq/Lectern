// One worker thread per NDI output. It owns the NDI sender and sends the latest
// rendered frame continuously at the output frame rate (clock_video paces it),
// so receivers that connect late still get a picture.
//
// Frame hand-off uses three SharedArrayBuffer slots (triple buffering):
//   ctrl[0] stop flag, ctrl[1] latest slot (-1 none), ctrl[2] slot being read (-1 none), ctrl[3] sequence
const { workerData, parentPort } = require('worker_threads');
const ndi = require('./ndi');

const { name, groups, libPath, width, height, fpsN, fpsD, alpha } = workerData;
const ctrl = new Int32Array(workerData.ctrl);
const slots = workerData.slots.map((s) => new Uint8Array(s));

let lib;
try {
  lib = ndi.load(libPath);
} catch (e) {
  parentPort.postMessage({ type: 'error', code: e.code, message: e.message });
  process.exit(0);
}

const { api } = lib;
const instance = api.sendCreate({ p_ndi_name: name, p_groups: groups || null, clock_video: true, clock_audio: false });
if (!instance) {
  parentPort.postMessage({ type: 'error', code: 'NDI_SEND_CREATE', message: 'Could not create NDI sender "' + name + '".' });
  process.exit(0);
}
parentPort.postMessage({ type: 'ready', version: lib.version, libPath: lib.libPath });

const frameBytes = width * height * 4;
const local = Buffer.alloc(frameBytes); // black (and fully transparent when alpha)
const frame = {
  xres: width,
  yres: height,
  FourCC: alpha ? ndi.FOURCC_BGRA : ndi.FOURCC_BGRX,
  frame_rate_N: fpsN,
  frame_rate_D: fpsD,
  picture_aspect_ratio: width / height,
  frame_format_type: 1, // progressive
  timecode: ndi.TIMECODE_SYNTHESIZE,
  p_data: local,
  line_stride_in_bytes: width * 4,
  p_metadata: null,
  timestamp: 0n,
};

// Chromium hands us premultiplied alpha; NDI expects straight alpha.
function unpremultiply(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3];
    if (a === 255 || a === 0) continue;
    const k = 255 / a;
    buf[i] = Math.min(255, buf[i] * k + 0.5);
    buf[i + 1] = Math.min(255, buf[i + 1] * k + 0.5);
    buf[i + 2] = Math.min(255, buf[i + 2] * k + 0.5);
  }
}

let lastSeq = -1;
let lastStatus = 0;
let lastConnections = -1;
let lastTally = '';

while (Atomics.load(ctrl, 0) === 0) {
  const seq = Atomics.load(ctrl, 3);
  if (seq !== lastSeq) {
    const s = Atomics.load(ctrl, 1);
    if (s >= 0) {
      Atomics.store(ctrl, 2, s);
      if (Atomics.load(ctrl, 1) === s) {
        local.set(slots[s].subarray(0, frameBytes));
        lastSeq = seq;
      }
      Atomics.store(ctrl, 2, -1);
      if (alpha && lastSeq === seq) unpremultiply(local);
    }
  }

  api.sendVideo(instance, frame); // blocks to the frame rate (clock_video)

  const now = Date.now();
  if (now - lastStatus > 1000) {
    lastStatus = now;
    const connections = api.connections(instance, 0);
    const t = {};
    api.tally(instance, t, 0);
    const tally = (t.on_program ? 'program' : '') + (t.on_preview ? (t.on_program ? '+' : '') + 'preview' : '');
    if (connections !== lastConnections || tally !== lastTally) {
      lastConnections = connections; lastTally = tally;
      parentPort.postMessage({ type: 'status', connections, tally });
    }
  }
}

api.sendDestroy(instance);
parentPort.postMessage({ type: 'stopped' });

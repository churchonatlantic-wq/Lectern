// One worker thread per NDI input. Receives video and audio from one NDI source and posts:
//   - full-size RGBA frames while an output window shows the input (ctrl[1])
//   - small preview frames for the control window (ctrl[2]), at most 8 per second
//   - stereo float audio while the input's audio is on (ctrl[3])
// ctrl[0] is the stop flag.
const { workerData, parentPort } = require('worker_threads');
const ndi = require('./ndi');

const { source, libPath, recvName } = workerData;
const ctrl = new Int32Array(workerData.ctrl);

let lib;
try { lib = ndi.load(libPath); } catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
  process.exit(0);
}
const { api } = lib;
const recv = api.recvCreate({
  source_to_connect_to: { p_ndi_name: source, p_url_address: null },
  color_format: ndi.RECV_COLOR_RGBX_RGBA,
  bandwidth: ndi.RECV_BANDWIDTH_HIGHEST,
  allow_video_fields: false,
  p_ndi_recv_name: recvName || 'Lectern',
});
if (!recv) {
  parentPort.postMessage({ type: 'error', message: 'Could not create an NDI receiver for "' + source + '".' });
  process.exit(0);
}

const PREVIEW_W = 320;
let lastPreview = 0;
let frames = 0, lastStatus = Date.now(), w = 0, h = 0;

function rgbaFrom(video) {
  const fw = video.xres, fh = video.yres, stride = video.line_stride_in_bytes || fw * 4;
  const src = ndi.copyBytes(video.p_data, stride * fh);
  let out = src;
  if (stride !== fw * 4) {
    out = new Uint8Array(fw * fh * 4);
    for (let y = 0; y < fh; y++) out.set(src.subarray(y * stride, y * stride + fw * 4), y * fw * 4);
  }
  if (video.FourCC !== FOURCC_RGBA) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}
const FOURCC_RGBA = ('R'.charCodeAt(0) | ('G'.charCodeAt(0) << 8) | ('B'.charCodeAt(0) << 16) | ('A'.charCodeAt(0) << 24)) >>> 0;

function downscale(rgba, fw, fh) {
  const pw = Math.min(PREVIEW_W, fw), ph = Math.max(1, Math.round(fh * pw / fw));
  const out = new Uint8Array(pw * ph * 4);
  const out32 = new Uint32Array(out.buffer), in32 = new Uint32Array(rgba.buffer, rgba.byteOffset, fw * fh);
  for (let y = 0; y < ph; y++) {
    const sy = Math.floor(y * fh / ph) * fw;
    for (let x = 0; x < pw; x++) out32[y * pw + x] = in32[sy + Math.floor(x * fw / pw)];
  }
  return { w: pw, h: ph, data: out };
}

while (Atomics.load(ctrl, 0) === 0) {
  const video = {}, audio = {};
  const t = api.recvCapture(recv, video, audio, null, 100);
  if (t === ndi.FRAME_VIDEO) {
    frames++; w = video.xres; h = video.yres;
    const wantFull = Atomics.load(ctrl, 1) === 1;
    const now = Date.now();
    const wantPreview = Atomics.load(ctrl, 2) === 1 && now - lastPreview >= 125;
    if ((wantFull || wantPreview) && video.p_data) {
      const rgba = rgbaFrom(video);
      if (wantPreview) {
        lastPreview = now;
        const p = downscale(rgba, w, h);
        parentPort.postMessage({ type: 'preview', w: p.w, h: p.h, data: p.data }, [p.data.buffer]);
      }
      if (wantFull) {
        const data = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? rgba : rgba.slice();
        parentPort.postMessage({ type: 'full', w, h, data }, [data.buffer]);
      }
    }
    api.freeVideo(recv, video);
  } else if (t === ndi.FRAME_AUDIO) {
    if (Atomics.load(ctrl, 3) === 1 && audio.p_data && audio.no_samples > 0) {
      const ch = audio.no_channels, n = audio.no_samples, stride = audio.channel_stride_in_bytes || n * 4;
      const bytes = ndi.copyBytes(audio.p_data, stride * ch);
      const planes = new Float32Array(bytes.buffer, bytes.byteOffset, (stride * ch) / 4);
      const per = stride / 4;
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        out[i * 2] = planes[i];
        out[i * 2 + 1] = ch > 1 ? planes[per + i] : planes[i];
      }
      parentPort.postMessage({ type: 'audio', sampleRate: audio.sample_rate, data: out }, [out.buffer]);
    }
    api.freeAudio(recv, audio);
  } else if (t === ndi.FRAME_ERROR) {
    parentPort.postMessage({ type: 'error', message: 'The NDI connection to "' + source + '" failed.' });
  }
  const now = Date.now();
  if (now - lastStatus >= 1000) {
    parentPort.postMessage({ type: 'status', fps: Math.round(frames * 1000 / (now - lastStatus)), w, h });
    frames = 0; lastStatus = now;
  }
}
api.recvDestroy(recv);
parentPort.postMessage({ type: 'stopped' });

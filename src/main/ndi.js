// Thin FFI binding to the NDI 6 runtime. The runtime is installed by the user
// (NDI Tools or the NDI Runtime redistributable), so no native code is compiled here.
const koffi = require('koffi');
const path = require('path');
const fs = require('fs');

const FOURCC = (a, b, c, d) => (a.charCodeAt(0) | (b.charCodeAt(0) << 8) | (c.charCodeAt(0) << 16) | (d.charCodeAt(0) << 24)) >>> 0;
const FOURCC_BGRA = FOURCC('B', 'G', 'R', 'A');
const FOURCC_BGRX = FOURCC('B', 'G', 'R', 'X');
const TIMECODE_SYNTHESIZE = 9223372036854775807n; // INT64_MAX

function candidatePaths(custom) {
  const list = [];
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isDirectory()) {
        list.push(path.join(custom, process.platform === 'win32' ? 'Processing.NDI.Lib.x64.dll' : process.platform === 'darwin' ? 'libndi.dylib' : 'libndi.so.6'));
      } else list.push(custom);
    } catch { list.push(custom); }
  }
  const env = process.env.NDI_RUNTIME_DIR_V6 || process.env.NDI_RUNTIME_DIR_V5;
  if (process.platform === 'win32') {
    if (env) list.push(path.join(env, 'Processing.NDI.Lib.x64.dll'));
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    list.push(
      path.join(pf, 'NDI', 'NDI 6 Runtime', 'v6', 'Processing.NDI.Lib.x64.dll'),
      path.join(pf, 'NDI', 'NDI 6 Tools', 'Runtime', 'Processing.NDI.Lib.x64.dll'),
      path.join(pf, 'NDI', 'NDI 6 SDK', 'Bin', 'x64', 'Processing.NDI.Lib.x64.dll'),
      'Processing.NDI.Lib.x64.dll'
    );
  } else if (process.platform === 'darwin') {
    if (env) list.push(path.join(env, 'libndi.dylib'));
    list.push(
      '/usr/local/lib/libndi.dylib',
      '/Library/NDI SDK for Apple/lib/macOS/libndi.dylib',
      '/Library/NDI 6 SDK/lib/macOS/libndi.dylib',
      '/opt/homebrew/lib/libndi.dylib',
      'libndi.dylib'
    );
  } else {
    if (env) list.push(path.join(env, 'libndi.so.6'));
    list.push('libndi.so.6', '/usr/lib/libndi.so.6', '/usr/local/lib/libndi.so.6', '/usr/lib/x86_64-linux-gnu/libndi.so.6');
  }
  return list;
}

let cached = null;

function load(customPath) {
  if (cached) return cached;
  const tried = [];
  let lib = null, libPath = null;
  for (const p of candidatePaths(customPath)) {
    tried.push(p);
    try { lib = koffi.load(p); libPath = p; break; } catch { /* try next */ }
  }
  if (!lib) {
    const err = new Error('NDI runtime not found. Install NDI Tools or the NDI 6 Runtime, or set its location in Settings. Looked in: ' + tried.join(', '));
    err.code = 'NDI_NOT_FOUND';
    throw err;
  }

  const SendCreate = koffi.struct('NDIlib_send_create_t', {
    p_ndi_name: 'const char *',
    p_groups: 'const char *',
    clock_video: 'bool',
    clock_audio: 'bool',
  });
  const VideoFrame = koffi.struct('NDIlib_video_frame_v2_t', {
    xres: 'int',
    yres: 'int',
    FourCC: 'uint32_t',
    frame_rate_N: 'int',
    frame_rate_D: 'int',
    picture_aspect_ratio: 'float',
    frame_format_type: 'int',
    timecode: 'int64_t',
    p_data: 'void *',
    line_stride_in_bytes: 'int',
    p_metadata: 'const char *',
    timestamp: 'int64_t',
  });
  const Tally = koffi.struct('NDIlib_tally_t', { on_program: 'bool', on_preview: 'bool' });

  const api = {
    initialize: lib.func('bool NDIlib_initialize(void)'),
    version: lib.func('const char *NDIlib_version(void)'),
    sendCreate: lib.func('void *NDIlib_send_create(const NDIlib_send_create_t *p_create_settings)'),
    sendDestroy: lib.func('void NDIlib_send_destroy(void *p_instance)'),
    sendVideo: lib.func('void NDIlib_send_send_video_v2(void *p_instance, const NDIlib_video_frame_v2_t *p_video_data)'),
    connections: lib.func('int NDIlib_send_get_no_connections(void *p_instance, uint32_t timeout_in_ms)'),
    tally: lib.func('bool NDIlib_send_get_tally(void *p_instance, _Out_ NDIlib_tally_t *p_tally, uint32_t timeout_in_ms)'),
  };
  if (!api.initialize()) {
    const err = new Error('NDI runtime loaded but failed to initialize (unsupported CPU?).');
    err.code = 'NDI_INIT_FAILED';
    throw err;
  }
  cached = { api, libPath, version: api.version(), types: { SendCreate, VideoFrame, Tally } };
  return cached;
}

module.exports = { load, FOURCC_BGRA, FOURCC_BGRX, TIMECODE_SYNTHESIZE, candidatePaths };

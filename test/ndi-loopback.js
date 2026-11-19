// Loopback test: sends a known BGRA pattern through NdiSender and receives it with an NDI receiver.
// Usage: NDI_RUNTIME_DIR_V6=/path/to/lib node test/ndi-loopback.js
const koffi = require('koffi');
const ndi = require('../src/main/ndi');
const { NdiSender } = require('../src/main/ndi-sender');

const W = 320, H = 180;
const lib = ndi.load();
const L = koffi.load(lib.libPath);
koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' });
koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' });
koffi.struct('NDIlib_recv_create_v3_t', {
  source_to_connect_to: 'NDIlib_source_t', color_format: 'int', bandwidth: 'int', allow_video_fields: 'bool', p_ndi_recv_name: 'const char *',
});
const findCreate = L.func('void *NDIlib_find_create_v2(const NDIlib_find_create_t *p)');
const findWait = L.func('bool NDIlib_find_wait_for_sources(void *f, uint32_t ms)');
const findGet = L.func('const NDIlib_source_t *NDIlib_find_get_current_sources(void *f, _Out_ uint32_t *n)');
const recvCreate = L.func('void *NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t *p)');
const recvCapture = L.func('int NDIlib_recv_capture_v3(void *r, _Out_ NDIlib_video_frame_v2_t *v, void *a, void *m, uint32_t ms)');
const recvFree = L.func('void NDIlib_recv_free_video_v2(void *r, NDIlib_video_frame_v2_t *v)');

(async () => {
  const sender = new NdiSender({ name: 'Loopback Test', width: W, height: H, fps: '30', alpha: true });
  sender.on('status', (s) => console.log('sender status', JSON.stringify(s)));
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 200; buf[i * 4 + 1] = 100; buf[i * 4 + 2] = 50; buf[i * 4 + 3] = 255; }
  // premultiplied half-transparent pixel at (0,0): straight value should come back ~ doubled
  buf[0] = 50; buf[1] = 25; buf[2] = 10; buf[3] = 128;
  await new Promise((r) => setTimeout(r, 300));
  sender.pushBGRA(buf);

  const f = findCreate({ show_local_sources: true, p_groups: null, p_extra_ips: null });
  let src = null;
  for (let t = 0; t < 20 && !src; t++) {
    findWait(f, 500);
    const n = [0];
    const p = findGet(f, n);
    if (n[0]) {
      const arr = koffi.decode(p, 'NDIlib_source_t', n[0]);
      src = arr.find((s) => s.p_ndi_name.includes('Loopback Test'));
      if (src) console.log('found sources', arr.map((s) => s.p_ndi_name));
    }
  }
  if (!src) { console.log('FAIL: source not found'); process.exit(1); }
  const r = recvCreate({ source_to_connect_to: src, color_format: 2 /* BGRX_BGRA */, bandwidth: 100, allow_video_fields: false, p_ndi_recv_name: 'probe' });
  for (let t = 0; t < 50; t++) {
    const v = {};
    const type = recvCapture(r, v, null, null, 200);
    if (type === 1) {
      const px = Buffer.from(koffi.view(v.p_data, v.line_stride_in_bytes * v.yres));
      const mid = ((H / 2) * W + W / 2) * 4;
      console.log('video', v.xres + 'x' + v.yres, 'fourcc', v.FourCC.toString(16), 'fps', v.frame_rate_N + '/' + v.frame_rate_D,
        'mid BGRA', [...px.subarray(mid, mid + 4)], 'corner', [...px.subarray(0, 4)]);
      recvFree(r, v);
      await new Promise((res) => setTimeout(res, 1500));
      await sender.stop();
      console.log('PASS');
      process.exit(0);
    }
  }
  console.log('FAIL: no video'); process.exit(1);
})();

// One output window (offscreen for NDI, or fullscreen on a display).
const params = new URLSearchParams(location.search);
const index = Number(params.get('i')) || 0;
const surface = new window.LecternRender.Surface(document.getElementById('root'), { transitions: true });

function apply(payload) {
  if (!payload || !payload.outputs) return;
  const cfg = payload.outputs[index];
  if (!cfg) return;
  document.body.style.background = cfg.alpha && params.get('mode') === 'ndi' ? 'transparent' : '#000';
  surface.update(payload.rs, cfg);
}

window.lecternOutput.init().then(apply);
window.lecternOutput.onRender(apply);

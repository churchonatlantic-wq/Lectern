// Hidden window that plays NDI input audio through the chosen audio device.
const api = window.lecternAudio;
const ctx = new AudioContext({ latencyHint: 'interactive' });
const players = new Map(); // input id -> { node, gain }
let ready = ctx.audioWorklet.addModule('audio-worklet.js');
let cfg = { inputs: [], device: '' };

async function player(id) {
  await ready;
  let p = players.get(id);
  if (!p) {
    const node = new AudioWorkletNode(ctx, 'input-player', { outputChannelCount: [2] });
    const gain = ctx.createGain();
    node.connect(gain).connect(ctx.destination);
    p = { node, gain };
    players.set(id, p);
    applyGain(id);
  }
  return p;
}
function applyGain(id) {
  const p = players.get(id);
  const c = cfg.inputs.find((x) => x.id === id);
  if (p) p.gain.gain.value = c && c.audio ? Math.max(0, Math.min(2, Number(c.volume == null ? 1 : c.volume))) : 0;
}
async function applyConfig(next) {
  cfg = next;
  for (const [id, p] of players) {
    if (!cfg.inputs.some((x) => x.id === id)) { p.node.disconnect(); p.gain.disconnect(); players.delete(id); } else applyGain(id);
  }
  if (ctx.setSinkId && (ctx.sinkId || '') !== (cfg.device || '')) {
    try { await ctx.setSinkId(cfg.device || ''); } catch (e) { console.warn('Audio device', e); }
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}
api.onConfig(applyConfig);
api.onAudio(async (m) => {
  const c = cfg.inputs.find((x) => x.id === m.id);
  if (!c || !c.audio) return;
  const p = await player(m.id);
  const data = m.data instanceof Float32Array ? m.data : new Float32Array(m.data.buffer || m.data, m.data.byteOffset || 0, (m.data.byteLength || 0) / 4);
  p.node.port.postMessage({ data, sampleRate: m.sampleRate }, [data.buffer]);
});
api.init().then(applyConfig);

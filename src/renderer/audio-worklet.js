// Plays one NDI input's audio. Receives interleaved stereo blocks at the source rate and
// resamples them to the context rate. Keeps about 80 ms buffered; drops audio if it falls
// more than half a second behind so the input stays in sync with its picture.
class InputPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(48000 * 2 * 4);
    this.read = 0; // fractional frame position
    this.write = 0; // frames written
    this.started = false;
    this.ratio = 1;
    this.port.onmessage = (e) => {
      const { data, sampleRate: sr } = e.data;
      this.ratio = sr / sampleRate;
      const cap = this.buf.length / 2;
      const n = data.length / 2;
      if (this.write - this.read > sr * 0.5) this.read = this.write - sr * 0.08;
      for (let i = 0; i < n; i++) {
        const k = ((this.write + i) % cap) * 2;
        this.buf[k] = data[i * 2];
        this.buf[k + 1] = data[i * 2 + 1];
      }
      this.write += n;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const cap = this.buf.length / 2;
    if (!this.started && this.write - this.read >= 0.08 * sampleRate * this.ratio) this.started = true;
    for (let i = 0; i < L.length; i++) {
      if (!this.started || this.read + 1 >= this.write) { L[i] = 0; R[i] = 0; this.started = false; continue; }
      const p = Math.floor(this.read), f = this.read - p;
      const a = (p % cap) * 2, b = ((p + 1) % cap) * 2;
      L[i] = this.buf[a] + (this.buf[b] - this.buf[a]) * f;
      R[i] = this.buf[a + 1] + (this.buf[b + 1] - this.buf[a + 1]) * f;
      this.read += this.ratio;
    }
    return true;
  }
}
registerProcessor('input-player', InputPlayer);

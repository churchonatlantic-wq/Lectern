// LAN remote for a phone or tablet: http://<this computer>:<port>/  (PIN protected)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAGE = path.join(__dirname, '..', 'renderer', 'remote.html');

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

class RemoteServer {
  constructor({ getState, dispatch }) {
    this.getState = getState;
    this.dispatch = dispatch;
    this.server = null;
    this.port = null;
    this.error = null;
  }

  start(port, pin) {
    this.stop();
    this.pin = String(pin || '');
    this.port = port;
    this.error = null;
    const server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }));
    server.on('error', (e) => { this.error = e.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use.' : String(e.message); });
    server.listen(port, '0.0.0.0');
    this.server = server;
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
  }

  info() {
    return { running: !!this.server && !this.error, port: this.port, error: this.error, urls: lanAddresses().map((a) => 'http://' + a + ':' + this.port + '/') };
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(PAGE));
      return;
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
    if ((req.headers['x-pin'] || url.searchParams.get('pin')) !== this.pin) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong PIN' }));
      return;
    }
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) { chunks.push(c); if (chunks.length > 64) break; }
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = {}; }
    }
    const route = url.pathname.slice(5);
    const allowed = {
      next: 'live/next', prev: 'live/prev', go: 'live/go', clear: 'layer/clearAll', layer: 'layer/toggle',
      stagemessage: 'stageMessage/set', 'timer/start': 'timer/start', 'timer/stop': 'timer/stop', 'timer/reset': 'timer/reset',
    };
    if (req.method === 'POST' && allowed[route]) await this.dispatch(allowed[route], body);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(this.snapshot()));
  }

  snapshot() {
    const { state, slides } = this.getState();
    const S = slides;
    const items = state.service.items.map((it) => ({
      id: it.id, title: S.itemTitle(it, state.library), type: it.type,
      slides: S.itemSlides(it, state.library).map((s) => ({ group: s.group, color: s.color, text: S.plainText(s).slice(0, 140) })),
    }));
    const rs = S.buildRenderState(state);
    return {
      service: state.service.name, items, live: state.live, layers: state.layers,
      current: S.plainText(rs.slide), next: S.plainText(rs.next), stageMessage: state.stageMessage, timer: state.timer,
    };
  }
}

module.exports = { RemoteServer, lanAddresses };

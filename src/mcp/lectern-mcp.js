#!/usr/bin/env node
// Lectern connector for the Claude desktop app (MCP over stdio).
// The Claude app starts this with Lectern's own executable in Node mode:
//   command: <Lectern.exe>, args: [<this file>, "--config", <data folder>/bridge.json],
//   env: { ELECTRON_RUN_AS_NODE: "1" }
// Lectern must be running; it writes bridge.json with the local port and a private token.
const fs = require('fs');
const http = require('http');
const readline = require('readline');

const argi = process.argv.indexOf('--config');
const configFile = argi > 0 ? process.argv[argi + 1] : null;

function bridge() {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return null; }
}
function request(method, path, body) {
  const cfg = bridge();
  if (!cfg) return Promise.reject(new Error('Lectern is not running. Open Lectern on this computer, then try again.'));
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path, method, headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) }, timeout: 300000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', () => reject(new Error('Could not reach Lectern. Make sure Lectern is open on this computer.')));
    req.on('timeout', () => req.destroy(new Error('Lectern did not answer in time.')));
    if (data) req.write(data);
    req.end();
  });
}

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'lectern', version: '1.1.0' },
          instructions: 'Controls Lectern, the worship presentation app running on this computer. Call get_overview first. Lectern asks its operator to approve every change, and changes can be undone from Lectern (Edit > Undo Claude Change).',
        });
      case 'ping': return reply(id, {});
      case 'tools/list': {
        const r = await request('GET', '/tools');
        if (r.error) throw new Error(r.error);
        return reply(id, { tools: r.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
      }
      case 'tools/call': {
        const r = await request('POST', '/call', { name: params.name, input: params.arguments || {} });
        if (r.error) return reply(id, { content: [{ type: 'text', text: r.error }], isError: true });
        return reply(id, { content: [{ type: 'text', text: typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 1) }] });
      }
      default: return fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) {
    if (method === 'tools/list') return reply(id, { tools: [] });
    return fail(id, -32603, String(e.message || e));
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg);
});

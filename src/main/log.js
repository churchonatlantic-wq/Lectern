// Lectern's log file: <data folder>/logs/lectern.log (Help > Open Log Folder).
// Records startup details, errors and crashes so a problem can be traced afterwards.
const fs = require('fs');
const path = require('path');

let file = null;
const MAX = 2 * 1024 * 1024;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'lectern.log');
  try { if (fs.statSync(file).size > MAX) fs.renameSync(file, file.replace(/\.log$/, '.old.log')); } catch { /* no log yet */ }
}

function write(level, ...parts) {
  const text = parts.map((p) => (p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  const line = new Date().toISOString() + ' ' + level.toUpperCase() + ' ' + text + '\n';
  if (level !== 'info') process.stderr.write(line);
  if (!file) return;
  try { fs.appendFileSync(file, line); } catch { /* disk unavailable */ }
}

module.exports = { init, info: (...p) => write('info', ...p), warn: (...p) => write('warn', ...p), error: (...p) => write('error', ...p), dir: () => file && path.dirname(file) };

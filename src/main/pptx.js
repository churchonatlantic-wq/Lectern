// PowerPoint import.
//   Text mode: reads the .pptx (a zip of XML files) and returns each slide's title and body text.
//   Picture mode: turns every slide into a PNG, using PowerPoint (Windows) if installed,
//   otherwise LibreOffice to make a PDF that a hidden window renders page by page.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

// ---------- minimal zip reader ----------
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a PowerPoint (.pptx) file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: () => Array.from(entries.keys()),
    text(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lh = e.local;
      const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
      const raw = buf.subarray(start, start + e.csize);
      return (e.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    },
  };
}

const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

// Slide files in presentation order.
function slideOrder(zip) {
  const pres = zip.text('ppt/presentation.xml') || '';
  const rels = zip.text('ppt/_rels/presentation.xml.rels') || '';
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
    const t = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && t) target[id] = 'ppt/' + t.replace(/^\/?ppt\//, '').replace(/^\.\//, '');
  }
  const order = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) if (target[m[1]]) order.push(target[m[1]]);
  if (order.length) return order;
  return zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
}

// Title and body text of each slide. Hidden slides are skipped.
function extractText(file) {
  const zip = readZip(file);
  const slides = [];
  for (const name of slideOrder(zip)) {
    const xml = zip.text(name);
    if (!xml || /<p:sld\b[^>]*\bshow="0"/.test(xml)) continue;
    let title = '';
    const body = [];
    for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const shape = sp[0];
      const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(shape);
      const paras = [];
      for (const pm of shape.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
        const t = Array.from(pm[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)).map((x) => (x[1] != null ? decodeXml(x[1]) : '\n')).join('');
        if (t.trim()) paras.push(t.replace(/\s+$/g, ''));
      }
      if (!paras.length) continue;
      if (isTitle && !title) title = paras.join(' ');
      else body.push(paras.join('\n'));
    }
    if (!title && body.length) title = body.shift().split('\n')[0];
    slides.push({ title: title.trim(), body: body.join('\n').trim() });
  }
  return slides;
}

// Lectern text slides: heading on the first line, a line with --- between slides.
function toAnnounceText(slides) {
  return slides.map((s) => [s.title || ' ', s.body].filter(Boolean).join('\n')).join('\n---\n');
}

// ---------- picture mode ----------
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 180000, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); reject(err); } else resolve(String(stdout || ''));
    });
  });
}

function findSoffice() {
  const list = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
      : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];
  return list.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

// Windows with PowerPoint installed: export every slide as a 1920x1080 PNG.
async function exportWithPowerPoint(file, outDir) {
  if (process.platform !== 'win32') return null;
  const ps = [
    '$ErrorActionPreference = "Stop"',
    '$app = New-Object -ComObject PowerPoint.Application',
    '$pres = $app.Presentations.Open($env:LECTERN_PPT, $true, $false, $false)',
    '$i = 0',
    'foreach ($s in $pres.Slides) { if ($s.SlideShowTransition.Hidden) { continue }; $i++; $s.Export((Join-Path $env:LECTERN_OUT ("slide-{0:D3}.png" -f $i)), "PNG", 1920, 1080) }',
    '$pres.Close()',
    'if ($app.Presentations.Count -eq 0) { $app.Quit() }',
  ].join('; ');
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { env: { ...process.env, LECTERN_PPT: file, LECTERN_OUT: outDir } });
  } catch { return null; }
  const files = fs.readdirSync(outDir).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
  return files.length ? files.map((f) => path.join(outDir, f)) : null;
}

async function convertWithLibreOffice(file, outDir, format) {
  const soffice = findSoffice();
  if (!soffice) return null;
  // A private profile keeps this from clashing with a LibreOffice window the user has open.
  const profile = path.join(outDir, 'lo-profile');
  await run(soffice, ['-env:UserInstallation=file:///' + profile.replace(/\\/g, '/').replace(/^\//, ''), '--headless', '--norestore', '--convert-to', format, '--outdir', outDir, file]);
  const out = path.join(outDir, path.basename(file).replace(/\.[^.]+$/, '') + '.' + format.split(':')[0]);
  return fs.existsSync(out) ? out : null;
}

// Converts an older .ppt file to .pptx so text mode can read it.
async function ensurePptx(file, tmp) {
  if (/\.pptx$/i.test(file)) return file;
  const out = await convertWithLibreOffice(file, tmp, 'pptx');
  if (!out) throw new Error('Reading .ppt files needs LibreOffice. Install LibreOffice, or save the file as .pptx in PowerPoint.');
  return out;
}

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-ppt-')); }

module.exports = { extractText, toAnnounceText, exportWithPowerPoint, convertWithLibreOffice, ensurePptx, findSoffice, tempDir };

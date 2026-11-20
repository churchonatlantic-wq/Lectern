// Bible translations.
//   Built in (public domain): KJV, BSB, ASV, YLT, stored as [[bookName, [[verse, ...], ...]], ...].
//   Imported: translation files the church has the right to use (OpenSong XML, Zefania XML,
//   OSIS XML or JSON), converted to the same format and kept in <data folder>/bibles.
// Copyrighted translations (NIV, NKJV, NASB, NLT, MSG, ...) cannot be shipped with Lectern; they
// can be used by importing a file you are licensed to use.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const BUILT_IN = [
  { id: 'KJV', name: 'King James Version', file: 'kjv.json', copyright: 'Public domain' },
  { id: 'BSB', name: 'Berean Standard Bible', file: 'bsb.json.gz', copyright: 'Public domain' },
  { id: 'ASV', name: 'American Standard Version (1901)', file: 'asv.json.gz', copyright: 'Public domain' },
  { id: 'YLT', name: 'Young’s Literal Translation (1898)', file: 'ylt.json.gz', copyright: 'Public domain' },
];

let userDir = null;
const cache = new Map();

function init(dir) {
  userDir = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  const buf = fs.readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
}

function imported() {
  if (!userDir) return [];
  try {
    return fs.readdirSync(userDir).filter((f) => f.endsWith('.json')).map((f) => {
      try { const j = readJson(path.join(userDir, f)); return { id: j.id, name: j.name, copyright: j.copyright || '', file: path.join(userDir, f), imported: true }; } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function list() {
  return BUILT_IN.map(({ id, name, copyright }) => ({ id, name, copyright, builtIn: true }))
    .concat(imported().map(({ id, name, copyright }) => ({ id, name, copyright, imported: true })));
}

function data(id) {
  const key = String(id || 'KJV').toUpperCase();
  if (cache.has(key)) return cache.get(key);
  const b = BUILT_IN.find((x) => x.id === key);
  let books;
  if (b) books = readJson(path.join(ASSETS, b.file));
  else {
    const t = imported().find((x) => x.id.toUpperCase() === key);
    if (!t) throw new Error('The ' + key + ' translation is not installed. Import it under Bible → Translations.');
    books = readJson(t.file).books;
  }
  cache.set(key, books);
  return books;
}

const ALIASES = {
  gen: 'Genesis', ex: 'Exodus', exo: 'Exodus', lev: 'Leviticus', num: 'Numbers', deut: 'Deuteronomy', dt: 'Deuteronomy',
  josh: 'Joshua', judg: 'Judges', ps: 'Psalms', psa: 'Psalms', psalm: 'Psalms', prov: 'Proverbs', pr: 'Proverbs',
  eccl: 'Ecclesiastes', ecc: 'Ecclesiastes', song: 'Song of Solomon', songofsongs: 'Song of Solomon', sos: 'Song of Solomon',
  isa: 'Isaiah', jer: 'Jeremiah', lam: 'Lamentations', ezek: 'Ezekiel', dan: 'Daniel', hos: 'Hosea', obad: 'Obadiah',
  mic: 'Micah', nah: 'Nahum', hab: 'Habakkuk', zeph: 'Zephaniah', hag: 'Haggai', zech: 'Zechariah', mal: 'Malachi',
  mt: 'Matthew', matt: 'Matthew', mk: 'Mark', lk: 'Luke', jn: 'John', rom: 'Romans', gal: 'Galatians', eph: 'Ephesians',
  phil: 'Philippians', col: 'Colossians', tit: 'Titus', philem: 'Philemon', phlm: 'Philemon', heb: 'Hebrews', jas: 'James',
  jude: 'Jude', rev: 'Revelation', revelations: 'Revelation',
  '1cor': '1 Corinthians', '2cor': '2 Corinthians', '1thess': '1 Thessalonians', '2thess': '2 Thessalonians',
  '1tim': '1 Timothy', '2tim': '2 Timothy', '1pet': '1 Peter', '2pet': '2 Peter', '1jn': '1 John', '2jn': '2 John', '3jn': '3 John',
  '1sam': '1 Samuel', '2sam': '2 Samuel', '1kgs': '1 Kings', '2kgs': '2 Kings', '1chr': '1 Chronicles', '2chr': '2 Chronicles',
};

const norm = (s) => s.toLowerCase().replace(/^\s*(i{1,3})\s+/, (m, r) => String(r.length)).replace(/[^a-z0-9]/g, '');

// Book names always come from the KJV list (the 66-book order every translation follows), so
// "Psalm 23" works in every translation.
function canon() { return data('KJV').map((b) => b[0]); }

function findBook(q) {
  const names = canon();
  const n = norm(q);
  if (!n) return -1;
  if (ALIASES[n]) return names.indexOf(ALIASES[n]);
  let i = names.findIndex((x) => norm(x) === n);
  if (i >= 0) return i;
  return names.findIndex((x) => norm(x).startsWith(n));
}

// "John 3:16-18", "Ps 23", "1 Cor 13:4-7", "Romans 8:28"
function lookup(ref, translation) {
  const tid = String(translation || 'KJV').toUpperCase();
  const m = String(ref || '').trim().match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/);
  if (!m) throw new Error('Could not read “' + ref + '”. Try a reference like John 3:16-18 or Psalm 23.');
  const bi = findBook(m[1]);
  if (bi < 0) throw new Error('No book named “' + m[1].trim() + '”.');
  const bookName = canon()[bi];
  const book = data(tid)[bi];
  if (!book || !book[1].length) throw new Error('This ' + tid + ' file does not include ' + bookName + '.');
  const chapters = book[1];
  const ch = parseInt(m[2], 10);
  const chapter = chapters[ch - 1];
  if (!chapter) throw new Error(bookName + ' has ' + chapters.length + ' chapters.');
  const a = m[3] ? parseInt(m[3], 10) : 1;
  let z = m[4] ? parseInt(m[4], 10) : (m[3] ? a : chapter.length);
  if (a < 1 || a > chapter.length) throw new Error(bookName + ' ' + ch + ' has ' + chapter.length + ' verses.');
  z = Math.min(Math.max(z, a), chapter.length);
  const verses = [];
  for (let v = a; v <= z; v++) if (chapter[v - 1]) verses.push({ book: bookName, chapter: ch, verse: v, text: chapter[v - 1] });
  if (!verses.length) throw new Error('Those verses are not in this ' + tid + ' file.');
  const refOut = bookName + ' ' + ch + (m[3] || z !== chapter.length || a !== 1 ? ':' + a + (z !== a ? '-' + z : '') : '');
  return { ref: refOut, translation: tid, verses };
}

function bookNames() { return canon(); }

// ---------- importing translation files ----------
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i')) || tag.match(new RegExp('\\b' + name + "\\s*=\\s*'([^']*)'", 'i')); return m ? m[1] : null; };

const OSIS_BOOKS = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'];

// Puts verse text into book/chapter/verse slots (all 1-based numbers).
function builder() {
  const books = [];
  return {
    add(b, c, v, text) {
      if (!(b >= 1 && b <= 66 && c >= 1 && v >= 1) || !text) return;
      const book = books[b - 1] = books[b - 1] || [];
      const ch = book[c - 1] = book[c - 1] || [];
      ch[v - 1] = ch[v - 1] ? ch[v - 1] + ' ' + text : text;
    },
    books,
  };
}

// Book number (1-66) from a name or number found in a file.
function bookIndex(nameOrNumber, position) {
  if (nameOrNumber != null && /^\d+$/.test(String(nameOrNumber).trim())) return parseInt(nameOrNumber, 10);
  if (nameOrNumber) {
    const i = findBook(String(nameOrNumber));
    if (i >= 0) return i + 1;
    const o = OSIS_BOOKS.findIndex((x) => x.toLowerCase() === String(nameOrNumber).toLowerCase());
    if (o >= 0) return o + 1;
  }
  return position;
}

function parseFile(file) {
  let text = fs.readFileSync(file);
  if (file.endsWith('.gz')) text = zlib.gunzipSync(text);
  text = text.toString('utf8').replace(/^﻿/, '');
  const B = builder();
  let format = '';
  if (/^\s*[[{]/.test(text)) {
    const j = JSON.parse(text);
    if (Array.isArray(j)) { format = 'Lectern JSON'; j.forEach((b, i) => (b[1] || []).forEach((c, ci) => c.forEach((v, vi) => B.add(i + 1, ci + 1, vi + 1, v)))); }
    else if (Array.isArray(j.books)) {
      format = 'JSON';
      j.books.forEach((b, i) => {
        const bi = bookIndex(b.name || b.book, i + 1);
        if (Array.isArray(b) || Array.isArray(b[1])) return;
        (b.chapters || []).forEach((c, ci) => (c.verses || c).forEach((v, vi) => {
          if (typeof v === 'string') B.add(bi, (c.chapter || ci + 1), vi + 1, v); else B.add(bi, c.chapter || ci + 1, v.verse || vi + 1, v.text);
        }));
      });
    }
  } else if (/<XMLBIBLE\b/i.test(text)) {
    format = 'Zefania XML';
    let pos = 0;
    for (const bm of text.matchAll(/<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi)) {
      pos++;
      const bi = bookIndex(attr(bm[1], 'bnumber') || attr(bm[1], 'bname'), pos);
      for (const cm of bm[2].matchAll(/<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi)) {
        const c = parseInt(attr(cm[1], 'cnumber'), 10);
        for (const vm of cm[2].matchAll(/<VERS\b([^>]*)>([\s\S]*?)<\/VERS>/gi)) B.add(bi, c, parseInt(attr(vm[1], 'vnumber'), 10), decode(vm[2].replace(/<(NOTE|note)\b[\s\S]*?<\/\1>/g, '')));
      }
    }
  } else if (/<osis\b/i.test(text)) {
    format = 'OSIS XML';
    const body = text.replace(/<note\b[\s\S]*?<\/note>/gi, '').replace(/<title\b[\s\S]*?<\/title>/gi, '');
    // Verses as containers: <verse osisID="John.3.16">...</verse>
    for (const vm of body.matchAll(/<verse\b([^>]*?)(?<!\/)>([\s\S]*?)<\/verse>/gi)) addOsis(B, attr(vm[1], 'osisID'), decode(vm[2]));
    // Verses as milestones: <verse sID="..." osisID="..."/> ... <verse eID="..."/>
    for (const vm of body.matchAll(/<verse\b([^>]*\bsID\s*=\s*"([^"]+)"[^>]*)\/>([\s\S]*?)<verse\b[^>]*\beID\s*=\s*"\2"[^>]*\/>/gi)) addOsis(B, attr(vm[1], 'osisID'), decode(vm[3]));
  } else if (/<bible\b/i.test(text) && /<b\b/i.test(text)) {
    format = 'OpenSong XML';
    let pos = 0;
    for (const bm of text.matchAll(/<b\b([^>]*)>([\s\S]*?)<\/b>/gi)) {
      pos++;
      const bi = bookIndex(attr(bm[1], 'n'), pos);
      for (const cm of bm[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const c = parseInt(attr(cm[1], 'n'), 10);
        for (const vm of cm[2].matchAll(/<v\b([^>]*)>([\s\S]*?)<\/v>/gi)) {
          const n = attr(vm[1], 'n') || '';
          const [v1, v2] = n.split('-').map((x) => parseInt(x, 10));
          B.add(bi, c, v1, decode(vm[2]));
          if (v2 > v1) for (let v = v1 + 1; v <= v2; v++) B.add(bi, c, v, '…');
        }
      }
    }
  }
  const count = B.books.reduce((n, b) => n + (b ? b.reduce((m, c) => m + (c ? c.filter(Boolean).length : 0), 0) : 0), 0);
  if (!format) throw new Error('Lectern can read OpenSong XML, Zefania XML, OSIS XML and JSON Bible files. This file is none of those.');
  if (count < 100) throw new Error('No verses were found in that ' + format + ' file.');
  const names = canon();
  const books = names.map((name, i) => [name, (B.books[i] || []).map((c) => (c ? Array.from(c, (v) => v || '') : []))]);
  return { format, books, count, bookCount: B.books.filter(Boolean).length };
}
function addOsis(B, id, text) {
  if (!id) return;
  for (const one of id.split(/\s+/)) {
    const [b, c, v] = one.split('.');
    const bi = OSIS_BOOKS.findIndex((x) => x.toLowerCase() === String(b).toLowerCase()) + 1;
    if (bi) B.add(bi, parseInt(c, 10), parseInt(v, 10), text);
  }
}

// Reads a file without saving it (to show what was found before importing).
function inspect(file) {
  const r = parseFile(file);
  return { format: r.format, verses: r.count, books: r.bookCount };
}

function importFile(file, { id, name, copyright }) {
  const code = String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!code) throw new Error('Give the translation a short name, such as NIV.');
  if (BUILT_IN.some((b) => b.id === code)) throw new Error(code + ' is already built in.');
  const r = parseFile(file);
  fs.writeFileSync(path.join(userDir, code + '.json'), JSON.stringify({ id: code, name: String(name || code).slice(0, 80), copyright: String(copyright || '').slice(0, 300), format: r.format, books: r.books }));
  cache.delete(code);
  return { id: code, verses: r.count, books: r.bookCount, format: r.format };
}

function remove(id) {
  const code = String(id || '').toUpperCase();
  if (BUILT_IN.some((b) => b.id === code)) throw new Error('Built-in translations cannot be removed.');
  const t = imported().find((x) => x.id.toUpperCase() === code);
  if (t) fs.unlinkSync(t.file);
  cache.delete(code);
}

function copyright(id) {
  const t = list().find((x) => x.id === String(id || '').toUpperCase());
  return t ? t.copyright : '';
}

module.exports = { init, list, lookup, bookNames, inspect, importFile, remove, copyright };

// King James Version (public domain), bundled as [[bookName, [[verse, ...], ...]], ...]
const fs = require('fs');
const path = require('path');

let books = null;
function data() {
  if (!books) books = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'kjv.json'), 'utf8'));
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

function findBook(q) {
  const b = data();
  const n = norm(q);
  if (!n) return -1;
  if (ALIASES[n]) return b.findIndex((x) => x[0] === ALIASES[n]);
  let i = b.findIndex((x) => norm(x[0]) === n);
  if (i >= 0) return i;
  i = b.findIndex((x) => norm(x[0]).startsWith(n));
  return i;
}

// "John 3:16-18", "Ps 23", "1 Cor 13:4-7", "Romans 8:28"
function lookup(ref) {
  const m = String(ref || '').trim().match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/);
  if (!m) throw new Error('Could not read “' + ref + '”. Try a reference like John 3:16-18 or Psalm 23.');
  const bi = findBook(m[1]);
  if (bi < 0) throw new Error('No book named “' + m[1].trim() + '”.');
  const [bookName, chapters] = data()[bi];
  const ch = parseInt(m[2], 10);
  const chapter = chapters[ch - 1];
  if (!chapter) throw new Error(bookName + ' has ' + chapters.length + ' chapters.');
  let a = m[3] ? parseInt(m[3], 10) : 1;
  let z = m[4] ? parseInt(m[4], 10) : (m[3] ? a : chapter.length);
  if (a < 1 || a > chapter.length) throw new Error(bookName + ' ' + ch + ' has ' + chapter.length + ' verses.');
  z = Math.min(Math.max(z, a), chapter.length);
  const verses = [];
  for (let v = a; v <= z; v++) verses.push({ book: bookName, chapter: ch, verse: v, text: chapter[v - 1] });
  const refOut = bookName + ' ' + ch + (m[3] || z !== chapter.length || a !== 1 ? ':' + a + (z !== a ? '-' + z : '') : '');
  return { ref: refOut, translation: 'KJV', verses };
}

function bookNames() { return data().map((b) => b[0]); }

module.exports = { lookup, bookNames };

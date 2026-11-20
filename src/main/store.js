// App state, defaults and persistence (userData/lectern-data.json, debounced writes).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uid = () => crypto.randomBytes(6).toString('hex');

const LOOK_DEFAULTS = {
  main: { alpha: false, showProps: true, showMessages: true },
  lowerthird: { alpha: true, showProps: false, showMessages: true },
  lyrics: { alpha: true, showProps: false, showMessages: false },
  stage: { alpha: false, showProps: false, showMessages: false },
  lobby: { alpha: false, showProps: true, showMessages: false },
  clean: { alpha: false, showProps: true, showMessages: false },
};

function defaultOutputs() {
  const mk = (n, name, look, width, height, fps, extra) => ({
    id: n, name, enabled: true, ndi: true, display: null, look, width, height, fps,
    groups: '', fontScale: 1, audio: n === 1, ...LOOK_DEFAULTS[look], ...extra,
  });
  return [
    mk(1, 'Main', 'main', 1920, 1080, '59.94'),
    mk(2, 'Lower Third', 'lowerthird', 1920, 1080, '59.94'),
    mk(3, 'Lyrics Key', 'lyrics', 1920, 1080, '29.97'),
    mk(4, 'Stage', 'stage', 1920, 1080, '29.97'),
    mk(5, 'Lobby', 'lobby', 1280, 720, '29.97'),
    mk(6, 'Clean Feed', 'clean', 1920, 1080, '29.97', { enabled: false }),
  ];
}

const SAMPLE_SONGS = [
  {
    title: 'Amazing Grace', author: 'John Newton', copyright: 'Public Domain', ccli: '22025',
    lyrics: '[Verse 1]\nAmazing grace! How sweet the sound\nThat saved a wretch like me!\n\nI once was lost, but now am found;\nWas blind, but now I see.\n\n[Verse 2]\n’Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\n\nHow precious did that grace appear\nThe hour I first believed.\n\n[Verse 3]\nThrough many dangers, toils and snares,\nI have already come;\n\n’Tis grace hath brought me safe thus far,\nAnd grace will lead me home.',
    arrangement: '',
  },
  {
    title: 'Holy, Holy, Holy', author: 'Reginald Heber', copyright: 'Public Domain', ccli: '1156',
    lyrics: '[Verse 1]\nHoly, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\n\nHoly, holy, holy, merciful and mighty!\nGod in three Persons, blessed Trinity!\n\n[Verse 2]\nHoly, holy, holy! All the saints adore Thee,\nCasting down their golden crowns around the glassy sea;\n\nCherubim and seraphim falling down before Thee,\nWho wert, and art, and evermore shalt be.',
    arrangement: '',
  },
  {
    title: 'Doxology', author: 'Thomas Ken', copyright: 'Public Domain', ccli: '',
    lyrics: '[Verse]\nPraise God, from whom all blessings flow;\nPraise Him, all creatures here below;\n\nPraise Him above, ye heavenly host;\nPraise Father, Son, and Holy Ghost.',
    arrangement: '',
  },
].map((s) => ({ id: uid(), ...s }));

function sampleService(songs, bible) {
  const items = [
    { id: uid(), type: 'countdown', label: 'Service begins in', target: '10:30' },
    { id: uid(), type: 'announce', text: 'Welcome to Sunday Worship\nWe are glad you are here\n---\nCommunity Lunch\nAfter the service · Fellowship Hall\n---\nYouth Night\nWednesday · 7 PM · Room 204' },
    { id: uid(), type: 'song', songId: songs[1].id },
    { id: uid(), type: 'song', songId: songs[0].id },
  ];
  try {
    const p = bible.lookup('Psalm 23:1-4');
    items.push({ id: uid(), type: 'scripture', ...p });
  } catch { /* bible missing */ }
  items.push({ id: uid(), type: 'announce', title: 'Sermon', text: 'The Shepherd’s Table\nPsalm 23\n---\nProvision\n“I shall not want”\n---\nPresence\n“Thou art with me”', lobby: false, background: 'preset:ember' });
  items.push({ id: uid(), type: 'song', songId: songs[2].id });
  return { name: 'Sunday Worship', items };
}

function defaults(bible) {
  return {
    version: 1,
    library: { songs: SAMPLE_SONGS },
    service: sampleService(SAMPLE_SONGS, bible),
    servicePath: null,
    settings: {
      defaultBackground: 'preset:aurora',
      prop: { text: 'Grace Chapel', image: null },
      theme: { fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif', textColor: '#ffffff', uppercase: false, shadow: true },
      transitionMs: 300,
      lobbyInterval: 8,
      remoteEnabled: true,
      remotePort: 8650,
      remotePin: String(Math.floor(1000 + Math.random() * 9000)),
      ndiRuntimePath: '',
      timerMinutes: 35,
      textPresets: [],
      inputs: [],
      audioDevice: '',
      mcpEnabled: true,
      claudeKey: '',
      bibleTranslation: 'KJV',
      songFolders: [],
      mediaFolders: [],
      mediaFolder: {},
    },
    outputs: defaultOutputs(),
    usage: [],
  };
}

class Store {
  constructor(dir, bible) {
    this.file = path.join(dir, 'lectern-data.json');
    this.mediaDir = path.join(dir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    const d = defaults(bible);
    this.data = saved ? { ...d, ...saved, settings: { ...d.settings, ...saved.settings, theme: { ...d.settings.theme, ...(saved.settings || {}).theme } } } : d;
    if (!Array.isArray(this.data.outputs) || this.data.outputs.length !== 6) {
      const def = defaultOutputs();
      this.data.outputs = def.map((o, i) => ({ ...o, ...((saved && saved.outputs && saved.outputs[i]) || {}), id: i + 1 }));
    }
    this.timer = null;
    if (!saved) this.flush();
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
  listMedia() {
    try {
      return fs.readdirSync(this.mediaDir).filter((f) => /\.(png|jpe?g|gif|webp|bmp|mp4|mov|m4v|webm|mkv)$/i.test(f)).sort();
    } catch { return []; }
  }
}

module.exports = { Store, uid, LOOK_DEFAULTS, defaultOutputs };

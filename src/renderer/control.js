/* Lectern control window */
(function () {
  const api = window.lectern;
  const S = window.LecternSlides;
  const R = window.LecternRender;
  const esc = R.esc;
  const $ = (id) => document.getElementById(id);

  const TYPE_LABEL = { song: 'Song', scripture: 'Scripture', announce: 'Text', countdown: 'Countdown', media: 'Media', blank: 'Blank', deck: 'PowerPoint', input: 'NDI input' };
  const TYPE_COLOR = { song: '#4f7cff', scripture: '#d6a02c', announce: '#2bb3a3', countdown: '#7a8597', media: '#8a6bd1', blank: '#3a3f47', deck: '#c2563a', input: '#1f9bd1' };
  const LOOKS = {
    main: 'Main · text over background',
    lowerthird: 'Lower third · keyed band',
    lyrics: 'Lyrics key · text only, transparent',
    stage: 'Stage display · current, next, timer',
    lobby: 'Lobby · announcement loop',
    clean: 'Clean feed · background only',
  };
  const PRESETS = [['preset:aurora', 'Aurora (motion)'], ['preset:ember', 'Ember (motion)'], ['preset:forest', 'Forest (motion)'], ['preset:slate', 'Slate'], ['preset:black', 'Black']];
  const RESOLUTIONS = [[1920, 1080], [1280, 720], [3840, 2160], [2560, 1440], [1080, 1920], [1024, 768]];
  const FPS = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];

  let st = null;
  let sel = null;

  // ---------- helpers ----------
  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), err ? 6000 : 2500);
  }
  async function act(type, payload) {
    try { return await api.action(type, payload); } catch (e) { toast(e.message, true); return undefined; }
  }
  const items = () => (st ? st.service.items : []);
  const findItem = (id) => items().find((x) => x.id === id);
  const slidesOf = (it) => S.itemSlides(it, st.library);
  const titleOf = (it) => S.itemTitle(it, st.library);
  const mediaLabel = (v) => {
    if (!v) return '';
    if (v.startsWith('preset:')) return v.slice(7);
    if (v.startsWith('input:')) { const x = (st.settings.inputs || []).find((i) => 'input:' + i.id === v); return 'NDI: ' + (x ? x.name : 'input'); }
    return v;
  };
  const mediaOptions = (selected, { includeDefault = true, includeNone = false, images = false } = {}) => {
    let h = '';
    if (includeDefault) h += '<option value="">Service default</option>';
    if (includeNone) h += '<option value="">None</option>';
    if (!images) h += PRESETS.map(([v, l]) => '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + l + '</option>').join('');
    h += st.media.filter((m) => !images || !R.isVideo(m)).map((m) => '<option value="' + esc(m) + '"' + (m === selected ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
    if (!images) h += (st.settings.inputs || []).map((x) => '<option value="input:' + esc(x.id) + '"' + ('input:' + x.id === selected ? ' selected' : '') + '>NDI: ' + esc(x.name) + '</option>').join('');
    return h;
  };

  function nextPos(state) {
    const list = state.service.items;
    const i = list.findIndex((x) => x.id === state.live.itemId);
    if (i < 0) return list.length ? { itemId: list[0].id, slide: 0 } : null;
    if (state.live.slide + 1 < S.itemSlides(list[i], state.library).length) return { itemId: list[i].id, slide: state.live.slide + 1 };
    for (let j = i + 1; j < list.length; j++) if (S.itemSlides(list[j], state.library).length) return { itemId: list[j].id, slide: 0 };
    return null;
  }

  // ---------- modal ----------
  let modalCleanup = null;
  function openDialog({ title, body, buttons = [], wide = false, onOpen }) {
    $('dlgTitle').textContent = title;
    $('dlgBody').innerHTML = body;
    const foot = $('dlgFoot');
    foot.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      el.addEventListener('click', async () => {
        const r = b.onClick ? await b.onClick() : undefined;
        if (r !== false) closeDialog();
      });
      foot.appendChild(el);
    });
    document.querySelector('.dialog').classList.toggle('wide', wide);
    $('modal').hidden = false;
    modalCleanup = onOpen ? onOpen($('dlgBody')) : null;
    const first = $('dlgBody').querySelector('input, textarea, select');
    if (first) first.focus();
  }
  function closeDialog() {
    $('modal').hidden = true;
    if (typeof modalCleanup === 'function') modalCleanup();
    modalCleanup = null;
    $('dlgBody').innerHTML = '';
  }
  $('dlgClose').addEventListener('click', closeDialog);
  $('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeDialog(); });
  const val = (id) => { const el = document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };

  // ---------- surfaces ----------
  const pgm = new R.Surface($('pgm'), { transitions: true });
  const pvw = new R.Surface($('pvw'), { preview: true, transitions: false });
  const outSurfaces = [];
  let thumbSurfaces = [];

  // ---------- render: service order ----------
  function renderOrder() {
    const list = items();
    const ul = $('order');
    if (!list.length) { ul.innerHTML = '<li class="empty">No items yet. Use + Add.</li>'; return; }
    ul.innerHTML = list.map((it) => {
      const n = slidesOf(it).length;
      const sub = TYPE_LABEL[it.type] + (n > 1 ? ' · ' + n + ' slides' : '') + (it.type === 'countdown' ? ' · ' + esc(it.target) : '');
      return '<li draggable="true" data-id="' + it.id + '" class="' + (it.id === sel ? 'sel ' : '') + (it.id === st.live.itemId ? 'live' : '') + '">' +
        '<span class="sw" style="background:' + TYPE_COLOR[it.type] + '"></span>' +
        '<span style="min-width:0"><div class="t">' + esc(titleOf(it)) + '</div><div class="k">' + sub + '</div></span>' +
        '<span class="live-dot" title="On screen"></span>' +
        '<span class="it-actions"><button data-mv="-1" title="Move up">▲</button><button data-mv="1" title="Move down">▼</button>' +
        (it.type !== 'blank' ? '<button data-edit title="Edit">✎</button>' : '') + '<button data-del title="Remove from service">✕</button></span></li>';
    }).join('');
  }

  $('order').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('[data-mv]')) { act('item/move', { id, dir: Number(e.target.closest('[data-mv]').dataset.mv) }); return; }
    if (e.target.closest('[data-edit]')) { editItem(findItem(id)); return; }
    if (e.target.closest('[data-del]')) { confirmRemove(id); return; }
    sel = id;
    renderAll();
  });
  $('order').addEventListener('dblclick', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li && !e.target.closest('.it-actions')) act('live/go', { itemId: li.dataset.id, slide: 0 });
  });
  let dragId = null;
  $('order').addEventListener('dragstart', (e) => { const li = e.target.closest('li[data-id]'); if (li) { dragId = li.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
  $('order').addEventListener('dragover', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li || !dragId) return;
    e.preventDefault();
    document.querySelectorAll('.order li').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const r = li.getBoundingClientRect();
    li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  $('order').addEventListener('drop', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li || !dragId) return;
    e.preventDefault();
    const list = items();
    const from = list.findIndex((x) => x.id === dragId);
    let to = list.findIndex((x) => x.id === li.dataset.id);
    const r = li.getBoundingClientRect();
    if (e.clientY >= r.top + r.height / 2) to++;
    if (from < to) to--;
    act('item/move', { id: dragId, to: Math.max(0, Math.min(list.length - 1, to)) });
    dragId = null;
  });
  $('order').addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.order li').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });

  function confirmRemove(id) {
    const it = findItem(id);
    openDialog({
      title: 'Remove “' + titleOf(it) + '”?',
      body: '<p>This removes the item from the service. Songs stay in your library.</p>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Remove', cls: 'danger', onClick: () => { if (sel === id) sel = null; act('item/remove', { id }); } }],
    });
  }

  // ---------- render: slide grid ----------
  let gridKey = '';
  function renderGrid() {
    const it = findItem(sel);
    $('itemType').textContent = it ? TYPE_LABEL[it.type] : '—';
    $('itemTitle').textContent = it ? titleOf(it) : 'Select an item in the service order';
    $('editItem').hidden = !it || it.type === 'blank';
    const bgSel = $('itemBg');
    bgSel.disabled = !it;
    const bgKey = (it && it.background || '') + '|' + st.media.join(',');
    if (bgSel.dataset.key !== bgKey) { bgSel.innerHTML = it ? mediaOptions(it.background || '') : ''; bgSel.dataset.key = bgKey; }

    const slides = it ? slidesOf(it) : [];
    const song = it && it.type === 'song' ? st.library.songs.find((s) => s.id === it.songId) : null;
    const key = JSON.stringify([it, song, st.settings.defaultBackground, st.settings.theme, st.media.length, st.service.textLayout, st.settings.textPresets, st.settings.inputs]);
    if (key !== gridKey) {
      gridKey = key;
      thumbSurfaces.forEach((s) => s.destroy());
      thumbSurfaces = [];
      const grid = $('grid');
      if (!it) grid.innerHTML = '<div class="empty">Pick an item on the left to see its slides. Double-click an item to put its first slide on screen.</div>';
      else if (!slides.length) grid.innerHTML = '<div class="empty">This item has no slides yet. Click Edit to add some.</div>';
      else {
        const changes = it.bgChanges || {};
        grid.innerHTML = slides.map((sl, i) => '<div class="slide" role="button" tabindex="0" data-slide="' + i + '">' +
          (changes[i] ? '<span class="bgmark" title="Background from this slide on"><span>▸ ' + esc(mediaLabel(changes[i])) + '</span><button data-unbg="' + i + '" title="Remove this background change" aria-label="Remove background change">✕</button></span>' : '') +
          '<div class="frame"><div></div></div>' +
          '<div class="cap" style="background:' + sl.color + '"><span class="n">' + (i + 1) + '</span>' + esc(sl.group) + '</div></div>').join('');
        const base = S.buildRenderState(st);
        const layout = S.itemLayout(it, st.service, st.settings);
        grid.querySelectorAll('.slide').forEach((btn, i) => {
          const surf = new R.Surface(btn.querySelector('.frame > div'), { preview: true, transitions: false });
          const sl = slides[i];
          surf.update({
            ...base, slide: sl, slideKey: 't' + i, foreground: sl.kind === 'media' ? sl.media : sl.kind === 'input' ? 'input:' + sl.input : null, textLayout: layout,
            background: S.slideBackground(it, i, st.settings), layers: { slide: true, media: true, props: false, msg: false, stage: false },
          }, { look: 'main', fontScale: 1, showProps: false, showMessages: false });
          thumbSurfaces.push(surf);
        });
      }
    }
    const np = nextPos(st);
    $('grid').querySelectorAll('.slide').forEach((btn, i) => {
      btn.classList.toggle('live', st.live.itemId === sel && st.live.slide === i);
      btn.classList.toggle('next', !!np && np.itemId === sel && np.slide === i);
    });
  }
  $('grid').addEventListener('click', (e) => {
    const un = e.target.closest('[data-unbg]');
    if (un) { e.stopPropagation(); act('item/bgChange', { id: sel, slide: Number(un.dataset.unbg), media: null }); return; }
    const b = e.target.closest('[data-slide]');
    if (b && sel) act('live/go', { itemId: sel, slide: Number(b.dataset.slide) });
  });
  $('grid').addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-slide]');
    if (b && (e.key === 'Enter') && sel) { e.preventDefault(); act('live/go', { itemId: sel, slide: Number(b.dataset.slide) }); }
  });
  // Drop a background (from the media library or the Inputs panel) on a slide:
  // it is used from that slide onward, until the next slide with a dropped background.
  $('grid').addEventListener('dragover', (e) => {
    const b = e.target.closest('[data-slide]');
    if (!b || !e.dataTransfer.types.includes('application/x-lectern-bg')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.querySelectorAll('.slide.drop-bg').forEach((x) => x !== b && x.classList.remove('drop-bg'));
    b.classList.add('drop-bg');
  });
  $('grid').addEventListener('dragleave', (e) => { const b = e.target.closest('[data-slide]'); if (b && !b.contains(e.relatedTarget)) b.classList.remove('drop-bg'); });
  $('grid').addEventListener('drop', (e) => {
    const b = e.target.closest('[data-slide]');
    const media = e.dataTransfer.getData('application/x-lectern-bg');
    document.querySelectorAll('.slide.drop-bg').forEach((x) => x.classList.remove('drop-bg'));
    if (!b || !media || !sel) return;
    e.preventDefault();
    const it = findItem(sel);
    const n = Number(b.dataset.slide);
    act('item/bgChange', { id: sel, slide: n, media }).then(() => toast('Background “' + mediaLabel(media) + '” from slide ' + (n + 1) + ' of “' + titleOf(it) + '” on'));
  });
  $('itemBg').addEventListener('change', (e) => { if (sel) act('item/update', { id: sel, patch: { background: e.target.value || null } }); });
  $('editItem').addEventListener('click', () => editItem(findItem(sel)));

  // ---------- render: monitors ----------
  function renderMonitors() {
    const rs = S.buildRenderState(st);
    const mainCfg = { look: 'main', fontScale: (st.outputs[0] && st.outputs[0].look === 'main' && st.outputs[0].fontScale) || 1, showProps: true, showMessages: true };
    pgm.update(rs, mainCfg);
    $('liveLabel').textContent = rs.slide ? rs.itemTitle + ' · ' + rs.slide.group : 'Nothing live';
    const np = nextPos(st);
    if (np) {
      const ns = { ...st, live: np, layers: { ...st.layers, slide: true } };
      const nrs = S.buildRenderState(ns);
      pvw.update(nrs, { ...mainCfg, showMessages: false });
      $('nextLabel').textContent = nrs.itemTitle + ' · ' + (nrs.slide ? nrs.slide.group : '');
    } else {
      pvw.update({ ...rs, slide: null, slideKey: 'end', foreground: null }, mainCfg);
      $('nextLabel').textContent = 'End of service';
    }
    document.querySelectorAll('.clr[data-clear]').forEach((b) => b.classList.toggle('off', !st.layers[b.dataset.clear]));
    $('msgBtn').setAttribute('aria-pressed', String(!!st.layers.msg));
    $('msgBtn').textContent = st.layers.msg ? 'Hide' : 'Show';
    $('stageBtn').setAttribute('aria-pressed', String(!!st.layers.stage));
    $('stageBtn').textContent = st.layers.stage ? 'Hide' : 'Show';
    if (document.activeElement !== $('msgText')) $('msgText').value = st.message;
    if (document.activeElement !== $('stageText')) $('stageText').value = st.stageMessage;
    if (document.activeElement !== $('timerMin')) $('timerMin').value = Math.round(st.timer.durationMs / 60000);
    $('timerToggle').textContent = st.timer.running ? 'Stop' : 'Start';
  }

  // ---------- render: outputs ----------
  function buildOutputs() {
    $('outs').innerHTML = [0, 1, 2, 3, 4, 5].map((i) =>
      '<div class="out" data-out="' + i + '">' +
      '<div class="out-top"><span class="out-num">' + (i + 1) + '</span><span class="out-name"></span>' +
      '<button class="btn icon small" data-cfg="' + i + '" title="Output settings" aria-label="Output ' + (i + 1) + ' settings">⚙</button>' +
      '<button class="switch" role="switch" data-en="' + i + '" aria-label="Enable output ' + (i + 1) + '"></button></div>' +
      '<div class="frame"><div></div></div>' +
      '<div class="out-meta"><span class="st"></span><span class="look"></span></div></div>').join('');
    document.querySelectorAll('.out .frame > div').forEach((el, i) => { outSurfaces[i] = new R.Surface(el, { preview: true, transitions: false }); });
  }
  $('outs').addEventListener('click', (e) => {
    const en = e.target.closest('[data-en]');
    if (en) { const i = Number(en.dataset.en); act('output/update', { index: i, patch: { enabled: !st.outputs[i].enabled } }); return; }
    const cfg = e.target.closest('[data-cfg]');
    if (cfg) editOutput(Number(cfg.dataset.cfg));
  });

  function renderOutputs() {
    const rs = S.buildRenderState(st);
    const statuses = (st.status && st.status.outputs) || [];
    document.querySelectorAll('.out').forEach((card, i) => {
      const o = st.outputs[i];
      const s = statuses[i] || {};
      card.classList.toggle('disabled', !o.enabled);
      card.querySelector('.out-name').textContent = o.name;
      card.querySelector('[data-en]').setAttribute('aria-checked', String(!!o.enabled));
      card.querySelector('.frame').classList.toggle('checker', !!o.alpha);
      card.querySelector('.look').textContent = o.look;
      let pill;
      if (!o.enabled) pill = '<span class="pill off">Off</span>';
      else {
        const parts = [];
        if (o.ndi) {
          if (s.ndi === 'error') parts.push('<span class="pill err" title="' + esc(s.error || '') + '">NDI error</span>');
          else if (s.ndi === 'sending') parts.push((s.tally && s.tally.includes('program') ? '<span class="pill pgm">On air</span> ' : '<span class="pill ok">NDI</span> ') + (s.connections || 0) + ' rx');
          else parts.push('<span class="pill off">NDI…</span>');
        }
        if (o.display) parts.push(s.display === 'missing' ? '<span class="pill err">Display missing</span>' : '<span class="pill ok">Screen</span>');
        if (!parts.length) parts.push('<span class="pill off">No destination</span>');
        pill = parts.join(' ');
      }
      card.querySelector('.st').innerHTML = pill + ' <span class="mono">' + o.width + '×' + o.height + ' ' + o.fps + '</span>';
      if (outSurfaces[i]) outSurfaces[i].update(rs, o);
    });
    const n = st.status && st.status.ndi;
    $('ndiInfo').textContent = n ? (n.ok ? 'NDI ' + (n.version || '') : 'NDI runtime not found') + (st.status.remote && st.status.remote.urls && st.status.remote.urls[0] ? ' · Remote: ' + st.status.remote.urls[0] + ' (PIN ' + st.settings.remotePin + ')' : '') : '';
    const banner = $('ndiBanner');
    const needsNdi = st.outputs.some((o) => o.enabled && o.ndi);
    if (n && !n.ok && needsNdi) {
      banner.hidden = false;
      if (!banner.dataset.built) {
        banner.dataset.built = '1';
        banner.innerHTML = '<span><b>NDI runtime not found.</b> Install NDI Tools (free) to send NDI. Screen outputs and previews still work.</span>' +
          '<button class="btn small" id="getNdi">Get NDI Tools</button><button class="btn small" id="retryNdi">Retry</button><button class="btn small" id="locNdi">Set location…</button>';
        $('getNdi').onclick = () => act('app/openExternal', { url: 'https://ndi.video/tools/' });
        $('retryNdi').onclick = () => act('app/retryNdi');
        $('locNdi').onclick = () => openSettings();
      }
    } else banner.hidden = true;
  }

  // ---------- library: songs ----------
  function renderSongs() {
    const q = $('songSearch').value.trim().toLowerCase();
    const songs = st.library.songs.slice().sort((a, b) => a.title.localeCompare(b.title))
      .filter((s) => !q || s.title.toLowerCase().includes(q) || (s.author || '').toLowerCase().includes(q) || (s.lyrics || '').toLowerCase().includes(q));
    $('songList').innerHTML = songs.length ? songs.map((s) =>
      '<li data-song="' + s.id + '"><span class="s-t" title="Edit">' + esc(s.title) + (s.author ? ' <span class="s-a">' + esc(s.author) + '</span>' : '') + '</span>' +
      '<button class="btn small ghost" data-addsong="' + s.id + '" title="Add to service">+ Add</button></li>').join('')
      : '<li class="empty">No songs match.</li>';
  }
  $('songSearch').addEventListener('input', renderSongs);
  $('songList').addEventListener('click', (e) => {
    const add = e.target.closest('[data-addsong]');
    if (add) { addItem({ type: 'song', songId: add.dataset.addsong }); return; }
    const li = e.target.closest('[data-song]');
    if (li) editSong(st.library.songs.find((s) => s.id === li.dataset.song));
  });
  $('newSong').addEventListener('click', () => editSong(null));

  async function addItem(item) {
    const id = await act('item/add', { item, after: sel || undefined });
    if (id) { sel = id; renderAll(); toast('Added to service'); }
    return id;
  }

  // ---------- library: bible ----------
  let bibleTimer = null;
  let bibleResult = null;
  $('bibleRef').addEventListener('input', () => {
    clearTimeout(bibleTimer);
    bibleTimer = setTimeout(async () => {
      const ref = $('bibleRef').value.trim();
      if (!ref) return;
      try {
        bibleResult = await api.action('bible/lookup', { ref });
        $('biblePrev').innerHTML = '<div class="section-title">' + esc(bibleResult.ref) + ' · KJV</div>' +
          bibleResult.verses.map((v) => '<div><sup>' + v.verse + '</sup>' + esc(v.text) + '</div>').join('');
      } catch (e) { bibleResult = null; $('biblePrev').innerHTML = '<span class="hint">' + esc(e.message) + '</span>'; }
    }, 250);
  });
  async function addBible() {
    const ref = $('bibleRef').value.trim();
    if (!ref) return;
    const r = await act('bible/lookup', { ref });
    if (r) addItem({ type: 'scripture', ref: r.ref, translation: r.translation, verses: r.verses });
  }
  $('bibleAdd').addEventListener('click', addBible);
  $('bibleRef').addEventListener('keydown', (e) => { if (e.key === 'Enter') addBible(); });

  // ---------- library: media ----------
  function renderMedia() {
    const all = PRESETS.map(([v, l]) => ({ v, l })).concat(st.media.map((m) => ({ v: m, l: m })));
    const key = JSON.stringify([all, st.settings.defaultBackground, st.service.mediaOptions]);
    if ($('mediaGrid').dataset.key === key) return;
    $('mediaGrid').dataset.key = key;
    const opts = st.service.mediaOptions || {};
    $('mediaGrid').innerHTML = all.map(({ v, l }) =>
      '<button class="mthumb' + (v === st.settings.defaultBackground ? ' default' : '') + '" data-media="' + esc(v) + '" draggable="true" title="' + esc(l) + ' · drag onto a slide">' +
      R.mediaHTML(v, { still: true }) + (opts[v] && opts[v].speed !== 1 ? '<b class="speed">' + opts[v].speed + '×</b>' : '') + '<span>' + esc(l.replace(/^preset:/, '')) + '</span></button>').join('');
  }
  $('mediaGrid').addEventListener('dragstart', (e) => {
    const b = e.target.closest('[data-media]');
    if (!b) return;
    e.dataTransfer.setData('application/x-lectern-bg', b.dataset.media);
    e.dataTransfer.effectAllowed = 'copy';
  });
  $('mediaGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-media]');
    if (!b) return;
    const name = b.dataset.media;
    const it = findItem(sel);
    const isPreset = name.startsWith('preset:');
    const video = R.isVideo(name);
    const o = (st.service.mediaOptions || {})[name] || {};
    const speed = Number(o.speed) || 1;
    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
    openDialog({
      title: name.replace(/^preset:/, ''),
      body: '<div class="frame" style="border-radius:6px"><div>' + R.mediaHTML(name, { muted: true }) + '</div></div>' +
        (video ? '<div class="section-title">Playback</div><div class="fields">' +
          '<label class="field"><span>Speed</span><select id="mdSpeed">' + SPEEDS.map((x) => '<option value="' + x + '"' + (x === speed ? ' selected' : '') + '>' + (x === 1 ? '100% (normal)' : Math.round(x * 100) + '%') + '</option>').join('') +
          (SPEEDS.includes(speed) ? '' : '<option value="' + speed + '" selected>' + Math.round(speed * 100) + '%</option>') + '</select></label>' +
          '<label class="field"><span>Sound</span><select id="mdAudio"><option value="follow"' + (o.audioFollow !== false ? ' selected' : '') + '>Follows the video speed</option><option value="normal"' + (o.audioFollow === false ? ' selected' : '') + '>Stays at 100%</option></select>' +
          '<small>Keeping the sound at 100% suits videos without speech. It can drift from the picture.</small></label>' +
          '</div><div class="row"><button class="btn small ghost" id="mdReset">Reset to 100%</button><span class="hint">Saved with the service. Changes apply straight away, even while the video is live.</span></div>' : ''),
      onOpen: video ? (body) => {
        const save = () => act('media/options', { name, speed: Number(body.querySelector('#mdSpeed').value), audioFollow: body.querySelector('#mdAudio').value !== 'normal' });
        body.querySelector('#mdSpeed').addEventListener('change', save);
        body.querySelector('#mdAudio').addEventListener('change', save);
        body.querySelector('#mdReset').addEventListener('click', () => { body.querySelector('#mdSpeed').value = '1'; body.querySelector('#mdAudio').value = 'follow'; save(); });
      } : undefined,
      buttons: [
        ...(!isPreset ? [{ label: 'Delete', cls: 'danger', onClick: () => act('media/remove', { name }) }] : []),
        { label: 'Use as service default', cls: 'ghost', onClick: () => act('settings/update', { patch: { defaultBackground: name } }) },
        ...(it && it.type !== 'media' ? [{ label: 'Background for “' + titleOf(it).slice(0, 18) + '”', cls: 'ghost', onClick: () => act('item/update', { id: it.id, patch: { background: name } }) }] : []),
        ...(!isPreset ? [{ label: 'Add to service', cls: 'primary', onClick: () => addItem({ type: 'media', media: name }) }] : []),
      ],
    });
  });

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- add menu ----------
  $('addBtn').addEventListener('click', (e) => { e.stopPropagation(); $('addMenu').hidden = !$('addMenu').hidden; });
  document.addEventListener('click', () => { $('addMenu').hidden = true; });
  $('addMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    $('addMenu').hidden = true;
    const t = b.dataset.add;
    if (t === 'song') pickSong();
    else if (t === 'scripture') { showTab('bible'); $('bibleRef').focus(); $('bibleRef').select(); }
    else if (t === 'announce') { const id = await addItem({ type: 'announce', text: 'Welcome\nWe are glad you are here' }); if (id) editItem(findItem(id)); }
    else if (t === 'countdown') { const id = await addItem({ type: 'countdown', label: 'Service begins in', target: '10:30' }); if (id) editItem(findItem(id)); }
    else if (t === 'media') pickMedia((name) => addItem({ type: 'media', media: name }));
    else if (t === 'pptx') importPowerPoint();
    else if (t === 'input') pickInputItem();
    else if (t === 'blank') addItem({ type: 'blank' });
  });

  function pickSong() {
    openDialog({
      title: 'Add a song',
      body: '<input id="pkQ" placeholder="Search by title, author or lyric">' +
        '<ul class="songlist" id="pkList" style="max-height:360px"></ul>',
      buttons: [{ label: 'New song…', cls: 'ghost', onClick: () => { setTimeout(() => editSong(null, true), 0); } }, { label: 'Close' }],
      onOpen: (body) => {
        const draw = () => {
          const q = body.querySelector('#pkQ').value.trim().toLowerCase();
          body.querySelector('#pkList').innerHTML = st.library.songs.filter((s) => !q || (s.title + ' ' + (s.author || '') + ' ' + (s.lyrics || '')).toLowerCase().includes(q))
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((s) => '<li><span class="s-t">' + esc(s.title) + ' <span class="s-a">' + esc(s.author || '') + '</span></span><button class="btn small primary" data-pick="' + s.id + '">Add</button></li>').join('') || '<li class="empty">No songs match.</li>';
        };
        body.querySelector('#pkQ').addEventListener('input', draw);
        body.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { closeDialog(); addItem({ type: 'song', songId: b.dataset.pick }); } });
        draw();
      },
    });
  }

  function pickMedia(onPick) {
    if (!st.media.length) {
      openDialog({ title: 'No media yet', body: '<p>Import images or videos first. They are copied into Lectern’s media library.</p>', buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Import media…', cls: 'primary', onClick: async () => { const added = await act('media/import'); if (added && added[0]) onPick(added[0]); } }] });
      return;
    }
    openDialog({
      title: 'Choose media',
      body: '<div class="mediagrid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">' + st.media.map((m) => '<button class="mthumb" data-pm="' + esc(m) + '">' + R.mediaHTML(m, { still: true }) + '<span>' + esc(m) + '</span></button>').join('') + '</div>',
      buttons: [{ label: 'Import…', cls: 'ghost', onClick: async () => { await act('media/import'); setTimeout(() => pickMedia(onPick), 0); } }, { label: 'Cancel' }],
      onOpen: (body) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-pm]'); if (b) { closeDialog(); onPick(b.dataset.pm); } }),
    });
  }

  // ---------- editors ----------
  function editItem(it) {
    if (!it) return;
    if (it.type === 'song') return editSong(st.library.songs.find((s) => s.id === it.songId), false, it);
    if (it.type === 'announce') return editAnnounce(it);
    if (it.type === 'countdown') return editCountdown(it);
    if (it.type === 'scripture') return editScripture(it);
    if (it.type === 'media') return pickMedia((name) => act('item/update', { id: it.id, patch: { media: name } }));
    if (it.type === 'deck') return editDeck(it);
    if (it.type === 'input') return pickInputItem(it);
  }

  function editDeck(it) {
    openDialog({
      title: 'PowerPoint slides',
      body: '<label class="field"><span>Name in service order</span><input id="dkTitle" value="' + esc(it.title || '') + '"></label>' +
        '<p class="hint">' + (it.slides || []).length + ' slides imported as pictures. Their images are in the media library. Drag a background onto a slide to change it; pictures cover the background.</p>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', cls: 'primary', onClick: () => act('item/update', { id: it.id, patch: { title: val('dkTitle').trim() || it.title } }) }],
    });
  }

  // ---------- PowerPoint ----------
  async function importPowerPoint(file) {
    if (!file) file = await act('pptx/pick');
    if (!file) return;
    const name = file.split(/[\\/]/).pop();
    openDialog({
      title: 'Import “' + name + '”',
      body: '<p>How should the slides come in?</p>' +
        '<div class="fields"><div class="out"><b>As text slides</b><span class="hint">Each slide’s heading and text become editable Lectern slides, styled with your text boxes and presets.</span></div>' +
        '<div class="out"><b>As pictures</b><span class="hint">Each slide becomes an image that looks exactly like the original. Needs PowerPoint (Windows) or the free LibreOffice.</span></div></div>',
      buttons: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'As pictures', cls: 'ghost', onClick: () => { runImport(file, 'pictures'); } },
        { label: 'As text slides', cls: 'primary', onClick: () => { runImport(file, 'text'); } },
      ],
    });
  }
  async function runImport(file, mode) {
    toast(mode === 'pictures' ? 'Turning the slides into pictures…' : 'Reading the slides…');
    const r = await act('pptx/import', { path: file, mode, after: sel || undefined });
    if (r) { sel = r.id; renderAll(); toast('Imported ' + r.slides + ' slide' + (r.slides === 1 ? '' : 's')); }
  }

  // Drop files from the desktop on the service order: PowerPoint files are imported,
  // images and videos are added to the media library and the service.
  $('order').addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    $('order').classList.add('file-over');
  });
  $('order').addEventListener('dragleave', (e) => { if (!$('order').contains(e.relatedTarget)) $('order').classList.remove('file-over'); });
  $('order').addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    $('order').classList.remove('file-over');
    const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean);
    const decks = paths.filter((p) => /\.pptx?$/i.test(p));
    const media = paths.filter((p) => /\.(png|jpe?g|gif|webp|bmp|mp4|mov|m4v|webm|mkv)$/i.test(p));
    if (media.length) {
      const added = await act('media/import', { paths: media });
      for (const m of added || []) await addItem({ type: 'media', media: m });
    }
    if (decks.length) importPowerPoint(decks[0]);
    if (!decks.length && !media.length) toast('Drop PowerPoint files, images or videos here.', true);
  });

  // ---------- NDI inputs ----------
  const inputSurfaces = new Map();
  function renderInputs() {
    const list = st.settings.inputs || [];
    const status = (st.status.inputs && st.status.inputs.inputs) || {};
    const box = $('inputs');
    const key = JSON.stringify(list.map((x) => [x.id, x.name, x.source]));
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      inputSurfaces.clear();
      box.innerHTML = list.length ? list.map((x) =>
        '<div class="inp" data-inp="' + esc(x.id) + '">' +
        '<div class="frame" draggable="true" title="Drag onto a slide to use as its background"><div>' + R.mediaHTML('input:' + x.id) + '</div></div>' +
        '<div class="inp-body"><div class="inp-name"></div><div class="inp-src"></div>' +
        '<div class="inp-row"><button class="btn small" data-inbg>Background</button><button class="btn small" data-infull>Full screen</button><button class="btn small ghost" data-inmore aria-label="Input options">⋯</button></div>' +
        '<div class="inp-row"><button class="toggle" data-inaudio aria-pressed="false" title="Play this input’s audio">Audio</button>' +
        '<input type="range" min="0" max="2" step="0.05" data-invol aria-label="Input volume"><span class="inp-vol"></span></div></div></div>').join('')
        : '<div class="empty">No NDI inputs yet. Use + NDI input to add a camera, a computer or any other NDI source on the network.' +
          (st.status.inputs && st.status.inputs.error ? '<br><span class="hint">' + esc(st.status.inputs.error) + '</span>' : '') + '</div>';
    }
    list.forEach((x) => {
      const card = box.querySelector('[data-inp="' + CSS.escape(x.id) + '"]');
      if (!card) return;
      const s2 = status[x.id] || {};
      card.querySelector('.inp-name').textContent = x.name;
      const ndiErr = st.status.inputs && st.status.inputs.error;
      const stateText = s2.state === 'live' ? '● ' + s2.w + '×' + s2.h + ' ' + s2.fps + ' fps'
        : s2.state === 'error' ? 'Error: ' + (s2.error || '')
          : s2.state === 'no signal' ? 'No signal'
            : !s2.state && ndiErr ? 'NDI runtime not found' : 'Connecting…';
      card.querySelector('.inp-src').textContent = stateText + ' · ' + x.source;
      card.querySelector('.inp-src').title = !s2.state && ndiErr ? ndiErr : x.source;
      const a = card.querySelector('[data-inaudio]');
      a.setAttribute('aria-pressed', String(!!x.audio));
      const vol = card.querySelector('[data-invol]');
      if (document.activeElement !== vol) vol.value = x.volume == null ? 1 : x.volume;
      card.querySelector('.inp-vol').textContent = Math.round((x.volume == null ? 1 : x.volume) * 100) + '%';
    });
    R.Surface && window.LecternInputHub.refresh();
  }
  $('inputs').addEventListener('click', (e) => {
    const card = e.target.closest('[data-inp]');
    if (!card) return;
    const id = card.dataset.inp;
    const x = (st.settings.inputs || []).find((i) => i.id === id);
    if (!x) return;
    if (e.target.closest('[data-inaudio]')) act('input/update', { id, patch: { audio: !x.audio } });
    else if (e.target.closest('[data-inbg]')) {
      const it = findItem(sel);
      if (!it) { toast('Select an item first, or drag the input onto a slide.', true); return; }
      act('item/update', { id: it.id, patch: { background: 'input:' + id } }).then(() => toast('“' + x.name + '” is the background for “' + titleOf(it) + '”'));
    } else if (e.target.closest('[data-infull]')) {
      addItem({ type: 'input', input: id }).then((newId) => newId && act('live/go', { itemId: newId, slide: 0 }));
    } else if (e.target.closest('[data-inmore]')) editInput(x);
  });
  $('inputs').addEventListener('input', (e) => {
    const v = e.target.closest('[data-invol]');
    if (!v) return;
    const id = e.target.closest('[data-inp]').dataset.inp;
    e.target.closest('[data-inp]').querySelector('.inp-vol').textContent = Math.round(Number(v.value) * 100) + '%';
    clearTimeout(v._t);
    v._t = setTimeout(() => act('input/update', { id, patch: { volume: Number(v.value) } }), 120);
  });
  $('inputs').addEventListener('dragstart', (e) => {
    const card = e.target.closest('[data-inp]');
    if (!card) return;
    e.dataTransfer.setData('application/x-lectern-bg', 'input:' + card.dataset.inp);
    e.dataTransfer.effectAllowed = 'copy';
  });
  function editInput(x) {
    openDialog({
      title: 'NDI input',
      body: '<div class="fields"><label class="field"><span>Name</span><input id="inName" value="' + esc(x.name) + '"></label>' +
        '<label class="field"><span>NDI source</span><input id="inSrc" value="' + esc(x.source) + '" list="inSources"><datalist id="inSources">' +
        ((st.status.inputs && st.status.inputs.sources) || []).map((s2) => '<option value="' + esc(s2) + '">').join('') + '</datalist></label></div>' +
        '<p class="hint">Audio plays through the audio device chosen in Settings → Audio, with its own on/off and volume here, whether or not the input is on screen.</p>',
      buttons: [
        { label: 'Remove input', cls: 'danger', onClick: () => act('input/remove', { id: x.id }) },
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Save', cls: 'primary', onClick: () => act('input/update', { id: x.id, patch: { name: val('inName').trim() || x.name, source: val('inSrc').trim() || x.source } }) },
      ],
    });
  }
  function addInputDialog(then) {
    act('input/discover');
    openDialog({
      title: 'Add an NDI input',
      body: '<p class="hint">NDI sources found on the network. New sources appear here as they are found.</p><ul class="songlist" id="srcList" style="max-height:320px"></ul>' +
        '<label class="field"><span>Or type a source name</span><input id="srcName" placeholder="COMPUTER (Camera 1)"></label>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Add', cls: 'primary', onClick: async () => { const n = val('srcName').trim(); if (!n) return false; const id = await act('input/add', { source: n }); if (id && then) then(id); } }],
      onOpen: (body) => {
        const draw = () => {
          const srcs = (st.status.inputs && st.status.inputs.sources) || [];
          const used = new Set((st.settings.inputs || []).map((x) => x.source));
          const err = st.status.inputs && st.status.inputs.error;
          body.querySelector('#srcList').innerHTML = srcs.length ? srcs.map((s2) => '<li><span class="s-t">' + esc(s2) + (used.has(s2) ? ' <span class="s-a">added</span>' : '') + '</span><button class="btn small primary" data-src="' + esc(s2) + '">Add</button></li>').join('')
            : '<li class="empty">' + (err ? esc(err) : 'Looking for NDI sources…') + '</li>';
        };
        draw();
        const t = setInterval(draw, 1000);
        body.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-src]');
          if (!b) return;
          closeDialog();
          const id = await act('input/add', { source: b.dataset.src });
          if (id) { window.LecternLayout.expand('inputs'); if (then) then(id); }
        });
        return () => clearInterval(t);
      },
    });
  }
  $('addInput').addEventListener('click', () => addInputDialog());
  function pickInputItem(it) {
    const list = st.settings.inputs || [];
    if (!list.length) { addInputDialog((id) => (it ? act('item/update', { id: it.id, patch: { input: id } }) : addItem({ type: 'input', input: id }))); return; }
    openDialog({
      title: it ? 'Change NDI input' : 'Add an NDI input to the service',
      body: '<ul class="songlist">' + list.map((x) => '<li><span class="s-t">' + esc(x.name) + ' <span class="s-a">' + esc(x.source) + '</span></span><button class="btn small primary" data-pi="' + esc(x.id) + '">' + (it ? 'Use' : 'Add') + '</button></li>').join('') + '</ul>',
      buttons: [{ label: 'New input…', cls: 'ghost', onClick: () => { setTimeout(() => addInputDialog((id) => (it ? act('item/update', { id: it.id, patch: { input: id } }) : addItem({ type: 'input', input: id }))), 0); } }, { label: 'Cancel' }],
      onOpen: (body) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-pi]'); if (!b) return; closeDialog(); if (it) act('item/update', { id: it.id, patch: { input: b.dataset.pi } }); else addItem({ type: 'input', input: b.dataset.pi }); }),
    });
  }

  // ---------- Claude chat panel ----------
  function chatLine(cls, text, done) {
    const el = document.createElement('div');
    el.className = 'chat-msg ' + cls;
    el.textContent = text;
    if (done && done.length) { const d2 = document.createElement('div'); d2.className = 'done'; d2.textContent = done.map((x) => '✓ ' + x).join('\n'); el.appendChild(d2); }
    $('chatLog').appendChild(el);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return el;
  }
  function chatIntro() {
    $('chatLog').innerHTML = '';
    chatLine('ai', st && st.claude && st.claude.hasKey
      ? 'Ask me to change things in Lectern, such as text size, fonts, backgrounds, importing files or building the service order. I’ll ask before each change, and you can undo it.'
      : 'To chat with Claude here, add your Anthropic API key in Settings → Claude. You can also connect the Claude desktop app from the same place.');
  }
  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('chatText').value.trim();
    if (!text) return;
    $('chatText').value = '';
    chatLine('me', text);
    $('chatSend').disabled = true;
    const wait = chatLine('step', 'Thinking…');
    try {
      const r = await api.action('chat/send', { text });
      wait.remove();
      chatLine('ai', r.text, r.done);
    } catch (err) {
      wait.remove();
      chatLine('err', err.message);
    } finally {
      $('chatSend').disabled = false;
      $('chatText').focus();
    }
  });
  $('chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } });
  $('chatReset').addEventListener('click', () => { act('chat/reset'); chatIntro(); });
  $('chatUndo').addEventListener('click', async () => { const label = await act('claude/undo'); if (label) { chatLine('step', 'Undone: ' + label); toast('Undone: ' + label); } });

  api.onEvent((ev) => {
    if (ev.type === 'chat/step') {
      const last = $('chatLog').lastElementChild;
      if (last && last.classList.contains('step')) last.textContent = ev.text; else chatLine('step', ev.text);
    } else if (ev.type === 'pptx/import') importPowerPoint();
    else if (ev.type === 'layout/reset') window.LecternLayout.reset();
    else if (ev.type === 'toast') toast(ev.text);
  });

  function slidePreviewList(slides) {
    return slides.map((s, i) => '<div class="out" style="padding:6px"><div class="out-top"><span class="pill" style="background:' + s.color + ';color:#fff">' + esc(s.group) + '</span><span class="out-num">' + (i + 1) + '</span></div>' +
      '<div style="white-space:pre-wrap;font-size:12px">' + esc(S.plainText(s)) + '</div></div>').join('') || '<span class="hint">No slides yet.</span>';
  }

  function editSong(song, addAfter, serviceItem) {
    const isNew = !song;
    const s = song ? { ...song } : { title: '', author: '', copyright: '', ccli: '', arrangement: '', lyrics: '[Verse 1]\n\n\n[Chorus]\n' };
    openDialog({
      title: isNew ? 'New song' : 'Edit song',
      wide: true,
      body:
        '<div class="fields">' +
        '<label class="field"><span>Title</span><input id="sgTitle" value="' + esc(s.title) + '"></label>' +
        '<label class="field"><span>Author</span><input id="sgAuthor" value="' + esc(s.author) + '"></label>' +
        '<label class="field"><span>Copyright</span><input id="sgCopy" value="' + esc(s.copyright) + '"></label>' +
        '<label class="field"><span>CCLI song number</span><input id="sgCcli" value="' + esc(s.ccli) + '"></label></div>' +
        '<div class="split"><label class="field"><span>Lyrics</span><textarea id="sgLyrics" rows="18" spellcheck="false">' + esc(s.lyrics) + '</textarea>' +
        '<small>Start each section with a label in brackets, such as [Verse 1] or [Chorus]. A blank line starts a new slide.</small></label>' +
        '<div class="field"><span>Slides</span><div class="pv-list" id="sgPrev"></div></div></div>' +
        '<label class="field"><span>Arrangement</span><input id="sgArr" value="' + esc(Array.isArray(s.arrangement) ? s.arrangement.join(', ') : s.arrangement || '') + '" placeholder="Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus">' +
        '<small id="sgSections"></small></label>',
      buttons: [
        ...(!isNew && !serviceItem ? [{ label: 'Delete song', cls: 'danger', onClick: async () => { await act('song/delete', { id: s.id }); } }] : []),
        { label: 'Cancel', cls: 'ghost' },
        ...(isNew || addAfter ? [{ label: 'Save and add to service', cls: 'ghost', onClick: async () => { const id = await save(); if (!id) return false; addItem({ type: 'song', songId: id }); } }] : []),
        { label: 'Save', cls: 'primary', onClick: async () => { const id = await save(); if (!id) return false; } },
      ],
      onOpen: (body) => {
        const draw = () => {
          const tmp = { title: val('sgTitle'), author: val('sgAuthor'), copyright: val('sgCopy'), ccli: val('sgCcli'), lyrics: val('sgLyrics'), arrangement: val('sgArr') };
          body.querySelector('#sgPrev').innerHTML = slidePreviewList(S.songSlides(tmp));
          body.querySelector('#sgSections').textContent = 'Sections: ' + (S.parseLyrics(tmp.lyrics).map((x) => x.name).join(', ') || 'none') + '. Leave empty to use them in order.';
        };
        body.addEventListener('input', draw);
        draw();
      },
    });
    async function save() {
      const out = { ...s, title: val('sgTitle').trim(), author: val('sgAuthor').trim(), copyright: val('sgCopy').trim(), ccli: val('sgCcli').trim(), lyrics: val('sgLyrics'), arrangement: val('sgArr').trim() };
      const id = await act('song/save', { song: out });
      if (id) toast('Song saved');
      return id;
    }
  }

  function editAnnounce(it) {
    openDialog({
      title: 'Edit text slides',
      wide: true,
      body:
        '<label class="field"><span>Name in service order</span><input id="anTitle" value="' + esc(it.title || '') + '" placeholder="Announcements"></label>' +
        '<div class="split"><label class="field"><span>Slides</span><textarea id="anText" rows="16">' + esc(it.text || '') + '</textarea>' +
        '<small>First line of each slide is the heading. Put a line with --- between slides.</small></label>' +
        '<div class="field"><span>Preview</span><div class="pv-list" id="anPrev"></div></div></div>' +
        '<label class="check"><input type="checkbox" id="anLobby"' + (it.lobby !== false ? ' checked' : '') + '> Include these slides in the Lobby loop</label>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', cls: 'primary', onClick: () => act('item/update', { id: it.id, patch: { title: val('anTitle').trim() || undefined, text: val('anText'), lobby: val('anLobby') } }) }],
      onOpen: (body) => {
        const draw = () => { body.querySelector('#anPrev').innerHTML = slidePreviewList(S.announceSlides({ text: val('anText') })); };
        body.addEventListener('input', draw);
        draw();
      },
    });
  }

  function editCountdown(it) {
    openDialog({
      title: 'Countdown',
      body:
        '<div class="fields"><label class="field"><span>Text above the clock</span><input id="cdLabel" value="' + esc(it.label || '') + '"></label>' +
        '<label class="field"><span>Count down to (time of day)</span><input id="cdTarget" type="time" value="' + esc(it.target || '10:30') + '"></label></div>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', cls: 'primary', onClick: () => act('item/update', { id: it.id, patch: { label: val('cdLabel'), target: val('cdTarget') || '10:30' } }) }],
    });
  }

  function editScripture(it) {
    openDialog({
      title: 'Scripture',
      body:
        '<div class="fields"><label class="field"><span>Reference (KJV)</span><input id="scRef" value="' + esc(it.ref || '') + '"></label>' +
        '<label class="field"><span>Max characters per slide</span><input id="scMax" type="number" min="60" max="800" value="' + (it.maxChars || 240) + '"></label></div>' +
        '<label class="check"><input type="checkbox" id="scNums"' + (it.verseNumbers !== false ? ' checked' : '') + '> Show verse numbers</label>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, {
        label: 'Save', cls: 'primary', onClick: async () => {
          const r = await act('bible/lookup', { ref: val('scRef') });
          if (!r) return false;
          await act('item/update', { id: it.id, patch: { ref: r.ref, verses: r.verses, translation: r.translation, maxChars: Number(val('scMax')) || 240, verseNumbers: val('scNums') } });
        },
      }],
    });
  }

  function editOutput(i) {
    const o = st.outputs[i];
    const s = (st.status.outputs || [])[i] || {};
    const resVal = o.width + 'x' + o.height;
    const resOpts = RESOLUTIONS.map(([w, h]) => w + 'x' + h);
    if (!resOpts.includes(resVal)) resOpts.push(resVal);
    openDialog({
      title: 'Output ' + (i + 1),
      body:
        '<div class="fields">' +
        '<label class="field"><span>Name</span><input id="oName" value="' + esc(o.name) + '"><small>NDI source: ' + esc((st.settings.ndiPrefix || 'LECTERN') + ' ' + (i + 1) + ' (' + o.name + ')') + '</small></label>' +
        '<label class="field"><span>Look</span><select id="oLook">' + Object.entries(LOOKS).map(([k, l]) => '<option value="' + k + '"' + (k === o.look ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
        '</div><div class="fields">' +
        '<label class="field"><span>Resolution</span><select id="oRes">' + resOpts.map((r) => '<option' + (r === resVal ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Frame rate</span><select id="oFps">' + FPS.map((f) => '<option' + (f === String(o.fps) ? ' selected' : '') + '>' + f + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Text size</span><input id="oScale" type="range" min="0.5" max="1.8" step="0.05" value="' + (o.fontScale || 1) + '"></label>' +
        '</div>' +
        '<div class="section-title">Destinations</div>' +
        '<div class="fields">' +
        '<label class="check"><input type="checkbox" id="oNdi"' + (o.ndi ? ' checked' : '') + '> Send over NDI</label>' +
        '<label class="field"><span>NDI groups (optional)</span><input id="oGroups" value="' + esc(o.groups || '') + '" placeholder="public"></label>' +
        '<label class="field"><span>Also show fullscreen on</span><select id="oDisp"><option value="">No screen</option>' +
        (st.status.displays || []).map((d) => '<option value="' + esc(d.id) + '"' + (String(o.display) === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>').join('') + '</select></label>' +
        '</div>' +
        '<div class="section-title">Layers</div>' +
        '<div class="fields">' +
        '<label class="check"><input type="checkbox" id="oAlpha"' + (o.alpha ? ' checked' : '') + '> Send with transparency (alpha)</label>' +
        '<label class="check"><input type="checkbox" id="oProps"' + (o.showProps ? ' checked' : '') + '> Show props (logo)</label>' +
        '<label class="check"><input type="checkbox" id="oMsg"' + (o.showMessages ? ' checked' : '') + '> Show audience messages</label>' +
        '<label class="check"><input type="checkbox" id="oAudio"' + (o.audio ? ' checked' : '') + '> Play video audio from this output</label>' +
        '<label class="field"><span>Audio device for this output</span><select id="oDev"><option value="">System default</option></select><small>Choose Dante Via (or another Dante device) to send this output’s sound to Dante.</small></label>' +
        '</div>' +
        (s.error ? '<p class="hint" style="color:#ff8a8d">' + esc(s.error) + '</p>' : '') +
        '<p class="hint">Changing the look picks sensible defaults for transparency and layers. Changing resolution, frame rate, name or transparency restarts the NDI source.</p>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, {
        label: 'Apply', cls: 'primary', onClick: async () => {
          const [w, h] = val('oRes').split('x').map(Number);
          const look = val('oLook');
          const patch = { name: val('oName').trim() || o.name, width: w, height: h, fps: val('oFps'), fontScale: Number(val('oScale')), ndi: val('oNdi'), groups: val('oGroups').trim(), display: val('oDisp') || null, enabled: true };
          if (look !== o.look) patch.look = look;
          else Object.assign(patch, { alpha: val('oAlpha'), showProps: val('oProps'), showMessages: val('oMsg'), audio: val('oAudio') });
          patch.audioDevice = val('oDev') || '';
          await act('output/update', { index: i, patch });
        },
      }],
      onOpen: (body) => {
        fillAudioDevices(body.querySelector('#oDev'), o.audioDevice || '');
        body.querySelector('#oLook').addEventListener('change', (e) => {
          const d = { main: [0, 1, 1], lowerthird: [1, 0, 1], lyrics: [1, 0, 0], stage: [0, 0, 0], lobby: [0, 1, 0], clean: [0, 1, 0] }[e.target.value];
          body.querySelector('#oAlpha').checked = !!d[0]; body.querySelector('#oProps').checked = !!d[1]; body.querySelector('#oMsg').checked = !!d[2];
        });
      },
    });
  }

  function openSettings() {
    const s = st.settings;
    const remote = st.status.remote;
    openDialog({
      title: 'Settings',
      wide: true,
      body:
        '<div class="section-title">Look</div><div class="fields">' +
        '<label class="field"><span>Service default background</span><select id="stBg"><option value="">None (black)</option>' + mediaOptions(s.defaultBackground, { includeDefault: false }) + '</select></label>' +
        '<label class="field"><span>Font</span><input id="stFont" value="' + esc(s.theme.fontFamily) + '"><small>Any font installed on this computer.</small></label>' +
        '<label class="field"><span>Text colour</span><input id="stColor" type="color" value="' + esc(s.theme.textColor) + '"></label>' +
        '<label class="field"><span>Transition (ms)</span><input id="stTrans" type="number" min="0" max="3000" step="50" value="' + s.transitionMs + '"></label>' +
        '</div><div class="fields">' +
        '<label class="check"><input type="checkbox" id="stUpper"' + (s.theme.uppercase ? ' checked' : '') + '> Uppercase lyrics</label>' +
        '<label class="check"><input type="checkbox" id="stShadow"' + (s.theme.shadow !== false ? ' checked' : '') + '> Text shadow</label>' +
        '</div>' +
        '<div class="section-title">Props and lobby</div><div class="fields">' +
        '<label class="field"><span>Logo text</span><input id="stPropText" value="' + esc(s.prop.text || '') + '"></label>' +
        '<label class="field"><span>Logo image (overrides text)</span><select id="stPropImg">' + mediaOptions(s.prop.image || '', { includeDefault: false, includeNone: true, images: true }) + '</select></label>' +
        '<label class="field"><span>Lobby slide duration (s)</span><input id="stLobby" type="number" min="3" max="120" value="' + s.lobbyInterval + '"></label>' +
        '</div>' +
        '<div class="section-title">NDI</div><div class="fields">' +
        '<label class="field"><span>Source name prefix</span><input id="stPrefix" value="' + esc(s.ndiPrefix || 'LECTERN') + '"></label>' +
        '<label class="field"><span>NDI runtime location (optional)</span><input id="stNdiPath" value="' + esc(s.ndiRuntimePath || '') + '" placeholder="Found automatically"><small>' +
        esc(st.status.ndi ? (st.status.ndi.ok ? 'Using ' + st.status.ndi.path : 'Not found. Install NDI Tools or point this at the folder with the NDI library.') : '') + '</small></label>' +
        '</div>' +
        '<div class="section-title">Phone remote</div><div class="fields">' +
        '<label class="check"><input type="checkbox" id="stRemote"' + (s.remoteEnabled ? ' checked' : '') + '> Allow a phone or tablet on this network to control Lectern</label>' +
        '<label class="field"><span>Port</span><input id="stPort" type="number" min="1024" max="65535" value="' + s.remotePort + '"></label>' +
        '<label class="field"><span>PIN</span><input id="stPin" value="' + esc(s.remotePin) + '"></label>' +
        '</div>' +
        (remote ? '<p class="hint">' + (remote.error ? esc(remote.error) : 'Open ' + remote.urls.map(esc).join(' or ') + ' on a phone on the same network.') + '</p>' : '') +
        '<div class="section-title">Audio</div><div class="fields">' +
        '<label class="field"><span>Audio device for NDI inputs</span><select id="stDev"><option value="">System default</option></select><small>Choose Dante Via to send input audio to Dante. Each output has its own audio device in its ⚙ settings.</small></label>' +
        '</div>' +
        '<div class="section-title">Claude</div>' +
        '<div class="fields">' +
        '<label class="check"><input type="checkbox" id="stMcp"' + (st.claude.mcpEnabled ? ' checked' : '') + '> Let the Claude desktop app on this computer control Lectern</label>' +
        '<div class="field"><span>Claude desktop app setup</span><div class="row"><button class="btn small" id="stMcpCopy">Copy setup for Claude app</button></div>' +
        '<small>In the Claude desktop app, open Settings → Developer → Edit Config, paste this into claude_desktop_config.json (merge it with anything already there), save, and restart the Claude app. Lectern must be open.</small></div>' +
        '</div><div class="fields">' +
        '<label class="field"><span>Anthropic API key for the chat panel</span><input id="stKey" type="password" autocomplete="off" placeholder="' + (st.claude.hasKey ? 'Saved. Type a new key to replace it.' : 'sk-ant-…') + '">' +
        '<small>Stored encrypted on this computer. Usage is billed to your Anthropic account. Get a key at console.anthropic.com.</small></label>' +
        (st.claude.hasKey ? '<div class="field"><span>&nbsp;</span><div class="row"><button class="btn small ghost" id="stKeyDel">Remove saved key</button></div></div>' : '') +
        '</div>' +
        '<div class="section-title">CCLI usage</div>' +
        '<div class="row"><span class="hint">' + st.usageCount + ' song uses recorded.</span><button class="btn small" id="stExport">Export CSV…</button><button class="btn small ghost" id="stClear">Clear</button></div>',
      buttons: [{ label: 'Cancel', cls: 'ghost' }, {
        label: 'Save', cls: 'primary', onClick: async () => {
          if (val('stKey').trim()) await act('claude/setKey', { key: val('stKey').trim() });
          if (val('stMcp') !== st.claude.mcpEnabled) await act('claude/mcp', { enabled: val('stMcp') });
          return act('settings/update', {
          patch: {
            audioDevice: val('stDev') || '',
            defaultBackground: val('stBg') || null,
            theme: { fontFamily: val('stFont'), textColor: val('stColor'), uppercase: val('stUpper'), shadow: val('stShadow') },
            transitionMs: Number(val('stTrans')) || 0,
            prop: { text: val('stPropText'), image: val('stPropImg') || null },
            lobbyInterval: Number(val('stLobby')) || 8,
            ...(val('stPrefix').trim() !== (s.ndiPrefix || 'LECTERN') ? { ndiPrefix: val('stPrefix').trim().replace(/[()]/g, '') || 'LECTERN' } : {}),
            ...(val('stNdiPath').trim() !== (s.ndiRuntimePath || '') ? { ndiRuntimePath: val('stNdiPath').trim() } : {}),
            ...(val('stRemote') !== s.remoteEnabled || Number(val('stPort')) !== s.remotePort || val('stPin') !== s.remotePin
              ? { remoteEnabled: val('stRemote'), remotePort: Number(val('stPort')) || 8650, remotePin: val('stPin').trim() || s.remotePin } : {}),
          },
        });
        },
      }],
      onOpen: (body) => {
        fillAudioDevices(body.querySelector('#stDev'), s.audioDevice || '');
        body.querySelector('#stMcpCopy').addEventListener('click', async () => { if (await act('claude/copyConfig')) toast('Setup copied. Paste it into the Claude app’s config file.'); });
        const del = body.querySelector('#stKeyDel');
        if (del) del.addEventListener('click', async () => { await act('claude/setKey', { key: '' }); toast('API key removed'); del.disabled = true; });
        body.querySelector('#stExport').addEventListener('click', () => act('usage/export'));
        body.querySelector('#stClear').addEventListener('click', () => act('usage/clear'));
      },
    });
  }
  $('openSettings').addEventListener('click', openSettings);

  // Audio output devices (Dante Via shows up here like any other sound device).
  async function fillAudioDevices(select, current) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
      devs.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || 'Audio device ' + (i + 1);
        if (d.deviceId === current) o.selected = true;
        select.appendChild(o);
      });
      if (current && !devs.some((d) => d.deviceId === current)) {
        const o = document.createElement('option'); o.value = current; o.textContent = 'Saved device (not connected)'; o.selected = true; select.appendChild(o);
      }
    } catch { /* devices unavailable */ }
  }

  $('textLayoutBtn').addEventListener('click', () => window.LecternEditors && window.LecternEditors.textLayout(findItem(sel)));
  window.LecternControl = {
    get st() { return st; }, get sel() { return sel; },
    act, openDialog, closeDialog, toast, findItem, titleOf, slidesOf, val,
  };

  // ---------- top bar & tools ----------
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  document.querySelectorAll('.clr[data-clear]').forEach((b) => b.addEventListener('click', () => act('layer/toggle', { layer: b.dataset.clear })));
  $('clearAll').addEventListener('click', () => act('layer/clearAll'));
  $('restore').addEventListener('click', () => act('layer/restore'));
  $('next').addEventListener('click', () => act('live/next'));
  $('prev').addEventListener('click', () => act('live/prev'));
  $('svcName').addEventListener('change', (e) => act('service/rename', { name: e.target.value }));
  $('msgBtn').addEventListener('click', () => act('message/set', { text: $('msgText').value, show: !st.layers.msg }));
  $('msgText').addEventListener('keydown', (e) => { if (e.key === 'Enter') act('message/set', { text: $('msgText').value, show: true }); });
  $('msgText').addEventListener('change', () => act('message/set', { text: $('msgText').value }));
  $('stageBtn').addEventListener('click', () => act('stageMessage/set', { text: $('stageText').value, show: !st.layers.stage }));
  $('stageText').addEventListener('keydown', (e) => { if (e.key === 'Enter') act('stageMessage/set', { text: $('stageText').value, show: true }); });
  $('timerToggle').addEventListener('click', () => act(st.timer.running ? 'timer/stop' : 'timer/start'));
  $('timerMin').addEventListener('change', (e) => act('timer/duration', { minutes: Number(e.target.value) }));

  document.addEventListener('keydown', (e) => {
    if (!$('modal').hidden) { if (e.key === 'Escape') closeDialog(); return; }
    if (e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'ArrowDown') { e.preventDefault(); act('live/next'); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'ArrowUp') { e.preventDefault(); act('live/prev'); }
    else if (k === 'F1') { e.preventDefault(); act('layer/clearAll'); }
    else if (k === 'F2') { e.preventDefault(); act('layer/toggle', { layer: 'media' }); }
    else if (k === 'F3') { e.preventDefault(); act('layer/toggle', { layer: 'slide' }); }
    else if (k === 'F4') { e.preventDefault(); act('layer/toggle', { layer: 'props' }); }
    else if (k === 'F6') { e.preventDefault(); act('layer/toggle', { layer: 'msg' }); }
    else if (/^[1-9]$/.test(k) && sel) { const n = Number(k) - 1; if (n < slidesOf(findItem(sel)).length) act('live/go', { itemId: sel, slide: n }); }
  });

  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (st) {
      const t = R.timerRemaining(st.timer);
      $('timerVal').textContent = R.fmtDur(t);
      $('timerVal').classList.toggle('over', t < 0);
    }
  }, 250);

  // ---------- main render ----------
  function renderAll() {
    if (!st) return;
    if (sel && !findItem(sel)) sel = null;
    if (!sel && st.live.itemId) sel = st.live.itemId;
    if (!sel && items().length) sel = items()[0].id;
    if (document.activeElement !== $('svcName')) $('svcName').value = st.service.name;
    $('dirty').hidden = !st.dirty;
    document.title = 'Lectern — ' + st.service.name + (st.dirty ? ' •' : '');
    renderOrder();
    renderGrid();
    renderMonitors();
    renderOutputs();
    renderSongs();
    renderMedia();
    renderInputs();
    $('chatUndo').disabled = !(st.claude && st.claude.canUndo);
    $('chatUndo').title = st.claude && st.claude.canUndo ? 'Undo: ' + st.claude.canUndo : 'Nothing to undo';
    $('textLayoutBtn').disabled = !findItem(sel);
  }

  let lastLive = null;
  api.onState((s) => {
    st = s;
    // follow the live item when it moves to another item
    const liveId = s.live.itemId;
    if (liveId && liveId !== lastLive) sel = liveId;
    lastLive = liveId;
    renderAll();
  });

  buildOutputs();
  window.LecternInputHub.attach(window.lecternInput);
  api.action('state/get').then((s) => { st = s; lastLive = s.live.itemId; renderAll(); chatIntro(); });
})();

// Shared slide model. Loaded by the main process (CommonJS) and by every window (global LecternSlides).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LecternSlides = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GROUP_COLORS = [
    [/^verse/i, '#4f7cff'],
    [/^pre-?chorus/i, '#2bb3a3'],
    [/^chorus|^refrain/i, '#c457d6'],
    [/^bridge/i, '#e2763a'],
    [/^tag|^ending|^coda/i, '#d6a02c'],
    [/^intro|^outro|^instrumental|^interlude/i, '#7a8597'],
  ];
  function groupColor(name) {
    for (const [re, c] of GROUP_COLORS) if (re.test(name || '')) return c;
    return '#5f6b7d';
  }

  // Lyrics text format:
  //   [Verse 1]
  //   line one
  //   line two
  //   (blank line = new slide)
  //   [Chorus]
  //   ...
  function parseLyrics(text) {
    const sections = [];
    let cur = null;
    for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
      const m = raw.match(/^\s*\[(.+?)\]\s*$/);
      if (m) { cur = { name: m[1].trim(), lines: [] }; sections.push(cur); continue; }
      if (!cur) { cur = { name: 'Verse', lines: [] }; sections.push(cur); }
      cur.lines.push(raw.replace(/\s+$/, ''));
    }
    return sections
      .map((s) => ({ name: s.name, slides: s.lines.join('\n').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) }))
      .filter((s) => s.slides.length);
  }

  function parseArrangement(str) {
    if (Array.isArray(str)) return str;
    return String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  function songFooter(song) {
    return [song.title, song.author, song.copyright ? '© ' + song.copyright.replace(/^©\s*/, '') : '', song.ccli ? 'CCLI Song # ' + song.ccli : '']
      .filter(Boolean).join(' · ');
  }

  function songSlides(song, arrangementOverride) {
    if (!song) return [];
    const secs = parseLyrics(song.lyrics);
    const byName = new Map(secs.map((s) => [s.name.toLowerCase(), s]));
    let order = parseArrangement(arrangementOverride);
    if (!order.length) order = parseArrangement(song.arrangement);
    if (!order.length) order = secs.map((s) => s.name);
    const out = [];
    order.forEach((name) => {
      const s = byName.get(String(name).toLowerCase());
      if (!s) return;
      s.slides.forEach((t) => out.push({ kind: 'lyric', group: s.name, color: groupColor(s.name), text: t }));
    });
    if (out.length) {
      const foot = songFooter(song);
      if (foot) { out[0].footer = foot; out[out.length - 1].footer = foot; }
    }
    return out;
  }

  const escHtml = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function scriptureSlides(item) {
    const verses = item.verses || [];
    const max = item.maxChars || 240;
    const out = [];
    let chunk = [];
    let len = 0;
    const flush = () => {
      if (!chunk.length) return;
      const a = chunk[0], b = chunk[chunk.length - 1];
      const ref = a.book + ' ' + a.chapter + ':' + a.verse + (b.verse !== a.verse ? '-' + b.verse : '') + (item.translation ? ' ' + item.translation : '');
      const text = chunk.map((v) => (item.verseNumbers === false ? '' : '<sup>' + (v.verse | 0) + '</sup>') + escHtml(v.text)).join(' ');
      out.push({ kind: 'scripture', group: ref.replace(/\s\S+$/, ''), color: '#d6a02c', text, ref, html: true });
      chunk = []; len = 0;
    };
    verses.forEach((v) => {
      if (len && len + v.text.length > max) flush();
      chunk.push(v); len += v.text.length;
    });
    flush();
    return out;
  }

  function announceSlides(item) {
    return String(item.text || '').replace(/\r/g, '').split(/\n\s*---+\s*\n/).map((block, i) => {
      const lines = block.trim().split('\n');
      const title = (lines.shift() || '').trim();
      const body = lines.join('\n').trim();
      return { kind: 'announce', group: title.slice(0, 24) || 'Slide ' + (i + 1), color: '#2bb3a3', title, body };
    }).filter((s) => s.title || s.body);
  }

  function itemSlides(item, library) {
    if (!item) return [];
    switch (item.type) {
      case 'song': {
        const song = (library && library.songs || []).find((s) => s.id === item.songId);
        return songSlides(song, item.arrangement);
      }
      case 'scripture': return scriptureSlides(item);
      case 'announce': return announceSlides(item);
      case 'countdown':
        return [{ kind: 'countdown', group: 'Countdown', color: '#7a8597', title: item.label || 'Service begins in', target: item.target || '10:30' }];
      case 'media':
        return [{ kind: 'media', group: 'Media', color: '#8a6bd1', media: item.media }];
      case 'deck':
        // Pictures imported from a PowerPoint file, one image per slide.
        return (item.slides || []).map((m, i) => ({ kind: 'media', group: 'Slide ' + (i + 1), color: '#c2563a', media: m }));
      case 'input':
        return [{ kind: 'input', group: 'Input', color: '#1f9bd1', input: item.input }];
      case 'blank':
        return [{ kind: 'blank', group: 'Blank', color: '#3a3f47' }];
      default: return [];
    }
  }

  function stripTags(s) { return String(s || '').replace(/<sup>\d+<\/sup>/g, '').replace(/<[^>]+>/g, ''); }

  function plainText(slide) {
    if (!slide) return '';
    switch (slide.kind) {
      case 'lyric': return slide.text;
      case 'scripture': return stripTags(slide.text) + '\n' + slide.ref;
      case 'announce': return [slide.title, slide.body].filter(Boolean).join('\n');
      case 'countdown': return slide.title;
      case 'media': return '[' + (slide.media || 'media') + ']';
      case 'input': return '[NDI input]';
      default: return '';
    }
  }

  function itemTitle(item, library) {
    if (!item) return '';
    if (item.title) return item.title;
    if (item.type === 'song') {
      const song = (library && library.songs || []).find((s) => s.id === item.songId);
      return song ? song.title : 'Missing song';
    }
    if (item.type === 'scripture') return item.ref || 'Scripture';
    return { announce: 'Announcements', countdown: 'Countdown', media: item.media || 'Media', blank: 'Blank', deck: 'PowerPoint', input: 'NDI input' }[item.type] || 'Item';
  }

  // Background for one slide: the last background dropped on this slide or an earlier one,
  // then the item's own background, then the service default.
  function slideBackground(item, index, settings) {
    let bg = (settings && settings.defaultBackground) || null;
    if (!item) return bg;
    if (item.background) bg = item.background;
    const changes = item.bgChanges || {};
    let best = -1;
    for (const k of Object.keys(changes)) {
      const n = Number(k);
      if (n <= index && n > best && changes[k]) { best = n; bg = changes[k]; }
    }
    return bg;
  }

  // Text layout for an item: its own layout, else the service layout. A layout is either a
  // preset id (string) or an inline { boxes } object. null means the built-in look.
  function resolveLayout(ref, settings) {
    if (!ref) return null;
    if (typeof ref === 'object') return ref.boxes ? ref : null;
    const p = ((settings && settings.textPresets) || []).find((x) => x.id === ref);
    return p || null;
  }
  function itemLayout(item, service, settings) {
    return resolveLayout((item && item.textLayout) || (service && service.textLayout), settings);
  }

  // Starting point for the text box editor: matches the built-in look.
  function defaultLayout() {
    return {
      boxes: [
        { id: 'main', role: 'text', x: 7, y: 7, w: 86, h: 72, size: 6.2, align: 'center', valign: 'center', bold: true },
        { id: 'second', role: 'secondary', x: 7, y: 79, w: 86, h: 9, size: 3.6, align: 'center', valign: 'center', bold: false },
        { id: 'foot', role: 'footer', x: 5, y: 92, w: 90, h: 6, size: 2.2, align: 'center', valign: 'center', bold: false, opacity: 0.65 },
      ],
    };
  }

  // Everything an output window needs, derived from the full app state.
  function buildRenderState(state) {
    const items = state.service.items;
    const idx = items.findIndex((it) => it.id === state.live.itemId);
    const item = idx >= 0 ? items[idx] : null;
    const slides = itemSlides(item, state.library);
    const slide = slides[state.live.slide] || null;

    let next = null;
    if (!item) {
      for (let j = 0; j < items.length && !next; j++) next = itemSlides(items[j], state.library)[0] || null;
    } else {
      if (state.live.slide + 1 < slides.length) next = slides[state.live.slide + 1];
      else {
        for (let j = idx + 1; j < items.length && !next; j++) next = itemSlides(items[j], state.library)[0] || null;
      }
    }

    const background = slideBackground(item, state.live.slide, state.settings);
    const foreground = slide && slide.kind === 'media' ? slide.media : slide && slide.kind === 'input' ? 'input:' + slide.input : null;

    const lobby = [];
    items.forEach((it) => { if (it.type === 'announce' && it.lobby !== false) lobby.push(...announceSlides(it)); });

    return {
      itemTitle: itemTitle(item, state.library),
      itemType: item ? item.type : null,
      slide,
      slideIndex: state.live.slide,
      slideCount: slides.length,
      slideKey: item ? item.id + ':' + state.live.slide + ':' + (slide ? JSON.stringify(slide).length : 0) : 'none',
      next,
      background,
      foreground,
      layers: state.layers,
      message: state.message,
      stageMessage: state.stageMessage,
      timer: state.timer,
      prop: state.settings.prop,
      theme: state.settings.theme,
      lobby,
      lobbyInterval: state.settings.lobbyInterval || 8,
      transitionMs: state.settings.transitionMs,
      textLayout: itemLayout(item, state.service, state.settings),
      mediaOptions: state.service.mediaOptions || {},
    };
  }

  return { parseLyrics, parseArrangement, songSlides, scriptureSlides, announceSlides, itemSlides, itemTitle, plainText, stripTags, groupColor, buildRenderState, slideBackground, resolveLayout, itemLayout, defaultLayout };
});

// Claude control bridge. One set of Lectern tools shared by:
//   - the Claude desktop app, through the MCP connector (src/mcp/lectern-mcp.js), which calls
//     the local API below on 127.0.0.1 with a private token, and
//   - the chat panel inside Lectern (chat.js).
// Every change is described to the operator before it happens, anything that changes what is
// on screen always asks first, and every change can be undone.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIVE = 'live';
const CHANGE = 'change';
const READ = 'read';

const box = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['text', 'secondary', 'footer', 'custom', 'shape'], description: 'text = lyrics, verses or heading; secondary = scripture reference or text-slide body; footer = song credits; custom = fixed text; shape = a filled shape with no text' },
    shape: { type: 'string', enum: ['rect', 'rounded', 'ellipse'], description: 'Background shape of the box (for text boxes, only drawn when fill or border is set)' },
    fill: { type: 'string', description: 'Fill colour, e.g. #000000' }, fillOpacity: { type: 'number', description: '0 to 1' },
    borderWidth: { type: 'number', description: '% of frame height, 0 for none' }, borderColor: { type: 'string' },
    text: { type: 'string', description: 'Only for custom boxes' },
    x: { type: 'number', description: 'Left edge, % of frame width' },
    y: { type: 'number', description: 'Top edge, % of frame height' },
    w: { type: 'number', description: 'Width, % of frame width' },
    h: { type: 'number', description: 'Height, % of frame height' },
    size: { type: 'number', description: 'Text size, % of frame height (lyrics default 6.2)' },
    font: { type: 'string' }, color: { type: 'string', description: 'CSS colour, e.g. #ffffff' },
    align: { type: 'string', enum: ['left', 'center', 'right'] }, valign: { type: 'string', enum: ['top', 'center', 'bottom'] },
    bold: { type: 'boolean' }, italic: { type: 'boolean' }, upper: { type: 'boolean' },
  },
  required: ['role'],
};

const TOOLS = [
  { name: 'get_overview', kind: READ, description: 'Current service order (with item numbers), what is live, text style, text presets, media library, NDI inputs and outputs. Call this first.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_item', kind: READ, description: 'Slides of one service item with their text and backgrounds.', input_schema: { type: 'object', properties: { item: { type: 'string', description: 'Item number (1 = first), id or title' } }, required: ['item'] } },
  { name: 'set_text_style', kind: CHANGE, description: 'Service-wide text style: font, colour, uppercase, shadow.', input_schema: { type: 'object', properties: { font: { type: 'string', description: 'Font family installed on this computer' }, text_color: { type: 'string' }, uppercase: { type: 'boolean' }, shadow: { type: 'boolean' } } } },
  { name: 'set_text_size', kind: CHANGE, description: 'Text size multiplier for outputs (1 = normal, 0.5 to 1.8).', input_schema: { type: 'object', properties: { scale: { type: 'number' }, outputs: { type: 'array', items: { type: 'integer' }, description: 'Output numbers 1-6; omit for all' } }, required: ['scale'] } },
  { name: 'save_text_preset', kind: CHANGE, description: 'Create or update a named text preset (text box layout). Boxes not given keep their current values; a new preset starts from the built-in layout.', input_schema: { type: 'object', properties: { name: { type: 'string' }, boxes: { type: 'array', items: box } }, required: ['name'] } },
  { name: 'apply_text_preset', kind: CHANGE, description: 'Use a text preset for some items or the whole service. preset "built-in" returns to the standard look.', input_schema: { type: 'object', properties: { preset: { type: 'string' }, items: { description: '"all" for every item in the service, or a list of items', anyOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }] } }, required: ['preset', 'items'] } },
  { name: 'import_media', kind: CHANGE, description: 'Copy images or videos from this computer into the media library.', input_schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Full file paths' } }, required: ['paths'] } },
  { name: 'import_songs', kind: CHANGE, description: 'Import song lyric text files (SongSelect .txt) into the song library.', input_schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } },
  { name: 'import_powerpoint', kind: CHANGE, description: 'Import a PowerPoint file into the service, as editable text slides or as pictures of each slide.', input_schema: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string', enum: ['text', 'pictures'] } }, required: ['path', 'mode'] } },
  { name: 'set_background', kind: CHANGE, description: 'Set a background (media name, preset such as "preset:aurora", or "input:<id>"). With no item, sets the service default. With from_slide, it applies from that slide onward in the item. Use "none" to remove.', input_schema: { type: 'object', properties: { media: { type: 'string' }, item: { type: 'string' }, from_slide: { type: 'integer', description: 'Slide number, 1 = first' } }, required: ['media'] } },
  { name: 'add_to_service', kind: CHANGE, description: 'Add an item to the service order.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['song', 'scripture', 'text', 'media', 'countdown', 'blank', 'input'] }, song: { type: 'string', description: 'Song title (for type song)' }, reference: { type: 'string', description: 'Bible reference, e.g. John 3:16-18' }, title: { type: 'string' }, text: { type: 'string', description: 'For text: heading on the first line, a line with --- between slides' }, media: { type: 'string' }, input: { type: 'string', description: 'NDI input name or id' }, target_time: { type: 'string', description: 'HH:MM for countdown' }, after_item: { type: 'string' } }, required: ['type'] } },
  { name: 'create_song', kind: CHANGE, description: 'Add a song to the library. Lyrics use [Verse 1], [Chorus] section labels and a blank line between slides.', input_schema: { type: 'object', properties: { title: { type: 'string' }, lyrics: { type: 'string' }, author: { type: 'string' }, copyright: { type: 'string' }, ccli: { type: 'string' }, add_to_service: { type: 'boolean' } }, required: ['title', 'lyrics'] } },
  { name: 'remove_item', kind: CHANGE, description: 'Remove an item from the service order (songs stay in the library).', input_schema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] } },
  { name: 'move_item', kind: CHANGE, description: 'Move an item to a new position (1 = first).', input_schema: { type: 'object', properties: { item: { type: 'string' }, position: { type: 'integer' } }, required: ['item', 'position'] } },
  { name: 'set_video_speed', kind: CHANGE, description: 'Playback speed for a video (0.5 to 2, 1 = normal). audio_follows_video false keeps the sound at normal speed.', input_schema: { type: 'object', properties: { media: { type: 'string' }, speed: { type: 'number' }, audio_follows_video: { type: 'boolean' } }, required: ['media', 'speed'] } },
  { name: 'set_input_audio', kind: CHANGE, description: 'Turn an NDI input\'s audio on or off and set its volume (0 to 2, 1 = normal).', input_schema: { type: 'object', properties: { input: { type: 'string' }, on: { type: 'boolean' }, volume: { type: 'number' } }, required: ['input'] } },
  { name: 'rename_service', kind: CHANGE, description: 'Rename the service.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'go_live', kind: LIVE, description: 'Put a slide on screen.', input_schema: { type: 'object', properties: { item: { type: 'string' }, slide: { type: 'integer', description: '1 = first' } }, required: ['item'] } },
  { name: 'step_slide', kind: LIVE, description: 'Next or previous slide on screen.', input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['next', 'previous'] } }, required: ['direction'] } },
  { name: 'clear_screen', kind: LIVE, description: 'Clear a layer from the screen, everything, or restore.', input_schema: { type: 'object', properties: { layer: { type: 'string', enum: ['all', 'slide', 'media', 'props', 'message', 'restore'] } }, required: ['layer'] } },
  { name: 'show_message', kind: LIVE, description: 'Show or hide the audience message bar.', input_schema: { type: 'object', properties: { text: { type: 'string' }, show: { type: 'boolean' } }, required: ['show'] } },
];

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hasIds = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((x) => x && typeof x === 'object' && !Array.isArray(x) && x.id != null);

// Differences between two states. Objects are compared key by key and lists of records with
// an id (service items, songs, presets, inputs) record by record; other values as a whole.
function diff(a, b, path) {
  if (same(a, b)) return [];
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diff(a[k], b[k], path.concat(k)));
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && (hasIds(a) || hasIds(b)) && (a.length ? hasIds(a) : true) && (b.length ? hasIds(b) : true)) {
    const out = [];
    const bIds = new Set(b.map((x) => x.id)), aIds = new Set(a.map((x) => x.id));
    a.forEach((x, i) => { if (!bIds.has(x.id)) out.push({ path, op: 'removed', value: clone(x), index: i }); });
    b.forEach((x) => { if (!aIds.has(x.id)) out.push({ path, op: 'added', id: x.id }); });
    for (const x of a) { const y = b.find((z) => z.id === x.id); if (y) out.push(...diff(x, y, path.concat({ id: x.id }))); }
    const order = a.map((x) => x.id).filter((id) => bIds.has(id));
    if (!same(order, b.map((x) => x.id).filter((id) => aIds.has(id)))) out.push({ path, op: 'order', order });
    return out;
  }
  return [{ path, op: 'set', before: clone(a) }];
}

function walk(root, path) {
  let cur = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = typeof seg === 'object' ? (Array.isArray(cur) ? cur.find((x) => x && x.id === seg.id) : undefined) : cur[seg];
  }
  return cur;
}
function revert(root, c) {
  if (c.op === 'set') {
    const parent = walk(root, c.path.slice(0, -1));
    const key = c.path[c.path.length - 1];
    if (parent == null || typeof key === 'object') return;
    if (c.before === undefined) delete parent[key]; else parent[key] = clone(c.before);
    return;
  }
  const arr = walk(root, c.path);
  if (!Array.isArray(arr)) return;
  if (c.op === 'added') { const i = arr.findIndex((x) => x.id === c.id); if (i >= 0) arr.splice(i, 1); }
  else if (c.op === 'removed') { if (!arr.some((x) => x.id === c.value.id)) arr.splice(Math.min(c.index, arr.length), 0, clone(c.value)); }
  else if (c.op === 'order') {
    const rank = new Map(c.order.map((id, i) => [id, i]));
    const fixed = arr.filter((x) => rank.has(x.id)).sort((x, y) => rank.get(x.id) - rank.get(y.id));
    let k = 0;
    for (let i = 0; i < arr.length; i++) if (rank.has(arr[i].id)) arr[i] = fixed[k++];
  }
}

class Bridge {
  // ctx: { store, runtime, dispatch, slides, confirm(text, {live}) -> Promise<bool>, importers, onChange }
  constructor(ctx) {
    this.ctx = ctx;
    this.undoStack = [];
    this.server = null;
    this.port = null;
    this.skipChangeConfirm = false;
  }

  tools() { return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })); }

  // ---------- lookups ----------
  get d() { return this.ctx.store.data; }
  items() { return this.d.service.items; }
  title(it) { return this.ctx.slides.itemTitle(it, this.d.library); }
  findItem(ref) {
    if (ref == null || ref === '') throw new Error('Say which item.');
    const list = this.items();
    const s = String(ref).trim();
    if (/^\d+$/.test(s) && list[Number(s) - 1]) return list[Number(s) - 1];
    const byId = list.find((x) => x.id === s);
    if (byId) return byId;
    const low = s.toLowerCase();
    const exact = list.find((x) => this.title(x).toLowerCase() === low);
    if (exact) return exact;
    const part = list.filter((x) => this.title(x).toLowerCase().includes(low));
    if (part.length === 1) return part[0];
    throw new Error(part.length ? 'More than one item matches "' + s + '". Use its number.' : 'No item in the service matches "' + s + '".');
  }
  findMedia(name) {
    if (!name) throw new Error('Say which media.');
    if (/^(preset|input):/.test(name)) return name;
    const all = this.ctx.store.listMedia();
    const hit = all.find((m) => m === name) || all.find((m) => m.toLowerCase() === name.toLowerCase()) || all.filter((m) => m.toLowerCase().includes(name.toLowerCase()));
    if (typeof hit === 'string') return hit;
    if (Array.isArray(hit) && hit.length === 1) return hit[0];
    throw new Error(Array.isArray(hit) && hit.length ? 'More than one media file matches "' + name + '".' : 'No media file matches "' + name + '".');
  }
  findInput(ref) {
    const list = this.d.settings.inputs || [];
    const s = String(ref || '').toLowerCase();
    const hit = list.find((x) => x.id === ref) || list.find((x) => x.name.toLowerCase() === s) || list.find((x) => (x.name + ' ' + x.source).toLowerCase().includes(s));
    if (!hit) throw new Error('No NDI input matches "' + ref + '".');
    return hit;
  }
  findPreset(ref) {
    const list = this.d.settings.textPresets || [];
    const s = String(ref || '').toLowerCase();
    return list.find((p) => p.id === ref) || list.find((p) => p.name.toLowerCase() === s) || null;
  }

  // ---------- what will happen, in plain words ----------
  describe(name, a) {
    try {
      switch (name) {
        case 'set_text_style': return 'Change the text style: ' + Object.entries({ font: a.font, colour: a.text_color, uppercase: a.uppercase, shadow: a.shadow }).filter(([, v]) => v !== undefined).map(([k, v]) => k + ' ' + v).join(', ') + '.';
        case 'set_text_size': return 'Set text size to ' + Math.round((a.scale || 1) * 100) + '% on ' + (a.outputs && a.outputs.length ? 'output ' + a.outputs.join(', ') : 'all outputs') + '.';
        case 'save_text_preset': return 'Save the text preset "' + a.name + '"' + (a.boxes ? ' with ' + a.boxes.length + ' box change(s)' : '') + '.';
        case 'apply_text_preset': return 'Use the text preset "' + a.preset + '" for ' + (a.items === 'all' ? 'every item in the service' : (a.items || []).map((x) => '"' + this.title(this.findItem(x)) + '"').join(', ')) + '.';
        case 'import_media': return 'Import ' + a.paths.length + ' media file(s): ' + a.paths.map((p) => path.basename(p)).join(', ') + '.';
        case 'import_songs': return 'Import ' + a.paths.length + ' song file(s).';
        case 'import_powerpoint': return 'Import "' + path.basename(a.path) + '" as ' + (a.mode === 'pictures' ? 'pictures' : 'text slides') + ' and add it to the service.';
        case 'set_background': return 'Set background "' + a.media + '"' + (a.item ? ' for "' + this.title(this.findItem(a.item)) + '"' + (a.from_slide ? ' from slide ' + a.from_slide + ' onward' : '') : ' as the service default') + '.';
        case 'add_to_service': return 'Add ' + (a.song || a.reference || a.title || a.media || a.input || a.type) + ' to the service.';
        case 'create_song': return 'Add the song "' + a.title + '" to the library' + (a.add_to_service ? ' and the service' : '') + '.';
        case 'remove_item': return 'Remove "' + this.title(this.findItem(a.item)) + '" from the service.';
        case 'move_item': return 'Move "' + this.title(this.findItem(a.item)) + '" to position ' + a.position + '.';
        case 'set_video_speed': return 'Play "' + a.media + '" at ' + a.speed + '×' + (a.audio_follows_video === false ? ', sound at normal speed' : '') + '.';
        case 'set_input_audio': return 'Input "' + a.input + '" audio ' + (a.on === false ? 'off' : 'on') + (a.volume != null ? ' at ' + Math.round(a.volume * 100) + '%' : '') + '.';
        case 'rename_service': return 'Rename the service to "' + a.name + '".';
        case 'go_live': return 'Put "' + this.title(this.findItem(a.item)) + '" slide ' + (a.slide || 1) + ' on screen.';
        case 'step_slide': return 'Go to the ' + a.direction + ' slide on screen.';
        case 'clear_screen': return a.layer === 'restore' ? 'Restore media, slide and props on screen.' : 'Clear ' + (a.layer === 'all' ? 'everything' : 'the ' + a.layer) + ' from the screen.';
        case 'show_message': return (a.show ? 'Show the audience message' + (a.text ? ' "' + a.text + '"' : '') : 'Hide the audience message') + '.';
        default: return name;
      }
    } catch (e) { return name + ' (' + e.message + ')'; }
  }

  // ---------- undo ----------
  // Undo reverses only what Claude's change touched: it records the difference between the
  // state before and after the change, and puts back just those values, so later edits the
  // operator made elsewhere are kept.
  state() { const d = this.d; return clone({ service: d.service, library: d.library, settings: d.settings, outputs: d.outputs }); }
  record(label, before) {
    const changes = diff(before, this.state(), []);
    if (!changes.length) return;
    this.undoStack.push({ label, at: Date.now(), changes });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }
  async undo() {
    const s = this.undoStack.pop();
    if (!s) throw new Error('There is no Claude change to undo.');
    const root = this.d;
    for (const c of s.changes.slice().reverse()) revert(root, c);
    await this.ctx.onRestore();
    return s.label;
  }
  canUndo() { return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null; }

  // ---------- run a tool ----------
  async call(name, input, source) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error('Unknown tool ' + name);
    const a = input || {};
    if (tool.kind !== READ) {
      const text = this.describe(name, a);
      const ask = tool.kind === LIVE || !this.skipChangeConfirm;
      if (ask) {
        const r = await this.ctx.confirm(text, { live: tool.kind === LIVE, source });
        if (!r.ok) return { declined: true, message: 'The operator declined: ' + text };
        if (r.skipChanges) this.skipChangeConfirm = true;
      }
      const before = this.state();
      try {
        const result = await this.run(name, a);
        return { done: text, result };
      } finally {
        // Record even a partly finished change (e.g. some files imported) so it can be undone.
        this.record(text, before);
        this.ctx.onApplied(text);
      }
    }
    return this.run(name, a);
  }

  async run(name, a) {
    const { dispatch } = this.ctx;
    const d = this.d;
    switch (name) {
      case 'get_overview': {
        const S = this.ctx.slides;
        const live = this.ctx.runtime.live;
        return {
          service: d.service.name,
          items: this.items().map((it, i) => ({
            number: i + 1, id: it.id, title: this.title(it), type: it.type, slides: S.itemSlides(it, d.library).length,
            background: it.background || null, background_changes: it.bgChanges || undefined,
            text_preset: typeof it.textLayout === 'string' ? (this.findPreset(it.textLayout) || {}).name : it.textLayout ? 'custom' : undefined,
          })),
          live: live.itemId ? { item: this.items().findIndex((x) => x.id === live.itemId) + 1, slide: live.slide + 1 } : null,
          layers: this.ctx.runtime.layers,
          text_style: d.settings.theme,
          service_text_preset: typeof d.service.textLayout === 'string' ? (this.findPreset(d.service.textLayout) || {}).name : null,
          text_presets: (d.settings.textPresets || []).map((p) => p.name),
          default_background: d.settings.defaultBackground,
          media: this.ctx.store.listMedia(),
          background_presets: ['preset:aurora', 'preset:ember', 'preset:forest', 'preset:slate', 'preset:black'],
          video_speeds: d.service.mediaOptions || {},
          songs_in_library: d.library.songs.map((s) => s.title),
          inputs: (d.settings.inputs || []).map((x) => ({ id: x.id, name: x.name, source: x.source, audio: !!x.audio, volume: x.volume == null ? 1 : x.volume })),
          outputs: d.outputs.map((o) => ({ number: o.id, name: o.name, look: o.look, enabled: o.enabled, text_size: o.fontScale || 1 })),
        };
      }
      case 'get_item': {
        const it = this.findItem(a.item);
        const S = this.ctx.slides;
        return { title: this.title(it), type: it.type, slides: S.itemSlides(it, d.library).map((s, i) => ({ number: i + 1, group: s.group, text: S.plainText(s), background: S.slideBackground(it, i, d.settings) })) };
      }
      case 'set_text_style': {
        const theme = {};
        if (a.font != null) theme.fontFamily = String(a.font);
        if (a.text_color != null) theme.textColor = String(a.text_color);
        if (a.uppercase != null) theme.uppercase = !!a.uppercase;
        if (a.shadow != null) theme.shadow = !!a.shadow;
        await dispatch('settings/update', { patch: { theme } });
        return 'ok';
      }
      case 'set_text_size': {
        const scale = Math.max(0.5, Math.min(1.8, Number(a.scale) || 1));
        const list = a.outputs && a.outputs.length ? a.outputs.map((n) => n - 1) : [0, 1, 2, 3, 4, 5];
        for (const i of list) if (d.outputs[i]) await dispatch('output/update', { index: i, patch: { fontScale: scale } });
        return 'ok';
      }
      case 'save_text_preset': {
        const existing = this.findPreset(a.name);
        const base = existing ? JSON.parse(JSON.stringify(existing)) : { ...this.ctx.slides.defaultLayout(), name: a.name };
        for (const b of a.boxes || []) {
          const target = base.boxes.find((x) => x.role === b.role && b.role !== 'custom' && b.role !== 'shape');
          if (target) Object.assign(target, b);
          else if (b.role === 'shape') base.boxes.unshift({ id: crypto.randomBytes(4).toString('hex'), shape: 'rect', fill: '#000000', fillOpacity: 0.5, x: 5, y: 62, w: 90, h: 28, ...b });
          else base.boxes.push({ id: crypto.randomBytes(4).toString('hex'), x: 10, y: 10, w: 80, h: 15, size: 5, align: 'center', valign: 'center', ...b });
        }
        const id = await dispatch('preset/save', { id: existing && existing.id, name: a.name, layout: { boxes: base.boxes } });
        return { preset: a.name, id };
      }
      case 'apply_text_preset': {
        let layout = null;
        if (String(a.preset).toLowerCase() !== 'built-in') {
          const p = this.findPreset(a.preset);
          if (!p) throw new Error('No text preset named "' + a.preset + '".');
          layout = p.id;
        }
        if (a.items === 'all') await dispatch('layout/apply', { layout, scope: 'all' });
        else for (const ref of a.items || []) await dispatch('layout/apply', { layout, scope: 'item', itemId: this.findItem(ref).id });
        return 'ok';
      }
      case 'import_media': return { imported: await this.ctx.importers.media(a.paths || []) };
      case 'import_songs': return { imported: await this.ctx.importers.songs(a.paths || []) };
      case 'import_powerpoint': return await this.ctx.importers.powerpoint(a.path, a.mode === 'pictures' ? 'pictures' : 'text');
      case 'set_background': {
        const media = a.media === 'none' ? null : this.findMedia(a.media);
        if (!a.item) { await dispatch('settings/update', { patch: { defaultBackground: media } }); return 'ok'; }
        const it = this.findItem(a.item);
        if (a.from_slide) await dispatch('item/bgChange', { id: it.id, slide: Math.max(0, a.from_slide - 1), media });
        else await dispatch('item/update', { id: it.id, patch: { background: media } });
        return 'ok';
      }
      case 'add_to_service': {
        const after = a.after_item ? this.findItem(a.after_item).id : undefined;
        let item;
        switch (a.type) {
          case 'song': {
            const s = String(a.song || '').toLowerCase();
            const song = d.library.songs.find((x) => x.title.toLowerCase() === s) || d.library.songs.find((x) => x.title.toLowerCase().includes(s));
            if (!song) throw new Error('No song in the library matches "' + a.song + '".');
            item = { type: 'song', songId: song.id };
            break;
          }
          case 'scripture': { const r = await dispatch('bible/lookup', { ref: a.reference }); item = { type: 'scripture', ref: r.ref, translation: r.translation, verses: r.verses }; break; }
          case 'text': item = { type: 'announce', title: a.title || undefined, text: a.text || a.title || '', lobby: false }; break;
          case 'media': item = { type: 'media', media: this.findMedia(a.media) }; break;
          case 'countdown': item = { type: 'countdown', label: a.title || 'Service begins in', target: a.target_time || '10:30' }; break;
          case 'input': item = { type: 'input', input: this.findInput(a.input).id }; break;
          default: item = { type: 'blank' };
        }
        return { id: await dispatch('item/add', { item, after }) };
      }
      case 'create_song': {
        const id = await dispatch('song/save', { song: { title: a.title, lyrics: a.lyrics, author: a.author || '', copyright: a.copyright || '', ccli: a.ccli || '', arrangement: '' } });
        if (a.add_to_service) await dispatch('item/add', { item: { type: 'song', songId: id } });
        return { id };
      }
      case 'remove_item': await dispatch('item/remove', { id: this.findItem(a.item).id }); return 'ok';
      case 'move_item': await dispatch('item/move', { id: this.findItem(a.item).id, to: Math.max(0, Math.min(this.items().length - 1, (a.position | 0) - 1)) }); return 'ok';
      case 'set_video_speed': await dispatch('media/options', { name: this.findMedia(a.media), speed: a.speed, audioFollow: a.audio_follows_video !== false }); return 'ok';
      case 'set_input_audio': {
        const inp = this.findInput(a.input);
        const patch = {};
        if (a.on != null) patch.audio = !!a.on; else patch.audio = true;
        if (a.volume != null) patch.volume = Math.max(0, Math.min(2, Number(a.volume)));
        await dispatch('input/update', { id: inp.id, patch });
        return 'ok';
      }
      case 'rename_service': await dispatch('service/rename', { name: a.name }); return 'ok';
      case 'go_live': await dispatch('live/go', { itemId: this.findItem(a.item).id, slide: Math.max(0, (a.slide || 1) - 1) }); return 'ok';
      case 'step_slide': await dispatch(a.direction === 'previous' ? 'live/prev' : 'live/next'); return 'ok';
      case 'clear_screen': {
        const map = { all: ['layer/clearAll'], restore: ['layer/restore'], slide: ['layer/toggle', { layer: 'slide', value: false }], media: ['layer/toggle', { layer: 'media', value: false }], props: ['layer/toggle', { layer: 'props', value: false }], message: ['layer/toggle', { layer: 'msg', value: false }] };
        const [t, p] = map[a.layer] || map.all;
        await dispatch(t, p);
        return 'ok';
      }
      case 'show_message': await dispatch('message/set', { text: a.text != null ? a.text : this.ctx.runtime.message, show: !!a.show }); return 'ok';
      default: throw new Error('Unknown tool ' + name);
    }
  }

  // ---------- local API for the Claude app connector ----------
  // Listens on 127.0.0.1 only. The port and a random token are written to bridge.json in the
  // data folder; the connector reads that file, so only programs on this computer that can read
  // the user's files can use it.
  start(configFile, token) {
    this.stop();
    this.configFile = configFile;
    this.token = token;
    const server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }));
    server.listen(0, '127.0.0.1', () => {
      this.port = server.address().port;
      fs.writeFileSync(configFile, JSON.stringify({ port: this.port, token }, null, 1), { mode: 0o600 });
    });
    this.server = server;
  }
  stop() {
    if (this.server) this.server.close();
    this.server = null;
    try { if (this.configFile) fs.unlinkSync(this.configFile); } catch { /* not there */ }
  }
  async handle(req, res) {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer ' + this.token) return send(401, { error: 'Not allowed' });
    if (req.headers.origin) return send(403, { error: 'Not allowed from a browser' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/tools') return send(200, { tools: this.tools() });
    if (req.method === 'POST' && url.pathname === '/call') {
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 1e6) return send(413, { error: 'Too large' }); chunks.push(c); }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      try { return send(200, { result: await this.call(body.name, body.input, 'Claude app') }); } catch (e) { return send(200, { error: String(e.message || e) }); }
    }
    return send(404, { error: 'Not found' });
  }
}

module.exports = { Bridge, TOOLS, diff, revert };

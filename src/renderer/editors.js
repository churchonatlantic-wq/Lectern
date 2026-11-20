/* Text box editor: move and resize the text boxes on slides, set text size, font, colour and
   alignment for each box, then use the layout for one item or the whole service, or save it
   as a named text preset. */
(function () {
  const C = window.LecternControl;
  const S = window.LecternSlides;
  const R = window.LecternRender;
  const esc = R.esc;
  const ROLE_LABEL = { text: 'Main text', secondary: 'Reference / body', footer: 'Song credits', custom: 'Fixed text' };
  const FONTS = ['Segoe UI', 'Arial', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Calibri', 'Cambria', 'Garamond', 'Futura', 'Avenir Next', 'Gill Sans', 'Montserrat', 'Open Sans', 'Lato', 'Roboto'];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uid = () => Math.random().toString(16).slice(2, 10);

  function textLayout(item) {
    const st = C.st;
    if (!item) { C.toast('Select an item first.', true); return; }
    const presets = st.settings.textPresets || [];
    const current = S.itemLayout(item, st.service, st.settings);
    let work = clone(current ? { boxes: current.boxes } : S.defaultLayout());
    let loadedPreset = current && current.id ? current.id : null;
    let selId = work.boxes[0] && work.boxes[0].id;
    const slides = C.slidesOf(item);
    const textSlides = slides.map((s, i) => [s, i]).filter(([s]) => ['lyric', 'scripture', 'announce'].includes(s.kind));
    let slideIdx = textSlides.length ? textSlides[0][1] : -1;
    const sample = (i) => slides[i] || { kind: 'lyric', group: 'Sample', text: 'Amazing grace, how sweet the sound\nThat saved a wretch like me', footer: 'Amazing Grace · John Newton · Public Domain' };

    C.openDialog({
      title: 'Text boxes · ' + C.titleOf(item),
      wide: true,
      body:
        '<div class="tl-wrap">' +
        '<div class="tl-main"><div class="tl-stage"><div class="frame"><div id="tlSurf"></div></div><div class="tl-boxes" id="tlBoxes"></div></div>' +
        '<div class="row" style="margin-top:8px"><span class="hint">Preview slide</span><select id="tlSlide" class="sel" style="max-width:none">' +
        (textSlides.length ? textSlides.map(([s, i]) => '<option value="' + i + '">' + (i + 1) + ' · ' + esc(s.group) + '</option>').join('') : '<option value="-1">Sample lyrics (this item has no text slides)</option>') +
        '</select><span class="hint">Drag a box to move it, drag a corner to resize it.</span></div></div>' +
        '<div class="tl-side">' +
        '<label class="field"><span>Start from</span><select id="tlPreset"><option value="">' + (current && !current.id ? 'This item’s current layout' : 'Built-in layout') + '</option>' +
        presets.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === loadedPreset ? ' selected' : '') + '>Preset: ' + esc(p.name) + '</option>').join('') + '</select></label>' +
        '<div class="field"><span>Boxes</span><div class="tl-list" id="tlList"></div><div class="row"><button class="btn small ghost" id="tlAdd">+ Fixed text box</button><button class="btn small ghost" id="tlDel">Delete box</button></div></div>' +
        '<div class="tl-props" id="tlProps"></div>' +
        '<div class="field"><span>Save as a text preset</span><div class="row"><input id="tlName" placeholder="Preset name" value="' + esc(loadedPreset ? (presets.find((p) => p.id === loadedPreset) || {}).name || '' : '') + '"><button class="btn small" id="tlSave">Save</button></div>' +
        '<div class="row"><button class="btn small ghost danger" id="tlDelPreset"' + (loadedPreset ? '' : ' hidden') + '>Delete this preset</button></div></div>' +
        '</div></div>',
      buttons: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Built-in look for this item', cls: 'ghost', onClick: () => C.act('layout/apply', { scope: 'item', itemId: item.id, layout: null }).then(() => C.toast('“' + C.titleOf(item) + '” uses the built-in look')) },
        { label: 'Use for every item in the service', cls: 'ghost', onClick: () => apply('all') },
        { label: 'Use for this item', cls: 'primary', onClick: () => apply('item') },
      ],
      onOpen: (body) => {
        const surf = new R.Surface(body.querySelector('#tlSurf'), { preview: true, transitions: false });
        const stage = body.querySelector('.tl-stage');
        const boxesEl = body.querySelector('#tlBoxes');

        const render = () => {
          const rs = S.buildRenderState(C.st);
          const sl = sample(slideIdx);
          surf.update({
            ...rs, slide: sl, slideKey: 'tl' + slideIdx, foreground: null, textLayout: work,
            background: S.slideBackground(item, Math.max(0, slideIdx), C.st.settings), layers: { slide: true, media: true, props: false, msg: false, stage: false },
          }, { look: 'main', fontScale: 1, showProps: false, showMessages: false });
          boxesEl.innerHTML = work.boxes.map((b) => '<div class="tl-box' + (b.id === selId ? ' is-sel' : '') + '" data-b="' + esc(b.id) + '" style="left:' + b.x + '%;top:' + b.y + '%;width:' + b.w + '%;height:' + b.h + '%">' +
            '<span class="tl-tag">' + esc(ROLE_LABEL[b.role] || b.role) + ' · ' + (+b.size).toFixed(1) + '</span>' +
            (b.id === selId ? ['nw', 'ne', 'sw', 'se'].map((h) => '<span class="tl-h" data-h="' + h + '"></span>').join('') : '') + '</div>').join('');
          body.querySelector('#tlList').innerHTML = work.boxes.map((b) => '<button class="btn small' + (b.id === selId ? ' on' : '') + '" data-pick="' + esc(b.id) + '">' + esc(ROLE_LABEL[b.role] || b.role) + '</button>').join('');
          body.querySelector('#tlDel').disabled = !selId;
        };

        const props = () => {
          const b = work.boxes.find((x) => x.id === selId);
          const el = body.querySelector('#tlProps');
          if (!b) { el.innerHTML = '<span class="hint">Pick a box to change it.</span>'; return; }
          el.innerHTML =
            '<label class="field"><span>Shows</span><select data-k="role">' + Object.entries(ROLE_LABEL).map(([k, l]) => '<option value="' + k + '"' + (k === b.role ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
            (b.role === 'custom' ? '<label class="field"><span>Text</span><textarea data-k="text" rows="2">' + esc(b.text || '') + '</textarea></label>' : '') +
            '<label class="field"><span>Text size <b data-sz>' + (+b.size).toFixed(1) + '</b> (% of screen height)</span><input type="range" min="1" max="20" step="0.1" data-k="size" value="' + b.size + '"></label>' +
            '<label class="field"><span>Font</span><input data-k="font" list="tlFonts" value="' + esc(b.font || '') + '" placeholder="Service font"><datalist id="tlFonts">' + FONTS.map((f) => '<option value="' + f + '">').join('') + '</datalist></label>' +
            '<div class="two"><label class="field"><span>Colour</span><input type="color" data-k="color" value="' + esc(b.color || C.st.settings.theme.textColor || '#ffffff') + '"></label>' +
            '<label class="check" style="align-self:end"><input type="checkbox" data-k="themeColor"' + (b.color ? '' : ' checked') + '> Service colour</label></div>' +
            '<div class="two"><label class="field"><span>Align</span><select data-k="align">' + ['left', 'center', 'right'].map((a) => '<option' + ((b.align || 'center') === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label>' +
            '<label class="field"><span>Vertical</span><select data-k="valign">' + ['top', 'center', 'bottom'].map((a) => '<option' + ((b.valign || 'center') === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label></div>' +
            '<div class="row"><label class="check"><input type="checkbox" data-k="bold"' + (b.bold !== false ? ' checked' : '') + '> Bold</label>' +
            '<label class="check"><input type="checkbox" data-k="italic"' + (b.italic ? ' checked' : '') + '> Italic</label>' +
            '<label class="check"><input type="checkbox" data-k="upper"' + (b.upper ? ' checked' : '') + '> Uppercase</label></div>' +
            '<div class="two">' + ['x', 'y', 'w', 'h'].map((k) => '<label class="field"><span>' + { x: 'Left %', y: 'Top %', w: 'Width %', h: 'Height %' }[k] + '</span><input type="number" step="0.5" min="0" max="100" data-k="' + k + '" value="' + (+b[k]).toFixed(1) + '"></label>').join('') + '</div>';
        };

        body.querySelector('#tlProps').addEventListener('input', (e) => {
          const k = e.target.dataset.k;
          const b = work.boxes.find((x) => x.id === selId);
          if (!k || !b) return;
          if (k === 'themeColor') { if (e.target.checked) delete b.color; else b.color = body.querySelector('[data-k="color"]').value; }
          else if (k === 'color') { b.color = e.target.value; body.querySelector('[data-k="themeColor"]').checked = false; }
          else if (['bold', 'italic', 'upper'].includes(k)) b[k] = e.target.checked;
          else if (['size', 'x', 'y', 'w', 'h'].includes(k)) { b[k] = Math.max(0, Math.min(k === 'size' ? 20 : 100, Number(e.target.value) || 0)); if (k === 'size') body.querySelector('[data-sz]').textContent = b.size.toFixed(1); }
          else if (k === 'font') { if (e.target.value.trim()) b.font = e.target.value.trim(); else delete b.font; }
          else b[k] = e.target.value;
          render();
          if (k === 'role') props();
        });

        body.addEventListener('click', (e) => {
          const pick = e.target.closest('[data-pick]');
          if (pick) { selId = pick.dataset.pick; render(); props(); }
        });
        body.querySelector('#tlAdd').addEventListener('click', () => {
          const b = { id: uid(), role: 'custom', text: 'Your text', x: 30, y: 40, w: 40, h: 14, size: 5, align: 'center', valign: 'center', bold: true };
          work.boxes.push(b); selId = b.id; render(); props();
        });
        body.querySelector('#tlDel').addEventListener('click', () => {
          work.boxes = work.boxes.filter((x) => x.id !== selId); selId = work.boxes[0] && work.boxes[0].id; render(); props();
        });
        body.querySelector('#tlSlide').addEventListener('change', (e) => { slideIdx = Number(e.target.value); render(); });
        body.querySelector('#tlPreset').addEventListener('change', (e) => {
          const p = (C.st.settings.textPresets || []).find((x) => x.id === e.target.value);
          loadedPreset = p ? p.id : null;
          work = clone(p ? { boxes: p.boxes } : current && !current.id ? { boxes: current.boxes } : S.defaultLayout());
          selId = work.boxes[0] && work.boxes[0].id;
          body.querySelector('#tlName').value = p ? p.name : '';
          body.querySelector('#tlDelPreset').hidden = !p;
          render(); props();
        });
        body.querySelector('#tlSave').addEventListener('click', async () => {
          const name = body.querySelector('#tlName').value.trim();
          if (!name) { C.toast('Type a name for the preset.', true); body.querySelector('#tlName').focus(); return; }
          const existing = (C.st.settings.textPresets || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
          const id = await C.act('preset/save', { id: existing ? existing.id : undefined, name, layout: work });
          if (id) {
            loadedPreset = id;
            const sel = body.querySelector('#tlPreset');
            if (!existing) { const o = document.createElement('option'); o.value = id; o.textContent = 'Preset: ' + name; sel.appendChild(o); }
            sel.value = id;
            body.querySelector('#tlDelPreset').hidden = false;
            C.toast('Saved text preset “' + name + '”');
          }
        });
        body.querySelector('#tlDelPreset').addEventListener('click', async () => {
          if (!loadedPreset) return;
          const p = (C.st.settings.textPresets || []).find((x) => x.id === loadedPreset);
          await C.act('preset/delete', { id: loadedPreset });
          const o = body.querySelector('#tlPreset option[value="' + CSS.escape(loadedPreset) + '"]');
          if (o) o.remove();
          loadedPreset = null;
          body.querySelector('#tlPreset').value = '';
          body.querySelector('#tlDelPreset').hidden = true;
          C.toast('Deleted text preset “' + (p ? p.name : '') + '”');
        });

        // Drag to move, drag a corner to resize (in % of the frame).
        boxesEl.addEventListener('pointerdown', (e) => {
          const el = e.target.closest('.tl-box');
          if (!el) return;
          e.preventDefault();
          selId = el.dataset.b;
          const b = work.boxes.find((x) => x.id === selId);
          const handle = e.target.dataset.h || null;
          const rect = stage.querySelector('.frame').getBoundingClientRect();
          const sx = e.clientX, sy = e.clientY, start = { ...b };
          render(); props();
          const move = (ev) => {
            const dx = (ev.clientX - sx) / rect.width * 100, dy = (ev.clientY - sy) / rect.height * 100;
            const r1 = (v) => Math.round(v * 2) / 2;
            if (!handle) { b.x = r1(Math.max(0, Math.min(100 - b.w, start.x + dx))); b.y = r1(Math.max(0, Math.min(100 - b.h, start.y + dy))); }
            else {
              if (handle.includes('e')) b.w = r1(Math.max(4, Math.min(100 - start.x, start.w + dx)));
              if (handle.includes('s')) b.h = r1(Math.max(3, Math.min(100 - start.y, start.h + dy)));
              if (handle.includes('w')) { const nx = Math.max(0, Math.min(start.x + start.w - 4, start.x + dx)); b.w = r1(start.w + start.x - nx); b.x = r1(nx); }
              if (handle.includes('n')) { const ny = Math.max(0, Math.min(start.y + start.h - 3, start.y + dy)); b.h = r1(start.h + start.y - ny); b.y = r1(ny); }
            }
            render();
          };
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); props(); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });

        render(); props();
        return () => surf.destroy();
      },
    });

    async function apply(scope) {
      // Applying an unchanged preset links to it, so later edits to the preset carry through.
      const p = loadedPreset && (C.st.settings.textPresets || []).find((x) => x.id === loadedPreset);
      const layout = p && JSON.stringify(p.boxes) === JSON.stringify(work.boxes) ? p.id : { boxes: work.boxes };
      await C.act('layout/apply', scope === 'all' ? { scope: 'all', layout } : { scope: 'item', itemId: item.id, layout });
      C.toast(scope === 'all' ? 'Text layout used for every item in the service' : 'Text layout used for “' + C.titleOf(item) + '”');
    }
  }

  window.LecternEditors = { textLayout };
})();

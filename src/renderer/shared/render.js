// Draws one output "look" into a 16:9 surface. Used by output windows (NDI + displays)
// and by the previews in the control window, so what you see is what is sent.
(function () {
  const S = window.LecternSlides;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
  const isVideo = (n) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(n || '');
  const mediaUrl = (n) => 'lectern://media/' + encodeURIComponent(n);

  function mediaHTML(name, { muted = true, still = false } = {}) {
    if (!name) return '';
    if (name.startsWith('input:')) return '<canvas class="in-canvas" data-input="' + esc(name.slice(6)) + '" width="16" height="9"></canvas>';
    if (name.startsWith('preset:')) return '<div class="bg-preset bg-' + esc(name.slice(7)) + (still ? ' still' : '') + '"></div>';
    if (isVideo(name)) {
      if (still) return '<video src="' + mediaUrl(name) + '#t=1" muted preload="metadata"></video>';
      return '<video src="' + mediaUrl(name) + '" data-name="' + esc(name) + '" autoplay loop playsinline' + (muted ? ' muted' : '') + '></video>';
    }
    return '<img src="' + mediaUrl(name) + '" alt="">';
  }

  function fmtDur(ms) {
    const neg = ms < 0;
    ms = Math.abs(ms);
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (neg ? '+' : '') + (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0');
  }
  function untilTime(target) {
    const [h, m] = String(target || '0:0').split(':').map(Number);
    const d = new Date();
    d.setHours(h || 0, m || 0, 0, 0);
    return Math.max(0, d.getTime() - Date.now());
  }
  function timerRemaining(t) {
    if (!t) return 0;
    return t.durationMs - (t.accumulatedMs + (t.running ? Date.now() - t.startedAt : 0));
  }
  const clockText = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  // Text boxes from a text layout (see LecternSlides.defaultLayout). Sizes are % of the frame
  // and text size is in % of frame height, so previews and outputs match.
  function boxContent(slide, role, box) {
    switch (role) {
      case 'text':
        if (slide.kind === 'lyric') return nl2br(slide.text);
        if (slide.kind === 'scripture') return '<span class="s-scr-in">' + slide.text + '</span>';
        if (slide.kind === 'announce') return esc(slide.title);
        return '';
      case 'secondary':
        if (slide.kind === 'scripture') return esc(slide.ref);
        if (slide.kind === 'announce') return nl2br(slide.body || '');
        return '';
      case 'footer': return esc(slide.footer || '');
      case 'custom': return nl2br(box.text || '');
      default: return '';
    }
  }
  // Hex colour plus opacity (0-1) as rgba().
  function rgba(hex, op) {
    const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
    if (!m) return esc(hex || 'transparent').replace(/;/g, '');
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, op == null ? 1 : +op)) + ')';
  }
  // Fill, border and corner shape of a box (text boxes can have one too).
  function shapeStyle(b) {
    let st = '';
    if (b.fill) st += 'background:' + rgba(b.fill, b.fillOpacity) + ';';
    if (b.borderWidth > 0) st += 'border:' + (+b.borderWidth) + 'cqh solid ' + rgba(b.borderColor || '#ffffff', 1) + ';';
    if (b.shape === 'ellipse') st += 'border-radius:50%;';
    else if (b.shape === 'rounded') st += 'border-radius:' + (b.radius != null ? +b.radius : 2) + 'cqh;';
    if (b.fill || b.borderWidth > 0) st += 'padding:' + (b.pad != null ? +b.pad : 1.2) + 'cqh ' + (b.pad != null ? +b.pad * 1.5 : 1.8) + 'cqh;';
    return st;
  }
  function layoutHTML(slide, layout) {
    return (layout.boxes || []).map((b) => {
      const pos = 'left:' + (+b.x || 0) + '%;top:' + (+b.y || 0) + '%;width:' + (+b.w || 10) + '%;height:' + (+b.h || 10) + '%;';
      if (b.role === 'shape') return '<div class="tb-shape" style="' + pos + shapeStyle({ fill: '#ffffff', ...b, pad: 0 }) + (b.opacity != null ? 'opacity:' + (+b.opacity) + ';' : '') + '"></div>';
      const html = boxContent(slide, b.role, b);
      if (!html) return '';
      const st = pos + shapeStyle(b) +
        '--bs:' + (+b.size || 5) + ';text-align:' + (b.align || 'center') + ';justify-content:' + ({ top: 'flex-start', bottom: 'flex-end' }[b.valign] || 'safe center') + ';' +
        (b.font ? 'font-family:' + esc(b.font).replace(/;/g, '') + ';' : '') + (b.color ? 'color:' + esc(b.color).replace(/;/g, '') + ';' : '') +
        'font-weight:' + (b.bold === false ? 500 : 700) + ';' + (b.italic ? 'font-style:italic;' : '') + (b.opacity != null ? 'opacity:' + (+b.opacity) + ';' : '') +
        (b.upper ? 'text-transform:uppercase;' : '');
      return '<div class="tb tb-' + esc(b.role) + '" data-fit style="' + st + '"><div>' + html + '</div></div>';
    }).join('');
  }

  function slideHTML(slide, mode, layout) {
    if (!slide) return '';
    if (layout && (mode === 'full' || mode === 'key') && (slide.kind === 'lyric' || slide.kind === 'scripture' || slide.kind === 'announce')) {
      return '<div class="tbs">' + layoutHTML(slide, layout) + '</div>';
    }
    const footer = mode === 'full' && slide.footer ? '<div class="s-footer">' + esc(slide.footer) + '</div>' : '';
    switch (slide.kind) {
      case 'lyric':
        if (mode === 'band') return '<div class="band" data-fit><div class="s-text">' + nl2br(slide.text) + '</div></div>';
        return '<div class="s-box" data-fit><div class="s-text">' + nl2br(slide.text) + '</div></div>' + footer;
      case 'scripture':
        if (mode === 'band') return '<div class="band" data-fit><div class="s-text s-scr">' + slide.text + '</div><div class="s-ref">' + esc(slide.ref) + '</div></div>';
        return '<div class="s-box" data-fit><div class="s-text s-scr">' + slide.text + '</div><div class="s-ref">' + esc(slide.ref) + '</div></div>';
      case 'announce':
        if (mode === 'band') return '<div class="band" data-fit><div class="s-text">' + esc(slide.title) + '</div>' + (slide.body ? '<div class="s-ref">' + nl2br(slide.body) + '</div>' : '') + '</div>';
        return '<div class="s-box" data-fit><div class="s-title">' + esc(slide.title) + '</div>' + (slide.body ? '<div class="s-body">' + nl2br(slide.body) + '</div>' : '') + '</div>';
      case 'countdown':
        if (mode === 'band') return '';
        return '<div class="s-box"><div class="s-body">' + esc(slide.title) + '</div><div class="s-count" data-countdown="' + esc(slide.target) + '">' + fmtDur(untilTime(slide.target)) + '</div></div>';
      default: return '';
    }
  }

  function propHTML(prop) {
    if (!prop) return '';
    if (prop.image) return '<img class="prop-img" src="' + mediaUrl(prop.image) + '" alt="">';
    if (prop.text) return '<div class="prop-text">' + esc(prop.text) + '</div>';
    return '';
  }

  function stageHTML(rs) {
    const cur = rs.layers.slide ? S.plainText(rs.slide) : '';
    const nxt = S.plainText(rs.next);
    const t = timerRemaining(rs.timer);
    return '<div class="stage">' +
      '<div class="st-top"><span data-clock>' + clockText() + '</span><span class="st-item">' + esc(rs.itemTitle) + (rs.slideCount ? ' · ' + (rs.slideIndex + 1) + '/' + rs.slideCount : '') + '</span>' +
      '<span data-timer class="' + (t < 0 ? 'over' : '') + '">' + fmtDur(t) + '</span></div>' +
      '<div class="st-cur" data-fit><div>' + nl2br(cur) + '</div></div>' +
      '<div class="st-next"><b>Next</b><div>' + (nxt ? nl2br(nxt) : 'End of service') + '</div></div>' +
      (rs.layers.stage && rs.stageMessage ? '<div class="st-msg">' + esc(rs.stageMessage) + '</div>' : '') +
      '</div>';
  }

  class Surface {
    constructor(root, opts = {}) {
      this.root = root;
      this.transitions = opts.transitions !== false;
      this.preview = !!opts.preview;
      root.classList.add('surface');
      root.innerHTML = ['media', 'fg', 'slide', 'props', 'msg', 'stage'].map((n) => '<div class="L L-' + n + '"></div>').join('');
      this.el = {};
      ['media', 'fg', 'slide', 'props', 'msg', 'stage'].forEach((n) => { this.el[n] = root.querySelector('.L-' + n); });
      this.keys = {};
      this.rs = null;
      this.cfg = null;
      this.lobbyKey = null;
      this.timerId = setInterval(() => this.tick(), this.preview ? 1000 : 250);
    }

    destroy() { clearInterval(this.timerId); }

    setLayer(name, key, html, transition) {
      if (this.keys[name] === key) return;
      this.keys[name] = key;
      const host = this.el[name];
      const ms = this.transitions && transition && this.rs ? (this.rs.transitionMs || 0) : 0;
      if (ms > 0) {
        host.style.setProperty('--tms', ms + 'ms');
        const div = document.createElement('div');
        div.className = 'pane enter';
        div.innerHTML = html;
        Array.from(host.children).forEach((old) => {
          old.classList.add('leave');
          setTimeout(() => old.remove(), ms + 50);
        });
        host.appendChild(div);
        this.fit(div);
        void div.offsetWidth;
        div.classList.remove('enter');
      } else {
        host.innerHTML = '<div class="pane">' + html + '</div>';
        this.fit(host.firstElementChild);
      }
    }

    fit(pane) {
      if (!pane) return;
      pane.querySelectorAll('[data-fit]').forEach((box) => {
        let f = 1;
        box.style.setProperty('--fit', '1');
        for (let i = 0; i < 24 && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1); i++) {
          f *= 0.92;
          box.style.setProperty('--fit', f.toFixed(3));
        }
      });
    }

    update(rs, cfg) {
      this.rs = rs;
      this.cfg = cfg;
      const look = cfg.look || 'main';
      const r = this.root;
      r.className = 'surface look-' + look + (cfg.alpha ? ' alpha' : '') + (this.preview ? ' preview' : '');
      const th = rs.theme || {};
      r.style.setProperty('--font', th.fontFamily || 'sans-serif');
      r.style.setProperty('--color', th.textColor || '#fff');
      r.style.setProperty('--fs', String(cfg.fontScale || 1));
      r.classList.toggle('upper', !!th.uppercase);
      r.classList.toggle('shadow', th.shadow !== false);

      const L = rs.layers;
      const showMedia = look === 'main' || look === 'clean' || look === 'lobby';
      const bg = look === 'lobby' ? (rs.background || null) : (showMedia && L.media ? rs.background : null);
      const muted = !(cfg.audio && !this.preview);
      this.setLayer('media', 'm:' + bg + ':' + muted, mediaHTML(bg, { muted, still: this.preview }), true);

      const fg = (look === 'main' || look === 'clean') && L.slide ? rs.foreground : null;
      this.setLayer('fg', 'f:' + fg + ':' + muted, mediaHTML(fg, { muted, still: this.preview }), true);

      if (look === 'lobby') {
        this.lobbyKey = null;
        this.tickLobby();
      } else {
        let html = '';
        if (L.slide && rs.slide && look !== 'stage' && look !== 'clean') {
          html = slideHTML(rs.slide, look === 'lowerthird' ? 'band' : look === 'lyrics' ? 'key' : 'full', rs.textLayout);
        }
        this.setLayer('slide', look + ':' + (cfg.fontScale || 1) + ':' + (L.slide ? rs.slideKey : 'off') + ':' + JSON.stringify(th) + ':' + JSON.stringify(rs.textLayout || null), html, true);
      }

      const props = cfg.showProps && L.props ? propHTML(rs.prop) : '';
      this.setLayer('props', 'p:' + props, props, true);

      const msg = cfg.showMessages && L.msg && rs.message ? '<div class="msg-bar">' + esc(rs.message) + '</div>' : '';
      this.setLayer('msg', 'g:' + msg, msg, true);

      const stage = look === 'stage' ? stageHTML(rs) : '';
      this.setLayer('stage', 's:' + stage.replace(/data-clock>[^<]*/, '').replace(/data-timer[^>]*>[^<]*/, ''), stage, false);
      this.applyMedia();
      if (window.LecternInputHub) window.LecternInputHub.refresh();
    }

    // Playback speed and audio device for the videos on this surface. Applied in place so a
    // speed change takes effect without restarting the video.
    applyMedia() {
      const opts = (this.rs && this.rs.mediaOptions) || {};
      const sink = (this.cfg && this.cfg.audioDevice) || '';
      this.root.querySelectorAll('video[data-name]').forEach((v) => {
        const o = opts[v.dataset.name] || {};
        const speed = Math.max(0.25, Math.min(4, Number(o.speed) || 1));
        if (v.playbackRate !== speed) v.playbackRate = speed;
        const wantsAudio = !v.hasAttribute('muted') && !this.preview;
        // "Audio stays at 100%": the video plays muted at its speed and a companion
        // audio element plays the same file at normal speed.
        const split = wantsAudio && speed !== 1 && o.audioFollow === false;
        v.muted = !wantsAudio || split;
        let comp = v.nextElementSibling && v.nextElementSibling.matches('audio[data-companion]') ? v.nextElementSibling : null;
        if (split && !comp) {
          comp = document.createElement('audio');
          comp.dataset.companion = '1';
          comp.src = v.src; comp.loop = true; comp.autoplay = true;
          comp.currentTime = v.currentTime / speed;
          v.after(comp);
        } else if (!split && comp) { comp.pause(); comp.remove(); comp = null; }
        for (const el of [v, comp]) {
          if (el && el.setSinkId && (el.sinkId || '') !== sink && wantsAudio) el.setSinkId(sink).catch(() => {});
        }
      });
    }

    tickLobby() {
      const rs = this.rs;
      if (!rs || !this.cfg || this.cfg.look !== 'lobby') return;
      const list = rs.lobby || [];
      const n = list.length;
      const idx = n ? Math.floor(Date.now() / (Math.max(3, rs.lobbyInterval) * 1000)) % n : -1;
      const key = 'lobby:' + idx + ':' + n + ':' + JSON.stringify(rs.theme) + (n ? JSON.stringify(list[idx]) : '');
      if (key === this.lobbyKey) return;
      this.lobbyKey = key;
      this.setLayer('slide', key, n ? slideHTML(list[idx], 'full', rs.textLayout) : '', true);
    }

    tick() {
      const r = this.root;
      r.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = fmtDur(untilTime(el.dataset.countdown)); });
      r.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = clockText(); });
      if (this.rs) {
        const t = timerRemaining(this.rs.timer);
        r.querySelectorAll('[data-timer]').forEach((el) => { el.textContent = fmtDur(t); el.classList.toggle('over', t < 0); });
      }
      this.tickLobby();
    }
  }

    // NDI input frames arrive through the window's preload and are drawn onto every canvas
  // showing that input. Output windows get full frames; the control window gets previews.
  const InputHub = {
    bridge: null,
    wanted: '',
    attach(bridge) {
      this.bridge = bridge;
      bridge.onFrame((f) => this.draw(f));
      this.refresh();
    },
    refresh() {
      if (!this.bridge) return;
      const ids = Array.from(new Set(Array.from(document.querySelectorAll('canvas[data-input]')).map((c) => c.dataset.input))).sort();
      const key = ids.join(',');
      if (key !== this.wanted) { this.wanted = key; this.bridge.want(ids); }
    },
    draw(f) {
      const list = document.querySelectorAll('canvas[data-input="' + CSS.escape(String(f.id)) + '"]');
      if (!list.length) return;
      const data = f.data instanceof Uint8ClampedArray ? f.data : new Uint8ClampedArray(f.data.buffer || f.data, f.data.byteOffset || 0, f.w * f.h * 4);
      const img = new ImageData(data, f.w, f.h);
      list.forEach((c) => {
        if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h; }
        c.getContext('2d').putImageData(img, 0, 0);
      });
    },
  };
  window.LecternInputHub = InputHub;

  window.LecternRender = { Surface, esc, nl2br, fmtDur, untilTime, timerRemaining, mediaHTML, mediaUrl, isVideo, layoutHTML, slideHTML };
})();

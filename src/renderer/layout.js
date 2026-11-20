/* Panel layout for the control window: drag the dividers to resize columns and the outputs
   strip, drag a panel's bottom edge to resize it, click a panel's title to minimize it.
   The layout is remembered on this computer; View > Reset Panel Layout restores it. */
(function () {
  const KEY = 'lectern.layout.v1';
  const DEFAULTS = { lw: 290, rw: 360, oh: 110, left: false, right: false, panels: { order: { h: 300 }, chat: { collapsed: true }, inputs: { h: 220 } } };
  let L;
  try { L = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { L = { ...DEFAULTS }; }
  L.panels = { ...DEFAULTS.panels, ...(L.panels || {}) };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* storage unavailable */ } };
  const main = document.getElementById('main');
  const root = document.documentElement;

  function apply() {
    root.style.setProperty('--lw', L.lw + 'px');
    root.style.setProperty('--rw', L.rw + 'px');
    root.style.setProperty('--oh', L.oh + 'px');
    main.classList.toggle('left-off', !!L.left);
    main.classList.toggle('right-off', !!L.right);
    document.querySelector('[data-coll="left"]').textContent = L.left ? '›' : '‹';
    document.querySelector('[data-coll="right"]').textContent = L.right ? '‹' : '›';
    document.querySelectorAll('.panel[data-panel]').forEach((p) => {
      const st = L.panels[p.dataset.panel] || {};
      p.classList.toggle('collapsed', !!st.collapsed);
      const btn = p.querySelector(':scope > .ph .pcoll');
      if (btn) btn.setAttribute('aria-expanded', String(!st.collapsed));
      if (p.dataset.resize === 'y' && st.h) { p.classList.add('sized'); p.style.setProperty('--ph', st.h + 'px'); } else { p.classList.remove('sized'); p.style.removeProperty('--ph'); }
    });
    window.dispatchEvent(new Event('lectern-layout'));
  }

  // Minimize / expand panels
  document.querySelectorAll('.panel[data-panel] > .ph .pcoll').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.panel').dataset.panel;
      const st = L.panels[id] = L.panels[id] || {};
      st.collapsed = !st.collapsed;
      save(); apply();
    });
  });

  function drag(e, onMove, el) {
    e.preventDefault();
    el.classList.add('drag');
    document.body.style.userSelect = 'none';
    const move = (ev) => onMove(ev);
    const up = () => {
      el.classList.remove('drag');
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Column dividers
  document.querySelectorAll('.splitter.v').forEach((sp) => {
    const side = sp.dataset.split;
    sp.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.scoll')) return;
      if (L[side]) { L[side] = false; apply(); }
      const startX = e.clientX, start = side === 'left' ? L.lw : L.rw;
      drag(e, (ev) => {
        const dx = ev.clientX - startX;
        const w = side === 'left' ? start + dx : start - dx;
        const max = Math.max(260, window.innerWidth - 480);
        if (w < 140) { L[side] = true; } else { L[side] = false; L[side === 'left' ? 'lw' : 'rw'] = Math.min(max, Math.round(w)); }
        apply();
      }, sp);
    });
    sp.addEventListener('dblclick', (e) => { if (e.target.closest('.scoll')) return; L[side] = !L[side]; save(); apply(); });
  });
  document.querySelectorAll('.scoll').forEach((b) => b.addEventListener('click', () => { const side = b.dataset.coll; L[side] = !L[side]; save(); apply(); }));

  // Outputs strip height
  const hs = document.querySelector('.splitter.h');
  hs.addEventListener('pointerdown', (e) => {
    const outs = L.panels.outputs || {};
    if (outs.collapsed) { outs.collapsed = false; L.panels.outputs = outs; apply(); }
    const startY = e.clientY, start = L.oh;
    drag(e, (ev) => { L.oh = Math.max(40, Math.min(420, Math.round(start - (ev.clientY - startY)))); apply(); }, hs);
  });

  // Panel bottom edges
  document.querySelectorAll('.panel[data-resize="y"] > .grip').forEach((g) => {
    const p = g.closest('.panel');
    g.addEventListener('pointerdown', (e) => {
      const id = p.dataset.panel;
      const st = L.panels[id] = L.panels[id] || {};
      const startY = e.clientY, start = p.getBoundingClientRect().height;
      drag(e, (ev) => { st.h = Math.max(70, Math.min(window.innerHeight - 160, Math.round(start + ev.clientY - startY))); apply(); }, g);
    });
  });

  window.LecternLayout = {
    reset() { L = JSON.parse(JSON.stringify(DEFAULTS)); save(); apply(); },
    expand(id) { const st = L.panels[id] = L.panels[id] || {}; if (st.collapsed) { st.collapsed = false; save(); apply(); } },
    isCollapsed(id) { return !!(L.panels[id] || {}).collapsed; },
  };
  apply();
})();

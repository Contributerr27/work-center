/* amem panel: amem's live Activity view (what your AI tools save and recall) in a side panel,
   on the left or right of the window. The sidebar button only shows when amem is installed.
   Server side: src/features/amem.js. Uses page globals: h, $, post, toast, shellPanel, PANEL_MODE. */
(() => {
  const ic = (name, fallback) => (window.icon ? window.icon(name) : fallback);
  const SIDE_KEY = 'amemPanelSide';
  const side = () => { try { return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right'; } catch { return 'right'; } };
  const setSide = (s) => { try { localStorage.setItem(SIDE_KEY, s); } catch { /* private mode */ } };
  const info = () => fetch('/api/amem').then((r) => r.json()).catch(() => ({ installed: false }));

  async function ensureRunning(a) {
    if (a.running) return a;
    const r = await post('/api/amem/start').catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) { toast(`amem: ${r.error || 'could not start'}`); return null; }
    return info();
  }

  /* ---------- The panel itself (Electron side window, or a floating box in the browser) ---------- */
  function frame(a, { floating } = {}) {
    const el = $('amem-panel') || document.body.appendChild(h('div', { id: 'amem-panel' }));
    const close = () => (floating ? (el.hidden = true) : post('/api/ui/panel', { name: 'amem', open: false }));
    const sideBtn = (s, label) => h('button', {
      class: `am-side ${side() === s ? 'on' : ''}`, title: `Show the panel on the ${s}`, 'aria-pressed': side() === s ? 'true' : 'false',
      onclick: async () => { setSide(s); if (floating) { el.dataset.side = s; frame(a, { floating }); return; } await post('/api/ui/panel', { name: 'amem', open: true, side: s }); frame(a); },
    }, label);
    const body = !a?.installed ? h('div', { class: 'am-empty' }, 'amem is not installed. Install it with npm i -g @iamem/amem, then reopen this panel.')
      : !a.running ? h('div', { class: 'am-empty' }, 'Starting amem…')
        : !a.activity ? h('div', { class: 'am-empty' }, `This amem (${a.version || 'unknown version'}) has no Activity view yet. Update amem to see it here.`)
          : h('iframe', { class: 'am-frame', src: a.url, title: 'amem activity' });
    el.dataset.side = side();
    el.hidden = false;
    el.replaceChildren(h('div', { class: 'am' },
      h('div', { class: 'am-head' },
        h('span', { class: 'am-logo' }, ic('memory', '◎')),
        h('b', {}, 'amem'), h('span', { class: 'muted small' }, a?.version ? `v${a.version}` : ''),
        h('span', { class: 'spacer' }),
        h('div', { class: 'am-sides', role: 'group', 'aria-label': 'Panel side' }, sideBtn('left', 'Left'), sideBtn('right', 'Right')),
        h('button', { class: 'ibtn', title: 'Close', 'aria-label': 'Close', onclick: close }, '×')),
      body));
  }

  async function openFloating() {
    const el = $('amem-panel');
    if (el && !el.hidden) { el.hidden = true; return; }
    let a = await info();
    frame(a, { floating: true });
    if (a.installed && !a.running) { a = await ensureRunning(a); if (a) frame(a, { floating: true }); }
  }

  if (PANEL_MODE === 'amem') {
    (async () => {
      let a = await info();
      frame(a);
      if (a.installed && !a.running) { a = await ensureRunning(a); if (a) frame(a); }
    })();
    return;
  }

  /* ---------- Sidebar button: only when amem is installed ---------- */
  info().then((a) => {
    if (!a.installed || PANEL_MODE) return;
    const btn = h('button', { id: 'btn-amem', class: 'nv', title: 'amem: watch what your AI tools remember' },
      h('span', { class: 'nv-i', 'data-i': 'memory' }, ic('memory', '◎')), h('span', { class: 'nv-l' }, 'amem'));
    btn.onclick = async () => {
      const cur = await info();
      if (cur.installed && !cur.running) post('/api/amem/start').catch(() => {}); // the panel shows "Starting…" meanwhile
      if (await shellPanel('amem', { toggle: true, side: side() })) return;
      openFloating();
    };
    const after = $('btn-music') || $('btn-phone');
    if (after) after.after(btn); else $('nav-bottom')?.prepend(btn);
  });
})();

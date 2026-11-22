/* Music: a side panel with what's playing on Spotify and the playlists you played last, one click to play.
   Server: src/features/music.js. In the app it opens as a panel window (?panel=music) on the left edge;
   in a browser it floats over the page. Uses page globals: h, $, post, toast, shellPanel, PANEL_MODE, HQ. */
(() => {
  let M = null; // last /api/music
  let open = PANEL_MODE === 'music';
  let busy = null; // uri being started
  let timer = null;
  let showMine = false;
  let typed = '';
  let devs = null; // device list while the picker is open
  let query = '';
  let found = null; // search results
  let searchT = null;
  let moving = null; // device id (or 'here') being switched to

  const box = () => $('music') || document.body.appendChild(h('div', { id: 'music', hidden: true }));
  const ago = (iso) => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 2880 ? 'yesterday' : `${Math.round(m / 1440)} days ago`;
  };
  const cover = (src, cls) => (src ? h('img', { class: cls, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: `${cls} mu-blank` }, window.icon ? window.icon('music') : '♪'));
  const ic = (name, fallback) => (window.icon ? window.icon(name) : fallback);
  const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d; return s; };
  const PLAY = '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>';
  const PAUSE = '<path d="M8 5.5h3v13H8zM13 5.5h3v13h-3z" fill="currentColor" stroke="none"/>';
  const PREV = '<path d="M6.5 6v12M18 6.5v11l-8.5-5.5z" fill="currentColor"/>';
  const NEXT = '<path d="M17.5 6v12M6 6.5v11l8.5-5.5z" fill="currentColor"/>';

  async function load(force) {
    try { M = await (await fetch(`/api/music${force ? '?force=1' : ''}`)).json(); } catch (e) { M = { error: e.message }; }
    draw();
  }
  async function tick() {
    if (!open || document.hidden || !M?.connected && !M?.app) return;
    try { const { now } = await (await fetch('/api/music/now')).json(); if (JSON.stringify(now) !== JSON.stringify(M.now)) { M.now = now; draw(); } } catch (e) { /* offline */ }
  }

  async function play(item) {
    busy = item.uri; draw();
    try {
      const r = await post('/api/music/play', { uri: item.uri });
      if (r.via === 'link') {
        await post('/api/open', { href: r.url }).catch(() => {});
        toast(r.reason === 'premium' ? 'Opened in Spotify: starting playback from Work Center needs Premium'
          : r.reason === 'no-device' ? 'No Spotify device is open, so it opened in Spotify. Next time it plays right here.'
          : 'Opened in Spotify');
      } else toast(`Playing ${item.name}${r.device ? ` on ${r.device}` : ''}`);
      setTimeout(tick, 1200);
    } catch (e) { toast(e.message); }
    busy = null; draw();
  }
  async function control(action) {
    if (M?.now && action === 'toggle') { M.now.playing = !M.now.playing; draw(); }
    try { await post('/api/music/control', { action }); } catch (e) { toast(e.message); }
    setTimeout(tick, 700);
  }
  async function connect() {
    try { const r = await post('/api/music/connect', { clientId: typed || M?.clientId }); await post('/api/open', { href: r.url }); toast('Finish signing in to Spotify in your browser'); waitForLogin(); } catch (e) { toast(e.message); }
  }
  function waitForLogin() {
    let n = 0;
    const t = setInterval(async () => { n++; await load(); if (M?.connected || n > 60) clearInterval(t); }, 3000);
  }

  async function pickDevice() {
    if (devs) { devs = null; return draw(); }
    devs = [];
    draw();
    try { devs = (await (await fetch('/api/music/devices')).json()).devices || []; } catch (e) { devs = null; toast(e.message); }
    draw();
  }
  async function moveTo(id) {
    moving = id; draw();
    try { await post('/api/music/device', { id }); devs = null; toast('Switched'); } catch (e) { toast(e.message); }
    moving = null; setTimeout(tick, 800); draw();
  }
  async function playHere() {
    moving = 'here'; draw();
    try {
      const r = await post('/api/music/here');
      if (r.ok) { devs = null; toast(`Playing on ${r.device}`); }
      else {
        await post('/api/open', { href: r.open });
        toast('Opening the Spotify web player in your browser. Once it loads, music moves to this Mac.');
        // The web player shows up as a device a few seconds after it loads.
        for (let i = 0; i < 30; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const d = ((await (await fetch('/api/music/devices')).json()).devices || []).find((x) => x.here);
          if (d) { await post('/api/music/device', { id: d.id }); devs = null; toast('Playing on this Mac (web player). If it stays silent, press play once in that tab.'); break; }
        }
      }
    } catch (e) { toast(e.message); }
    moving = null; setTimeout(tick, 800); draw();
  }
  const TYPE_IC = { Computer: '💻', Smartphone: '📱', Speaker: '🔊', TV: '📺', Tablet: '📱', CastAudio: '🔊', CastVideo: '📺', AVR: '🔊', Automobile: '🚗' };
  function devicePicker() {
    if (!devs) return null;
    const hereDev = devs.find((d) => d.here);
    const rows = devs.filter((d) => !d.here).map((d) => h('button', { class: `mu-dev ${d.active ? 'on' : ''}`, disabled: d.restricted || moving === d.id, onclick: () => moveTo(d.id) },
      h('span', { class: 'mu-dev-i', 'aria-hidden': 'true' }, TYPE_IC[d.type] || '🎵'), h('span', { class: 'mu-dev-n' }, d.name), d.active ? h('small', {}, 'playing') : moving === d.id ? h('span', { class: 'mu-spin dark' }) : null));
    return h('div', { class: 'mu-devs', role: 'list' },
      h('button', { class: `mu-dev here ${hereDev?.active ? 'on' : ''}`, disabled: moving === 'here', onclick: playHere },
        h('span', { class: 'mu-dev-i', 'aria-hidden': 'true' }, '💻'),
        h('span', { class: 'mu-dev-n' }, h('b', {}, 'This Mac'), h('small', {}, hereDev ? hereDev.name : M.app ? 'Spotify app' : 'Spotify web player in your browser')),
        hereDev?.active ? h('small', {}, 'playing') : moving === 'here' ? h('span', { class: 'mu-spin dark' }) : null),
      devs.length || moving ? rows : h('div', { class: 'muted small mu-dev-empty' }, 'Looking for devices…'));
  }

  function nowCard() {
    const n = M.now;
    return h('div', { class: `mu-now ${n?.playing ? 'on' : ''}` },
      cover(n?.image, 'mu-art'),
      h('div', { class: 'mu-nt' },
        h('b', {}, n?.name || 'Nothing playing'),
        h('small', {}, n ? n.artist : 'Pick a playlist below'),
        n?.playing && h('span', { class: 'mu-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      h('div', { class: 'mu-ctl' },
        h('button', { class: 'mu-cb', title: 'Previous', 'aria-label': 'Previous track', disabled: !n, onclick: () => control('prev') }, svg(PREV)),
        h('button', { class: 'mu-cb mu-pp', title: n?.playing ? 'Pause' : 'Play', 'aria-label': n?.playing ? 'Pause' : 'Play', disabled: !n, onclick: () => control('toggle') }, svg(n?.playing ? PAUSE : PLAY)),
        h('button', { class: 'mu-cb', title: 'Next', 'aria-label': 'Next track', disabled: !n, onclick: () => control('next') }, svg(NEXT))),
      h('button', { class: `mu-where ${devs ? 'open' : ''}`, 'aria-expanded': String(!!devs), title: 'Choose where Spotify plays', onclick: pickDevice },
        h('span', { 'aria-hidden': 'true' }, '🔈'), h('span', { class: 'mu-where-n' }, n?.device ? `Playing on ${n.device}` : 'Choose a device'), h('span', { class: 'mu-caret', 'aria-hidden': 'true' }, devs ? '▴' : '▾')),
      devicePicker());
  }
  function row(it) {
    const on = M.now?.context === it.uri;
    return h('div', { class: `mu-row ${on ? 'on' : ''}` },
      cover(it.image, 'mu-cov'),
      h('div', { class: 'mu-rt' }, h('b', {}, it.name),
        h('small', {}, [{ album: 'Album', track: 'Song' }[it.type] || 'Playlist', it.owner, it.playedAt ? ago(it.playedAt) : it.tracks ? `${it.tracks} songs` : ''].filter(Boolean).join(' · '))),
      h('button', { class: 'mu-play', title: `Play ${it.name}`, 'aria-label': `Play ${it.name}`, disabled: busy === it.uri, onclick: () => play(it) }, busy === it.uri ? h('span', { class: 'mu-spin' }) : svg(PLAY)));
  }
  function search(q) {
    query = q;
    clearTimeout(searchT);
    if (!q.trim()) { found = null; return draw(); }
    searchT = setTimeout(async () => {
      try { const r = await (await fetch(`/api/music/search?q=${encodeURIComponent(q)}`)).json(); if (query === q) { found = r.error ? { error: r.error } : r; draw(); } } catch (e) { /* offline */ }
    }, 300);
  }
  function searchBox() {
    return h('div', { class: 'mu-search' },
      h('input', { id: 'mu-q', type: 'search', placeholder: 'Search songs and playlists', value: query, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search Spotify',
        oninput: (e) => search(e.target.value), onkeydown: (e) => { if (e.key === 'Escape') { e.target.value = ''; search(''); } if (e.key === 'Enter') { const first = [...(found?.tracks || []), ...(found?.playlists || [])][0]; if (first) play(first); } } }));
  }
  function results() {
    if (!found) return [h('div', { class: 'mu-lbl' }, 'Searching…')];
    if (found.error) return [h('div', { class: 'blocked small' }, found.error)];
    const out = [];
    if (found.tracks?.length) out.push(h('div', { class: 'mu-lbl' }, 'Songs'), h('div', { class: 'mu-list' }, found.tracks.map(row)));
    if (found.playlists?.length) out.push(h('div', { class: 'mu-lbl' }, 'Playlists'), h('div', { class: 'mu-list' }, found.playlists.map(row)));
    return out.length ? out : [h('div', { class: 'empty' }, `Nothing found for “${query}”`)];
  }

  function setupCard() {
    return h('div', { class: 'mu-setup' },
      h('p', {}, 'Connect Spotify once to see the playlists you played last and start them from here.'),
      h('ol', {},
        h('li', {}, 'Open the ', h('a', { href: 'https://developer.spotify.com/dashboard' }, 'Spotify developer dashboard'), ' and create an app (any name). Tick ', h('b', {}, 'Web API'), '.'),
        h('li', {}, 'Add this Redirect URI:', h('div', { class: 'mu-copy' }, h('code', {}, M.redirect),
          h('button', { class: 'btn sm ghost', onclick: () => navigator.clipboard.writeText(M.redirect).then(() => toast('Copied')) }, 'Copy'))),
        h('li', {}, 'Paste the app\'s Client ID:')),
      h('div', { class: 'mu-cid' },
        h('input', { type: 'text', placeholder: 'Client ID', value: typed || M.clientId || '', spellcheck: 'false', autocomplete: 'off', oninput: (e) => { typed = e.target.value.trim(); } }),
        h('button', { class: 'btn go', onclick: connect }, 'Connect')),
      h('p', { class: 'muted small' }, 'No client secret needed. The login stays on this Mac, encrypted in your Keychain.',
        M.app ? ' The Spotify app is installed, so play and pause work even before you connect.' : ''));
  }

  function draw() {
    const el = box();
    if (!open) { el.hidden = true; clearInterval(timer); timer = null; return; }
    el.hidden = false;
    if (!timer) timer = setInterval(tick, 5000);
    const close = async () => { if (PANEL_MODE === 'music') return shellPanel('music', { open: false }); open = false; draw(); };
    const head = h('div', { class: 'mu-head' },
      h('span', { class: 'mu-logo' }, ic('music', '♪')), h('b', {}, 'Music'), h('span', { class: 'spacer' }),
      M?.connected && h('button', { class: 'ibtn', title: 'Reload playlists', 'aria-label': 'Reload playlists', onclick: () => load(true) }, ic('refresh', '↻')),
      h('button', { class: 'ibtn', title: 'Close', 'aria-label': 'Close', onclick: close }, '×'));
    if (!M) return el.replaceChildren(h('div', { class: 'mu' }, head, h('div', { class: 'empty' }, 'Loading…')));
    const body = [];
    if (M.connected || M.app || M.demo) body.push(nowCard());
    if (M.connected) {
      if (M.error) body.push(h('div', { class: 'blocked small' }, M.error));
      body.push(searchBox());
      if (query.trim()) { body.push(...results()); }
      else {
      body.push(h('div', { class: 'mu-lbl' }, 'Recently played'));
      body.push(h('div', { class: 'mu-list' }, M.recent?.length ? M.recent.map(row) : h('div', { class: 'empty' }, 'Nothing played lately. Play something in Spotify and it shows up here.')));
      const mine = (M.mine || []).filter((x) => !M.recent?.some((r) => r.uri === x.uri));
      if (mine.length) {
        body.push(h('button', { class: 'mu-lbl mu-tog', 'aria-expanded': String(showMine), onclick: () => { showMine = !showMine; draw(); } }, `Your playlists (${mine.length})`, h('span', {}, showMine ? '−' : '+')));
        if (showMine) body.push(h('div', { class: 'mu-list' }, mine.map(row)));
      }
      }
    } else if (!M.demo) body.push(setupCard());
    const foot = M.connected && !M.demo && h('div', { class: 'mu-foot muted small' },
      M.app ? 'Plays in the Spotify app' : M.premium === false ? 'Free account: playlists open in Spotify' : 'Plays on your open Spotify device',
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm ghost', onclick: async () => { if (!confirm('Disconnect Spotify from Work Center?')) return; await post('/api/music/disconnect'); load(); } }, 'Disconnect'));
    const had = document.activeElement?.id === 'mu-q' ? document.activeElement.selectionStart : null;
    el.replaceChildren(h('div', { class: 'mu' }, head, h('div', { class: 'mu-body' }, body), foot));
    if (had != null) { const q = $('mu-q'); q?.focus(); q?.setSelectionRange(had, had); }
  }

  function toggle() { open = !open; if (open) load(); else draw(); }

  // Sidebar button, right under Messages.
  const btn = h('button', { id: 'btn-music', class: 'nv', title: 'Music: your recent Spotify playlists' },
    h('span', { class: 'nv-i', 'data-i': 'music' }, ic('music', '♪')), h('span', { class: 'nv-l' }, 'Music'));
  btn.onclick = async () => { if (await shellPanel('music', { toggle: true })) return; toggle(); };
  const phone = $('btn-phone');
  if (phone) phone.after(btn); else $('nav-bottom')?.prepend(btn);

  if (PANEL_MODE === 'music') { load(); document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }); }
})();

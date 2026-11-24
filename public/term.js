/* Work Center terminal overlay: the real `claude` TUI in xterm.js, bridged to one shared PTY over a WebSocket. */
(() => {
  const THEMES = {
    vice: {
      background: '#12061f', foreground: '#fdf3ff', cursor: '#ff2e93', cursorAccent: '#12061f',
      selectionBackground: 'rgba(255, 46, 147, .35)',
      black: '#1e0f36', red: '#ff4f7b', green: '#3dffb0', yellow: '#ffd23f', blue: '#4fd8ff', magenta: '#ff2e93', cyan: '#4fd8ff', white: '#e9dcf7',
      brightBlack: '#6f5596', brightRed: '#ff7a9c', brightGreen: '#7dffc9', brightYellow: '#ffe17a', brightBlue: '#8ae6ff', brightMagenta: '#ff6db3', brightCyan: '#a6efff', brightWhite: '#ffffff',
    },
    normal: {
      background: '#0f1115', foreground: '#e6e8ec', cursor: '#e6e8ec', cursorAccent: '#0f1115',
      selectionBackground: 'rgba(110, 163, 245, .35)',
      black: '#1b1e24', red: '#f0766c', green: '#4cc38a', yellow: '#e2b04a', blue: '#6ea3f5', magenta: '#a98bf0', cyan: '#56c2d6', white: '#d5d8de',
      brightBlack: '#5c6370', brightRed: '#ff9a91', brightGreen: '#74dba8', brightYellow: '#f0c870', brightBlue: '#94bcf8', brightMagenta: '#c3acf5', brightCyan: '#86d8e6', brightWhite: '#ffffff',
    },
  };

  let loading = null;
  let term = null;
  let fit = null;
  let ws = null;
  let retry = null;
  let retryDelay = 500;
  let pendingText = null;
  let ready = false; // the session has produced output on this connection
  let kind = (() => { try { return localStorage.getItem('term:kind') === 'shell' ? 'shell' : 'ai'; } catch { return 'ai'; } })();

  const themeName = () => (document.documentElement.dataset.theme === 'normal' ? 'normal' : 'vice');

  function loadVendor() {
    if (loading) return loading;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/xterm.css';
    document.head.appendChild(css);
    const script = (src) =>
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(s);
      });
    loading = script('/vendor/xterm.js').then(() => script('/vendor/addon-fit.js'));
    loading.catch(() => (loading = null));
    return loading;
  }

  // Claude (the AI CLI) or Shell (your own login shell: gcloud/aws/twg logins open your browser).
  function setKind(k) {
    if (k === kind) return;
    kind = k;
    try { localStorage.setItem('term:kind', k); } catch { /* private mode */ }
    document.querySelectorAll('.term-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    pendingText = null;
    if (ws) { const old = ws; ws = null; try { old.close(); } catch { /* closed */ } }
    if (term) { term.reset(); connect(); requestAnimationFrame(() => { resize(); term.focus(); }); }
  }
  function kindSwitch() {
    const ai = (typeof D !== 'undefined' && D && D.config && D.config.engine) || 'AI CLI';
    return h('span', { class: 'term-kind', role: 'group', 'aria-label': 'Which terminal' },
      h('button', { type: 'button', 'data-k': 'ai', class: kind === 'ai' ? 'on' : '', title: `${ai}: the AI in a terminal`, onclick: () => setKind('ai') }, `✦ ${ai}`),
      h('button', { type: 'button', 'data-k': 'shell', class: kind === 'shell' ? 'on' : '', title: 'Your own shell: run anything, e.g. gcloud auth login (opens your browser)', onclick: () => setKind('shell') }, '$ Shell'));
  }

  function overlay() {
    let el = $('terminal');
    if (el) return el;
    el = h('div', { id: 'terminal', hidden: true, role: 'dialog', 'aria-label': 'HQ Terminal' },
      h('div', { class: 'term-bar' },
        h('span', { class: 'term-dot', id: 'term-dot', title: 'Connection' }),
        h('b', { class: 'term-name' }, 'HQ Terminal'),
        kindSwitch(),
        h('span', { class: 'term-gap' }),
        h('span', { class: 'term-hint' }, '⌘⇧T to toggle'),
        h('button', { class: 'term-btn', type: 'button', onclick: restart, title: 'Restart the session' }, 'Restart'),
        h('button', { class: 'term-btn term-close', type: 'button', onclick: () => window.closeTerminal(), title: 'Close (session keeps running)' }, 'Close')),
      h('div', { class: 'term-body' }, h('div', { id: 'term-screen' })));
    document.body.appendChild(el);
    return el;
  }

  const setStatus = (s) => {
    const dot = $('term-dot');
    if (dot) dot.dataset.state = s;
  };

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function flushPending() {
    if (pendingText == null || !ready || !ws || ws.readyState !== 1) return;
    const text = pendingText;
    pendingText = null;
    // Give the TUI a moment to draw its prompt before typing into it (no Enter is sent).
    setTimeout(() => send({ t: 'in', d: text }), 400);
  }

  function connect() {
    clearTimeout(retry);
    if (ws && ws.readyState <= 1) return;
    ready = false;
    setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = (ws = new WebSocket(`${proto}://${location.host}/term?token=${encodeURIComponent(D.token)}&kind=${kind}`));
    sock.onopen = () => {
      retryDelay = 500;
      setStatus('live');
      term.reset();
      resize();
    };
    sock.onmessage = (e) => {
      const d = e.data;
      if (typeof d === 'string' && d.startsWith('{"t":')) {
        try {
          const m = JSON.parse(d);
          if (m.t === 'exit') {
            setStatus('exited');
            term.write('\r\n\x1b[2mPress Restart, or type to start a new session.\x1b[0m\r\n');
            ready = false;
            return;
          }
        } catch { /* plain output that happens to look like JSON */ }
      }
      term.write(d);
      if (!ready) {
        ready = true;
        setStatus('live');
        flushPending();
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      setStatus('offline');
      ws = null;
      if (!$('terminal') || $('terminal').hidden) return; // reconnect on next open
      retry = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
    };
  }

  let host = null; // an element outside the overlay showing the terminal (the AI bubble)
  let screenEl = null; // #term-screen, kept even while it is detached
  function resize() {
    if (!term || !fit || ($('terminal')?.hidden && !host)) return;
    try { fit.fit(); } catch { return; }
    send({ t: 'resize', cols: term.cols, rows: term.rows });
  }

  function restart() {
    if (!ws || ws.readyState !== 1) return connect();
    term.reset();
    ready = false;
    send({ t: 'restart' });
    term.focus();
  }

  function applyTheme() {
    const name = themeName();
    if ($('terminal')) $('terminal').dataset.theme = name;
    if (term) term.options.theme = THEMES[name];
  }

  async function ensure() {
    overlay();
    await loadVendor();
    if (!term) {
      term = new window.Terminal({
        fontFamily: '"SF Mono", Menlo, Monaco, "JetBrains Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 5000,
        macOptionIsMeta: true,
        theme: THEMES[themeName()],
      });
      fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      screenEl = $('term-screen');
      term.open(screenEl);
      term.onData((d) => send({ t: 'in', d }));
      // Let Cmd/Ctrl+Shift+T reach the toggle instead of the PTY.
      term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && isToggle(e)));
    }
    applyTheme();
    if (!ws || ws.readyState > 1) connect();
    else flushPending();
  }

  window.openTerminal = async (initialText) => {
    if (typeof initialText === 'string' && initialText) { if (kind !== 'ai') setKind('ai'); pendingText = initialText; }
    try { await ensure(); } catch (e) { toast(e.message); return; }
    if (host || (screenEl && !screenEl.isConnected)) { host = host || {}; window.unmountTerminal(); }
    $('terminal').hidden = false;
    document.documentElement.classList.add('term-open');
    requestAnimationFrame(() => { resize(); term.focus(); });
  };

  // Show the same live session inside another element (the AI bubble's Terminal tab).
  window.mountTerminal = async (container) => {
    try { await ensure(); } catch (e) { toast(e.message); return; }
    window.closeTerminal();
    host = container;
    screenEl = screenEl || $('term-screen');
    container.append(h('div', { class: 'term-bar term-mini' }, kindSwitch()), screenEl);
    if (term) term.options.theme = THEMES[themeName()];
    requestAnimationFrame(() => { resize(); term.focus(); });
  };
  window.unmountTerminal = () => {
    if (!host) return;
    host = null;
    if (screenEl) $('terminal').querySelector('.term-body').append(screenEl);
  };
  window.fitTerminal = () => requestAnimationFrame(resize);

  window.closeTerminal = () => {
    const el = $('terminal');
    if (!el || el.hidden) return;
    el.hidden = true;
    document.documentElement.classList.remove('term-open');
  };

  const isToggle = (e) => (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 't';
  document.addEventListener('keydown', (e) => {
    if (!isToggle(e)) return;
    e.preventDefault();
    if ($('terminal') && !$('terminal').hidden) window.closeTerminal();
    else window.openTerminal();
  }, true);

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(resize, 80);
  });
})();

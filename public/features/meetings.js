/* Meeting alerts and the call panel (server: src/features/meetings.js, shell: main.js meet()).
   - Main window: a few minutes before a meeting a card pops up (top right) with Join here / Browser / dismiss;
     a macOS notification comes from the server at the same time.
   - ?panel=meet: the slim header above the call (title, timer, Open in browser, Leave).
   window.joinMeeting({ id?, title, start, url }) joins from anywhere (the Meetings step uses it).
   Uses page globals: h, $, post, toast, PANEL_MODE. */
(() => {
  const time = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  async function join(m, where) {
    const r = await post('/api/meetings/join', { id: m.id, url: m.url || m.join, title: m.title, where }).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) { toast(r.error || 'Could not join'); return; }
    if (!r.handled) window.open(r.url, '_blank'); // browser, or no app shell
    if (m.id) post('/api/meetings/dismiss', { id: m.id }).then(poll).catch(() => {});
  }
  window.joinMeeting = (m) => join(m);

  /* ---------- Panel header above the call ---------- */
  if (PANEL_MODE === 'meet') {
    const q = new URLSearchParams(location.search);
    const call = q.get('call') || '';
    const started = Date.now();
    const clock = h('span', { class: 'mt-clock muted small' }, '0:00');
    setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    document.body.append(h('div', { id: 'meet-head' },
      h('span', { class: 'mt-dot', title: 'In a call' }),
      h('b', { class: 'mt-title', title: q.get('title') || '' }, q.get('title') || 'Meeting'), clock,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm ghost', title: 'Open this call in your browser', onclick: () => window.open(call, '_blank') }, 'Open in browser'),
      h('button', { class: 'btn sm mt-leave', title: 'Leave the call and close the panel', onclick: () => post('/api/ui/panel', { name: 'meet', open: false }) }, 'Leave')));
    return;
  }
  if (PANEL_MODE) return;

  /* ---------- Alert cards in the main window ---------- */
  const box = h('div', { id: 'meet-alerts', role: 'region', 'aria-label': 'Meetings starting' });
  document.body.append(box);
  let due = [];
  function paint() {
    box.replaceChildren(...due.map((m) => {
      const mins = Math.round((new Date(m.start) - Date.now()) / 60000);
      const when = mins > 0 ? `starts in ${mins} min` : mins === 0 ? 'starting now' : `started ${-mins} min ago`;
      return h('div', { class: 'mt-card' },
        h('div', { class: 'mt-ic' }, '📹'),
        h('div', { class: 'mt-txt' }, h('b', {}, m.title), h('small', { class: 'muted' }, `${time(m.start)} · ${when}`)),
        h('div', { class: 'mt-acts' },
          m.join ? h('button', { class: 'btn sm primary', onclick: () => join(m) }, 'Join here') : h('small', { class: 'muted' }, 'No video link'),
          m.join ? h('button', { class: 'btn sm ghost', title: 'Open in your browser', onclick: () => join(m, 'browser') }, 'Browser') : null,
          h('button', { class: 'ibtn', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => post('/api/meetings/dismiss', { id: m.id }).then(poll) }, '×')));
    }));
  }
  async function poll() {
    const r = await fetch('/api/meetings/upcoming').then((x) => x.json()).catch(() => null);
    if (!r) return;
    due = r.inApp === false ? [] : r.due || [];
    paint();
  }
  poll();
  setInterval(poll, 30_000);
  setInterval(paint, 30_000); // keep "starts in N min" current
})();

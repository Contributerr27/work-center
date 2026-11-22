/* Focus missions: 25 / 50 / 90 minute timer on one task, with a HUD, dimmed missions and a quiet phone.
   Uses page globals: h, $, D, post, toast, load, render, theme, celebrate, HQ. */
(() => {
  let F = null; // last /api/focus view
  let skew = 0; // server clock minus page clock
  let lastActive = null; // startedAt of the session we were showing
  const CELEB_KEY = 'focus:celebrated';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const vice = () => theme() === 'vice';

  // The phone reads this: true while a focus session runs (then only urgency-3 messages should ring).
  window.HQ_FOCUS_QUIET = () => !!(F?.active && new Date(F.active.endsAt).getTime() > Date.now() + skew);

  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* no storage */ } return null; };
  const left = () => (F?.active ? Math.max(0, new Date(F.active.endsAt).getTime() - (Date.now() + skew)) : 0);
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function apply(view) {
    if (!view || view.error || !view.now) return;
    if (F?.now && new Date(view.now) < new Date(F.now)) return; // an older snapshot (e.g. D.ext from an earlier load)
    F = view;
    if (view.now) skew = new Date(view.now).getTime() - Date.now();
    const was = lastActive;
    lastActive = F.active?.startedAt || null;
    // Celebrate a session that just finished on time (once, even across reloads).
    const l = F.last;
    if (l?.completed && store(CELEB_KEY) !== l.startedAt && Date.now() - new Date(l.endedAt) < 15 * 60_000 && (was === l.startedAt || !was)) {
      store(CELEB_KEY, l.startedAt);
      celebrate({ name: 'Focus', mission: `${l.minutes} min focus${l.label ? ` · ${l.label}` : ''}` });
    }
    paint();
  }
  let busy = 0;
  async function refresh() {
    if (Date.now() - busy < 2000) return;
    busy = Date.now();
    try { apply(await (await fetch('/api/focus')).json()); } catch (e) { /* server restarting */ }
  }

  /* ---------- HUD ---------- */
  function ringSvg(frac) {
    const r = 20, c = 2 * Math.PI * r;
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 48 48');
    s.setAttribute('class', 'fx-ring');
    const mk = (cls, dash) => { const ci = document.createElementNS(SVGNS, 'circle'); Object.entries({ cx: 24, cy: 24, r, fill: 'none', 'stroke-width': 4.5, class: cls, 'stroke-dasharray': dash, transform: 'rotate(-90 24 24)', 'stroke-linecap': 'round' }).forEach(([k, v]) => ci.setAttribute(k, v)); return ci; };
    s.append(mk('bg', `${c} ${c}`), mk('fg', `${c * frac} ${c}`));
    return s;
  }
  function hud() {
    let el = $('focus-hud');
    if (!el) { el = h('div', { id: 'focus-hud', hidden: true, role: 'timer', 'aria-live': 'off' }); document.body.append(el); }
    return el;
  }
  function paint() {
    const el = hud();
    const a = F?.active;
    document.body.classList.toggle('focus-on', !!a);
    document.body.classList.toggle('focus-task', !!a?.taskId);
    if (!a) { el.hidden = true; return; }
    const total = a.minutes * 60_000, ms = left();
    el.hidden = false;
    el.replaceChildren(
      h('div', { class: 'fx-dial' }, ringSvg(total ? ms / total : 0), h('b', {}, mmss(ms))),
      h('div', { class: 'fx-txt' },
        h('small', {}, vice() ? 'Focus mission' : 'Focus'),
        h('span', { title: a.label || '' }, a.label || 'Deep work'),
        F.hooks?.last && !F.hooks.last.ok && h('em', { title: F.hooks.last.error || '' }, 'Shortcut failed')),
      h('button', { class: 'btn sm ghost', title: 'Add 10 minutes', onclick: () => act('/api/focus/extend', '+10 min') }, '+10'),
      h('button', { class: 'btn sm ghost', title: 'End the session now (does not count as passed)', onclick: () => confirm('End this focus session now? It will not count as passed.') && act('/api/focus/stop', 'Focus ended') }, 'Stop'));
    if (ms <= 0) refresh();
  }
  async function act(p, msg, body) {
    try { apply(await post(p, body)); toast(msg); } catch (e) { toast(e.message); }
  }

  /* ---------- Picker ---------- */
  function openPicker(taskId) {
    const el = HQ.overlay('focus-pick');
    let minutes = 50, task = taskId || '';
    const tasks = (D?.tasks || []).filter((t) => t.status === 'ready' && !t.doneAt);
    const draw = () => el.replaceChildren(h('div', { class: 'fx-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Start a focus session' },
      h('div', { class: 'fx-title' }, vice() ? 'Focus mission' : 'Start a focus session'),
      h('div', { class: 'fx-mins' }, [25, 50, 90].map((m) => h('button', { class: `fx-min ${m === minutes ? 'on' : ''}`, onclick: () => { minutes = m; draw(); } }, h('b', {}, m), h('small', {}, 'min')))),
      h('label', { class: 'fx-lbl' }, 'Task',
        h('select', { onchange: (e) => { task = e.target.value; } },
          h('option', { value: '' }, 'No task: just deep work'),
          tasks.map((t) => h('option', { value: t.id, selected: t.id === task }, t.title)))),
      h('p', { class: 'muted small' }, 'The phone stays quiet except urgent messages; other missions dim.'),
      h('div', { class: 'fx-acts' },
        h('button', { class: 'btn ghost', onclick: () => HQ.closeOverlay('focus-pick') }, 'Cancel'),
        h('button', { class: 'btn go', onclick: async () => { HQ.closeOverlay('focus-pick'); await act('/api/focus/start', `Focus: ${minutes} min`, { minutes, taskId: task || null }); } }, `▶ Start ${minutes} min`))));
    draw();
    el.onclick = (e) => { if (e.target === el) HQ.closeOverlay('focus-pick'); };
    el.hidden = false;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') HQ.closeOverlay('focus-pick'); });

  /* ---------- Header button and ▶ on task cards ---------- */
  const btn = HQ.addButton({ id: 'btn-focus', label: '🎯 Focus', title: 'Start a focus session (25 / 50 / 90 min)', onclick: () => (F?.active ? $('focus-hud')?.scrollIntoView() : openPicker()) });

  HQ.onRender(() => {
    if (D?.ext?.focus && !D.ext.focus.error) apply(D.ext.focus);
    btn.textContent = F?.active ? `🎯 ${mmss(left())}` : '🎯 Focus';
    const byTitle = new Map((D?.tasks || []).filter((t) => t.status === 'ready' && !t.doneAt).map((t) => [t.title, t.id]));
    for (const card of document.querySelectorAll('#work .tcard')) {
      if (card.querySelector('.fx-go')) continue;
      const id = byTitle.get(card.querySelector('.head b')?.textContent || '');
      if (!id) continue;
      const on = F?.active?.taskId === id;
      card.classList.toggle('fx-current', on);
      card.querySelector('.head').append(h('button', { class: 'ibtn fx-go', title: on ? 'Focusing on this' : 'Focus on this task', 'aria-label': 'Focus on this task', disabled: on,
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); openPicker(id); } }, on ? '◉' : '▶'));
    }
  });

  setInterval(() => { if (F?.active) { paint(); btn.textContent = `🎯 ${mmss(left())}`; } }, 1000);
  setInterval(() => { if (F?.active) refresh(); }, 15_000);
  refresh();
})();

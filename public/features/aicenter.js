/* Activity log (every AI run by you and your AI team: filter by who, topic, dates and text; full transcripts)
   and the floating AI bubble
   (chat or terminal, three sizes, file and image attachments).
   Uses page globals: h, $, D, post, toast, load, HQ, liveFeed. */
(() => {
  const OV = 'aic-ov';
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  const dur = (a, b) => { if (!a || !b) return ''; const s = Math.round((new Date(b) - new Date(a)) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
  const KIND = { run: ['✦', 'Chat'], task: ['☑', 'Task'], autopilot: ['⟳', 'Autopilot'], scan: ['◎', 'Scan'], prd: ['▤', 'PRD'], setup: ['⚙', 'Setup'] };
  const secName = (id) => ({ github: 'GitHub', jira: 'Jira', slack: 'Slack', work: 'Work', meet: 'Meetings', hq: 'AI chat' }[id] || id || '');
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* no storage */ } return null; };

  /* ================= Activity log ================= */
  const A = { day: dayKey(new Date()), month: dayKey(new Date()).slice(0, 7), runs: [], counts: {}, sel: null, detail: null, q: '', timer: null, reply: '',
    f: { range: 'today', from: '', to: '', who: 'all', topic: 'all' }, act: null, qT: null, fOpen: false };

  async function getJson(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); return j; }
  // The date range the filters ask for.
  function span() {
    const today = dayKey(new Date());
    const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
    switch (A.f.range) {
      case 'today': return [today, today];
      case '30d': return [back(29), today];
      case 'day': return [A.day, A.day];
      case 'custom': return [A.f.from || back(6), A.f.to || today];
      default: return [back(6), today];
    }
  }
  async function loadActivity(keepSel) {
    const [from, to] = span();
    const qs = new URLSearchParams({ from, to, who: A.f.who, topic: A.f.topic, q: A.q.trim() });
    try { A.act = await getJson(`/api/activity?${qs}`); A.runs = A.act.runs; } catch (e) { toast(e.message); A.act = null; A.runs = []; }
    if (!A.runs.some((r) => r.id === A.sel)) { if (keepSel) { /* keep showing it */ } else { A.sel = A.runs[0]?.id || null; A.detail = null; } }
    if (A.sel && !A.detail) await loadRun(A.sel, true);
    paint();
  }
  // A calendar day (Home's activity map opens one): show just that day.
  async function loadDay(day) { A.day = day; A.f.range = 'day'; await loadActivity(); }
  async function loadMonth(month) {
    A.month = month;
    try { A.counts = (await getJson(`/api/history/days?month=${month}`)).days; } catch (e) { A.counts = {}; }
    paint();
  }
  async function loadRun(id, quiet) {
    A.sel = id;
    const day = A.runs.find((r) => r.id === id)?.day || A.day;
    try { A.detail = await getJson(`/api/history/run?id=${encodeURIComponent(id)}&date=${day}`); } catch (e) { A.detail = { error: e.message }; }
    if (!quiet) paint();
  }
  function tick() {
    clearTimeout(A.timer);
    if ($(OV)?.hidden) return;
    const busy = A.runs.some((r) => r.running) || A.detail?.runs?.some((r) => r.running);
    A.timer = setTimeout(async () => { if (span()[1] === dayKey(new Date())) { await loadActivity(true); } tick(); }, busy ? 3000 : 20000);
  }

  window.openAICenter = async (day) => {
    const ov = HQ.overlay(OV);
    ov.hidden = false;
    document.documentElement.classList.add('aic-open');
    paint();
    if (!day) Object.assign(A.f, { range: 'today', who: 'all', topic: 'all' });
    A.fOpen = false;
    await Promise.all([loadMonth((day || A.day).slice(0, 7)), day ? loadDay(day) : loadActivity()]);
    tick();
  };
  const close = () => { HQ.closeOverlay(OV); document.documentElement.classList.remove('aic-open'); clearTimeout(A.timer); };

  function calendar() {
    const [y, m] = A.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = (first.getDay() + 6) % 7; // weeks start Monday
    const days = new Date(y, m, 0).getDate();
    const today = dayKey(new Date());
    const max = Math.max(1, ...Object.values(A.counts));
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); loadMonth(dayKey(d).slice(0, 7)); };
    const cells = [];
    for (let i = 0; i < start; i++) cells.push(h('span', { class: 'aic-cd empty' }));
    for (let d = 1; d <= days; d++) {
      const k = `${A.month}-${pad(d)}`;
      const n = A.counts[k] || 0;
      const future = k > today;
      cells.push(h('button', {
        class: `aic-cd ${k === A.day ? 'sel' : ''} ${k === today ? 'today' : ''} ${n ? 'has' : ''}`,
        disabled: future, title: n ? `${n} AI run${n === 1 ? '' : 's'}` : 'Nothing', 'aria-label': `${parseDay(k).toDateString()}, ${n} runs`,
        style: n ? `--heat:${(0.25 + 0.75 * n / max).toFixed(2)}` : null,
        onclick: () => loadDay(k),
      }, String(d)));
    }
    return h('div', { class: 'aic-cal' },
      h('div', { class: 'aic-cal-head' },
        h('button', { class: 'aic-nav', onclick: () => shift(-1), 'aria-label': 'Previous month' }, '‹'),
        h('b', {}, first.toLocaleDateString([], { month: 'long', year: 'numeric' })),
        h('button', { class: 'aic-nav', onclick: () => shift(1), disabled: A.month >= today.slice(0, 7), 'aria-label': 'Next month' }, '›')),
      h('div', { class: 'aic-cal-grid' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => h('span', { class: 'aic-dow' }, x)), cells));
  }

  function runTitle(r) { return r.title || r.text || r.label || 'AI run'; }
  const avatarOf = (w) => h('span', { class: 'tm-av sm', style: `--c:${w?.color || '#8a8f99'}`, title: w?.name || '' }, w?.emoji || (w?.id === 'you' ? '🙂' : (w?.name || '?')[0]));
  function filters() {
    const F = A.f, act = A.act || {};
    // Picking something folds the filters back to the one-line summary (custom dates stay open to finish).
    const set = (patch) => { Object.assign(F, patch); if (patch.range !== 'custom' && !('from' in patch) && !('to' in patch)) A.fOpen = false; A.sel = null; A.detail = null; loadActivity(); };
    const rangeBtn = (id, label) => h('button', { class: `chip ${F.range === id ? 'on' : ''}`, onclick: () => set({ range: id }) }, label);
    const [from, to] = span();
    const whoChips = [{ id: 'all', name: 'Everyone', n: act.total }, ...(act.facets?.who || [])];
    const topicChips = [{ name: 'all', label: 'All topics', n: act.total }, ...(act.facets?.topic || [])];
    const RANGE = { today: 'Today', '7d': '7 days', '30d': '30 days', day: parseDay(A.day).toLocaleDateString([], { month: 'short', day: 'numeric' }), custom: `${parseDay(from).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${parseDay(to).toLocaleDateString([], { month: 'short', day: 'numeric' })}` };
    const whoSel = F.who === 'all' ? null : whoChips.find((w) => w.id === F.who);
    const search = h('input', { class: 'st-in aic-search', type: 'search', placeholder: 'Search text, results, ticket keys…', value: A.q,
      oninput: (e) => { A.q = e.target.value; clearTimeout(A.qT); A.qT = setTimeout(() => loadActivity(), 300); } });
    const summary = h('button', { class: `act-sum ${A.fOpen ? 'open' : ''}`, 'aria-expanded': A.fOpen ? 'true' : 'false', title: A.fOpen ? 'Hide the filters' : 'Change the filters', onclick: () => { A.fOpen = !A.fOpen; paint(); } },
      h('span', { class: 'chip on' }, RANGE[F.range] || 'Today'),
      h('span', { class: 'chip on' }, whoSel ? [avatarOf(whoSel), ` ${whoSel.name}`] : 'Everyone'),
      h('span', { class: 'chip on' }, F.topic === 'all' ? 'All topics' : F.topic),
      h('span', { class: 'act-caret' }, A.fOpen ? '▴' : '▾ Change'));
    if (!A.fOpen) return h('div', { class: 'act-f' }, summary, search);
    return h('div', { class: 'act-f' }, summary,
      h('div', { class: 'act-row' }, rangeBtn('today', 'Today'), rangeBtn('7d', '7 days'), rangeBtn('30d', '30 days'), F.range === 'day' ? rangeBtn('day', parseDay(A.day).toLocaleDateString([], { month: 'short', day: 'numeric' })) : null, rangeBtn('custom', 'Custom')),
      F.range === 'custom' ? h('div', { class: 'act-row' },
        h('input', { type: 'date', value: F.from || from, max: dayKey(new Date()), onchange: (e) => set({ from: e.target.value }) }), h('span', { class: 'muted small' }, 'to'),
        h('input', { type: 'date', value: F.to || to, max: dayKey(new Date()), onchange: (e) => set({ to: e.target.value }) })) : null,
      h('div', { class: 'act-row act-who' }, whoChips.map((w) => h('button', { class: `chip ${F.who === w.id ? 'on' : ''}`, onclick: () => set({ who: w.id }) },
        w.id !== 'all' ? avatarOf(w) : null, w.name, w.n != null ? h('small', {}, ` ${w.n}`) : null))),
      h('div', { class: 'act-row' }, topicChips.map((t) => h('button', { class: `chip ${F.topic === t.name ? 'on' : ''}`, onclick: () => set({ topic: t.name }) }, t.label || t.name, t.n != null ? h('small', {}, ` ${t.n}`) : null))),
      search);
  }
  function sidebar() {
    const act = A.act;
    const [from, to] = span();
    const label = from === to ? (from === dayKey(new Date()) ? 'Today' : parseDay(from).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))
      : `${parseDay(from).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${parseDay(to).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    return h('aside', { class: 'aic-side' },
      filters(),
      h('div', { class: 'aic-dayhead' }, h('b', {}, label), h('span', { class: 'muted small' }, act ? `${act.count} of ${act.total} run${act.total === 1 ? '' : 's'}` : 'Loading…')),
      h('div', { class: 'aic-list', id: 'aic-list' }, listItems(A.runs)),
      h('details', { class: 'act-cal' }, h('summary', { class: 'muted small' }, 'Jump to a day'), calendar()));
  }
  function listItems(list) {
    if (!list.length) return h('div', { class: 'muted small aic-empty' }, A.act?.total ? 'Nothing matches these filters' : 'No AI activity in this range');
    const out = [];
    let lastDay = null;
    for (const r of list) {
      if (r.day !== lastDay) { lastDay = r.day; out.push(h('div', { class: 'act-day' }, r.day === dayKey(new Date()) ? 'Today' : parseDay(r.day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))); }
      out.push(h('button', { class: `aic-item ${r.id === A.sel ? 'sel' : ''} ${r.error ? 'bad' : ''}`, onclick: () => loadRun(r.id) },
        avatarOf(r.who),
        h('span', { class: 'aic-it' },
          h('b', {}, runTitle(r)),
          h('small', {}, [hhmm(r.startedAt), r.who?.name, r.topic, r.steps ? `${r.steps} steps` : null].filter(Boolean).join(' · ')),
          r.keys?.length ? h('span', { class: 'act-keys' }, r.keys.slice(0, 4).map((k) => h('span', { class: 'chip sm', onclick: (e) => { e.stopPropagation(); A.q = k; loadActivity(); } }, k))) : null),
        r.running ? h('span', { class: 'spin' }) : r.error ? h('span', { class: 'aic-st bad' }, '✕') : (r.actions || []).length ? h('span', { class: 'pill green' }, r.actions.length) : null));
    }
    return out;
  }
  function paintList() { const el = $('aic-list'); if (el) el.replaceChildren(...[listItems(A.runs)].flat()); }

  function transcriptView(r) {
    const steps = r.transcript || [];
    const tools = steps.filter((s) => s.kind === 'tool');
    const fails = tools.filter((s) => s.failed).length;
    return h('div', { class: 'aic-run' },
      r.text || r.title ? h('div', { class: 'aic-msg me' }, h('div', { class: 'aic-bub' }, r.text || r.title),
        r.attachments?.length ? h('div', { class: 'aic-att' }, r.attachments.map((a) => h('span', { class: 'chip sm' }, `📎 ${a}`))) : null,
        h('small', {}, [hhmm(r.startedAt), r.label ? `on ${r.label}` : null].filter(Boolean).join(' · '))) : null,
      r.running ? liveFeed({ ...r, activity: steps.slice(-8).map((s) => ({ ...s, label: s.label || s.text?.split('\n')[0] })) }) : null,
      tools.length || steps.length > 1 ? h('details', { class: 'aic-steps' },
        h('summary', {}, `${tools.length} tool call${tools.length === 1 ? '' : 's'}${fails ? ` · ${fails} failed` : ''}${(r.actions || []).length ? ` · did ${r.actions.length} thing${r.actions.length === 1 ? '' : 's'}` : ''}`),
        h('ol', { class: 'feed' }, steps.map((s) => h('li', { class: `${s.kind} ${s.failed ? 'bad' : ''} ${s.sub ? 'sub' : ''}` },
          h('span', { class: 'ic' }, s.kind === 'text' ? '›' : s.failed ? '✕' : '✓'),
          h('span', { class: 't' }, s.kind === 'text' ? s.text.split('\n')[0].slice(0, 200) : s.label, s.error ? h('small', { class: 'blocked' }, ` ${s.error.slice(0, 160)}`) : null))))) : null,
      !r.running && (r.result || r.error || r.final?.text) ? h('div', { class: `aic-msg ai ${r.error ? 'bad' : ''}` },
        h('div', { class: 'aic-bub' }, r.error || window.md(r.result || r.final?.text)),
        h('small', {}, [r.engine, r.finishedAt ? `done ${hhmm(r.finishedAt)}` : null, dur(r.startedAt, r.finishedAt), r.final?.cost ? `$${r.final.cost.toFixed(2)}` : null].filter(Boolean).join(' · '))) : null);
  }

  function main() {
    if (!A.sel) return h('section', { class: 'aic-main aic-blank' }, h('div', {}, h('b', {}, 'Nothing selected'), h('p', { class: 'muted' }, 'Pick a run from the list. Filter by who, topic, dates or text on the left; start a new chat with the ✦ bubble.')));
    const d = A.detail;
    if (!d) return h('section', { class: 'aic-main' }, h('div', { class: 'muted' }, 'Loading…'));
    if (d.error) return h('section', { class: 'aic-main' }, h('div', { class: 'blocked' }, d.error));
    const last = d.runs[d.runs.length - 1];
    const canReply = last && !last.running && !['scan', 'prd', 'setup'].includes(last.kind) && !last.legacy && last.section;
    return h('section', { class: 'aic-main' },
      h('div', { class: 'aic-thread', id: 'aic-thread' }, d.runs.map(transcriptView)),
      canReply ? h('form', { class: 'aic-reply', onsubmit: async (e) => {
        e.preventDefault();
        const t = A.reply.trim();
        if (t.length < 2) return;
        try { await post('/api/command', { section: last.section, text: t, thread: d.thread }); A.reply = ''; toast('Sent'); } catch (err) { return toast(err.message); }
        await loadActivity(true);
        tick();
      } },
      h('input', { class: 'st-in', placeholder: 'Continue this chat…', value: A.reply, oninput: (e) => (A.reply = e.target.value) }),
      h('button', { class: 'btn go', type: 'submit' }, 'Send')) : null);
  }

  function paint() {
    const ov = $(OV);
    if (!ov || ov.hidden) return;
    const keepScroll = $('aic-thread')?.scrollTop;
    const total = Object.values(A.counts).reduce((a, b) => a + b, 0);
    ov.replaceChildren(h('div', { class: 'aic-box', role: 'dialog', 'aria-label': 'Activity log' },
      h('header', { class: 'aic-head' },
        h('h2', { class: 'vh' }, window.icon ? window.icon('ai') : null, 'Activity log'),
        h('span', { class: 'muted small' }, `Everything you and your AI team ran · ${total} run${total === 1 ? '' : 's'} in ${parseDay(`${A.month}-01`).toLocaleDateString([], { month: 'long' })}`),
        h('span', { class: 'st-gap' }),
        h('button', { class: 'btn ghost', onclick: () => { close(); openBubble('chat'); } }, '✦ New chat'),
        h('button', { class: 'btn ghost', title: 'Cmd+Shift+T', onclick: () => { close(); window.openTerminal?.(); } }, '⌨ Terminal'),
        h('button', { class: 'btn', onclick: close }, 'Close')),
      h('div', { class: 'aic-body' }, sidebar(), main())));
    const th = $('aic-thread');
    if (th) th.scrollTop = keepScroll ?? th.scrollHeight;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $(OV) && !$(OV).hidden) close(); });

  /* ================= Floating AI bubble ================= */
  const B = { open: false, mode: store('aib:mode') || 'chat', size: store('aib:size') || 'm', thread: store('aib:thread') || null, files: [], draft: '', sending: false, timer: null, cmds: [], quote: null, seen: new Set() };

  function bubbleEls() {
    let fab = $('aib-fab');
    if (!fab) {
      fab = h('button', { id: 'aib-fab', title: 'AI chat (⌘J)', 'aria-label': 'Open AI chat', onclick: async () => { if (await window.shellPanel?.('ai', { toggle: true })) return; B.open ? closeBubble() : openBubble(); } },
        h('span', { class: 'orb', 'aria-hidden': 'true' },
          // Theme scenery inside the orb (CSS shows the one for the current theme): Vice's striped sun and
          // scanlines, Winter's falling snow.
          h('i', { class: 'orb-sun' }), h('i', { class: 'orb-scan' }),
          h('span', { class: 'orb-snow' }, [1, 2, 3, 4, 5, 6, 7].map((n) => h('i', { class: `f f${n}` }))),
          h('i', { class: 'orb-ring' }), h('i', { class: 'orb-core' }), h('i', { class: 'orb-spark' }),
          h('span', { class: 'orb-ic' }, window.icon ? window.icon('orb') : '✦')));
      document.body.append(fab, h('div', { id: 'aib-win', hidden: true, role: 'dialog', 'aria-label': 'AI chat' }));
    }
    return { fab, win: $('aib-win') };
  }
  function openBubble(mode) {
    if (mode) B.mode = mode;
    B.open = true;
    paintBubble();
    pollChat();
  }
  window.openAIBubble = openBubble;
  // Point the bubble at something on screen (right-click → Ask AI): a quote chip that goes with the next message.
  window.askAIBubble = async (quote, prefill) => { if (!PANEL_MODE && await window.shellPanel?.('ai', { open: true, quote })) return; B.quote = quote; if (prefill != null) B.draft = prefill; setPref('mode', 'chat'); openBubble('chat'); };
  function closeBubble() {
    if (PANEL_MODE === 'ai') { window.shellPanel('ai', { open: false }); return; }
    B.open = false;
    window.unmountTerminal?.();
    $('aib-win').hidden = true;
    $('aib-fab').classList.remove('on');
    clearTimeout(B.timer);
  }
  const setPref = (k, v) => { B[k] = v; store(`aib:${k}`, v); };

  async function pollChat() {
    clearTimeout(B.timer);
    if (!B.open || B.mode !== 'chat') return;
    try { B.cmds = (await (await fetch('/api/pings')).json()).commands || []; } catch (e) { /* server restarting */ }
    // A chat run that just finished may have changed Work Center's data: tell the open views to reload.
    for (const c of B.cmds) {
      if (c.running) B.seen.add(c.id);
      else if (B.seen.has(c.id)) { B.seen.delete(c.id); try { load(false); } catch (e) { /* the page reload fires hq:changed */ } }
    }
    paintMessages();
    const running = B.cmds.some((c) => c.thread === B.thread && c.running);
    B.timer = setTimeout(pollChat, running ? 1500 : 8000);
  }

  async function addFiles(fileList) {
    for (const f of [...fileList].slice(0, 10 - B.files.length)) {
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`); continue; }
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      try {
        const up = await post('/api/ai/upload', { name: f.name || `pasted-${Date.now()}.png`, data });
        B.files.push({ ...up, preview: f.type.startsWith('image/') ? data : null });
      } catch (e) { toast(e.message); }
    }
    paintBubble();
  }

  async function send() {
    const text = B.draft.trim();
    if ((text.length < 2 && !B.files.length && !B.quote) || B.sending) return;
    B.sending = true;
    const q = B.quote;
    const body = (text || (q ? 'Help me with this.' : 'Look at the attached files.')) + (q ? `\n\nAbout this (${q.where || q.label || 'what I am looking at'}):\n\"\"\"\n${q.text}\n\"\"\"${q.url ? `\nLink: ${q.url}` : ''}` : '');
    // @Name → that teammate answers in this chat (and takes it on).
    const mate = (window.teamRoster?.() || []).find((m) => new RegExp(`(^|\\s)@${m.name}\\b`, 'i').test(text));
    try {
      const c = mate
        ? await post('/api/team/ask', { to: mate.id, text: body.slice(0, 5800), thread: B.thread, context: window.viewContext?.() || null })
        : await post('/api/command', { section: 'hq', text: body.slice(0, 5800), thread: B.thread, files: B.files.map((f) => f.path), context: window.viewContext?.() || null });
      setPref('thread', c.thread);
      B.draft = ''; B.files = []; B.quote = null;
    } catch (e) { toast(e.message); }
    B.sending = false;
    paintBubble();
    pollChat();
  }

  // Teammates' open questions (public/features/team.js) wait in a strip above the message box until answered.
  function paintAsks() {
    const box = $('aib-asks');
    if (!box) return;
    if (box.contains(document.activeElement)) return; // don't wipe an answer being typed
    const cards = window.teamQuestionCards?.() || [];
    box.hidden = !cards.length;
    box.replaceChildren(...cards);
  }
  window.aibRepaint = () => paintAsks();
  // Your message: your words, with the attached context (the "About this (…)" quote block) folded into a chip.
  const QUOTE = /^([\s\S]*?)\n\nAbout this \(([^)]*)\):\n"""\n([\s\S]*?)\n"""(?:\nLink: (\S+))?\s*$/;
  function userBubble(text) {
    const m = String(text || '').match(QUOTE);
    if (!m) return h('div', { class: 'aic-bub' }, text);
    const label = !m[2] || m[2] === 'undefined' ? 'what you were looking at' : m[2];
    return h('div', { class: 'aic-bub' }, m[1],
      h('details', { class: 'aic-quote' }, h('summary', {}, `❝ About ${label}`), h('div', { class: 'aic-qt' }, m[3]),
        m[4] ? h('a', { class: 'link small', href: m[4] }, 'Open ↗') : null));
  }
  function messages() {
    const mine = B.cmds.filter((c) => B.thread && c.thread === B.thread).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    if (!mine.length) return [h('div', { class: 'aib-hello' }, h('b', {}, `Hi${D?.config?.owner ? ` ${D.config.owner.split(' ')[0]}` : ''}, what should I do?`),
      h('p', { class: 'muted small' }, `Ask anything, give a job, or tell it a fact (\"Thomas left the company\") and it updates Work Center. It runs with ${D?.config?.engine || 'your AI'} and all your connections; it sees what you are looking at.`),
      h('div', { class: 'aib-sugg' }, ((window.viewContext?.() || {}).suggest || ['What needs me today?', 'Summarize my open PRs', 'Draft my standup']).map((s) => h('button', { class: 'chip', onclick: () => { B.draft = s; send(); } }, s))))];
    return mine.flatMap((c) => [
      h('div', { class: 'aic-msg me' }, userBubble(c.text), c.attachments?.length ? h('div', { class: 'aic-att' }, c.attachments.map((a) => h('span', { class: 'chip sm' }, `📎 ${a}`))) : null),
      c.asTeammate ? h('div', { class: 'aib-mate' }, h('span', { class: 'tm-av xs', style: `--c:${c.asTeammate.color || '#6d5efc'}` }, c.asTeammate.emoji || c.asTeammate.name[0]), h('b', {}, c.asTeammate.name), c.running ? h('span', { class: 'muted small' }, 'is replying…') : null) : null,
      c.running ? liveFeed(c) : h('div', { class: `aic-msg ai ${c.error ? 'bad' : ''} ${c.asTeammate ? 'mate' : ''}` }, h('div', { class: 'aic-bub' }, c.error || window.md(c.result || 'Done.')), liveFeed(c)),
    ]);
  }
  function paintMessages() {
    const box = $('aib-msgs');
    if (!box) return;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.replaceChildren(...messages().filter(Boolean));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  /* ---------- @ a teammate: autocomplete in the chat box ---------- */
  let M = null; // { el, list, i, start }
  function closeMention() { M?.el.remove(); M = null; }
  function mention(ta) {
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = upto.match(/(^|\s)@([\w-]*)$/);
    const roster = (window.teamRoster?.() || []).filter((x) => x.enabled !== false);
    if (!m || !roster.length) return closeMention();
    const q = m[2].toLowerCase();
    const list = roster.filter((x) => x.name.toLowerCase().startsWith(q) || (x.role || '').toLowerCase().includes(q)).slice(0, 8);
    if (!list.length) return closeMention();
    const start = upto.length - m[2].length - 1;
    if (!M) { M = { el: h('div', { class: 'aib-mention', role: 'listbox' }), i: 0 }; ta.closest('.aib-compose')?.append(M.el); }
    Object.assign(M, { list, start, ta, i: Math.min(M.i, list.length - 1) });
    M.el.replaceChildren(h('div', { class: 'muted small am-h' }, 'Ask a teammate'), ...list.map((x, i) => h('button', {
      class: `am-row ${i === M.i ? 'on' : ''}`, role: 'option', 'aria-selected': i === M.i ? 'true' : 'false',
      onmousedown: (e) => { e.preventDefault(); pickMention(i); },
    }, h('span', { class: 'tm-av sm', style: `--c:${x.color || '#6d5efc'}` }, x.emoji || x.name[0]), h('span', { class: 'am-n' }, h('b', {}, x.name), h('small', { class: 'muted' }, x.role)))));
  }
  function pickMention(i) {
    if (!M) return;
    const x = M.list[i], ta = M.ta;
    const before = ta.value.slice(0, M.start), after = ta.value.slice(ta.selectionStart);
    ta.value = `${before}@${x.name} ${after}`;
    B.draft = ta.value;
    const pos = before.length + x.name.length + 2;
    ta.setSelectionRange(pos, pos);
    closeMention();
    ta.focus();
  }
  function mentionKey(e) {
    if (!M) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); M.i = (M.i + (e.key === 'ArrowDown' ? 1 : M.list.length - 1)) % M.list.length; mention(M.ta); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(M.i); return true; }
    if (e.key === 'Escape') { e.preventDefault(); closeMention(); return true; }
    return false;
  }

  function paintBubble() {
    const { fab, win } = bubbleEls();
    fab.classList.toggle('on', B.open);
    if (!B.open) return;
    window.unmountTerminal?.(); // keep the live terminal safe while the window is rebuilt
    win.hidden = false;
    win.dataset.size = B.size;
    const sizeBtn = (s, label, title) => h('button', { class: `aib-sz ${B.size === s ? 'on' : ''}`, title, 'aria-pressed': B.size === s ? 'true' : 'false', onclick: () => { setPref('size', s); paintBubble(); window.fitTerminal?.(); } }, label);
    const modeBtn = (m, label) => h('button', { class: `aib-mode ${B.mode === m ? 'on' : ''}`, 'aria-pressed': B.mode === m ? 'true' : 'false', onclick: () => { if (B.mode === 'terminal' && m !== 'terminal') window.unmountTerminal?.(); setPref('mode', m); paintBubble(); pollChat(); } }, label);
    const head = h('div', { class: 'aib-head' },
      h('div', { class: 'aib-modes' }, modeBtn('chat', '✦ Chat'), modeBtn('terminal', '⌨ Terminal')),
      h('span', { class: 'st-gap' }),
      B.mode === 'chat' && B.thread ? h('button', { class: 'aib-x', title: 'New chat', onclick: () => { setPref('thread', ''); B.thread = null; paintBubble(); } }, '＋') : null,
      sizeBtn('s', 'S', 'Small'), sizeBtn('m', 'M', 'Medium'), sizeBtn('l', '⤢', 'Full view'),
      h('button', { class: 'aib-x', title: 'Open in the Activity log', onclick: async () => { const t = B.thread; if (PANEL_MODE && await window.shellMain('openAICenter')) return; closeBubble(); window.openAICenter(); if (t) setTimeout(() => loadRun(t), 400); } }, '↗'),
      h('button', { class: 'aib-x', title: 'Close (⌘J)', 'aria-label': 'Close', onclick: closeBubble }, '✕'));
    if (B.mode === 'terminal') {
      const host = h('div', { class: 'aib-term' });
      win.replaceChildren(head, host);
      window.mountTerminal ? window.mountTerminal(host) : host.append('Terminal is not available');
      return;
    }
    const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
    const ta = h('textarea', {
      class: 'aib-in', rows: 2, placeholder: 'Ask the AI, or @ a teammate… (Enter to send, Shift+Enter for a new line)',
      oninput: (e) => { B.draft = e.target.value; mention(e.target); },
      onkeydown: (e) => { if (mentionKey(e)) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
      onblur: () => setTimeout(() => closeMention(), 150),
      onpaste: (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } },
    }, B.draft);
    win.replaceChildren(head,
      h('div', { class: 'aib-msgs', id: 'aib-msgs' }),
      h('div', { class: 'aib-asks', id: 'aib-asks', hidden: true }),
      h('div', { class: 'aib-compose', ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); } },
        h('div', { class: 'aib-ctx' }, h('span', { class: 'aib-eye', title: 'The AI sees which view you are on' }, `◉ ${(window.viewContext?.() || {}).label || 'Day'}`),
          B.quote ? h('span', { class: 'chip aib-quote', title: B.quote.text }, h('span', { class: 'chip-t' }, `❝ ${B.quote.text.slice(0, 80)}`), h('button', { class: 'chip-x', 'aria-label': 'Remove', onclick: () => { B.quote = null; paintBubble(); } }, '×')) : null),
        B.files.length ? h('div', { class: 'aib-files' }, B.files.map((f, i) => h('span', { class: 'aib-file' },
          f.preview ? h('img', { src: f.preview, alt: '' }) : h('span', {}, '📄'), h('span', { class: 'chip-t' }, f.name),
          h('button', { class: 'chip-x', 'aria-label': `Remove ${f.name}`, onclick: () => { B.files.splice(i, 1); paintBubble(); } }, '×')))) : null,
        h('div', { class: 'aib-row' },
          h('button', { class: 'aib-attach', title: 'Add files or images', 'aria-label': 'Add files', onclick: () => fileIn.click() }, '📎'), fileIn,
          ta,
          h('button', { class: 'btn go', disabled: B.sending, onclick: send }, B.sending ? '…' : 'Send'))));
    paintMessages();
    paintAsks();
    requestAnimationFrame(() => ta.focus());
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'j') { e.preventDefault(); $('aib-fab').click(); }
  });
  bubbleEls();
  if (PANEL_MODE === 'ai') { B.size = 'p'; openBubble('chat'); }
})();

/* Projects: your Jira epics as projects, by quarter. Left: this quarter's projects (in progress, not
   started, completed) with a quarter switcher. Right: one project's stories and tasks with deadlines and
   progress, blockers, PRs, an AI brief of the conversation around it, and an AI assistant scoped to it.
   window.openProjects(epicKey?, issueKey?) and window.openProjectFor(issueKey) are the deep links.
   Uses page globals: h, $, D, post, toast, HQ, liveFeed, itemActions, refs, ring. */
(() => {
  const OV = 'prj-ov';
  const P = { quarter: null, current: null, list: null, quarters: [], sel: null, detail: null, focus: null, filter: 'open', q: '', draft: '', timer: null, cmds: [], loading: false, error: null };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* no storage */ } return null; };
  const qLabel = (q) => (q ? `${q.slice(5)} ${q.slice(0, 4)}` : '');
  const qShift = (q, n) => { let [y, k] = q.split('-Q').map(Number); k += n; while (k > 4) { k -= 4; y++; } while (k < 1) { k += 4; y--; } return `${y}-Q${k}`; };
  const clean = (t) => String(t || '').replace(/^\s*\d{2}\s?Q[1-4]\s*[-–—:]?\s*/i, '').replace(/\s*[-–—]\s*\d{2}Q[1-4](\s*\/\s*\d{2}Q[1-4])*\s*$/i, '').trim() || t;
  const fmtDay = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
  const daysTo = (d) => (d ? Math.ceil((new Date(d.length === 10 ? `${d}T23:59:59` : d) - Date.now()) / 864e5) : null);
  const dueTxt = (d) => { const n = daysTo(d); return n == null ? '' : n < 0 ? `${-n}d late` : n === 0 ? 'due today' : `due in ${n}d`; };
  async function getJson(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); return j; }

  async function loadList(quarter, force) {
    P.loading = true; P.error = null; paint();
    try {
      const d = await getJson(`/api/projects?quarter=${quarter || ''}${force ? '&force' : ''}`);
      Object.assign(P, { quarter: d.quarter, current: d.current, list: d.projects, quarters: d.quarters, error: d.error, fetchedAt: d.fetchedAt });
      if (d.refreshing) setTimeout(() => !$(OV)?.hidden && loadList(P.quarter), 8000);
    } catch (e) { P.error = e.message; P.list = P.list || []; }
    P.loading = false;
    if (!P.sel || !P.list.some((p) => p.key === P.sel)) P.sel = P.list[0]?.key || null;
    if (P.sel && P.detail?.project?.key !== P.sel) await loadOne(P.sel, true);
    paint();
  }
  async function loadOne(key, quiet) {
    P.sel = key;
    if (!quiet) { P.detail = { loading: true }; paint(); }
    try { P.detail = await getJson(`/api/projects/one?key=${encodeURIComponent(key)}`); } catch (e) { P.detail = { error: e.message }; }
    if (!quiet) paint();
    pollChat();
  }

  window.openProjects = async (epic, issue) => {
    HQ.overlay(OV).hidden = false;
    document.documentElement.classList.add('aic-open');
    P.focus = issue || null;
    if (issue) P.filter = 'all';
    if (epic) { P.sel = epic; P.detail = { loading: true }; }
    paint();
    if (!P.list) await loadList(null);
    if (epic && !P.list.some((p) => p.key === epic)) {
      // The project lives in another quarter (e.g. finished last quarter): jump there.
      try { const one = await getJson(`/api/projects/one?key=${epic}`); if (!one.project.quarters.includes(P.quarter)) { await loadList(one.project.quarters.includes(P.current) ? P.current : one.project.quarters[one.project.quarters.length - 1]); } } catch (e) { /* not a project */ }
    }
    if (epic) await loadOne(epic);
    else if (P.sel) await loadOne(P.sel, true);
    paint();
  };
  window.openProjectFor = async (issueKey) => {
    try {
      const r = await getJson(`/api/projects/for?key=${encodeURIComponent(issueKey)}`);
      if (r.epic) return window.openProjects(r.epic, r.issue || null);
      toast(r.notMine ? `${issueKey} is under ${r.notMine}, which is not one of your projects` : `${issueKey} is not under one of your projects`);
    } catch (e) { toast(e.message); }
  };
  const close = () => { HQ.closeOverlay(OV); document.documentElement.classList.remove('aic-open'); clearTimeout(P.timer); };

  /* ---------- AI assistant (section "project", one thread per project) ---------- */
  const threadKey = () => `prj:thread:${P.sel}`;
  async function pollChat() {
    clearTimeout(P.timer);
    if ($(OV)?.hidden) return;
    try { P.cmds = (await (await fetch('/api/pings')).json()).commands || []; } catch (e) { /* restarting */ }
    const th = store(threadKey());
    const busy = P.cmds.some((c) => c.thread === th && c.running) || P.detail?.briefJob?.running;
    paintChat();
    if (P.detail?.briefJob?.running) { try { const d = await getJson(`/api/projects/one?key=${P.sel}`); const was = P.detail.briefJob.running; P.detail = d; if (was && !d.briefJob?.running) { paint(); toast(d.briefJob?.error ? `Brief failed: ${d.briefJob.error}` : 'Project brief ready'); } } catch (e) { /* keep */ } }
    P.timer = setTimeout(pollChat, busy ? 2000 : 10000);
  }
  async function send(text) {
    const t = (text || P.draft).trim();
    if (t.length < 2 || !P.detail?.project) return;
    const p = P.detail.project;
    try {
      const c = await post('/api/command', { section: 'project', text: t, thread: store(threadKey()) || null, ref: { type: 'project (Jira epic)', label: `${p.key} ${clean(p.title)}`, url: p.url, key: p.key, status: p.status, due: p.due, progress: `${p.counts.done}/${p.counts.total} done` } });
      store(threadKey(), c.thread);
      P.draft = '';
    } catch (e) { return toast(e.message); }
    paintChat();
    pollChat();
  }
  function chatBox() {
    const th = store(threadKey());
    const mine = P.cmds.filter((c) => th && c.thread === th).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const msgs = mine.length ? mine.flatMap((c) => [
      h('div', { class: 'aic-msg me' }, h('div', { class: 'aic-bub' }, c.text)),
      c.running ? liveFeed(c) : h('div', { class: `aic-msg ai ${c.error ? 'bad' : ''}` }, h('div', { class: 'aic-bub' }, c.error || c.result || 'Done.'), liveFeed(c)),
    ]) : [h('div', { class: 'aib-sugg' }, ['What is left to hit the deadline?', 'Draft a status update for this project', 'Which story should I pick up next?', 'Break down the blocked items'].map((s) => h('button', { class: 'chip', onclick: () => send(s) }, s)))];
    return h('div', { class: 'prj-chat', id: 'prj-chat' },
      h('div', { class: 'prj-msgs', id: 'prj-msgs' }, msgs),
      h('form', { class: 'prj-ask', onsubmit: (e) => { e.preventDefault(); send(); } },
        h('input', { class: 'st-in', placeholder: 'Ask or give a job about this project…', value: P.draft, oninput: (e) => (P.draft = e.target.value) }),
        th ? h('button', { type: 'button', class: 'btn ghost sm', title: 'New conversation', onclick: () => { store(threadKey(), ''); paintChat(); } }, '＋') : null,
        h('button', { class: 'btn go sm' }, 'Send')));
  }
  function paintChat() {
    const el = $('prj-chat');
    if (!el) return;
    const keep = document.activeElement?.closest?.('#prj-chat') ? document.activeElement.selectionStart : null;
    el.replaceWith(chatBox());
    const m = $('prj-msgs'); if (m) m.scrollTop = m.scrollHeight;
    if (keep != null) { const i = $('prj-chat').querySelector('input'); i.focus(); try { i.setSelectionRange(keep, keep); } catch (e) { /* */ } }
  }

  /* ---------- painting ---------- */
  function bar(p, big) {
    const c = p.counts || { total: 0 };
    if (!c.total) return h('div', { class: `prj-bar ${big ? 'big' : ''}` }, h('i', { class: 'none' }));
    const w = (n) => `${(100 * n) / c.total}%`;
    return h('div', { class: `prj-bar ${big ? 'big' : ''}`, title: `${c.done} done · ${c.doing} in progress · ${c.todo} to do` },
      h('i', { class: 'd', style: `width:${w(c.done)}` }), h('i', { class: 'p', style: `width:${w(c.doing)}` }));
  }
  function sideCard(p) {
    return h('button', { class: `prj-it ${P.sel === p.key ? 'sel' : ''}`, onclick: () => { P.focus = null; loadOne(p.key); } },
      h('div', { class: 'prj-it-t' }, h('b', {}, clean(p.title)), p.blockers ? h('span', { class: 'pill red', title: 'Blocked items' }, `⛔ ${p.blockers}`) : null),
      bar(p),
      h('small', { class: 'muted' }, [p.key, p.counts?.total ? `${p.pct}%` : 'no stories', p.category === 'done' ? `done ${fmtDay(p.resolved)}` : (p.due || p.nextDue) ? dueTxt(p.due || p.nextDue) : null, p.mineOpen ? `${p.mineOpen} yours` : null].filter(Boolean).join(' · ')));
  }
  function side() {
    const q = P.q.toLowerCase();
    const list = (P.list || []).filter((p) => !q || `${p.key} ${p.title}`.toLowerCase().includes(q));
    const grp = (label, items) => (items.length ? [h('div', { class: 'prj-grp' }, `${label} · ${items.length}`), ...items.map(sideCard)] : []);
    return h('aside', { class: 'aic-side prj-side' },
      h('div', { class: 'prj-qnav' },
        h('button', { class: 'aic-nav', 'aria-label': 'Previous quarter', onclick: () => loadList(qShift(P.quarter, -1)) }, '‹'),
        h('div', { class: 'prj-q' }, h('b', {}, qLabel(P.quarter)), h('small', { class: 'muted' }, P.quarter === P.current ? 'This quarter' : P.quarter < P.current ? 'Past quarter' : 'Upcoming')),
        h('button', { class: 'aic-nav', 'aria-label': 'Next quarter', onclick: () => loadList(qShift(P.quarter, 1)) }, '›')),
      h('div', { class: 'prj-qs' }, P.quarters.map((x) => h('button', { class: `prj-qchip ${x.q === P.quarter ? 'on' : ''}`, title: `${x.active} active, ${x.done} completed`, onclick: () => loadList(x.q) }, qLabel(x.q).replace(' 20', " '"), h('small', {}, x.done ? ` ✓${x.done}` : '')))),
      h('input', { class: 'st-in aic-search', placeholder: 'Filter projects', value: P.q, oninput: (e) => { P.q = e.target.value; paintSide(); } }),
      h('div', { class: 'aic-list', id: 'prj-list' },
        P.list == null ? h('div', { class: 'muted aic-empty' }, 'Reading your epics from Jira…')
          : list.length ? [...grp('In progress', list.filter((p) => p.category === 'indeterminate')), ...grp('Not started', list.filter((p) => p.category === 'new')), ...grp('Completed', list.filter((p) => p.category === 'done'))]
            : h('div', { class: 'muted aic-empty' }, P.error ? P.error : `No projects in ${qLabel(P.quarter)}.`)),
      h('small', { class: 'muted' }, P.loading ? 'Refreshing from Jira…' : P.fetchedAt ? `From Jira ${new Date(P.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''));
  }
  function paintSide() { const s = document.querySelector(`#${OV} .prj-side`); if (s) { const f = document.activeElement === s.querySelector('input'); s.replaceWith(side()); if (f) { const i = document.querySelector(`#${OV} .prj-side input`); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } }

  const card = (title, body, extra, cls = '') => h('section', { class: `prj-card ${cls}` }, h('div', { class: 'prj-ch' }, h('h3', {}, title), extra || null), body);
  const STATUS_CLS = { done: 'green', indeterminate: 'blue', new: '' };

  function row(i) {
    const ref = refs.jira({ ...i, title: i.title });
    return h('div', { class: `prj-row ${i.category} ${i.blocked ? 'blk' : ''} ${P.focus === i.key ? 'focus' : ''}`, id: `prj-row-${i.key}` },
      h('span', { class: 'prj-type', title: i.type }, i.subtask ? '↳' : /bug/i.test(i.type) ? '🐞' : /story/i.test(i.type) ? '▤' : '☐'),
      h('a', { class: 'link prj-key', href: i.url }, i.key),
      h('span', { class: 'prj-tt', title: i.title }, i.title),
      h('span', { class: 'prj-meta' },
        i.assignee ? h('span', { class: `prj-who ${i.mine ? 'me' : ''}`, title: i.assignee }, i.mine ? 'You' : i.assignee.split(' ')[0]) : h('span', { class: 'muted small' }, 'Unassigned'),
        i.category !== 'done' && i.due ? h('span', { class: `pill ${i.overdue ? 'red' : daysTo(i.due) <= 3 ? 'amber' : ''}`, title: i.dueFrom === 'sprint end' ? `${i.sprint} ends ${i.due}` : `Due ${i.due}` }, `${i.dueFrom === 'sprint end' ? '⏱ ' : ''}${fmtDay(i.due)}`) : null,
        i.blocked || i.overdue ? h('button', { class: 'why-badge', 'data-why-key': i.key, 'aria-label': `Why ${i.key} is blocked` }, i.blocked ? '⛔ Why?' : '⏰ Late') : null,
        h('span', { class: `pill ${STATUS_CLS[i.category]} ${i.blocked ? 'red' : ''}` }, i.status),
        itemActions('project', ref)));
  }

  function work(d) {
    const items = d.items || [];
    const F = { open: ['Open', (i) => i.category !== 'done'], mine: ['Mine', (i) => i.mine && i.category !== 'done'], blocked: ['Blocked', (i) => i.blocked || i.overdue], done: ['Done', (i) => i.category === 'done'], all: ['All', () => true] };
    const shown = items.filter(F[P.filter][1]).sort((a, b) => ({ indeterminate: 0, new: 1, done: 2 }[a.category] - { indeterminate: 0, new: 1, done: 2 }[b.category]) || (b.blocked - a.blocked) || String(a.due || '9').localeCompare(String(b.due || '9')));
    return card(`Stories and tasks`, h('div', {},
      h('div', { class: 'prj-filters' }, Object.entries(F).map(([k, [label, fn]]) => h('button', { class: `hm-rg ${P.filter === k ? 'on' : ''}`, onclick: () => { P.filter = k; paint(); } }, `${label} ${items.filter(fn).length}`))),
      shown.length ? h('div', { class: 'prj-rows' }, shown.map(row)) : h('div', { class: 'muted small prj-empty' }, items.length ? 'Nothing here.' : 'This epic has no stories yet.')), null, 'prj-span2');
  }

  function blockers(d) {
    const rule = (d.items || []).filter((i) => i.category !== 'done' && (i.blocked || i.overdue));
    const ai = d.brief?.blockers || [];
    if (!rule.length && !ai.length) return card('Blockers', h('div', { class: 'muted small' }, 'Nothing blocked or late in Jira.', d.brief ? '' : ' Build the AI brief to also check Slack and meetings.'));
    return card('Blockers', h('ul', { class: 'prj-list' },
      rule.map((i) => h('li', {}, h('button', { class: 'linkbtn', onclick: () => { P.focus = i.key; P.filter = 'all'; paint(); } }, i.key), ' ', i.title, ' ', h('button', { class: 'why-badge', 'data-why-key': i.key }, 'Why?'), h('small', { class: 'muted' }, ` · ${[...i.why, i.overdue ? `${dueTxt(i.due)}` : null].filter(Boolean).join(' · ')}`))),
      ai.map((b) => h('li', {}, b.url ? h('a', { class: 'link', href: b.url }, b.key || '↗') : b.key ? h('b', {}, b.key) : null, ' ', b.text, b.owner ? h('small', { class: 'muted' }, ` · ${b.owner}`) : null, h('span', { class: 'pill violet sm-pill' }, 'AI')))));
  }

  function brief(d) {
    const b = d.brief, job = d.briefJob;
    const btn = h('button', { class: 'btn sm', disabled: job?.running, title: 'Reads Slack, meetings, email, docs and Jira comments about this project. Read-only.', onclick: async () => { try { d.briefJob = await post('/api/projects/brief', { key: d.project.key }); paint(); pollChat(); } catch (e) { toast(e.message); } } }, job?.running ? 'Reading…' : b ? '↻ Refresh' : '✦ Build brief');
    if (!b) return card('AI brief', h('div', { class: 'muted small' }, job?.running ? h('span', { class: 'pulse' }, '✦ Reading Slack, meetings, email, docs and Jira about this project…') : job?.error ? h('span', { class: 'blocked' }, job.error) : 'Where it stands, what was decided, what is next, and the conversation around it. Read-only.'), btn, 'prj-span2');
    const hc = { 'on track': 'green', 'at risk': 'amber', 'off track': 'red' }[b.health] || '';
    return card('AI brief', h('div', { class: 'prj-brief' },
      h('p', {}, b.health ? h('span', { class: `pill ${hc}` }, b.health) : null, ' ', b.summary),
      b.healthWhy ? h('small', { class: 'muted' }, b.healthWhy) : null,
      b.next?.length ? h('div', {}, h('div', { class: 'prj-sub' }, 'Next steps'), h('ol', { class: 'prj-list' }, b.next.map((n) => h('li', {}, n.text, n.key ? [' ', h('button', { class: 'linkbtn', onclick: () => { P.focus = n.key; P.filter = 'all'; paint(); } }, n.key)] : null)))) : null,
      b.decisions?.length ? h('div', {}, h('div', { class: 'prj-sub' }, 'Decisions'), h('ul', { class: 'prj-list' }, b.decisions.map((x) => h('li', {}, x.text, x.when ? h('small', { class: 'muted' }, ` · ${fmtDay(x.when)}`) : null, x.url ? [' ', h('a', { class: 'link', href: x.url }, '↗')] : null)))) : null,
      b.risks?.length ? h('div', {}, h('div', { class: 'prj-sub' }, 'Risks'), h('ul', { class: 'prj-list' }, b.risks.map((x) => h('li', {}, x)))) : null,
      h('small', { class: 'muted' }, `Built ${new Date(b.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${job?.running ? ' · refreshing…' : ''}`)), btn, 'prj-span2');
  }

  const SRC = { slack: '💬', meeting: '🎙', email: '✉', doc: '📄', jira: '🎫', github: '⎇' };
  function comms(d) {
    const c = d.brief?.comms || [];
    return card('Communication', c.length ? h('ul', { class: 'prj-comms' }, c.map((m) => h('li', {},
      h('span', { class: 'prj-src', title: m.source }, SRC[m.source] || '•'),
      h('div', {}, h('div', {}, m.url ? h('a', { class: 'link', href: m.url }, m.title || m.source) : h('b', {}, m.title || m.source), h('small', { class: 'muted' }, [m.who, fmtDay(m.when)].filter(Boolean).map((x) => ` · ${x}`).join(''))), h('small', {}, m.snippet)))))
      : h('div', { class: 'muted small' }, d.brief ? 'No recent conversation found.' : 'Build the AI brief to pull in Slack threads, meetings and email about this project.'));
  }
  function prs(d) {
    const list = d.prs || [];
    return card('Pull requests', list.length ? h('ul', { class: 'prj-list' }, list.slice(0, 12).map((p) => h('li', {},
      h('span', { class: `pill ${p.state === 'merged' ? 'violet' : p.state === 'open' ? (p.draft ? '' : 'green') : ''}` }, p.draft ? 'draft' : p.state), ' ',
      h('a', { class: 'link', href: p.url }, p.title), h('small', { class: 'muted' }, ` · ${p.repo?.split('/')[1]} #${p.number}`))))
      : h('div', { class: 'muted small' }, 'None of your PRs mention this project’s keys.'));
  }

  function main() {
    const d = P.detail;
    if (!d || d.loading) return h('div', { class: 'aic-main aic-blank' }, h('div', { class: 'muted' }, P.list && !P.list.length ? 'Pick a quarter with projects.' : 'Loading project…'));
    if (d.error) return h('div', { class: 'aic-main aic-blank' }, h('div', { class: 'blocked' }, d.error));
    const p = d.project;
    const qEnd = P.quarter ? daysTo(new Date(Number(P.quarter.slice(0, 4)), Number(P.quarter.slice(6)) * 3, 0).toISOString().slice(0, 10)) : null;
    const due = p.due || p.nextDue;
    const tile = (n, label, cls, onclick) => h('button', { class: `prj-tile ${cls || ''}`, onclick }, h('b', {}, n), h('small', {}, label));
    const go = (f) => () => { P.filter = f; paint(); };
    return h('div', { class: 'aic-main prj-main' }, h('div', { class: 'prj-scroll' }, h('div', { class: 'prj-wrap' },
      h('div', { class: 'prj-hero' },
        h('div', { class: 'prj-ring' }, p.counts.total ? ring(p.counts.done, p.counts.total) : h('span', { class: 'badge' }, '–'), h('b', {}, p.pct != null ? `${p.pct}%` : '—')),
        h('div', { class: 'prj-ht' },
          h('h1', {}, clean(p.title)),
          h('div', { class: 'prj-hm' },
            h('a', { class: 'link', href: p.url }, `${p.key} ↗`),
            h('span', { class: `pill ${STATUS_CLS[p.category]}` }, p.status),
            d.brief?.health ? h('span', { class: `pill ${{ 'on track': 'green', 'at risk': 'amber', 'off track': 'red' }[d.brief.health] || ''}` }, d.brief.health) : null,
            p.category === 'done' ? h('span', { class: 'muted small' }, `Completed ${fmtDay(p.resolved)}`)
              : h('span', { class: 'muted small' }, [due ? `${p.due ? 'Due' : 'Next deadline'} ${fmtDay(due)} (${dueTxt(due)})` : 'No deadline set', qEnd != null && P.quarter === P.current ? `quarter ends in ${qEnd}d` : null].filter(Boolean).join(' · '))),
          bar(p, true))),
      h('div', { class: 'prj-tiles' },
        tile(p.counts.done, 'done', 'g', go('done')), tile(p.counts.doing, 'in progress', 'b', go('open')), tile(p.counts.todo, 'to do', '', go('open')),
        tile(p.blockers, 'blocked', p.blockers ? 'r' : '', go('blocked')), tile(p.overdue, 'late', p.overdue ? 'r' : '', go('blocked')), tile(p.mineOpen, 'yours open', 'v', go('mine'))),
      h('div', { class: 'prj-grid' },
        work(d),
        h('div', { class: 'prj-col' }, blockers(d), card('AI assistant', chatBox(), h('span', { class: 'muted small' }, D?.config?.engine || '')), prs(d)),
        brief(d), comms(d)))));
  }

  function paint() {
    const ov = $(OV);
    if (!ov || ov.hidden) return;
    const keep = document.querySelector(`#${OV} .prj-scroll`)?.scrollTop;
    ov.replaceChildren(h('div', { class: 'aic-box', role: 'dialog', 'aria-label': 'Projects' },
      h('header', { class: 'aic-head' }, h('h2', { class: 'vh' }, window.icon ? window.icon('projects') : null, 'Projects'),
        h('span', { class: 'muted small' }, P.list ? `${P.list.filter((p) => p.category !== 'done').length} active · ${P.list.filter((p) => p.category === 'done').length} completed in ${qLabel(P.quarter)}` : ''),
        h('span', { class: 'st-gap' }),
        P.quarter && P.quarter !== P.current ? h('button', { class: 'btn ghost', onclick: () => loadList(P.current) }, 'This quarter') : null,
        h('button', { class: 'btn ghost', title: 'Read Jira again', disabled: P.loading, onclick: () => loadList(P.quarter, true) }, '↻'),
        h('button', { class: 'btn', onclick: close }, 'Close')),
      h('div', { class: 'aic-body' }, side(), main())));
    const sc = document.querySelector(`#${OV} .prj-scroll`);
    if (P.focus && $(`prj-row-${P.focus}`)) { $(`prj-row-${P.focus}`).scrollIntoView({ block: 'center' }); }
    else if (sc && keep) sc.scrollTop = keep;
    const m = $('prj-msgs'); if (m) m.scrollTop = m.scrollHeight;
  }

  // For the blocked-item tooltip: what this view already knows about an item.
  window.PROJECT_ITEMS = (key) => (P.detail?.items || []).find((i) => i.key === key) || null;
  window.HQ_VIEWCTX = window.HQ_VIEWCTX || {};
  window.HQ_VIEWCTX[OV] = () => {
    const p = P.detail?.project;
    return {
      label: p ? `Projects · ${p.key}` : `Projects · ${qLabel(P.quarter)}`, quarter: P.quarter,
      project: p ? { key: p.key, title: p.title, url: p.url, status: p.status, due: p.due, progress: `${p.counts?.done}/${p.counts?.total} done`, blockers: p.blockers } : null,
      focusIssue: P.focus || null, dataFiles: p ? { brief: `projects/brief-${p.key}.json`, notes: 'notes.md' } : undefined,
      suggest: p ? ['What is left to hit the deadline?', 'Draft a status update for this project', 'This blocker is resolved: update the brief'] : undefined,
    };
  };
  window.addEventListener('hq:changed', () => { if ($(OV) && !$(OV).hidden && P.sel) loadOne(P.sel, false); });
  window.HQ_ASK = window.HQ_ASK || {};
  window.HQ_ASK.project = (ref, prefill) => {
    P.draft = prefill ?? `About ${ref.label}: `;
    paintChat();
    const i = document.querySelector('#prj-chat input');
    if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $(OV) && !$(OV).hidden) close(); });
  HQ.addButton({ id: 'btn-projects', label: '◫ Projects', title: 'Projects: your Jira epics by quarter', onclick: () => window.openProjects() });
})();

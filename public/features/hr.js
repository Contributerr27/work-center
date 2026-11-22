/* Growth & HR: self-reflection and HR paperwork in one place. Overview (score, trend, coach chat),
   Self-review (written from your real work, copy-paste per answer), Feedback & score (from your work and
   your manager conversations), Org chart, and Settings (manager, review questions, rating scale, focus).
   Uses page globals: h, $, D, post, toast, HQ, liveFeed, ring. */
(() => {
  const OV = 'hr-ov';
  const S = { tab: 'overview', data: null, review: null, reviewKey: null, period: 'year', timer: null, cmds: [], draft: '' };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* */ } return null; };
  const fmt = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const PERIODS = [['year', 'This year so far'], ['h2', 'Second half (H2)'], ['h1', 'First half (H1)'], ['quarter', 'This quarter'], ['lastq', 'Last quarter'], ['last12', 'Last 12 months'], ['lastyear', 'Last year']];
  async function getJson(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); return j; }

  async function load() {
    try { S.data = await getJson('/api/hr'); } catch (e) { S.data = { error: e.message }; }
    if (!S.reviewKey && S.data.reviews?.length) S.reviewKey = S.data.reviews[0].key;
    if (S.reviewKey && S.review?.period?.key !== S.reviewKey) { try { S.review = await getJson(`/api/hr/review?key=${S.reviewKey}`); } catch (e) { S.review = null; } }
    paint();
    poll();
  }
  async function poll() {
    clearTimeout(S.timer);
    if ($(OV)?.hidden) return;
    const running = Object.values(S.data?.jobs || {}).some((j) => j.running);
    try { S.cmds = (await (await fetch('/api/pings')).json()).commands || []; } catch (e) { /* */ }
    const chatBusy = S.cmds.some((c) => c.thread === store('hr:thread') && c.running);
    paintChat();
    S.timer = setTimeout(async () => {
      if (running) {
        const before = S.data?.jobs || {};
        S.data = await getJson('/api/hr').catch(() => S.data);
        for (const [id, j] of Object.entries(S.data.jobs || {})) if (before[id]?.running && !j.running) {
          toast(j.error ? `Failed: ${j.error}` : 'Ready');
          if (id.startsWith('review-')) { S.reviewKey = id.slice(7); S.review = null; }
        }
        if (S.reviewKey && !S.review) { try { S.review = await getJson(`/api/hr/review?key=${S.reviewKey}`); } catch (e) { /* */ } }
        paint();
      }
      poll();
    }, running || chatBusy ? 3000 : 12000);
  }
  async function start(kind, period) {
    try { await post('/api/hr/run', { kind, period }); toast(kind === 'review' ? 'Writing your review… gathering the facts first' : kind === 'org' ? 'Mapping the org…' : 'Reading your work and manager conversations…'); } catch (e) { return toast(e.message); }
    await load();
  }
  const job = (id) => S.data?.jobs?.[id];

  window.openHR = (tab) => {
    if (tab) S.tab = tab;
    HQ.overlay(OV).hidden = false;
    document.documentElement.classList.add('aic-open');
    paint();
    load();
  };
  const close = () => { HQ.closeOverlay(OV); document.documentElement.classList.remove('aic-open'); clearTimeout(S.timer); };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = h('textarea', {}, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast('Copied');
  }

  const card = (title, body, extra, cls = '') => h('section', { class: `prj-card ${cls}` }, h('div', { class: 'prj-ch' }, h('h3', {}, title), extra || null), body);
  const running = (id, label) => (job(id)?.running ? h('div', { class: 'muted small pulse' }, `✦ ${label}… this takes a few minutes; you can close this view.`) : job(id)?.error ? h('div', { class: 'blocked' }, job(id).error) : null);
  const scoreCls = (n) => (n >= 75 ? 'g' : n >= 55 ? 'a' : 'r');

  /* ---------- coach chat (section "hr") ---------- */
  async function send(text) {
    const t = (text || S.draft).trim();
    if (t.length < 2) return;
    try {
      const c = await post('/api/command', { section: 'hr', text: `${t}\n\n(Coaching question from the Growth & HR view: use their latest feedback, org chart, work history and manager conversations. Read-only.)`, thread: store('hr:thread') || null });
      store('hr:thread', c.thread); S.draft = '';
    } catch (e) { return toast(e.message); }
    paintChat(); poll();
  }
  function chatBox() {
    const th = store('hr:thread');
    const mine = S.cmds.filter((c) => th && c.thread === th).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const strip = (t) => String(t || '').replace(/\n\n\(Coaching question[\s\S]*$/, '');
    return h('div', { class: 'prj-chat', id: 'hr-chat' },
      h('div', { class: 'prj-msgs', id: 'hr-msgs' }, mine.length ? mine.flatMap((c) => [
        h('div', { class: 'aic-msg me' }, h('div', { class: 'aic-bub' }, strip(c.text))),
        c.running ? liveFeed(c) : h('div', { class: `aic-msg ai ${c.error ? 'bad' : ''}` }, h('div', { class: 'aic-bub' }, c.error || c.result || 'Done.')),
      ]) : h('div', { class: 'aib-sugg' }, ['Prep talking points for my next 1:1', 'What would get me to the next level?', 'What feedback should I ask my manager for?', 'Turn my last month into 3 wins'].map((s) => h('button', { class: 'chip', onclick: () => send(s) }, s)))),
      h('form', { class: 'prj-ask', onsubmit: (e) => { e.preventDefault(); send(); } },
        h('input', { class: 'st-in', placeholder: 'Ask your coach…', value: S.draft, oninput: (e) => (S.draft = e.target.value) }),
        th ? h('button', { type: 'button', class: 'btn ghost sm', title: 'New conversation', onclick: () => { store('hr:thread', ''); paintChat(); } }, '＋') : null,
        h('button', { class: 'btn go sm' }, 'Send')));
  }
  function paintChat() {
    const el = $('hr-chat');
    if (!el) return;
    const focused = document.activeElement?.closest?.('#hr-chat');
    el.replaceWith(chatBox());
    const m = $('hr-msgs'); if (m) m.scrollTop = m.scrollHeight;
    if (focused) $('hr-chat').querySelector('input').focus();
  }

  /* ---------- tabs ---------- */
  function spark(history) {
    if (!history?.length) return null;
    const pts = history.slice(-12);
    const W = 220, Hh = 48, max = 100;
    const xy = pts.map((p, i) => [pts.length === 1 ? W / 2 : (i * W) / (pts.length - 1), Hh - (Hh * (p.score || 0)) / max]);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `-4 -4 ${W + 8} ${Hh + 8}`); svg.setAttribute('class', 'hr-spark'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Score history: ${pts.map((p) => p.score).join(', ')}`);
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', xy.map((p) => p.join(',')).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'var(--blue)'); line.setAttribute('stroke-width', '2.5'); line.setAttribute('stroke-linejoin', 'round');
    svg.append(line);
    xy.forEach(([x, y], i) => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 3.5); c.setAttribute('fill', 'var(--blue)'); const t = document.createElementNS(ns, 'title'); t.textContent = `${pts[i].date}: ${pts[i].score}`; c.append(t); svg.append(c); });
    return svg;
  }

  function overview() {
    const d = S.data, f = d.feedback, o = d.org;
    return h('div', { class: 'hr-grid' },
      card('Your score', f ? h('div', { class: 'hr-score' },
        h('div', { class: `hr-big ${scoreCls(f.score)}` }, h('b', {}, f.score), h('small', {}, '/ 100')),
        h('div', {}, h('p', {}, f.summary), h('small', { class: 'muted' }, `${f.scoreWhy || ''} · ${fmt(f.generatedAt)}`), spark(d.history)))
        : h('div', {}, running('feedback', 'Reading your work and manager conversations') || h('p', { class: 'muted' }, 'No score yet. It reads your Jira and GitHub work and your conversations with your manager (meeting notes, Slack), then scores seven areas and suggests what to improve.')),
      h('button', { class: 'btn sm', disabled: job('feedback')?.running, onclick: () => start('feedback') }, job('feedback')?.running ? 'Working…' : f ? '↻ Refresh' : '✦ Get feedback'), 'prj-span2'),
      card('Coach', chatBox(), h('span', { class: 'muted small' }, 'Private to you')),
      card('Work on next', f?.improvements?.length ? h('ul', { class: 'prj-list' }, f.improvements.slice(0, 4).map((x) => h('li', {}, h('b', {}, x.area), ': ', x.try))) : h('div', { class: 'muted small' }, 'Suggestions show up after the first feedback run.')),
      card('Where you stand', h('div', { class: 'hr-facts' },
        h('div', {}, h('small', { class: 'muted' }, 'Manager'), h('b', {}, d.manager || '—')),
        h('div', {}, h('small', { class: 'muted' }, 'Team'), h('b', {}, o?.me?.team || '—')),
        h('div', {}, h('small', { class: 'muted' }, 'Title'), h('b', {}, o?.me?.title || '—')),
        h('div', {}, h('small', { class: 'muted' }, 'Latest review'), d.reviews?.[0] ? h('button', { class: 'linkbtn', onclick: () => { S.tab = 'review'; S.reviewKey = d.reviews[0].key; S.review = null; load(); } }, d.reviews[0].label) : h('b', {}, '—'))),
        h('button', { class: 'linkbtn', onclick: () => { S.tab = 'org'; paint(); } }, 'Org chart')));
  }

  function reviewTab() {
    const d = S.data, r = S.review, key = PERIODS.find((p) => p[0] === S.period);
    const all = r ? [`${r.period?.label} self-review`, '', r.summary, '', ...(r.answers || []).flatMap((a) => [a.question, a.answer, ''])].join('\n') : '';
    return h('div', { class: 'hr-col' },
      card('Write a self-review', h('div', { class: 'hr-row' },
        h('select', { class: 'st-in', onchange: (e) => (S.period = e.target.value) }, PERIODS.map(([v, l]) => h('option', { value: v, selected: v === S.period }, l))),
        h('button', { class: 'btn go', onclick: () => start('review', S.period) }, '✦ Write it'),
        h('span', { class: 'muted small' }, 'Pulls your Jira, GitHub, work log, Slack and meeting notes for the period, then answers your company’s questions (Settings tab).'),
        ...Object.entries(d.jobs || {}).filter(([id, j]) => id.startsWith('review-') && j.running).map(([id]) => h('div', { class: 'muted small pulse' }, `✦ Writing ${id.slice(7)}…`)),
        d.reviews?.length ? h('div', { class: 'hr-saved' }, h('small', { class: 'muted' }, 'Saved:'), d.reviews.map((x) => h('button', { class: `prj-qchip ${x.key === S.reviewKey ? 'on' : ''}`, onclick: async () => { S.reviewKey = x.key; S.review = await getJson(`/api/hr/review?key=${x.key}`).catch(() => null); paint(); } }, x.label))) : null)),
      r ? card(`${r.period?.label} · ${r.headline || ''}`, h('div', { class: 'hr-review' },
        h('p', {}, r.summary),
        r.metrics?.length ? h('div', { class: 'hr-metrics' }, r.metrics.map((m) => h('div', {}, h('b', {}, m.value), h('small', {}, m.label)))) : null,
        (r.answers || []).map((a) => h('div', { class: 'hr-ans' },
          h('div', { class: 'hr-q' }, h('b', {}, a.question), h('button', { class: 'btn sm ghost', onclick: () => copy(a.answer) }, 'Copy')),
          h('p', {}, a.answer))),
        r.accomplishments?.length ? h('div', {}, h('div', { class: 'prj-sub' }, 'Accomplishments'), h('ol', { class: 'prj-list' }, r.accomplishments.map((x) => h('li', {}, h('b', {}, x.title), ` — ${x.impact} `, (x.evidence || []).filter((e) => e.url).map((e) => h('a', { class: 'link hr-ev', href: e.url }, e.label || '↗')))))) : null,
        r.growth?.length ? h('div', {}, h('div', { class: 'prj-sub' }, 'Growth'), h('ul', { class: 'prj-list' }, r.growth.map((x) => h('li', {}, x)))) : null,
        r.goals?.length ? h('div', {}, h('div', { class: 'prj-sub' }, 'Goals'), h('ul', { class: 'prj-list' }, r.goals.map((x) => h('li', {}, x)))) : null,
        r.selfRating?.value ? h('div', {}, h('div', { class: 'prj-sub' }, 'Suggested self-rating'), h('p', {}, h('b', {}, r.selfRating.value), ` — ${r.selfRating.why}`)) : null,
        h('small', { class: 'muted' }, `Written ${fmt(r.generatedAt)} from ${r.facts?.prsMerged?.total ?? '?'} merged PRs, ${r.facts?.jiraResolved?.total ?? '?'} resolved Jira items${r.facts?.errors?.length ? ` · missing: ${r.facts.errors.join('; ')}` : ''}`)),
      h('button', { class: 'btn sm', onclick: () => copy(all) }, 'Copy all')) : !d.reviews?.length ? card('No review yet', h('div', { class: 'muted small' }, `Pick a period and press Write it. ${key ? '' : ''}`)) : null);
  }

  function feedbackTab() {
    const f = S.data.feedback;
    const head = h('button', { class: 'btn sm', disabled: job('feedback')?.running, onclick: () => start('feedback') }, job('feedback')?.running ? 'Working…' : f ? '↻ Refresh' : '✦ Get feedback');
    if (!f) return card('Feedback & score', running('feedback', 'Reading your work and manager conversations') || h('p', { class: 'muted' }, 'Reads 90 days of your work and your conversations with your manager, scores seven areas, and suggests concrete improvements. Nothing is shared.'), head);
    const arrow = { up: '↑', down: '↓', flat: '→', new: '•' };
    const sent = { positive: 'green', neutral: '', concern: 'amber' };
    return h('div', { class: 'hr-grid' },
      card('Score', h('div', { class: 'hr-score' },
        h('div', { class: `hr-big ${scoreCls(f.score)}` }, h('b', {}, f.score), h('small', {}, '/ 100')),
        h('div', {}, h('p', {}, f.summary), h('small', { class: 'muted' }, `${f.scoreWhy || ''} · window ${fmt(f.window?.from)} – ${fmt(f.window?.to)}`), spark(S.data.history))), head, 'prj-span2'),
      card('By area', h('div', { class: 'hr-dims' }, (f.dimensions || []).map((x) => h('div', { class: 'hr-dim' },
        h('div', { class: 'hr-dim-h' }, h('b', {}, x.name), h('span', { class: 'muted small', title: `Trend: ${x.trend}` }, arrow[x.trend] || ''), h('span', { class: 'hr-dots', 'aria-label': `${x.score} of 5` }, [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= x.score ? 'on' : '' })))),
        h('small', { class: 'muted' }, x.evidence))))),
      card('Strengths', h('ul', { class: 'prj-list' }, (f.strengths || []).map((x) => h('li', {}, h('b', {}, x.text), x.evidence ? h('small', { class: 'muted' }, ` — ${x.evidence}`) : null)))),
      card('Improve', h('div', { class: 'hr-imps' }, (f.improvements || []).map((x) => h('div', { class: 'hr-imp' }, h('b', {}, x.area), h('small', { class: 'muted' }, x.why), h('div', {}, '→ ', x.try)))), null, 'prj-span2'),
      card('What your manager said', (f.managerSignals || []).length ? h('ul', { class: 'prj-comms' }, f.managerSignals.map((m) => h('li', {},
        h('span', { class: `pill ${sent[m.sentiment] || ''}` }, m.sentiment || '•'),
        h('div', {}, h('div', {}, m.url ? h('a', { class: 'link', href: m.url }, m.title) : h('b', {}, m.title), h('small', { class: 'muted' }, ` · ${fmt(m.date)}`)), h('small', {}, m.said)))))
        : h('div', { class: 'muted small' }, 'No manager conversations found. Check that your meeting notes tool (e.g. Granola) is connected in Settings.'), null, 'prj-span2'),
      f.themes?.length ? card('Themes', h('ul', { class: 'prj-list' }, f.themes.map((x) => h('li', {}, x)))) : null,
      f.nextActions?.length ? card('Next actions', h('ul', { class: 'prj-list' }, f.nextActions.map((x) => h('li', {}, x.text, x.by ? h('small', { class: 'muted' }, ` · by ${fmt(x.by)}`) : null)))) : null);
  }

  function person(p, cls = '') {
    if (!p?.name) return null;
    return h('div', { class: `hr-p ${cls} ${p.guess ? 'guess' : ''}`, title: p.guess ? 'Inferred' : '' }, h('span', { class: 'hr-av', style: `background:hsl(${[...p.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)` }, p.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('')), h('div', {}, h('b', {}, p.name), h('small', { class: 'muted' }, p.title || '')));
  }
  function orgTab() {
    const o = S.data.org;
    const btn = h('button', { class: 'btn sm', disabled: job('org')?.running, onclick: () => start('org') }, job('org')?.running ? 'Mapping…' : o ? '↻ Rebuild' : '✦ Build org chart');
    if (!o) return card('Org chart', running('org', 'Mapping the org from Slack profiles, docs and calendars') || h('p', { class: 'muted' }, 'Builds your reporting line, peers, reports and teams from Slack profiles, org docs and calendars.'), btn);
    return h('div', { class: 'hr-col' },
      card('Reporting line', h('div', { class: 'hr-org' },
        (o.chain || []).filter((p) => p.name && p.name !== o.manager?.name && p.name !== o.me?.name).flatMap((p) => [person(p), h('div', { class: 'hr-ln' })]),
        person(o.manager), h('div', { class: 'hr-ln' }),
        h('div', { class: 'hr-lvl' }, person({ ...o.me, name: o.me?.name || D?.config?.owner }, 'me'), (o.peers || []).slice(0, 10).map((p) => person(p))),
        o.reports?.length ? [h('div', { class: 'hr-ln' }), h('div', { class: 'hr-lvl' }, o.reports.map((p) => person(p)))] : null,
        o.summary ? h('small', { class: 'muted' }, o.summary) : null,
        h('small', { class: 'muted', title: (o.sources || []).join('\n') }, `Built ${fmt(o.generatedAt)}${o.sources?.length ? ` from ${o.sources.length} source${o.sources.length === 1 ? '' : 's'} (hover)` : ''}. Dashed = inferred.`)), btn),
      o.teams?.length ? card('Teams', h('div', { class: 'hr-teams' }, o.teams.map((t) => h('div', { class: 'hr-team' }, h('b', {}, t.name), t.lead ? h('small', { class: 'muted' }, `Lead: ${t.lead}`) : null, h('div', { class: 'hr-members' }, (t.members || []).map((p) => person(p))))))) : null);
  }

  function settingsTab() {
    const s = S.data.settings;
    const v = { manager: s.manager, focus: s.focus, ratingScale: s.ratingScale, q: (s.reviewQuestions || []).join('\n') };
    const field = (label, el, hint) => h('label', { class: 'hr-field' }, h('b', {}, label), el, hint ? h('small', { class: 'muted' }, hint) : null);
    return card('HR settings', h('form', { class: 'hr-form', onsubmit: async (e) => {
      e.preventDefault();
      const qs = v.q.split('\n').map((x) => x.trim()).filter(Boolean);
      try { await post('/api/settings', { patch: { hr: { manager: v.manager.trim(), focus: v.focus.trim(), ratingScale: v.ratingScale.trim(), reviewQuestions: qs } } }); toast('Saved'); load(); } catch (err) { toast(err.message); }
    } },
      field('Manager', h('input', { class: 'st-in', value: v.manager, placeholder: S.data.org?.manager?.name || 'Their full name', oninput: (e) => (v.manager = e.target.value) }), 'Used to find your 1:1s and feedback. Leave empty to use the org chart.'),
      field('Review questions', h('textarea', { class: 'st-in st-area', rows: 7, placeholder: S.data.defaultQuestions.join('\n'), oninput: (e) => (v.q = e.target.value) }, v.q), 'One per line, copied from your company’s review form. Empty = the general questions shown.'),
      field('Rating scale', h('input', { class: 'st-in', value: v.ratingScale, placeholder: 'e.g. Below / Meets / Exceeds / Greatly exceeds', oninput: (e) => (v.ratingScale = e.target.value) }), 'If your company rates, the review suggests one with reasons.'),
      field('What you are working on', h('textarea', { class: 'st-in st-area', rows: 3, placeholder: 'e.g. Growing into a staff role; more cross-team influence', oninput: (e) => (v.focus = e.target.value) }, v.focus), 'Feedback and reviews weigh this.'),
      h('div', {}, h('button', { class: 'btn go' }, 'Save'))));
  }

  function paint() {
    const ov = $(OV);
    if (!ov || ov.hidden) return;
    const d = S.data;
    const tabs = [['overview', 'Overview'], ['review', 'Self-review'], ['feedback', 'Feedback & score'], ['org', 'Org chart'], ['settings', 'Settings']];
    const keep = document.querySelector(`#${OV} .prj-scroll`)?.scrollTop;
    ov.replaceChildren(h('div', { class: 'aic-box', role: 'dialog', 'aria-label': 'Growth and HR' },
      h('header', { class: 'aic-head' }, h('h2', { class: 'vh' }, window.icon ? window.icon('growth') : null, 'Growth & HR'),
        h('nav', { class: 'aib-modes hr-tabs' }, tabs.map(([id, label]) => h('button', { class: `aib-mode ${S.tab === id ? 'on' : ''}`, onclick: () => { S.tab = id; paint(); } }, label))),
        h('span', { class: 'st-gap' }), h('span', { class: 'muted small' }, 'Stays on this computer'), h('button', { class: 'btn', onclick: close }, 'Close')),
      h('div', { class: 'prj-scroll' }, h('div', { class: 'prj-wrap' },
        !d ? h('div', { class: 'muted' }, 'Loading…') : d.error ? h('div', { class: 'blocked' }, d.error)
          : { overview, review: reviewTab, feedback: feedbackTab, org: orgTab, settings: settingsTab }[S.tab]()))));
    const sc = document.querySelector(`#${OV} .prj-scroll`); if (sc && keep) sc.scrollTop = keep;
    const m = $('hr-msgs'); if (m) m.scrollTop = m.scrollHeight;
  }

  // For the AI bubble: which tab and which files back what is on screen.
  window.HQ_VIEWCTX = window.HQ_VIEWCTX || {};
  window.HQ_VIEWCTX[OV] = () => {
    const tabName = { overview: 'Overview', review: 'Self-review', feedback: 'Feedback & score', org: 'Org chart', settings: 'Settings' }[S.tab];
    const fb = S.data?.feedback?.window?.to;
    return {
      label: `Growth & HR · ${tabName}${S.tab === 'review' && S.review ? ` ${S.review.period?.label}` : ''}`, tab: tabName,
      dataFiles: { orgChart: 'hr/org.json', review: S.review ? `hr/review-${S.review.period?.key}.json` : null, feedback: fb ? `hr/feedback/${fb}.json` : null, notes: 'notes.md' },
      review: S.tab === 'review' && S.review ? { period: S.review.period?.label, headline: S.review.headline } : undefined,
      suggest: S.tab === 'org' ? ['Someone left the company: update the org chart', 'Fix a title or reporting line'] : S.tab === 'review' ? ['I can add context to a concern in my review', 'Make the impact answer more specific'] : S.tab === 'feedback' ? ['Here is context on a concern my manager raised', 'How do I raise my lowest area?'] : ['Prep talking points for my next 1:1', 'What would get me to the next level?'],
    };
  };
  // After the AI changes HR data (bubble or coach), show the new version.
  window.addEventListener('hq:changed', () => { if ($(OV) && !$(OV).hidden) { S.review = null; load(); } });
  window.HQ_ASK = window.HQ_ASK || {};
  window.HQ_ASK.hr = (ref, prefill) => { S.tab = 'overview'; S.draft = prefill ?? `About ${ref.label}: `; paint(); $('hr-chat')?.querySelector('input')?.focus(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $(OV) && !$(OV).hidden) close(); });
  HQ.addButton({ id: 'btn-hr', label: '🧭 Growth', title: 'Growth & HR: self-review, feedback and score, org chart', onclick: () => window.openHR() });
})();

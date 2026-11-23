/* Home: the long view. Streak and rank, today at a glance with one click into today's missions,
   this month's numbers, a 18-week activity map (click a day to open it in the AI Center), what the
   AI got done, recent wins, upcoming meetings, open tasks and connection health.
   Uses page globals: h, $, D, toast, HQ, FLOW, current, counts, stepState, render. */
(() => {
  const OV = 'home-ov';
  let H = null, stats = null, setupInfo = null, range = 'month', PJ = null;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const STAT = [['prsOpened', 'PRs opened'], ['prsMerged', 'PRs merged'], ['reviews', 'Reviews'], ['storiesDone', 'Stories done'], ['bugsFiled', 'Bugs filed'], ['aiCommands', 'AI jobs'], ['focusBlocks', 'Focus blocks'], ['cleared', 'Items cleared']];
  const ACT = { approved: 'PRs approved', merged: 'PRs merged', commented: 'Jira comments', moved: 'Tickets moved', sent: 'Replies sent', rsvp: 'Invites answered' };

  async function fetchAll() {
    const j = (u) => fetch(u).then((r) => r.json()).catch(() => null);
    // Each card paints as soon as its own data lands; the server answers from its cache, so a slow
    // source only delays its card. Cached numbers that are being refreshed are fetched once more.
    const isOpen = () => !HQ.overlay(OV).hidden;
    j('/api/home').then((x) => { H = x; paint(); });
    const getStats = (again) => j(`/api/stats?range=${range}`).then((x) => { stats = x; paint(); if (again && x?.refreshing) setTimeout(() => isOpen() && getStats(false), 6000); });
    getStats(true);
    if (!setupInfo) j('/api/setup').then((x) => { setupInfo = x; paint(); });
    const getProjects = (again) => j('/api/projects').then((x) => { PJ = x; paint(); if (again && x?.refreshing) setTimeout(() => isOpen() && getProjects(false), 8000); });
    getProjects(true);
  }

  window.openHome = () => {
    HQ.overlay(OV).hidden = false;
    document.documentElement.classList.add('aic-open');
    paint();
    fetchAll();
  };
  const close = () => { HQ.closeOverlay(OV); document.documentElement.classList.remove('aic-open'); };
  const goToday = () => { close(); try { const c = current(); const s = FLOW.find((x) => x.id === c); if (s) $(s.sec).scrollIntoView({ behavior: 'smooth' }); } catch (e) { /* flow not ready */ } };

  function card(title, body, extra, cls = '') {
    return h('section', { class: `hm-card ${cls}` }, h('div', { class: 'hm-ch' }, h('h3', {}, title), extra || null), body);
  }

  function hero() {
    const hr = new Date().getHours();
    const name = (D?.config?.owner || '').split(' ')[0];
    const left = FLOW.filter((s) => stepState(s.id) !== 'done').length;
    const cur = FLOW.find((s) => s.id === current());
    return h('div', { class: 'hm-hero' },
      h('div', { class: 'hm-hello' },
        h('h1', {}, `${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}`),
        h('p', {}, new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
          H ? h('span', { class: 'hm-streak', title: 'Working days in a row with AI runs or cleared items (weekends do not break it)' }, `🔥 ${H.streak}-day streak`) : null,
          stats?.rank ? h('span', { class: 'hm-rank' }, `★ ${stats.rank.title || stats.rank.name || stats.rank}`) : null)),
      h('div', { class: 'hm-today' },
        h('b', {}, left ? `${left} of ${FLOW.length} missions left today` : 'Every mission done today'),
        cur ? h('small', { class: 'muted' }, `Next up: ${cur.name}`) : null,
        h('button', { class: 'btn go hm-go', onclick: goToday }, 'Go to today →')));
  }

  function todayCard() {
    const tasks = (D.tasks || []).filter((t) => !t.doneAt && t.status !== 'duplicate' && t.status !== 'failed');
    const rr = D.live?.github?.data?.reviewRequests?.length ?? null;
    const mine = D.live?.github?.data?.myPRs?.length ?? null;
    const nudge = (D.live?.jira?.data?.bugs || []).filter((b) => b.nudge).length;
    const unread = (D.pings?.items || []).filter((p) => !p.dismissed && !p.seen).length;
    const meets = (D.ai?.meetings?.meetings || []).filter((m) => new Date(m.end || m.start) > new Date() && new Date(m.start).toDateString() === new Date().toDateString()).sort((a, b) => new Date(a.start) - new Date(b.start));
    const tile = (n, label, onclick) => h('button', { class: 'hm-tile', onclick }, h('b', {}, n ?? '–'), h('small', {}, label));
    const toSec = (id) => () => { close(); const s = FLOW.find((x) => x.id === id); if (s) $(s.sec).scrollIntoView({ behavior: 'smooth' }); };
    return card('Today', h('div', {},
      h('div', { class: 'hm-tiles' },
        tile(rr, 'reviews waiting', toSec('github')), tile(mine, 'of your PRs open', toSec('github')),
        tile(nudge, 'bugs to nudge', toSec('jira')), tile(unread, 'new messages', () => { close(); window.openPhone ? window.openPhone() : $('btn-phone')?.click(); }),
        tile(tasks.length, 'open tasks', toSec('work'))),
      meets.length ? h('div', { class: 'hm-next' }, h('span', { class: 'muted small' }, 'Next meeting'),
        h('b', {}, meets[0].private ? 'Private event' : meets[0].title),
        h('span', { class: 'pill blue' }, new Date(meets[0].start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
        meets.length > 1 ? h('small', { class: 'muted' }, `+${meets.length - 1} more today`) : null) : h('div', { class: 'muted small hm-next' }, 'No more meetings today')), null, 'hm-span2');
  }

  function statsCard() {
    if (!stats) return card('This month', h('div', { class: 'muted' }, 'Loading numbers…'));
    const t = stats.totals || {};
    const days = stats.days || [];
    const max = Math.max(1, ...days.map((d) => d.score));
    const pick = (r) => h('button', { class: `hm-rg ${range === r ? 'on' : ''}`, onclick: async () => { range = r; stats = null; paint(); stats = await fetch(`/api/stats?range=${r}`).then((x) => x.json()).catch(() => null); paint(); } }, { week: 'Week', month: 'Month' }[r]);
    return card(range === 'week' ? 'This week' : 'Last 30 days', h('div', {},
      h('div', { class: 'hm-stats' }, STAT.map(([k, label]) => h('div', { class: 'hm-stat' }, h('b', {}, t[k] ?? 0), h('small', {}, label)))),
      h('div', { class: 'hm-spark', title: `${term('score')} per day` }, days.map((d) => h('span', { style: `height:${Math.max(4, Math.round(56 * d.score / max))}px`, title: `${d.date}: ${d.score}` }))),
      h('div', { class: 'muted small' }, `${term('score')} ${t.score ?? 0}${stats.errors?.length ? ` · ${stats.errors.length} source${stats.errors.length === 1 ? '' : 's'} unavailable` : ''}`)),
    h('div', { class: 'hm-rgs' }, pick('week'), pick('month')), 'hm-span2');
  }

  function heatCard() {
    if (!H) return card('Activity', h('div', { class: 'muted' }, 'Loading…'), null, 'hm-span3');
    const today = new Date();
    const start = new Date(today); start.setDate(start.getDate() - 7 * 17 - ((today.getDay() + 6) % 7));
    const vals = Object.values(H.heat).map((v) => v.ai + v.done);
    const max = Math.max(1, ...vals);
    const weeks = [];
    for (let w = 0; w < 18; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const x = new Date(start); x.setDate(start.getDate() + w * 7 + d);
        const k = dayKey(x);
        const v = H.heat[k];
        const n = v ? v.ai + v.done : 0;
        const lvl = x > today ? -1 : n === 0 ? 0 : Math.min(4, Math.ceil(4 * n / max));
        col.push(h('button', { class: `hm-hc l${lvl}`, disabled: x > today, title: `${x.toDateString()}: ${v?.ai || 0} AI runs, ${v?.done || 0} items cleared`, 'aria-label': `${x.toDateString()}, ${n} things`, onclick: () => { close(); window.openAICenter?.(k); } }));
      }
      weeks.push(h('div', { class: 'hm-hw' }, col));
    }
    return card('Activity, last 18 weeks', h('div', {},
      h('div', { class: 'hm-heat' }, weeks),
      h('div', { class: 'hm-legend muted small' }, `${H.ai30} AI runs and ${H.done30} items cleared in 30 days`, h('span', { class: 'st-gap' }), 'Less', [0, 1, 2, 3, 4].map((l) => h('i', { class: `hm-hc l${l}` })), 'More')), null, 'hm-span3');
  }

  function aiCard() {
    if (!H) return card('What the AI did', h('div', { class: 'muted' }, 'Loading…'));
    const rows = Object.entries(H.actions30).sort((a, b) => b[1] - a[1]);
    return card('What the AI did (30 days)', rows.length ? h('div', { class: 'hm-acts' }, rows.map(([k, n]) => h('div', { class: 'hm-act' }, h('b', {}, n), h('span', {}, ACT[k] || k))))
      : h('div', { class: 'muted small' }, 'No approvals, merges, replies or ticket moves yet. Ask the ✦ bubble to do one.'));
  }

  function winsCard() {
    if (!H) return card('Recent wins', h('div', { class: 'muted' }, 'Loading…'));
    return card('Recent wins', H.wins.length ? h('ol', { class: 'hm-wins' }, H.wins.slice(0, 8).map((w) => h('li', {},
      h('button', { class: 'hm-win', onclick: () => { close(); window.openAICenter?.(w.day); } },
        h('span', { class: 'pill green' }, w.kind), h('span', { class: 'hm-wt' }, w.key || w.label || ''), h('small', { class: 'muted' }, new Date(w.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))))))
      : h('div', { class: 'muted small' }, 'Wins show up here when the AI merges, approves, replies or moves something.'));
  }

  function tasksCard() {
    const tasks = (D.tasks || []).filter((t) => !t.doneAt && t.status !== 'duplicate' && t.status !== 'failed').slice(0, 6);
    return card('Open tasks', tasks.length ? h('ul', { class: 'hm-tasks' }, tasks.map((t) => {
      const n = (t.steps || []).length, d = (t.steps || []).filter((s) => s.done).length;
      return h('li', {}, h('span', { class: 'hm-tt' }, t.title), h('span', { class: 'hm-bar', title: `${d} of ${n} steps` }, h('i', { style: `width:${n ? Math.round(100 * d / n) : 0}%` })));
    })) : h('div', { class: 'muted small' }, 'No open tasks. Use "Create task" on any item.'));
  }

  // This quarter's projects (Jira epics) with progress; click one to open it in Projects.
  function projectsCard() {
    const open = (key) => () => { close(); window.openProjects?.(key); };
    const all = h('button', { class: 'linkbtn', onclick: open(null) }, 'All projects');
    if (!PJ) return card('Projects this quarter', h('div', { class: 'muted' }, 'Reading your epics…'), null, 'hm-span3');
    if (PJ.error && !PJ.projects?.length) return card('Projects this quarter', h('div', { class: 'muted small' }, PJ.error), all, 'hm-span3');
    const clean = (t) => String(t || '').replace(/^\s*\d{2}\s?Q[1-4]\s*[-–—:]?\s*/i, '').replace(/\s*[-–—]\s*\d{2}Q[1-4](\s*\/\s*\d{2}Q[1-4])*\s*$/i, '');
    const active = PJ.projects.filter((p) => p.category !== 'done');
    const done = PJ.projects.filter((p) => p.category === 'done');
    const days = (d) => (d ? Math.ceil((new Date(`${d}T23:59:59`) - Date.now()) / 864e5) : null);
    const pbar = (p) => { const c = p.counts || {}; return h('div', { class: 'prj-bar', title: `${c.done || 0} done · ${c.doing || 0} in progress · ${c.todo || 0} to do` }, c.total ? [h('i', { class: 'd', style: `width:${100 * c.done / c.total}%` }), h('i', { class: 'p', style: `width:${100 * c.doing / c.total}%` })] : null); };
    return card(`Projects · ${PJ.quarter.slice(5)} ${PJ.quarter.slice(0, 4)}`, h('div', {},
      active.length ? h('div', { class: 'hm-prj' }, active.slice(0, 10).map((p) => {
        const due = p.due || p.nextDue, n = days(due);
        return h('button', { class: 'hm-prj-row', onclick: open(p.key) },
          h('b', { title: p.title }, clean(p.title)), pbar(p),
          h('small', { class: 'muted' }, [p.counts?.total ? `${p.pct}%` : 'no stories', p.blockers ? `⛔ ${p.blockers}` : null, due ? (n < 0 ? `${-n}d late` : `due in ${n}d`) : null].filter(Boolean).join(' · ')));
      })) : h('div', { class: 'muted small' }, 'No active projects this quarter.'),
      h('div', { class: 'muted small hm-next' }, `${active.length} active · ${done.length} completed this quarter`, active.length > 10 ? ` · +${active.length - 10} more` : '')), all, 'hm-span3');
  }

  function healthCard() {
    const needs = setupInfo?.needs;
    if (!needs) return card('Connections', h('div', { class: 'muted' }, 'Checking…'));
    return card('Connections', h('div', { class: 'hm-health' }, needs.map((n) => h('span', { class: `hm-dot ${n.ok ? 'ok' : 'no'}`, title: n.ok ? `via ${n.via.join(', ')}` : 'Not connected' }, n.area))),
      h('button', { class: 'linkbtn', onclick: () => { close(); window.openSettings?.('overview'); } }, 'Settings'));
  }

  function paint() {
    const ov = $(OV);
    if (!ov || ov.hidden || !D) return;
    const safe = (fn) => { try { return fn(); } catch (e) { return card('Oops', h('div', { class: 'blocked' }, e.message)); } };
    ov.replaceChildren(h('div', { class: 'hm-box', role: 'dialog', 'aria-label': 'Home' },
      h('header', { class: 'aic-head' }, h('h2', { class: 'vh' }, window.icon ? window.icon('home') : null, 'Home'), h('span', { class: 'st-gap' }),
        h('button', { class: 'btn ghost', onclick: goToday }, 'Today’s missions'), h('button', { class: 'btn', onclick: close }, 'Close')),
      h('div', { class: 'hm-scroll' }, h('div', { class: 'hm-wrap' },
        safe(hero),
        h('div', { class: 'hm-grid' }, safe(todayCard), safe(healthCard), safe(projectsCard), safe(statsCard), safe(aiCard), safe(heatCard), safe(winsCard), safe(tasksCard))))));
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $(OV) && !$(OV).hidden) close(); });
  window.addEventListener('hq:changed', () => { if ($(OV) && !$(OV).hidden) fetchAll(); });
  HQ.addButton({ id: 'btn-home', label: '⌂ Home', title: 'Home: streaks, stats, activity and today at a glance', onclick: () => window.openHome() });
  // Move Home to the front of the header buttons.
  const btn = $('btn-home');
  if (btn) btn.parentElement.prepend(btn);
})();

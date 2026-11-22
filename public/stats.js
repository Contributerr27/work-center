/* Work Center scoreboard: today's Respect and rank, plus week and month stats.
   Loaded after app.js and flow.js; uses their globals (h, $, D, toast, theme, FLOW, stepState).
   Remote text goes in through h(), which uses textContent. */
(() => {
  const TABS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month']];
  // Activity colors, shared by the stacked chart, the legend and the KPI tiles.
  const ACTS = [
    ['prsOpened', 'PRs opened', 'blue'],
    ['reviews', 'Reviews', 'violet'],
    ['prsMerged', 'PRs merged', 'green'],
    ['storiesDone', 'Stories done', 'amber'],
    ['bugsFiled', 'Bugs filed', 'red'],
    ['desk', 'Desk', 'grey'],
  ];
  const PRI = [['Highest', 'red'], ['High', 'red'], ['Medium', 'amber'], ['Low', 'grey'], ['Lowest', 'grey']];
  const SVGNS = 'http://www.w3.org/2000/svg';
  const data = {}; // tab -> last stats object
  let tab = 'today';
  let todayScore = null;

  const vice = () => (typeof theme === 'function' ? theme() === 'vice' : false);
  const fmt = (n) => (n == null ? '–' : typeof n === 'string' ? n : Number(n).toLocaleString());
  const weight = (s, k) => (s.weights?.[k] ?? { prsOpened: 3, reviews: 2, prsMerged: 2, storiesDone: 5, bugsFiled: 2 }[k] ?? 1);
  // Points a day earned from each activity (desk = steps + cleared + AI commands).
  const parts = (s, d) => Object.fromEntries(ACTS.map(([k]) => [k, k === 'desk'
    ? (d.steps || 0) * weight(s, 'steps') + (d.cleared || 0) * weight(s, 'cleared') + (d.aiCommands || 0) * weight(s, 'aiCommands') + (d.focusBlocks || 0) * weight(s, 'focusBlocks')
    : (d[k] || 0) * weight(s, k)]));

  function svg(tag, attrs = {}, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  const dayLabel = (iso, long) => new Date(`${iso}T12:00:00`).toLocaleDateString([], long ? { weekday: 'short', day: 'numeric' } : { weekday: 'narrow' });

  /* ---------- shell ---------- */
  function shell() {
    let el = $('scoreboard');
    if (el) return el;
    el = h('div', { id: 'scoreboard', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scoreboard',
      onclick: (e) => { if (e.target === el) close(); } },
      h('div', { class: 'sb-box' },
        h('header', { class: 'sb-head' },
          h('h2', { class: 'sb-title' }),
          h('nav', { class: 'sb-tabs', role: 'tablist' }),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm ghost', title: 'Close (Esc)', onclick: () => close() }, 'Close')),
        h('div', { class: 'sb-body' })));
    document.body.append(el);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close(); });
    return el;
  }
  function close() {
    const el = $('scoreboard');
    if (el) el.hidden = true;
  }
  function chrome() {
    const el = shell();
    el.querySelector('.sb-title').textContent = term('board');
    el.querySelector('.sb-tabs').replaceChildren(...TABS.map(([id, label]) =>
      h('button', { class: `sb-tab ${id === tab ? 'on' : ''}`, role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', onclick: () => openScoreboard(id) }, label)));
    return el.querySelector('.sb-body');
  }

  /* ---------- pieces ---------- */
  function hero(s) {
    const r = s.rank || {};
    const toNext = r.nextAt != null ? r.nextAt - r.score : 0;
    return h('div', { class: 'sb-hero' },
      h('div', { class: 'sb-score' },
        h('b', {}, fmt(r.score ?? s.totals?.score)),
        h('small', {}, term('score'))),
      h('div', { class: 'sb-rank' },
        h('div', { class: 'sb-rank-title' }, h('span', { class: 'sb-level' }, `Lv ${r.level || 1}`), r.title || ''),
        h('div', { class: 'sb-meter', title: r.nextTitle ? `${fmt(toNext)} to ${r.nextTitle}` : 'Top rank' },
          h('i', { style: `width:${Math.round((r.progress ?? 0) * 100)}%` })),
        h('div', { class: 'sb-ladder' }, (r.ladder || []).map((x, i) =>
          h('span', { class: i < (r.level || 1) ? 'on' : '', title: `${x.title} at ${fmt(x.at)}` }, '')),
          h('small', {}, r.nextTitle ? `+${fmt(toNext)} → ${r.nextTitle}` : 'Max rank'))));
  }

  function counter(n, label, color) {
    return h('div', { class: `sb-count ${color || ''}` }, h('b', {}, fmt(n)), h('small', {}, label));
  }

  function steps() {
    if (typeof FLOW === 'undefined') return null;
    const state = (id) => { try { return stepState(id); } catch { return 'todo'; } };
    return h('div', { class: 'sb-steps' }, FLOW.map((st, i) => {
      const s = state(st.id);
      return h('div', { class: `sb-step ${s}`, title: `${st.name}: ${s === 'done' ? 'done' : s === 'skipped' ? 'skipped' : 'open'}` },
        h('span', { class: 'sb-check' }, s === 'done' ? '✓' : s === 'skipped' ? '↷' : i + 1),
        h('small', {}, stepName(st)));
    }));
  }

  // Daily score as stacked bars, one segment per activity.
  function scoreChart(s) {
    const W = 640, H = 170, top = 14, base = H - 22, n = s.days.length;
    const max = Math.max(10, ...s.days.map((d) => d.score));
    const slot = W / n, bw = Math.max(4, Math.min(44, slot * 0.66));
    const every = n > 14 ? 5 : 1;
    const today = s.days[n - 1]?.date;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sb-chart', role: 'img', 'aria-label': 'Score per day' },
      [0.5, 1].map((f) => svg('line', { x1: 0, x2: W, y1: base - (base - top) * f, y2: base - (base - top) * f, class: 'grid' })),
      svg('line', { x1: 0, x2: W, y1: base, y2: base, class: 'axis' }));
    s.days.forEach((d, i) => {
      const x = i * slot + (slot - bw) / 2;
      let y = base;
      const p = parts(s, d);
      for (const [k, label, color] of ACTS) {
        if (!p[k]) continue;
        const hgt = (p[k] / max) * (base - top);
        y -= hgt;
        g.append(svg('rect', { x, y, width: bw, height: Math.max(1, hgt), class: `f-${color}` }, svg('title', {}, `${d.date} · ${label}: ${p[k]} pts`)));
      }
      if (d.score) g.append(svg('text', { x: x + bw / 2, y: y - 4, class: 'val' }, d.score));
      if (i % every === 0 || i === n - 1) g.append(svg('text', { x: x + bw / 2, y: H - 6, class: `lbl ${d.date === today ? 'now' : ''}` }, n > 7 ? new Date(`${d.date}T12:00:00`).getDate() : dayLabel(d.date)));
    });
    return g;
  }

  // PR trend: opened / reviewed / merged lines.
  function trendChart(s) {
    const W = 640, H = 150, top = 10, base = H - 18, n = s.days.length;
    const series = [['prsOpened', 'blue'], ['reviews', 'violet'], ['prsMerged', 'green']];
    const max = Math.max(3, ...s.days.flatMap((d) => series.map(([k]) => d[k])));
    const x = (i) => (n === 1 ? W / 2 : 8 + (i * (W - 16)) / (n - 1));
    const y = (v) => base - (v / max) * (base - top);
    return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sb-chart', role: 'img', 'aria-label': 'Pull requests per day' },
      svg('line', { x1: 0, x2: W, y1: base, y2: base, class: 'axis' }),
      series.map(([k, c]) => [
        svg('polyline', { points: s.days.map((d, i) => `${x(i)},${y(d[k])}`).join(' '), class: `ln s-${c}` }),
        s.days.map((d, i) => svg('circle', { cx: x(i), cy: y(d[k]), r: n > 14 ? 2 : 3.5, class: `f-${c}` }, svg('title', {}, `${d.date}: ${d[k]}`))),
      ]),
      svg('text', { x: W - 2, y: top + 2, class: 'lbl end' }, `max ${max}`));
  }

  function legend(items) {
    return h('div', { class: 'sb-legend' }, items.map(([, label, color]) => h('span', {}, h('i', { class: `f-${color}` }), label)));
  }

  function bugs(s) {
    const b = s.openBugs || {};
    const max = Math.max(1, ...PRI.map(([p]) => b.byPriority?.[p] || 0));
    const status = Object.entries(b.byStatus || {}).sort((a, c) => c[1] - a[1]);
    return h('div', { class: 'sb-card' },
      h('h3', {}, term('bugs'), h('span', { class: 'sb-big' }, fmt(b.total))),
      h('div', { class: 'sb-hbars' }, PRI.filter(([p]) => b.byPriority?.[p] || ['High', 'Medium', 'Low'].includes(p)).map(([p, c]) =>
        h('div', { class: 'sb-hbar' },
          h('span', {}, p),
          h('div', {}, h('i', { class: `f-${c}`, style: `width:${((b.byPriority?.[p] || 0) / max) * 100}%` })),
          h('b', {}, fmt(b.byPriority?.[p] || 0))))),
      h('div', { class: 'sb-mini' },
        counter(b.staleCount, 'Stale', b.staleCount ? 'amber' : ''),
        counter(b.oldestDays == null ? null : `${b.oldestDays}d`, 'Oldest'),
        counter(s.totals.bugsFixed, 'Fixed', 'green')),
      status.length > 1 && h('div', { class: 'sb-pills' }, status.slice(0, 5).map(([k, v]) => h('span', { class: 'pill' }, `${k} ${v}`))));
  }

  function stories(s) {
    const max = Math.max(1, ...s.days.map((d) => d.storiesDone));
    return h('div', { class: 'sb-card' },
      h('h3', {}, term('stories'), h('span', { class: 'sb-big' }, fmt(s.totals.storiesDone))),
      h('div', { class: 'sb-spark' }, s.days.map((d) =>
        h('i', { class: d.storiesDone ? 'f-amber' : '', style: `height:${d.storiesDone ? 12 + (d.storiesDone / max) * 88 : 4}%`, title: `${d.date}: ${d.storiesDone}` }))));
  }

  /* ---------- views ---------- */
  function viewToday(s) {
    const t = s.totals;
    return [
      hero(s),
      steps(),
      h('div', { class: 'sb-counts' },
        counter(t.reviews, 'Reviewed', 'violet'),
        counter(t.prsMerged, 'Merged', 'green'),
        counter(t.prsOpened, 'Opened', 'blue'),
        counter(t.storiesDone, 'Stories', 'amber'),
        counter(t.bugsFiled, 'Bugs filed', 'red'),
        counter(t.cleared, 'Cleared'),
        counter(t.aiCommands, 'AI runs')),
      h('div', { class: 'sb-mini wide' },
        counter(s.github?.reviewQueue, 'In my review queue', s.github?.reviewQueue ? 'amber' : ''),
        counter(s.github?.openPRs, 'My open PRs'),
        counter(s.openBugs?.total, 'My open bugs')),
    ];
  }

  function viewRange(s) {
    const t = s.totals;
    return [
      hero(s),
      h('div', { class: 'sb-counts' },
        counter(t.prsOpened, 'PRs opened', 'blue'),
        counter(t.reviews, 'Reviews', 'violet'),
        counter(t.prsMerged, 'PRs merged', 'green'),
        counter(t.storiesDone, 'Stories', 'amber'),
        counter(t.bugsFiled, 'Bugs filed', 'red'),
        counter(t.steps, 'Desk steps'),
        counter(s.github?.closedUnmerged, 'PRs closed')),
      h('div', { class: 'sb-card' }, h('h3', {}, term('perDay')), scoreChart(s), legend(ACTS)),
      h('div', { class: 'sb-grid' },
        h('div', { class: 'sb-card' }, h('h3', {}, 'Pull requests'), trendChart(s), legend([[, 'Opened', 'blue'], [, 'Reviewed', 'violet'], [, 'Merged', 'green']])),
        bugs(s)),
      stories(s),
    ];
  }

  function skeleton() {
    return [h('div', { class: 'sb-hero sk' }), h('div', { class: 'sb-counts' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'sb-count sk' }))), h('div', { class: 'sb-card sk tall' })];
  }

  function paint(s) {
    const body = chrome();
    const foot = h('div', { class: 'sb-foot' },
      s.errors?.length ? h('span', { class: 'sb-err' }, `Missing data: ${s.errors.join(' · ')}`) : null,
      h('span', { class: 'spacer' }),
      h('span', {}, `Updated ${new Date(s.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`));
    body.replaceChildren(...(s.range === 'today' ? viewToday(s) : viewRange(s)).filter(Boolean), foot);
  }

  async function load(which) {
    const r = await fetch(`/api/stats?range=${encodeURIComponent(which)}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Stats failed');
    data[which] = j;
    if (which === 'today') {
      todayScore = j.totals?.score ?? null;
      window.dispatchEvent(new CustomEvent('respect', { detail: { score: todayScore, rank: j.rank } }));
    }
    return j;
  }

  window.openScoreboard = async (which = 'today') => {
    tab = TABS.some(([id]) => id === which) ? which : 'today';
    const el = shell();
    el.dataset.range = tab;
    el.hidden = false;
    const body = chrome();
    if (data[tab]) paint(data[tab]);
    else body.replaceChildren(...skeleton());
    const want = tab;
    try {
      const s = await load(want);
      if (tab === want && !el.hidden) paint(s);
    } catch (e) {
      if (tab !== want) return;
      if (!data[want]) body.replaceChildren(h('div', { class: 'sb-foot' }, h('span', { class: 'sb-err' }, e.message)));
      if (typeof toast === 'function') toast(e.message);
    }
  };
  // Today's Respect for the header, or null until it has loaded once.
  window.respectToday = () => todayScore;
  // Warm it quietly so the header can show it without opening the board.
  setTimeout(() => load('today').catch(() => {}), 1500);
})();

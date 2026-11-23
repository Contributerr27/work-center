/* End-of-day wrap: "Mission summary" overlay with today's Respect, missions, cleared items, AI runs and tasks,
   plus one AI run ("✦ Write my wrap") that logs the worklog, drafts tomorrow's standup, suggests Jira updates
   and (Fridays) a weekly report. Uses page globals: h, $, D, post, toast, copy, theme, FLOW, stepState,
   liveFeed, actSummary, standupNode, standupText, time, HQ. */
(() => {
  const OV = 'wrap-ov';
  let W = null; // /api/wrap
  let S = null; // /api/stats?range=today
  let viewing = null; // date shown (null = today)
  let pollT = null;
  const vice = () => theme() === 'vice';
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* no storage */ } return null; };
  const longDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  /* ---------- data ---------- */
  async function fetchWrap() {
    try {
      W = await (await fetch(`/api/wrap${viewing ? `?date=${viewing}` : ''}`)).json();
    } catch (e) { toast(`Could not load the wrap: ${e.message}`); }
    draw();
    schedule();
  }
  async function fetchStats() {
    try { S = await (await fetch('/api/stats?range=today')).json(); } catch (e) { S = { error: e.message }; }
    draw();
  }
  function schedule() {
    clearTimeout(pollT);
    const el = document.getElementById(OV);
    const busy = W?.run?.running || (W?.wrap?.jiraUpdates || []).some((u) => u.postStatus === 'posting');
    if (el && !el.hidden && busy) pollT = setTimeout(fetchWrap, 3000);
  }

  function open(date) {
    viewing = date && date !== today() ? date : null;
    store(`wrap-offer:${today()}`, '1');
    offer();
    const el = HQ.overlay(OV);
    el.onclick = (e) => { if (e.target === el) close(); };
    el.hidden = false;
    draw();
    fetchWrap();
    if (!S || S.error || !isToday(S.generatedAt)) fetchStats();
  }
  function close() { HQ.closeOverlay(OV); clearTimeout(pollT); }
  document.addEventListener('keydown', (e) => { const el = document.getElementById(OV); if (e.key === 'Escape' && el && !el.hidden) close(); });

  /* ---------- today, from the desk ---------- */
  function day() {
    const done = Object.entries(D?.state?.done || {}).filter(([, at]) => isToday(at));
    const runs = (D?.commands || []).filter((c) => isToday(c.startedAt) && c.section !== 'wrap');
    return {
      missions: FLOW.map((s) => ({ s, st: stepState(s.id) })),
      cleared: done.filter(([id]) => /^(sl|jr|ti|st):/.test(id)).length,
      runs,
      tasks: (D?.tasks || []).filter((t) => isToday(t.doneAt)),
      focus: D?.ext?.focus?.today || null,
    };
  }

  /* ---------- pieces ---------- */
  const stat = (n, label, cls) => h('div', { class: `wr-stat ${cls || ''}` }, h('b', {}, n), h('small', {}, label));

  function hero(d) {
    const r = S?.rank;
    const passed = d.missions.filter((m) => m.st === 'done').length;
    return h('div', { class: 'wr-hero' },
      h('div', { class: 'wr-score' },
        h('b', {}, r ? r.score : S?.error ? '–' : '…'),
        h('small', {}, term('score'))),
      h('div', { class: 'wr-rank' },
        h('div', { class: 'wr-rank-t' }, r ? h('span', { class: 'wr-lv' }, `Lv ${r.level}`) : null, r ? r.title : S?.error ? 'Score unavailable' : 'Counting…'),
        r && h('div', { class: 'wr-meter', title: r.nextTitle ? `${r.nextAt - r.score} to ${r.nextTitle}` : 'Top rank' }, h('i', { style: `width:${Math.round((r.progress || 0) * 100)}%` })),
        r && h('small', { class: 'muted' }, r.nextTitle ? `+${r.nextAt - r.score} → ${r.nextTitle}` : 'Max rank')),
      h('div', { class: 'wr-stats' },
        stat(`${passed}/${d.missions.length}`, term('stepsDone'), passed === d.missions.length ? 'all' : ''),
        stat(d.cleared, 'Items cleared'),
        stat(d.runs.length, 'AI runs'),
        stat(d.tasks.length, 'Tasks finished'),
        d.focus && stat(d.focus.minutes, 'Focus min')));
  }

  function missionStrip(d) {
    return h('div', { class: 'wr-strip' }, d.missions.map(({ s, st }, i) => h('div', { class: `wr-m ${st}`, title: `${s.name}: ${st === 'done' ? 'passed' : st === 'skipped' ? 'skipped' : 'not done'}` },
      h('span', { class: 'wr-mi' }, st === 'done' ? '✓' : st === 'skipped' ? '↷' : i + 1),
      h('span', { class: 'wr-mn' }, stepName(s)))));
  }

  function activity(d) {
    const runs = d.runs.slice(0, 8).map((c) => {
      const acts = actSummary(c);
      return h('div', { class: 'wr-row' },
        h('span', { class: `wr-dot ${c.running ? 'run' : c.error ? 'bad' : 'ok'}` }),
        h('span', { class: 't', title: c.text }, c.text),
        acts && h('span', { class: 'pill green' }, acts),
        h('span', { class: 'muted small' }, time(c.startedAt)));
    });
    const tasks = d.tasks.map((t) => h('div', { class: 'wr-row' }, h('span', { class: 'wr-dot ok' }), h('span', { class: 't' }, t.title)));
    return h('div', { class: 'wr-cols' },
      h('div', { class: 'wr-card' }, h('h4', {}, 'What the AI did'), runs.length ? runs : h('div', { class: 'empty' }, 'No AI runs today'),
        d.runs.length > 8 && h('div', { class: 'muted small' }, `+${d.runs.length - 8} more`)),
      h('div', { class: 'wr-card' }, h('h4', {}, 'Tasks finished'), tasks.length ? tasks : h('div', { class: 'empty' }, 'No tasks finished today')));
  }

  /* ---------- the AI wrap ---------- */
  async function write() {
    try { await post('/api/wrap/run'); toast('Writing your wrap…'); fetchWrap(); } catch (e) { toast(e.message); }
  }
  async function postUpdate(u) {
    if (!confirm(`Post this comment on ${u.key} in Jira, as you?\n\n"${u.update}"`)) return;
    try { await post('/api/wrap/post', { date: W.date, key: u.key }); toast(`Posting on ${u.key}…`); fetchWrap(); } catch (e) { toast(e.message); }
  }
  async function postAll(list) {
    if (!confirm(`Post ${list.length} Jira comment${list.length === 1 ? '' : 's'}, one per ticket, as you?\n\n${list.map((u) => `${u.key}: ${u.update}`).join('\n')}`)) return;
    try { const r = await post('/api/wrap/post', { date: W.date, all: true }); toast(`Posting ${r.posting.length} updates…`); fetchWrap(); } catch (e) { toast(e.message); }
  }
  async function toMeetings() {
    try { const r = await post('/api/wrap/to-meetings', { date: W.date }); toast(`Standup put in ${r.title}`); load(false); } catch (e) { toast(e.message); }
  }
  const weeklyText = (w) => `${w.title}\n\n${(w.bullets || []).map((b) => `• ${b}`).join('\n')}${w.highlights?.length ? `\n\nHighlights:\n${w.highlights.map((b) => `• ${b}`).join('\n')}` : ''}`;
  const POST_PILL = { posting: ['blue pulse', 'Posting…'], posted: ['green', '✓ Posted'], done: ['green', '✓ Sent'], failed: ['red', '✕ Failed'], unknown: ['', 'Sent earlier'] };

  function rendered(w) {
    const su = w.standup || { done: [], next: [], blockers: [] };
    const ups = w.jiraUpdates || [];
    const todo = ups.filter((u) => !['posted', 'posting', 'done'].includes(u.postStatus));
    return [
      w.headline && h('div', { class: 'wr-headline' }, w.headline),
      h('div', { class: 'wr-cols' },
        h('div', { class: 'wr-card' },
          h('div', { class: 'wr-ch' }, h('h4', {}, 'Tomorrow\'s standup'), h('span', { class: 'spacer' }),
            h('button', { class: 'btn sm', onclick: () => copy(standupText(su), 'Standup copied') }, 'Copy standup'),
            W.date === W.today && h('button', { class: 'btn sm', title: 'Write it into the next standup on the Meetings mission', onclick: toMeetings }, 'Put in Meetings')),
          standupNode(su)),
        h('div', { class: 'wr-card' },
          h('div', { class: 'wr-ch' }, h('h4', {}, 'Jira updates'), h('span', { class: 'count' }, ups.length), h('span', { class: 'spacer' }),
            todo.length > 1 && h('button', { class: 'btn sm go', onclick: () => postAll(todo) }, `Post all ${todo.length}`)),
          ups.length ? ups.map((u) => {
            const pill = POST_PILL[u.postStatus];
            return h('div', { class: 'wr-up' },
              h('div', { class: 'wr-up-h' }, h('a', { class: 'key', href: u.url || `${D.config.jiraSite}/browse/${u.key}` }, u.key), h('span', { class: 't', title: u.title }, u.title),
                pill ? h('span', { class: `pill ${pill[0]}` }, pill[1])
                  : h('button', { class: 'btn sm', onclick: () => postUpdate(u) }, 'Post comment')),
              h('div', { class: 'wr-up-x' }, u.update));
          }) : h('div', { class: 'empty' }, 'No Jira tickets touched today'))),
      w.weekly && h('div', { class: 'wr-card wr-weekly' },
        h('div', { class: 'wr-ch' }, h('h4', {}, term('weekly')), h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', onclick: () => copy(weeklyText(w.weekly), 'Weekly report copied') }, 'Copy weekly report')),
        h('b', { class: 'wr-wt' }, w.weekly.title),
        h('ul', {}, (w.weekly.bullets || []).map((b) => h('li', {}, b))),
        w.weekly.highlights?.length && h('div', { class: 'wr-hl' }, w.weekly.highlights.map((x) => h('span', { class: 'pill amber' }, `★ ${x}`)))),
      w.worklogSaved?.length && h('details', { class: 'wr-log' }, h('summary', {}, `Saved ${w.worklogSaved.length} worklog entr${w.worklogSaved.length === 1 ? 'y' : 'ies'} to amem`),
        h('ul', {}, w.worklogSaved.map((x) => h('li', {}, x)))),
    ];
  }

  function wrapBox() {
    if (!W) return h('div', { class: 'wr-card muted' }, 'Loading…');
    const run = W.run, w = W.wrap, mine = W.date === W.today;
    const head = h('div', { class: 'wr-ch' }, h('h4', {}, term('debrief')), h('span', { class: 'spacer' }),
      w && mine && !run?.running && h('button', { class: 'btn sm ghost', title: 'Write it again from scratch', onclick: () => confirm('Write the wrap again? It replaces this one.') && write() }, '↻ Rewrite'));
    if (run?.running) return h('div', { class: 'wr-card wr-ai' }, head, liveFeed(run));
    if (w) return h('div', { class: 'wr-ai' }, head, ...rendered(w).filter(Boolean));
    if (!mine) return h('div', { class: 'wr-card' }, head, h('div', { class: 'empty' }, 'No wrap was written that day'));
    return h('div', { class: 'wr-card wr-ai wr-cta' }, head,
      run?.error && h('div', { class: 'blocked' }, `Last try failed: ${run.error}`),
      h('button', { class: 'btn go wr-big', onclick: write }, '✦ Write my wrap'),
      h('div', { class: 'muted small' }, `Logs today's work to amem, drafts tomorrow's standup and a one-line update per Jira ticket you touched${W.friday ? ', plus your weekly report' : ''}. Nothing is posted.`));
  }

  function pastList() {
    const past = (W?.past || []).filter((p) => p.date !== (viewing || W?.today));
    if (!past.length && !viewing) return null;
    return h('div', { class: 'wr-past' }, h('small', { class: 'muted' }, 'Past wraps'),
      viewing && h('button', { class: 'pill blue', onclick: () => open() }, '← Today'),
      past.slice(0, 30).map((p) => h('button', { class: 'pill', title: p.headline || '', onclick: () => open(p.date) }, `${shortDate(p.date)}${p.weekly ? ' ★' : ''}`)));
  }

  function draw() {
    const el = document.getElementById(OV);
    if (!el || el.hidden) return;
    const d = day();
    const date = viewing || today();
    HQ.repaint(el, () => h('div', { class: 'wr-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mission summary' },
      h('header', { class: 'wr-top' },
        h('div', {}, h('h2', { class: 'wr-title' }, term('wrapTitle')), h('div', { class: 'wr-date' }, longDate(date))),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm ghost', title: 'Close (Esc)', onclick: close }, 'Close')),
      !viewing && hero(d),
      !viewing && missionStrip(d),
      !viewing && activity(d),
      wrapBox(),
      pastList()));
  }

  /* ---------- header button and the evening offer ---------- */
  HQ.addButton({ id: 'btn-wrap', label: '🌇 Wrap up', title: 'End-of-day mission summary, standup and worklog', onclick: () => open() });

  function offer() {
    let el = $('wrap-offer');
    const now = new Date(), wd = now.getDay();
    const show = wd >= 1 && wd <= 5 && now.getHours() >= 17 && store(`wrap-offer:${today()}`) !== '1';
    if (!show) { if (el) el.hidden = true; return; }
    if (!el) {
      el = h('div', { id: 'wrap-offer', role: 'status' },
        h('span', {}, `${term('wrap')}?`),
        h('button', { class: 'btn sm go', onclick: () => open() }, 'Wrap up'),
        h('button', { class: 'ibtn', title: 'Not today', 'aria-label': 'Dismiss', onclick: () => { store(`wrap-offer:${today()}`, '1'); offer(); } }, '×'));
      document.body.append(el);
    }
    el.hidden = false;
  }
  HQ.onRender(() => { offer(); draw(); });
  setInterval(offer, 60_000);
})();

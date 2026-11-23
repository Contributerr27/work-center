/* Work Center UI. All remote text is inserted with textContent, never as HTML. */
let D = null;
const $ = (id) => document.getElementById(id);
const filters = { sprint: null, bugs: 'nudge' };

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'href') { e.href = safeUrl(v); e.target = '_blank'; e.rel = 'noopener'; }
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const safeUrl = (u) => (/^(https?:|slack:)/i.test(u || '') ? u : '#');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ageCls = (d, warm = 3, hot = 7) => (d >= hot ? 'age hot' : d >= warm ? 'age warm' : 'age');
const age = (d, warm, hot) => h('span', { class: ageCls(d, warm, hot), title: 'Days since last update' }, d === 0 ? 'today' : `${d}d`);
const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const hue = (s) => [...(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (n) => h('span', { class: 'avatar', style: `background:hsl(${hue(n)} 45% 48%)`, title: n || 'Unassigned' }, initials(n));
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const isDone = (id) => !!D.state?.done?.[id];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-desk-token': D.token }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
async function copy(text, label = 'Copied') {
  await navigator.clipboard.writeText(text);
  toast(label);
}
async function markDone(id, done = true) {
  D.state = await post('/api/done', { id, done });
  render();
}

function panel(title, count, body, extra) {
  return h('div', { class: 'panel' }, h('header', {}, h('h3', {}, title), h('span', { class: 'spacer' }), extra, count != null && h('span', { class: 'count' }, count)), body);
}
const empty = (msg) => h('div', { class: 'empty' }, msg);

/* ---------- GitHub ---------- */
function renderGithub() {
  const box = $('github');
  box.replaceChildren();
  const g = D.live.github;
  if (!g.ok) return box.append(h('div', { class: 'panel err' }, g.error));
  if (g.stale) box.append(h('div', { class: 'stale-note muted small wide' }, `GitHub refresh failed (${g.stale.slice(0, 80)}). Showing data from ${time(g.staleSince)}.`));
  const verdicts = Object.fromEntries((D.ai.prs?.verdicts || []).map((v) => [`${v.repo}#${v.number}`, v]));
  const first = Object.fromEntries((D.ai.prs?.reviewFirst || []).map((v) => [`${v.repo}#${v.number}`, v.why]));
  const label = { merge: ['green', '✓ Good to merge'], wait: ['amber', '◷ Wait'], fix: ['red', '✕ Needs fixes'] };

  const marks = aiMarks();
  const prs = g.data.repoPRs.map((p) => {
    const ai = verdicts[`${p.repo}#${p.number}`];
    const verdict = ai?.verdict || p.rule;
    // The Merge button needs both: the AI says merge and the live checks agree.
    const canMerge = verdict === 'merge' && p.rule === 'merge';
    const [cls, text] = label[verdict] || label.wait;
    const dots = [...Array(p.checks.pass).fill('p'), ...Array(p.checks.fail).fill('f'), ...Array(p.checks.pending).fill('w')].slice(0, 14);
    const mk = marks[`${p.repo}#${p.number}`];
    return h('div', { class: `pr ${verdict} ${mk ? 'aidone' : ''}` },
      h('div', { class: 'head' },
        aiPill(mk) || h('span', { class: `pill ${cls}` }, text),
        p.isDraft && h('span', { class: 'pill' }, 'Draft'),
        p.isBot && h('span', { class: 'pill violet' }, 'Bot'),
        h('span', { class: 'spacer' }), h('span', { class: 'key' }, `#${p.number}`)),
      h('a', { class: 'title', href: p.url }, p.title),
      h('div', { class: 'why' }, ai ? `✦ ${ai.reason}` : 'No AI review yet. Rule check only.'),
      h('div', { class: 'meta' },
        h('span', { class: 'checks', title: `${p.checks.pass} passed, ${p.checks.fail} failed, ${p.checks.pending} pending` }, dots.map((d) => h('i', { class: d }))),
        h('span', { class: 'diff' }, h('span', { class: 'a' }, `+${p.additions}`), ' ', h('span', { class: 'd' }, `−${p.deletions}`)),
        h('span', { class: 'muted' }, p.author), age(p.idleDays),
        h('span', { class: 'spacer' }),
        itemActions('github', refs.pr(p)),
        h('a', { class: 'btn sm ghost', href: p.url }, 'Open'),
        h('button', { class: 'btn sm go', disabled: !canMerge, title: canMerge ? 'Squash and merge' : 'Enabled when the AI verdict and live checks both say merge', onclick: (e) => merge(p, e.target) }, 'Merge')));
  });
  box.append(panel(g.data.repo.split('/')[1], prs.length, h('div', { class: 'body tall' }, prs.length ? prs : empty('No open PRs 🎉'))));

  const rr = [...g.data.reviewRequests].sort((a, b) => (first[`${b.repo}#${b.number}`] ? 1 : 0) - (first[`${a.repo}#${a.number}`] ? 1 : 0))
    .sort((a, b) => (marks[`${a.repo}#${a.number}`] ? 1 : 0) - (marks[`${b.repo}#${b.number}`] ? 1 : 0));
  const prRow = (p) => {
    const why = first[`${p.repo}#${p.number}`];
    const mk = marks[`${p.repo}#${p.number}`];
    return h('a', { class: `row ${mk ? 'aidone' : ''}`, href: p.url, title: p.title },
      mk ? h('span', { class: 'star ok' }, '✓') : why ? h('span', { class: 'star', title: 'Review first' }, '★') : h('span', { class: 'muted' }, '·'),
      h('span', { class: 't' }, h('b', {}, p.title), h('small', {}, why ? `✦ ${why}` : `${p.repoName} #${p.number} · ${p.author}`)),
      p.isDraft && h('span', { class: 'pill' }, 'Draft'), aiPill(mk), itemActions('github', refs.pr(p)), age(p.idleDays, 3, 10));
  };
  box.append(panel('Waiting for my review', rr.length, h('div', { class: 'body tall' }, rr.length ? rr.map(prRow) : empty('Nothing to review'))));
  box.append(panel('My PRs in other repos', g.data.myPRs.length, h('div', { class: 'body tall' }, g.data.myPRs.length ? g.data.myPRs.map(prRow) : empty('None open'))));
}

async function merge(p, btn) {
  if (!confirm(`Squash and merge #${p.number}?\n\n${p.title}`)) return;
  btn.disabled = true;
  btn.textContent = 'Merging…';
  try {
    await post('/api/merge', { repo: p.repo, number: p.number });
    toast(`Merged #${p.number}`);
    load(true);
  } catch (e) {
    toast(e.message);
    btn.textContent = 'Merge';
    btn.disabled = false;
  }
}

/* ---------- Jira ---------- */
const QA_STEPS = ['Not Started', 'Test Plan Drafted', 'Test Plan Approved', 'Automated', 'Signed Off'];
const sprintBucket = (i) => (/block/i.test(i.status) ? 'blocked' : i.category === 'indeterminate' ? 'progress' : /ready/i.test(i.status) ? 'ready' : 'backlog');
const BUCKETS = { progress: ['In progress', 'blue'], blocked: ['Blocked', 'red'], ready: ['Ready', 'violet'], backlog: ['Backlog', ''] };
const priClass = (p) => (/high/i.test(p) ? 'high' : /low/i.test(p) ? 'low' : 'medium');

function stacked(groups, active, onPick) {
  const total = groups.reduce((a, g) => a + g.n, 0) || 1;
  return [
    h('div', { class: 'bar' }, groups.map((g) => h('i', { class: `c-${g.id}`, style: `width:${(g.n / total) * 100}%`, title: `${g.label}: ${g.n}` }))),
    h('div', { class: 'legend' }, groups.map((g) => h('span', { class: `pill ${g.color || ''} ${active && active !== g.id ? 'off' : ''}`, onclick: () => onPick(active === g.id ? null : g.id) }, `${g.label} ${g.n}`))),
  ];
}

function renderJira() {
  const box = $('jira');
  box.replaceChildren();
  const j = D.live.jira;
  if (!j.ok) return box.append(h('div', { class: 'panel err' }, j.error));
  if (j.stale) box.append(h('div', { class: 'stale-note muted small wide' }, `Jira refresh failed (${j.stale.slice(0, 80)}). Showing data from ${time(j.staleSince)}.`));
  const d = j.data;
  const jm = aiMarks();

  // PRDs in QA review: where QA stands, and what to do next.
  const prds = d.prdQa.map((p) => {
    const at = Math.max(0, QA_STEPS.findIndex((s) => p.qaStatus.startsWith(s)));
    const st = prdState(p);
    const run = D.prdRuns?.[p.key];
    const sum = D.prd?.[p.key];
    const hasSum = sum && !sum.error;
    const btns = [];
    if (st.id === 'approved') btns.push(h('button', { class: 'btn sm go', title: 'Move this PRD to PLANNED (IN ENG BACKLOG) in Jira', onclick: (e) => moveToEng(p, e.target) }, 'Move to Engineering →'));
    if (st.id === 'todo') btns.push(h('button', { class: 'btn sm go', disabled: !!run?.running, onclick: () => startWork(p, 'start') }, '✦ Start QA work'));
    if (st.id === 'drafted') btns.push(h('button', { class: 'btn sm', disabled: !!run?.running, title: 'Pick up PM answers and finish what is left', onclick: () => startWork(p, 'start') }, '✦ Continue'));
    if (hasSum) btns.push(h('button', { class: 'btn sm', onclick: () => showWork(p) }, 'View work'));
    else if (st.id !== 'todo') btns.push(h('button', { class: 'btn sm ghost', disabled: !!run?.running, title: 'Collect what was done into a summary (read-only)', onclick: () => startWork(p, 'summary') }, '✦ Build summary'));
    return h('div', { class: 'prd' },
      h('div', { class: 'line1' }, h('span', { class: 'key' }, p.key), h('b', {}, h('a', { href: p.url }, p.title)), age(p.idleDays, 3, 6)),
      h('div', { class: 'steps', title: QA_STEPS.join(' → ') }, QA_STEPS.map((_, i) => h('i', { class: i <= at ? (at === 4 ? 'fin' : 'on') : '' }))),
      h('div', { class: 'line3' }, h('span', {}, p.qaStatus), h('span', { class: 'spacer' }),
        p.assignee && h('span', {}, p.assignee),
        p.prd && h('a', { class: 'link', href: p.prd }, 'PRD'),
        p.testPlan ? h('a', { class: 'link', href: p.testPlan }, 'Test plan') : h('span', { class: 'pill amber' }, 'No test plan')),
      h('div', { class: 'line4' },
        run?.running ? h('span', { class: 'pill blue pulse' }, run.mode === 'start' ? '✦ AI is working on it…' : '✦ Building summary…') : h('span', { class: `pill ${st.color}` }, st.label),
        hasSum && !run?.running && h('span', { class: 'muted small', title: sum.headline }, sum.headline),
        h('span', { class: 'spacer' }), itemActions('jira', refs.jira(p)), btns),
      run?.error && !run.running && h('div', { class: 'blocked' }, `AI run failed: ${run.error}`));
  });
  box.append(panel('PRDs in QA review', prds.length, h('div', { class: 'body' }, prds.length ? prds : empty('No PRDs waiting for test planning'))));

  // Mentions and replies
  const replies = (D.ai.work?.jiraReplies || []).filter((r) => !isDone(`jr:${r.key}`));
  const replyKeys = new Set(replies.map((r) => r.key));
  const replyCards = replies.map((r) => h('div', { class: 'prd' },
    h('div', { class: 'line1' }, h('span', { class: 'key' }, r.key), h('b', {}, h('a', { href: r.url }, r.title)), h('span', { class: 'pill red' }, 'Reply')),
    h('div', { class: 'why', style: 'margin:6px 0' }, `${r.who}: ${r.ask}`),
    r.draft && h('div', { class: 'draft' }, r.draft),
    h('div', { class: 'line3', style: 'margin-top:8px' }, h('span', { class: 'spacer' }),
      r.draft && h('button', { class: 'btn sm', onclick: () => copy(r.draft, 'Reply copied') }, 'Copy reply'),
      h('a', { class: 'btn sm ghost', href: r.url }, 'Open'),
      itemActions('jira', refs.jira({ ...r, title: r.title })),
      h('button', { class: 'btn sm ghost', onclick: () => markDone(`jr:${r.key}`) }, '✓ Done'))));
  const mentionRows = d.mentions.filter((m) => !replyKeys.has(m.key)).map((m) => h('a', { class: 'row', href: m.url },
    h('span', { class: 'key' }, m.key), h('span', { class: 't' }, h('b', {}, m.title), h('small', {}, `${m.status} · ${m.assignee || 'Unassigned'}`)), aiPill(jm[m.key]), itemActions('jira', refs.jira(m)), age(m.idleDays)));
  box.append(panel('Mentions and questions for me', replyCards.length + mentionRows.length,
    h('div', { class: 'body' }, replyCards.length + mentionRows.length ? [...replyCards, ...mentionRows] : empty('Nobody is waiting on you'))));

  // Sprint
  const groups = Object.entries(BUCKETS).map(([id, [label, color]]) => ({ id, label, color, n: d.sprint.filter((i) => sprintBucket(i) === id).length }));
  const order = Object.keys(BUCKETS);
  const sprintRows = d.sprint.filter((i) => !filters.sprint || sprintBucket(i) === filters.sprint)
    .sort((a, b) => order.indexOf(sprintBucket(a)) - order.indexOf(sprintBucket(b)))
    .map((i) => { const b = sprintBucket(i); return h('a', { class: 'row', href: i.url, title: i.title },
      h('i', { class: `pri c-${b}` }), h('span', { class: 't' }, h('b', {}, i.title.replace(/^(Testing Platform|Launch Readiness)\s*[:-]\s*/i, '')), h('small', {}, `${i.key} · ${i.status}`)), b === 'blocked' ? h('button', { class: 'why-badge', 'data-why-key': i.key, 'data-why-text': `Status ${i.status}` }, '⛔ Why?') : null, aiPill(jm[i.key]), itemActions('jira', refs.jira(i)), age(i.idleDays, 5, 10)); });
  box.append(panel('My sprint', d.sprint.length, h('div', { class: 'body' }, stacked(groups, filters.sprint, (v) => { filters.sprint = v; renderJira(); }), sprintRows)));

  // Bugs I opened, grouped by who to chase
  const pg = ['high', 'medium', 'low'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), color: id === 'high' ? 'red' : id === 'medium' ? 'amber' : '', n: d.bugs.filter((b) => priClass(b.priority) === id).length }));
  const nudges = d.bugs.filter((b) => b.nudge);
  const shown = filters.bugs === 'nudge' ? nudges : filters.bugs ? d.bugs.filter((b) => priClass(b.priority) === filters.bugs) : d.bugs;
  const byWho = new Map();
  for (const b of shown) byWho.set(b.assignee || 'Unassigned', [...(byWho.get(b.assignee || 'Unassigned') || []), b]);
  const whoBlocks = [...byWho.entries()].sort((a, b) => b[1].length - a[1].length).map(([who, bugs]) => {
    const need = bugs.filter((b) => b.nudge);
    const msg = `Hi ${who.split(' ')[0]}, checking in on ${need.length === 1 ? 'this bug' : 'these bugs'} with no update for a while:\n` +
      need.map((b) => `• ${b.key} (${b.priority}, ${b.idleDays}d quiet) ${b.title}`).join('\n') + `\nAny ETA, or anything I can help unblock?`;
    return h('div', {},
      h('div', { class: 'who' }, avatar(who), h('b', {}, who), h('span', { class: 'count' }, bugs.length),
        need.length > 0 && h('button', { class: 'btn sm', title: 'Copy a follow-up message for Slack', onclick: () => copy(msg, `Follow-up for ${who.split(' ')[0]} copied`) }, `Nudge ${need.length}`)),
      h('div', { class: 'buglist' }, bugs.map((b) => h('a', { class: 'row', href: b.url, title: b.title },
        h('i', { class: `pri c-${priClass(b.priority)}`, title: b.priority }), h('span', { class: 't' }, h('b', {}, b.title), h('small', {}, `${b.key} · ${b.status}`)), aiPill(jm[b.key]), itemActions('jira', refs.jira(b)), age(b.idleDays, Math.ceil(b.nudgeLimit / 2), b.nudgeLimit)))));
  });
  const toggle = h('button', { class: 'btn sm ghost', onclick: () => { filters.bugs = filters.bugs === 'nudge' ? null : 'nudge'; renderJira(); } }, filters.bugs === 'nudge' ? 'Show all' : `Only follow-ups (${nudges.length})`);
  box.append(panel('Bugs I opened', d.bugs.length, h('div', { class: 'body' }, stacked(pg, ['high', 'medium', 'low'].includes(filters.bugs) ? filters.bugs : null, (v) => { filters.bugs = v; renderJira(); }), whoBlocks.length ? whoBlocks : empty('No bugs need a follow-up')), toggle));
}


/* ---------- PRD QA actions ---------- */
const APPROVED_QA = ['Test Plan Approved', 'Automated', 'Signed Off', 'Signed Off w/ Known Issues', 'N/A'];
function prdState(p) {
  if (APPROVED_QA.includes(p.qaStatus)) return { id: 'approved', color: 'green', label: '✓ Done and approved · ready for Engineering' };
  if (p.qaStatus === 'Test Plan Drafted' && p.testPlan) return { id: 'drafted', color: 'violet', label: '✓ QA work done · waiting for PM approval' };
  return { id: 'todo', color: 'red', label: p.qaStatus === 'Not Started' ? 'Not started' : 'Not done' };
}

async function startWork(p, mode) {
  if (mode === 'start' && !confirm(
    `Have Claude do the Shift-Left QA work for ${p.key}?\n\n${p.title}\n\n` +
    'It follows your PRD workflow (Settings → prd.skill): checks your sources and the code first, then writes the ' +
    'test plan, test cases, PM comment and tickets, and automates the Ready cases. It runs in the background ' +
    'for a while; the card updates when it finishes.')) return;
  try {
    await post('/api/prd/work', { key: p.key, mode });
    toast(mode === 'start' ? `Started QA work on ${p.key}` : `Building the ${p.key} summary`);
    load(false);
  } catch (e) {
    toast(e.message);
  }
}

async function moveToEng(p, btn) {
  if (!confirm(`Move ${p.key} to PLANNED (IN ENG BACKLOG)?\n\n${p.title}\nQA Status: ${p.qaStatus}`)) return;
  btn.disabled = true;
  btn.textContent = 'Moving…';
  try {
    await post('/api/prd/move', { key: p.key });
    toast(`${p.key} moved to Engineering`);
    load(true);
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = 'Move to Engineering →';
  }
}

// One horizontal bar split into labelled parts.
function splitBar(parts) {
  const total = parts.reduce((a, x) => a + (x.n || 0), 0);
  if (!total) return h('div', { class: 'muted small' }, 'No numbers yet');
  return [
    h('div', { class: 'bar big' }, parts.filter((x) => x.n).map((x) => h('i', { class: x.cls, style: `width:${(x.n / total) * 100}%`, title: `${x.label}: ${x.n}` }))),
    h('div', { class: 'legend' }, parts.map((x) => h('span', { class: `pill ${x.pill || ''}` }, `${x.label} ${x.n ?? '–'}`))),
  ];
}

function showWork(p) {
  const s = D.prd[p.key];
  const c = s.cases || {};
  const at = Math.max(0, QA_STEPS.findIndex((x) => p.qaStatus.startsWith(x)));
  const sec = (title, ...kids) => h('div', { class: 'wsec' }, h('h4', {}, title), ...kids);
  const list = (items) => (items?.length ? h('ul', {}, items.map((x) => h('li', {}, x))) : h('div', { class: 'muted small' }, 'None'));
  const link = (label, url) => url && h('a', { class: 'btn sm ghost', href: url }, label);
  const kindPill = { blocker: 'red', automation: 'blue', bug: 'amber' };
  const maxArea = Math.max(1, ...(s.edgeMatrix || []).map((m) => (m.tested || 0) + (m.gaps || 0)));
  $('reader-body').className = 'work';
  $('reader-body').replaceChildren(
    h('div', { class: 'whead' }, h('span', { class: 'key' }, p.key), h('h3', {}, s.title || p.title)),
    h('p', { class: 'headline' }, s.headline || ''),
    h('div', { class: 'wsteps' }, QA_STEPS.map((x, i) => h('div', { class: i <= at ? (i === 4 ? 'fin' : 'on') : '' }, h('i'), h('span', {}, x)))),
    h('div', { class: 'wlinks' }, link('PRD', s.links?.prd || p.prd), link('Test plan', s.links?.testPlan || p.testPlan), link('Testera', s.links?.testera), link('Journey', s.links?.journey), link('Jira', p.url)),
    h('div', { class: 'wgrid' },
      sec('Test cases', h('div', { class: 'bignum' }, c.total ?? '–', h('small', {}, 'cases')),
        splitBar([
          { label: 'Automated', n: c.automated, cls: 'c-auto', pill: 'green' },
          { label: 'Ready', n: Math.max(0, (c.ready || 0) - (c.automated || 0)), cls: 'c-ready', pill: 'violet' },
          { label: 'Blocked', n: c.blocked, cls: 'c-blocked', pill: 'red' },
          { label: 'Other', n: Math.max(0, (c.total || 0) - (c.ready || 0) - (c.blocked || 0)), cls: 'c-backlog' },
        ]),
        h('div', { class: 'muted small', style: 'margin-top:6px' }, `${c.gating ?? '–'} gating`)),
      sec('Test results', splitBar([
        { label: 'Passing', n: c.passing, cls: 'c-auto', pill: 'green' },
        { label: 'Failing', n: c.failing, cls: 'c-blocked', pill: 'red' },
      ]))),
    s.edgeMatrix?.length && sec('Edge-case matrix', h('div', { class: 'matrix' }, s.edgeMatrix.map((m) => h('div', { class: 'mrow' },
      h('span', { class: 't' }, m.area),
      h('span', { class: 'mbar' }, h('i', { class: 'c-auto', style: `width:${((m.tested || 0) / maxArea) * 100}%` }), h('i', { class: 'c-blocked', style: `width:${((m.gaps || 0) / maxArea) * 100}%` })),
      h('span', { class: 'muted small' }, `${m.tested || 0} tested · ${m.gaps || 0} gaps`))))),
    h('div', { class: 'wgrid' },
      sec('What was done', list(s.done)),
      sec('Next steps', list(s.nextSteps))),
    s.openQuestions?.length && sec('Open questions', list(s.openQuestions)),
    (s.tickets?.length || s.prs?.length) && sec('Tickets and PRs',
      ...(s.tickets || []).map((t) => h('a', { class: 'row', href: t.url || `${D.config.jiraSite}/browse/${t.key}` },
        h('span', { class: `pill ${kindPill[t.kind] || ''}` }, t.kind), h('span', { class: 'key' }, t.key),
        h('span', { class: 't' }, h('b', {}, t.title || ''), h('small', {}, [t.status, t.owner].filter(Boolean).join(' · '))))),
      ...(s.prs || []).map((x) => h('a', { class: 'row', href: x.url }, h('span', { class: `pill ${x.state === 'merged' ? 'green' : 'blue'}` }, x.state), h('span', { class: 'key' }, `#${x.number}`), h('span', { class: 't' }, h('b', {}, x.title || ''))))),
    s.timeline?.length && sec('Timeline', h('div', { class: 'tl' }, s.timeline.map((t) => h('div', {}, h('span', { class: 'muted small' }, t.date), h('span', {}, t.text))))),
    h('div', { class: 'muted small', style: 'margin-top:14px' }, `Summary from ${new Date(s.generatedAt).toLocaleString()}`, ' · ',
      h('a', { class: 'link', href: '#', onclick: (e) => { e.preventDefault(); $('reader').hidden = true; startWork(p, 'summary'); } }, 'Refresh summary')),
  );
  $('reader').hidden = false;
}

/* ---------- Slack ---------- */
function renderSlack() {
  const box = $('slack');
  box.replaceChildren();
  const s = D.ai.slack;
  if (!s) return box.append(h('div', { class: 'panel empty' }, 'No Slack scan yet. Press ✦ AI scan.'));
  const kinds = { reply: ['red', 'Reply'], 'follow-up': ['amber', 'Follow up'], ask: ['blue', 'Ask'] };
  const items = (s.items || []).filter((i) => !isDone(`sl:${i.url}`));
  if (!items.length) return box.append(h('div', { class: 'panel empty' }, 'Slack is clear ✨'));
  const sm = aiMarks();
  for (const i of items) {
    const [cls, text] = kinds[i.kind] || kinds.reply;
    const sent = slackMark(i.url, sm);
    box.append(h('div', { class: `card u${i.urgency || 1}` },
      h('div', { class: 'head' }, avatar(i.who), h('b', {}, i.who), h('span', { class: 'muted' }, i.channel), sent ? h('span', { class: 'pill green aimark' }, '✓ AI sent') : h('span', { class: `pill ${cls}` }, text)),
      h('div', { class: 'sum' }, i.summary),
      i.draft && h('div', { class: 'draft' }, i.draft),
      h('div', { class: 'foot' },
        h('span', { class: 'muted' }, i.when ? new Date(i.when).toLocaleDateString([], { weekday: 'short', hour: 'numeric' }) : ''), h('span', { class: 'spacer' }),
        itemActions('slack', refs.slack(i)),
        i.draft && h('button', { class: 'btn sm', onclick: () => copy(i.draft, 'Draft copied') }, 'Copy draft'),
        i.url && h('a', { class: 'btn sm ghost', href: i.url }, 'Open'),
        h('button', { class: 'btn sm ghost', onclick: () => markDone(`sl:${i.url}`) }, '✓'))));
  }
}

/* ---------- Work ---------- */
function ring(done, total) {
  const pct = total ? done / total : 0, r = 10, c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 26 26');
  svg.setAttribute('class', 'ring');
  const mk = (stroke, dash) => { const ci = document.createElementNS(ns, 'circle'); Object.entries({ cx: 13, cy: 13, r, fill: 'none', 'stroke-width': 3.5, stroke, 'stroke-dasharray': dash, transform: 'rotate(-90 13 13)', 'stroke-linecap': 'round' }).forEach(([k, v]) => ci.setAttribute(k, v)); return ci; };
  svg.append(mk('var(--grey-bg)', `${c} ${c}`), mk('var(--green)', `${c * pct} ${c}`));
  return svg;
}
function renderWork() {
  const box = $('work');
  box.replaceChildren();
  const w = D.ai.work;
  if (!w) return box.append(h('div', { class: 'panel empty' }, 'Suggestions are still being prepared. Press ↻ Refresh in a minute.'));
  box.append(tasksPanel());
  const tasks = (w.breakdowns || []).map((b) => {
    const steps = b.steps.map((s, i) => ({ ...s, id: `st:${b.key}:${i}` })).map((s) => ({ ...s, done: s.done || isDone(s.id) }));
    return h('div', { class: 'task' },
      h('div', { class: 'head' }, ring(steps.filter((s) => s.done).length, steps.length), h('b', { title: b.title }, h('a', { href: `${D.config.jiraSite}/browse/${b.key}` }, b.title)), h('span', { class: 'key' }, b.key), itemActions('work', refs.story(b))),
      steps.map((s) => h('label', { class: `step ${s.done ? 'done' : ''}` }, h('input', { type: 'checkbox', checked: s.done, onchange: (e) => markDone(s.id, e.target.checked) }), h('span', {}, s.text))),
      b.blockedBy && h('div', { class: 'blocked' }, `⛔ ${b.blockedBy}`));
  });
  box.append(panel('Next steps on my stories', tasks.length, h('div', { class: 'body tall' }, tasks.length ? tasks : empty('No breakdowns yet'))));
  const pc = { P0: 'red', P1: 'amber', P2: '' };
  const ideas = (w.testIdeas || []).filter((t) => !isDone(`ti:${t.title}`)).map((t) => h('div', { class: 'prd' },
    h('div', { class: 'line1' }, h('span', { class: `pill ${pc[t.priority] || ''}` }, t.priority || 'P2'), h('b', { title: t.title }, t.title)),
    h('div', { class: 'why', style: 'margin:5px 0' }, t.why),
    h('div', { class: 'line3' }, h('span', { class: 'pill' }, t.source), h('span', {}, t.area), h('span', { class: 'spacer' }),
      t.url && h('a', { class: 'link', href: t.url }, 'Source'),
      itemActions('work', refs.idea(t)),
      h('button', { class: 'btn sm ghost', onclick: () => markDone(`ti:${t.title}`) }, 'Dismiss'))));
  box.append(panel('Tests worth adding', ideas.length, h('div', { class: 'body tall' }, ideas.length ? ideas : empty('No new test ideas'))));
}

/* ---------- Meetings ---------- */
function standupNode(su) {
  const part = (cls, title, list) => list?.length ? [h('h4', { class: cls }, title), h('ul', {}, list.map((x) => h('li', {}, x)))] : [];
  return h('div', { class: 'su' }, part('d', 'Done', su.done), part('n', 'Next', su.next), part('b', 'Blockers', su.blockers?.length ? su.blockers : ['None']));
}
const standupText = (su) => `Done:\n${(su.done || []).map((x) => `• ${x}`).join('\n')}\n\nNext:\n${(su.next || []).map((x) => `• ${x}`).join('\n')}\n\nBlockers:\n${(su.blockers?.length ? su.blockers : ['None']).map((x) => `• ${x}`).join('\n')}`;

function renderMeetings() {
  const box = $('meet');
  box.replaceChildren();
  const m = D.ai.meetings;
  if (!m) return box.append(h('div', { class: 'panel empty' }, 'No meeting prep yet. Press ✦ AI scan.'));
  const now = Date.now(), today = new Date().toDateString();
  const list = [...(m.meetings || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  const rows = list.map((x) => {
    const s = new Date(x.start), e = new Date(x.end || x.start);
    const state = e < now ? 'past' : s <= now ? 'now' : '';
    const title = x.private ? 'Personal' : x.title;
    return h('div', { class: `mtg ${x.kind === 'standup' ? 'standup' : ''} ${state}` },
      h('div', { class: 'time' }, time(x.start), h('small', {}, s.toDateString() === today ? `${Math.round((e - s) / 60000)} min` : s.toLocaleDateString([], { weekday: 'short' }))),
      h('div', { class: 'rail' }),
      h('div', { class: 't', style: 'flex:1;min-width:0' },
        h('b', {}, x.url ? h('a', { href: x.url }, title) : title), ' ',
        x.kind && !x.private && h('span', { class: `pill ${x.kind === 'standup' ? 'green' : ''}` }, x.kind),
        !x.private && itemActions('meet', refs.meeting(x)),
        !x.private && x.prep?.length ? h('ul', {}, x.prep.map((p) => h('li', {}, p))) : null));
  });
  box.append(panel('Today', list.filter((x) => new Date(x.start).toDateString() === today).length, h('div', { class: 'body tall' }, rows.length ? rows : empty('No meetings today'))));
  const sus = list.filter((x) => x.standup);
  const cards = sus.map((x) => panel(`${x.title} · ${new Date(x.start).toLocaleDateString([], { weekday: 'short' })} ${time(x.start)}`, null, standupNode(x.standup),
    [h('button', { class: 'btn sm', onclick: () => copy(standupText(x.standup), 'Status copied') }, 'Copy'), h('button', { class: 'btn sm go', onclick: () => { $('reader-body').className = ''; $('reader-body').replaceChildren(h('h3', {}, x.title), standupNode(x.standup)); $('reader').hidden = false; } }, 'Read mode')]));
  box.append(cards.length ? h('div', { class: 'grid' }, cards) : h('div', { class: 'panel empty' }, 'No standup coming up'));
}

// Re-rendering replaces panels, which would reset every scroll box (and can nudge the page).
// Remember each scrollable area's position and put it back; chats stick to the bottom if you were there.
const SCROLLERS = 'main .body, main .chat, main .cmd-log, .ph-list, .feed';
function scrollKey(el) {
  const sec = el.closest('section, #phone');
  const same = sec ? [...sec.querySelectorAll(SCROLLERS)].filter((x) => x.className === el.className) : [];
  return `${sec?.id || 'page'}|${el.className}|${same.indexOf(el)}`;
}
// A chat box follows new messages only while you're at its bottom; scrolled up, it stays put.
function chatPos(el) { return el ? { top: el.scrollTop, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 6 } : null; }
function restoreChat(el, st) { if (el) el.scrollTop = !st || st.bottom ? el.scrollHeight : st.top; }

// Keep what you are reading still: remember the element at the top of the screen (as a path of child
// positions from the nearest element with an id) and where it sat, then scroll by however far it moved.
// So an AI run growing a section above you no longer pushes the section you're reading.
function viewAnchor() {
  const main = document.querySelector('main');
  if (!main || window.scrollY < 1) return null; // at the very top, stay at the top
  const r = main.getBoundingClientRect();
  let el = document.elementFromPoint(r.left + Math.min(r.width / 2, 260), Math.max(r.top, 0) + 70);
  if (!el || !main.contains(el)) return null;
  const chain = [];
  while (el && el !== main && !el.id) { chain.unshift({ el, top: el.getBoundingClientRect().top }); el = el.parentElement; }
  if (!el || el === main) return null;
  const root = el.id, rootTop = el.getBoundingClientRect().top;
  const path = chain.map(({ el: c, top }) => ({ i: [...c.parentElement.children].indexOf(c), top }));
  return { root, rootTop, path };
}
function keepAnchor(a) {
  if (!a) return;
  let node = document.getElementById(a.root);
  if (!node) return;
  let before = a.rootTop, after = node.getBoundingClientRect().top;
  for (const p of a.path) {
    const next = node.children[p.i];
    if (!next) break;
    node = next; before = p.top; after = next.getBoundingClientRect().top;
  }
  const d = after - before;
  if (Math.abs(d) > 1) window.scrollTo({ top: window.scrollY + d, behavior: 'instant' }); // instant: the page's smooth scrolling would show the jump
}
function render() {
  const saved = new Map();
  for (const el of document.querySelectorAll(SCROLLERS)) {
    if (el.scrollHeight <= el.clientHeight) continue;
    saved.set(scrollKey(el), { top: el.scrollTop, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 6 });
  }
  const anchor = viewAnchor();
  renderPage();
  for (const el of document.querySelectorAll(SCROLLERS)) {
    const st = saved.get(scrollKey(el));
    const isChat = el.classList.contains('chat');
    if (st) el.scrollTop = isChat && st.bottom ? el.scrollHeight : st.top;
    else if (isChat) el.scrollTop = el.scrollHeight; // a chat you just opened starts at the newest message
  }
  keepAnchor(anchor);
}
function renderPage() {
  const hr = new Date().getHours();
  $('greet').textContent = theme() === 'vice' ? 'Work Center' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  $('date').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const stamps = Object.values(D.ai).map((p) => p.generatedAt).filter(Boolean).sort();
  $('stamp').textContent = `Live ${time(D.live.fetchedAt)}${stamps.length ? ` · AI ${new Date(stamps[0]).toLocaleDateString([], { weekday: 'short' })} ${time(stamps[0])}` : ''}`;
  const b = $('banner');
  const stale = stamps.length && new Date(stamps[0]).toDateString() !== new Date().toDateString();
  const msg = D.aiRun?.running ? 'AI scan is running. This takes a few minutes; the page updates when it finishes.'
    : D.aiRun?.error ? `AI scan failed: ${D.aiRun.error}` : 'The AI scan (Slack, meetings, suggestions) is from an earlier day. It runs on its own each morning; press ✦ AI scan to refresh it now.';
  // A closed banner stays closed until its message changes (or tomorrow).
  const key = `${new Date().toDateString()}|${msg}`;
  let closed = null; try { closed = localStorage.getItem('bannerClosed'); } catch (e) { /* storage off */ }
  b.hidden = !(D.aiRun?.error || D.aiRun?.running || stale) || closed === key;
  b.replaceChildren(h('span', {}, msg), h('button', { class: 'banner-x', title: 'Close', 'aria-label': 'Close this message',
    onclick: () => { try { localStorage.setItem('bannerClosed', key); } catch (e) { /* storage off */ } b.hidden = true; } }, '×'));
  $('btn-ai').disabled = !!D.aiRun?.running;
  scheduleFastPoll(); renderFlow(); renderHQ(); checkNewPings(!render.once); render.once = true; renderGithub(); renderJira(); renderSlack(); renderWork(); renderMeetings();
  for (const s of FLOW) if (s.render) { try { s.render($(s.id)); } catch (e) { $(s.id).replaceChildren(h('div', { class: 'panel err' }, `${s.name}: ${e.message}`)); } }
  for (const fn of HQ._render) { try { fn(); } catch (e) { console.error(e); } }
}

async function load(force) {
  $('btn-refresh').disabled = true;
  try {
    D = await (await fetch(`/api/all${force ? '?force' : ''}`)).json();
    render();
    noteFinished();
    if (D.aiRun?.running || (D.commands || []).some((c) => c.running) || Object.values(D.prdRuns || {}).some((r) => r.running)) setTimeout(() => load(false), 15000);
    // Cached lists came back while a background refresh runs: pick up the fresh ones when it lands.
    else if (D.liveRefreshing) setTimeout(() => load(false), 4000);
  } catch (e) {
    toast(`Could not load: ${e.message}`);
  } finally {
    $('btn-refresh').disabled = false;
  }
}

$('btn-refresh').onclick = () => load(true);
$('btn-ai').onclick = async () => { await post('/api/refresh-ai'); load(false); };
$('reader-close').onclick = () => ($('reader').hidden = true);
$('reader').onclick = (e) => { if (e.target.id === 'reader') $('reader').hidden = true; };
for (const id of ['github', 'jira', 'slack', 'work', 'meet']) $(id).append(h('div', { class: 'skeleton' }));
initChrome();
load(false);
setInterval(() => load(false), 5 * 60 * 1000);

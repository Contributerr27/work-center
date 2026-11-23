/* Work Center extras: per-item AI buttons, task lists (Mission 4), the phone for Slack alerts,
   and header shortcuts to the scoreboard and terminal. Loaded after flow.js, before app.js. */

/* ---------- Per-item buttons: ✦ ask the AI about it, ＋ turn it into a task ---------- */
function itemActions(sectionId, ref) {
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  return h('span', { class: 'iacts' },
    h('button', { class: 'ibtn', title: 'Ask the AI about this', 'aria-label': 'Ask the AI about this', onclick: stop(() => askAbout(sectionId, ref)) }, '✦'),
    h('button', { class: 'ibtn', title: 'Create a task from this (AI reads it and its linked docs)', 'aria-label': 'Create a task from this', onclick: stop(() => createTask(sectionId, ref)) }, '＋'),
    // Jira items: open the project (epic) they belong to, with this item highlighted.
    sectionId !== 'project' && /^[A-Z][A-Z0-9]+-\d+$/.test(ref?.key || '') && window.openProjectFor
      ? h('button', { class: 'ibtn', title: `Open ${ref.key} in its project`, 'aria-label': `Open ${ref.key} in its project`, onclick: stop(() => window.openProjectFor(ref.key)) }, '◫') : null);
}
const refs = {
  slack: (i) => ({ type: 'slack', label: `${i.who}: ${i.summary}`, url: i.url, who: i.who, channel: i.channel, summary: i.summary, draft: i.draft, when: i.when }),
  pr: (p) => ({ type: 'pull request', label: `${p.repoName || (p.repo || '').split('/')[1]} #${p.number} ${p.title}`, url: p.url, author: p.author, repo: p.repo, number: p.number }),
  jira: (i) => ({ type: 'jira issue', label: `${i.key} ${i.title}`, url: i.url, key: i.key, status: i.status, assignee: i.assignee, priority: i.priority }),
  idea: (t) => ({ type: 'test idea', label: t.title, url: t.url, why: t.why, area: t.area, source: t.source }),
  story: (b) => ({ type: 'story breakdown', label: `${b.key} ${b.title}`, url: `${D.config.jiraSite}/browse/${b.key}`, key: b.key, steps: b.steps }),
  meeting: (m) => ({ type: 'meeting', label: `${m.title} · ${time(m.start)}`, title: m.title, start: m.start, prep: m.prep }),
  task: (t) => ({ type: 'task', label: t.title, url: t.source?.url, summary: t.summary, steps: t.steps }),
};

async function createTask(sectionId, ref) {
  try {
    const t = await post('/api/task/create', { section: sectionId, ref });
    toast(t.existing ? `You already have this one: ${t.title} (added this ${t.why === 'same item' ? 'link' : 'message'} to it)` : 'Planning the task… it will show up in Mission 4');
    load(false);
  } catch (e) {
    toast(e.message);
  }
}
async function updateTask(id, patch) {
  try {
    const t = await post('/api/task/update', { id, ...patch });
    if (t.doneAt && patch.done) celebrate({ name: 'Task', mission: t.title });
    load(false);
  } catch (e) {
    toast(e.message);
  }
}

function tasksPanel() {
  const tasks = (D.tasks || []).filter((t) => t.status !== 'duplicate' && (!t.doneAt || Date.now() - new Date(t.doneAt) < 24 * 3600_000));
  const pc = { P0: 'red', P1: 'amber', P2: '' };
  const cards = tasks.map((t) => {
    const done = (t.steps || []).filter((s) => s.done).length;
    return h('div', { class: `tcard ${t.status} ${t.doneAt ? 'fin' : ''}` },
      h('div', { class: 'head' },
        t.status === 'ready' ? ring(done, t.steps.length) : h('span', { class: 'badge' }, t.status === 'failed' ? '!' : '…'),
        h('b', { title: t.title }, t.title),
        t.priority && h('span', { class: `pill ${pc[t.priority] || ''}` }, t.priority),
        t.due && h('span', { class: 'pill' }, `Due ${t.due}`),
        t.status === 'ready' && itemActions('work', refs.task(t)),
        h('button', { class: 'ibtn', title: 'Remove task', onclick: () => confirm(`Remove "${t.title}"?`) && updateTask(t.id, { remove: true }) }, '×')),
      t.status === 'planning' && h('div', { class: 'muted small pulse' }, `✦ Reading ${t.source?.label || 'the item'} and its linked docs…`),
      t.status === 'failed' && h('div', { class: 'blocked' }, t.error || 'Planning failed', ' ',
        h('a', { class: 'link', href: '#', onclick: (e) => { e.preventDefault(); updateTask(t.id, { remove: true }).then(() => createTask(t.source?.section || 'work', { label: t.source?.label || t.title, url: t.source?.url, who: t.source?.who })); } }, 'Try again')),
      t.summary && h('div', { class: 'why' }, t.summary),
      (t.steps || []).map((s, i) => h('label', { class: `step ${s.done ? 'done' : ''}` },
        h('input', { type: 'checkbox', checked: s.done, onchange: (e) => updateTask(t.id, { step: i, done: e.target.checked }) }), h('span', {}, s.text))),
      (t.links?.length || t.source?.url || t.alsoFrom?.length) && h('div', { class: 'tlinks' },
        t.source?.url && h('a', { class: 'link', href: t.source.url }, 'Source'),
        (t.alsoFrom || []).map((s, i) => s.url
          ? h('a', { class: 'link', href: s.url, title: `Also asked: ${s.label}` }, `Also ${s.who || `#${i + 2}`}`)
          : h('span', { class: 'pill', title: s.label }, `+ ${s.section === 'meet' ? 'meeting' : 'item'}`)),
        (t.links || []).slice(0, 5).map((l) => h('a', { class: 'link', href: l.url }, l.label))));
  });
  const p = panel('My tasks', cards.length, h('div', { class: 'body tall tgrid' }, cards.length ? cards : empty('Use ＋ on any Slack message, PR, ticket or idea to turn it into a task here')));
  p.classList.add('wide');
  return p;
}

/* ---------- The phone: Slack alerts from the 5-minute scan ---------- */
let phoneQueue = [];
let phoneOpen = false;
const shownPings = new Set();
function pingRef(p) { return refs.slack(p); }

function renderPhone() {
  const el = $('phone');
  const pings = (D?.pings?.items || []).filter((p) => !p.dismissed);
  phoneQueue = phoneQueue.filter((p) => !gone.has(p.id));
  const unseen = pings.filter((p) => !p.seen);
  const badge = $('phone-badge');
  badge.textContent = unseen.length;
  badge.hidden = !unseen.length;
  if (!phoneOpen || !D) return (el.hidden = !phoneOpen);
  el.hidden = false;
  const scan = D.pings?.scan || {};
  const list = phoneQueue.length ? phoneQueue : pings.slice(0, 12);
  const kindTxt = { reply: 'Reply', 'follow-up': 'Follow up', ask: 'Ask', fyi: 'FYI', approve: 'Needs your OK' };
  el.replaceChildren(h('div', { class: 'ph' },
    h('div', { class: 'ph-top' }, h('span', {}, new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), h('i', { class: 'notch' }), h('span', {}, '▮▮▮')),
    h('div', { class: 'ph-head' }, h('b', {}, phoneQueue.length ? 'New messages' : 'Messages'),
      list.length > 1 && h('button', { class: 'btn sm ghost', title: 'Mark every message here as handled and remove it', onclick: () => dismissPings(list.map((p) => p.id)) }, '✓ Clear all'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'ibtn', title: 'Close', onclick: closePhone }, '×')),
    h('div', { class: 'ph-list' }, list.length ? list.map((p) => h('div', { class: `ph-msg u${p.urgency || 1} ${p.seen ? 'seen' : ''}` },
      h('div', { class: 'ph-from' }, avatar(p.who), h('span', { class: 't' }, h('b', {}, `${SRC_ICON[p.source] || ''} ${p.who || ''}`), h('small', {}, `${p.channel || ''} · ${p.when ? (p.kind === 'invite' ? new Date(p.when).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : time(p.when)) : ''}`)), h('span', { class: 'pill' }, p.answered ? `✓ ${p.answered}` : kindTxt[p.kind] || 'New')),
      h('div', { class: 'ph-text' }, p.summary),
      p.kind === 'invite' && p.answerError && !p.answering && h('div', { class: 'blocked small' }, `Didn't go through: ${p.answerError}`),
      p.kind === 'approve' && p.detail ? h('div', { class: 'ph-detail small muted' }, p.detail) : null,
      // A teammate (Team view) asks for the go-ahead on one outward action.
      p.kind === 'approve' ? h('div', { class: 'ph-acts' },
        p.answered ? h('span', { class: `pill ${p.answered === 'declined' ? 'red' : 'green'}` }, p.answered === 'declined' ? '✕ Declined' : '✓ Approved')
          : [h('button', { class: 'btn sm go', title: 'Approve: the teammate does exactly this now', onclick: () => resolveTeam(p, 'approve') }, 'Approve'),
            h('button', { class: 'btn sm ghost', onclick: () => resolveTeam(p, 'decline') }, 'Decline')],
        p.url && h('a', { class: 'btn sm ghost', href: p.url }, 'Open'),
        window.openTeam && h('button', { class: 'btn sm ghost', title: 'Open this teammate', onclick: () => { closePhone(); window.openTeam(p.teamMember); } }, 'Team'))
      : p.kind === 'invite' ? h('div', { class: 'ph-acts' },
        p.answered ? h('span', { class: `pill ${p.answered === 'declined' ? 'red' : p.answered === 'tentative' ? 'amber' : 'green'}` }, `✓ ${{ accepted: 'Accepted', tentative: 'Maybe', declined: 'Declined' }[p.answered]}`)
          : p.answering ? h('span', { class: 'pill violet pulse' }, `✦ Sending ${p.answering.answer === 'tentative' ? 'maybe' : p.answering.answer.replace(/ed$/, '')}…`)
          : [['accepted', 'Accept', 'go'], ['tentative', 'Maybe', ''], ['declined', 'Decline', 'ghost']].map(([ans, label, cls]) => h('button', { class: `btn sm ${cls}`, onclick: () => answerInvite(p, ans, label) }, label)),
        p.url && h('a', { class: 'btn sm ghost', href: p.url }, 'Open'),
        h('button', { class: 'btn sm ghost ph-ok', title: 'Got it: remove from the phone', 'aria-label': 'Acknowledge and remove', onclick: () => dismissPings([p.id]) }, '✓'))
      : h('div', { class: 'ph-acts' },
        p.kind !== 'fyi' && h('button', { class: 'btn sm go', onclick: async () => { const pre = p.draft ? (p.source === 'gmail' ? `Reply to this email with: "${p.draft}"` : `Reply in the thread with: "${p.draft}"`) : ''; if (PANEL_MODE && await shellMain('askAbout', 'slack', pingRef(p), pre)) return; closePhone(); askAbout('slack', pingRef(p), pre); } }, 'Reply'),
        h('button', { class: 'btn sm', onclick: () => { closePhone(); createTask('slack', pingRef(p)); } }, '＋ Task'),
        p.url && h('a', { class: 'btn sm ghost', href: p.url }, 'Open'),
        h('button', { class: 'btn sm ghost ph-ok', title: 'Got it: remove from the phone', 'aria-label': 'Acknowledge and remove', onclick: () => dismissPings([p.id]) }, '✓'))))
      : h('div', { class: 'empty' }, 'No new messages')),
    h('div', { class: 'ph-foot muted small' },
      scan.running ? 'Checking Slack…' : scan.lastError ? `Last check failed: ${scan.lastError}` : `Checked ${scan.lastAt ? time(scan.lastAt) : 'not yet'} · every ${scan.every || 5} min`,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm ghost', disabled: !!scan.running, onclick: async () => { await post('/api/pings/scan'); pollPings(); } }, 'Check now'))));
}
// Acknowledge: the message leaves the phone (and Mission 3) for good.
const gone = new Set();
async function dismissPings(ids) {
  ids.forEach((id) => gone.add(id));
  for (const p of D.pings?.items || []) if (ids.includes(p.id)) p.dismissed = true;
  renderPhone();
  try {
    await post('/api/pings/dismiss', { ids });
    load(false);
  } catch (e) {
    toast(e.message);
  }
}
const SRC_ICON = { gmail: '✉', calendar: '📅', slack: '', team: '' };
async function resolveTeam(p, decision) {
  let note = '';
  if (decision === 'decline') { note = prompt('Decline. Tell them why (optional): it goes into their next shift.') ?? null; if (note === null) return; }
  try {
    await post('/api/team/resolve', { id: p.teamItem, decision, note });
    p.answered = decision === 'approve' ? 'approved' : 'declined';
    renderPhone();
    toast(decision === 'approve' ? `Approved · ${p.who} is doing it now` : 'Declined');
    setTimeout(() => dismissPings([p.id]), 1500);
  } catch (e) { toast(e.message); }
}
async function answerInvite(p, answer, label) {
  if (!confirm(`${label} "${p.summary}"? This answers the invite in your calendar.`)) return;
  try {
    await post('/api/mail/invite', { pingId: p.id, answer });
    p.answering = { answer };
    renderPhone();
    toast(`Sending ${label}… it clears from the phone once it's done`);
    pollPings();
  } catch (e) {
    toast(e.message);
  }
}
async function closePhone() {
  if (PANEL_MODE === 'phone') { shellPanel('phone', { open: false }); return; }
  phoneOpen = false;
  const ids = phoneQueue.map((p) => p.id);
  phoneQueue = [];
  renderPhone();
  if (ids.length) { await post('/api/pings/seen', { ids }); pollPings(); }
}
function openPhone() { phoneOpen = true; renderPhone(); }

function playRing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1320; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.14);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch (e) { /* audio unavailable */ }
}

function checkNewPings(first) {
  const fresh = (D.pings?.items || []).filter((p) => !p.seen && !shownPings.has(p.id));
  fresh.forEach((p) => shownPings.add(p.id));
  if (first || !fresh.length || PANEL_MODE) return renderPhone();
  const quiet = (() => { try { return !!window.HQ_FOCUS_QUIET?.(); } catch (e) { return false; } })();
  const ring = quiet ? fresh.filter((p) => (p.urgency || 1) >= 3) : fresh;
  if (!ring.length) return renderPhone(); // held until focus ends; still in the phone list and badge
  phoneQueue = [...ring, ...phoneQueue];
  playRing();
  shellPanel('phone', { open: true }).then((inPanel) => { if (!inPanel) { phoneOpen = true; renderPhone(); } });
  renderPhone();
}

async function pollPings() {
  if (!D) return;
  try {
    const r = await (await fetch('/api/pings')).json();
    const wasRunning = (D.commands || []).some((c) => c.running);
    D.pings = { items: r.items, lastScanAt: r.lastScanAt, scan: { ...(D.pings?.scan || {}), ...r.scan } };
    D.commands = r.commands;
    checkNewPings(false);
    const finished = noteFinished();
    if (finished) load(false); // a run just ended: pick up new tasks and desk files right away
    const sig = commandsSig();
    if (sig !== lastSig) { lastSig = sig; render(); }
    if (wasRunning && !r.commands.some((c) => c.running)) load(true); // a run just ended: refresh live data
  } catch (e) { /* server restarting */ }
}

/* ---------- Header shortcuts ---------- */
function renderHQ() {
  const r = window.respectToday?.();
  $('respect').textContent = r == null ? '' : `${term('score')} ${r}`;
  $('respect').hidden = r == null;
}
let hqStarted = false;
function initHQ() {
  // Messages open in a panel attached to the left of the window (in a browser: inside the page).
  $('btn-phone').onclick = async () => { if (await shellPanel('phone', { toggle: true })) return; phoneOpen ? closePhone() : openPhone(); };
  if (PANEL_MODE === 'phone') { phoneOpen = true; HQ.onRender(renderPhone); setInterval(pollPings, 8000); }
  $('btn-score').onclick = () => (window.openScoreboard ? window.openScoreboard('today') : toast('Scoreboard is not installed yet'));
  $('respect').onclick = () => window.openScoreboard?.('today');
  $('btn-term').onclick = () => (window.openAICenter ? window.openAICenter() : window.openTerminal?.());
  $('btn-settings').onclick = () => (window.openSettings ? window.openSettings() : toast('Settings are still loading'));
  // Cmd/Ctrl+Shift+T is handled by term.js.
  window.addEventListener('respect', renderHQ);
  if (!hqStarted) { hqStarted = true; setInterval(pollPings, 30_000); }
}

/* ---------- Live progress of AI runs, and items the AI already handled ---------- */
const openFeeds = new Set(); // finished runs whose step list the user opened
const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const ACT_TXT = { approved: 'approved', merged: 'merged', commented: 'commented', moved: 'moved', sent: 'sent' };

function actSummary(c) {
  const n = {};
  for (const a of c.actions || []) n[a.kind] = (n[a.kind] || 0) + 1;
  return Object.entries(n).map(([k, v]) => `${v} ${ACT_TXT[k] || k}`).join(' · ');
}
function liveFeed(c) {
  const acts = actSummary(c);
  const head = h('div', { class: 'feed-head' },
    c.running ? h('span', { class: 'spin' }) : h('span', { class: c.error ? 'fx bad' : 'fx ok' }, c.error ? '✕' : '✓'),
    h('b', {}, c.running ? (c.now || 'Working…') : c.error ? 'Stopped' : 'Finished'),
    h('span', { class: 'muted small' }, [c.steps ? `${c.steps} steps` : null, c.running ? ago(c.startedAt) : null].filter(Boolean).join(' · ')),
    acts && h('span', { class: 'pill green' }, acts),
    c.running && h('button', { class: 'btn sm ghost stopbtn', title: 'Stop this AI run', onclick: async (e) => { e.preventDefault(); e.stopPropagation(); if (!confirm('Stop this AI run? Anything it already did stays done.')) return; try { await post('/api/command/stop', { id: c.id }); toast('Stopping…'); } catch (err) { toast(err.message); } } }, 'Stop'));
  const items = (c.activity || []).slice(c.running ? -6 : -14);
  const list = h('ol', { class: 'feed' }, items.map((a, i) => {
    const last = c.running && i === items.length - 1 && a.kind === 'tool' && !a.done;
    return h('li', { class: `${a.kind} ${a.failed ? 'bad' : ''} ${a.sub ? 'sub' : ''} ${last ? 'now' : ''}` },
      h('span', { class: 'ic' }, a.kind === 'text' ? '›' : a.failed ? '✕' : last ? '' : '✓'), h('span', { class: 't' }, a.label));
  }));
  if (c.running) return h('div', { class: 'live' }, head, items.length ? list : h('div', { class: 'muted small' }, 'Starting up…'));
  if (!items.length) return null;
  return h('details', { class: 'steps-done', open: openFeeds.has(c.id), ontoggle: (e) => (e.target.open ? openFeeds.add(c.id) : openFeeds.delete(c.id)) },
    h('summary', {}, `Show what it did (${c.steps || items.length} steps${acts ? ` · ${acts}` : ''})`), list);
}

// Everything the AI finished today, keyed like the desk's items: "owner/repo#12", "PROJ-123", "C123:1700.1".
function aiMarks() {
  const today = new Date().toDateString(), m = {};
  for (const c of D?.commands || []) {
    if (new Date(c.startedAt).toDateString() !== today) continue;
    for (const a of c.actions || []) (m[a.key] ||= new Set()).add(a.kind);
  }
  return m;
}
function slackMark(url, marks) {
  for (const [k, kinds] of Object.entries(marks)) {
    const [ch, ts] = k.split(':');
    if (kinds.has('sent') && url && url.includes(ch) && (!ts || url.includes(`p${ts.replace('.', '')}`))) return true;
  }
  return false;
}
function aiPill(kinds) {
  if (!kinds) return null;
  const k = kinds.has('merged') ? 'merged' : kinds.has('approved') ? 'approved' : kinds.has('sent') ? 'sent' : kinds.has('moved') ? 'moved' : 'commented';
  return h('span', { class: 'pill green aimark', title: 'Done by the AI just now' }, `✓ AI ${ACT_TXT[k]}`);
}

let fastPoll = null;
function scheduleFastPoll() {
  if (fastPoll || !(D?.commands || []).some((c) => c.running)) return;
  fastPoll = setTimeout(async () => { fastPoll = null; await pollPings(); scheduleFastPoll(); }, 2500);
}
let lastSig = '';
function commandsSig() {
  return (D.commands || []).map((c) => `${c.id}:${c.running}:${c.steps || 0}:${(c.actions || []).length}:${c.now || ''}`).join('|');
}

/* Slack links open in the Slack desktop app at the exact message (via the server), not in a browser tab. */
document.addEventListener('click', async (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || !/^https:\/\/[\w.-]*slack\.com\//.test(a.href)) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    const r = await post('/api/open', { href: a.href });
    toast(r.opened === 'slack-app' ? 'Opening in Slack…' : 'Opening…');
  } catch (err) {
    window.open(a.href, '_blank', 'noopener');
  }
}, true);

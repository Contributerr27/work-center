/* Work Center: the day as steps, one AI command bar per section, and the theme switch.
   Loaded after app.js and uses its helpers (h, $, D, post, toast, markDone, isDone, time, load, render). */
const APPROVE_ALL =
  'Review every PR waiting for my review and every open PR in my repo: read the full diff, the checks and the review comments of each. ' +
  'Approve (gh pr review --approve) each one that is sound: real assertions, no weakened checks or hidden skips, no secrets, follows the repo conventions, CI green. ' +
  'In my repo also squash-merge the ones that are sound, not drafts, CI green and with every review comment resolved. ' +
  'Never undraft a PR, never approve a draft or a release PR (staging to main), never merge outside my repo. ' +
  'Do not comment on PRs you do not approve: list them with the reason in your report. Use subagents in parallel. Then rewrite prs.json.';

const FLOW = [
  { id: 'github', sec: 's-github', name: 'Pull requests', mission: 'Clear the Queue', at: '08:00', ph: 'approve the dependency bumps, summarize the rest…',
    presets: [
      ['✦ Review & approve all', APPROVE_ALL, 'Claude will review every PR, approve the sound ones, and squash-merge sound, green, non-draft PRs in your repo.'],
      ['Refresh verdicts', 'Re-review every open PR in my repo and pick the 5 review requests I should look at first, then rewrite prs.json. Read-only on GitHub.'],
    ] },
  { id: 'jira', sec: 's-jira', name: 'Jira', mission: 'Paper Trail', at: '08:45', ph: 'summarize what changed on my bugs, draft a reply on my ticket…',
    presets: [
      ['Nudge stale bugs', 'For every bug I reported that the desk flags with nudge:true, add one short, friendly Jira comment that mentions the assignee and asks for an ETA or blocker. One comment per ticket; skip tickets where I already commented in the last 7 days.', 'Claude will post one follow-up comment on each stale bug you reported.'],
      ['Draft replies', 'Draft a reply for every Jira mention or question waiting on me and save them in work.json under jiraReplies. Do not post anything.'],
    ] },
  { id: 'slack', sec: 's-slack', name: 'Messages', mission: 'Word on the Street', at: '09:15', ph: 'make the drafts shorter, send the reply to Jacob…',
    presets: [
      ['Send urgent drafts', 'Send the drafted reply for every Slack item with urgency 3, in its own thread, as me. Then remove those items from slack.json.', 'Claude will send the drafted replies for the urgent items in Slack, as you.'],
      ['Rescan Slack', 'Rescan Slack as Part 2 of briefing.md describes and rewrite slack.json. Read-only.'],
    ] },
  { id: 'work', sec: 's-work', name: 'Work', mission: 'The Big Score', at: '09:45', ph: 'scaffold the top test idea as a draft PR…',
    presets: [
      ['Ticket the test ideas', 'Create one Jira task in the TEST project for each P0 and P1 test idea that has no ticket yet, link its source, and add the ticket key to the idea title in work.json.', 'Claude will create Jira tasks for the P0 and P1 test ideas.'],
      ['Refresh next steps', 'Rebuild the story breakdowns as Part 4B of briefing.md describes and rewrite work.json. Read-only.'],
    ] },
  { id: 'meet', sec: 's-meet', name: 'Meetings', mission: 'The Sit-Down', at: '10:15', ph: 'prep me for the CS sync, shorten the standup…',
    presets: [
      ['Refresh standup', "Rebuild my standup status and today's meeting prep as Part 3 of briefing.md describes and rewrite meetings.json. Read-only."],
      ['Prep next meeting', "Write deeper prep for my next meeting today: 5 bullets, open questions, and what I owe people in it. Put it in that meeting's prep in meetings.json. Read-only."],
    ] },
];

/* Feature registry. Feature scripts in public/features/ call these.
   HQ.addMission({ id, sec, name, mission, at: 'HH:MM', ph, presets: [[label, prompt, warnOrNull]], after: 'github',
                   render(box) {...}, count() {...} })   — a new step in the day flow with its own AI bar
   HQ.addButton({ id, label, title, onclick })          — a header button
   HQ.onRender(fn)                                       — called after every page render
   HQ.overlay(id)                                        — get/create a full-window overlay div (close with HQ.closeOverlay(id)) */
// Sidebar places: views on top (full-page overlays), tools below. `view` is the overlay a view opens.
const NAV = {
  'btn-home': { sec: 'nav-views', ord: 0, view: 'home-ov', name: 'Home', icon: 'home' },
  'btn-projects': { sec: 'nav-views', ord: 2, view: 'prj-ov', name: 'Projects', icon: 'projects' },
  'btn-hr': { sec: 'nav-views', ord: 3, view: 'hr-ov', name: 'Growth & HR', icon: 'growth' },
  'btn-focus': { sec: 'nav-tools', ord: 10, name: 'Focus', icon: 'focus' },
  'btn-autopilot': { sec: 'nav-tools', ord: 11, name: 'Autopilot', icon: 'autopilot' },
  'btn-wrap': { sec: 'nav-tools', ord: 12, name: 'Wrap up', icon: 'wrap' },
};
const VIEWS = ['home-ov', 'prj-ov', 'hr-ov', 'aic-ov'];
const HQ = {
  _missions: [], _render: [], _buttons: [], _ready: false,
  addMission(def) {
    if (FLOW.some((s) => s.id === def.id)) return;
    const at = def.after ? FLOW.findIndex((s) => s.id === def.after) + 1 : FLOW.length;
    FLOW.splice(at || FLOW.length, 0, def);
    chat[def.id] = { thread: null, ref: null };
    const sec = h('section', { id: def.sec }, h('div', { class: 'sec-head' }), h('div', { class: 'cmd' }), h('div', { class: 'cmd-log' }), h('div', { class: 'sec-body' }, h('div', { id: def.id })));
    const next = FLOW[FLOW.indexOf(def) + 1];
    $('main').insertBefore(sec, next ? $(next.sec) : null);
    if (HQ._ready) { initBar(def); if (D) render(); }
  },
  // A menu item in the left sidebar. Known views and tools have a fixed place and name (NAV);
  // anything else lands under Tools. The label's first word is the icon ("🎯 Focus").
  addButton(b) {
    const known = NAV[b.id] || {};
    const [icon, ...rest] = String(b.label).split(' ');
    const el = h('button', { id: b.id, class: `nv ${b.cls || ''}`, title: b.title || '', onclick: b.onclick, 'data-ord': known.ord ?? 50, 'data-view': known.view ?? null },
      known.icon && window.icon ? h('span', { class: 'nv-i', 'data-i': known.icon }, window.icon(known.icon)) : h('span', { class: 'nv-i' }, icon), h('span', { class: 'nv-l' }, known.name || rest.join(' ')));
    const sec = $(known.sec || 'nav-tools');
    const after = [...sec.children].find((x) => Number(x.dataset.ord ?? 50) > Number(el.dataset.ord));
    sec.insertBefore(el, after || null);
    return el;
  },
  setLabel(el, text) { const l = el?.querySelector('.nv-l'); if (l) l.textContent = text; else if (el) el.textContent = text; },
  onRender(fn) { HQ._render.push(fn); },
  overlay(id) {
    let el = document.getElementById(id);
    if (!el) { el = h('div', { id, class: 'hq-overlay', hidden: true }); document.body.append(el); }
    return el;
  },
  closeOverlay(id) { const el = document.getElementById(id); if (el) el.hidden = true; },
  _loaded() { if (D) render(); },
};
window.HQ = HQ;

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) { /* storage can be unavailable; the page still works */ }
  return null;
}
document.documentElement.dataset.theme = store('theme') || 'vice';
// Side-panel windows (main.js) load this page with ?panel=ai|phone and show only that panel.
const PANEL_MODE = new URLSearchParams(location.search).get('panel');
if (PANEL_MODE) document.documentElement.classList.add('panel', `panel-${PANEL_MODE}`);
// Ask the app shell to open/close a side panel or to run something in the main window; false in a browser.
async function shellPanel(name, opts = {}) { if (PANEL_MODE && opts.open !== false) return false; try { return !!(await post('/api/ui/panel', { name, ...opts })).handled; } catch (e) { return false; } }
async function shellMain(what, ...args) { try { return !!(await post('/api/ui/main', { do: what, args })).handled; } catch (e) { return false; } }
window.shellPanel = shellPanel; window.shellMain = shellMain;
// Another window changed the theme: follow it.
window.addEventListener('storage', (e) => { if (e.key === 'theme' && e.newValue && e.newValue !== theme()) { document.documentElement.dataset.theme = e.newValue; window.dispatchEvent(new CustomEvent('themechange', { detail: e.newValue })); try { render(); } catch (err) { /* not ready */ } } });
const theme = () => document.documentElement.dataset.theme;
/* Themes: add one with an entry here plus a :root[data-theme="<id>"] block of tokens in app.css
   (and optional extras in public/features/themes.css). `fx` themes get their own effects there. */
const THEMES = [
  { id: 'normal', name: 'Normal', sub: 'Clean and professional; follows light/dark', sw: ['#f6f5f2', '#2f6fdb', '#1f9d61'] },
  { id: 'vice', name: 'Vice', sub: 'Neon coast at dusk, missions and respect', sw: ['#12061f', '#ff2e93', '#4fd8ff'] },
  { id: 'winter', name: 'Winter', sub: 'Alpine morning, frosted glass, snowfall', sw: ['#e8f0f9', '#2a5d96', '#b3122e'] },
];
if (!THEMES.some((t) => t.id === theme())) document.documentElement.dataset.theme = 'vice';
/* Wording follows the theme: plain work words in Normal, missions and Respect in Vice, an alpine
   expedition in Winter. term(key) for labels, stepName(step) for a step's title. */
const TERMS = {
  normal: { day: 'Today', score: 'Score', board: 'Scoreboard', step: null, stepsDone: 'Steps done', passed: 'Done', wrap: 'Wrap up', wrapTitle: 'Day wrap-up', messages: 'Messages', focus: 'Focus', perDay: 'Score per day', bugs: 'My open bugs', stories: 'Stories finished', debrief: 'AI wrap-up', weekly: 'Weekly report' },
  vice: { day: 'Missions', score: 'Respect', board: 'Respect', step: 'Mission', stepsDone: 'Missions passed', passed: 'Mission passed', wrap: 'Debrief', wrapTitle: 'Mission summary', messages: 'Phone', focus: 'Focus mission', perDay: 'Respect per day', bugs: 'Heat on the street', stories: 'Jobs done', debrief: 'Debrief', weekly: 'Weekly report · for the boss' },
  winter: { day: 'Expedition', score: 'Altitude', board: 'Summit log', step: 'Camp', stepsDone: 'Camps reached', passed: 'Camp reached', wrap: 'Back to base', wrapTitle: 'Back at base camp', messages: 'Radio', focus: 'Deep trail', perDay: 'Altitude per day', bugs: 'Avalanche watch', stories: 'Peaks climbed', debrief: 'Fireside debrief', weekly: 'Weekly expedition log' },
};
const WINTER_STEPS = { github: 'Clear the Trail', health: 'Weather Check', jira: 'Read the Map', slack: 'Signals from Base', work: 'The Ascent', meet: 'Fireside Talks' };
const term = (k) => (TERMS[theme()] || TERMS.normal)[k] ?? TERMS.normal[k];
const stepName = (s) => (theme() === 'vice' ? s.mission || s.name : theme() === 'winter' ? s.winter || WINTER_STEPS[s.id] || s.mission || s.name : s.name);
window.term = term; window.stepName = stepName;
// The logo in the menu and the tab icon follow the theme (public/brand/<theme>.png).
function brandIcon() { const src = `brand/${theme()}.png`; const l = document.getElementById('sd-logo'); if (l && !l.src.endsWith(src)) l.src = src; const f = document.querySelector('link[rel="icon"]'); if (f) { f.type = 'image/png'; f.href = src; } }
window.addEventListener('themechange', brandIcon);
document.addEventListener('DOMContentLoaded', brandIcon);
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  store('theme', id);
  window.dispatchEvent(new CustomEvent('themechange', { detail: id }));
  render();
}
function toggleThemeMenu() {
  let m = $('theme-menu');
  if (m && !m.hidden) { m.hidden = true; return; }
  if (!m) { m = h('div', { id: 'theme-menu', role: 'menu', 'aria-label': 'Theme' }); document.body.append(m); }
  const r = $('btn-theme').getBoundingClientRect();
  m.style.left = `${Math.round(r.right + 8)}px`;
  m.style.right = 'auto';
  m.style.top = `${Math.round(r.top)}px`;
  m.replaceChildren(h('div', { class: 'tm-title' }, 'Theme'), ...THEMES.map((t) => h('button', {
    class: `tm-item ${t.id === theme() ? 'on' : ''}`, role: 'menuitemradio', 'aria-checked': t.id === theme() ? 'true' : 'false',
    onclick: () => { m.hidden = true; setTheme(t.id); },
  }, h('span', { class: 'tm-sw' }, t.sw.map((c) => h('i', { style: `background:${c}` }))), h('span', { class: 'tm-t' }, h('b', {}, t.name), h('small', {}, t.sub)), t.id === theme() ? h('span', { class: 'tm-ck' }, '✓') : null)));
  m.hidden = false;
  // Opens beside the menu item; keep it on screen.
  m.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - m.offsetHeight - 8))}px`;
  m.querySelector('.tm-item.on, .tm-item')?.focus();
}
document.addEventListener('click', (e) => { const m = $('theme-menu'); if (m && !m.hidden && !m.contains(e.target) && !e.target.closest?.('#btn-theme')) m.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('theme-menu') && !$('theme-menu').hidden) $('theme-menu').hidden = true; });
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const flowId = (id) => `flow:${dayKey()}:${id}`;
const skipId = (id) => `skip:${dayKey()}:${id}`;
const stepState = (id) => (isDone(flowId(id)) ? 'done' : isDone(skipId(id)) ? 'skipped' : 'todo');
let focus = null; // a step the user picked; otherwise the pointer decides
let showAll = store('showAll') === '1';

function meetingSoon() {
  const now = Date.now();
  return (D.ai.meetings?.meetings || []).some((m) => { const t = new Date(m.start) - now; return t > 0 && t < 20 * 60000; });
}
// Where the day points you: a meeting about to start, else the first open step, else the first skipped one.
function pointer() {
  if (meetingSoon() && stepState('meet') === 'todo') return 'meet';
  return (FLOW.find((s) => stepState(s.id) === 'todo') || FLOW.find((s) => stepState(s.id) === 'skipped'))?.id || null;
}
const current = () => focus || pointer();

function counts() {
  const g = D.live.github.data, j = D.live.jira.data, ai = D.ai, today = new Date().toDateString();
  const slack = (ai.slack?.items || []).filter((i) => !isDone(`sl:${i.url}`));
  return {
    github: g ? g.repoPRs.length + g.reviewRequests.length : '–',
    jira: j ? j.prdQa.length + j.bugs.filter((b) => b.nudge).length : '–',
    slack: slack.length,
    work: (ai.work?.testIdeas || []).filter((t) => !isDone(`ti:${t.title}`)).length + (ai.work?.breakdowns || []).length + (D.tasks || []).filter((t) => !t.doneAt).length,
    meet: (ai.meetings?.meetings || []).filter((x) => new Date(x.start).toDateString() === today).length,
    ...Object.fromEntries(FLOW.filter((s) => s.count).map((s) => [s.id, (() => { try { return s.count(); } catch (e) { return '–'; } })()])),
  };
}

// Workload stars: 0 on weekends, 1 to 5 on weekdays, from the work still open today.
// Finished steps stop counting, so the stars drop as you clear the day.
const LOADS = ['Day off', 'Light day', 'Steady day', 'Busy day', 'Heavy day', 'Max day'];
const STAR_AT = [8, 16, 26, 38]; // points needed for 2, 3, 4 and 5 stars
function workload() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return { stars: 0, label: LOADS[0], why: 'Weekend: no stars' };
  const g = D.live.github.data, j = D.live.jira.data, ai = D.ai, today = new Date().toDateString();
  const first = new Set((ai.prs?.reviewFirst || []).map((p) => `${p.repo}#${p.number}`));
  const parts = {
    github: g ? g.repoPRs.length + g.reviewRequests.reduce((a, p) => a + (first.has(`${p.repo}#${p.number}`) ? 1 : 0.3), 0) : 0,
    jira: j ? j.prdQa.reduce((a, p) => a + (APPROVED_QA.includes(p.qaStatus) ? 0.5 : p.qaStatus === 'Test Plan Drafted' ? 1 : 2.5), 0)
      + j.bugs.filter((b) => b.nudge).length * 0.3
      + (ai.work?.jiraReplies || []).filter((r) => !isDone(`jr:${r.key}`)).length : 0,
    slack: (ai.slack?.items || []).filter((i) => !isDone(`sl:${i.url}`)).reduce((a, i) => a + ({ 3: 2, 2: 1 }[i.urgency] || 0.5), 0),
    work: (ai.work?.breakdowns || []).length + (ai.work?.testIdeas || []).filter((t) => t.priority === 'P0' && !isDone(`ti:${t.title}`)).length
      + (D.tasks || []).filter((t) => t.status === 'ready' && !t.doneAt).length,
    meet: (ai.meetings?.meetings || []).filter((x) => !x.private && new Date(x.start).toDateString() === today).reduce((a, x) => a + (x.kind === 'standup' ? 1.5 : 1), 0),
  };
  for (const s of FLOW) if (s.load) { try { parts[s.id] = s.load(); } catch (e) { parts[s.id] = 0; } }
  const open = FLOW.filter((s) => stepState(s.id) !== 'done');
  const pts = open.reduce((a, s) => a + (parts[s.id] || 0), 0);
  const stars = Math.min(5, 1 + STAR_AT.filter((t) => pts >= t).length);
  const why = `Workload ${stars} of 5 (${Math.round(pts)} points still open today)\n` +
    FLOW.map((s) => `${s.name}: ${stepState(s.id) === 'done' ? 'done' : Math.round((parts[s.id] || 0) * 10) / 10}`).join('\n');
  return { stars, label: LOADS[stars], why };
}

function celebrate(step) {
  if (!term('step')) return toast(`${step.name} done`);
  const el = $('passed');
  el.replaceChildren(h('div', {}, h('b', {}, term('passed')), h('span', {}, stepName(step)), h('small', {}, `${term('score')} +`)));
  el.hidden = false;
  clearTimeout(celebrate.t);
  celebrate.t = setTimeout(() => (el.hidden = true), 1900);
}
async function finishStep(step, how) {
  await markDone(how === 'done' ? flowId(step.id) : skipId(step.id));
  focus = null;
  if (how === 'done') celebrate(step);
  render();
  const next = pointer();
  if (next) $(FLOW.find((s) => s.id === next).sec).scrollIntoView();
}
async function reopenStep(step) {
  if (isDone(flowId(step.id))) await markDone(flowId(step.id), false);
  if (isDone(skipId(step.id))) await markDone(skipId(step.id), false);
  focus = step.id;
  render();
}

function renderFlow() {
  const themed = !!term('step'), cur = current(), n = counts();
  const hhmm = new Date().toTimeString().slice(0, 5);
  $('tiles').replaceChildren(...FLOW.map((s, i) => {
    const st = stepState(s.id);
    const late = st === 'todo' && hhmm > s.at && s.id !== cur;
    return h('div', { class: `tile step-${st} ${s.id === cur ? 'cur' : ''}`, title: `Planned for ${s.at}`, onclick: () => { focus = s.id; render(); $(s.sec).scrollIntoView(); } },
      h('span', { class: 'badge' }, st === 'done' ? '✓' : st === 'skipped' ? '↷' : i + 1),
      h('span', { class: 'l' }, h('b', {}, themed ? stepName(s) : s.name), h('small', {}, st === 'done' ? 'Done' : st === 'skipped' ? 'Skipped' : s.id === cur ? 'Now' : late ? `Was ${s.at}` : s.at)),
      h('span', { class: 'n' }, n[s.id]));
  }));
  const left = FLOW.filter((s) => stepState(s.id) !== 'done').length;
  const wl = workload();
  $('heat').replaceChildren(...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= wl.stars ? 'on' : '' }, '★')), h('small', {}, wl.label));
  $('heat').title = wl.why;
  $('btn-all').textContent = showAll ? 'Focus mode' : 'Show all';
  HQ.setLabel($('btn-theme'), `Theme · ${(THEMES.find((t) => t.id === theme()) || THEMES[0]).name}`);
  // Sidebar names follow the theme too.
  HQ.setLabel($('nav-day'), term('day')); HQ.setLabel($('btn-score'), term('board'));
  HQ.setLabel($('btn-phone'), term('messages')); if ($('btn-wrap')) HQ.setLabel($('btn-wrap'), term('wrap'));
  for (const [i, s] of FLOW.entries()) {
    const sec = $(s.sec), st = stepState(s.id), isCur = s.id === cur;
    sec.className = `${isCur ? 'cur' : ''} ${!showAll && !isCur ? 'collapsed' : ''} step-${st}`;
    sec.querySelector('.sec-head').replaceChildren(...[
      h('span', { class: 'badge' }, st === 'done' ? '✓' : i + 1),
      h('h2', { onclick: () => { focus = s.id; render(); } }, themed ? `${term('step')} ${i + 1} · ${stepName(s)}` : s.name, themed && h('small', {}, s.name)),
      h('span', { class: 'count' }, n[s.id]),
      h('span', { class: 'spacer' }),
      st !== 'todo' && h('button', { class: 'btn sm ghost', onclick: () => reopenStep(s) }, 'Reopen'),
      st === 'todo' && isCur && h('button', { class: 'btn sm ghost', title: 'Come back to this after the other steps', onclick: () => finishStep(s, 'skip') }, 'Skip for now'),
      st !== 'done' && isCur && h('button', { class: 'btn sm go', onclick: () => finishStep(s, 'done') }, left > 1 ? '✓ Done · next' : '✓ Done')].filter(Boolean));
    renderLog(s);
  }
}

/* ---------- AI command bar, one per section: chats with follow-ups and item references ---------- */
const chat = Object.fromEntries(FLOW.map((s) => [s.id, { thread: null, ref: null }]));
const inputs = {};

async function sendCommand(step, text, warn, { fresh } = {}) {
  text = (text || '').trim();
  if (text.length < 2) return toast('Type what the AI should do');
  if (warn && !confirm(`${warn}\n\nIt runs in the background and reports back here. Go ahead?`)) return;
  const c = chat[step.id];
  try {
    const r = await post('/api/command', { section: step.id, text, ref: c.ref, thread: fresh ? null : c.thread });
    c.thread = r.thread;
    c.ref = null;
    toast('AI is on it');
    load(false);
  } catch (e) {
    toast(e.message);
  }
}

// Point the AI at one item: it becomes a chip on that section's bar and goes with the next message.
function askAbout(sectionId, ref, prefill) {
  // Views with their own AI box (Projects, HR) take the item there.
  if (!chat[sectionId] && window.HQ_ASK?.[sectionId]) return window.HQ_ASK[sectionId](ref, prefill);
  const c = chat[sectionId];
  c.ref = ref;
  c.thread = null; // a new item starts a new chat
  focus = sectionId;
  render();
  const step = FLOW.find((s) => s.id === sectionId);
  $(step.sec).scrollIntoView();
  const input = inputs[sectionId];
  if (prefill != null) input.value = prefill;
  input.focus();
}

function renderChip(step) {
  const c = chat[step.id], box = $(step.sec).querySelector('.chips');
  box.replaceChildren(...[
    c.ref && h('span', { class: 'chip', title: c.ref.label }, h('span', { class: 'chip-t' }, `↳ ${c.ref.label}`),
      h('button', { class: 'chip-x', title: 'Remove', onclick: () => { c.ref = null; renderChip(step); } }, '×')),
    c.thread && h('span', { class: 'chip thread' }, 'Follow-up in this chat',
      h('button', { class: 'chip-x', title: 'Start a new chat', onclick: () => { c.thread = null; render(); } }, '×'))].filter(Boolean));
  inputs[step.id].placeholder = c.ref || c.thread ? 'Ask a question or tell the AI what to do…' : `Tell the AI what to do: ${step.ph}`;
}

const bubble = (c) => [
  h('div', { class: 'msg me' }, c.ref && h('span', { class: 'chip sm' }, `↳ ${c.ref.label}`), h('span', {}, c.text)),
  h('div', { class: `msg ai ${c.error ? 'bad' : ''}` }, c.running ? liveFeed(c) : [c.error || c.result, liveFeed(c)]),
];
function renderLog(step) {
  renderChip(step);
  const box = $(step.sec).querySelector('.cmd-log');
  const c = chat[step.id];
  const mine = (D.commands || []).filter((x) => x.section === step.id && x.kind !== 'task');
  if (c.thread) {
    const thread = mine.filter((x) => x.thread === c.thread).reverse();
    return box.replaceChildren(h('div', { class: 'chat' }, thread.flatMap(bubble)));
  }
  const heads = [...new Map(mine.map((x) => [x.thread, x])).values()].slice(0, 3);
  box.replaceChildren(...heads.map((x, i) => h('details', { class: 'log', open: x.running || (i === 0 && !openFeeds.has(`closed:${x.id}`)), ontoggle: (e) => (!e.target.open ? openFeeds.add(`closed:${x.id}`) : openFeeds.delete(`closed:${x.id}`)) },
    h('summary', {},
      h('span', { class: `pill ${x.running ? 'blue pulse' : x.error ? 'red' : 'green'}` }, x.running ? `✦ ${x.steps ? `Step ${x.steps}` : 'Working…'}` : x.error ? '✕ Failed' : '✓ Done'),
      h('span', { class: 't' }, x.text), h('span', { class: 'muted small' }, time(x.startedAt)),
      !x.running && h('button', { class: 'btn sm ghost', onclick: (e) => { e.preventDefault(); c.thread = x.thread; render(); inputs[step.id].focus(); } }, 'Follow up')),
    x.running ? liveFeed(x) : [h('div', { class: 'draft' }, x.error || x.result), liveFeed(x)])));
}

const seenRunning = new Set();
function noteFinished() {
  let any = false;
  for (const c of D.commands || []) {
    if (c.running) seenRunning.add(c.id);
    else if (seenRunning.delete(c.id) && (any = true)) toast(c.kind === 'task' ? (c.duplicateOf ? `You already have this one: ${c.duplicateOf.title} (added it there)` : c.error ? 'Task planning failed' : 'New task ready in Mission 4') : c.error ? 'AI command failed' : 'AI answered');
  }
  return any;
}
function initBar(s) {
  const input = h('input', { type: 'text', placeholder: `Tell the AI what to do: ${s.ph || ''}`, 'aria-label': `AI command for ${s.name}` });
  inputs[s.id] = input;
  const go = () => { const v = input.value; input.value = ''; sendCommand(s, v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $(s.sec).querySelector('.cmd').replaceChildren(
    h('span', { class: 'spark' }, '✦'), h('span', { class: 'chips' }), input, h('button', { class: 'btn sm go', onclick: go }, 'Run'),
    ...(s.presets || []).map(([label, text, warn]) => h('button', { class: `btn sm ${warn ? '' : 'ghost'}`, title: text, onclick: () => sendCommand(s, text, warn, { fresh: true }) }, label)));
}
function initChrome() {
  for (const s of FLOW) initBar(s);
  HQ._ready = true;
  $('btn-all').onclick = () => { showAll = !showAll; store('showAll', showAll ? '1' : '0'); render(); };
  $('btn-theme').onclick = (e) => { e.stopPropagation(); toggleThemeMenu(); };
  initHQ();
  initNav();
  // The AI bubble glows faster while any AI run is working.
  // When any AI run finishes it may have changed Work Center's data: open views reload (event 'hq:changed').
  const runningIds = new Set();
  HQ.onRender(() => {
    const cmds = D?.commands || [];
    $('aib-fab')?.classList.toggle('busy', cmds.some((c) => c.running));
    for (const c of cmds) {
      if (c.running) runningIds.add(c.id);
      else if (runningIds.delete(c.id)) window.dispatchEvent(new CustomEvent('hq:changed', { detail: c }));
    }
  });
}

/* ---------- What the user is looking at, for the AI bubble. Views add detail via HQ_VIEWCTX[overlayId]. ---------- */
window.HQ_VIEWCTX = window.HQ_VIEWCTX || {};
function buildViewContext() {
  const open = VIEWS.find((v) => $(v) && !$(v).hidden) || '';
  const base = { view: { 'home-ov': 'Home', 'prj-ov': 'Projects', 'hr-ov': 'Growth & HR', 'aic-ov': 'AI Center' }[open] || 'Day' };
  let extra = {};
  try {
    extra = open ? (window.HQ_VIEWCTX[open]?.() || {}) : { mission: FLOW.find((x) => x.id === current())?.name || null, dataFiles: 'parts/*.json (the desk)' };
  } catch (e) { /* a view without context */ }
  return { ...base, label: base.view, ...extra };
}
// Panels see the main window's view (it posts it to the server); the main window posts on change.
let mainCtx = null, lastPosted = '';
window.viewContext = () => (PANEL_MODE ? mainCtx || { view: 'Work Center', label: 'Work Center' } : buildViewContext());
setInterval(async () => {
  try {
    if (PANEL_MODE) { mainCtx = (await (await fetch('/api/ui/state')).json()).context; return; }
    if (!D) return;
    const body = { context: buildViewContext(), theme: theme() };
    const sig = JSON.stringify(body);
    if (sig !== lastPosted) { lastPosted = sig; await post('/api/ui/state', body); }
  } catch (e) { /* server restarting */ }
}, 1500);

/* ---------- Left sidebar: one view at a time, active item follows whatever view is open ---------- */
function openView(id) {
  for (const v of VIEWS) if (v !== id && $(v) && !$(v).hidden) $(v).hidden = true;
  if (!id) document.documentElement.classList.remove('aic-open');
}
function syncNav() {
  const open = VIEWS.find((v) => $(v) && !$(v).hidden) || '';
  for (const b of document.querySelectorAll('#side .nv[data-view]')) {
    const on = b.dataset.view === open;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}
function initNav() {
  const mini = () => document.documentElement.classList.contains('side-mini');
  const setMini = (v) => {
    document.documentElement.classList.toggle('side-mini', v);
    store('sideMini', v ? '1' : '0');
    HQ.setLabel($('sd-collapse'), v ? 'Expand' : 'Collapse');
    const ci = $('sd-collapse').querySelector('.nv-i'); ci.dataset.i = v ? 'expand' : 'collapse'; window.ICONS?.paintAll(ci.parentElement);
    $('sd-collapse').title = v ? 'Expand the menu' : 'Collapse the menu';
  };
  setMini(store('sideMini') === '1');
  $('sd-collapse').onclick = () => setMini(!mini());
  $('nav-day').onclick = () => { openView(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  // Before a view's own handler opens it, close whichever other view is up.
  $('side').addEventListener('click', (e) => { const b = e.target.closest('.nv[data-view]'); if (b && b.dataset.view) openView(b.dataset.view); }, true);
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; syncNav(); }); } })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  syncNav();
  // ⌘1–⌘5: Home, Day, Projects, Growth & HR, AI Center.
  const keys = ['btn-home', 'nav-day', 'btn-projects', 'btn-hr', 'btn-term'];
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < keys.length && $(keys[i])) { e.preventDefault(); $(keys[i]).click(); }
  });
}

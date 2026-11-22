// Scoreboard and stats for Work Center: how the day, week or month went.
// GitHub through `gh api graphql` (search), Jira through `twg`, plus the desk's own ticks and AI commands.
// Read-only. Works for whoever is logged in to `gh` and `twg`: identities come from the CLIs, never from code.
const { run, parseJson } = require('./collect');

const RANGES = { today: 1, week: 7, month: 30 };
const KEYS = ['prsOpened', 'prsMerged', 'reviews', 'storiesDone', 'bugsFiled', 'bugsFixed', 'steps', 'cleared', 'aiCommands', 'focusBlocks', 'score'];

// Respect score, per day and summed over the range:
//   3 × PR opened + 2 × review given + 2 × PR merged + 5 × story done + 2 × bug filed
//   + 1 × desk step done + 1 × item cleared + 1 × AI command + 2 × 25 minutes of focus
// Bugs fixed are shown but not scored (the fix is someone else's work).
const WEIGHTS = { prsOpened: 3, reviews: 2, prsMerged: 2, storiesDone: 5, bugsFiled: 2, steps: 1, cleared: 1, aiCommands: 1, focusBlocks: 2 };

// Rank ladder over the range score. Thresholds are per day and scale with the range
// (×5 for a week of working days, ×20 for a month), so the titles mean the same pace.
const LADDER = [
  ['Street Rookie', 0], ['Hustler', 10], ['Fixer', 25], ['Lieutenant', 45], ['Boss', 70], ['Kingpin', 100],
];
const SCALE = { today: 1, week: 5, month: 20 };

const TTL = 10 * 60_000;
const cache = {}; // range -> { at, promise }

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyOf = (iso) => (iso ? dayKey(new Date(iso)) : null);

function span(range) {
  const n = RANGES[range];
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1)); // local midnight
  const dates = [];
  for (let i = 0; i < n; i++) dates.push(dayKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)));
  return { from, to, dates };
}

/* ---------- GitHub ---------- */
async function gql(query, vars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v != null) args.push('-f', `${k}=${v}`);
  const res = parseJson(await run('gh', args, { timeout: 60_000 }));
  if (res.errors?.length) throw new Error(res.errors[0].message);
  return res.data;
}

// Every PR matching a search, paged (search returns at most 100 per page, 1000 in all).
async function searchAll(q, fields) {
  const query = `query($q:String!,$after:String){search(type:ISSUE,first:100,query:$q,after:$after){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{${fields}}}}}`;
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const d = await gql(query, { q, after });
    out.push(...d.search.nodes.filter((n) => n && Object.keys(n).length));
    if (!d.search.pageInfo.hasNextPage) break;
    after = d.search.pageInfo.endCursor;
  }
  return out;
}

async function github(cfg, from) {
  const { viewer } = await gql('query{viewer{login}}');
  const me = viewer.login;
  // GitHub search dates are UTC; start a day early and filter by the exact timestamp below.
  const since = dayKey(new Date(from.getTime() - 86_400_000));
  const orgs = (cfg.orgs || []).map((o) => ` org:${o}`).join('');
  const [opened, merged, closed, reviewed, counts] = await Promise.all([
    searchAll(`is:pr author:${me} created:>=${since}${orgs}`, 'createdAt'),
    searchAll(`is:pr author:${me} is:merged merged:>=${since}${orgs}`, 'mergedAt'),
    searchAll(`is:pr author:${me} is:unmerged is:closed closed:>=${since}${orgs}`, 'closedAt'),
    searchAll(`is:pr reviewed-by:${me} -author:${me} updated:>=${since}${orgs}`,
      `url reviews(first:50,author:${JSON.stringify(me)}){nodes{submittedAt state}}`),
    gql(`query{o:search(type:ISSUE,first:0,query:${JSON.stringify(`is:pr is:open author:${me}${orgs}`)}){issueCount}` +
      ` q:search(type:ISSUE,first:0,query:${JSON.stringify(`is:pr is:open review-requested:${me}${orgs}`)}){issueCount}}`),
  ]);
  // A review counts once per PR per day, so a burst of review comments is not ten reviews.
  const reviewDays = {};
  const seen = new Set();
  for (const pr of reviewed) {
    for (const r of pr.reviews?.nodes || []) {
      if (!r.submittedAt || r.state === 'PENDING' || new Date(r.submittedAt) < from) continue;
      const k = `${pr.url}|${keyOf(r.submittedAt)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      reviewDays[keyOf(r.submittedAt)] = (reviewDays[keyOf(r.submittedAt)] || 0) + 1;
    }
  }
  const byDay = (list, field) => {
    const m = {};
    for (const p of list) if (p[field] && new Date(p[field]) >= from) m[keyOf(p[field])] = (m[keyOf(p[field])] || 0) + 1;
    return m;
  };
  return {
    login: me,
    days: { prsOpened: byDay(opened, 'createdAt'), prsMerged: byDay(merged, 'mergedAt'), reviews: reviewDays },
    closedUnmerged: closed.filter((p) => new Date(p.closedAt) >= from).length,
    openPRs: counts.o.issueCount,
    reviewQueue: counts.q.issueCount,
  };
}

/* ---------- Jira ---------- */
async function jql(query, fields) {
  const res = parseJson(await run('twg', ['jira', 'workitem', 'query', query, '--fields', fields, '-n', '100'], { timeout: 90_000 }));
  return res.issues || [];
}

async function jira(cfg, from) {
  const since = `"${dayKey(from)}"`;
  const [stories, filed, fixed] = await Promise.all([
    jql(`assignee = currentUser() AND statusCategory = Done AND resolved >= ${since}`, 'status,issuetype,resolutiondate'),
    jql(`reporter = currentUser() AND issuetype = Bug AND created >= ${since}`, 'status,created'),
    jql(`reporter = currentUser() AND issuetype = Bug AND resolved >= ${since}`, 'status,resolutiondate'),
  ]);
  const byDay = (list, field) => {
    const m = {};
    for (const i of list) if (i[field] && new Date(i[field]) >= from) m[keyOf(i[field])] = (m[keyOf(i[field])] || 0) + 1;
    return m;
  };
  return { storiesDone: byDay(stories, 'resolutiondate'), bugsFiled: byDay(filed, 'created'), bugsFixed: byDay(fixed, 'resolutiondate') };
}

async function openBugs(cfg) {
  const issues = await jql('reporter = currentUser() AND issuetype = Bug AND statusCategory != Done', 'status,priority,created,updated');
  const byPriority = { Highest: 0, High: 0, Medium: 0, Low: 0, Lowest: 0 };
  const byStatus = {};
  let oldestDays = 0, staleCount = 0;
  const age = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  for (const i of issues) {
    const p = i.priority?.name || 'Medium';
    byPriority[p] = (byPriority[p] || 0) + 1;
    const s = i.status?.name || 'Unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (i.created) oldestDays = Math.max(oldestDays, age(i.created));
    const limit = cfg.nudgeAfterDays?.[p] ?? 14;
    if (i.updated && age(i.updated) >= limit) staleCount++;
  }
  return { total: issues.length, byPriority, byStatus, oldestDays, staleCount };
}

/* ---------- desk (ticks and AI commands from the server) ---------- */
function deskDays(desk, from) {
  const steps = {}, cleared = {}, aiCommands = {};
  const add = (m, k) => { if (k) m[k] = (m[k] || 0) + 1; };
  for (const [id, at] of Object.entries(desk?.done || {})) {
    if (!at || new Date(at) < from) continue;
    if (id.startsWith('flow:')) add(steps, id.split(':')[1] || keyOf(at));
    else if (/^(sl|jr|ti|st):/.test(id)) add(cleared, keyOf(at));
  }
  for (const c of desk?.commands || []) if (c.startedAt && !c.error && new Date(c.startedAt) >= from) add(aiCommands, keyOf(c.startedAt));
  const focusBlocks = {};
  if (desk?.dataDir) {
    try {
      const mins = require('./features/focus').focusMinutesByDay(desk.dataDir, from);
      for (const [day, m] of Object.entries(mins)) focusBlocks[day] = Math.floor(m / 25);
    } catch { /* focus feature missing */ }
  }
  return { steps, cleared, aiCommands, focusBlocks };
}

function rankFor(range, score) {
  const k = SCALE[range] || 1;
  let i = 0;
  while (i + 1 < LADDER.length && score >= LADDER[i + 1][1] * k) i++;
  const at = LADDER[i][1] * k;
  const next = LADDER[i + 1];
  return {
    title: LADDER[i][0],
    level: i + 1,
    score,
    nextTitle: next ? next[0] : null,
    nextAt: next ? next[1] * k : null,
    progress: next ? Math.min(1, (score - at) / (next[1] * k - at)) : 1,
    ladder: LADDER.map(([t, s]) => ({ title: t, at: s * k })),
  };
}

async function fetchRemote(config, range) {
  const { from } = span(range);
  const errors = [];
  const settle = (name, p) => p.catch((e) => { errors.push(`${name}: ${e.message}`); return null; });
  const [gh, ji, bugs] = await Promise.all([
    settle('GitHub', github(config.github || {}, from)),
    settle('Jira', jira(config.jira || {}, from)),
    settle('Jira open bugs', openBugs(config.jira || {})),
  ]);
  return { gh, ji, bugs, errors };
}

async function collectStats(config, range, desk) {
  if (!RANGES[range]) range = 'today';
  const { from, to, dates } = span(range);
  let c = cache[range];
  // A day rollover invalidates "today" even inside the TTL.
  if (!c || Date.now() - c.at > TTL || c.from !== from.getTime()) {
    c = cache[range] = { at: Date.now(), from: from.getTime(), promise: fetchRemote(config, range) };
    c.promise.then((r) => { if (r.errors.length) c.at = Date.now() - TTL + 60_000; }); // retry failures after a minute
  }
  const { gh, ji, bugs, errors } = await c.promise;
  const dk = deskDays(desk, from);
  const src = { ...(gh?.days || {}), ...(ji || {}), ...dk };
  const days = dates.map((date) => {
    const d = { date };
    for (const k of KEYS) if (k !== 'score') d[k] = src[k]?.[date] || 0;
    d.score = Object.entries(WEIGHTS).reduce((a, [k, w]) => a + w * d[k], 0);
    return d;
  });
  const totals = Object.fromEntries(KEYS.map((k) => [k, days.reduce((a, d) => a + d[k], 0)]));
  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: new Date(c.at).toISOString(),
    days,
    totals,
    openBugs: bugs || { total: null, byPriority: {}, byStatus: {}, oldestDays: null, staleCount: null },
    github: { openPRs: gh?.openPRs ?? null, reviewQueue: gh?.reviewQueue ?? null, closedUnmerged: gh?.closedUnmerged ?? null, login: gh?.login || null },
    rank: rankFor(range, totals.score),
    weights: WEIGHTS,
    errors: [...errors],
  };
}

module.exports = { collectStats };

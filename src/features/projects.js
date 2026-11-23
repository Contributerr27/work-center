// Projects: one project per Jira epic you own, report, or work under. Shows the epic's stories and
// tasks with deadlines and progress, blockers, linked PRs, and an AI brief of the conversation around it
// (Slack, meetings, email, docs: read-only). Epics fall into quarters from a tag in the title ("26Q4",
// "Q4 2026"), the due date, or when they were resolved; open work always shows in the current quarter.
//   GET  /api/projects?quarter=YYYY-Qn[&force]   projects in that quarter (+ the list of quarters)
//   GET  /api/projects/one?key=EPIC-1            one project: items, blockers, PRs, AI brief
//   GET  /api/projects/for?key=ISSUE-1           the project (epic) an issue belongs to
//   POST /api/projects/brief { key }             (re)build the AI brief for one project
// Settings `projects`: { epicJql, includeParentsOfMine (true), sprintField, flaggedField, cacheMinutes }.
const fs = require('node:fs');
const path = require('node:path');
const { run, parseJson } = require('../collect');
const { makeJobs, readJson } = require('../aijob');

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const qOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-Q${Math.floor(x.getMonth() / 3) + 1}`; };
const qRange = (q) => { const [y, n] = q.split('-Q').map(Number); return [new Date(y, (n - 1) * 3, 1), new Date(y, n * 3, 1)]; };

function tagsOf(title) {
  const out = new Set();
  for (const m of String(title || '').matchAll(/\b(\d{2})\s?Q([1-4])\b/gi)) out.add(`20${m[1]}-Q${m[2]}`);
  for (const m of String(title || '').matchAll(/\bQ([1-4])\s?[-' ]?\s?(20\d{2}|\d{2})\b/gi)) out.add(`${m[2].length === 2 ? `20${m[2]}` : m[2]}-Q${m[1]}`);
  return [...out];
}

function setup(ctx) {
  const DIR = path.join(ctx.DATA, 'projects');
  fs.mkdirSync(DIR, { recursive: true });
  const cfg = () => ({
    epicJql: 'issuetype = Epic AND (assignee = currentUser() OR reporter = currentUser()) ORDER BY updated DESC',
    includeParentsOfMine: true, sprintField: 'customfield_10020', flaggedField: 'customfield_10021', cacheMinutes: 10,
    ...(ctx.config.projects || {}),
  });
  const site = () => ctx.config.jira?.site || '';
  const jobs = makeJobs(ctx);
  let cache = null; // { at, projects: Map key → project, items: Map epic → items[], prs: [], error }
  let lastViewed = null;

  async function jqlAll(query, fields, max = 600) {
    const out = [];
    let after = null;
    while (out.length < max) {
      const args = ['jira', 'workitem', 'query', query, '--fields', fields, '-n', '100', ...(after ? ['--after', after] : [])];
      const raw = await run('twg', args, { timeout: 120_000 });
      const d = parseJson(raw);
      out.push(...(d.issues || []));
      const m = raw.match(/nextCursor:\s*(\S+)/);
      if (!m || !(d.issues || []).length) break;
      after = m[1];
    }
    return out;
  }

  const EPIC_FIELDS = 'summary,status,duedate,resolutiondate,created,updated,priority,assignee,issuetype';
  function epicOf(i) {
    const cat = i.status?.statusCategory?.key || 'new';
    const resolved = i.resolutiondate || (cat === 'done' ? i.updated : null);
    const tags = tagsOf(i.summary);
    const qs = new Set(tags);
    const cur = qOf(new Date());
    if (cat === 'done') qs.add(qOf(resolved));
    else {
      if (i.duedate) qs.add(qOf(i.duedate));
      if (!qs.size || [...qs].some((q) => q <= cur)) qs.add(cur);
    }
    return {
      key: i.key, title: i.summary, url: i.url || `${site()}/browse/${i.key}`, status: i.status?.name, category: cat,
      priority: i.priority?.name || null, due: i.duedate || null, resolved, created: i.created, updated: i.updated,
      assignee: i.assignee?.displayName || null, tags, quarters: [...qs].sort(),
    };
  }

  function itemOf(i, c) {
    const cat = i.status?.statusCategory?.key || 'new';
    const sprints = Array.isArray(i[c.sprintField]) ? i[c.sprintField] : [];
    const sp = sprints.find((s) => s.state === 'active') || sprints.find((s) => s.state === 'future') || sprints[sprints.length - 1] || null;
    const due = i.duedate || (cat !== 'done' && sp?.endDate && sp.state !== 'closed' ? sp.endDate.slice(0, 10) : null);
    const blockedBy = (i.issuelinks || [])
      .filter((l) => l.inwardIssue && /block/i.test(l.type?.inward || '') && l.inwardIssue.fields?.status?.statusCategory?.key !== 'done')
      .map((l) => ({ key: l.inwardIssue.key, title: l.inwardIssue.fields?.summary, status: l.inwardIssue.fields?.status?.name }));
    const flagged = Array.isArray(i[c.flaggedField]) ? i[c.flaggedField].length > 0 : !!i[c.flaggedField];
    const overdue = cat !== 'done' && due && new Date(`${due}T23:59:59`) < new Date();
    const why = [
      /block|hold|imped/i.test(i.status?.name || '') && `Status ${i.status.name}`,
      flagged && 'Flagged',
      blockedBy.length && `Blocked by ${blockedBy.map((b) => b.key).join(', ')}`,
    ].filter(Boolean);
    return {
      key: i.key, title: i.summary, url: i.url || `${site()}/browse/${i.key}`, type: i.issuetype?.name, subtask: !!i.issuetype?.subtask,
      status: i.status?.name, category: cat, priority: i.priority?.name || null, assignee: i.assignee?.displayName || null,
      mine: !!(ctx.config.owner?.name && i.assignee?.displayName === ctx.config.owner.name),
      due, dueFrom: i.duedate ? 'due date' : due ? 'sprint end' : null, sprint: sp?.name || null, flagged, blockedBy,
      blocked: cat !== 'done' && why.length > 0, why, overdue: !!overdue, resolved: i.resolutiondate || null, updated: i.updated, created: i.created,
      parent: i.parent?.key || null,
    };
  }

  async function build() {
    const c = cfg();
    if (process.env.WORK_CENTER_DEMO) { // demo mode: made-up epics run through the same mapping
      const F = require('../../demo/fixtures').projects();
      const projects = new Map(F.epics.map((e) => [e.key, epicOf(e)]));
      const items = new Map([...projects.keys()].map((k) => [k, []]));
      for (const k of F.children) items.get(k.parent?.key)?.push(itemOf(k, c));
      for (const [k, p] of projects) Object.assign(p, roll(items.get(k)));
      return { at: Date.now(), projects, items, prs: F.prs, error: null };
    }
    const epicsRaw = await jqlAll(c.epicJql, EPIC_FIELDS, 200);
    const have = new Set(epicsRaw.map((e) => e.key));
    if (c.includeParentsOfMine) {
      const mine = await jqlAll('assignee = currentUser() AND parent is not EMPTY AND updated >= -365d ORDER BY updated DESC', 'parent', 500);
      const extra = [...new Set(mine.map((i) => i.parent).filter((p) => p && /epic/i.test(p.fields?.issuetype?.name || '') || (p && p.fields?.issuetype?.hierarchyLevel === 1)).map((p) => p.key))].filter((k) => !have.has(k));
      for (let i = 0; i < extra.length; i += 50) epicsRaw.push(...await jqlAll(`key in (${extra.slice(i, i + 50).join(',')})`, EPIC_FIELDS, 60));
    }
    const projects = new Map(epicsRaw.map((e) => [e.key, epicOf(e)]));
    const keys = [...projects.keys()];
    const items = new Map(keys.map((k) => [k, []]));
    const CHILD = `summary,status,duedate,resolutiondate,created,updated,priority,assignee,issuetype,issuelinks,parent,${c.sprintField},${c.flaggedField}`;
    for (let i = 0; i < keys.length; i += 40) {
      const kids = await jqlAll(`parent in (${keys.slice(i, i + 40).join(',')}) ORDER BY updated DESC`, CHILD, 2000);
      for (const k of kids) items.get(k.parent?.key)?.push(itemOf(k, c));
    }
    let prs = [];
    try {
      const since = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
      prs = parseJson(await run('gh', ['search', 'prs', '--author=@me', `--updated=>=${since}`, '--limit', '300', '--json', 'title,url,state,repository,number,body,updatedAt,isDraft'], { timeout: 60_000 }))
        .map((p) => ({ title: p.title, url: p.url, state: p.state, draft: p.isDraft, repo: p.repository?.nameWithOwner, number: p.number, updated: p.updatedAt, text: `${p.title}\n${(p.body || '').slice(0, 4000)}` }));
    } catch { /* gh not set up: no PR links */ }
    for (const [k, p] of projects) Object.assign(p, roll(items.get(k)));
    return { at: Date.now(), projects, items, prs, error: null };
  }

  function roll(list) {
    const open = list.filter((i) => i.category !== 'done');
    const dues = open.map((i) => i.due).filter(Boolean).sort();
    return {
      counts: { total: list.length, done: list.length - open.length, doing: open.filter((i) => i.category === 'indeterminate').length, todo: open.filter((i) => i.category === 'new').length },
      pct: list.length ? Math.round((100 * (list.length - open.length)) / list.length) : null,
      blockers: open.filter((i) => i.blocked).length, overdue: open.filter((i) => i.overdue).length, nextDue: dues[0] || null,
      mineOpen: open.filter((i) => i.mine).length,
    };
  }

  // Disk-cached (src/cache.js): the view opens from the last copy, even after a restart, and
  // refreshes in the background after cacheMinutes. Maps are stored as entry lists.
  const store = require('../cache').create(ctx.DATA, 'projects', {
    ttl: () => cfg().cacheMinutes * 60_000,
    load: async () => { const c = await build(); return { ...c, projects: [...c.projects], items: [...c.items] }; },
  });
  let hydAt = -1;
  async function get(force) {
    let v;
    try { v = await store.get(force); } catch (e) { return { at: Date.now(), projects: new Map(), items: new Map(), prs: [], error: e.message }; }
    if (hydAt !== store.at || !cache) { cache = { ...v, projects: new Map(v.projects), items: new Map(v.items) }; hydAt = store.at; }
    return { ...cache, error: store.peek().error || v.error || null };
  }

  const briefFile = (key) => path.join(DIR, `brief-${key}.json`);
  const prsFor = (c, key) => {
    const keys = [key, ...(c.items.get(key) || []).map((i) => i.key)];
    const re = new RegExp(`\\b(${keys.map((k) => k.replace('-', '\\-')).join('|')})\\b`);
    return c.prs.filter((p) => re.test(p.text)).map(({ text, ...p }) => ({ ...p, keys: [...new Set((p.title + text).match(new RegExp(re, 'g')) || [])] }));
  };

  ctx.route('GET', '/api/projects', async ({ url }) => {
    const c = await get(url.searchParams.has('force'));
    const cur = qOf(new Date());
    const q = /^\d{4}-Q[1-4]$/.test(url.searchParams.get('quarter') || '') ? url.searchParams.get('quarter') : cur;
    const all = [...c.projects.values()];
    const qs = {};
    for (const p of all) for (const x of p.quarters) { qs[x] ||= { q: x, active: 0, done: 0 }; qs[x][p.category === 'done' ? 'done' : 'active']++; }
    qs[cur] ||= { q: cur, active: 0, done: 0 };
    const order = { indeterminate: 0, new: 1, done: 2 };
    const list = all.filter((p) => p.quarters.includes(q))
      .sort((a, b) => order[a.category] - order[b.category] || String(a.due || a.nextDue || '9').localeCompare(String(b.due || b.nextDue || '9')) || String(b.updated).localeCompare(String(a.updated)));
    const [from, to] = qRange(q);
    return {
      quarter: q, current: cur, from: from.toISOString(), to: to.toISOString(), fetchedAt: new Date(c.at).toISOString(), refreshing: store.refreshing, error: c.error,
      quarters: Object.values(qs).sort((a, b) => a.q.localeCompare(b.q)),
      projects: list.map((p) => ({ ...p, hasBrief: fs.existsSync(briefFile(p.key)) })),
    };
  });

  ctx.route('GET', '/api/projects/one', async ({ url }) => {
    const key = url.searchParams.get('key') || '';
    if (!KEY.test(key)) throw bad('Bad key');
    const c = await get(false);
    const p = c.projects.get(key);
    if (!p) throw bad('Not one of your projects', 404);
    const out = { project: p, items: c.items.get(key) || [], prs: prsFor(c, key), brief: readJson(briefFile(key)), briefJob: jobs.get(key), fetchedAt: new Date(c.at).toISOString() };
    lastViewed = { project: p, open: out.items.filter((i) => i.category !== 'done').slice(0, 60), brief: out.brief };
    return out;
  });

  ctx.route('GET', '/api/projects/for', async ({ url }) => {
    const key = url.searchParams.get('key') || '';
    if (!KEY.test(key)) throw bad('Bad key');
    const c = await get(false);
    if (c.projects.has(key)) return { epic: key };
    for (const [ek, list] of c.items) if (list.some((i) => i.key === key)) return { epic: ek, issue: key };
    // Not in the cache: ask Jira for the parent (and the parent's parent, for sub-tasks).
    let k = key;
    for (let n = 0; n < 2; n++) {
      const [i] = await jqlAll(`key = ${k}`, 'parent,issuetype', 1);
      const p = i?.parent;
      if (!p) break;
      if (c.projects.has(p.key)) return { epic: p.key, issue: key };
      if (/epic/i.test(p.fields?.issuetype?.name || '')) return { epic: null, issue: key, notMine: p.key, url: `${site()}/browse/${p.key}` };
      k = p.key;
    }
    return { epic: null, issue: key };
  });

  // Why an item is blocked: the Jira signals (status, flag, "is blocked by" links, late), what the AI brief
  // said about it, and the latest Jira comments and description (the usual place people explain a block).
  const adfText = (n) => (!n ? '' : typeof n === 'string' ? n : n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? '\n'
    : (n.content || []).map(adfText).join(['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList'].includes(n.type) ? '\n' : '') + (['paragraph', 'heading', 'listItem'].includes(n.type) ? '\n' : ''));
  const whyCache = new Map();
  ctx.route('GET', '/api/projects/why', async ({ url }) => {
    const key = url.searchParams.get('key') || '';
    if (!KEY.test(key)) throw bad('Bad key');
    const hit = whyCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
    const c = cache || { projects: new Map(), items: new Map() };
    let item = null, epic = null;
    for (const [ek, list] of c.items) { const f = list.find((i) => i.key === key); if (f) { item = f; epic = ek; break; } }
    const [raw] = await jqlAll(`key = ${key}`, `summary,status,comment,description,issuelinks,${cfg().flaggedField}`, 1);
    const comments = (raw?.comment?.comments || []).slice(-3).reverse().map((x) => ({ who: x.author?.displayName || '', at: x.created, text: adfText(x.body).trim().slice(0, 600) })).filter((x) => x.text);
    const brief = epic ? readJson(briefFile(epic)) : null;
    const ai = (brief?.blockers || []).filter((b) => b.key === key || String(b.text || '').includes(key)).map((b) => ({ text: b.text, owner: b.owner, url: b.url }));
    const data = {
      key, title: raw?.summary || item?.title, status: raw?.status?.name || item?.status, url: item?.url || `${site()}/browse/${key}`,
      reasons: item?.why || [], blockedBy: item?.blockedBy || [], overdue: item?.overdue ? item.due : null,
      ai, comments, description: adfText(raw?.description).trim().slice(0, 500),
    };
    whyCache.set(key, { at: Date.now(), data });
    return data;
  });

  ctx.route('POST', '/api/projects/brief', async ({ body }) => {
    const key = body?.key || '';
    if (!KEY.test(key)) throw bad('Bad key');
    const c = await get(false);
    const p = c.projects.get(key);
    if (!p) throw bad('Not one of your projects', 404);
    const items = (c.items.get(key) || []).map((i) => ({ key: i.key, title: i.title, status: i.status, assignee: i.assignee, due: i.due, blocked: i.why.join('; ') || undefined }));
    const prompt = ctx.fillPrompt(fs.readFileSync(path.join(ctx.ROOT, 'prompts', 'project-brief.md'), 'utf8'), {
      KEY: key, TITLE: p.title, URL: p.url, STATUS: p.status, DUE: p.due || 'none set',
      ITEMS: JSON.stringify(items).slice(0, 20_000), PRS: JSON.stringify(prsFor(c, key).map((x) => ({ title: x.title, url: x.url, state: x.state }))).slice(0, 4000),
    });
    return jobs.start(key, { prompt, out: briefFile(key), title: `Project brief: ${key} ${p.title}`.slice(0, 120), kind: 'run' });
  });

  ctx.addSection('project', 'Projects', () => lastViewed || { note: 'No project open.' });
  // Warm the cache in the background so the view opens fast.
  setTimeout(() => { if (ctx.config.jira?.site) get(false).catch(() => {}); }, 15_000).unref();
}

module.exports = { setup, tagsOf, qOf };

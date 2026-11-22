// Growth & HR: an org chart, a self-review written from the work you actually did (copy-paste ready),
// and AI feedback with a score built from your work and your conversations with your manager (meeting
// notes such as Granola, Slack, email). Everything stays on this computer (DATA/hr); the AI runs read-only.
//   GET  /api/hr                         org chart, saved reviews, latest feedback + score history, jobs
//   GET  /api/hr/review?key=2026-H2      one saved review
//   POST /api/hr/run { kind, period }    kind: org | review | feedback; period (review): year | h1 | h2 | quarter | lastq | last12
// Settings `hr`: { manager, reviewQuestions: [..], ratingScale, focus } (edit in the HR view).
const fs = require('node:fs');
const path = require('node:path');
const { run, parseJson } = require('../collect');
const { makeJobs, readJson } = require('../aijob');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const iso = (d) => d.toISOString().slice(0, 10);
const DEFAULT_QUESTIONS = [
  'What were your most important accomplishments in this period, and what was their impact?',
  'How did you work with others: collaboration, helping teammates, cross-team work?',
  'Where did you grow, and what skills did you build?',
  'What could have gone better, and what did you learn from it?',
  'What are your goals for the next period, and what support do you need?',
];

function periodOf(p, now = new Date()) {
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3);
  switch (p) {
    case 'year': return { key: `${y}`, label: `${y} so far`, from: new Date(y, 0, 1), to: now };
    case 'lastyear': return { key: `${y - 1}`, label: `${y - 1}`, from: new Date(y - 1, 0, 1), to: new Date(y, 0, 0) };
    case 'h1': return { key: `${y}-H1`, label: `H1 ${y}`, from: new Date(y, 0, 1), to: new Date(Math.min(now, new Date(y, 6, 0))) };
    case 'h2': return { key: `${y}-H2`, label: `H2 ${y}`, from: new Date(y, 6, 1), to: now };
    case 'quarter': return { key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}`, from: new Date(y, q * 3, 1), to: now };
    case 'lastq': { const d = new Date(y, q * 3 - 3, 1); const qq = Math.floor(d.getMonth() / 3); return { key: `${d.getFullYear()}-Q${qq + 1}`, label: `Q${qq + 1} ${d.getFullYear()}`, from: d, to: new Date(y, q * 3, 0) }; }
    case 'last12': return { key: `last12-${iso(now)}`, label: 'Last 12 months', from: new Date(y - 1, now.getMonth(), now.getDate()), to: now };
    default: throw bad('Bad period');
  }
}

function setup(ctx) {
  const DIR = path.join(ctx.DATA, 'hr');
  const FB = path.join(DIR, 'feedback');
  fs.mkdirSync(FB, { recursive: true });
  const jobs = makeJobs(ctx);
  const hr = () => ctx.config.hr || {};
  const org = () => readJson(path.join(DIR, 'org.json'));
  const manager = () => hr().manager || org()?.manager?.name || null;

  // Plain numbers and lists from Jira and GitHub for a date range; the AI adds the story around them.
  async function facts(from, to) {
    const out = { from: iso(from), to: iso(to), errors: [] };
    const jql = async (q, fields, max = 500) => {
      const res = [];
      let after = null;
      while (res.length < max) {
        const raw = await run('twg', ['jira', 'workitem', 'query', q, '--fields', fields, '-n', '100', ...(after ? ['--after', after] : [])], { timeout: 120_000 });
        const d = parseJson(raw);
        res.push(...(d.issues || []));
        const m = raw.match(/nextCursor:\s*(\S+)/);
        if (!m || !(d.issues || []).length) break;
        after = m[1];
      }
      return res;
    };
    const range = (f) => `${f} >= "${out.from}" AND ${f} <= "${out.to} 23:59"`;
    await Promise.all([
      jql(`assignee = currentUser() AND ${range('resolutiondate')} ORDER BY resolutiondate DESC`, 'summary,issuetype,parent,resolutiondate').then((r) => {
        const byType = {}, byEpic = {};
        for (const i of r) {
          byType[i.issuetype?.name || 'Other'] = (byType[i.issuetype?.name || 'Other'] || 0) + 1;
          const e = i.parent?.fields?.summary || i.parent?.key || 'No epic';
          byEpic[e] = (byEpic[e] || 0) + 1;
        }
        out.jiraResolved = { total: r.length, byType, byEpic: Object.entries(byEpic).sort((a, b) => b[1] - a[1]).slice(0, 25), sample: r.slice(0, 120).map((i) => `${i.key} ${i.summary}`) };
      }).catch((e) => out.errors.push(`Jira resolved: ${e.message}`)),
      jql(`reporter = currentUser() AND issuetype = Bug AND ${range('created')}`, 'summary', 400).then((r) => { out.bugsFiled = r.length; }).catch((e) => out.errors.push(`Jira bugs: ${e.message}`)),
      jql(`issuetype = Epic AND (assignee = currentUser() OR reporter = currentUser()) AND ${range('resolutiondate')}`, 'summary,resolutiondate', 100).then((r) => { out.epicsCompleted = r.map((i) => `${i.key} ${i.summary}`); }).catch((e) => out.errors.push(`Jira epics: ${e.message}`)),
      run('gh', ['search', 'prs', '--author=@me', `--merged-at=${out.from}..${out.to}`, '--limit', '1000', '--json', 'title,url,repository'], { timeout: 90_000 }).then((s) => {
        const r = parseJson(s), byRepo = {};
        for (const p of r) byRepo[p.repository.nameWithOwner] = (byRepo[p.repository.nameWithOwner] || 0) + 1;
        out.prsMerged = { total: r.length, byRepo, sample: r.slice(0, 120).map((p) => `${p.repository.name}: ${p.title}`) };
      }).catch((e) => out.errors.push(`GitHub PRs: ${e.message}`)),
      run('gh', ['search', 'prs', '--reviewed-by=@me', `--updated=${out.from}..${out.to}`, '-L', '1000', '--json', 'url'], { timeout: 90_000 }).then((s) => { out.prsReviewed = parseJson(s).length; }).catch((e) => out.errors.push(`GitHub reviews: ${e.message}`)),
    ]);
    // What the AI did for you in Work Center in that range (merges, approvals, replies…), from the history.
    try {
      let n = 0; const kinds = {};
      for (const f of fs.readdirSync(path.join(ctx.DATA, 'history'))) {
        const d = f.slice(0, 10);
        if (d < out.from || d > out.to) continue;
        for (const line of fs.readFileSync(path.join(ctx.DATA, 'history', f), 'utf8').split('\n')) {
          try { const e = JSON.parse(line); n++; for (const a of e.actions || []) kinds[a.kind] = (kinds[a.kind] || 0) + 1; } catch { /* skip */ }
        }
      }
      out.workCenter = { aiRuns: n, actions: kinds };
    } catch { /* no history yet */ }
    return out;
  }

  const prompt = (file, vars) => ctx.fillPrompt(fs.readFileSync(path.join(ctx.ROOT, 'prompts', file), 'utf8'), vars);

  ctx.route('POST', '/api/hr/run', async ({ body }) => {
    const kind = body?.kind;
    if (kind === 'org') {
      return jobs.start('org', { prompt: prompt('hr-org.md', { MANAGER: manager() || 'unknown (find out)' }), out: path.join(DIR, 'org.json'), title: 'Org chart', kind: 'run' });
    }
    if (kind === 'review') {
      const p = periodOf(body?.period || 'year');
      if (jobs.get(`review-${p.key}`)?.running) return jobs.get(`review-${p.key}`);
      const f = await facts(p.from, p.to);
      const qs = (hr().reviewQuestions || []).filter((x) => String(x).trim()).length ? hr().reviewQuestions : DEFAULT_QUESTIONS;
      return jobs.start(`review-${p.key}`, {
        prompt: prompt('hr-review.md', { PERIOD: p.label, FROM: iso(p.from), TO: iso(p.to), FACTS: JSON.stringify(f).slice(0, 40_000), QUESTIONS: qs.map((q, i) => `${i + 1}. ${q}`).join('\n'), SCALE: hr().ratingScale || 'none given (leave selfRating empty)', FOCUS: hr().focus || 'none' }),
        out: path.join(DIR, `review-${p.key}.json`), title: `Self-review: ${p.label}`, kind: 'run', timeoutMs: 20 * 60_000,
        shape: (d) => ({ ...d, period: { key: p.key, label: p.label, from: iso(p.from), to: iso(p.to) }, facts: f }),
      });
    }
    if (kind === 'feedback') {
      const to = new Date(), from = new Date(Date.now() - 90 * 864e5);
      const f = await facts(from, to);
      const prev = latestFeedback();
      return jobs.start('feedback', {
        prompt: prompt('hr-feedback.md', { MANAGER: manager() || 'unknown (find out from the org chart, Slack profile or calendar)', FROM: iso(from), TO: iso(to), FACTS: JSON.stringify(f).slice(0, 30_000), PREV: prev ? JSON.stringify({ at: prev.generatedAt, score: prev.score, dimensions: prev.dimensions?.map((d) => ({ name: d.name, score: d.score })) }) : 'none', FOCUS: hr().focus || 'none' }),
        out: path.join(FB, `${iso(to)}.json`), title: 'Feedback and score', kind: 'run', timeoutMs: 20 * 60_000,
        shape: (d) => ({ ...d, window: { from: iso(from), to: iso(to) }, facts: f }),
      });
    }
    throw bad('Bad kind');
  });

  function latestFeedback() {
    const files = fs.readdirSync(FB).filter((x) => x.endsWith('.json')).sort();
    return files.length ? readJson(path.join(FB, files[files.length - 1])) : null;
  }

  ctx.route('GET', '/api/hr', () => {
    const reviews = fs.readdirSync(DIR).filter((x) => /^review-.+\.json$/.test(x)).map((x) => {
      const r = readJson(path.join(DIR, x));
      return r && { key: x.slice(7, -5), label: r.period?.label || x.slice(7, -5), generatedAt: r.generatedAt };
    }).filter(Boolean).sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
    const history = fs.readdirSync(FB).filter((x) => x.endsWith('.json')).sort().map((x) => { const r = readJson(path.join(FB, x)); return r && { date: x.slice(0, 10), score: r.score }; }).filter(Boolean);
    return {
      org: org(), manager: manager(), reviews, feedback: latestFeedback(), history, jobs: jobs.all(),
      settings: { manager: hr().manager || '', reviewQuestions: hr().reviewQuestions || [], ratingScale: hr().ratingScale || '', focus: hr().focus || '' },
      defaultQuestions: DEFAULT_QUESTIONS,
    };
  });

  ctx.route('GET', '/api/hr/review', ({ url }) => {
    const key = url.searchParams.get('key') || '';
    if (!/^[\w-]{4,30}$/.test(key)) throw bad('Bad review');
    const r = readJson(path.join(DIR, `review-${key}.json`));
    if (!r) throw bad('No such review', 404);
    return r;
  });

  ctx.addSection('hr', 'Growth & HR', () => {
    const f = latestFeedback();
    return { org: org(), feedback: f && { score: f.score, summary: f.summary, improvements: f.improvements, strengths: f.strengths } };
  });
}

module.exports = { setup, periodOf };

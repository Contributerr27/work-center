// Live collectors: GitHub through the `gh` CLI, Jira through the `twg` CLI.
// No tokens are stored here; both CLIs use the logins already on this machine.
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const EXTRA_PATH = [
  path.join(os.homedir(), '.local/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), 'AppData/Local/Programs'),
].join(path.delimiter);

const env = { ...process.env, PATH: `${EXTRA_PATH}${path.delimiter}${process.env.PATH || ''}` };

// Demo mode (demo/run.js): no outside tools are called; live data comes from demo/fixtures.js.
const DEMO = !!process.env.WORK_CENTER_DEMO;
// Some CLIs (twg) print a JSON error on stdout and exit non-zero; show its message, not "Command failed: <the command>".
function cliError(out) {
  try {
    const e = JSON.parse(String(out || '').trim()).error;
    if (!e) return '';
    const fix = e.remediation?.command;
    return `${e.summary || e.message || e.code}${fix && !String(e.summary).includes(fix) ? ` Run \`${fix}\` to fix it.` : ''}`;
  } catch { return ''; }
}
function run(cmd, args, { timeout = 60_000 } = {}) {
  if (DEMO) return Promise.reject(new Error('Demo mode: outside tools are switched off'));
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, timeout, maxBuffer: 64 * 1024 * 1024, cwd: os.homedir() }, (err, stdout, stderr) => {
      if (err) {
        let msg = cliError(stdout) || stderr || err.message;
        if (cmd === 'twg' && /AUTH_INVALID|session has expired|been revoked/i.test(`${stdout}${stderr}`)) msg = twgLogin.start() || msg;
        return reject(new Error(`${cmd} ${args[0] || ''}: ${String(msg).trim().slice(0, 400)}`));
      }
      resolve(stdout);
    });
  });
}

// An expired twg (Jira) session starts `twg login` in the background (at most once every 10 minutes),
// so you only have to finish the sign-in in the browser. Its sign-in link is opened unless twg opens
// one itself, and the link and code are shown on the Jira card. Afterwards the listeners refresh.
const twgLogin = {
  state: { running: false, startedAt: null, url: null, code: null, error: null, finishedAt: null, ok: null },
  listeners: [],
  onDone(fn) { this.listeners.push(fn); },
  message() {
    const s = this.state;
    if (s.running) return `Jira sign-in expired. Work Center started \`twg login\`: finish it in your browser${s.code ? ` (code ${s.code})` : ''}${s.url ? `: ${s.url}` : ''}. Jira refreshes on its own afterwards.`;
    return null;
  },
  start() {
    const s = this.state;
    if (s.running) return this.message();
    if (s.startedAt && Date.now() - new Date(s.startedAt).getTime() < 10 * 60_000) return s.ok === false ? `Jira sign-in expired and the automatic \`twg login\` didn't finish${s.error ? ` (${s.error})` : ''}. Run \`TWG_TIMEOUT_MS=60000 twg login\` in a terminal.` : null;
    Object.assign(s, { running: true, startedAt: new Date().toISOString(), url: null, code: null, error: null, finishedAt: null, ok: null });
    const { spawn } = require('node:child_process');
    let out = '', opened = false;
    const child = spawn('twg', ['login'], { env: { ...env, TWG_TIMEOUT_MS: '60000' }, cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'] });
    const seen = (chunk) => {
      out += chunk;
      const url = out.match(/https:\/\/[^\s"'<>)]+/g)?.find((u) => /atlassian|auth|device|activate|verify/i.test(u));
      const code = out.match(/\b(?:code|user_code)\b[^A-Z0-9]{0,12}([A-Z0-9]{4}-?[A-Z0-9]{4})\b/i)?.[1];
      if (url) s.url = url;
      if (code) s.code = code;
      // Give twg a moment to open the page itself; open it ourselves only if it didn't say so.
      if (url && !opened) {
        opened = true;
        setTimeout(() => { if (!/open(ed|ing)\b[^\n]*browser|browser[^\n]*open/i.test(out)) execFile('open', [url], () => {}); }, 1500);
      }
    };
    child.stdout.on('data', seen);
    child.stderr.on('data', seen);
    child.on('error', (e) => { Object.assign(s, { running: false, ok: false, error: e.message, finishedAt: new Date().toISOString() }); });
    child.on('close', (code) => {
      let ok = code === 0;
      try { const j = JSON.parse(out.trim().slice(out.indexOf('{'))); if (j.ok === false) { ok = false; s.error = j.error?.summary || j.error?.message || j.error?.code; } } catch { /* plain text */ }
      if (!ok && !s.error) s.error = out.trim().split('\n').pop()?.slice(0, 200) || `exit ${code}`;
      Object.assign(s, { running: false, ok, finishedAt: new Date().toISOString() });
      if (ok) for (const fn of this.listeners) { try { fn(); } catch { /* ignore */ } }
    });
    return this.message();
  },
};
// CLIs sometimes print a status line (e.g. "✓ Complete" after a login refresh) before the JSON:
// parse from the first { or [ to the matching last } or ].
function parseJson(out) {
  try { return JSON.parse(out); } catch { /* fall through */ }
  const i = out.search(/[{[]/);
  const j = Math.max(out.lastIndexOf('}'), out.lastIndexOf(']'));
  if (i < 0 || j <= i) throw new Error(`Unreadable reply: ${out.trim().slice(0, 80)}`);
  return JSON.parse(out.slice(i, j + 1));
}
const json = async (cmd, args, opts) => parseJson(await run(cmd, args, opts));
const days = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);

function checks(rollup = []) {
  const out = { pass: 0, fail: 0, pending: 0, skipped: 0 };
  for (const c of rollup) {
    const v = (c.conclusion || c.state || c.status || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL'].includes(v)) out.pass++;
    else if (['SKIPPED'].includes(v)) out.skipped++;
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) out.fail++;
    else out.pending++;
  }
  return out;
}

async function github(cfg) {
  const prFields = 'number,title,author,isDraft,reviewDecision,mergeable,mergeStateStatus,updatedAt,createdAt,statusCheckRollup,additions,deletions,url,headRefName';
  const searchFields = 'repository,title,number,url,updatedAt,createdAt,author,isDraft';
  const [repo, reviews, mine] = await Promise.all([
    cfg.repo ? json('gh', ['pr', 'list', '-R', cfg.repo, '--state', 'open', '--limit', '50', '--json', prFields]) : [],
    json('gh', ['search', 'prs', '--review-requested=@me', '--state=open', '--limit', '60', '--json', searchFields]),
    json('gh', ['search', 'prs', '--author=@me', '--state=open', '--limit', '60', '--json', searchFields]),
  ]);
  const inOrg = (p) => !cfg.orgs?.length || cfg.orgs.some((o) => p.repository.nameWithOwner.startsWith(`${o}/`));
  const slim = (p) => ({
    repo: p.repository.nameWithOwner,
    repoName: p.repository.name,
    number: p.number,
    title: p.title,
    url: p.url,
    author: p.author?.login,
    isDraft: p.isDraft,
    ageDays: days(p.createdAt),
    idleDays: days(p.updatedAt),
  });
  return {
    repo: cfg.repo,
    repoPRs: repo.map((p) => {
      const c = checks(p.statusCheckRollup);
      // Rule-based readiness. The AI verdict (data/parts/prs.json) overrides it in the UI.
      let rule = 'wait';
      if (c.fail) rule = 'fix';
      else if (!p.isDraft && !c.pending && p.mergeable === 'MERGEABLE' && p.reviewDecision !== 'CHANGES_REQUESTED') rule = 'merge';
      return {
        repo: cfg.repo,
        number: p.number,
        title: p.title,
        url: p.url,
        author: p.author?.login,
        isBot: !!p.author?.is_bot || /bot$/.test(p.author?.login || ''),
        isDraft: p.isDraft,
        review: p.reviewDecision || 'NONE',
        mergeable: p.mergeable,
        checks: c,
        additions: p.additions,
        deletions: p.deletions,
        ageDays: days(p.createdAt),
        idleDays: days(p.updatedAt),
        rule,
      };
    }),
    reviewRequests: reviews.filter(inOrg).map(slim).sort((a, b) => a.idleDays - b.idleDays),
    myPRs: mine.filter(inOrg).filter((p) => p.repository.nameWithOwner !== cfg.repo).map(slim),
  };
}

async function jql(query, extraFields = []) {
  if (!query) return []; // that list is not set up for this person
  const fields = ['summary', 'status', 'priority', 'issuetype', 'updated', 'created', 'assignee', 'reporter', ...extraFields].join(',');
  const res = await json('twg', ['jira', 'workitem', 'query', query, '--fields', fields, '-n', '100'], { timeout: 90_000 });
  return res.issues || [];
}

async function jira(cfg) {
  const base = (i) => ({
    key: i.key,
    title: i.summary,
    url: i.url || `${cfg.site}/browse/${i.key}`,
    type: i.issuetype?.name,
    priority: i.priority?.name || 'Medium',
    status: i.status?.name,
    category: i.status?.statusCategory?.key, // new | indeterminate | done
    assignee: i.assignee?.displayName || null,
    ageDays: days(i.created),
    idleDays: days(i.updated),
  });
  const [prd, mentions, sprint, bugs] = await Promise.all([
    jql(cfg.prdQa, [cfg.qaStatusField, cfg.testPlanField, cfg.prdField].filter(Boolean)),
    jql(cfg.mentions),
    jql(cfg.sprint),
    jql(cfg.bugs),
  ]);
  const rank = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };
  return {
    prdQa: prd.map((i) => ({
      ...base(i),
      qaStatus: i[cfg.qaStatusField]?.value || 'Not Started',
      testPlan: i[cfg.testPlanField] || null,
      prd: i[cfg.prdField] || null,
    })),
    mentions: mentions.map(base),
    sprint: sprint.map(base),
    bugs: bugs
      .map((i) => {
        const b = base(i);
        const limit = cfg.nudgeAfterDays?.[b.priority] ?? 14;
        return { ...b, nudge: b.idleDays >= limit, nudgeLimit: limit };
      })
      .sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || b.idleDays - a.idleDays),
  };
}

async function settle(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const { execFileSync } = require('node:child_process');
const has = (bin) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { env, stdio: 'ignore' }); return true; } catch { return false; } };
async function collectLive(config) {
  if (DEMO) return require('../demo/fixtures').live();
  const off = (why) => async () => { throw Object.assign(new Error(why), { setup: true }); };
  const [gh, ji] = await Promise.all([
    settle(has('gh') ? () => github(config.github || {}) : off('GitHub needs the gh CLI (brew install gh, then gh auth login). See Settings.')),
    settle(has('twg') ? () => jira(config.jira || {}) : off('Jira lists need the twg CLI; the AI bar can still reach Jira through your AI connections. See Settings.')),
  ]);
  return { fetchedAt: new Date().toISOString(), github: gh, jira: ji };
}

async function mergePR(config, repo, number) {
  if (!config.github?.repo || repo !== config.github.repo) throw new Error(`Merging is only enabled for your main repo${config.github?.repo ? ` (${config.github.repo})` : ': set it in Settings'}`);
  if (!Number.isInteger(number)) throw new Error('Bad PR number');
  const pr = await json('gh', ['pr', 'view', String(number), '-R', repo, '--json', 'isDraft,mergeable,statusCheckRollup,state']);
  const c = checks(pr.statusCheckRollup);
  if (pr.state !== 'OPEN') throw new Error('PR is not open');
  if (pr.isDraft) throw new Error('PR is still a draft');
  if (c.fail || c.pending) throw new Error(`CI is not green (${c.fail} failing, ${c.pending} pending)`);
  if (pr.mergeable !== 'MERGEABLE') throw new Error(`Not mergeable (${pr.mergeable})`);
  await run('gh', ['pr', 'merge', String(number), '-R', repo, `--${config.github.mergeMethod || 'squash'}`], { timeout: 120_000 });
  return { merged: true };
}


// QA Status values that mean the PM approved the test plan (SOP: Test Plan Approved or later).
const APPROVED_QA = ['Test Plan Approved', 'Automated', 'Signed Off', 'Signed Off w/ Known Issues', 'N/A'];

// Move an approved PRD out of QA review into the engineering backlog. Re-reads the ticket
// first, so a stale page cannot move a PRD that is not approved or not in QA review.
async function moveToEngineering(config, key) {
  const cfg = config.jira || {};
  if (!cfg.qaReviewStatus || !cfg.engTransitionId) throw new Error('Moving PRDs is not set up (jira.qaReviewStatus and jira.engTransitionId in Settings)');
  const [issue] = await jql(`key = ${key}`, [cfg.qaStatusField]);
  if (!issue) throw new Error(`${key} not found`);
  const qa = issue[cfg.qaStatusField]?.value || 'Not Started';
  if (issue.status?.name !== cfg.qaReviewStatus) throw new Error(`${key} is in ${issue.status?.name}, not ${cfg.qaReviewStatus}`);
  if (!APPROVED_QA.includes(qa)) throw new Error(`${key} QA Status is "${qa}": the test plan is not approved yet`);
  await run('twg', ['jira', 'workitem', 'transition', '--id', key, '--transition-id', String(cfg.engTransitionId),
    '--transition-comment', `QA test plan approved (QA Status: ${qa}). Moved to ${cfg.engStatus} from Work Center.`,
    '--transition-comment-format', 'plain'], { timeout: 90_000 });
  return { moved: true, key, to: cfg.engStatus };
}

module.exports = { twgLogin, parseJson, collectLive, mergePR, moveToEngineering, APPROVED_QA, run, env, DEMO };

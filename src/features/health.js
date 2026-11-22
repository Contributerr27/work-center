// CI & test health: scheduled test workflows in the configured repo (gh CLI), failing tests parsed
// from their job logs, the release gate the repo's own report job computes, known bugs and blocked
// tests from the repo's config, flaky detection across recent runs, self-heal bot PRs, and Testera
// monitors / failure analytics when an API key is available. Read-only, except the Rerun route.
//
// Only "gating" failures count: a failure in a job that still concluded success is tolerated, a
// failure matching a registered known bug is "known", a blocked-lane test is "blocked", and
// incubating workflows (suites that are allowed to fail) are shown apart and never counted.
//
// Settings (all optional) in config.json → "health":
//   repo            default github.repo
//   workflows       [names or file names] to show; default: scheduled workflows that look like tests
//   exclude         [names or file names] to hide
//   incubating      [names or file names] of non-gating workflows (default ["staging-nightly-suites.yml"])
//   regression      name or file of the main regression shown on top (default: the workflow whose
//                   report prints the biggest quality gate)
//   repoConfig      paths in the repo: { knownBugs, signatures, blocked, lanes }
//                   (defaults config/known-bugs.json, config/known-issue-signatures.json,
//                   config/test-lane-blocked.json, config/test-lanes.json; missing files are skipped)
//   event           run event to trend on (default "schedule"; falls back to all events)
//   runs            runs per workflow for the trend (default 10)
//   healAuthors     PR author logins that propose heals; default: bot authors with "testera" or "heal" in the login
//   jiraProject     project for bug filing presets (default "TEST")
//   testera         { apiUrl: "https://app.testera.io/api", apiKeyEnv: "TESTERA_API_KEY" }
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const TTL = 3 * 60_000;
const WF_TTL = 6 * 3600_000;
const REPO_CFG_TTL = 3600_000;
const PARSER = 3; // bump when the log parser changes: cached runs from older parsers are re-read
const PARSE_RUNS = 4; // latest completed runs per workflow whose logs are read (trend + flaky window)
const FAILED = ['failure', 'timed_out', 'startup_failure'];
const TESTY = /test|smoke|nightly|journey|regression|verify|e2e|perf|parity|suite|monitor|coverage|qa|production|staging|sandbox/i;
const NOT_TESTY = /sweep|sync|pull|maintenance|promot|refresh|notify|triage|slack|token|setup|set up|catalog|dispatch|self-heal|heal/i;

function setup(ctx) {
  const cfg = { event: 'schedule', runs: 10, jiraProject: 'TEST', incubating: ['staging-nightly-suites.yml'], ...(ctx.config.health || {}) };
  const repoCfg = { knownBugs: 'config/known-bugs.json', signatures: 'config/known-issue-signatures.json', blocked: 'config/test-lane-blocked.json', lanes: 'config/test-lanes.json', ...(cfg.repoConfig || {}) };
  const repo = cfg.repo || ctx.config.github?.repo;
  const jiraSite = (ctx.config.jira?.site || '').replace(/\/$/, '');
  const CACHE_FILE = path.join(ctx.DATA, 'health-cache.json');
  const RUN_ID = /^\d{5,20}$/;

  const run = (args, { timeout = 60_000, raw = false } = {}) => new Promise((resolve, reject) => {
    execFile('gh', args, { env: ctx.env, timeout, maxBuffer: 96 * 1024 * 1024, cwd: os.homedir() }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`gh ${args.slice(0, 2).join(' ')}: ${(stderr || err.message).trim().slice(0, 300)}`));
      if (raw) return resolve(stdout);
      try { resolve(stdout && stdout.trim() ? require('../collect').parseJson(stdout) : null); } catch { reject(new Error(`gh ${args.slice(0, 2).join(' ')}: bad JSON`)); }
    });
  });
  const rawFile = (p) => run(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${p}`], { raw: true });
  // Small pool so a cold start does not fire dozens of gh processes at once.
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; } }
    }));
    return out;
  }
  const want = (w, list) => (list || []).some((x) => x === w.name || x === path.basename(w.path || '') || x === w.path);

  // Parsed runs (per attempt) are immutable, so they are kept on disk across restarts.
  let disk = { workflows: null, workflowsAt: 0, runs: {} };
  try { disk = { ...disk, ...JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) }; } catch { /* first start */ }
  for (const [k, v] of Object.entries(disk.runs || {})) if (v.v !== PARSER) delete disk.runs[k];
  const saveDisk = () => {
    const keys = Object.keys(disk.runs);
    if (keys.length > 300) for (const k of keys.sort((a, b) => (disk.runs[a].at || 0) - (disk.runs[b].at || 0)).slice(0, keys.length - 300)) delete disk.runs[k];
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(disk)); } catch { /* data dir read-only */ }
  };

  /* ---------- Which workflows ---------- */
  async function workflows() {
    if (disk.workflows && Date.now() - disk.workflowsAt < WF_TTL) return disk.workflows;
    const all = (await run(['api', `repos/${repo}/actions/workflows?per_page=100`]))?.workflows || [];
    const active = all.filter((w) => w.state === 'active' && /\.ya?ml$/.test(w.path) && w.path.startsWith('.github/'));
    let picked;
    if (cfg.workflows?.length) picked = active.filter((w) => want(w, cfg.workflows));
    else {
      // Scheduled workflows that look like test suites (cron lines that are not commented out).
      const looksTesty = active.filter((w) => TESTY.test(`${w.name} ${w.path}`) && !NOT_TESTY.test(`${w.name} ${path.basename(w.path)}`));
      let misses = 0;
      const withCron = await pool(looksTesty, 3, async (w) => {
        let f = null;
        for (let a = 0; a < 2 && f == null; a++) f = await rawFile(w.path).catch(() => null);
        if (f == null) { misses++; return null; }
        return /^\s*-?\s*cron:/m.test(String(f).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')) ? w : null;
      });
      picked = withCron.filter((w) => w && !w.error);
      if (misses) disk.retryWorkflows = true; // some files could not be read: look again soon
      else delete disk.retryWorkflows;
    }
    picked = picked.filter((w) => !want(w, cfg.exclude)).map((w) => ({ id: w.id, name: w.name, path: w.path, url: w.html_url }));
    disk.workflows = picked;
    disk.workflowsAt = disk.retryWorkflows ? Date.now() - WF_TTL + 10 * 60_000 : Date.now();
    saveDisk();
    return picked;
  }

  /* ---------- The repo's own test bookkeeping: known bugs, signatures, blocked and lanes ---------- */
  let repoInfo = null;
  let repoInfoAt = 0;
  async function repoConfig() {
    if (repoInfo && Date.now() - repoInfoAt < REPO_CFG_TTL) return repoInfo;
    const read = async (p) => { if (!p) return null; try { return JSON.parse(await rawFile(p)); } catch { return null; } };
    const [kb, sig, bl, ln] = await Promise.all([read(repoCfg.knownBugs), read(repoCfg.signatures), read(repoCfg.blocked), read(repoCfg.lanes)]);
    const bugs = (kb?.activeBugs || kb?.bugs || []).filter((b) => b && b.key).map((b) => ({
      key: b.key, summary: b.summary || '', url: b.url || (jiraSite ? `${jiraSite}/browse/${b.key}` : null),
      fps: (b.testFingerprints || []).map((x) => String(x).toLowerCase()).filter((x) => x.length >= 4),
    }));
    const sigs = {};
    for (const [k, v] of Object.entries(sig || {})) {
      if (!/^[A-Z][A-Z0-9]+-\d+$/.test(k) || !Array.isArray(v)) continue;
      sigs[k] = v.map((p) => { try { return new RegExp(p, 'i'); } catch { return null; } }).filter(Boolean);
    }
    const blocked = {};
    for (const g of bl?.blocked || []) for (const t of g.tests || []) blocked[t] = short(g.reason || 'blocked', 160);
    const lanes = {};
    for (const [k, v] of Object.entries(ln?.tests || {})) lanes[normFp(k)] = v;
    const blockedN = Object.fromEntries(Object.entries(blocked).map(([k, v]) => [normFp(k), v]));
    repoInfo = { bugs, sigs, blocked: blockedN, lanes, found: { knownBugs: !!kb, signatures: !!sig, blocked: !!bl, lanes: !!ln } };
    repoInfoAt = Date.now();
    return repoInfo;
  }

  // GitHub masks some characters in logs as ***; compare fingerprints without them.
  const normFp = (s) => String(s || '').replace(/\*\*\*|[\[\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  /* ---------- Job logs → failing tests, per-job totals, quality gate ---------- */
  const clean = (s) => s.replace(/\x1b\[[0-9;]*m|\[[0-9;]*m/g, '').replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '');
  const short = (s, n = 180) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  const num = (x) => Number(x) || 0;
  function parseLog(text) {
    const lines = text.split('\n').map(clean);
    const tests = [];
    const seen = new Set();
    const errAfter = (i) => {
      if (i < 0) return { error: '', detail: '' };
      let first = '';
      const block = [];
      for (let k = i + 1; k < Math.min(lines.length, i + 400); k++) {
        const l = lines[k].trim();
        if (!l || /^(at\s|❯\s|⎯)/.test(l)) { if (block.length && /^⎯/.test(l)) break; continue; }
        if (/^\s*(FAIL|✓|×)\s/.test(lines[k])) { if (block.length) break; continue; } // vitest lists FAILs sharing one error together
        block.push(l);
        if (block.length > 12) break;
        if (!first && /(Error|expected|Expected|Timeout|timed out|toBe|toEqual|Received|AssertionError|ECONN|status)/.test(l)) first = l;
      }
      return { error: short(first || block[0] || ''), detail: block.join(' ').slice(0, 700) };
    };
    const add = (file, parts, i) => {
      parts = parts.map((p) => p.trim()).filter(Boolean);
      const name = parts[parts.length - 1];
      if (!name) return;
      const suite = (parts.length > 1 ? parts[0] : path.basename(file || '')) || 'Tests';
      const key = `${suite}›${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      // Fingerprint the way the repo's lane files key tests: "<spec path>#<describe titles> <test title>".
      tests.push({ key, fp: file ? `${file}#${parts.join(' ')}` : '', file: file || '', suite: short(suite, 90), name: short(name, 160), ...errAfter(i) });
    };
    const totals = { failed: 0, passed: 0, skipped: 0, flaky: 0 };
    let gate = null;
    let inKnown = false;
    let jobError = '';
    let noResults = false;
    let pwMode = null;
    const pwBlocks = [];
    const pwFailed = [];
    for (const [i, l] of lines.entries()) {
      let m;
      if (!jobError && (m = l.match(/^##\[error\](.+)/))) jobError = short(m[1]);
      if (/No allure-results|no allure results|allure-results.*(not found|empty)/i.test(l) && !/^\s*(echo|#)/.test(l)) noResults = true;
      // vitest summary: "      Tests  20 failed | 680 passed | 251 skipped (951)"
      if ((m = l.match(/^\s*Tests\s{2,}(.+?)\s*\(\d+\)\s*$/))) {
        for (const [, n, w] of m[1].matchAll(/(\d+)\s+(failed|passed|skipped|todo|flaky)/g)) if (w in totals) totals[w] += num(n); else if (w === 'todo') totals.skipped += num(n);
        continue;
      }
      // playwright summary: "  1 failed", "  30 passed (22.7m)", "  1 flaky", "  7 skipped"
      if ((m = l.match(/^\s{1,4}(\d+) (failed|passed|flaky|skipped|did not run)(?:\s*\([^)]*\))?\s*$/))) { totals[m[2] === 'did not run' ? 'skipped' : m[2]] += num(m[1]); pwMode = m[2]; continue; }
      // The repo's quality gate (report job).
      if ((m = l.match(/Allure Quality Gate suite=(\S+)\s*→\s*(PASSED|FAILED)/))) { gate = { ...(gate || {}), suite: m[1], result: m[2], lanes: gate?.lanes || {}, known: gate?.known || [] }; continue; }
      if (gate && (m = l.match(/^\s*Tests: total=(\d+) passed=(\d+) failed=(\d+) broken=(\d+) skipped=(\d+)/))) { Object.assign(gate, { total: num(m[1]), passed: num(m[2]), failed: num(m[3]), broken: num(m[4]), skipped: num(m[5]) }); continue; }
      if (gate && (m = l.match(/^\s*lane ([\w-]+): total=(\d+) passed=(\d+) failed=(\d+) broken=(\d+) skipped=(\d+)/))) { gate.lanes[m[1]] = { total: num(m[2]), passed: num(m[3]), failed: num(m[4]) + num(m[5]), skipped: num(m[6]) }; continue; }
      if (gate && /Registered known bugs/i.test(l)) { inKnown = true; gate.known = []; continue; }
      if (inKnown) {
        if ((m = l.match(/^\s*-\s+([A-Z][A-Z0-9]+-\d+)\s+·\s+(\w+)\s+·\s+(.+?)\s*$/))) { gate.known.push({ key: m[1], status: m[2], title: m[3] }); continue; }
        inKnown = false;
      }
      if (gate && (m = l.match(/Intelligent gate → (\w+)/))) gate.intelligent = m[1];
      // vitest: " FAIL  tests/a.test.ts > Suite > test name"
      if ((m = l.match(/^\s*FAIL\s+(\S+\.(?:[cm]?[jt]sx?))\s+>\s+(.+?)\s*(?:\[[^\]]*\])?\s*$/))) { add(m[1], m[2].split(/\s+>\s+/), i); continue; }
      // playwright detail block: "  1) [chromium] › tests/a.spec.ts:12:3 › Suite › test ───" (failed and flaky alike):
      // remember its error; the summary lists below say which ones really failed.
      if ((m = l.match(/^\s*\d+\)\s+(?:\[[^›]*›\s+)?(\S+\.(?:[cm]?[jt]sx?))(?::\d+:\d+)?\s+›\s+(.+?)\s*─*\s*$/))) { pwBlocks.push([m[1], m[2].split(/\s+›\s+/), i]); continue; }
      // playwright summary lists: "  3 failed" then "    [chromium] › file:12:3 › Suite › test"
      if (pwMode && (m = l.match(/^\s{3,}\[[^›]*›\s+(\S+\.(?:[cm]?[jt]sx?))(?::\d+:\d+)?\s+›\s+(.+?)\s*─*\s*$/))) {
        if (pwMode === 'failed') pwFailed.push([m[1], m[2].split(/\s+›\s+/)]);
        continue;
      }
      pwMode = null;
      // jest: "  ● Suite › test name"
      if ((m = l.match(/^\s*●\s+(.+›.+?)\s*$/))) add('', m[1].split(/\s+›\s+/), i);
    }
    // Playwright: failed tests come from the summary list (flaky retries are not failures), errors from the blocks.
    const titleOf = (f, parts) => `${f}#${parts.map((p) => p.trim()).join(' ')}`;
    const blockAt = new Map(pwBlocks.map(([f, parts, i]) => [titleOf(f, parts), i]));
    if (pwFailed.length) for (const [f, parts] of pwFailed) add(f, parts, blockAt.get(titleOf(f, parts)) ?? -1);
    else if (!totals.flaky) for (const [f, parts, i] of pwBlocks) add(f, parts, i);
    return { tests, totals, gate, jobError, noResults };
  }

  async function parseRun(r) {
    const k = `${r.databaseId}:${r.attempt || 1}`;
    if (disk.runs[k]) return disk.runs[k];
    const jobs = (await run(['api', `repos/${repo}/actions/runs/${r.databaseId}/jobs?per_page=100`]))?.jobs || [];
    const done = jobs.filter((j) => j.status === 'completed' && j.conclusion !== 'skipped').slice(0, 30);
    const parsed = await pool(done, 4, async (j) => {
      const text = await run(['api', `repos/${repo}/actions/jobs/${j.id}/logs`], { raw: true, timeout: 90_000 });
      return { j, ...parseLog(text.length > 30e6 ? text.slice(-30e6) : text) };
    });
    const entry = { v: PARSER, at: Date.now(), jobs: [], tests: [], complete: parsed.every((p) => p && !p.error) };
    for (const p of parsed) {
      if (!p || p.error) continue;
      const t = p.totals;
      entry.jobs.push({ name: p.j.name, conclusion: p.j.conclusion, url: p.j.html_url, error: p.jobError, noResults: p.noResults,
        totals: t.failed + t.passed + t.skipped + t.flaky ? t : null, gate: p.gate, failing: p.tests.length });
      entry.tests.push(...p.tests.map((x) => ({ ...x, job: p.j.name, jobConclusion: p.j.conclusion, jobUrl: p.j.html_url })));
    }
    if (entry.complete) { disk.runs[k] = entry; saveDisk(); }
    return entry;
  }

  /* ---------- Classify failures and group them by cause ---------- */
  function classify(t, { incubating, gateKnown, info }) {
    const fp = normFp(t.fp);
    const nm = normFp(t.name);
    const lane = info.lanes[fp];
    const blockedReason = info.blocked[fp] || Object.entries(info.blocked).find(([k]) => t.file && k.startsWith(`${t.file.toLowerCase()}#`) && k.endsWith(nm))?.[1];
    if (blockedReason || lane === 'blocked') return { status: 'blocked', blockedReason: blockedReason || 'blocked lane', lane };
    const gk = gateKnown.find((x) => x.title === t.name || (x.title.length > 12 && t.name.includes(x.title)));
    const bug = (key) => { const b = info.bugs.find((x) => x.key === key); return { key, url: b?.url || (jiraSite ? `${jiraSite}/browse/${key}` : null), summary: b?.summary || '' }; };
    if (gk) return { status: 'known', bug: bug(gk.key), lane };
    const hay = `${t.name} ${t.fp}`.toLowerCase();
    for (const b of info.bugs) {
      const named = b.fps.some((fp) => hay.includes(fp)) || hay.includes(b.key.toLowerCase());
      if (!named) continue;
      const pats = info.sigs[b.key];
      if (pats?.length && !pats.some((re) => re.test(`${t.detail || ''} ${t.error || ''}`))) continue; // names the bug, but fails differently
      return { status: 'known', bug: bug(b.key), lane };
    }
    if (lane === 'known-bug') return { status: 'known', bug: null, lane };
    if (incubating) return { status: 'incubating', lane };
    if (t.jobConclusion === 'success') return { status: 'tolerated', why: 'its job still passed', lane };
    if (lane === 'incubating' || lane === 'spec-gap') return { status: 'tolerated', why: `${lane} lane (does not gate)`, lane };
    return { status: 'failing', lane };
  }
  function cause(t) {
    const s = `${t.detail || ''} ${t.error || ''}`;
    let m;
    if ((m = s.match(/"status"\s*:\s*(\d{3})\s*,\s*"(?:detail|message)"\s*:\s*"([^"]{1,140})"/))) {
      const code = num(m[1]);
      const route = m[2].match(/^Cannot (GET|POST|PUT|PATCH|DELETE) (\S+)/);
      if (code === 404 && route) return { sig: `404 Cannot ${route[1]} ${route[2]}`, label: `${route[1]} ${route[2]} not deployed (404)`, kind: 'env' };
      if (code >= 500) return { sig: `${code} ${m[2]}`, label: `Server error ${code}: ${short(m[2], 70)}`, kind: 'env' };
      return { sig: `${code} ${m[2]}`, label: `HTTP ${code}: ${short(m[2], 80)}`, kind: 'assertion' };
    }
    if ((m = s.match(/\b(?:got|returned|status(?: code)?)\s*:?\s*(5\d\d)\b/i))) return { sig: `HTTP ${m[1]}`, label: `Server error ${m[1]}`, kind: 'env' };
    if (/Timeout \d+ms exceeded|timed out|ETIMEDOUT/i.test(s)) {
      const what = (t.error.match(/([\w.]+(?:\.\w+)+):\s*Timeout/) || [])[1];
      return { sig: `timeout ${what || ''}`, label: `Timeout${what ? ` in ${what}` : ''}`, kind: 'timing' };
    }
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(s)) return { sig: 'network', label: 'Network errors', kind: 'env' };
    const norm = short(String(t.error || 'Unknown error').replace(/\*\*\*/g, '').replace(/correlationId[^,}]*/gi, '').replace(/[0-9a-f]{8,}/gi, '…').replace(/\d+/g, 'N'), 90);
    return { sig: norm, label: norm, kind: 'assertion' };
  }
  function causes(tests) {
    const g = new Map();
    for (const t of tests) {
      const c = cause(t);
      t.cause = c.sig;
      const e = g.get(c.sig) || g.set(c.sig, { ...c, count: 0, suites: new Set(), keys: [] }).get(c.sig);
      e.count++;
      e.suites.add(t.suite);
      e.keys.push(t.key);
    }
    return [...g.values()].sort((a, b) => b.count - a.count).map((c) => ({ ...c, suites: [...c.suites].slice(0, 6), group: c.count >= 3 }));
  }
  const suiteName = (job) => (job.includes(' / ') ? job.split(' / ')[0] : job.includes(' · ') ? job.split(' · ').pop() : job).trim();

  /* ---------- Testera (only with an API key in the environment) ---------- */
  async function testera() {
    const t = { apiUrl: 'https://app.testera.io/api', apiKeyEnv: 'TESTERA_API_KEY', ...(cfg.testera || {}) };
    const key = process.env[t.apiKeyEnv] || ctx.env?.[t.apiKeyEnv];
    if (!key) return { enabled: false, hint: `Set ${t.apiKeyEnv} (a Testera API key, Settings → API Keys) in the app's environment${cfg.testera?.apiUrl ? '' : `, and optionally health.testera.apiUrl in config.json (default ${t.apiUrl})`}.` };
    const get = async (p) => {
      const res = await fetch(`${t.apiUrl.replace(/\/$/, '')}${p}`, { headers: { Authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Testera ${p}: HTTP ${res.status}`);
      return res.json();
    };
    const [mons, fails] = await Promise.allSettled([get('/monitoring/monitors'), get('/analytics/failures?limit=15')]);
    const out = { enabled: true, errors: [] };
    if (mons.status === 'fulfilled') {
      out.monitors = (mons.value.monitors || []).map((m) => ({
        id: m.id, name: m.name, enabled: m.enabled, schedule: m.scheduleLabel, lastRunAt: m.lastRunAt,
        outcome: m.monitor?.lastOutcome || null, error: short(m.monitor?.lastError || '', 140),
        consecutiveFailed: m.monitor?.consecutiveFailedRuns || 0, incident: !!m.monitor?.openIncident,
      }));
    } else out.errors.push(mons.reason.message);
    if (fails.status === 'fulfilled') {
      out.failures = { total: fails.value.total, flakes: fails.value.flakes, regressions: fails.value.regressions,
        items: (fails.value.items || []).slice(0, 15).map((f) => ({ title: short(f.title, 140), classification: f.classification, aiClass: f.aiClass, failCount: f.failCount, passCount: f.passCount, lastStatus: f.lastStatus, lastSeenAt: f.lastSeenAt, lastError: short(f.lastError, 160), jiraKeys: f.jiraKeys || [] })) };
    } else out.errors.push(fails.reason.message);
    return out;
  }

  /* ---------- Heal proposals: open PRs from the self-heal bot ---------- */
  async function healPRs() {
    const prs = await run(['pr', 'list', '-R', repo, '--state', 'open', '--limit', '50', '--json', 'number,title,url,author,isDraft,createdAt,updatedAt,headRefName,statusCheckRollup']);
    const authors = cfg.healAuthors?.length ? cfg.healAuthors : null;
    const isHeal = (p) => (authors ? authors.includes(p.author?.login) : p.author?.is_bot && /testera|heal/i.test(p.author?.login || ''));
    return prs.filter(isHeal).map((p) => {
      const c = { pass: 0, fail: 0, pending: 0 };
      for (const s of p.statusCheckRollup || []) {
        const v = (s.conclusion || s.state || s.status || '').toUpperCase();
        if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) c.pass++; else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE'].includes(v)) c.fail++; else c.pending++;
      }
      return { number: p.number, title: p.title, url: p.url, author: p.author?.login, isDraft: p.isDraft, createdAt: p.createdAt, branch: p.headRefName, checks: c };
    });
  }

  /* ---------- One workflow on the board ---------- */
  const RUN_FIELDS = 'databaseId,workflowName,event,status,conclusion,createdAt,startedAt,updatedAt,url,headBranch,attempt,displayTitle';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  async function workflowBoard(w, info) {
    const incubating = want(w, cfg.incubating);
    const list = async (event) => run(['run', 'list', '-R', repo, '-w', String(w.id), '--limit', String(cfg.runs), '--json', RUN_FIELDS, ...(event ? ['--event', event] : [])]);
    let runs = await list(cfg.event);
    if (!runs.length && cfg.event) runs = await list(null);
    runs = runs.filter((r) => r.conclusion !== 'skipped');
    const completed = runs.filter((r) => r.status === 'completed');
    const latest = completed[0] || null;
    const parseSet = completed.slice(0, PARSE_RUNS);
    const parsedList = await pool(parseSet, 2, parseRun);
    const parsed = Object.fromEntries(parsedList.map((p, i) => [parseSet[i].databaseId, p && !p.error ? p : null]));
    const lp = latest && parsed[latest.databaseId];

    // The gate printed by the run's report job (the biggest one if several).
    const gates = (lp?.jobs || []).filter((j) => j.gate?.result).map((j) => ({ ...j.gate, job: j.name, jobUrl: j.url, jobConclusion: j.conclusion }));
    const gate = gates.sort((a, b) => (b.total || 0) - (a.total || 0))[0] || null;
    const gateKnown = gates.flatMap((g) => g.known || []);
    const tests = (lp?.tests || []).map((t) => ({ ...t, ...classify(t, { incubating, gateKnown, info }), workflow: w.name, runId: latest.databaseId, runUrl: latest.url }));

    // Flaky: failed, passed and failed again (or the reverse) over the parsed runs, oldest → newest.
    const window = parseSet.filter((r) => parsed[r.databaseId]).reverse();
    for (const t of tests) {
      const seq = window.map((r) => parsed[r.databaseId].tests.some((x) => x.key === t.key));
      let flips = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips++;
      Object.assign(t, { failCount: seq.filter(Boolean).length, window: seq.length, flaky: flips >= 2, isNew: seq.length > 1 && seq.filter(Boolean).length === 1 });
    }

    // Report jobs that failed because they had nothing (or too little) to report on.
    const reportBroken = (lp?.jobs || []).filter((j) => FAILED.includes(j.conclusion) && (j.noResults || (j.gate && (j.gate.total || 0) === 0) ||
      (j.gate?.result === 'FAILED' && j.gate.total != null && (j.gate.failed || 0) + (j.gate.broken || 0) === 0)))
      .map((j) => ({ name: j.name, url: j.url, why: j.noResults || !j.gate?.total ? 'report broken (no results)' : `report gate failed with 0 failures (${j.gate.total} tests: too few?)` }));
    const brokenNames = new Set(reportBroken.map((j) => j.name));
    const failingJobs = (lp?.jobs || []).filter((j) => FAILED.includes(j.conclusion) && !brokenNames.has(j.name) && !j.gate)
      .map((j) => ({ name: j.name, url: j.url, error: j.error || '', tests: j.failing }));

    const by = (s) => tests.filter((t) => t.status === s);
    const failing = by('failing');
    const n = { failing: failing.length, known: by('known').length, blocked: by('blocked').length, tolerated: by('tolerated').length, incubating: by('incubating').length };
    const recentFails = completed.filter((r) => FAILED.includes(r.conclusion)).length;

    // Light and its one-line reason, following gating results only.
    let light;
    let label;
    // With a gate, its lanes are the authority (they cover every job, also ones whose log we could not name tests in).
    const L = gate?.lanes || {};
    const kn = L['known-bug'] ? L['known-bug'].failed : n.known;
    const bl = L.blocked ? L.blocked.failed : n.blocked;
    const tol = L.incubating || L['spec-gap'] ? (L.incubating?.failed || 0) + (L['spec-gap']?.failed || 0) : n.tolerated;
    const extra = [kn && plural(kn, 'known issue'), bl && `${bl} blocked`, tol && `${tol} tolerated`].filter(Boolean).join(' · ');
    if (incubating) { light = 'incubating'; label = `Incubating · not gating${n.incubating ? ` · ${n.incubating} failing` : ''}`; }
    else if (!latest) { light = 'grey'; label = 'No runs yet'; }
    else if (gate && !brokenNames.has(gate.job)) {
      const gateFailed = gate.lanes?.gate?.failed;
      if (gate.result === 'FAILED') { light = 'red'; label = `Gate failed${gateFailed != null ? ` · ${gateFailed} gating failures` : ''}`; }
      else { light = extra || failing.length ? 'amber' : 'green'; label = `Gate passed${extra ? ` · ${extra}` : ''}`; }
      if (failingJobs.length && light !== 'red') { light = 'red'; label = `${label} · ${plural(failingJobs.length, 'job')} failed`; }
    } else if (failing.length || failingJobs.length) {
      light = 'red';
      label = failing.length ? `${failing.length} failing${extra ? ` · ${extra}` : ''}` : `${plural(failingJobs.length, 'job')} failed`;
    } else if (reportBroken.length) { light = 'amber'; label = `Report broken (no results)${extra ? ` · ${extra}` : ''}`; }
    else if (extra) { light = 'amber'; label = extra; }
    else if (latest.conclusion !== 'success') { light = 'amber'; label = latest.conclusion; }
    else if (recentFails >= 2) { light = 'amber'; label = `Passing · ${recentFails} of the last ${completed.length} runs failed`; }
    else { light = 'green'; label = 'Passing'; }

    // Per-suite totals from the test jobs' summary lines (used for the incubating breakdown).
    const suites = {};
    for (const j of lp?.jobs || []) {
      const s = suiteName(j.name);
      const e = (suites[s] ||= { name: s, failed: 0, passed: 0, skipped: 0, flaky: 0, jobs: [] });
      if (j.totals) for (const k of ['failed', 'passed', 'skipped', 'flaky']) e[k] += j.totals[k] || 0;
      e.jobs.push({ name: j.name, url: j.url, conclusion: j.conclusion, broken: brokenNames.has(j.name) });
    }
    const suiteList = Object.values(suites).filter((s) => s.failed + s.passed + s.skipped + s.flaky || s.jobs.some((j) => j.broken))
      .map((s) => ({ ...s, reportBroken: s.jobs.some((j) => j.broken) }));

    const dur = (r) => (r.startedAt && r.updatedAt ? Math.max(0, Math.round((new Date(r.updatedAt) - new Date(r.startedAt)) / 1000)) : null);
    const causeList = causes(tests.filter((t) => t.status === 'failing' || t.status === 'incubating')); // also tags each test with its cause
    return {
      id: w.id, name: w.name, file: path.basename(w.path), url: w.url || `https://github.com/${repo}/actions/workflows/${path.basename(w.path)}`,
      incubating, light, label, counts: n,
      inProgress: runs[0] && runs[0].status !== 'completed' ? { url: runs[0].url, startedAt: runs[0].startedAt || runs[0].createdAt } : null,
      latest: latest && { id: latest.databaseId, conclusion: latest.conclusion, at: latest.startedAt || latest.createdAt, duration: dur(latest), url: latest.url, attempt: latest.attempt || 1, event: latest.event, branch: latest.headBranch },
      trend: completed.slice(0, cfg.runs).reverse().map((r) => ({ id: r.databaseId, c: r.conclusion, at: r.startedAt || r.createdAt, url: r.url, duration: dur(r) })),
      passRate: completed.length ? Math.round((completed.filter((r) => r.conclusion === 'success').length / completed.length) * 100) : null,
      gate: gate && { suite: gate.suite, result: gate.result, total: gate.total, passed: gate.passed, failed: gate.failed, broken: gate.broken, skipped: gate.skipped, lanes: gate.lanes, knownFailing: (gate.known || []).length, intelligent: gate.intelligent, job: gate.job, url: gate.jobUrl },
      tests: tests.map(({ detail, ...t }) => t),
      causes: causeList,
      suites: suiteList,
      reportBroken,
      failedJobs: failingJobs,
    };
  }

  /* ---------- Board ---------- */
  let board = null;
  let refreshing = null;
  let lastError = null;
  async function refresh() {
    if (process.env.WORK_CENTER_DEMO) return (board = require('../../demo/fixtures').health());
    if (!repo) throw new Error('No repo: set github.repo (or health.repo) in config.json');
    const [wfs, info] = await Promise.all([workflows(), repoConfig()]);
    const [rows, heals, tera] = await Promise.all([
      pool(wfs, 3, (w) => workflowBoard(w, info)),
      healPRs().catch((e) => ({ error: e.message })),
      testera().catch((e) => ({ enabled: true, errors: [e.message] })),
    ]);
    const order = { red: 0, amber: 1, grey: 2, green: 3, incubating: 4 };
    const all = rows.map((r, i) => (r?.error ? { id: wfs[i].id, name: wfs[i].name, url: wfs[i].url, incubating: want(wfs[i], cfg.incubating), light: 'grey', label: r.error, error: r.error, trend: [], tests: [], causes: [], suites: [], reportBroken: [], failedJobs: [], counts: {} } : r))
      .sort((a, b) => order[a.light] - order[b.light] || a.name.localeCompare(b.name));
    const gating = all.filter((w) => !w.incubating);
    const regression = (cfg.regression && gating.find((w) => want({ name: w.name, path: w.file }, [cfg.regression])))
      || [...gating].filter((w) => w.gate?.total).sort((a, b) => b.gate.total - a.gate.total)[0] || null;
    board = {
      repo, fetchedAt: new Date().toISOString(), jiraProject: cfg.jiraProject, jiraSite,
      regression: regression?.id || null,
      workflows: all,
      failing: gating.flatMap((w) => w.tests.filter((t) => t.status === 'failing')),
      redCount: gating.filter((w) => w.light === 'red').length,
      heals: Array.isArray(heals) ? heals : [],
      healError: heals?.error || null,
      testera: tera,
      repoConfig: { ...info.found, paths: repoCfg },
    };
    lastError = null;
    return board;
  }
  function kick(force) {
    if (refreshing) return refreshing;
    if (!force && board && Date.now() - new Date(board.fetchedAt) < TTL) return Promise.resolve(board);
    refreshing = refresh().catch((e) => { lastError = e.message; return board; }).finally(() => (refreshing = null));
    return refreshing;
  }
  const snapshot = () => (board ? { ...board, refreshing: !!refreshing, error: lastError } : { loading: true, refreshing: !!refreshing, error: lastError, repo });

  kick(true);
  setInterval(() => kick(false), TTL).unref();

  ctx.provide('health', async () => { kick(false); return snapshot(); });
  ctx.route('GET', '/api/health', async ({ url }) => {
    if (url.searchParams.has('wait') && refreshing) await refreshing;
    return snapshot();
  });
  ctx.route('POST', '/api/health/refresh', async () => { await kick(true); return snapshot(); });

  // Rerun the failed jobs of one run. Outward action: the page asks first; never called automatically.
  ctx.route('POST', '/api/health/rerun', async ({ body }) => {
    const id = String(body?.runId || '');
    if (!RUN_ID.test(id)) throw Object.assign(new Error('Bad run id'), { status: 400 });
    const r = await run(['run', 'view', id, '-R', repo, '--json', 'status,conclusion,attempt,workflowName,url']);
    if (r.status !== 'completed') throw Object.assign(new Error('That run is still going'), { status: 409 });
    if (!FAILED.includes(r.conclusion) && r.conclusion !== 'cancelled') throw Object.assign(new Error(`That run did not fail (${r.conclusion})`), { status: 409 });
    await run(['run', 'rerun', id, '-R', repo, '--failed'], { raw: true });
    setTimeout(() => kick(true), 8000).unref();
    return { ok: true, workflow: r.workflowName, url: r.url };
  });

  // What the AI sees from this mission: the same board, trimmed.
  ctx.addSection('health', 'Test health', () => {
    const b = board || {};
    const slim = (t) => ({ workflow: t.workflow, suite: t.suite, name: t.name, status: t.status, bug: t.bug?.key, blockedReason: t.blockedReason, error: (t.error || '').slice(0, 120), cause: t.cause, file: t.file, job: t.job, runId: t.runId, flaky: t.flaky, failedIn: `${t.failCount}/${t.window}` });
    const gatingTests = (b.workflows || []).filter((w) => !w.incubating).flatMap((w) => w.tests);
    return {
      repo, jiraProjectForBugs: cfg.jiraProject, fetchedAt: b.fetchedAt,
      rules: 'Only status "failing" counts. "known" = matches a registered known bug (repo config/known-bugs.json or the report job list); "blocked" = blocked lane; "tolerated" = the job still passed; incubating workflows do not gate.',
      howToReadLogs: `gh run view <runId> -R ${repo} --log-failed; job logs: gh api repos/${repo}/actions/jobs/<jobId>/logs`,
      regression: (b.workflows || []).find((w) => w.id === b.regression)?.name,
      workflows: (b.workflows || []).map((w) => ({ name: w.name, incubating: w.incubating, light: w.light, label: w.label, latest: w.latest, passRate: w.passRate, last10: w.trend?.map((t) => t.c), gate: w.gate, counts: w.counts, causes: w.causes?.slice(0, 8).map(({ keys, ...c }) => c), reportBroken: w.reportBroken, failedJobs: w.failedJobs, suites: w.incubating ? w.suites.map(({ jobs, ...s }) => s) : undefined, error: w.error })),
      failingTests: gatingTests.filter((t) => t.status === 'failing').slice(0, 40).map(slim),
      knownAndBlocked: gatingTests.filter((t) => t.status === 'known' || t.status === 'blocked').slice(0, 40).map(slim),
      healProposals: b.heals,
      testera: b.testera,
    };
  });
}

module.exports = { setup };

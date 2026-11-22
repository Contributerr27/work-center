/* CI & test health ("Damage Report"): the main regression's gate on top, a status light per gating test
   workflow, gating failures grouped by cause, known / blocked / tolerated failures apart, incubating suites in
   their own folded section, self-heal PRs and Testera monitors.
   Data: D.ext.health (src/features/health.js). Rerun asks first and goes through /api/health/rerun. */
(function () {
  const H = () => D?.ext?.health || null;
  const ready = () => { const b = H(); return b && !b.loading && Array.isArray(b.workflows); };
  const open = new Set();
  const closed = new Set();
  let waiting = false;

  const rel = (iso) => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const dur = (s) => (s == null ? '' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);
  const CONC = { success: 's', failure: 'f', timed_out: 'f', startup_failure: 'f', cancelled: 'c' };
  const gating = (b) => b.workflows.filter((w) => !w.incubating);
  // A <details> that remembers being opened or closed across re-renders.
  const fold = (id, cls, defOpen, summary, ...kids) => h('details', { class: cls, open: !closed.has(id) && (open.has(id) || defOpen),
    ontoggle: (e) => { if (e.target.open) { open.add(id); closed.delete(id); } else { open.delete(id); closed.add(id); } } }, h('summary', {}, ...summary), ...kids);

  const runRef = (w) => ({ type: 'ci workflow run', label: `${w.name} · ${w.label}`, url: w.latest?.url || w.url, workflow: w.name, runId: w.latest?.id,
    conclusion: w.latest?.conclusion, gate: w.gate, counts: w.counts, failedJobs: w.failedJobs, reportBroken: w.reportBroken, repo: H().repo });
  const testRef = (t) => ({ type: 'failing test', label: `${t.suite} › ${t.name}`, url: t.jobUrl || t.runUrl, workflow: t.workflow, runId: t.runId, job: t.job,
    file: t.file, error: t.error, status: t.status, bug: t.bug?.key, flaky: t.flaky, failedIn: `${t.failCount}/${t.window} recent runs`, repo: H().repo });
  const causeRef = (w, c) => ({ type: 'failure cause', label: `${w.name}: ${c.label} · ${c.count} tests`, url: w.latest?.url, workflow: w.name, runId: w.latest?.id, signature: c.sig, kind: c.kind, tests: c.count, suites: c.suites, repo: H().repo });
  const healRef = (p) => ({ type: 'pull request', label: `${H().repo.split('/')[1]} #${p.number} ${p.title}`, url: p.url, repo: H().repo, number: p.number, author: p.author });

  const TRIAGE = (what) => `Triage ${what}. Strictly read-only: do not rerun, comment, label or create anything.\n` +
    '1. Read the failure logs (gh run view <runId> -R <repo> --log-failed, or the job log) and the test code in the repo.\n' +
    '2. Find the likely cause: test bug, test data or environment, third-party/vendor, or product regression. Quote the evidence (status codes, correlation ids, error).\n' +
    '3. Check whether it fails intermittently across the recent runs (the board has the history), the repo known-bug and lane configs, and Testera failure analytics if connected.\n' +
    '4. Search Jira for an existing bug that matches the test, endpoint or error.\n' +
    'Report: cause, evidence, the existing bug key, or "no bug yet" with a proposed bug title.';

  async function ask(text, ref) {
    try {
      await post('/api/command', { section: 'health', text, ref });
      toast('AI is triaging…');
      load(false);
    } catch (e) { toast(e.message); }
  }
  async function rerun(w, btn) {
    if (!w.latest) return;
    if (!confirm(`Rerun the failed jobs of "${w.name}" (run ${w.latest.id}) on GitHub?\n\nThis starts real CI jobs.`)) return;
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      await post('/api/health/rerun', { runId: w.latest.id });
      toast(`Rerunning failed jobs of ${w.name}`);
      btn.textContent = 'Rerun started';
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.textContent = 'Rerun';
    }
  }
  async function refresh(btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    try { D.ext.health = await post('/api/health/refresh'); } catch (e) { toast(e.message); }
    render();
  }
  // First load: the server is still reading GitHub. Wait for it, then repaint.
  async function waitForBoard() {
    if (waiting) return;
    waiting = true;
    try {
      const r = await (await fetch('/api/health?wait')).json();
      if (D?.ext) D.ext.health = r;
      render();
    } catch (e) { /* server restarting */ } finally { waiting = false; }
  }

  const strip = (w) => h('span', { class: 'hl-strip', title: 'Last runs, oldest → newest' },
    w.trend.map((t) => h('a', { class: `hl-tick ${CONC[t.c] || 'c'}`, href: t.url, title: `${t.c} · ${new Date(t.at).toLocaleString()}${t.duration != null ? ` · ${dur(t.duration)}` : ''}` })));
  const bugPill = (bug) => (bug?.key ? h('a', { class: 'pill violet', href: bug.url || '#', title: bug.summary || bug.key }, bug.key) : h('span', { class: 'pill violet' }, 'known'));

  /* ---------- The main regression, on top ---------- */
  function hero(b) {
    const w = b.workflows.find((x) => x.id === b.regression);
    if (!w || !w.gate) return null;
    const g = w.gate, L = g.lanes || {};
    const lane = (k) => L[k] || { total: 0, passed: 0, failed: 0, skipped: 0 };
    const big = (n, label, cls, title) => h('div', { class: `hl-big ${cls || ''}`, title: title || '' }, h('b', {}, n), h('small', {}, label));
    return h('div', { class: `hl-hero ${w.light}` },
      h('div', { class: 'hl-hero-head' },
        h('span', { class: `hl-light ${w.light}` }),
        h('div', { class: 'hl-name' }, h('a', { href: w.latest?.url || w.url }, w.name),
          h('small', {}, `Gate ${g.result === 'PASSED' ? 'passed' : 'failed'} · ${rel(w.latest?.at)}${w.latest?.duration != null ? ` · ${dur(w.latest.duration)}` : ''}${w.latest?.attempt > 1 ? ` · attempt ${w.latest.attempt}` : ''}`)),
        h('span', { class: 'spacer' }), strip(w)),
      h('div', { class: 'hl-bigs' },
        big(lane('gate').failed, 'gating failures', lane('gate').failed ? 'red' : 'green', `Gate lane: ${lane('gate').passed} passed, ${lane('gate').failed} failed, ${lane('gate').skipped} skipped`),
        big(lane('gate').passed, `of ${lane('gate').total - lane('gate').skipped} gate tests passed`, '', `${lane('gate').skipped} skipped`),
        big(lane('known-bug').failed, 'known bugs failing', lane('known-bug').failed ? 'violet' : '', 'Registered known bugs: not counted against the gate'),
        big(lane('blocked').failed, 'blocked', lane('blocked').failed ? 'amber' : '', 'Blocked lane: waiting on a secret, test data or another team'),
        big(lane('incubating').failed, 'incubating failing', '', `Incubating lane: ${lane('incubating').passed} passed, ${lane('incubating').failed} failed`),
        big(g.total || 0, `tests · ${Math.round(((g.passed || 0) / Math.max(1, (g.total || 0) - (g.skipped || 0))) * 100)}% pass`, '', `${g.passed} passed, ${g.failed} failed, ${g.skipped} skipped`)),
      h('div', { class: 'hl-acts' },
        itemActions('health', runRef(w)),
        (lane('known-bug').failed || lane('blocked').failed || w.counts.failing) ? h('button', { class: 'btn sm', onclick: () => ask(TRIAGE(`the latest "${w.name}" run (run ${w.latest.id}): its gating failures first, then whether any known-bug or blocked failure now fails differently`), runRef(w)) }, '✦ Triage') : null,
        g.url && h('a', { class: 'btn sm ghost', href: g.url }, 'Gate report'),
        h('a', { class: 'btn sm ghost', href: w.latest?.url || w.url }, 'Open')));
  }

  function lightCard(w) {
    const bad = w.light === 'red' || w.light === 'amber';
    return h('div', { class: `hl-card ${w.light}` },
      h('div', { class: 'hl-top' },
        h('span', { class: `hl-light ${w.light}`, title: w.label }),
        h('div', { class: 'hl-name' },
          h('a', { href: w.url, title: w.name }, w.name),
          h('small', { title: w.label }, w.error || (w.latest ? `${w.label} · ${rel(w.latest.at)}` : w.label))),
        w.inProgress && h('a', { class: 'pill blue pulse', href: w.inProgress.url, title: 'A run is in progress' }, 'Running')),
      w.trend.length ? strip(w) : null,
      h('div', { class: 'hl-meta' },
        w.passRate != null && h('span', { class: 'hl-rate', title: `Passed ${w.passRate}% of the last ${w.trend.length} runs` }, `${w.passRate}%`),
        w.counts.failing ? h('span', { class: 'pill red' }, `${w.counts.failing} failing`) : null,
        w.failedJobs.length && !w.counts.failing ? h('span', { class: 'pill red' }, `${w.failedJobs.length} job${w.failedJobs.length > 1 ? 's' : ''} failed`) : null,
        w.reportBroken.length ? h('span', { class: 'pill amber', title: w.reportBroken.map((j) => `${j.name}: ${j.why}`).join('\n') }, 'report broken') : null,
        h('span', { class: 'spacer' }),
        w.latest && itemActions('health', runRef(w))),
      h('div', { class: 'hl-acts' },
        bad && w.latest && h('button', { class: 'btn sm', title: 'AI reads the logs, finds the cause and checks Jira (read-only)', onclick: () => ask(TRIAGE(`the latest "${w.name}" run (run ${w.latest.id}, ${w.label})`), runRef(w)) }, '✦ Triage'),
        w.light === 'red' && w.latest && h('button', { class: 'btn sm', title: 'Rerun the failed jobs on GitHub (asks first)', onclick: (e) => rerun(w, e.target) }, 'Rerun'),
        h('a', { class: 'btn sm ghost', href: w.latest?.url || w.url }, 'Open')));
  }

  function testRow(t) {
    return h('div', { class: 'row hl-test' },
      t.status === 'known' ? bugPill(t.bug)
        : t.status === 'blocked' ? h('span', { class: 'pill amber', title: t.blockedReason }, 'blocked')
          : t.status === 'tolerated' ? h('span', { class: 'pill', title: t.why || 'tolerated' }, 'tolerated')
            : t.flaky ? h('span', { class: 'pill amber', title: 'Failed, passed and failed again across recent runs' }, 'flaky')
              : t.isNew ? h('span', { class: 'pill violet', title: 'First failure in the recent runs' }, 'new')
                : h('span', { class: 'hl-x', title: 'Failing' }, '✕'),
      h('span', { class: 't', title: `${t.name}\n${t.error}\n${t.file}` }, h('b', {}, t.name),
        h('small', {}, t.status === 'blocked' ? `blocked: ${t.blockedReason}` : t.status === 'tolerated' ? `${t.why} · ${t.error || t.job}` : t.error || t.job)),
      t.window > 1 && h('span', { class: 'hl-fc', title: `Failed in ${t.failCount} of the last ${t.window} analysed runs` }, `${t.failCount}/${t.window}`),
      itemActions('health', testRef(t)),
      t.status === 'failing' && h('button', { class: 'btn sm ghost', title: 'AI triage of this test (read-only)', onclick: () => ask(TRIAGE(`the failing test "${t.suite} › ${t.name}" in "${t.workflow}" (run ${t.runId}, job "${t.job}")`), testRef(t)) }, '✦ Triage'),
      h('a', { class: 'btn sm ghost', href: t.jobUrl || t.runUrl }, 'Open'));
  }

  // Failures of one workflow, grouped by cause: a cause shared by 3+ tests is one row with its count.
  function byCause(w, tests, idp) {
    const keys = new Set(tests.map((t) => t.key));
    const out = [];
    const used = new Set();
    for (const c of w.causes.filter((x) => x.group)) {
      const ts = tests.filter((t) => t.cause === c.sig);
      if (ts.length < 3) continue;
      ts.forEach((t) => used.add(t.key));
      out.push(fold(`${idp}:cause:${c.sig}`, 'hl-suite hl-cause', false,
        [h('span', { class: `pill ${c.kind === 'env' ? 'blue' : c.kind === 'timing' ? 'amber' : ''}` }, c.kind === 'env' ? 'environment' : c.kind === 'timing' ? 'timing' : 'same error'),
          h('span', { class: 't', title: c.sig }, `${c.label}`), h('span', { class: 'muted small' }, c.suites.slice(0, 3).join(', ')),
          h('span', { class: 'count', title: 'Tests this cause explains' }, `${ts.length} tests`), itemActions('health', causeRef(w, c))],
        ts.slice(0, 60).map(testRow), ts.length > 60 ? h('div', { class: 'muted small hl-more' }, `…and ${ts.length - 60} more`) : null));
    }
    const rest = tests.filter((t) => keys.has(t.key) && !used.has(t.key));
    const suites = new Map();
    for (const t of rest) (suites.get(t.suite) || suites.set(t.suite, []).get(t.suite)).push(t);
    for (const [suite, ts] of suites) {
      const flaky = ts.filter((t) => t.flaky).length;
      out.push(fold(`${idp}:suite:${suite}`, 'hl-suite', rest.length <= 12,
        [h('span', { class: 't' }, suite), flaky ? h('span', { class: 'pill amber' }, `${flaky} flaky`) : null, h('span', { class: 'count' }, ts.length)], ts.map(testRow)));
    }
    return out;
  }

  function attentionPanel(b) {
    const ws = gating(b).filter((w) => w.counts.failing || w.failedJobs.length || w.reportBroken.length);
    const body = ws.map((w) => h('div', { class: 'hl-group' },
      h('div', { class: 'hl-ghead' }, h('span', { class: `hl-dot ${w.light}` }), h('b', {}, w.name), h('span', { class: 'count' }, w.counts.failing),
        h('span', { class: 'spacer' }), w.latest && h('span', { class: 'muted small' }, rel(w.latest.at))),
      byCause(w, w.tests.filter((t) => t.status === 'failing'), `att:${w.id}`),
      w.failedJobs.filter((j) => !j.tests).map((j) => h('div', { class: 'row hl-test' }, h('span', { class: 'hl-x' }, '✕'),
        h('span', { class: 't' }, h('b', {}, j.name), h('small', {}, j.error || 'Job failed (no test names in its log)')),
        itemActions('health', { type: 'failed ci job', label: `${w.name} · ${j.name}`, url: j.url, workflow: w.name, runId: w.latest?.id, error: j.error, repo: H().repo }),
        h('a', { class: 'btn sm ghost', href: j.url }, 'Open'))),
      w.reportBroken.map((j) => h('div', { class: 'row hl-test' }, h('span', { class: 'pill amber' }, 'report'),
        h('span', { class: 't' }, h('b', {}, j.name), h('small', {}, `${j.why}: a report plumbing problem, not test failures`)),
        h('a', { class: 'btn sm ghost', href: j.url }, 'Open')))));
    const p = panel('Needs attention', b.failing.length, h('div', { class: 'body tall' }, body.length ? body : empty('No gating failures in the latest runs')));
    p.classList.add('wide');
    return p;
  }

  function knownPanel(b) {
    const ts = gating(b).flatMap((w) => w.tests.filter((t) => ['known', 'blocked', 'tolerated'].includes(t.status)));
    const known = ts.filter((t) => t.status === 'known');
    const byBug = new Map();
    for (const t of known) { const k = t.bug?.key || 'known-bug lane'; (byBug.get(k) || byBug.set(k, []).get(k)).push(t); }
    const blocked = ts.filter((t) => t.status === 'blocked');
    const tolerated = ts.filter((t) => t.status === 'tolerated');
    const body = [
      ...[...byBug.entries()].sort((a, c) => c[1].length - a[1].length).map(([key, list]) => fold(`known:${key}`, 'hl-suite', false,
        [bugPill(list[0].bug), h('span', { class: 't', title: list[0].bug?.summary || '' }, list[0].bug?.summary || 'Registered known bug'), h('span', { class: 'count' }, list.length)], list.map(testRow))),
      blocked.length ? fold('known:blocked', 'hl-suite', false, [h('span', { class: 'pill amber' }, 'blocked'), h('span', { class: 't' }, 'Blocked lane: waiting on data, a secret or a team'), h('span', { class: 'count' }, blocked.length)], blocked.map(testRow)) : null,
      tolerated.length ? fold('known:tolerated', 'hl-suite', false, [h('span', { class: 'pill' }, 'tolerated'), h('span', { class: 't' }, 'Failed in a job that still passed, or in a non-gating lane'), h('span', { class: 'count' }, tolerated.length)], tolerated.map(testRow)) : null,
    ].filter(Boolean);
    return panel('Known, blocked & tolerated', ts.length, h('div', { class: 'body' }, body.length ? body : empty('Nothing known or tolerated failing')));
  }

  function incubatingSection(b) {
    const ws = b.workflows.filter((w) => w.incubating);
    if (!ws.length) return null;
    const failing = ws.reduce((a, w) => a + w.counts.incubating, 0);
    return fold('incubating', 'panel hl-incub', false,
      [h('h3', {}, 'Incubating suites'), h('span', { class: 'muted small' }, 'not gating · not counted'), h('span', { class: 'spacer' }), h('span', { class: 'count' }, `${failing} failing`)],
      h('div', { class: 'body tall' }, ws.map((w) => h('div', { class: 'hl-group' },
        h('div', { class: 'hl-ghead' }, h('span', { class: 'hl-dot incubating' }), h('a', { href: w.latest?.url || w.url }, h('b', {}, w.name)), strip(w),
          h('span', { class: 'spacer' }), w.latest && h('span', { class: 'muted small' }, `${rel(w.latest.at)}${w.latest.duration != null ? ` · ${dur(w.latest.duration)}` : ''}`), w.latest && itemActions('health', runRef(w))),
        h('div', { class: 'hl-suites' }, w.suites.map((s) => {
          const tot = Math.max(1, s.failed + s.passed + s.skipped);
          return h('div', { class: 'hl-srow' },
            h('b', {}, s.name),
            h('span', { class: 'hl-bar', title: `${s.failed} failed · ${s.passed} passed · ${s.skipped} skipped` },
              h('i', { class: 'f', style: `width:${(s.failed / tot) * 100}%` }), h('i', { class: 'p', style: `width:${(s.passed / tot) * 100}%` }), h('i', { class: 's', style: `width:${(s.skipped / tot) * 100}%` })),
            h('span', { class: 'hl-nums' }, h('em', { class: 'f' }, s.failed), ' / ', h('em', { class: 'p' }, s.passed), ' / ', h('em', {}, s.skipped)),
            s.reportBroken ? h('a', { class: 'pill amber', href: s.jobs.find((j) => j.broken)?.url, title: 'The report job failed with no results: report plumbing, not tests' }, 'report broken') : h('span', {}));
        })),
        h('div', { class: 'muted small hl-legend' }, 'failed / passed / skipped per suite'),
        byCause(w, w.tests.filter((t) => t.status === 'incubating' || t.status === 'known'), `inc:${w.id}`)))));
  }

  function healPanel(b) {
    const rows = b.heals.map((p) => {
      const dots = [...Array(p.checks.pass).fill('p'), ...Array(p.checks.fail).fill('f'), ...Array(p.checks.pending).fill('w')].slice(0, 12);
      return h('div', { class: 'row' },
        h('span', { class: 'hl-heal', title: 'Self-heal proposal' }, '⚕'),
        h('a', { class: 't', href: p.url, title: p.title }, h('b', {}, p.title), h('small', {}, `#${p.number} · ${p.author} · ${rel(p.createdAt)}`)),
        p.isDraft && h('span', { class: 'pill' }, 'Draft'),
        h('span', { class: 'checks', title: `${p.checks.pass} passed, ${p.checks.fail} failed, ${p.checks.pending} pending` }, dots.map((d) => h('i', { class: d }))),
        itemActions('health', healRef(p)),
        h('a', { class: 'btn sm ghost', href: p.url }, 'Open'));
    });
    return panel('Heal proposals', rows.length, h('div', { class: 'body' }, b.healError ? h('div', { class: 'err' }, b.healError) : rows.length ? rows : empty('No open self-heal PRs')));
  }

  function testeraPanel(b) {
    const t = b.testera || {};
    if (!t.enabled) return panel('Testera', null, h('div', { class: 'body' }, h('div', { class: 'empty hl-hint' }, h('b', {}, 'Not connected. '), t.hint || 'Add a Testera API key to show monitors here.')));
    const mons = (t.monitors || []).filter((m) => m.enabled !== false);
    const color = (o) => (o === 'passed' || o === 'success' ? 'green' : o === 'failed' || o === 'error' ? 'red' : o === 'flaky' ? 'amber' : 'grey');
    const f = t.failures;
    return panel('Testera', mons.filter((m) => color(m.outcome) === 'red').length || null, h('div', { class: 'body' },
      (t.errors || []).map((e) => h('div', { class: 'err' }, e)),
      f && h('div', { class: 'hl-tsum' }, h('span', { class: 'pill red' }, `${f.regressions || 0} regressions`), h('span', { class: 'pill amber' }, `${f.flakes || 0} flaky`), h('span', { class: 'muted small' }, `${f.total || 0} failure signatures`)),
      mons.map((m) => h('div', { class: 'row' }, h('span', { class: `hl-dot ${m.incident ? 'red' : color(m.outcome)}` }),
        h('span', { class: 't' }, h('b', {}, m.name), h('small', {}, [m.outcome || 'no runs', m.consecutiveFailed ? `${m.consecutiveFailed} failed in a row` : '', m.lastRunAt ? rel(m.lastRunAt) : '', m.error].filter(Boolean).join(' · '))),
        itemActions('health', { type: 'testera monitor', label: `Testera monitor ${m.name}`, id: m.id, outcome: m.outcome, error: m.error }))),
      (f?.items || []).slice(0, 8).map((x) => h('div', { class: 'row' },
        h('span', { class: `pill ${x.classification === 'flake' ? 'amber' : x.classification === 'regression' ? 'red' : ''}` }, x.classification || 'failure'),
        h('span', { class: 't', title: x.lastError }, h('b', {}, x.title), h('small', {}, [`${x.failCount} fail / ${x.passCount} pass`, (x.jiraKeys || []).join(' '), x.lastError].filter(Boolean).join(' · '))),
        itemActions('health', { type: 'testera failure signature', label: x.title, error: x.lastError, classification: x.classification, jiraKeys: x.jiraKeys })))));
  }

  function renderBoard(box) {
    const b = H();
    if (!ready()) {
      if (b?.error && !b.refreshing) return box.replaceChildren(h('div', { class: 'panel err' }, `Test health: ${b.error}`));
      waitForBoard();
      return box.replaceChildren(h('div', { class: 'muted small hl-status' }, `Reading CI runs for ${b?.repo || 'the repo'}…`), h('div', { class: 'skeleton' }));
    }
    const gw = gating(b);
    const red = b.redCount;
    const amber = gw.some((w) => w.light === 'amber');
    const verdict = red ? `${red} workflow${red > 1 ? 's' : ''} failing` : amber ? 'No gating failures · some known issues' : 'All green';
    box.replaceChildren(
      h('div', { class: 'hl-status' },
        h('span', { class: `hl-dot ${red ? 'red' : amber ? 'amber' : 'green'}` }),
        h('b', {}, verdict),
        h('span', { class: 'muted small' }, `${b.repo} · ${b.failing.length} gating failures · updated ${rel(b.fetchedAt)}${b.error ? ` · last refresh failed: ${b.error}` : ''}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm ghost', disabled: !!b.refreshing, onclick: (e) => refresh(e.target) }, b.refreshing ? 'Refreshing…' : 'Refresh')),
      hero(b),
      h('div', { class: 'hl-grid' }, gw.length ? gw.filter((w) => w.id !== b.regression).map(lightCard) : empty('No scheduled test workflows found. Set health.workflows in config.json.')),
      h('div', { class: 'grid g2 hl-panels' }, attentionPanel(b), knownPanel(b), healPanel(b), testeraPanel(b)),
      incubatingSection(b));
  }

  HQ.addMission({
    id: 'health', sec: 's-health', name: 'Test health', mission: 'Damage Report', at: '08:30', after: 'github',
    ph: "triage last night's failures, rerun the flaky ones…",
    presets: [
      ['✦ Triage all failures',
        'Triage every gating failure on the board (status "failing", failed jobs, broken report jobs), then check whether any known-bug or blocked failure now fails differently from its registered signature. ' +
        'Strictly read-only: no reruns, comments, tickets or labels. Read the failed job logs and the test code, group failures that share a cause, and for each group give the likely cause (test bug, data/env, vendor, product regression) with evidence. ' +
        'Search Jira for an existing bug per group and link it; where none exists, propose a bug title and the project it belongs in. Mark which tests look flaky. Incubating suites last and briefly. Use subagents in parallel.'],
      ['File bugs for new failures',
        'For each gating failure group on the board that is a real product or test problem (not flaky noise, a known outage, a registered known bug, a blocked test or an incubating suite), search Jira first. Only when no existing bug matches, create one Bug in the Jira project named in jiraProjectForBugs on the board (TEST unless configured), following the conventions in the repo (CLAUDE.md, docs, config/known-bugs.json, existing bugs: title format, labels, links, environment, steps, evidence with correlation ids and the CI run link). One bug per root cause, not per test. Report the keys you created and the ones you matched.',
        'Claude will create Jira bugs for failures that have no matching bug yet.'],
      ['Rerun failed jobs',
        'For each gating (not incubating) workflow on the board whose latest run failed, rerun only its failed jobs once with "gh run rerun <runId> -R <repo from the board> --failed". Skip runs that are still in progress or were already rerun (attempt > 1). Do nothing else. Report which runs you restarted.',
        'Claude will rerun the failed jobs of every failing workflow on GitHub.'],
    ],
    render: renderBoard,
    count() {
      if (!ready()) return '–';
      const b = H();
      return b.redCount + b.failing.length;
    },
    load() {
      if (!ready()) return 0;
      const b = H();
      // ~1 point per failing gating workflow, 0.3 per gating failure (capped so one broken suite cannot max out the day).
      return b.redCount + 0.3 * Math.min(b.failing.length, 40);
    },
  });
})();

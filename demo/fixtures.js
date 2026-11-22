// Demo mode data (WORK_CENTER_DEMO=1): a made-up person at a made-up company, generated relative to today
// so the demo always looks current. Nothing here comes from a real account. Used for screenshots and for
// trying Work Center without connecting anything.
const DAY = 864e5;
const iso = (d) => new Date(d).toISOString();
const ago = (days, h = 10) => { const d = new Date(Date.now() - days * DAY); d.setHours(h, (days * 37) % 60, 0, 0); return iso(d); };
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const inDays = (n) => ymd(Date.now() + n * DAY);

const ME = 'Riley Chen';
const SITE = 'https://acme.atlassian.net';
const REPO = 'acme/payments-api';
const issue = (key) => `${SITE}/browse/${key}`;
const pr = (n, repo = REPO) => `https://github.com/${repo}/pull/${n}`;

const person = {
  owner: { name: ME, role: 'QA Engineer', company: 'Acme Pay', email: 'riley@acme.example', slackId: 'U000DEMO' },
  github: { repo: REPO, login: 'riley-demo' },
  jira: { site: SITE },
};

/* ---------- Live GitHub + Jira (what `gh` and `twg` would return) ---------- */
function live() {
  const checks = (pass, fail = 0, pending = 0) => ({ pass, fail, pending, skipped: 0 });
  const repoPRs = [
    { number: 412, title: 'Add idempotency keys to payout create', author: 'riley-demo', review: 'APPROVED', mergeable: 'MERGEABLE', checks: checks(14), additions: 318, deletions: 42, ageDays: 1, idleDays: 0, rule: 'mine' },
    { number: 409, title: 'chore(deps): bump undici from 6.19.2 to 6.21.1', author: 'dependabot[bot]', isBot: true, review: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', checks: checks(14), additions: 12, deletions: 12, ageDays: 2, idleDays: 2, rule: 'bot' },
    { number: 405, title: 'Refund webhook retries with exponential backoff', author: 'sam-ortiz', review: 'CHANGES_REQUESTED', mergeable: 'MERGEABLE', checks: checks(12, 2), additions: 540, deletions: 88, ageDays: 4, idleDays: 1, rule: 'team' },
    { number: 401, title: 'Contract tests for card-present terminals', author: 'riley-demo', isDraft: true, review: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', checks: checks(9, 0, 3), additions: 902, deletions: 15, ageDays: 6, idleDays: 3, rule: 'mine' },
  ].map((p) => ({ repo: REPO, url: pr(p.number), isBot: false, isDraft: false, ...p }));
  const reviewRequests = [
    { number: 398, title: 'Ledger: split settlement batches by currency', author: 'priya-n', ageDays: 1, idleDays: 0 },
    { number: 396, title: 'feat(onboarding): resume KYC from the last step', author: 'jordan-k', ageDays: 2, idleDays: 1 },
    { number: 52, title: 'ci: cache Playwright browsers between jobs', author: 'mo-ali', repo: 'acme/web-dashboard', ageDays: 3, idleDays: 2 },
  ].map((p) => ({ repo: p.repo || REPO, repoName: (p.repo || REPO).split('/')[1], url: pr(p.number, p.repo || REPO), isDraft: false, ...p }));
  const myPRs = repoPRs.filter((p) => p.author === 'riley-demo').map((p) => ({ repo: p.repo, repoName: 'payments-api', number: p.number, title: p.title, url: p.url, author: p.author, isDraft: p.isDraft, ageDays: p.ageDays, idleDays: p.idleDays }));

  const j = (key, title, type, priority, status, category, extra = {}) => ({ key, title, url: issue(key), type, priority, status, category, assignee: ME, ageDays: 5, idleDays: 1, ...extra });
  const sprint = [
    j('PAY-231', 'Payout idempotency: regression suite', 'Story', 'High', 'In Progress', 'indeterminate', { idleDays: 0 }),
    j('PAY-228', 'Refund webhooks: contract tests for retries', 'Story', 'High', 'In Review', 'indeterminate'),
    j('PAY-224', 'Card-present terminal sandbox coverage', 'Story', 'Medium', 'Blocked', 'indeterminate', { idleDays: 4 }),
    j('PAY-219', 'Nightly e2e: move flaky FX tests to quarantine lane', 'Task', 'Medium', 'To Do', 'new'),
    j('PAY-217', 'Test plan: multi-currency settlement PRD', 'Story', 'Medium', 'To Do', 'new'),
  ];
  const bugs = [
    j('PAY-240', 'Payout create returns 500 on duplicate idempotency key', 'Bug', 'Highest', 'Open', 'new', { ageDays: 2, idleDays: 2, nudge: false, nudgeLimit: 3 }),
    j('PAY-236', 'Refund webhook sent twice after timeout', 'Bug', 'High', 'In Progress', 'indeterminate', { ageDays: 6, idleDays: 1, nudge: false, nudgeLimit: 7 }),
    j('PAY-207', 'Dashboard shows settled amount in wrong currency', 'Bug', 'Medium', 'Open', 'new', { ageDays: 19, idleDays: 16, nudge: true, nudgeLimit: 14 }),
    j('PAY-190', 'Statement export CSV misses the fee column', 'Bug', 'Low', 'Open', 'new', { ageDays: 34, idleDays: 31, nudge: true, nudgeLimit: 30 }),
  ];
  const prdQa = [
    j('PAY-210', 'PRD: Multi-currency settlement', 'Epic', 'High', 'QA Review', 'indeterminate', { assignee: 'Dana Park', qaStatus: 'Test Plan In Progress', testPlan: '', prd: 'https://www.notion.so/acme/multi-currency-settlement' }),
    j('PAY-201', 'PRD: Instant payouts to debit cards', 'Epic', 'Medium', 'QA Review', 'indeterminate', { assignee: 'Dana Park', qaStatus: 'Not Started', testPlan: '', prd: 'https://www.notion.so/acme/instant-payouts' }),
  ];
  const mentions = [
    j('PAY-236', 'Refund webhook sent twice after timeout', 'Bug', 'High', 'In Progress', 'indeterminate', { assignee: 'Sam Ortiz' }),
  ];
  return {
    fetchedAt: iso(Date.now()),
    github: { ok: true, data: { repo: REPO, repoPRs, reviewRequests, myPRs } },
    jira: { ok: true, data: { prdQa, mentions, sprint, bugs } },
  };
}

/* ---------- AI briefing parts (what the AI scan writes to data/parts) ---------- */
function parts() {
  const now = iso(Date.now());
  const today = new Date(); const at = (h, m = 0) => { const d = new Date(today); d.setHours(h, m, 0, 0); return iso(d); };
  return {
    prs: {
      generatedAt: now,
      verdicts: [
        { repo: REPO, number: 412, verdict: 'merge', reason: 'Approved, CI green, covers the duplicate-key bug (PAY-240).', risks: [] },
        { repo: REPO, number: 409, verdict: 'merge', reason: 'Patch-level dependency bump; tests pass.', risks: [] },
        { repo: REPO, number: 405, verdict: 'wait', reason: 'Two contract tests fail on the retry path; changes requested by Riley.', risks: ['Retries could double-send without a dedupe key'] },
        { repo: REPO, number: 401, verdict: 'wait', reason: 'Draft; 3 checks still running.', risks: [] },
      ],
      reviewFirst: [{ repo: REPO, number: 398, why: 'Blocks the settlement PRD test plan.' }],
    },
    slack: {
      generatedAt: now,
      items: [
        { kind: 'reply', urgency: 3, who: 'Dana Park', channel: '#payments-qa', when: at(8, 12), summary: 'Asks if the multi-currency test plan will be ready for Thursday\'s review.', draft: 'Yes. Draft is up today, edge-case matrix included; I\'ll share it in the thread by 3pm.', url: 'https://acme.slack.com/archives/C0DEMO1/p1' },
        { kind: 'follow-up', urgency: 2, who: 'Sam Ortiz', channel: 'DM', when: at(7, 40), summary: 'Pushed a fix for the refund retry tests and wants a re-review.', draft: 'Thanks Sam, re-reviewing now.', url: 'https://acme.slack.com/archives/D0DEMO2/p2' },
        { kind: 'ask', urgency: 1, who: 'Support bot', channel: '#customer-questions', when: at(6, 55), summary: 'A merchant asks whether partial refunds work on instant payouts.', draft: '', url: 'https://acme.slack.com/archives/C0DEMO3/p3' },
      ],
    },
    meetings: {
      generatedAt: now,
      meetings: [
        { title: 'Payments standup', start: at(9, 30), end: at(9, 45), url: '', attendees: 7, kind: 'standup', prep: [],
          standup: { done: ['Merged idempotency tests for payout create (#412)', 'Filed PAY-240: 500 on duplicate key'], next: ['Finish refund webhook contract tests', 'Draft multi-currency test plan'], blockers: ['Card-present sandbox still down (PAY-224)'] } },
        { title: 'Multi-currency settlement: PRD review', start: at(13), end: at(13, 45), url: '', attendees: 5, kind: 'sync', prep: ['Bring the edge-case matrix', 'Ask about FX rounding rules per currency'] },
        { title: '1:1 with Alex', start: at(15, 30), end: at(16), url: '', attendees: 2, kind: '1:1', prep: ['Share Q4 coverage numbers', 'Talk about owning the release gate'] },
      ],
    },
    work: {
      generatedAt: now,
      breakdowns: [
        { key: 'PAY-231', title: 'Payout idempotency: regression suite', status: 'In Progress', blockedBy: '',
          steps: [{ text: 'Cover duplicate key on create (merged in #412)', done: true }, { text: 'Same key, different body returns 422', done: false }, { text: 'Concurrent requests with one key create one payout', done: false }, { text: 'Add the suite to the nightly gate', done: false }] },
        { key: 'PAY-228', title: 'Refund webhooks: contract tests for retries', status: 'In Review', blockedBy: '',
          steps: [{ text: 'Re-review Sam\'s fix in #405', done: false }, { text: 'Assert one delivery per event id', done: true }, { text: 'Backoff timing within 10% of spec', done: false }] },
        { key: 'PAY-224', title: 'Card-present terminal sandbox coverage', status: 'Blocked', blockedBy: 'Terminal sandbox is down; vendor ticket open',
          steps: [{ text: 'Write tests against the recorded fixtures meanwhile', done: true }, { text: 'Re-run live once the sandbox is back', done: false }] },
      ],
      testIdeas: [
        { title: 'Partial refund on an instant payout', area: 'Refunds', source: 'Slack', why: 'A merchant asked in #customer-questions; no test covers it.', url: 'https://acme.slack.com/archives/C0DEMO3/p3', priority: 'P1' },
        { title: 'FX rounding per currency at settlement', area: 'Settlement', source: 'Jira', why: 'PAY-207 shows the wrong currency; rounding rules differ for JPY and KWD.', url: issue('PAY-207'), priority: 'P0' },
        { title: 'Statement CSV columns match the spec', area: 'Reporting', source: 'Jira', why: 'PAY-190: the fee column is missing; add a schema check.', url: issue('PAY-190'), priority: 'P2' },
      ],
      jiraReplies: [],
    },
  };
}

/* ---------- Projects (Jira epics) as raw issues, so the real mapping code runs ---------- */
function projects() {
  const st = (name, key) => ({ name, statusCategory: { key } });
  const epic = (key, summary, status, cat, due, extra = {}) => ({ key, summary, status: st(status, cat), duedate: due, created: ago(60), updated: ago(1), priority: { name: 'High' }, assignee: { displayName: ME }, issuetype: { name: 'Epic', hierarchyLevel: 1 }, ...extra });
  const kid = (key, parent, summary, status, cat, type = 'Story', extra = {}) => ({
    key, summary, status: st(status, cat), parent: { key: parent }, issuetype: { name: type }, priority: { name: 'Medium' },
    assignee: { displayName: extra.who || ME }, created: ago(20), updated: ago(1), duedate: extra.due || null, resolutiondate: cat === 'done' ? ago(extra.doneAgo || 5) : null,
    issuelinks: extra.blockedBy ? [{ type: { inward: 'is blocked by' }, inwardIssue: { key: extra.blockedBy, fields: { summary: 'Terminal sandbox outage (vendor)', status: { name: 'Open', statusCategory: { key: 'new' } } } } }] : [],
  });
  const epics = [
    epic('PAY-200', 'Payout reliability 26Q4', 'In Progress', 'indeterminate', inDays(24)),
    epic('PAY-210', 'Multi-currency settlement QA', 'In Progress', 'indeterminate', inDays(38)),
    epic('PAY-150', 'Release gate for payments-api', 'Done', 'done', null, { resolutiondate: ago(40) }),
  ];
  const children = [
    kid('PAY-231', 'PAY-200', 'Payout idempotency: regression suite', 'In Progress', 'indeterminate', 'Story', { due: inDays(6) }),
    kid('PAY-228', 'PAY-200', 'Refund webhooks: contract tests for retries', 'In Review', 'indeterminate', 'Story', { due: inDays(3) }),
    kid('PAY-224', 'PAY-200', 'Card-present terminal sandbox coverage', 'Blocked', 'indeterminate', 'Story', { due: inDays(-2), blockedBy: 'OPS-88' }),
    kid('PAY-240', 'PAY-200', 'Payout create returns 500 on duplicate idempotency key', 'Open', 'new', 'Bug', { who: 'Sam Ortiz' }),
    kid('PAY-212', 'PAY-200', 'Load test payouts at 200 rps', 'Done', 'done', 'Story', { doneAgo: 9 }),
    kid('PAY-209', 'PAY-200', 'Alert on payout failure rate > 1%', 'Done', 'done', 'Task', { doneAgo: 14, who: 'Mo Ali' }),
    kid('PAY-217', 'PAY-210', 'Test plan: multi-currency settlement PRD', 'To Do', 'new', 'Story', { due: inDays(4) }),
    kid('PAY-218', 'PAY-210', 'Edge-case matrix: currency pairs and rounding', 'In Progress', 'indeterminate', 'Task', { due: inDays(4) }),
    kid('PAY-220', 'PAY-210', 'Automate settlement contract tests', 'To Do', 'new', 'Story', { due: inDays(20) }),
    kid('PAY-151', 'PAY-150', 'Gate: block merges on failing contract tests', 'Done', 'done', 'Story', { doneAgo: 45 }),
    kid('PAY-152', 'PAY-150', 'Quarantine lane for flaky tests', 'Done', 'done', 'Story', { doneAgo: 42 }),
  ];
  return { epics, children, prs: [
    { title: 'Add idempotency keys to payout create', url: pr(412), state: 'OPEN', draft: false, repo: REPO, number: 412, updated: ago(0), text: 'PAY-231 PAY-240' },
    { title: 'Contract tests for card-present terminals', url: pr(401), state: 'OPEN', draft: true, repo: REPO, number: 401, updated: ago(3), text: 'PAY-224' },
  ] };
}

/* ---------- CI health ---------- */
function health() {
  const trend = (pattern) => [...pattern].map((c, i) => ({ c: { g: 'success', r: 'failure', a: 'cancelled' }[c], at: ago(pattern.length - i), url: `https://github.com/${REPO}/actions`, duration: 600 + i * 7 }));
  const wf = (id, name, light, label, pattern, extra = {}) => ({
    id, name, file: `.github/workflows/${name.toLowerCase().replace(/\W+/g, '-')}.yml`, url: `https://github.com/${REPO}/actions`, incubating: false, light, label,
    counts: { failing: 0, known: 0, blocked: 0, tolerated: 0, incubating: 0 }, inProgress: null,
    latest: { id: id * 10, conclusion: pattern.endsWith('g') ? 'success' : 'failure', at: ago(0, 6), duration: 642, url: `https://github.com/${REPO}/actions`, attempt: 1, event: 'schedule', branch: 'main' },
    trend: trend(pattern), passRate: Math.round((100 * [...pattern].filter((c) => c === 'g').length) / pattern.length), gate: null, tests: [], causes: [], suites: [], reportBroken: [], failedJobs: [], ...extra,
  });
  return {
    repo: REPO, fetchedAt: iso(Date.now()), jiraProject: 'PAY', jiraSite: SITE, regression: null,
    workflows: [
      wf(3, 'Refund webhooks e2e', 'red', 'Failed', 'ggggrgrr', { counts: { failing: 2, known: 0, blocked: 0, tolerated: 0, incubating: 0 } }),
      wf(2, 'Contract tests', 'amber', 'Passed with retries', 'gggrgggg'),
      wf(1, 'Nightly regression', 'green', 'Passed', 'gggggggg'),
      wf(4, 'Load test (weekly)', 'green', 'Passed', 'gggg'),
    ],
    failing: [], redCount: 1, heals: [], healError: null, testera: { enabled: false, hint: '' }, repoConfig: { knownBugs: false, signatures: false, blocked: false, lanes: false, paths: {} },
  };
}

/* ---------- Scoreboard (what stats.js would read from GitHub and Jira) ---------- */
function stats(fromMs) {
  const days = {};
  const put = (k, n, d) => { const key = ymd(Date.now() - d * DAY); if (new Date(key) >= new Date(ymd(fromMs))) ((days[k] ||= {})[key] = n); };
  const wave = [3, 1, 4, 2, 5, 0, 0, 2, 4, 3, 1, 5, 0, 0, 3, 2, 4, 1, 3, 0, 0, 2, 5, 3, 4, 2, 0, 0, 1, 3];
  wave.forEach((n, d) => { put('prsOpened', Math.ceil(n / 2), d); put('reviews', n, d); put('prsMerged', Math.floor(n / 2), d); });
  const ji = {}; wave.forEach((n, d) => { const key = ymd(Date.now() - d * DAY); if (new Date(key) >= new Date(ymd(fromMs))) { ((ji.storiesDone ||= {})[key] = n > 3 ? 1 : 0); ((ji.bugsFiled ||= {})[key] = n % 3 === 0 && n ? 1 : 0); } });
  return {
    gh: { days, openPRs: 2, reviewQueue: 3, closedUnmerged: 0, login: 'riley-demo' },
    ji,
    bugs: { total: 4, byPriority: { Highest: 1, High: 1, Medium: 1, Low: 1 }, byStatus: { Open: 3, 'In Progress': 1 }, oldestDays: 34, staleCount: 2 },
    errors: [],
  };
}

module.exports = { person, live, parts, projects, health, stats, ago, ME, SITE, REPO, issue, pr };

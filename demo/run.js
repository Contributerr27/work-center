// Demo mode: Work Center on made-up data, with every outside tool (gh, twg, AI CLIs, Slack and mail scans)
// switched off. Nothing is read from or sent to your accounts.
//   npm run demo          the web page (opens your browser)
//   npm run demo:app      the desktop app
// Data is written fresh to a temporary folder each time (see demo/fixtures.js).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const F = require('./fixtures');

const HOME = path.join(os.tmpdir(), 'work-center-demo');
const DATA = path.join(HOME, 'data');
fs.rmSync(HOME, { recursive: true, force: true });
const w = (rel, obj) => { const f = path.join(DATA, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); };

// Settings: the made-up person, everything that would reach out switched off.
fs.mkdirSync(HOME, { recursive: true });
fs.writeFileSync(path.join(HOME, 'settings.json'), JSON.stringify({
  ...F.person, dataDir: DATA, port: 4790, setupDoneAt: new Date().toISOString(),
  slackScan: { enabled: false }, mailScan: { enabled: false }, dailyScan: { enabled: false }, morningScan: false,
  hr: { manager: 'Alex Morgan' },
}, null, 2));

// AI briefing parts.
for (const [name, part] of Object.entries(F.parts())) w(`parts/${name}.json`, part);

// AI runs: a few chats and scans today and over the last weeks (AI Center calendar and Day feeds).
const run = (daysAgo, h, section, text, result, extra = {}) => {
  const startedAt = F.ago(daysAgo, h);
  const finishedAt = new Date(new Date(startedAt).getTime() + 95_000).toISOString();
  return { kind: 'command', id: `demo-${daysAgo}-${h}-${section}`, thread: `demo-${daysAgo}-${h}-${section}`, section, text, label: null, url: null, startedAt, finishedAt, result, error: null, engine: 'claude', steps: extra.steps || 6, actions: extra.actions || [], activity: extra.activity || [] };
};
const today = [
  run(0, 8, 'github', 'Review & approve dependency bumps', 'Approved **#409** (undici patch bump): CI green, no API changes.\n- Left **#405** alone: two contract tests fail on the retry path.', { actions: [{ kind: 'approved', label: '#409' }] }),
  run(0, 9, 'work', 'Which bugs from this week still need a regression test?', '```chart\n{"type":"stack","title":"9 bugs fixed this week","items":[{"label":"Already tested","value":5,"tone":"info"},{"label":"Test added","value":2,"tone":"good"},{"label":"Not testable end to end","value":2,"tone":"bad"}]}\n```\nI checked the 9 bugs fixed since Monday.\n- **PAY-240 (test-added):** duplicate idempotency key now returns 409; covered in the payout suite.\n- **PAY-236 (test-added):** one webhook delivery per event id.\n- **PAY-232 (not-testable):** a data fix for one merchant.\n- **Covered (5):** already in the nightly regression.'),
];
const hist = {};
for (const r of today) (hist[r.startedAt.slice(0, 10)] ||= []).push(r);
const pastTexts = [['jira', 'Nudge quiet bugs'], ['slack', 'Draft replies for #payments-qa'], ['work', 'Plan the settlement test matrix'], ['github', 'Ship my green PRs'], ['meet', 'Prep for the PRD review']];
for (let d = 1; d < 40; d++) {
  if ([0, 6].includes(new Date(Date.now() - d * 864e5).getDay())) continue;
  const n = 1 + ((d * 7) % 4);
  for (let i = 0; i < n; i++) {
    const [section, text] = pastTexts[(d + i) % pastTexts.length];
    const r = run(d, 9 + i * 2, section, text, 'Done. See the steps for details.');
    (hist[r.startedAt.slice(0, 10)] ||= []).push(r);
  }
}
for (const [day, list] of Object.entries(hist)) w(`history/${day}.jsonl`, list.map((x) => JSON.stringify(x)).join('\n') + '\n');
w('commands.json', today.map((r) => ({ ...r, running: false, sessionId: null, ref: null })).reverse());

// Messages (the phone panel) and a planned task.
w('pings.json', { lastScanAt: new Date().toISOString(), items: [
  { id: 'p1', source: 'slack', who: 'Dana Park', channel: '#payments-qa', when: F.ago(0, 8), kind: 'reply', urgency: 3, summary: 'Will the multi-currency test plan be ready for Thursday?', url: 'https://acme.slack.com/archives/C0DEMO1/p1', foundAt: F.ago(0, 8), seen: false, dismissed: false },
  { id: 'p2', source: 'mail', who: 'Alex Morgan', channel: 'Email', when: F.ago(0, 7), kind: 'reply', urgency: 2, summary: 'Q4 goals: can you own the release gate next quarter?', url: '', foundAt: F.ago(0, 7), seen: false, dismissed: false },
] });
w('tasks/demo-task.json', { id: 'demo-task', status: 'open', title: 'Write the multi-currency edge-case matrix', source: { section: 'slack', label: 'Dana Park in #payments-qa', url: 'https://acme.slack.com/archives/C0DEMO1/p1', who: 'Dana Park' },
  createdAt: F.ago(0, 8), summary: 'Dana needs the test plan for Thursday. Start from the PRD\'s currency list and the rounding rules.', due: null, priority: 'P1',
  steps: [{ text: 'List currency pairs from the PRD', done: true }, { text: 'Add rounding cases for JPY and KWD', done: false }, { text: 'Mark gaps with tickets', done: false }],
  links: [{ label: 'PRD', url: 'https://www.notion.so/acme/multi-currency-settlement' }] });

// Projects: an AI brief for the main epic.
w('projects/brief-PAY-200.json', { summary: 'Payouts are close: idempotency is merged, refund retries are in review, and terminal coverage waits on the vendor sandbox.', health: 'at-risk', healthWhy: 'PAY-224 is past its date and blocked by an outside outage.',
  comms: [{ source: 'Slack', title: '#payments-qa', who: 'Sam Ortiz', when: F.ago(1), url: 'https://acme.slack.com/archives/C0DEMO1/p4', snippet: 'Retry fix pushed, can you re-review?' }],
  blockers: [{ text: 'Terminal sandbox is down (vendor)', key: 'PAY-224', url: F.issue('PAY-224'), owner: 'Ops' }],
  decisions: [{ text: 'Duplicate idempotency keys return 409, not 500', when: F.ago(3), url: F.issue('PAY-240') }],
  next: [{ text: 'Re-review #405 and merge', key: 'PAY-228' }, { text: 'Same key, different body returns 422', key: 'PAY-231' }], risks: ['Vendor sandbox may stay down past the release'], generatedAt: new Date().toISOString() });

// Growth & HR.
w('hr/org.json', { summary: 'Payments QA sits in Platform Engineering under Alex Morgan.', me: { name: F.ME, title: 'QA Engineer', team: 'Payments' }, manager: { name: 'Alex Morgan', title: 'Engineering Manager, Payments', guess: false },
  chain: [{ name: 'Jamie Lee', title: 'VP Engineering' }], peers: [{ name: 'Sam Ortiz', title: 'Backend Engineer', guess: false }, { name: 'Priya Nair', title: 'Backend Engineer', guess: false }, { name: 'Mo Ali', title: 'SRE', guess: false }],
  reports: [], teams: [{ name: 'Payments', lead: 'Alex Morgan', members: [{ name: 'Sam Ortiz', title: 'Backend Engineer' }, { name: 'Priya Nair', title: 'Backend Engineer' }, { name: F.ME, title: 'QA Engineer' }] }, { name: 'Product', lead: 'Dana Park', members: [{ name: 'Dana Park', title: 'Product Manager' }] }],
  sources: ['Jira', 'Slack', 'Meeting notes'], generatedAt: new Date().toISOString() });
const year = new Date().getFullYear();
w(`hr/review-${year}.json`, { headline: 'Built the payments release gate and cut escaped bugs by half.', summary: `In ${year} Riley turned payments QA from manual checks into an automated gate that blocks bad merges.`,
  answers: [{ question: 'What were your most important accomplishments?', answer: 'I built the release gate for payments-api (PAY-150): contract tests block merges, flaky tests go to a quarantine lane, and the nightly regression runs 240 tests. Escaped payout bugs went from 8 to 4 per quarter.' },
    { question: 'Where do you want to grow?', answer: 'Owning test strategy for new products from the PRD stage, and mentoring the next QA hire.' }],
  accomplishments: [{ title: 'Payments release gate', impact: 'Bad merges are blocked before release', evidence: [{ label: 'PAY-150', url: F.issue('PAY-150') }] }, { title: 'Payout idempotency suite', impact: 'Duplicate payouts covered end to end', evidence: [{ label: '#412', url: F.pr(412) }] }],
  metrics: [{ label: 'PRs merged', value: '126' }, { label: 'Reviews', value: '214' }, { label: 'Bugs filed', value: '58' }, { label: 'Tests added', value: '240' }],
  growth: ['Bring test plans into PRD reviews earlier'], goals: ['Own the release gate across all payment services'], selfRating: { value: 'Exceeds', why: 'Delivered the gate a quarter early.' },
  period: { key: 'year', label: String(year), from: `${year}-01-01`, to: `${year}-12-31` }, facts: {}, generatedAt: new Date().toISOString() });
w(`hr/feedback/${new Date().toISOString().slice(0, 10)}.json`, { summary: 'Strong ownership of quality; push to share plans earlier.', score: 82, scoreWhy: 'Consistent delivery and clear bug reports; plans sometimes arrive late in the PRD cycle.',
  dimensions: [['Impact', 86, 'up'], ['Quality', 90, 'flat'], ['Ownership', 84, 'up'], ['Communication', 76, 'up'], ['Collaboration', 80, 'flat'], ['Planning', 72, 'down'], ['Growth', 78, 'up']].map(([name, score, trend]) => ({ name, score, trend, evidence: '' })),
  strengths: [{ text: 'Bug reports are precise and reproducible', evidence: 'PAY-240, PAY-236' }], improvements: [{ area: 'Planning', why: 'Test plans landed after two PRD reviews this quarter', try: 'Share a draft matrix before the first review' }],
  managerSignals: [{ date: F.ago(6).slice(0, 10), title: '1:1 with Alex', url: '', said: 'The gate is the reason releases feel calm now.', sentiment: 'positive' }], themes: ['Release confidence', 'Earlier planning'],
  nextActions: [{ text: 'Send the settlement matrix before Thursday', by: 'this week' }], window: { from: F.ago(90).slice(0, 10), to: new Date().toISOString().slice(0, 10) }, facts: {}, generatedAt: new Date().toISOString() });

w('state.json', { done: {} });
w('notes.md', '# Notes for the AI\n');

const env = { ...process.env, WORK_CENTER_DEMO: '1', DAILYHQ_HOME: HOME, MORNING_DESK_DATA: DATA };
console.log(`Demo data in ${HOME}`);
if (process.argv.includes('--app')) {
  spawn(require('electron'), [path.join(__dirname, '..')], { env, stdio: 'inherit' });
} else {
  Object.assign(process.env, env);
  require('../src/server').start().then((url) => {
    console.log(`Work Center demo at ${url}`);
    if (process.argv.includes('--shots')) {
      const p = spawn(require('electron'), [path.join(__dirname, 'shots.js'), url], { env, stdio: 'inherit' });
      p.on('close', () => process.exit(0));
      return;
    }
    if (!process.argv.includes('--no-open')) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  });
}

// End-of-day wrap: one AI run logs today's work to amem, drafts tomorrow's standup, suggests a one-line
// update per Jira ticket touched today (not posted), and on Fridays drafts a weekly report.
// Result: <DATA>/wrap/<YYYY-MM-DD>.json (last 30 kept). Posting a Jira update is a separate,
// explicit run per click.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JKEY = /^[A-Z][A-Z0-9]+-\d+$/;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const err = (msg, status) => Object.assign(new Error(msg), { status });

module.exports = {
  setup(ctx) {
    const DIR = path.join(ctx.DATA, 'wrap');
    const RUNS = path.join(DIR, 'runs.json'); // { date: commandId }
    fs.mkdirSync(DIR, { recursive: true });
    const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
    const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
    const fileOf = (date) => path.join(DIR, `${date}.json`);
    const dates = () => fs.readdirSync(DIR).map((f) => path.basename(f, '.json')).filter((d) => DATE.test(d)).sort().reverse();
    const prune = () => { for (const d of dates().slice(KEEP)) { try { fs.unlinkSync(fileOf(d)); } catch { /* gone */ } } };
    const cmdById = (id) => id && ctx.commands().find((c) => c.id === id);
    const pub = (c) => { if (!c) return null; const { log, pid, _result, ...rest } = c; return rest; };
    const running = () => ctx.commands().filter((c) => c.running).length;

    // What the day looked like, from the desk's own records (what the AI sees as "the section").
    function daySummary(date = dayKey()) {
      const st = ctx.readState();
      const today = Object.entries(st.done || {}).filter(([, at]) => at && dayKey(new Date(at)) === date);
      const missions = today.filter(([id]) => id.startsWith(`flow:${date}:`)).map(([id]) => id.split(':')[2]);
      const skipped = today.filter(([id]) => id.startsWith(`skip:${date}:`)).map(([id]) => id.split(':')[2]);
      const cleared = today.filter(([id]) => /^(sl|jr|ti|st):/.test(id)).map(([id]) => id);
      const runs = ctx.commands().filter((c) => c.startedAt && dayKey(new Date(c.startedAt)) === date && c.section !== 'wrap')
        .map((c) => ({ section: c.section, text: String(c.text || '').slice(0, 300), ok: !c.error && !c.running, result: String(c.result || c.error || '').slice(0, 400), actions: c.actions || [], ref: c.ref || null }));
      const tasks = ctx.readTasks().filter((t) => t.doneAt && dayKey(new Date(t.doneAt)) === date).map((t) => ({ title: t.title, source: t.source, links: t.links }));
      const focus = readJson(path.join(ctx.DATA, 'focus.json'), { history: [] }).history
        .filter((s) => s.completed && dayKey(new Date(s.endedAt || s.startedAt)) === date).map((s) => ({ minutes: s.minutes, label: s.label }));
      return { date, missionsDone: missions, missionsSkipped: skipped, itemsCleared: cleared, aiRuns: runs, tasksFinished: tasks, focusSessions: focus };
    }
    ctx.addSection('wrap', 'Wrap-up', () => daySummary());

    // The AI team's day, from its own records (data/team): per teammate and in total, with an output score
    // (how much got done) and a quality grade (shifts that succeeded, suggestions you approved).
    function teamDay(date = dayKey()) {
      const TD = path.join(ctx.DATA, 'team');
      const members = readJson(path.join(TD, 'members.json'), { members: [] }).members || [];
      if (!members.length) return null;
      const inbox = readJson(path.join(TD, 'inbox.json'), { items: [] }).items || [];
      const on = (iso) => iso && dayKey(new Date(iso)) === date;
      const LV = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master', 'Legend'];
      const rows = members.map((m) => {
        const st = readJson(path.join(TD, 'state', `${m.id}.json`), {});
        const hist = (st.history || []).filter((x) => on(x.at));
        const shifts = hist.filter((x) => x.kind !== 'execute');
        const mine = inbox.filter((i) => i.memberId === m.id);
        const asked = mine.filter((i) => i.kind === 'approval' && on(i.createdAt));
        const approved = mine.filter((i) => i.kind === 'approval' && i.status === 'approved' && on(i.resolvedAt));
        const declined = mine.filter((i) => i.kind === 'approval' && i.status === 'declined' && on(i.resolvedAt));
        const actions = approved.filter((i) => i.executed).length;
        const done = hist.reduce((a, x) => a + (x.done || 0), 0);
        const ok = shifts.filter((x) => x.ok).length;
        return {
          id: m.id, name: m.name, emoji: m.emoji, color: m.color, role: m.role, level: m.level || 1, levelTitle: LV[(m.level || 1) - 1],
          shifts: shifts.length, okShifts: ok, failed: shifts.length - ok, done, asked: asked.length, approved: approved.length, declined: declined.length, actions,
          cost: Math.round(hist.reduce((a, x) => a + (x.cost || 0), 0) * 100) / 100,
          highlights: shifts.filter((x) => x.ok && x.summary).slice(0, 4).map((x) => x.summary),
          lessons: (st.learned || []).filter((l) => on(l.at)).map((l) => l.text),
        };
      }).filter((r) => r.shifts || r.actions || r.asked);
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      const shifts = sum('shifts'), okShifts = sum('okShifts'), approved = sum('approved'), declined = sum('declined');
      const okRate = shifts ? okShifts / shifts : 1;
      const approveRate = approved + declined ? approved / (approved + declined) : 1;
      const quality = Math.round(100 * (0.5 * okRate + 0.5 * approveRate));
      const output = sum('done') * 4 + sum('actions') * 6 + okShifts * 2;
      return {
        members: rows, totals: { shifts, okShifts, failed: shifts - okShifts, done: sum('done'), actions: sum('actions'), asked: sum('asked'), approved, declined, cost: Math.round(rows.reduce((a, r) => a + r.cost, 0) * 100) / 100 },
        output, quality, grade: quality >= 90 ? 'A' : quality >= 80 ? 'B' : quality >= 65 ? 'C' : 'D',
      };
    }

    async function weekStats() {
      try {
        const { collectStats } = require('../stats');
        const s = await collectStats(ctx.config, 'week', { done: ctx.readState().done || {}, commands: ctx.commands() });
        return { totals: s.totals, rank: { title: s.rank?.title, score: s.rank?.score }, days: s.days, openBugs: s.openBugs, github: s.github, errors: s.errors };
      } catch (e) { return { error: e.message }; }
    }

    function wrapPrompt(date, out, friday, week) {
      const lines = [
        `End-of-day wrap for ${date} (${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}).`,
        'READ-ONLY everywhere: do not post, comment, transition, edit, send or create anything in Jira, Slack, GitHub, Gmail, Calendar or Notion.',
        'The only writes allowed: amem worklog entries (step 1) and the one JSON file in the last step.',
        '',
        `1. Worklog. Gather today's work: the desk data above (AI runs and their actions, missions, cleared items, tasks finished, focus sessions), my GitHub PRs opened / merged / reviewed today (gh), Jira tickets I touched today (twg jira workitem query 'issue in updatedBy(currentUser(), "startOfDay()")' or comments / transitions by me today), and today's Granola meetings. First check amem for today's existing worklog entries (amem context "worklog ${date}") and do not duplicate them. Then save each new reportable item per the "Work Log for Standups and Jira" rules in ~/.claude/CLAUDE.md: amem remember "${date} <plain-language item> — <done|in progress|next|blocked> <PR or ticket link>" --kind worklog --anchor worklog --anchor <repo or area> --anchor <JIRA-KEY>. One line per item. Never store secrets.`,
        '2. Standup. Draft my standup for the next working day following the amem skill "standup-status" (worklog since the last working day + open Jira sprint work): Done / Next / Blockers, 2-4 short bullets each, in my usual voice.',
        '3. Jira. List every Jira ticket I touched today with a suggested one-line update comment each (plain, factual, max 160 chars). Do NOT post them.',
        friday
          ? `4. Weekly report (today is Friday). Draft a short weekly report for my manager from this week's stats (JSON: ${JSON.stringify(week).slice(0, 6000)}) and this week's amem worklog entries: a title, 4-7 bullets of outcomes, and 2-3 highlights. No raw stat dumps; lead with outcomes.`
          : '4. No weekly report today (not Friday): set "weekly" to null.',
        `4b. My AI team. Their day, from Work Center (JSON): ${JSON.stringify(teamDay(date) || {}).slice(0, 9000)}. For each teammate write 1-2 plain sentences on what they achieved (outcomes, not process) and a quality call: "strong", "good" or "needs work", with a short why. Then one line on the team as a whole.`,
        `5. Write this JSON file and nothing else: ${out}`,
        '   {"date": "' + date + '", "generatedAt": "<ISO time>",',
        '    "headline": "one punchy line about the day, max 70 chars",',
        '    "standup": {"done": [""], "next": [""], "blockers": [""]},',
        '    "jiraUpdates": [{"key": "ABC-1", "title": "", "update": "", "url": "https://…/browse/ABC-1"}],',
        '    "weekly": {"title": "", "bullets": [""], "highlights": [""]} or null,',
        '    "team": {"headline": "one line on the team\'s day", "members": [{"name": "", "summary": "", "quality": "strong | good | needs work", "why": ""}]},',
        '    "worklogSaved": ["the exact worklog lines you saved in step 1"]}',
        '   Validate it is valid JSON.',
        '6. Reply with one line: how many worklog entries you saved and how many Jira updates you suggested.',
      ];
      return lines.join('\n');
    }

    function statusOf(wrap) {
      for (const u of wrap?.jiraUpdates || []) {
        const c = cmdById(u.postCmd);
        u.postStatus = !u.postCmd ? null : !c ? 'unknown' : c.running ? 'posting'
          : c.error ? 'failed' : (c.actions || []).some((a) => a.kind === 'commented' && a.key === u.key) ? 'posted' : 'done';
      }
      return wrap;
    }

    ctx.route('GET', '/api/wrap', async ({ url }) => {
      const date = DATE.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : dayKey();
      const runId = readJson(RUNS, {})[date];
      const wrap = statusOf(readJson(fileOf(date), null));
      return {
        date, today: dayKey(), friday: new Date(`${date}T12:00:00`).getDay() === 5,
        wrap, run: pub(cmdById(runId)), team: teamDay(date), autoAt: `${pad(endHour())}:00`,
        past: dates().map((d) => { const w = readJson(fileOf(d), {}); return { date: d, headline: w.headline || '', weekly: !!w.weekly }; }),
      };
    });

    // The wrap writes itself at the end of the work day (settings workHours.to, default 17:00), on weekdays,
    // once per day, unless it was already written or is running.
    const endHour = () => Math.min(23, Math.max(12, Number(ctx.config.workHours?.to) || 17));
    async function startWrap() {
      const date = dayKey();
      const runs = readJson(RUNS, {});
      const prev = cmdById(runs[date]);
      if (prev?.running) throw err('The wrap is already being written', 409);
      if (running() >= 4) throw err('Four AI jobs are already running', 429);
      const friday = new Date().getDay() === 5;
      const week = friday ? await weekStats() : null;
      const cmd = ctx.runCommand('wrap', wrapPrompt(date, fileOf(date), friday, week));
      for (const k of Object.keys(runs)) if (!DATE.test(k) || k < dayKey(new Date(Date.now() - 40 * 86_400_000))) delete runs[k];
      runs[date] = cmd.id;
      writeJson(RUNS, runs);
      prune();
      return cmd;
    }
    setInterval(() => {
      const now = new Date(), wd = now.getDay();
      if (wd === 0 || wd === 6 || now.getHours() < endHour()) return;
      const date = dayKey();
      if (fs.existsSync(fileOf(date)) || readJson(RUNS, {})[date]) return;
      startWrap().then(() => ctx.notify?.('Your day is wrapped up', 'Standup, Jira updates and the team summary are ready in Wrap up.')).catch(() => {});
    }, 60_000).unref();

    ctx.route('POST', '/api/wrap/run', async () => pub(await startWrap()));

    // Post one (key) or every unposted suggested update as a Jira comment. The text comes from the saved
    // wrap file, never from the request.
    ctx.route('POST', '/api/wrap/post', async ({ body }) => {
      const date = DATE.test(body?.date || '') ? body.date : dayKey();
      const f = fileOf(date);
      const wrap = statusOf(readJson(f, null));
      if (!wrap) throw err('No wrap for that day', 404);
      const all = !!body?.all;
      if (!all && !JKEY.test(body?.key || '')) throw err('Bad ticket key', 400);
      const pick = (wrap.jiraUpdates || []).filter((u) => JKEY.test(u.key || '') && String(u.update || '').trim()
        && (all ? !['posted', 'posting', 'done'].includes(u.postStatus) : u.key === body.key));
      if (!pick.length) throw err(all ? 'Nothing left to post' : 'No update for that ticket', 404);
      if (!all && ['posting', 'posted', 'done'].includes(pick[0].postStatus)) throw err('Already posted', 409);
      if (running() >= 4) throw err('Four AI jobs are already running', 429);
      const list = pick.map((u) => `- ${u.key}: ${JSON.stringify(String(u.update).slice(0, 500))}`).join('\n');
      const text = [
        `Post ${pick.length === 1 ? 'this one Jira comment' : `these ${pick.length} Jira comments, one per ticket`}, as me, with exactly the text given (the JSON string content) and nothing added:`,
        list,
        'Use the Jira comment tool or `twg jira workitem comment`. Do nothing else: no transitions, edits, assignee or field changes, no other comments, no other tickets, no Slack.',
        'If a comment fails, say which and why. Reply with one line per ticket: "<KEY> commented" or the failure.',
      ].join('\n');
      const cmd = ctx.runCommand('wrap', text);
      for (const u of wrap.jiraUpdates) if (pick.includes(u)) u.postCmd = cmd.id;
      writeJson(f, Object.assign(wrap, { jiraUpdates: wrap.jiraUpdates.map(({ postStatus, ...u }) => u) }));
      return { posting: pick.map((u) => u.key), command: pub(cmd) };
    });

    // Put the wrap's standup into the next standup meeting on the Meetings mission.
    ctx.route('POST', '/api/wrap/to-meetings', async ({ body }) => {
      const date = DATE.test(body?.date || '') ? body.date : dayKey();
      const wrap = readJson(fileOf(date), null);
      if (!wrap?.standup) throw err('No standup in that wrap yet', 404);
      const mf = path.join(ctx.PARTS, 'meetings.json');
      const m = readJson(mf, null);
      if (!m?.meetings) throw err('No meetings yet: run the AI scan first', 404);
      const now = Date.now();
      const next = m.meetings.filter((x) => x.kind === 'standup' && !x.private && new Date(x.end || x.start) > now)
        .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
      if (!next) throw err('No upcoming standup in Meetings', 404);
      const clean = (l) => (Array.isArray(l) ? l.map(String).filter(Boolean).slice(0, 6) : []);
      next.standup = { done: clean(wrap.standup.done), next: clean(wrap.standup.next), blockers: clean(wrap.standup.blockers) };
      next.standupFrom = `wrap ${date}`;
      writeJson(mf, m);
      return { title: next.title, start: next.start };
    });
  },
};

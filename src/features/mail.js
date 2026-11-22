// Email and calendar invites on the phone: a small-model scan of Gmail threads that need a reply and
// unanswered calendar invites. New items ring the phone; emails also land in Mission 3 (Messages).
// Settings: mailScan = { enabled, everyMinutes (15), fromHour, toHour, weekdaysOnly, model ('haiku') }.
const fs = require('node:fs');
const path = require('node:path');

function setup(ctx) {
  const cfg = { enabled: true, everyMinutes: 15, fromHour: 8, toHour: 19, weekdaysOnly: true, model: 'haiku', ...(ctx.config.mailScan || {}) };
  const STATE = path.join(ctx.DATA, 'mail-scan.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { lastScanAt: null }; } };
  const write = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  let scan = { running: false, lastError: null, lastAt: read().lastScanAt };

  function due(now = new Date()) {
    if (!cfg.enabled || scan.running) return false;
    if (!ctx.config.owner?.email && ctx.config.mailScan?.enabled !== true) return false; // set up by Settings
    const d = now.getDay(), hr = now.getHours();
    if (cfg.weekdaysOnly && (d === 0 || d === 6)) return false;
    if (hr < cfg.fromHour || hr >= cfg.toHour) return false;
    const last = read().lastScanAt;
    return !last || now - new Date(last) >= cfg.everyMinutes * 60_000 - 5_000;
  }

  function run(force) {
    if (scan.running || (!force && !due())) return scan;
    const st = read();
    const since = new Date(Math.max(Date.now() - 3 * 24 * 3600_000, st.lastScanAt ? new Date(st.lastScanAt) - 5 * 60_000 : Date.now() - 24 * 3600_000));
    const startedAt = new Date().toISOString();
    const prompt = ctx.fillPrompt(fs.readFileSync(path.join(ctx.ROOT, 'prompts', 'mail-scan.md'), 'utf8'), {
      EMAIL_HINT: ctx.config.owner?.email ? `the ${ctx.config.owner.email} account` : 'their own email account',
      SINCE: since.toISOString(), SINCE_DATE: since.toISOString().slice(0, 10).replaceAll('-', '/'), SINCE_HUMAN: since.toLocaleString(),
    });
    scan = { ...scan, running: true, startedAt };
    ctx.ai(prompt, { small: cfg.model !== null, cwd: ctx.DATA }).then((r) => {
      try {
        if (r.error) throw new Error(r.error);
        const text = String(r.text || '[]');
        const items = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1) || '[]');
        const mail = items.filter((i) => i.source === 'gmail' || i.source === 'email');
        const invites = items.filter((i) => i.source === 'calendar' || i.kind === 'invite').map((i) => ({ ...i, source: 'calendar', kind: 'invite' }));
        ctx.addPings(mail, { source: 'gmail', mission3: true });
        ctx.addPings(invites, { source: 'calendar', mission3: false });
        write({ lastScanAt: startedAt, lastCost: r.cost, lastFound: items.length });
        scan = { running: false, lastError: null, lastAt: new Date().toISOString() };
        if (items.length) ctx.logRun({ kind: 'scan', title: 'Email and calendar check', startedAt, finishedAt: scan.lastAt, result: `${mail.length} email${mail.length === 1 ? '' : 's'}, ${invites.length} invite${invites.length === 1 ? '' : 's'}: ${items.slice(0, 5).map((i) => i.summary || i.who).filter(Boolean).join('; ')}`.slice(0, 1500), cost: r.cost });
      } catch (e) {
        scan = { running: false, lastError: e.message.slice(0, 200), lastAt: scan.lastAt };
        ctx.logRun({ kind: 'scan', title: 'Email and calendar check', startedAt, finishedAt: new Date().toISOString(), error: scan.lastError });
      }
    });
    return scan;
  }

  setInterval(() => { try { run(false); } catch (e) { scan.lastError = e.message; } }, 60_000).unref();
  ctx.route('POST', '/api/mail/scan', () => run(true));
  ctx.provide('mail', () => ({ ...scan, every: cfg.everyMinutes, enabled: cfg.enabled }));

  // Answer an invite. Outward: the page confirms first; this starts one AI run that does exactly that.
  ctx.route('POST', '/api/mail/invite', ({ body }) => {
    const { pingId, answer } = body || {};
    if (!['accepted', 'declined', 'tentative'].includes(answer)) throw Object.assign(new Error('Bad answer'), { status: 400 });
    const p = JSON.parse(fs.readFileSync(path.join(ctx.DATA, 'pings.json'), 'utf8'));
    const item = p.items.find((i) => i.id === pingId);
    if (!item) throw Object.assign(new Error('No such invite'), { status: 404 });
    if (item.answering) return { id: item.answering.cmdId, already: true };
    const acct = ctx.config.owner?.email ? `the ${ctx.config.owner.email} account` : 'their work account (category "work"; the invite went to their work email)';
    const cmd = ctx.runCommand('meet', [
      `Set the user's RSVP to "${answer}" for the calendar invitation "${item.summary}" (from ${item.who || 'the organizer'}, starts ${item.when || 'see summary'}; Gmail link ${item.url || 'none'}; event id hint ${item.eventId || 'none'}).`,
      `1. Use the Notion Calendar tools first: notion-calendar-list-calendars, pick ${acct}, find the event with notion-calendar-list-events around that time (match the title), then notion-calendar-update-events with updateType "RSVP" and responseStatus "${answer}".`,
      '2. Only if Notion Calendar cannot reach that calendar, try the Google Calendar tools (respond_to_event), checking that they are signed in to the same account the invite was sent to.',
      '3. Do only that: no other events, no messages. Report in one line whether the RSVP went through; if it did not, say why in a few words.',
    ].join('\n'), { ref: { label: item.summary, url: item.url } });
    Object.assign(item, { seen: true, answering: { answer, cmdId: cmd.id, at: new Date().toISOString() }, answerError: null });
    fs.writeFileSync(path.join(ctx.DATA, 'pings.json'), JSON.stringify(p, null, 2));
    return { id: cmd.id };
  });

  // Done only when the run actually changed the RSVP: then the invite clears itself from the phone.
  // If it didn't, the invite stays with the reason so he can retry or open it.
  function settleInvites() {
    const file = path.join(ctx.DATA, 'pings.json');
    let p;
    try { p = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    let changed = false;
    for (const item of p.items || []) {
      if (!item.answering) continue;
      const cmd = ctx.commands().find((c) => c.id === item.answering.cmdId);
      if (cmd?.running) continue;
      if (cmd && (cmd.actions || []).some((a) => a.kind === 'rsvp')) Object.assign(item, { answered: item.answering.answer, dismissed: true });
      else item.answerError = String(cmd ? cmd.error || cmd.result || '' : 'The run was lost').split('\n').find((l) => l.trim())?.slice(0, 160) || 'The RSVP did not go through';
      delete item.answering;
      changed = true;
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(p, null, 2));
  }
  setInterval(() => { try { settleInvites(); } catch { /* next tick */ } }, 4_000).unref();
}

module.exports = { setup };

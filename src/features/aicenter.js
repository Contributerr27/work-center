// AI Center: the history of every AI run by day (chats, tasks, autopilot, scans, PRD runs), one run's
// full transcript, the floating AI chat, and file uploads for it.
//   GET  /api/history?date=YYYY-MM-DD    runs that day, newest first
//   GET  /api/history/days?month=YYYY-MM how many runs per day (calendar dots)
//   GET  /api/history/run?id=…           one run (or its whole chat thread) with the full transcript
//   POST /api/ai/upload { name, data }   base64 file → a path the AI can read
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { transcript, parseProgress } = require('../progress');

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function setup(ctx) {
  const HIST = path.join(ctx.DATA, 'history');
  const CMD_DIR = path.join(ctx.DATA, 'commands');
  const UP = path.join(ctx.DATA, 'uploads');
  fs.mkdirSync(HIST, { recursive: true });
  ctx.addSection('hq', 'AI chat', () => ({ note: 'General chat from the AI bubble; nothing is selected on the desk.' }));

  const slim = (c) => ({
    kind: c.section === 'auto' || c.autopilot ? 'autopilot' : c.taskFile ? 'task' : 'run',
    id: c.id, thread: c.thread, section: c.section, text: c.text, label: c.ref?.label || null, url: c.ref?.url || null,
    startedAt: c.startedAt, finishedAt: c.finishedAt, result: c.result ? String(c.result).slice(0, 4000) : null, error: c.error || null,
    engine: c.engine || null, steps: c.steps || 0, actions: c.actions || [], attachments: c.attachments || undefined,
  });
  const append = (e) => {
    const at = e.startedAt || e.finishedAt || new Date().toISOString();
    fs.appendFileSync(path.join(HIST, `${dayOf(at)}.jsonl`), `${JSON.stringify(e)}\n`);
  };
  ctx.onCommandFinished((c) => append(slim(c)));
  ctx.onBackgroundRun((e) => append({ id: `bg-${crypto.randomBytes(4).toString('hex')}`, ...e }));

  function readDay(day) {
    const byId = new Map();
    try {
      for (const line of fs.readFileSync(path.join(HIST, `${day}.jsonl`), 'utf8').split('\n')) {
        if (!line) continue;
        try { const e = JSON.parse(line); byId.set(e.id, e); } catch { /* torn line */ }
      }
    } catch { /* no history file that day */ }
    // Runs still going, and runs from before the history existed (kept in commands.json / logs).
    for (const c of ctx.commands()) if (dayOf(c.startedAt) === day && (!byId.has(c.id) || c.running)) byId.set(c.id, { ...slim(c), running: !!c.running });
    for (const f of logsOn(day)) {
      const id = path.basename(f, '.log');
      if (byId.has(id)) continue;
      const st = fs.statSync(f);
      const t = transcript(fs.readFileSync(f, 'utf8'));
      const first = t.steps.find((s) => s.kind === 'text');
      const probe = { log: f };
      parseProgress(probe);
      byId.set(id, { kind: 'run', id, thread: id, text: null, label: first ? first.text.split('\n')[0].slice(0, 120) : 'Earlier AI run', startedAt: st.mtime.toISOString(), finishedAt: st.mtime.toISOString(), result: t.result?.text?.slice(0, 2000) || null, error: t.result?.error ? t.result.text : null, steps: t.steps.filter((s) => s.kind === 'tool').length, actions: probe.actions || [], legacy: true });
    }
    return [...byId.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  let logIndex = null;
  function logsOn(day) {
    if (!logIndex || Date.now() - logIndex.at > 60_000) {
      const map = {};
      try {
        for (const f of fs.readdirSync(CMD_DIR)) {
          if (!f.endsWith('.log')) continue;
          const full = path.join(CMD_DIR, f);
          const d = dayOf(fs.statSync(full).mtime);
          (map[d] ||= []).push(full);
        }
      } catch { /* no logs yet */ }
      logIndex = { at: Date.now(), map };
    }
    return logIndex.map[day] || [];
  }

  ctx.route('GET', '/api/history', ({ url }) => {
    const day = url.searchParams.get('date') || dayOf(new Date());
    if (!DAY.test(day)) throw bad('Bad date');
    return { date: day, runs: readDay(day) };
  });

  ctx.route('GET', '/api/history/days', ({ url }) => {
    const month = url.searchParams.get('month') || dayOf(new Date()).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Bad month');
    const days = {};
    logsOn(`${month}-01`); // refresh the log index
    for (const [d, files] of Object.entries(logIndex.map)) if (d.startsWith(month)) days[d] = new Set(files.map((f) => path.basename(f, '.log')));
    for (const f of fs.readdirSync(HIST)) {
      if (!f.startsWith(month)) continue;
      const d = f.slice(0, 10);
      days[d] ||= new Set();
      for (const line of fs.readFileSync(path.join(HIST, f), 'utf8').split('\n')) { try { days[d].add(JSON.parse(line).id); } catch { /* skip */ } }
    }
    for (const c of ctx.commands()) { const d = dayOf(c.startedAt); if (d.startsWith(month)) (days[d] ||= new Set()).add(c.id); }
    return { month, days: Object.fromEntries(Object.entries(days).map(([d, s]) => [d, s.size])) };
  });

  ctx.route('GET', '/api/history/run', ({ url }) => {
    const id = url.searchParams.get('id') || '';
    if (!/^[\w-]{4,40}$/.test(id)) throw bad('Bad id');
    const day = url.searchParams.get('date');
    const pool = day && DAY.test(day) ? readDay(day) : [];
    const live = ctx.commands().find((c) => c.id === id);
    const me = live ? slim(live) : pool.find((r) => r.id === id);
    if (!me) throw bad('No such run', 404);
    // The whole chat: every run in the same thread, oldest first.
    const thread = me.thread || me.id;
    const runs = [...new Map([...pool, ...ctx.commands().map(slim)].filter((r) => (r.thread || r.id) === thread).map((r) => [r.id, r])).values()]
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    return {
      thread,
      runs: (runs.length ? runs : [me]).map((r) => {
        const log = path.join(CMD_DIR, `${r.id}.log`);
        let t = { steps: [], result: null };
        try { t = transcript(fs.readFileSync(log, 'utf8')); } catch { /* background runs keep no log */ }
        const c = ctx.commands().find((x) => x.id === r.id);
        return { ...r, running: !!c?.running, transcript: t.steps, final: t.result };
      }),
    };
  });

  // Home view: the long view across days (activity heatmap, streak, what the AI got done, wins).
  ctx.route('GET', '/api/home', () => {
    const today = new Date();
    const heat = {};
    const acts = {};
    const wins = [];
    const done = ctx.readState().done || {};
    const doneDays = {};
    for (const iso of Object.values(done)) { const d = dayOf(iso); doneDays[d] = (doneDays[d] || 0) + 1; }
    for (let i = 0; i < 126; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = dayOf(d);
      const runs = i < 126 ? readDayCached(k) : [];
      heat[k] = { ai: runs.length, done: doneDays[k] || 0 };
      for (const r of runs) {
        for (const a of r.actions || []) {
          if (i < 30) acts[a.kind] = (acts[a.kind] || 0) + 1;
          if (wins.length < 14) wins.push({ kind: a.kind, key: a.key, label: r.label || r.text || r.title, at: r.finishedAt || r.startedAt, id: r.id, day: k });
        }
      }
    }
    let streak = 0;
    for (let i = 0; i < 126; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = dayOf(d);
      const wk = d.getDay() === 0 || d.getDay() === 6;
      const busy = heat[k].ai + heat[k].done > 0;
      if (busy) streak++;
      else if (i === 0 || wk) continue; // today not started yet, weekends do not break it
      else break;
    }
    const last30 = Object.entries(heat).filter(([k]) => k >= dayOf(new Date(today - 29 * 864e5)));
    return {
      heat, streak, wins, actions30: acts,
      ai30: last30.reduce((a, [, v]) => a + v.ai, 0), done30: last30.reduce((a, [, v]) => a + v.done, 0),
      busiest: Object.entries(heat).sort((a, b) => (b[1].ai + b[1].done) - (a[1].ai + a[1].done))[0] || null,
    };
  });
  const dayCache = new Map();
  function readDayCached(k) {
    const isToday = k === dayOf(new Date());
    const hit = dayCache.get(k);
    if (hit && !isToday) return hit;
    const runs = readDay(k);
    if (!isToday) dayCache.set(k, runs);
    return runs;
  }

  ctx.route('POST', '/api/ai/upload', ({ body }) => {
    const name = String(body?.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';
    const data = String(body?.data || '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw bad('Empty file');
    if (buf.length > 20 * 1024 * 1024) throw bad('Files up to 20 MB');
    const dir = path.join(UP, `${dayOf(new Date())}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf);
    return { path: file, name, bytes: buf.length };
  });
}

module.exports = { setup };

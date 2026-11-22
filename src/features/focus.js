// Focus missions: a 25 / 50 / 90 minute timer on one task. The session lives in <DATA>/focus.json so it
// survives reloads and restarts; the server ends it on time (native notification) and records it in history.
// Optional config.json: "focus": { "onStart": "shortcuts run 'Work Focus On'", "onEnd": "shortcuts run 'Work Focus Off'" }
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HISTORY = 500;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const err = (msg, status) => Object.assign(new Error(msg), { status });

const fileIn = (dataDir) => path.join(dataDir, 'focus.json');
function readFocus(dataDir) {
  try { const f = JSON.parse(fs.readFileSync(fileIn(dataDir), 'utf8')); return { active: f.active || null, history: f.history || [] }; } catch { return { active: null, history: [] }; }
}

// For the scoreboard: completed focus minutes per local day since `from` ({ 'YYYY-MM-DD': minutes }).
function focusMinutesByDay(dataDir, from = new Date(0)) {
  const out = {};
  for (const s of readFocus(dataDir).history) {
    if (!s.completed || !s.endedAt || new Date(s.endedAt) < from) continue;
    const k = dayKey(new Date(s.endedAt));
    out[k] = (out[k] || 0) + (s.minutes || 0);
  }
  return out;
}

let state = null; // set in setup
module.exports = {
  focusMinutesByDay,
  readFocus,
  // true while a session runs (for server-side quiet, e.g. skipping non-urgent notifications)
  isFocusActive: () => !!state?.isActive(),
  setup(ctx) {
    const FILE = fileIn(ctx.DATA);
    const cfg = ctx.config.focus || {};
    let lastHook = null;
    const read = () => readFocus(ctx.DATA);
    const write = (f) => fs.writeFileSync(FILE, JSON.stringify({ active: f.active, history: f.history.slice(0, HISTORY) }, null, 2));

    function hook(which) {
      const cmd = cfg[which];
      if (!cmd || typeof cmd !== 'string') return;
      execFile('/bin/sh', ['-c', cmd], { timeout: 15_000, env: ctx.env }, (e, out, errOut) => {
        lastHook = { which, at: new Date().toISOString(), ok: !e, error: e ? String(errOut || e.message).trim().slice(0, 200) : null };
      });
    }

    function end(f, completed) {
      const a = f.active;
      const now = new Date();
      const endedAt = completed ? new Date(a.endsAt) : now;
      const minutes = completed ? a.minutes : Math.max(0, Math.round((now - new Date(a.startedAt)) / 60_000));
      f.history.unshift({ startedAt: a.startedAt, endedAt: endedAt.toISOString(), minutes, planned: a.minutes, taskId: a.taskId || null, label: a.label || '', completed });
      f.active = null;
      write(f);
      hook('onEnd');
      if (completed) ctx.notify('Focus mission passed', `${minutes} min${a.label ? ` on ${a.label}` : ''}. Take a break.`);
      return f.history[0];
    }

    function tick() {
      const f = read();
      if (f.active && Date.now() >= new Date(f.active.endsAt).getTime()) end(f, true);
    }
    tick(); // a session that ran out while the app was closed
    setInterval(() => { try { tick(); } catch (e) { console.error(`focus: ${e.message}`); } }, 5_000).unref();
    state = { isActive: () => { const f = read(); return !!f.active && Date.now() < new Date(f.active.endsAt).getTime(); } };

    function view() {
      const f = read();
      const today = dayKey(new Date());
      const done = f.history.filter((s) => s.completed && s.endedAt && dayKey(new Date(s.endedAt)) === today);
      return {
        active: f.active, now: new Date().toISOString(), quiet: !!f.active,
        today: { sessions: done.length, minutes: done.reduce((a, s) => a + (s.minutes || 0), 0) },
        last: f.history[0] || null,
        history: f.history.slice(0, 20),
        hooks: { onStart: !!cfg.onStart, onEnd: !!cfg.onEnd, last: lastHook },
      };
    }
    ctx.provide('focus', async () => view());
    ctx.route('GET', '/api/focus', async () => view());

    ctx.route('POST', '/api/focus/start', async ({ body }) => {
      const minutes = Number(body?.minutes || 50);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw err('Pick 25, 50 or 90 minutes', 400);
      const f = read();
      if (f.active) end(f, false);
      const taskId = /^[a-f0-9]{10}$/.test(body?.taskId || '') ? body.taskId : null;
      const task = taskId ? ctx.readTasks().find((t) => t.id === taskId) : null;
      const label = String(body?.label || task?.title || '').trim().slice(0, 120);
      const now = new Date();
      f.active = { startedAt: now.toISOString(), endsAt: new Date(now.getTime() + minutes * 60_000).toISOString(), minutes, taskId: task ? taskId : null, label };
      write(f);
      hook('onStart');
      return view();
    });

    ctx.route('POST', '/api/focus/stop', async () => {
      const f = read();
      if (!f.active) throw err('No focus session running', 404);
      end(f, false);
      return view();
    });

    ctx.route('POST', '/api/focus/extend', async () => {
      const f = read();
      if (!f.active) throw err('No focus session running', 404);
      f.active.endsAt = new Date(new Date(f.active.endsAt).getTime() + 10 * 60_000).toISOString();
      f.active.minutes += 10;
      write(f);
      return view();
    });
  },
};

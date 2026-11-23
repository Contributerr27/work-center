'use strict';
// Meeting alerts and joining calls inside Work Center.
// Today's meetings come from the morning scan (data/parts/meetings.json) and the 15-minute email and
// calendar check (data/upcoming.json, which also catches meetings added during the day). A few minutes
// before one starts, a macOS notification and an in-app card offer "Join here": the call opens in a side
// panel of the window (src: main.js meetPanel), or in the browser when that isn't possible.
// Settings `meetingAlerts`: { enabled (true), minutesBefore (2), inApp (true) }.
const fs = require('node:fs');
const path = require('node:path');

// Video-call hosts that may open in the panel. Anything else opens in the browser.
const CALL_HOSTS = /(^|\.)(meet\.google\.com|zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|around\.co)$/i;
function callUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    if (x.protocol !== 'https:' || !CALL_HOSTS.test(x.hostname)) return null;
    // Zoom links open the desktop app; its web client keeps the call in the panel.
    const zm = x.hostname.endsWith('zoom.us') && x.pathname.match(/^\/[jw]\/(\d+)/);
    if (zm) return `https://app.zoom.us/wc/join/${zm[1]}${x.search}`;
    return x.toString();
  } catch { return null; }
}

function setup(ctx) {
  const cfg = () => ({ enabled: true, minutesBefore: 2, inApp: true, ...(ctx.config.meetingAlerts || {}) });
  const UP = path.join(ctx.DATA, 'upcoming.json');
  const SEEN = path.join(ctx.DATA, 'meeting-alerts.json');
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

  const idOf = (m) => `${new Date(m.start).toISOString()}|${String(m.title || '').trim().toLowerCase().slice(0, 60)}`;
  function today() {
    const now = Date.now();
    const from = now - 3 * 3600_000, to = now + 14 * 3600_000;
    const out = new Map();
    const add = (m, src) => {
      if (!m?.start || isNaN(new Date(m.start))) return;
      const t = new Date(m.start).getTime();
      if (t < from || t > to) return;
      const id = idOf(m);
      const prev = out.get(id) || {};
      out.set(id, {
        id, title: m.title || prev.title || 'Meeting', start: m.start, end: m.end || prev.end || null,
        join: callUrl(m.join) || prev.join || callUrl(m.url) || null, // a notes link (url) is never a call
        rawJoin: m.join || prev.rawJoin || null, url: prev.url || m.url || null, src: prev.src ? `${prev.src}+${src}` : src,
      });
    };
    for (const m of ctx.briefing().meetings?.meetings || []) add(m, 'scan');
    for (const m of readJson(UP, {}).events || []) add(m, 'calendar');
    return [...out.values()].sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  // Alerts: once per meeting, from minutesBefore until 5 minutes after the start.
  let due = [];
  function check() {
    const c = cfg();
    if (!c.enabled) { due = []; return; }
    const seen = readJson(SEEN, {});
    const now = Date.now();
    due = today().filter((m) => {
      const t = new Date(m.start).getTime();
      return now >= t - c.minutesBefore * 60_000 && now <= t + 5 * 60_000 && !seen[m.id]?.dismissed;
    });
    let changed = false;
    for (const m of due) {
      if (seen[m.id]?.notified) continue;
      const at = new Date(m.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      ctx.notify(`${m.title}`, `Starts ${at}${m.join ? ' · Join from Work Center' : ''}`);
      seen[m.id] = { notified: new Date().toISOString() };
      changed = true;
    }
    // Forget meetings older than two days.
    for (const [k, v] of Object.entries(seen)) if (Date.now() - new Date(v.notified || v.dismissed || 0) > 2 * 86_400_000) { delete seen[k]; changed = true; }
    if (changed) try { fs.writeFileSync(SEEN, JSON.stringify(seen, null, 2)); } catch { /* data dir gone */ }
  }
  setInterval(() => { try { check(); } catch { /* next tick */ } }, 20_000).unref();
  setTimeout(() => { try { check(); } catch { /* next tick */ } }, 3000).unref();

  ctx.route('GET', '/api/meetings/upcoming', () => { check(); return { meetings: today(), due, inApp: cfg().inApp, minutesBefore: cfg().minutesBefore }; });
  ctx.route('POST', '/api/meetings/dismiss', ({ body }) => {
    const seen = readJson(SEEN, {});
    seen[String(body?.id || '')] = { ...(seen[body?.id] || {}), dismissed: new Date().toISOString() };
    fs.writeFileSync(SEEN, JSON.stringify(seen, null, 2));
    check();
    return { ok: true };
  });
  // Join: the panel when the app shell can show one, else the page opens the link in the browser.
  ctx.route('POST', '/api/meetings/join', ({ body }) => {
    const m = today().find((x) => x.id === body?.id);
    const url = callUrl(body?.url) || m?.join;
    if (!url) return { ok: false, error: 'No video link for this meeting' };
    const handled = body?.where !== 'browser' && !!ctx.uiCall('meet', { url, title: m?.title || body?.title || 'Meeting' });
    return { ok: true, handled, url };
  });
}

module.exports = { setup, callUrl };

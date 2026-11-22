// OS integration for the Electron shell: menu-bar (tray) icon, global quick-capture hotkey,
// launch at login and the once-a-day morning AI scan. Used by main.js only (not by `npm run web`).
//
// config.json keys (all optional):
//   hotkey         "CommandOrControl+Shift+Space"   global shortcut for the quick-capture window ("" or false: none)
//   launchAtLogin  false                             start Work Center at login, hidden in the menu bar
//   morningScan    true                              run the AI scan once on weekday mornings after 06:00
const { app, Tray, Menu, BrowserWindow, globalShortcut, nativeImage, powerMonitor, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Same settings and data folder as src/server.js, so every copy of the app shares the morning-scan record.
const { config, DATA, ROOT } = require('./settings');
const OS_FILE = path.join(DATA, 'os.json'); // { launchAtLogin, morningScanDate }
const MAC = process.platform === 'darwin';
const CORE = { github: 'Pull requests', jira: 'Jira', slack: 'Slack', work: 'Work', meet: 'Meetings' };

const readOs = () => { try { return JSON.parse(fs.readFileSync(OS_FILE, 'utf8')); } catch { return {}; } };
const writeOs = (patch) => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(OS_FILE, JSON.stringify({ ...readOs(), ...patch }, null, 2)); } catch (e) { console.error(`os.json: ${e.message}`); } };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let base = ''; // server URL from start()
let getWin = () => null; // main window (may be hidden or not created yet)
let showWin = () => {};
let tray = null;
let capture = null;
let token = null;
let menu = null;
let snap = { unseen: [], mission: null, count: null, stars: null, sections: Object.entries(CORE) };

/* ---------- Talking to the local server ---------- */
async function getToken() {
  if (token) return token;
  const w = getWin();
  if (w && !w.isDestroyed()) token = await w.webContents.executeJavaScript('typeof D !== "undefined" && D ? D.token : null').catch(() => null);
  if (!token) token = (await (await fetch(`${base}/api/all`)).json()).token; // the token is fixed for the server's lifetime
  return token;
}
async function post(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-desk-token': await getToken() }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// The main page already knows the current mission, its count and the workload stars (flow.js),
// including missions added by feature scripts. Ask it; fall back to the core missions from /api/all.
const PAGE_SNAPSHOT = `(() => { try {
  if (typeof D === 'undefined' || !D || typeof FLOW === 'undefined') return null;
  const cur = current(), n = counts(), wl = workload(), step = FLOW.find((s) => s.id === cur);
  return { token: D.token, mission: step ? (theme() === 'vice' ? step.mission : step.name) : null, current: cur,
    count: step ? n[cur] : null, stars: wl.stars, sections: FLOW.map((s) => [s.id, s.name]) };
} catch (e) { return null; } })()`;

function fallbackSnapshot(all) {
  const done = all.state?.done || {};
  const day = dayKey();
  const stateOf = (id) => (done[`flow:${day}:${id}`] ? 'done' : done[`skip:${day}:${id}`] ? 'skipped' : 'todo');
  const ids = Object.keys(CORE);
  const cur = ids.find((id) => stateOf(id) === 'todo') || ids.find((id) => stateOf(id) === 'skipped') || null;
  const g = all.live?.github?.data, j = all.live?.jira?.data, ai = all.ai || {}, today = new Date().toDateString();
  const n = {
    github: g ? g.repoPRs.length + g.reviewRequests.length : null,
    jira: j ? j.prdQa.length + j.bugs.filter((b) => b.nudge).length : null,
    slack: (ai.slack?.items || []).filter((i) => !done[`sl:${i.url}`]).length,
    work: (ai.work?.testIdeas || []).filter((t) => !done[`ti:${t.title}`]).length + (ai.work?.breakdowns || []).length + (all.tasks || []).filter((t) => !t.doneAt).length,
    meet: (ai.meetings?.meetings || []).filter((x) => new Date(x.start).toDateString() === today).length,
  };
  return { token: all.token, mission: cur ? CORE[cur] : null, current: cur, count: cur ? n[cur] : null, stars: null, sections: Object.entries(CORE) };
}

async function refresh() {
  try {
    const pings = await (await fetch(`${base}/api/pings`)).json();
    const w = getWin();
    let page = w && !w.isDestroyed() ? await w.webContents.executeJavaScript(PAGE_SNAPSHOT).catch(() => null) : null;
    if (!page) page = fallbackSnapshot(await (await fetch(`${base}/api/all`)).json());
    if (page.token) token = page.token;
    snap = { ...page, unseen: (pings.items || []).filter((p) => !p.seen), running: (pings.commands || []).filter((c) => c.running).length };
  } catch (e) {
    snap = { ...snap, error: e.message };
  }
  paint();
  morningScan('tick').catch((e) => console.error(`morning scan: ${e.message}`));
}

/* ---------- Tray ---------- */
function trayIcon() {
  if (MAC) {
    const img = nativeImage.createFromPath(path.join(ROOT, 'build', 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  // Windows and Linux do not tint template images: use the colour app icon, scaled down.
  return nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 16, height: 16 });
}

const clip = (s, n = 60) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));
function paint() {
  if (!tray || tray.isDestroyed()) return;
  const waiting = snap.unseen.length + (Number(snap.count) || 0);
  const title = [waiting || null, snap.stars ? '★'.repeat(snap.stars) : null].filter(Boolean).join(' ');
  if (MAC) tray.setTitle(title ? ` ${title}` : '', { fontType: 'monospacedDigit' });
  tray.setToolTip(`Work Center${snap.mission ? ` · ${snap.mission}: ${snap.count ?? '–'}` : ''}${snap.unseen.length ? ` · ${snap.unseen.length} new messages` : ''}`);
  const login = loginEnabled();
  const msgs = snap.unseen.slice(0, 5).map((p) => ({
    label: clip(`${p.who || 'Slack'}${p.channel ? ` · ${p.channel}` : ''}: ${p.summary}`),
    click: () => openApp('openPhone()'),
  }));
  tray.setContextMenu(menu = Menu.buildFromTemplate([
    { label: 'Open Work Center', click: () => openApp() },
    { type: 'separator' },
    { label: snap.mission ? `Now: ${snap.mission} · ${snap.count ?? '–'}` : 'All missions done', enabled: !!snap.current, click: () => openApp() },
    snap.running ? { label: `✦ ${snap.running} AI ${snap.running === 1 ? 'run' : 'runs'} working`, enabled: false } : null,
    { type: 'separator' },
    { label: snap.unseen.length ? `New messages (${snap.unseen.length})` : 'No new messages', enabled: false },
    ...msgs,
    snap.unseen.length > 5 ? { label: `${snap.unseen.length - 5} more…`, click: () => openApp('openPhone()') } : null,
    { type: 'separator' },
    { label: 'Quick ask…', accelerator: hotkey() || undefined, click: () => openCapture() },
    { label: 'Check Slack now', click: () => post('/api/pings/scan').then(() => setTimeout(refresh, 1000)).catch((e) => console.error(e.message)) },
    { label: 'Run morning AI scan', click: () => post('/api/refresh-ai').then(() => openApp('load(false)')).catch((e) => console.error(e.message)) },
    { type: 'separator' },
    { label: 'Launch at login', type: 'checkbox', checked: login, click: (item) => setLogin(item.checked) },
    snap.error ? { label: `Server: ${clip(snap.error, 40)}`, enabled: false } : null,
    { type: 'separator' },
    { label: 'Quit Work Center', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ].filter(Boolean)));
}

function openApp(js) {
  showWin();
  const w = getWin();
  if (js && w && !w.isDestroyed()) {
    const run = () => w.webContents.executeJavaScript(`try { ${js} } catch (e) {}`).catch(() => {});
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => setTimeout(run, 800)); else run();
  }
}

/* ---------- Quick capture (global hotkey) ---------- */
const hotkey = () => (config.hotkey === false || config.hotkey === '' ? null : config.hotkey || 'CommandOrControl+Shift+Space');

async function openCapture() {
  if (capture && !capture.isDestroyed()) { capture.show(); capture.focus(); return; }
  let t = token;
  try { t = await getToken(); } catch { /* the page fetches it itself */ }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const W = 600, H = 132;
  capture = new BrowserWindow({
    width: W, height: H,
    x: Math.round(display.workArea.x + (display.workArea.width - W) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.22),
    frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, transparent: true, hasShadow: true,
    title: 'Work Center · Quick ask',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  capture.setAlwaysOnTop(true, 'floating');
  if (MAC) capture.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const q = new URLSearchParams({ t: t || '', s: snap.current && snap.sections.some(([id]) => id === snap.current) ? snap.current : 'work', m: JSON.stringify(snap.sections) });
  capture.loadURL(`${base}/capture.html#${q}`);
  capture.once('ready-to-show', () => { capture.show(); capture.focus(); });
  capture.on('blur', () => { if (capture && !capture.isDestroyed() && !capture.webContents.isDevToolsOpened()) capture.close(); });
  capture.on('closed', () => {
    capture = null;
    // Let the main page pick up the new command right away so its live feed shows progress.
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.executeJavaScript('try { load(false) } catch (e) {}').catch(() => {});
    setTimeout(refresh, 1500);
  });
}

function registerHotkey() {
  const key = hotkey();
  if (!key) return;
  try {
    if (!globalShortcut.register(key, () => openCapture())) console.error(`Hotkey ${key} is taken by another app`);
  } catch (e) {
    console.error(`Hotkey ${key}: ${e.message}`);
  }
}

/* ---------- Launch at login ---------- */
// The tray checkbox wins over config.json once used; it is remembered in <dataDir>/os.json.
function loginWanted() {
  const saved = readOs().launchAtLogin;
  return typeof saved === 'boolean' ? saved : config.launchAtLogin === true;
}
function loginEnabled() {
  return app.isPackaged ? app.getLoginItemSettings().openAtLogin : loginWanted();
}
function applyLogin(on) {
  // Only the packaged app registers itself: run from source it would register the bare Electron binary.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: on ? ['--hidden'] : [] });
}
function setLogin(on) {
  writeOs({ launchAtLogin: on });
  applyLogin(on);
  paint();
}
function launchedAtLogin() {
  if (process.argv.includes('--hidden')) return true;
  try { return !!(MAC && app.getLoginItemSettings().wasOpenedAtLogin); } catch { return false; }
}

/* ---------- Morning AI scan: once a weekday, after 06:00, if the AI parts are not from today ---------- */
let scanning = false;
async function morningScan(why) {
  if (config.morningScan === false || scanning || !base) return;
  const now = new Date();
  if (now.getDay() === 0 || now.getDay() === 6 || now.getHours() < 6) return;
  const today = dayKey(now);
  if (readOs().morningScanDate === today) return;
  const partsDir = path.join(DATA, 'parts');
  const stamps = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(partsDir, f), 'utf8')).generatedAt || null; } catch { return null; }
  }) : [];
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  // Fresh when every part was written today (the AI commands rewrite single parts during the day).
  const fresh = stamps.length > 0 && stamps.every((s) => s && new Date(s) >= start);
  if (fresh) return;
  scanning = true;
  try {
    writeOs({ morningScanDate: today }); // record first: never double-run, even if this copy quits mid-scan
    await post('/api/refresh-ai');
    console.log(`Morning AI scan started (${why})`);
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.executeJavaScript('try { load(false) } catch (e) {}').catch(() => {});
  } finally {
    scanning = false;
  }
}

/* ---------- Setup ---------- */
function setup({ url, win, show }) {
  base = url;
  getWin = win;
  showWin = show;
  tray = new Tray(trayIcon());
  tray.setIgnoreDoubleClickEvents(true);
  if (!MAC) tray.on('click', () => openApp()); // Windows/Linux: left click opens, right click shows the menu
  paint();
  registerHotkey();
  if (config.launchAtLogin !== undefined || typeof readOs().launchAtLogin === 'boolean') applyLogin(loginWanted());
  setTimeout(refresh, 4000); // give the page a moment to load its data first
  setInterval(refresh, 30_000).unref?.();
  powerMonitor.on('resume', () => setTimeout(() => morningScan('wake').catch((e) => console.error(e.message)), 15_000));
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

// What the menu bar shows right now (for debugging and tests).
const status = () => ({ title: tray && MAC ? tray.getTitle() : null, menu: menu ? menu.items.map((i) => (i.type === 'separator' ? '—' : `${i.label}${i.type === 'checkbox' ? ` [${i.checked ? 'x' : ' '}]` : ''}`)) : [], hotkey: hotkey() && globalShortcut.isRegistered(hotkey()), snap: { ...snap, token: undefined } });

module.exports = { setup, openCapture, launchedAtLogin, refresh, status, morningScan };

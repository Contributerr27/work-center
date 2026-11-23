// Electron shell: starts the local server and shows it in a native window (macOS, Windows, Linux),
// plus the menu-bar icon, quick-capture hotkey, launch at login and morning scan (src/tray.js).
const { app, BrowserWindow, WebContentsView, session, systemPreferences, shell, nativeTheme, screen, nativeImage, dialog } = require('electron');
const EXTERNAL = /^(https?:|slack:|mailto:)/i; // links the app may hand to the system
const path = require('node:path');
const { start, onUi } = require('./src/server');
const osx = require('./src/tray');

const ICON = path.join(__dirname, 'build', 'icon.png');
app.setName('Work Center');
// Keep the window state, theme and other local storage from when the app was called Daily HQ.
{
  const old = path.join(app.getPath('appData'), 'Daily HQ');
  if (require('node:fs').existsSync(old)) app.setPath('userData', old);
}

// One copy at a time, so the hotkey and the menu-bar icon are not duplicated. A second launch shows
// the running copy. DAILYHQ_MULTI=1 skips the lock (for testing next to the installed app).
if (!process.env.DAILYHQ_MULTI && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win;
  let url;
  let quitting = false;

  function createWindow({ show = true } = {}) {
    win = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 900,
      minHeight: 600,
      show,
      title: 'Work Center',
      icon: ICON, // window and taskbar icon on Windows and Linux
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      // The red/yellow/green buttons sit inside the floating sidebar's top corner (nav.css leaves room).
      ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 22, y: 24 } } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f6f5f2',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // Links (GitHub, Jira, Slack, Notion) open in the real browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (EXTERNAL.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, target) => {
      if (!target.startsWith(`${url}/`) && target !== url) {
        e.preventDefault();
        if (EXTERNAL.test(target)) shell.openExternal(target); // web, Slack and mail links only; never file: or other schemes
      }
    });
    // macOS: closing the window keeps Work Center running in the menu bar (Cmd+Q or "Quit" really quits).
    win.on('close', (e) => {
      if (process.platform === 'darwin' && !quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => (win = null));
    // Side panels ride along with the window.
    for (const ev of ['move', 'resize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, placePanels);
    win.on('hide', () => Object.values(panels).forEach((p) => !p.isDestroyed() && p.hide()));
    win.on('minimize', () => Object.values(panels).forEach((p) => !p.isDestroyed() && p.hide()));
    win.loadURL(url);
  }

  /* ---------- Side panels: AI chat on the right edge, Messages and Music on the left, attached to the window ---------- */
  const PANEL = { ai: { side: 'right', width: 460 }, phone: { side: 'left', width: 380 }, music: { side: 'left', width: 360 }, amem: { side: 'right', width: 400 }, meet: { side: 'right', width: 640 } };
  const panels = {};
  const safeOpen = (w) => {
    w.webContents.setWindowOpenHandler(({ url: target }) => { if (EXTERNAL.test(target)) shell.openExternal(target); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(`${url}/`) && target !== url) { e.preventDefault(); if (EXTERNAL.test(target)) shell.openExternal(target); } });
  };
  function placePanel(name) {
    const p = panels[name];
    if (!p || p.isDestroyed() || !win) return;
    const b = win.getBounds(), cfg = PANEL[name], gap = 8;
    const wa = screen.getDisplayMatching(b).workArea;
    let x = cfg.side === 'right' ? b.x + b.width + gap : b.x - cfg.width - gap;
    // No room beside the window: sit just inside its edge instead.
    if (x + cfg.width > wa.x + wa.width) x = b.x + b.width - cfg.width - 12;
    if (x < wa.x) x = b.x + 12;
    const inset = win.isFullScreen() ? 0 : 14;
    p.setBounds({ x: Math.round(x), y: b.y + inset, width: cfg.width, height: Math.max(420, b.height - inset * 2) });
  }
  function placePanels() { for (const n of Object.keys(panels)) if (panels[n].isVisible()) placePanel(n); }
  function panel(name, { open, toggle, quote, side } = {}) {
    if (!win || win.isDestroyed() || !url) return false;
    // The amem panel can sit on either side; the page remembers the choice and passes it along.
    if (name === 'amem' && (side === 'left' || side === 'right')) PANEL.amem.side = side;
    let p = panels[name];
    const visible = p && !p.isDestroyed() && p.isVisible();
    const want = toggle ? !visible : open !== false;
    if (!want) { if (visible) p.hide(); return true; }
    if (!p || p.isDestroyed()) {
      p = panels[name] = new BrowserWindow({
        parent: win, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: true,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
        width: PANEL[name].width, height: 700, roundedCorners: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      safeOpen(p);
      p.on('closed', () => delete panels[name]);
      p.loadURL(`${url}?panel=${name}`);
    }
    // One panel per side: opening Music tucks Messages away, and the other way round.
    for (const [n, o] of Object.entries(panels)) if (n !== name && PANEL[n].side === PANEL[name].side && !o.isDestroyed() && o.isVisible()) o.hide();
    placePanel(name);
    p.show();
    p.focus();
    if (quote) {
      const run = () => p.webContents.executeJavaScript(`window.askAIBubble && window.askAIBubble(${JSON.stringify(quote)})`).catch(() => {});
      if (p.webContents.isLoading()) p.webContents.once('did-finish-load', () => setTimeout(run, 600)); else run();
    }
    return true;
  }
  /* ---------- Meeting panel: a video call beside the window (src/features/meetings.js) ----------
     A header page from Work Center (title, Open in browser, Leave) with the call below it in its own view.
     The call keeps its own saved session (persist:meetings), so a Google or Zoom sign-in is done once.
     It may use the camera, microphone and screen sharing; only call sites are allowed. */
  const CALL_SITE = /^https:\/\/([a-z0-9-]+\.)*(meet\.google\.com|google\.com|gstatic\.com|googleusercontent\.com|zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|microsoft\.com|microsoftonline\.com|live\.com|webex\.com|whereby\.com|around\.co)(\/|$)/i;
  let meetView = null, meetSession = null;
  function meetSess() {
    if (meetSession) return meetSession;
    meetSession = session.fromPartition('persist:meetings');
    // Google refuses sign-in in apps that announce themselves as Electron: look like plain Chrome.
    meetSession.setUserAgent(meetSession.getUserAgent().replace(/\s(Electron|Work ?Center)\/[^\s]+/gi, ''));
    const okPerm = ['media', 'display-capture', 'fullscreen', 'notifications', 'clipboard-sanitized-write', 'speaker-selection'];
    meetSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(okPerm.includes(perm) && CALL_SITE.test(details.requestingUrl || wc.getURL())));
    meetSession.setPermissionCheckHandler((wc, perm, origin) => okPerm.includes(perm) && CALL_SITE.test(`${origin}/`));
    meetSession.setDisplayMediaRequestHandler((req, cb) => {
      require('electron').desktopCapturer.getSources({ types: ['screen', 'window'] }).then((s) => cb({ video: s[0] })).catch(() => cb({}));
    }, { useSystemPicker: true });
    return meetSession;
  }
  function layoutMeet() {
    const p = panels.meet;
    if (!p || p.isDestroyed() || !meetView) return;
    const [w, h] = p.getContentSize();
    meetView.setBounds({ x: 8, y: 52, width: w - 16, height: h - 60 });
  }
  function meet({ url: callUrl, title, close } = {}) {
    if (!win || win.isDestroyed() || !url) return false;
    let p = panels.meet;
    if (close) { if (p && !p.isDestroyed()) p.destroy(); return true; } // leaving ends the call
    if (!callUrl || !CALL_SITE.test(callUrl)) return false;
    if (process.platform === 'darwin') for (const m of ['camera', 'microphone']) systemPreferences.askForMediaAccess(m).catch(() => {});
    if (!p || p.isDestroyed()) {
      p = panels.meet = new BrowserWindow({
        parent: win, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: true,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
        width: PANEL.meet.width, height: 700, roundedCorners: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      safeOpen(p);
      p.on('closed', () => { delete panels.meet; meetView = null; });
      p.on('resize', layoutMeet);
    }
    p.loadURL(`${url}?panel=meet&title=${encodeURIComponent(title || 'Meeting')}&call=${encodeURIComponent(callUrl)}`);
    if (meetView) { p.contentView.removeChildView(meetView); meetView.webContents.close(); }
    meetView = new WebContentsView({ webPreferences: { session: meetSess(), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    meetView.setBorderRadius?.(18);
    p.contentView.addChildView(meetView);
    // Sign-in pages and the call stay in the view; other links go to the browser.
    meetView.webContents.setWindowOpenHandler(({ url: t }) => { if (CALL_SITE.test(t)) meetView.webContents.loadURL(t); else if (EXTERNAL.test(t)) shell.openExternal(t); return { action: 'deny' }; });
    meetView.webContents.loadURL(callUrl);
    for (const [n, o] of Object.entries(panels)) if (n !== 'meet' && PANEL[n].side === PANEL.meet.side && !o.isDestroyed() && o.isVisible()) o.hide();
    placePanel('meet');
    layoutMeet();
    p.show();
    showWindow();
    return true;
  }

  // Something a panel asks the main window to do (e.g. Reply from Messages → the Slack bar).
  function inMain({ do: what, args }) {
    if (!win || win.isDestroyed()) return false;
    showWindow();
    const fn = { askAbout: 'askAbout', openProjectFor: 'window.openProjectFor', createTask: 'createTask', openAICenter: 'window.openAICenter' }[what];
    win.webContents.executeJavaScript(`${fn}(...${JSON.stringify(args || [])})`).catch(() => {});
    return true;
  }
  // Dock icon follows the theme (build/icons/<theme>.png).
  // A theme pack can bring its own icon.png ({ id, icon } from the server).
  function themeIcon(t) {
    const id = typeof t === 'string' ? t : t?.id;
    const fsx = require('node:fs');
    const f = [t?.icon, path.join(__dirname, 'build', 'icons', `${id}.png`), path.join(__dirname, 'build', 'icons', 'normal.png')].find((x) => x && fsx.existsSync(x));
    if (!f) return;
    const img = nativeImage.createFromPath(f);
    if (app.dock && !img.isEmpty()) app.dock.setIcon(img);
    if (win && !win.isDestroyed() && process.platform !== 'darwin') win.setIcon(img);
  }

  // Install a theme: pick a theme folder or a .zip.
  async function pickTheme() {
    const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      title: 'Install a Work Center theme', buttonLabel: 'Install', message: 'Pick a theme folder (with theme.json) or a .zip',
      properties: ['openFile', 'openDirectory'], filters: [{ name: 'Theme', extensions: ['zip', 'json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const f = r.filePaths[0];
    return f.endsWith('theme.json') ? path.dirname(f) : f;
  }

  function showWindow() {
    if (!win || win.isDestroyed()) createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (app.dock) app.dock.show();
  }

  app.on('second-instance', () => url && showWindow());

  app.whenReady().then(async () => {
    if (app.dock) app.dock.setIcon(ICON); // macOS dock icon when run with `npm start`
    url = await start();
    onUi((kind, data) => (kind === 'panel' ? (data.name === 'meet' && data.open === false ? meet({ close: true }) : panel(data.name, data)) : kind === 'meet' ? meet(data) : kind === 'main' ? inMain(data) : kind === 'theme' ? (themeIcon(data), true)
      : kind === 'pickTheme' ? pickTheme() : false));
    const hidden = osx.launchedAtLogin(); // started at login: stay in the menu bar
    if (hidden && app.dock) app.dock.hide();
    createWindow({ show: !hidden });
    osx.setup({ url, win: () => win, show: showWindow });
  });
  app.on('activate', () => url && showWindow()); // Dock icon click
  app.on('before-quit', () => {
    quitting = true;
    require('./src/server').stopTerminal();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

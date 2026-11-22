// Electron shell: starts the local server and shows it in a native window (macOS, Windows, Linux),
// plus the menu-bar icon, quick-capture hotkey, launch at login and morning scan (src/tray.js).
const { app, BrowserWindow, shell, nativeTheme, screen, nativeImage } = require('electron');
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
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f6f5f2',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // Links (GitHub, Jira, Slack, Notion) open in the real browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:|^slack:/.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, target) => {
      if (!target.startsWith(url)) {
        e.preventDefault();
        shell.openExternal(target);
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

  /* ---------- Side panels: AI chat on the right edge, Messages on the left, attached to the window ---------- */
  const PANEL = { ai: { side: 'right', width: 460 }, phone: { side: 'left', width: 380 } };
  const panels = {};
  const safeOpen = (w) => {
    w.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:|^slack:/.test(target)) shell.openExternal(target); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(url)) { e.preventDefault(); shell.openExternal(target); } });
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
  function panel(name, { open, toggle, quote } = {}) {
    if (!win || win.isDestroyed() || !url) return false;
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
    placePanel(name);
    p.show();
    p.focus();
    if (quote) {
      const run = () => p.webContents.executeJavaScript(`window.askAIBubble && window.askAIBubble(${JSON.stringify(quote)})`).catch(() => {});
      if (p.webContents.isLoading()) p.webContents.once('did-finish-load', () => setTimeout(run, 600)); else run();
    }
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
  function themeIcon(theme) {
    const f = path.join(__dirname, 'build', 'icons', `${theme}.png`);
    if (!require('node:fs').existsSync(f)) return;
    const img = nativeImage.createFromPath(f);
    if (app.dock && !img.isEmpty()) app.dock.setIcon(img);
    if (win && !win.isDestroyed() && process.platform !== 'darwin') win.setIcon(img);
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
    onUi((kind, data) => (kind === 'panel' ? panel(data.name, data) : kind === 'main' ? inMain(data) : kind === 'theme' ? (themeIcon(data), true) : false));
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

// Electron shell: starts the local server and shows it in a native window (macOS, Windows, Linux),
// plus the menu-bar icon, quick-capture hotkey, launch at login and morning scan (src/tray.js).
const { app, BrowserWindow, shell, nativeTheme } = require('electron');
const path = require('node:path');
const { start } = require('./src/server');
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
    win.loadURL(url);
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

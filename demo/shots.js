// README screenshots from demo mode: `npm run screenshots` (seeds the demo, starts it, then runs this with
// Electron). Writes docs/screenshots/*.png at 2x. Only demo data is ever on screen.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4790';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { file: 'day-normal.png', theme: 'normal', js: "window.scrollTo(0,0)" },
  { file: 'day-winter.png', theme: 'winter', js: "showAll || $('btn-all').click(); window.scrollTo(0,0)" },
  { file: 'day-vice.png', theme: 'vice', js: "window.scrollTo(0,0)" },
  { file: 'work-next-steps.png', theme: 'normal', js: "showAll || $('btn-all').click(); const s = $(FLOW.find((x) => x.id === 'work').sec); window.scrollTo({ top: scrollY + s.getBoundingClientRect().top - 16, behavior: 'instant' })" },
  { file: 'projects.png', theme: 'normal', js: "window.openProjectFor('PAY-231')", settle: 2500 },
  { file: 'ai-center.png', theme: 'normal', js: "window.openAICenter()", settle: 2500 },
  { file: 'growth-hr.png', theme: 'winter', js: "window.openHR()", settle: 2000 },
  { file: 'home.png', theme: 'vice', js: "window.openHome()", settle: 2000 },
  { file: 'aurora.png', theme: 'aurora', js: "window.scrollTo(0,0)" },
];

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: false, zoomFactor: 1 }, paintWhenInitiallyHidden: true });
  for (const s of SHOTS) {
    await win.loadURL(URL);
    await win.webContents.executeJavaScript(`localStorage.setItem('theme', ${JSON.stringify(s.theme)}); localStorage.removeItem('bannerClosed'); true`);
    await win.loadURL(URL);
    await wait(3500);
    // A hidden window doesn't run CSS animations: jump them to their end state so bars and charts show.
    await win.webContents.insertCSS('*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }');
    // Fire and forget: some view openers wait on data, which can outlast the capture.
    await win.webContents.executeJavaScript(`setTimeout(() => { try { ${s.js} } catch (e) { console.error(e) } }, 0); true`);
    await wait(s.settle || 1200);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, s.file), img.toPNG());
    console.log('wrote', s.file, img.getSize());
  }
  app.quit();
});

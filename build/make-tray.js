// Renders build/tray.svg to the menu-bar icons: build/trayTemplate.png (16px) and build/trayTemplate@2x.png (32px).
// The "Template" suffix makes macOS tint them for light and dark menu bars. Run: npx electron build/make-tray.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const svg = fs.readFileSync(path.join(__dirname, 'tray.svg'), 'utf8');
const page = `<body><script>
  const img = new Image();
  img.onload = () => { window.out = [16, 32].map((n) => { const c = document.createElement('canvas'); c.width = c.height = n;
    c.getContext('2d').drawImage(img, 0, 0, n, n); return c.toDataURL('image/png'); }); };
  img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
</script></body>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`);
  let out = null;
  for (let i = 0; i < 50 && !out; i++) { out = await win.webContents.executeJavaScript('window.out || null'); if (!out) await new Promise((r) => setTimeout(r, 50)); }
  const [one, two] = out.map((u) => Buffer.from(u.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(__dirname, 'trayTemplate.png'), one);
  fs.writeFileSync(path.join(__dirname, 'trayTemplate@2x.png'), two);
  console.log('wrote build/trayTemplate.png and build/trayTemplate@2x.png');
  app.quit();
});

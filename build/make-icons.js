// App icons, one per theme, 1024px on the macOS icon grid (824px rounded square, 100px margin).
// Writes build/icons/<theme>.png and the bundle icon (build/icon.png = Normal).
//   npx electron build/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// The shared mark: a smooth "W" for Work Center, with a small accent (sparkle, snowflake, neon star).
const W = 'M300 410 L392 650 L512 468 L632 650 L724 410';
const sparkle = (cx, cy, r, fill) => `<path d="M${cx} ${cy - r} C${cx + r * .12} ${cy - r * .12} ${cx + r * .12} ${cy - r * .12} ${cx + r} ${cy} C${cx + r * .12} ${cy + r * .12} ${cx + r * .12} ${cy + r * .12} ${cx} ${cy + r} C${cx - r * .12} ${cy + r * .12} ${cx - r * .12} ${cy + r * .12} ${cx - r} ${cy} C${cx - r * .12} ${cy - r * .12} ${cx - r * .12} ${cy - r * .12} ${cx} ${cy - r}Z" fill="${fill}"/>`;
const flake = (cx, cy, r, col) => {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3, x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
    s += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}"/>`;
    for (const k of [.55]) {
      const bx = cx + Math.cos(a) * r * k, by = cy + Math.sin(a) * r * k;
      for (const d of [-.6, .6]) s += `<line x1="${bx}" y1="${by}" x2="${bx + Math.cos(a + d) * r * .32}" y2="${by + Math.sin(a + d) * r * .32}"/>`;
    }
  }
  return `<g stroke="${col}" stroke-width="${r * .14}" stroke-linecap="round">${s}</g>`;
};
const frame = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>${defs}
  <clipPath id="sq"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".28"/></filter>
</defs>
<g filter="url(#drop)"><rect x="100" y="100" width="824" height="824" rx="186" fill="#000" opacity=".001"/></g>
<g clip-path="url(#sq)">${body}<rect x="100" y="100" width="824" height="420" fill="url(#gloss)"/></g>
<rect x="100.5" y="100.5" width="823" height="823" rx="186" fill="none" stroke="#fff" stroke-opacity=".18"/>
</svg>`;

const ICONS = {
  normal: frame(`
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b7bf0"/><stop offset=".55" stop-color="#2556c9"/><stop offset="1" stop-color="#1a2f7a"/></linearGradient>
  <radialGradient id="glow" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#8fb8ff" stop-opacity=".55"/><stop offset="1" stop-color="#8fb8ff" stop-opacity="0"/></radialGradient>`,
  `<rect x="0" y="0" width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>
   <path d="${W}" fill="none" stroke="#0e1f52" stroke-opacity=".35" stroke-width="86" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 14)"/>
   <path d="${W}" fill="none" stroke="#fff" stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/>
   ${sparkle(760, 292, 74, '#ffffff')}${sparkle(838, 382, 30, '#cfe0ff')}`),

  winter: frame(`
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe6ff"/><stop offset=".45" stop-color="#6fa7e6"/><stop offset="1" stop-color="#173f78"/></linearGradient>
  <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dbe8f7"/></linearGradient>
  <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3eefb"/></linearGradient>`,
  `<rect width="1024" height="1024" fill="url(#bg)"/>
   <path d="M100 800 L250 660 L330 720 L470 590 L590 700 L700 610 L924 790 L924 924 L100 924Z" fill="#2c5f9c" opacity=".55"/>
   <path d="M100 860 L300 720 L420 800 L560 690 L700 790 L820 730 L924 800 L924 924 L100 924Z" fill="url(#snow)"/>
   <path d="M300 720 L340 748 L366 732 L420 800 L380 770 L350 780Z M560 690 L600 720 L630 708 L700 790 L650 752 L612 760Z" fill="#a9c3e2" opacity=".8"/>
   <path d="${W}" fill="none" stroke="#123a6e" stroke-opacity=".35" stroke-width="86" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 12) translate(0 -60)"/>
   <path d="${W}" fill="none" stroke="url(#mark)" stroke-width="84" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -60)"/>
   ${flake(770, 250, 66, '#ffffff')}
   <g fill="#fff" opacity=".85"><circle cx="210" cy="250" r="7"/><circle cx="300" cy="190" r="5"/><circle cx="640" cy="200" r="6"/><circle cx="860" cy="430" r="5"/><circle cx="180" cy="480" r="5"/><circle cx="470" cy="250" r="4"/></g>`),

  vice: frame(`
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140736"/><stop offset=".5" stop-color="#5b1874"/><stop offset=".78" stop-color="#d13a7d"/><stop offset="1" stop-color="#ff8a4c"/></linearGradient>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a6"/><stop offset=".5" stop-color="#ffb347"/><stop offset="1" stop-color="#ff3d7f"/></linearGradient>
  <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff3fa4"/><stop offset="1" stop-color="#4fe3ff"/></linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <mask id="stripes"><rect width="1024" height="1024" fill="#fff"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="0" y="${560 + i * 40}" width="1024" height="${6 + i * 4}" fill="#000"/>`).join('')}</mask>`,
  `<rect width="1024" height="1024" fill="url(#bg)"/>
   <circle cx="512" cy="600" r="250" fill="url(#sun)" mask="url(#stripes)" opacity=".92"/>
   <rect x="100" y="790" width="824" height="140" fill="#12052b"/>
   <path d="M100 790 H924" stroke="#4fe3ff" stroke-width="6" opacity=".9"/>
   <path d="${W}" fill="none" stroke="url(#neon)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)" transform="translate(0 -40)"/>
   <path d="${W}" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity=".85" transform="translate(0 -40)"/>
   ${sparkle(770, 250, 60, '#4fe3ff')}`),
};

app.dock && app.dock.hide();
app.whenReady().then(async () => {
  const out = path.join(__dirname, 'icons');
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  for (const [name, svg] of Object.entries(ICONS)) {
    fs.writeFileSync(path.join(out, `${name}.svg`), svg);
    await w.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent"><canvas id="c" width="1024" height="1024"></canvas><script>
      const img = new Image(); img.onload = () => { document.getElementById('c').getContext('2d').drawImage(img, 0, 0); document.title = 'done'; };
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';</script></body>`)}`);
    for (let i = 0; i < 80 && w.getTitle() !== 'done'; i++) await new Promise((r) => setTimeout(r, 100));
    const data = await w.webContents.executeJavaScript("document.getElementById('c').toDataURL('image/png')");
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', name);
  }
  fs.copyFileSync(path.join(out, 'normal.png'), path.join(__dirname, 'icon.png'));
  fs.copyFileSync(path.join(out, 'normal.svg'), path.join(__dirname, 'icon.svg'));
  app.quit();
});

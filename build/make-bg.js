// Paints the default Vice-look backdrop (an original dusk-coast scene) to public/bg.jpg.
// Run: npx electron build/make-bg.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const W = 2560, H = 1440;
const page = `<body style="margin:0;background:#000"><canvas id="c" width="${W}" height="${H}"></canvas><script>(${paint.toString()})(${W},${H})</script></body>`;

function paint(W, H) {
  const c = document.getElementById('c'), x = c.getContext('2d');
  let seed = 20261120;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const HZ = H * 0.62; // horizon

  // value noise
  const G = 256, grid = new Float32Array(G * G).map(() => rnd());
  const sm = (t) => t * t * (3 - 2 * t);
  const vn = (u, v) => { const xi = Math.floor(u), yi = Math.floor(v), xf = sm(u - xi), yf = sm(v - yi);
    const g = (a, b) => grid[((b % G + G) % G) * G + ((a % G + G) % G)];
    return (g(xi, yi) * (1 - xf) + g(xi + 1, yi) * xf) * (1 - yf) + (g(xi, yi + 1) * (1 - xf) + g(xi + 1, yi + 1) * xf) * yf; };
  const fbm = (u, v) => { let a = 0, amp = .5, f = 1; for (let i = 0; i < 6; i++) { a += amp * vn(u * f, v * f); amp *= .5; f *= 2.03; } return a; };

  // sky
  let g = x.createLinearGradient(0, 0, 0, HZ);
  [[0, '#0b0624'], [.28, '#2a1158'], [.52, '#6b1f7c'], [.72, '#c93a7e'], [.88, '#ff7a4a'], [1, '#ffc46b']].forEach(([s, col]) => g.addColorStop(s, col));
  x.fillStyle = g; x.fillRect(0, 0, W, HZ);
  // stars
  for (let i = 0; i < 420; i++) { const sy = rnd() * HZ * .45; x.fillStyle = 'rgba(255,255,255,' + (.15 + rnd() * .5) * (1 - sy / (HZ * .45)) + ')'; x.fillRect(rnd() * W, sy, 1.6, 1.6); }
  // sun bloom
  const SX = W * .58, SY = HZ - 26;
  g = x.createRadialGradient(SX, SY, 0, SX, SY, H * .75);
  [[0, 'rgba(255,244,200,1)'], [.05, 'rgba(255,214,130,.95)'], [.16, 'rgba(255,140,90,.55)'], [.4, 'rgba(255,70,140,.22)'], [1, 'rgba(255,70,140,0)']].forEach(([s, col]) => g.addColorStop(s, col));
  x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, HZ); x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#fff6d8'; x.beginPath(); x.arc(SX, SY, 58, 0, 7); x.fill();

  // clouds, lit from below
  const img = x.getImageData(0, 0, W, Math.ceil(HZ)), d = img.data;
  for (let py = 0; py < img.height; py++) {
    const t = py / HZ;
    for (let px = 0; px < W; px++) {
      const n = fbm(px / 520 + 3, py / 150 + 9) * .75 + fbm(px / 140, py / 46) * .25;
      let a = (n - (.50 + .10 * Math.abs(t - .45))) * 4.2; if (a <= 0) continue; a = Math.min(1, a) * (.25 + .7 * Math.sin(Math.PI * Math.min(1, t * 1.08)));
      const lit = Math.pow(Math.min(1, Math.max(0, fbm(px / 520 + 3, (py + 34) / 150 + 9) - n + .5)), 2.2);
      const warm = Math.max(0, 1 - Math.hypot((px - SX) / W, (py - SY) / HZ) * 1.7);
      const r = 70 + 185 * lit * (.45 + warm), gg = 40 + 120 * lit * warm + 30 * lit, b = 95 + 70 * lit * (1 - warm);
      const i = (py * W + px) * 4;
      d[i] += (r - d[i]) * a; d[i + 1] += (gg - d[i + 1]) * a; d[i + 2] += (b - d[i + 2]) * a;
    }
  }
  x.putImageData(img, 0, 0);

  // skyline layers
  const lights = [];
  function skyline(base, minH, maxH, col, haze, lit) {
    let px = -40;
    while (px < W + 40) {
      const bw = 34 + rnd() * 95, tall = rnd() < .16, bh = (tall ? maxH * (.75 + rnd() * .5) : minH + rnd() * (maxH - minH) * .55);
      const top = base - bh;
      x.fillStyle = col; x.fillRect(px, top, bw, bh + 4);
      if (tall && rnd() < .7) { x.fillRect(px + bw * .3, top - 16 - rnd() * 30, bw * .4, 50); x.fillRect(px + bw / 2 - 1.5, top - 70 - rnd() * 40, 3, 80); lights.push([px + bw / 2, top - 74, '#ff5a6e', 3]); }
      if (lit) for (let wy = top + 8; wy < base - 6; wy += 9) for (let wx = px + 5; wx < px + bw - 5; wx += 8) {
        if (rnd() < .34) { const col2 = rnd() < .72 ? 'rgba(255,214,150,' : rnd() < .5 ? 'rgba(120,225,255,' : 'rgba(255,120,200,'; const al = .35 + rnd() * .65;
          x.fillStyle = col2 + al + ')'; x.fillRect(wx, wy, 4, 5); if (rnd() < .05) lights.push([wx, wy, col2 + '1)', 2]); }
      }
      px += bw + (rnd() < .2 ? 10 + rnd() * 40 : 1);
    }
    if (haze) { const hg = x.createLinearGradient(0, base - maxH, 0, base); hg.addColorStop(0, 'rgba(255,120,120,0)'); hg.addColorStop(1, haze); x.fillStyle = hg; x.fillRect(0, base - maxH * 1.3, W, maxH * 1.3); }
  }
  skyline(HZ, 30, 150, '#5b2a6e', 'rgba(255,140,110,.42)', false);
  skyline(HZ, 50, 300, '#2c1447', 'rgba(255,110,120,.20)', true);
  skyline(HZ, 30, 170, '#170a2c', null, true);
  // glow on beacons
  x.globalCompositeOperation = 'screen';
  for (const [lx, ly, col, r] of lights) { const lg = x.createRadialGradient(lx, ly, 0, lx, ly, r * 9); lg.addColorStop(0, col); lg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = lg; x.fillRect(lx - 30, ly - 30, 60, 60); }
  x.globalCompositeOperation = 'source-over';

  // water: mirror the scene, darken, ripple
  const src = x.getImageData(0, 0, W, Math.ceil(HZ));
  const out = x.createImageData(W, H - Math.ceil(HZ));
  for (let py = 0; py < out.height; py++) {
    const depth = py / out.height, sy = Math.max(0, Math.floor(HZ - 2 - py * 1.55 - 0));
    const amp = 2 + depth * 26;
    for (let px = 0; px < W; px++) {
      const off = Math.round((fbm(px / (90 + depth * 260), py / (5 + depth * 9) + 40) - .5) * amp * 2);
      const sx = Math.min(W - 1, Math.max(0, px + off)), syy = Math.min(src.height - 1, Math.max(0, sy + Math.round(off * .4)));
      const i = (py * W + px) * 4, j = (syy * W + sx) * 4, k = .78 - depth * .42;
      out.data[i] = src.data[j] * k + 10; out.data[i + 1] = src.data[j + 1] * k * .92 + 4; out.data[i + 2] = src.data[j + 2] * k + 26; out.data[i + 3] = 255;
    }
  }
  x.putImageData(out, 0, Math.ceil(HZ));
  // sun path glitter
  x.globalCompositeOperation = 'screen';
  for (let i = 0; i < 2600; i++) { const dp = Math.pow(rnd(), 1.4), yy = HZ + 3 + dp * (H - HZ), spread = 40 + dp * 420, xx = SX + (rnd() + rnd() + rnd() - 1.5) * spread;
    x.fillStyle = 'rgba(255,' + (190 + rnd() * 50 | 0) + ',' + (120 + rnd() * 60 | 0) + ',' + (.10 + rnd() * .45) * (1 - dp * .5) + ')'; x.fillRect(xx, yy, 8 + dp * 60 * rnd(), 1.5 + dp * 3); }
  x.globalCompositeOperation = 'source-over';
  // shoreline haze
  g = x.createLinearGradient(0, HZ - 40, 0, HZ + 50); g.addColorStop(0, 'rgba(255,170,130,0)'); g.addColorStop(.5, 'rgba(255,170,130,.30)'); g.addColorStop(1, 'rgba(255,170,130,0)'); x.fillStyle = g; x.fillRect(0, HZ - 40, W, 90);

  // palms in the foreground
  function palm(bx, by, hgt, lean, scale) {
    x.strokeStyle = '#07030f'; x.fillStyle = '#07030f'; x.lineCap = 'round';
    const tx = bx + lean, ty = by - hgt;
    for (let i = 0; i <= 400; i++) { const t = i / 400, px = bx + lean * t * t, py = by - hgt * t; x.beginPath(); x.arc(px, py, (15 - 8 * t) * scale, 0, 7); x.fill(); }
    for (let f = 0; f < 13; f++) {
      const ang = -Math.PI * (.02 + f / 12 * .96) + (rnd() - .5) * .25, len = (300 + rnd() * 150) * scale, droop = (.5 + rnd() * .6);
      let px = tx, py = ty; const pts = [];
      for (let s = 0; s <= 26; s++) { const t = s / 26; px = tx + Math.cos(ang) * len * t; py = ty + Math.sin(ang) * len * t * (1 - t * .35) + droop * len * t * t * .75; pts.push([px, py]); }
      x.lineWidth = 5 * scale; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke();
      x.lineWidth = 2.4 * scale;
      for (let s = 2; s < pts.length; s++) { const [a, b] = pts[s], [pa, pb] = pts[s - 1], dir = Math.atan2(b - pb, a - pa), ll = (70 - Math.abs(s - 11) * 3.4) * scale * (.8 + rnd() * .4);
        for (const side of [-1, 1]) for (let k = 0; k < 2; k++) { const la = dir + side * (1.05 + rnd() * .35) + .35; x.beginPath(); x.moveTo(a - k * 5, b); x.quadraticCurveTo(a + Math.cos(la) * ll * .6, b + Math.sin(la) * ll * .6, a + Math.cos(la) * ll + 6, b + Math.sin(la) * ll + ll * .35); x.stroke(); } }
    }
  }
  palm(150, H + 40, 900, 120, 1.25); palm(430, H + 60, 640, -70, .9); palm(W - 210, H + 40, 980, -150, 1.3); palm(W - 520, H + 80, 600, 60, .8);

  // vignette and grain
  g = x.createRadialGradient(W / 2, H * .5, H * .35, W / 2, H * .5, W * .72); g.addColorStop(0, 'rgba(10,3,25,0)'); g.addColorStop(1, 'rgba(10,3,25,.62)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const fin = x.getImageData(0, 0, W, H), fd = fin.data;
  for (let i = 0; i < fd.length; i += 4) { const n = (rnd() - .5) * 13; fd[i] += n; fd[i + 1] += n; fd[i + 2] += n; }
  x.putImageData(fin, 0, 0);
  document.title = 'done';
}

app.dock && app.dock.hide();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: true } });
  w.webContents.setZoomFactor(1);
  await w.loadURL('data:text/html,' + encodeURIComponent(page));
  for (let i = 0; i < 240 && w.getTitle() !== 'done'; i++) await new Promise((r) => setTimeout(r, 250));
  const url = await w.webContents.executeJavaScript("document.getElementById('c').toDataURL('image/jpeg', .86)");
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'bg.jpg'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('title', w.getTitle());
  app.quit();
});

// Paints the theme backdrops (original scenes, 4K) to public/themes/<name>.jpg.
//   npx electron build/make-art.js winter     alpine winter morning: peaks, pine forests, snowfield
//   npx electron build/make-art.js vice       neon coast at dusk: striped sun, skyline, palms, water
// Every size is relative to the image height, so any resolution renders the same scene.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const W = 3840, H = 2160;
const which = process.argv.find((a) => ['winter', 'vice'].includes(a)) || 'winter';

/* ---------- shared helpers (run inside the page) ---------- */
function helpers(seed0) {
  let seed = seed0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const G = 256, grid = new Float32Array(G * G).map(() => rnd());
  const sm = (t) => t * t * (3 - 2 * t);
  const vn = (u, v) => { const xi = Math.floor(u), yi = Math.floor(v), xf = sm(u - xi), yf = sm(v - yi);
    const g = (a, b) => grid[((b % G + G) % G) * G + ((a % G + G) % G)];
    return (g(xi, yi) * (1 - xf) + g(xi + 1, yi) * xf) * (1 - yf) + (g(xi, yi + 1) * (1 - xf) + g(xi + 1, yi + 1) * xf) * yf; };
  const fbm = (u, v, oct = 6) => { let a = 0, amp = .5, f = 1, n = 0; for (let i = 0; i < oct; i++) { a += amp * vn(u * f, v * f); n += amp; amp *= .5; f *= 2.03; } return a / n; };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  return { rnd, vn, fbm, clamp, mix, sstep };
}

/* ---------- Winter: a clear alpine morning ---------- */
function paintWinter(W, H, helpers) {
  const { rnd, fbm, clamp, mix, sstep } = helpers(20261224);
  const c = document.getElementById('c');
  let x = c.getContext('2d');
  const u = H / 1440, HZ = H * .58;

  // sky: deep morning blue to a warm pale horizon
  let g = x.createLinearGradient(0, 0, 0, H);
  [[0, '#4f84c6'], [.22, '#7fa9db'], [.42, '#b8d2ee'], [.56, '#e4edf6'], [.64, '#f7eee6'], [1, '#f7eee6']].forEach(([s, col]) => g.addColorStop(s, col));
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const SX = W * .74, SY = H * .36;
  g = x.createRadialGradient(SX, SY, 0, SX, SY, H * .95);
  [[0, 'rgba(255,252,242,1)'], [.03, 'rgba(255,246,226,.9)'], [.12, 'rgba(255,236,214,.38)'], [.4, 'rgba(255,226,210,.12)'], [1, 'rgba(255,226,210,0)']].forEach(([s, col]) => g.addColorStop(s, col));
  x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';

  // high wispy clouds
  let img = x.getImageData(0, 0, W, Math.ceil(HZ)), d = img.data;
  for (let py = 0; py < img.height; py++) {
    const t = py / HZ;
    for (let px = 0; px < W; px++) {
      const n = fbm(px / (1100 * u) + 7, py / (90 * u) + 3, 5) * .8 + fbm(px / (260 * u), py / (40 * u), 3) * .2;
      let a = sstep(.52, .78, n) * .55 * Math.sin(Math.PI * clamp(t * 1.3));
      if (a <= .002) continue;
      const warm = clamp(1 - Math.hypot((px - SX) / W, (py - SY) / H) * 2.4);
      const col = mix([246, 250, 255], [255, 240, 226], warm);
      const i = (py * W + px) * 4;
      d[i] += (col[0] - d[i]) * a; d[i + 1] += (col[1] - d[i + 1]) * a; d[i + 2] += (col[2] - d[i + 2]) * a;
    }
  }
  x.putImageData(img, 0, 0);

  // mountain ranges: ridgeline from ridged noise; faces lit from a ridged heightfield (sun upper right).
  // Steep faces show rock, gentle ones hold snow; haze grows toward the valley.
  const rf = (a, b, oct) => { let s = 0, amp = .5, f = 1, n = 0; for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(2 * fbm(a * f, b * f, 1) - 1); s += amp * v * v; n += amp; amp *= .5; f *= 2.1; } return s / n; };
  function range(o) {
    const ry = new Float32Array(W);
    for (let px = 0; px < W; px++) {
      const p = rf(px / o.scale + o.seed, o.seed * .37, 7);
      const broad = fbm(px / (o.scale * 2.6) + o.seed * 2, 1.7, 3);
      const env = Math.pow(sstep(.25, .85, broad), 1.2);
      ry[px] = o.base - o.amp * (.12 + .38 * p + .85 * env * (.55 + .45 * p));
    }
    const top = Math.floor(Math.min(...ry)), bot = Math.min(H, Math.ceil(o.base + o.amp * .35));
    const im = x.getImageData(0, top, W, bot - top), dd = im.data;
    const e = 1.5 * u, L = [.62, -.42, .66];
    const E = (px, py) => rf(px / (o.detail * u) + o.seed, (py - ry[Math.max(0, Math.min(W - 1, px | 0))]) / (o.detail * .55 * u) + o.seed * .5, 6) + (py - ry[Math.max(0, Math.min(W - 1, px | 0))]) / o.amp * -.6;
    for (let py = top; py < bot; py++) {
      for (let px = 0; px < W; px++) {
        const r = ry[px];
        if (py < r) continue;
        const depth = (py - r) / o.amp;
        const gx = (E(px + e, py) - E(px - e, py)) * o.relief, gy = (E(px, py + e) - E(px, py - e)) * o.relief;
        // broad face direction from the ridgeline
        const bs = (ry[Math.min(W - 1, px + (60 * u | 0))] - ry[Math.max(0, px - (60 * u | 0))]) / (120 * u);
        const nx = -gx + bs * .9, ny = -gy, nz = 1, nl = Math.hypot(nx, ny, nz);
        const lit = clamp(((nx * L[0] + ny * L[1] + nz * L[2]) / nl - .35) * 1.9);
        const steep = Math.hypot(gx, gy);
        const rock = sstep(o.rockAt, o.rockAt + .35, steep) * sstep(.02, .12, depth) * o.rock;
        let col = mix(o.shade, o.lit, lit);
        col = mix(col, mix(o.rockShade, o.rockLit, lit), rock);
        col = mix(col, o.haze, clamp(o.hazeBase + sstep(.1, 1.1, depth) * o.hazeDepth));
        const edge = clamp((py - r) / (1.2 * u));
        const i = ((py - top) * W + px) * 4;
        dd[i] += (col[0] - dd[i]) * edge; dd[i + 1] += (col[1] - dd[i + 1]) * edge; dd[i + 2] += (col[2] - dd[i + 2]) * edge;
      }
    }
    x.putImageData(im, 0, top);
  }
  range({ base: HZ - 10 * u, amp: 340 * u, scale: 640 * u, detail: 120, relief: 3.4, seed: 17, lit: [236, 242, 251], shade: [160, 180, 214], rockLit: [158, 170, 194], rockShade: [124, 140, 170], rockAt: .55, haze: [204, 219, 240], hazeBase: .5, hazeDepth: .45, rock: .55 });
  range({ base: HZ + 160 * u, amp: 460 * u, scale: 520 * u, detail: 90, relief: 4.4, seed: 29, lit: [253, 253, 255], shade: [132, 156, 198], rockLit: [118, 128, 148], rockShade: [66, 78, 102], rockAt: .5, haze: [222, 232, 245], hazeBase: .0, hazeDepth: .78, rock: 1 });

  const mist = (y0, y1, a) => { const mg = x.createLinearGradient(0, y0, 0, y1); mg.addColorStop(0, 'rgba(240,246,252,0)'); mg.addColorStop(.55, `rgba(240,246,252,${a})`); mg.addColorStop(1, 'rgba(240,246,252,0)'); x.fillStyle = mg; x.fillRect(0, y0, W, y1 - y0); };
  mist(HZ + 120 * u, HZ + 360 * u, .85);

  // spruce: many drooping branch tiers, snow resting on the sunlit (right) side of each tier
  function pine(cx, base, h, col, snowLit, snowShade, tiers) {
    const w = h * .3;
    x.fillStyle = col;
    x.fillRect(cx - h * .012, base - h * .1, h * .024, h * .11);
    const n = Math.max(6, Math.round(tiers * 1.6));
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = Math.min(1, (i + 1.7) / n);
      const ty = base - h + f0 * h * .93, by = base - h + f1 * h * .93;
      const tw = w * (.12 + .88 * Math.pow((i + 1) / n, .9)) * (.82 + rnd() * .36);
      const lean = (rnd() - .5) * tw * .15;
      const lx = cx - tw + lean, rx = cx + tw + lean, dl = h * (.018 + rnd() * .02), dr = h * (.018 + rnd() * .02);
      x.beginPath(); x.moveTo(cx, ty);
      x.quadraticCurveTo(cx - tw * .45, ty + (by - ty) * .55, lx, by + dl);
      const k = 6 + (tw / (h * .02) | 0) % 5;
      for (let j = 1; j < k; j++) { const fx2 = lx + (rx - lx) * j / k; x.lineTo(fx2, by - (j % 2 ? h * (.01 + rnd() * .02) : -h * .004)); }
      x.lineTo(rx, by + dr);
      x.quadraticCurveTo(cx + tw * .45, ty + (by - ty) * .55, cx, ty);
      x.fillStyle = col; x.fill();
      // snow: a thin crescent along the upper right edge, a little on the left
      const sh = (by - ty) * (.28 + rnd() * .12);
      x.beginPath(); x.moveTo(cx, ty - h * .003);
      x.quadraticCurveTo(cx + tw * .4, ty + (by - ty) * .5, rx - tw * .05, by + dr * .3);
      x.quadraticCurveTo(cx + tw * .35, ty + (by - ty) * .62 - sh * .2, cx + tw * .05, ty + sh);
      x.quadraticCurveTo(cx - tw * .3, ty + sh * 1.1, lx + tw * .35, by - (by - ty) * .25);
      x.quadraticCurveTo(cx - tw * .3, ty + (by - ty) * .35, cx, ty - h * .003);
      const sg = x.createLinearGradient(lx, 0, rx, 0); sg.addColorStop(0, snowShade); sg.addColorStop(.6, snowLit); sg.addColorStop(1, snowLit);
      x.fillStyle = sg; x.fill();
    }
  }
  function forest(baseY, minH, maxH, col, snowLit, snowShade, gap, hazeTop) {
    const trees = [];
    for (let px = -60 * u; px < W + 60 * u; px += gap * (.55 + rnd() * .9)) {
      const by = baseY + (fbm(px / (900 * u), 4.2, 3) - .5) * 120 * u + rnd() * 10 * u;
      trees.push([px, by, minH + (maxH - minH) * Math.pow(rnd(), 1.6)]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    // ground under the trees
    x.fillStyle = snowShade; x.beginPath(); x.moveTo(0, H);
    for (let px = 0; px <= W; px += 20 * u) x.lineTo(px, baseY + (fbm(px / (900 * u), 4.2, 3) - .5) * 120 * u - maxH * .08);
    x.lineTo(W, H); x.closePath(); x.fill();
    for (const [px, by, hh] of trees) pine(px, by, hh, col, snowLit, snowShade, 7 + Math.round(rnd() * 3));
    if (hazeTop) { const hg = x.createLinearGradient(0, baseY - maxH, 0, baseY + 40 * u); hg.addColorStop(0, 'rgba(226,236,248,0)'); hg.addColorStop(1, `rgba(226,236,248,${hazeTop})`); x.fillStyle = hg; x.fillRect(0, baseY - maxH * 1.2, W, maxH * 1.2 + 60 * u); }
  }
  forest(HZ + 290 * u, 30 * u, 70 * u, '#6c8aa0', '#eef4fb', '#c8d7e8', 9 * u, .5);
  mist(HZ + 250 * u, HZ + 420 * u, .5);
  forest(HZ + 430 * u, 80 * u, 190 * u, '#21403f', '#f4f8fd', '#bccde2', 20 * u, .15);

  // snowfield: rolling drifts with cool shadows and sparkle
  const fieldTop = HZ + 470 * u;
  img = x.getImageData(0, Math.floor(fieldTop - 40 * u), W, Math.ceil(H - fieldTop + 40 * u)); d = img.data;
  const f0 = Math.floor(fieldTop - 40 * u);
  for (let py = f0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const edgeY = fieldTop + (fbm(px / (700 * u) + 50, 2, 4) - .5) * 70 * u;
      if (py < edgeY) continue;
      const t = (py - edgeY) / (H - edgeY);
      const dune = fbm(px / (520 * u) + 60, py / (120 * u) + 5, 5);
      const ddx = fbm((px + 6 * u) / (520 * u) + 60, py / (120 * u) + 5, 5) - dune;
      const lit = clamp(.62 + ddx * 9 + (dune - .5) * .35);
      let col = mix([186, 206, 232], [253, 254, 255], lit);
      col = mix(col, [236, 242, 250], clamp(.35 - t * .5));
      const a = clamp((py - edgeY) / (3 * u));
      const i = ((py - f0) * W + px) * 4;
      d[i] += (col[0] - d[i]) * a; d[i + 1] += (col[1] - d[i + 1]) * a; d[i + 2] += (col[2] - d[i + 2]) * a;
    }
  }
  x.putImageData(img, 0, f0);
  x.globalCompositeOperation = 'screen';
  for (let i = 0; i < 2400; i++) { const sy = fieldTop + Math.pow(rnd(), .8) * (H - fieldTop), r = (.6 + rnd() * 1.6) * u * (sy / H); x.fillStyle = `rgba(255,255,255,${.35 + rnd() * .6})`; x.beginPath(); x.arc(rnd() * W, sy, r, 0, 7); x.fill(); }
  x.globalCompositeOperation = 'source-over';

  // a few close spruces at the edges, standing on the snowfield
  const groups = [[60, 560], [250, 420], [400, 330], [W / u - 90, 600], [W / u - 290, 440], [W / u - 430, 320]];
  for (const [gx, gh] of groups) pine(gx * u, H - (40 + rnd() * 40) * u, gh * u, '#173532', '#f6f9fe', '#b3c6de', 12);
  // their soft shadows on the snow
  x.globalCompositeOperation = 'multiply';
  for (const [gx, gh] of groups) { const sg2 = x.createRadialGradient(gx * u - gh * .25 * u, H - 30 * u, 0, gx * u - gh * .25 * u, H - 30 * u, gh * .5 * u); sg2.addColorStop(0, 'rgba(150,175,215,.55)'); sg2.addColorStop(1, 'rgba(150,175,215,0)'); x.fillStyle = sg2; x.fillRect(0, H - gh * u, W, gh * u); }
  x.globalCompositeOperation = 'source-over';

  // gentle cool vignette and fine grain
  g = x.createRadialGradient(W / 2, H * .45, H * .45, W / 2, H * .5, W * .75); g.addColorStop(0, 'rgba(40,70,110,0)'); g.addColorStop(1, 'rgba(40,70,110,.28)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const fin = x.getImageData(0, 0, W, H), fd = fin.data;
  for (let i = 0; i < fd.length; i += 4) { const n = (rnd() - .5) * 6; fd[i] += n; fd[i + 1] += n; fd[i + 2] += n; }
  x.putImageData(fin, 0, 0);
  document.title = 'done';
}

/* ---------- Vice: neon coast at dusk ---------- */
function paintVice(W, H, helpers) {
  const { rnd, fbm, clamp } = helpers(20261120);
  const c = document.getElementById('c'), x = c.getContext('2d');
  const u = H / 1440, HZ = H * .62;

  let g = x.createLinearGradient(0, 0, 0, HZ);
  [[0, '#0a0522'], [.26, '#26104f'], [.5, '#5f1c78'], [.7, '#bf367c'], [.86, '#ff7448'], [1, '#ffc36a']].forEach(([s, col]) => g.addColorStop(s, col));
  x.fillStyle = g; x.fillRect(0, 0, W, HZ);
  for (let i = 0; i < 700; i++) { const sy = rnd() * HZ * .45; x.fillStyle = `rgba(255,255,255,${(.15 + rnd() * .55) * (1 - sy / (HZ * .45))})`; x.beginPath(); x.arc(rnd() * W, sy, (.5 + rnd()) * u, 0, 7); x.fill(); }

  // big striped sun, half set
  const SX = W * .5, SY = HZ - 330 * u, SR = 270 * u;
  g = x.createRadialGradient(SX, SY, 0, SX, SY, H * .8);
  [[0, 'rgba(255,236,190,.9)'], [.12, 'rgba(255,150,100,.5)'], [.35, 'rgba(255,70,140,.2)'], [1, 'rgba(255,70,140,0)']].forEach(([s, col]) => g.addColorStop(s, col));
  x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, HZ); x.globalCompositeOperation = 'source-over';
  const sun = document.createElement('canvas'); sun.width = W; sun.height = Math.ceil(HZ); const sx = sun.getContext('2d');
  g = sx.createLinearGradient(0, SY - SR, 0, SY + SR * .4); g.addColorStop(0, '#fff3b0'); g.addColorStop(.45, '#ffb347'); g.addColorStop(1, '#ff3d7f');
  sx.fillStyle = g; sx.beginPath(); sx.arc(SX, SY, SR, 0, 7); sx.fill();
  sx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 9; k++) { const yy = SY - SR * .05 + k * SR * .13, hh = 2 * u + k * 2.2 * u; sx.fillRect(SX - SR, yy, SR * 2, hh); }
  x.shadowColor = 'rgba(255,120,120,.8)'; x.shadowBlur = 60 * u; x.drawImage(sun, 0, 0); x.shadowBlur = 0;

  // clouds lit from below
  let img = x.getImageData(0, 0, W, Math.ceil(HZ)), d = img.data;
  for (let py = 0; py < img.height; py++) {
    const t = py / HZ;
    for (let px = 0; px < W; px++) {
      const n = fbm(px / (780 * u) + 3, py / (225 * u) + 9, 5) * .75 + fbm(px / (210 * u), py / (69 * u), 3) * .25;
      let a = (n - (.52 + .10 * Math.abs(t - .45))) * 4.2; if (a <= 0) continue; a = Math.min(1, a) * (.22 + .65 * Math.sin(Math.PI * Math.min(1, t * 1.08)));
      const lit = Math.pow(clamp(fbm(px / (780 * u) + 3, (py + 50 * u) / (225 * u) + 9, 5) - n + .5), 2.2);
      const warm = clamp(1 - Math.hypot((px - SX) / W, (py - SY) / HZ) * 1.7);
      const r = 70 + 185 * lit * (.45 + warm), gg = 40 + 120 * lit * warm + 30 * lit, b = 95 + 70 * lit * (1 - warm);
      const i = (py * W + px) * 4;
      d[i] += (r - d[i]) * a; d[i + 1] += (gg - d[i + 1]) * a; d[i + 2] += (b - d[i + 2]) * a;
    }
  }
  x.putImageData(img, 0, 0);

  // skyline: three layers, lit windows, neon rims on the tall towers
  const lights = [];
  function skyline(base, minH, maxH, col, haze, lit, neon) {
    let px = -60 * u;
    while (px < W + 60 * u) {
      const bw = (50 + rnd() * 140) * u, tall = rnd() < .16, bh = tall ? maxH * (.75 + rnd() * .5) : minH + rnd() * (maxH - minH) * .55;
      const top = base - bh;
      x.fillStyle = col; x.fillRect(px, top, bw, bh + 6 * u);
      if (tall && rnd() < .7) { x.fillRect(px + bw * .3, top - 24 * u - rnd() * 45 * u, bw * .4, 75 * u); x.fillRect(px + bw / 2 - 2 * u, top - 105 * u - rnd() * 60 * u, 4 * u, 120 * u); lights.push([px + bw / 2, top - 110 * u, '#ff5a6e', 4.5 * u]); }
      if (lit) for (let wy = top + 12 * u; wy < base - 9 * u; wy += 13.5 * u) for (let wx = px + 7 * u; wx < px + bw - 7 * u; wx += 12 * u) {
        if (rnd() < .34) { const col2 = rnd() < .72 ? 'rgba(255,214,150,' : rnd() < .5 ? 'rgba(120,225,255,' : 'rgba(255,120,200,'; x.fillStyle = col2 + (.35 + rnd() * .65) + ')'; x.fillRect(wx, wy, 6 * u, 7.5 * u); if (rnd() < .04) lights.push([wx, wy, col2 + '1)', 3 * u]); }
      }
      if (neon && tall) {
        const nc = rnd() < .5 ? '#ff3fa4' : '#46e0ff';
        x.save(); x.shadowColor = nc; x.shadowBlur = 18 * u; x.strokeStyle = nc; x.lineWidth = 2.6 * u;
        x.beginPath(); x.moveTo(px, top + bh * .5); x.lineTo(px, top); x.lineTo(px + bw, top); x.stroke(); x.restore();
      }
      px += bw + (rnd() < .2 ? (15 + rnd() * 60) * u : 1.5 * u);
    }
    if (haze) { const hg = x.createLinearGradient(0, base - maxH, 0, base); hg.addColorStop(0, 'rgba(255,120,120,0)'); hg.addColorStop(1, haze); x.fillStyle = hg; x.fillRect(0, base - maxH * 1.3, W, maxH * 1.3); }
  }
  skyline(HZ, 45 * u, 225 * u, '#5b2a6e', 'rgba(255,140,110,.42)', false, false);
  skyline(HZ, 75 * u, 450 * u, '#2c1447', 'rgba(255,110,120,.20)', true, true);
  skyline(HZ, 45 * u, 255 * u, '#170a2c', null, true, true);
  x.globalCompositeOperation = 'screen';
  for (const [lx, ly, col, r] of lights) { const lg = x.createRadialGradient(lx, ly, 0, lx, ly, r * 9); lg.addColorStop(0, col); lg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = lg; x.fillRect(lx - r * 9, ly - r * 9, r * 18, r * 18); }
  x.globalCompositeOperation = 'source-over';

  // water: mirrored, rippled, darker with depth
  const src = x.getImageData(0, 0, W, Math.ceil(HZ));
  const out = x.createImageData(W, H - Math.ceil(HZ));
  for (let py = 0; py < out.height; py++) {
    const depth = py / out.height, sy = Math.max(0, Math.floor(HZ - 3 * u - py * 1.55));
    const amp = (2 + depth * 26) * u;
    for (let px = 0; px < W; px++) {
      const off = Math.round((fbm(px / ((90 + depth * 260) * u), py / ((5 + depth * 9) * u) + 40, 4) - .5) * amp * 2);
      const sxx = Math.min(W - 1, Math.max(0, px + off)), syy = Math.min(src.height - 1, Math.max(0, sy + Math.round(off * .4)));
      const i = (py * W + px) * 4, j = (syy * W + sxx) * 4, k = .78 - depth * .42;
      out.data[i] = src.data[j] * k + 10; out.data[i + 1] = src.data[j + 1] * k * .92 + 4; out.data[i + 2] = src.data[j + 2] * k + 26; out.data[i + 3] = 255;
    }
  }
  x.putImageData(out, 0, Math.ceil(HZ));
  x.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4200; i++) { const dp = Math.pow(rnd(), 1.4), yy = HZ + 4 * u + dp * (H - HZ), spread = (60 + dp * 620) * u, xx = SX + (rnd() + rnd() + rnd() - 1.5) * spread;
    x.fillStyle = `rgba(255,${190 + rnd() * 50 | 0},${120 + rnd() * 60 | 0},${(.1 + rnd() * .45) * (1 - dp * .5)})`; x.fillRect(xx, yy, (12 + dp * 90 * rnd()) * u, (2 + dp * 4) * u); }
  x.globalCompositeOperation = 'source-over';
  g = x.createLinearGradient(0, HZ - 60 * u, 0, HZ + 75 * u); g.addColorStop(0, 'rgba(255,170,130,0)'); g.addColorStop(.5, 'rgba(255,170,130,.30)'); g.addColorStop(1, 'rgba(255,170,130,0)'); x.fillStyle = g; x.fillRect(0, HZ - 60 * u, W, 135 * u);

  // palms
  function palm(bx, by, hgt, lean, s) {
    x.strokeStyle = '#07030f'; x.fillStyle = '#07030f'; x.lineCap = 'round';
    const tx = bx + lean, ty = by - hgt;
    for (let i = 0; i <= 500; i++) { const t = i / 500; x.beginPath(); x.arc(bx + lean * t * t, by - hgt * t, (22 - 12 * t) * s, 0, 7); x.fill(); }
    for (let f = 0; f < 14; f++) {
      const ang = -Math.PI * (.02 + f / 13 * .96) + (rnd() - .5) * .25, len = (450 + rnd() * 220) * s, droop = .5 + rnd() * .6;
      const pts = [];
      for (let k = 0; k <= 30; k++) { const t = k / 30; pts.push([tx + Math.cos(ang) * len * t, ty + Math.sin(ang) * len * t * (1 - t * .35) + droop * len * t * t * .75]); }
      x.lineWidth = 7 * s; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke();
      x.lineWidth = 3.4 * s;
      for (let k = 2; k < pts.length; k++) { const [a, b] = pts[k], [pa, pb] = pts[k - 1], dir = Math.atan2(b - pb, a - pa), ll = (100 - Math.abs(k - 13) * 4.4) * s * (.8 + rnd() * .4);
        for (const side of [-1, 1]) { const la = dir + side * (1.05 + rnd() * .35) + .35; x.beginPath(); x.moveTo(a, b); x.quadraticCurveTo(a + Math.cos(la) * ll * .6, b + Math.sin(la) * ll * .6, a + Math.cos(la) * ll + 9 * s, b + Math.sin(la) * ll + ll * .35); x.stroke(); } }
    }
  }
  palm(225 * u, H + 60 * u, 1350 * u, 180 * u, 1.25 * u); palm(645 * u, H + 90 * u, 960 * u, -105 * u, .9 * u); palm(W - 315 * u, H + 60 * u, 1470 * u, -225 * u, 1.3 * u); palm(W - 780 * u, H + 120 * u, 900 * u, 90 * u, .8 * u);

  g = x.createRadialGradient(W / 2, H * .5, H * .35, W / 2, H * .5, W * .72); g.addColorStop(0, 'rgba(10,3,25,0)'); g.addColorStop(1, 'rgba(10,3,25,.6)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const fin = x.getImageData(0, 0, W, H), fd = fin.data;
  for (let i = 0; i < fd.length; i += 4) { const n = (rnd() - .5) * 10; fd[i] += n; fd[i + 1] += n; fd[i + 2] += n; }
  x.putImageData(fin, 0, 0);
  document.title = 'done';
}

const painter = which === 'vice' ? paintVice : paintWinter;
const page = `<body style="margin:0;background:#000"><canvas id="c" width="${W}" height="${H}"></canvas><script>window.onerror=(m)=>{document.title='error: '+m};(${painter.toString()})(${W},${H},${helpers.toString()})</script></body>`;

app.dock && app.dock.hide();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 800, height: 450, show: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,' + encodeURIComponent(page));
  for (let i = 0; i < 1200 && w.getTitle() !== 'done' && !w.getTitle().startsWith('error'); i++) await new Promise((r) => setTimeout(r, 250));
  const err = await w.webContents.executeJavaScript('window.__err || null').catch(() => null);
  if (w.getTitle() !== 'done') { console.error('painter did not finish:', w.getTitle(), err); app.exit(1); return; }
  const url = await w.webContents.executeJavaScript("document.getElementById('c').toDataURL('image/jpeg', .9)");
  fs.mkdirSync(path.join(__dirname, '..', 'public', 'themes'), { recursive: true });
  const out = path.join(__dirname, '..', 'public', 'themes', `${which}.jpg`);
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', out);
  app.quit();
});

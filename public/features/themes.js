/* Theme effects drawn on a canvas behind the page.
   - snow: three depths (small and slow far away, large and soft up close), drifting on a light wind (Winter)
   - sparks: warm embers rising and fading
   - stars: a still sky that twinkles
   - rain: thin streaks on a slant
   Winter uses snow; a theme pack picks one in theme.json ("effect": { "kind", "color", "density" }).
   Stops when the theme has none, the window is hidden, or the person prefers reduced motion. */
(() => {
  let canvas = null, raf = null, running = '';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function rgba(color, a) {
    const c = color || '#ffffff';
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    const hex = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  const KINDS = {
    snow: {
      layers: [
        { share: .55, r: [.6, 1.4], speed: [.12, .22], alpha: .7, blur: 0 },
        { share: .33, r: [1.4, 2.4], speed: [.25, .4], alpha: .85, blur: 0 },
        { share: .12, r: [2.6, 4.2], speed: [.45, .7], alpha: .75, blur: 1.5 },
      ],
      make: (L) => ({ x: Math.random(), y: Math.random(), r: rnd(...L.r), s: rnd(...L.speed), d: Math.random() * 6.3, w: rnd(.4, 1.2) }),
      move(f, dt, k, H, wind) {
        f.d += .012 * dt * f.w;
        f.y += (f.s * dt * k * 1.8) / H;
        f.x += Math.sin(f.d) * .00035 * dt + wind * dt * (f.s * 3);
        if (f.y > 1.02) { f.y = -.02; f.x = Math.random(); }
      },
      shadow: 'rgba(70,110,170,.45)',
    },
    sparks: {
      layers: [
        { share: .7, r: [.7, 1.6], speed: [.15, .35], alpha: .8, blur: 0 },
        { share: .3, r: [1.6, 2.8], speed: [.3, .55], alpha: .7, blur: 1 },
      ],
      make: (L) => ({ x: Math.random(), y: Math.random(), r: rnd(...L.r), s: rnd(...L.speed), d: Math.random() * 6.3, w: rnd(.5, 1.4), life: Math.random() }),
      move(f, dt, k, H) {
        f.d += .02 * dt * f.w;
        f.y -= (f.s * dt * k * 1.4) / H;
        f.x += Math.sin(f.d) * .0005 * dt;
        f.life += .002 * dt;
        if (f.y < -.02 || f.life > 1) { f.y = 1.02; f.x = Math.random(); f.life = 0; }
      },
      alpha: (f) => Math.sin(Math.min(1, f.life) * Math.PI),
      color: '#ffb35c', shadow: 'rgba(255,120,60,.8)',
    },
    stars: {
      layers: [{ share: 1, r: [.5, 1.6], speed: [0, 0], alpha: .9, blur: 0 }],
      make: (L) => ({ x: Math.random(), y: Math.random() * .7, r: rnd(...L.r), d: Math.random() * 6.3, w: rnd(.3, 1.2) }),
      move(f, dt) { f.d += .02 * dt * f.w; },
      alpha: (f) => .35 + .65 * (0.5 + Math.sin(f.d) / 2),
      shadow: 'rgba(200,220,255,.8)', count: .5,
    },
    rain: {
      layers: [{ share: 1, r: [.6, 1.1], speed: [1.6, 2.6], alpha: .35, blur: 0 }],
      make: (L) => ({ x: Math.random(), y: Math.random(), r: rnd(...L.r), s: rnd(...L.speed), len: rnd(10, 22) }),
      move(f, dt, k, H) { f.y += (f.s * dt * k * 4) / H; f.x += .0006 * dt; if (f.y > 1.05) { f.y = -.05; f.x = Math.random(); } },
      line: true, color: '#a9c7ee',
    },
  };

  function start(kind, opt = {}) {
    const K = KINDS[kind];
    if (!K || reduced()) return;
    canvas = document.createElement('canvas');
    canvas.id = 'snow'; // shares the full-page canvas styles
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const size = () => { if (!canvas) return; canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
    size();
    window.addEventListener('resize', size);
    const n = Math.round(Math.min(220, innerWidth / 7) * (K.count || 1) * (opt.density || 1));
    const flakes = [];
    for (const L of K.layers) for (let i = 0; i < Math.round(n * L.share); i++) flakes.push({ L, ...K.make(L) });
    const color = opt.color || K.color || '#ffffff';
    let last = performance.now();
    const t0 = last;
    const step = (t) => {
      const dt = Math.min(50, t - last) / 16.7; last = t;
      if (!document.hidden && canvas) {
        const W = canvas.width, H = canvas.height, k = devicePixelRatio;
        const wind = Math.sin((t - t0) / 9000) * .00035;
        ctx.clearRect(0, 0, W, H);
        for (const L of K.layers) {
          ctx.filter = L.blur ? `blur(${L.blur * k}px)` : 'none';
          ctx.shadowColor = K.shadow || 'transparent';
          ctx.shadowBlur = L.blur ? 0 : 3 * k;
          for (const f of flakes) {
            if (f.L !== L) continue;
            K.move(f, dt, k, H, wind);
            if (f.x > 1.02) f.x = -.02; else if (f.x < -.02) f.x = 1.02;
            const a = L.alpha * (K.alpha ? K.alpha(f) : 1);
            if (K.line) {
              ctx.strokeStyle = rgba(color, a); ctx.lineWidth = f.r * k;
              ctx.beginPath(); ctx.moveTo(f.x * W, f.y * H); ctx.lineTo(f.x * W - f.len * .25 * k, f.y * H - f.len * k); ctx.stroke();
            } else {
              ctx.fillStyle = rgba(color, a);
              ctx.beginPath(); ctx.arc(f.x * W, f.y * H, f.r * k, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
        ctx.filter = 'none';
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    cancelAnimationFrame(raf);
    canvas?.remove();
    canvas = null;
  }
  function apply() {
    const pack = window.currentPack?.();
    const fx = pack ? pack.effect || { kind: 'none' } : document.documentElement.dataset.theme === 'winter' ? { kind: 'snow' } : { kind: 'none' };
    const sig = JSON.stringify(fx);
    if (sig === running) return;
    stop();
    running = sig;
    start(fx.kind, fx);
  }
  window.addEventListener('themechange', apply);
  apply();
})();

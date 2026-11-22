/* Theme effects. Winter: snowfall in three depths (small and slow far away, large and soft up close,
   all drifting on a light wind). Stops when another theme is picked, the window is hidden, or the
   person prefers reduced motion. */
(() => {
  let canvas = null, raf = null, flakes = [];
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() {
    if (canvas || reduced()) return;
    canvas = document.createElement('canvas');
    canvas.id = 'snow';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const size = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
    size();
    window.addEventListener('resize', size);
    const n = Math.min(220, Math.round(innerWidth / 7));
    const LAYERS = [
      { share: .55, r: [.6, 1.4], speed: [.12, .22], alpha: .7, blur: 0 },
      { share: .33, r: [1.4, 2.4], speed: [.25, .4], alpha: .85, blur: 0 },
      { share: .12, r: [2.6, 4.2], speed: [.45, .7], alpha: .75, blur: 1.5 },
    ];
    flakes = [];
    for (const L of LAYERS) for (let i = 0; i < Math.round(n * L.share); i++) {
      flakes.push({ L, x: Math.random(), y: Math.random(), r: L.r[0] + Math.random() * (L.r[1] - L.r[0]), s: L.speed[0] + Math.random() * (L.speed[1] - L.speed[0]), d: Math.random() * Math.PI * 2, w: .4 + Math.random() * .8 });
    }
    let last = performance.now(), t0 = last;
    const step = (t) => {
      const dt = Math.min(50, t - last) / 16.7; last = t;
      if (!document.hidden) {
        const W = canvas.width, Hh = canvas.height, k = devicePixelRatio;
        const wind = Math.sin((t - t0) / 9000) * .00035;
        ctx.clearRect(0, 0, W, Hh);
        for (const L of LAYERS) {
          ctx.filter = L.blur ? `blur(${L.blur * k}px)` : 'none';
          ctx.fillStyle = `rgba(255,255,255,${L.alpha})`;
          ctx.shadowColor = 'rgba(70,110,170,.45)';
          ctx.shadowBlur = L.blur ? 0 : 3 * k;
          ctx.beginPath();
          for (const f of flakes) {
            if (f.L !== L) continue;
            f.d += .012 * dt * f.w;
            f.y += (f.s * dt * k * 1.8) / Hh;
            f.x += Math.sin(f.d) * .00035 * dt + wind * dt * (f.s * 3);
            if (f.y > 1.02) { f.y = -.02; f.x = Math.random(); }
            if (f.x > 1.02) f.x = -.02; else if (f.x < -.02) f.x = 1.02;
            ctx.moveTo(f.x * W + f.r * k, f.y * Hh);
            ctx.arc(f.x * W, f.y * Hh, f.r * k, 0, Math.PI * 2);
          }
          ctx.fill();
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
  const apply = () => (document.documentElement.dataset.theme === 'winter' ? start() : stop());
  window.addEventListener('themechange', apply);
  apply();
})();

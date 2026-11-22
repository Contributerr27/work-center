/* Theme effects. Winter: gentle snowfall on a canvas behind the desk (stops when another theme is
   picked, the window is hidden, or the person prefers reduced motion). */
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
    const n = Math.min(140, Math.round(innerWidth / 11));
    flakes = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 2.6, s: 0.15 + Math.random() * 0.45, d: Math.random() * Math.PI * 2 }));
    let last = performance.now();
    const step = (t) => {
      const dt = Math.min(50, t - last) / 16.7; last = t;
      if (!document.hidden) {
        const W = canvas.width, Hh = canvas.height, k = devicePixelRatio;
        ctx.clearRect(0, 0, W, Hh);
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.shadowColor = 'rgba(60,100,160,.55)';
        ctx.shadowBlur = 4 * k;
        for (const f of flakes) {
          f.d += 0.01 * dt;
          f.y += (f.s * dt * k) / Hh * 1.6;
          f.x += Math.sin(f.d) * 0.0004 * dt;
          if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
          ctx.beginPath();
          ctx.arc(f.x * W, f.y * Hh, f.r * k, 0, Math.PI * 2);
          ctx.fill();
        }
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

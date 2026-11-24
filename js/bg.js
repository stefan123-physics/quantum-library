// Animated "particle field" background: charged particles drifting, attracting/repelling,
// connected by faint field lines when close. Calm by design; static under reduced motion.
export function startBackground(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let w, h, dpr, particles = [], raf = 0, colors = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = {
      pos: cs.getPropertyValue('--particle-pos').trim() || '#38bdf8',
      neg: cs.getPropertyValue('--particle-neg').trim() || '#a78bfa',
      line: cs.getPropertyValue('--particle-line').trim() || 'rgba(120,160,255,.15)',
    };
  }

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(90, (w * h) / 16000));
    particles = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      q: Math.random() < 0.5 ? 1 : -1,
      r: 1 + Math.random() * 1.6,
    }));
  }

  let t = 0;
  function frame() {
    t += 0.004;
    ctx.clearRect(0, 0, w, h);
    const R = 120;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          // Coulomb-ish nudge: opposite charges attract, like charges repel (tiny, capped).
          const f = (-a.q * b.q * 0.004) / Math.max(d, 20);
          a.vx -= (f * dx) / d; a.vy -= (f * dy) / d;
          b.vx += (f * dx) / d; b.vy += (f * dy) / d;
          ctx.globalAlpha = 1 - d / R;
          ctx.strokeStyle = colors.line;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          // field lines bend a little: quadratic curve through a perpendicular offset
          const mx = (a.x + b.x) / 2 - dy * 0.12 * a.q, my = (a.y + b.y) / 2 + dx * 0.12 * a.q;
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const p of particles) {
      p.vx *= 0.995; p.vy *= 0.995;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp < 0.08) { p.vx += (Math.random() - 0.5) * 0.05; p.vy += (Math.random() - 0.5) * 0.05; }
      if (sp > 0.6) { p.vx *= 0.6 / sp; p.vy *= 0.6 / sp; }
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      ctx.fillStyle = p.q > 0 ? colors.pos : colors.neg;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    // a slow travelling sine wave along the bottom, like an oscilloscope trace
    ctx.strokeStyle = colors.pos;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const y = h - 60 + Math.sin(x * 0.012 - t * 6) * 16 * (0.55 + 0.45 * Math.sin(x * 0.0021 + t * 2));
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    if (!reduce.matches && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function restart() {
    cancelAnimationFrame(raf);
    readColors();
    frame();
  }

  resize();
  restart();
  addEventListener('resize', () => { resize(); restart(); });
  document.addEventListener('visibilitychange', restart);
  reduce.addEventListener?.('change', restart);
  return { refresh: restart };
}

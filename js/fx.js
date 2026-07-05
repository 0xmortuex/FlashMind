// ===== FX Module =====
// Shared motion utilities: canvas-based confetti with real physics, number
// count-ups, and a scroll-reveal observer. Everything respects
// prefers-reduced-motion.
const FX = (() => {
  const COLORS = ['#8b5cf6', '#22d3ee', '#22c55e', '#fbbf24', '#ef4444', '#ec4899'];

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ----- Confetti (canvas physics: velocity, gravity, drag, spin) -----
  let canvas = null, ctx = null, particles = [], raf = null, lastT = 0;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    (document.getElementById('confetti-container') || document.body).appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Burst from a point. x/y are 0..1 viewport fractions; angle in radians
  // (-PI/2 = straight up), spread widens the cone.
  function burst(x, y, { count = 70, angle = -Math.PI / 2, spread = 1.1, power = 620 } = {}) {
    if (reduced()) return;
    ensureCanvas();
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = power * (0.35 + Math.random() * 0.65);
      particles.push({
        x: x * innerWidth, y: y * innerHeight,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 5 + Math.random() * 7, h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        shape: Math.random() < 0.35 ? 'circle' : 'rect',
        ttl: 1.6 + Math.random() * 1.2, age: 0
      });
    }
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }

  // Full celebration: two corner cannons + a center pop.
  function celebrate() {
    if (reduced()) return;
    burst(0.12, 0.98, { angle: -Math.PI / 2.6, spread: 0.8, count: 60 });
    burst(0.88, 0.98, { angle: -Math.PI + Math.PI / 2.6, spread: 0.8, count: 60 });
    setTimeout(() => burst(0.5, 0.35, { spread: Math.PI * 2, power: 380, count: 50 }), 220);
  }

  function tick(t) {
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    particles = particles.filter(p => {
      p.age += dt;
      if (p.age >= p.ttl) return false;
      p.vy += 1400 * dt;          // gravity
      p.vx *= (1 - 1.1 * dt);     // air drag
      p.vy *= (1 - 0.28 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const fade = Math.min(1, (p.ttl - p.age) / 0.5);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // scaleY on the spin makes rects glint like real paper
        ctx.scale(1, 0.6 + Math.abs(Math.sin(p.rot * 2)) * 0.4);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
      return p.y < innerHeight + 40;
    });
    if (particles.length) raf = requestAnimationFrame(tick);
    else { raf = null; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // ----- Count-up numbers -----
  function countUp(el, to, { duration = 900, decimals = 0, prefix = '', suffix = '' } = {}) {
    if (!el) return;
    const target = Number(to) || 0;
    if (reduced() || duration <= 0) {
      el.textContent = prefix + target.toFixed(decimals) + suffix;
      return;
    }
    const start = performance.now();
    function frame(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ----- Scroll reveal -----
  const io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' })
    : null;

  function observe(root) {
    const els = (root || document).querySelectorAll('.reveal:not(.in)');
    if (!io) { els.forEach(el => el.classList.add('in')); return; }
    els.forEach(el => io.observe(el));
  }

  return { reduced, burst, celebrate, countUp, observe };
})();

// ===== Interactive labs =====
// Hands-on simulations built from the student's material. The AI only picks
// a template and fills in a declarative spec (sliders, formulas, challenges —
// see js/simspec.js); this module is the trusted renderer: hand-rolled SVG
// for graphs, motion, circuits and timelines, updated in place on every
// slider move (no re-render while dragging). Labs are stored on the set
// (data.labs). Starter labs work offline, with no AI call.
const Labs = (() => {
  const W = 600, H = 340;
  const PAD = { l: 52, r: 18, t: 18, b: 40 };
  const COLORS = ['var(--primary)', 'var(--secondary)', 'var(--accent-orange)', 'var(--accent-pink)'];
  let host = null;
  let forData = null;
  let activeId = null;
  let mode = 'view';       // 'view' | 'setup'
  let busy = false;
  let cur = null;          // live state of the open lab
  let raf = 0, loopRaf = 0;
  let saveTimer = 0;

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // ----- Number helpers -----

  function fmt(v, digits) {
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '−∞';
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e7 || a < 1e-4)) return v.toExponential(2);
    const d = Number.isInteger(digits) ? digits : 2;
    return Number(v.toFixed(d)).toLocaleString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: d });
  }
  const stepDigits = step => Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));

  function niceTicks(lo, hi, count) {
    const step = SimSpec.niceStep((hi - lo) / (count || 5));
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6 && out.length < 30; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  const tickLabel = v => {
    const a = Math.abs(v);
    if (a >= 1e5 || (a > 0 && a < 1e-3)) return v.toExponential(0);
    return String(Number(v.toPrecision(6)));
  };

  // Parameter combinations used to fix the axes once per lab (so they don't
  // jump while sliders move): defaults, then each slider swept on its own.
  function combos(lab) {
    const base = {};
    lab.params.forEach(p => { base[p.id] = p.value; });
    const out = [base];
    lab.params.forEach(p => {
      [p.min, (p.min + p.value) / 2, (p.value + p.max) / 2, p.max].forEach(v => out.push({ ...base, [p.id]: v }));
    });
    return out;
  }

  function robust(vals, includeZero) {
    const f = vals.filter(Number.isFinite).sort((a, b) => a - b);
    if (!f.length) return [0, 1];
    let lo = f[Math.floor(f.length * 0.02)], hi = f[Math.ceil(f.length * 0.98) - 1];
    if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    return [lo - (lo === 0 ? 0 : pad), hi + pad];
  }

  // ----- Stage builders (static SVG; dynamic parts get data-* hooks) -----

  function axesSvg(xr, yr, xLabel, yLabel) {
    const sx = x => PAD.l + (x - xr[0]) / (xr[1] - xr[0]) * (W - PAD.l - PAD.r);
    const sy = y => H - PAD.b - (y - yr[0]) / (yr[1] - yr[0]) * (H - PAD.t - PAD.b);
    let g = '';
    niceTicks(xr[0], xr[1], 6).forEach(v => {
      const x = sx(v).toFixed(1);
      g += `<line class="lab-grid" x1="${x}" x2="${x}" y1="${PAD.t}" y2="${H - PAD.b}"/><text class="lab-tick" x="${x}" y="${H - PAD.b + 16}" text-anchor="middle">${tickLabel(v)}</text>`;
    });
    niceTicks(yr[0], yr[1], 5).forEach(v => {
      const y = sy(v).toFixed(1);
      g += `<line class="lab-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/><text class="lab-tick" x="${PAD.l - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${tickLabel(v)}</text>`;
    });
    if (xr[0] < 0 && xr[1] > 0) g += `<line class="lab-axis" x1="${sx(0)}" x2="${sx(0)}" y1="${PAD.t}" y2="${H - PAD.b}"/>`;
    if (yr[0] < 0 && yr[1] > 0) g += `<line class="lab-axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(0)}" y2="${sy(0)}"/>`;
    g += `<defs><clipPath id="lab-clip"><rect x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${H - PAD.t - PAD.b}"/></clipPath></defs>`;
    g += `<rect class="lab-frame" x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${H - PAD.t - PAD.b}"/>`;
    g += `<text class="lab-axis-label" x="${W - PAD.r}" y="${H - 6}" text-anchor="end">${esc(xLabel)}</text>`;
    g += `<text class="lab-axis-label" x="${PAD.l + 4}" y="${PAD.t + 12}">${esc(yLabel)}</text>`;
    return { g, sx, sy };
  }

  function graphStage(lab) {
    const gr = lab.graph;
    const xr = [gr.x.min, gr.x.max];
    const yr = Number.isFinite(gr.y.min) ? [gr.y.min, gr.y.max] : graphRange(lab, cur.rt.scope(cur.values, cur.state));
    const ax = axesSvg(xr, yr, gr.x.label, gr.y.label);
    cur.map = { sx: ax.sx, sy: ax.sy, xr, yr };
    const curves = gr.curves.map((c, i) => `<path class="lab-curve" data-lab-curve="${i}" style="stroke:${COLORS[i % 4]}" d=""/>`).join('');
    const marker = gr.marker ? `<g data-lab-marker><line class="lab-guide" data-lab-mx/><line class="lab-guide" data-lab-my/><circle class="lab-dot" r="6"/><text class="lab-dot-label" dy="-12" text-anchor="middle">${esc(gr.marker.label)}</text></g>` : '';
    const legend = gr.curves.length > 1 || gr.curves[0].label
      ? `<div class="lab-legend">${gr.curves.map((c, i) => `<span><i style="background:${COLORS[i % 4]}"></i>${esc(c.label || 'y' + (i + 1))}</span>`).join('')}</div>` : '';
    return `<svg class="lab-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lab.title)}">${ax.g}<g clip-path="url(#lab-clip)">${curves}</g>${marker}</svg>${legend}`;
  }

  function motionStage(lab) {
    const [xr, yr] = motionFrame(lab, cur.rt.scope(cur.values, cur.state));
    const pw = W - PAD.l - PAD.r;
    const ax = axesSvg(xr, yr, 'x (m)', 'y (m)');
    cur.map = { sx: ax.sx, sy: ax.sy, xr, yr };
    const ground = lab.motion.kind === 'path' ? `<rect class="lab-ground" x="${PAD.l}" y="${ax.sy(0).toFixed(1)}" width="${pw}" height="${Math.max(0, H - PAD.b - ax.sy(0)).toFixed(1)}"/>` : '';
    const pend = lab.motion.kind === 'pendulum' ? `<line class="lab-rod" data-lab-rod/><circle class="lab-pivot" r="4" cx="${ax.sx(0)}" cy="${ax.sy(0)}"/>` : '';
    return `<svg class="lab-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lab.title)}">${ax.g}${ground}
      <g clip-path="url(#lab-clip)"><path class="lab-trail" data-lab-trail d=""/><path class="lab-curve" data-lab-done d="" style="stroke:var(--primary)"/>${pend}<circle class="lab-ball" data-lab-ball r="9"/></g></svg>
      <div class="lab-time">
        <button class="lab-play" data-lab-act="play" aria-label="${esc(i18n.t('labPlay'))}">&#9654;</button>
        <input type="range" min="0" max="1000" step="1" value="0" data-lab-time aria-label="${esc(i18n.t('labTime'))}">
        <output data-lab-tout>t = 0 s</output>
      </div>`;
  }

  // Auto-scaled axes fit the current values; they stay fixed while a slider
  // is dragged and are refitted on release when the picture no longer fits.
  function graphRange(lab, s) {
    const gr = lab.graph, vals = [];
    for (let k = 0; k <= 60; k++) gr.curves.forEach((_, i) => vals.push(cur.rt.curveAt(i, gr.x.min + (gr.x.max - gr.x.min) * k / 60, s)));
    const m = cur.rt.marker(s);
    if (m) vals.push(m.y);
    return robust(vals, true);
  }

  function motionPath(s) {
    const te = tEndOf(s), xs = [0], ys = [0];
    for (let k = 0; k <= 60; k++) { const p = cur.rt.motionAt(te * k / 60, s); xs.push(p.x); ys.push(p.y); }
    return { xs: xs.filter(Number.isFinite), ys: ys.filter(Number.isFinite) };
  }

  function motionFrame(lab, s) {
    const { xs, ys } = motionPath(s);
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (lab.motion.kind === 'pendulum') { const m = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), 0.05) * 1.15; x0 = -m; x1 = m; y0 = -m; y1 = m * 0.15; }
    else { const px = (x1 - x0) * 0.08 || 1, py = (y1 - y0) * 0.12 || 1; x0 -= px * 0.3; x1 += px; y0 = Math.min(0, y0) - py * 0.15; y1 += py; }
    // Equal scale on both axes so motion looks physical.
    const k = Math.min(pw / (x1 - x0), ph / (y1 - y0));
    if (lab.motion.kind === 'pendulum') { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; return [[cx - pw / k / 2, cx + pw / k / 2], [cy - ph / k / 2, cy + ph / k / 2]]; }
    return [[x0, x0 + pw / k], [y0, y0 + ph / k]];
  }

  // True when the current picture spills out of the frame or fills under a
  // quarter of it.
  function needsRefit() {
    if (!cur || !cur.map || !cur.map.yr) return false;
    const { lab } = cur, s = cur.rt.scope(cur.values, cur.state);
    const { xr, yr } = cur.map;
    let xs, ys;
    if (lab.template === 'motion') ({ xs, ys } = motionPath(s));
    else if (lab.template === 'graph' && !Number.isFinite(lab.graph.y.min)) { const r = graphRange(lab, s); xs = [xr[0], xr[1]]; ys = r; }
    else return false;
    if (!xs.length || !ys.length) return false;
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const eps = (v, r) => v + (r[1] - r[0]) * 1e-3;
    if (bx0 < xr[0] - eps(0, xr) || bx1 > eps(xr[1], xr) || by0 < yr[0] - eps(0, yr) || by1 > eps(yr[1], yr)) return true;
    return (bx1 - bx0) < (xr[1] - xr[0]) * 0.25 && (by1 - by0) < (yr[1] - yr[0]) * 0.25;
  }

  function tEndOf(s) {
    const te = cur.rt.tEnd(s);
    return te > 0 && te < 1e4 ? te : 10;
  }

  // Schematic: battery on the left; resistors along the top wire (series)
  // or as rungs between two rails (parallel). Click a switch to open it.
  function circuitStage(lab) {
    const c = lab.circuit, layout = cur.state.layout || c.layout, n = c.resistors.length;
    const T = i18n.t;
    const L = 70, R = 540, TOP = 60, BOT = 290;
    let s = `<svg class="lab-svg lab-circuit" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lab.title)}">`;
    const wire = (d, flow) => `<path class="lab-wire" d="${d}"/>` + (flow != null ? `<path class="lab-flow" data-lab-flow="${flow}" d="${d}"/>` : '');
    const label = id => esc(paramLabel(lab, id));
    // battery
    s += `<line class="lab-wire" x1="${L}" y1="${TOP}" x2="${L}" y2="150"/><line class="lab-wire" x1="${L}" y1="200" x2="${L}" y2="${BOT}"/>
      <line class="lab-batt" x1="${L - 22}" y1="150" x2="${L + 22}" y2="150"/><line class="lab-batt short" x1="${L - 12}" y1="166" x2="${L + 12}" y2="166"/>
      <line class="lab-batt" x1="${L - 22}" y1="182" x2="${L + 22}" y2="182"/><line class="lab-batt short" x1="${L - 12}" y1="198" x2="${L + 12}" y2="198"/>
      <text class="lab-clabel" x="${L - 30}" y="180" text-anchor="end" data-lab-vlabel>${label(c.source)}</text>`;
    const zig = (x, y, vertical) => {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const along = -30 + k * 7.5, off = k === 0 || k === 8 ? 0 : (k % 2 ? -8 : 8);
        pts.push(vertical ? `${x + off},${y + along}` : `${x + along},${y + off}`);
      }
      return `<polyline class="lab-res" points="${pts.join(' ')}"/>`;
    };
    const sw = (id, x, y, vertical) => {
      const off = cur.state.off[id];
      const a = vertical ? `M${x},${y - 12} L${off ? x + 12 : x},${y + 12}` : `M${x - 12},${y} L${x + 12},${off ? y - 12 : y}`;
      return `<g class="lab-switch${off ? ' open' : ''}" data-lab-switch="${esc(id)}" role="button" tabindex="0" aria-pressed="${!off}" aria-label="${esc(T('labSwitch', { name: paramLabel(lab, id) }))}">
        <rect class="lab-hit" x="${x - 26}" y="${y - 26}" width="52" height="52"/><path class="lab-switch-arm" d="${a}"/><circle cx="${vertical ? x : x - 12}" cy="${vertical ? y - 12 : y}" r="3"/><circle cx="${vertical ? x : x + 12}" cy="${vertical ? y + 12 : y}" r="3"/></g>`;
    };
    if (layout === 'parallel') {
      s += wire(`M${L},${TOP} L${R},${TOP}`, 'main') + wire(`M${R},${BOT} L${L},${BOT}`, 'main');
      const xs = c.resistors.map((_, i) => 190 + (R - 190) * (n === 1 ? 0.5 : i / (n - 1)) * 0.92);
      c.resistors.forEach((id, i) => {
        const x = xs[i];
        s += wire(`M${x},${TOP} L${x},${TOP + 28}`, i) + wire(`M${x},${TOP + 52} L${x},${150}`, i) + wire(`M${x},${210} L${x},${BOT}`, i);
        s += `<circle class="lab-glow" data-lab-glow="${i}" cx="${x}" cy="180" r="30"/>` + zig(x, 180, true) + sw(id, x, TOP + 40, true);
        s += `<text class="lab-clabel" x="${x + 16}" y="176" data-lab-rlabel="${i}">${label(id)}</text><text class="lab-cval" x="${x + 16}" y="198" data-lab-rval="${i}"></text>`;
      });
    } else {
      // resistors on the top wire, switches on the bottom wire
      const xs = c.resistors.map((_, i) => 160 + (R - 200) * (i + 0.5) / n);
      let x0 = L;
      c.resistors.forEach((id, i) => {
        s += wire(`M${x0},${TOP} L${xs[i] - 30},${TOP}`, 'main');
        s += `<circle class="lab-glow" data-lab-glow="${i}" cx="${xs[i]}" cy="${TOP}" r="30"/>` + zig(xs[i], TOP, false);
        s += `<text class="lab-clabel" x="${xs[i]}" y="${TOP + 34}" text-anchor="middle" data-lab-rlabel="${i}">${label(id)}</text><text class="lab-cval" x="${xs[i]}" y="${TOP + 58}" text-anchor="middle" data-lab-rval="${i}"></text>`;
        x0 = xs[i] + 30;
      });
      s += wire(`M${x0},${TOP} L${R},${TOP} L${R},${BOT}`, 'main');
      const sx = c.resistors.map((_, i) => R - 60 - (R - L - 120) * (i + 0.5) / n);
      let x1 = R;
      c.resistors.forEach((id, i) => {
        s += wire(`M${x1},${BOT} L${sx[i] + 12},${BOT}`, 'main') + sw(id, sx[i], BOT, false);
        x1 = sx[i] - 12;
      });
      s += wire(`M${x1},${BOT} L${L},${BOT}`, 'main');
    }
    s += `</svg>
      <div class="lab-rewire" role="group" aria-label="${esc(T('labLayout'))}">
        <button class="lab-chip${layout === 'series' ? ' active' : ''}" data-lab-layout="series" aria-pressed="${layout === 'series'}">${T('labSeries')}</button>
        <button class="lab-chip${layout === 'parallel' ? ' active' : ''}" data-lab-layout="parallel" aria-pressed="${layout === 'parallel'}">${T('labParallel')}</button>
        <span class="lab-hint">${T('labSwitchHint')}</span>
      </div>`;
    return s;
  }

  function timelineStage(lab) {
    const ev = lab.timeline.events, yp = lab.params[0];
    const sx = y => PAD.l + (y - yp.min) / (yp.max - yp.min) * (W - PAD.l - PAD.r);
    const AY = 120;
    cur.map = { sx };
    let s = `<svg class="lab-svg lab-tl" viewBox="0 0 ${W} 230" role="img" aria-label="${esc(lab.title)}">
      <line class="lab-tl-axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${AY}" y2="${AY}"/><line class="lab-tl-done" data-lab-tlbar x1="${PAD.l}" x2="${PAD.l}" y1="${AY}" y2="${AY}"/>`;
    ev.forEach((e, i) => {
      const x = sx(e.year).toFixed(1), up = i % 2 === 0;
      const ly = up ? AY - 34 - (i % 4 === 0 ? 0 : 22) : AY + 44 + (i % 4 === 1 ? 0 : 22);
      const short = e.label.length > 22 ? e.label.slice(0, 21) + '…' : e.label;
      // Keep edge labels inside the frame.
      const anchor = x < 110 ? 'start' : x > W - 110 ? 'end' : 'middle';
      const tx = anchor === 'start' ? Math.max(4, x - 8) : anchor === 'end' ? Math.min(W - 4, +x + 8) : x;
      s += `<g class="lab-ev" data-lab-ev="${i}"><line x1="${x}" x2="${x}" y1="${AY}" y2="${up ? ly + 6 : ly - 16}"/><circle cx="${x}" cy="${AY}" r="6"/>
        <text x="${tx}" y="${ly}" text-anchor="${anchor}"><tspan class="lab-ev-year">${esc(e.year)}</tspan><tspan x="${tx}" dy="1.15em">${esc(short)}</tspan></text></g>`;
    });
    s += `<g data-lab-now><line class="lab-tl-now" y1="${AY - 70}" y2="${AY + 70}"/><text class="lab-tl-nowtext" y="${AY - 76}" text-anchor="middle"></text></g></svg>
      <div class="lab-ev-card" data-lab-evcard aria-live="polite"></div>`;
    return s;
  }

  function paramLabel(lab, id) {
    const p = lab.params.find(x => x.id === id);
    return p ? p.label : id;
  }

  // ----- Rendering -----

  function render(el, data) {
    if (el) host = el;
    if (!host || !data) return;
    if (forData !== data) { stopLoop(); forData = data; activeId = null; mode = 'view'; cur = null; }
    const labs = data.labs || [];
    if (!labs.length || mode === 'setup' || busy) { stopLoop(); host.innerHTML = setupHtml(data); return; }
    if (!labs.some(l => l.id === activeId)) activeId = labs[0].id;
    const lab = labs.find(l => l.id === activeId);
    openLab(lab, labs);
  }

  function openLab(lab, labs) {
    stopLoop();
    const T = i18n.t;
    const keep = cur && cur.lab === lab;
    cur = {
      lab,
      rt: SimSpec.runtime(lab),
      values: keep ? cur.values : Object.fromEntries(lab.params.map(p => [p.id, p.value])),
      state: keep ? cur.state : { layout: lab.circuit ? lab.circuit.layout : null, off: {} },
      t: keep ? cur.t : 0,
      playing: false,
      touched: keep ? cur.touched : false
    };
    const stage = stageHtml(lab);
    const kindIcon = { graph: '&#128200;', motion: '&#9917;', circuit: '&#128267;', timeline: '&#128197;' }[lab.template];
    const sliders = lab.params.map(p => `<label class="lab-param">
        <span class="lab-param-top"><span class="lab-param-name">${esc(p.label)}</span><output data-lab-out="${esc(p.id)}"></output></span>
        <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${cur.values[p.id]}" data-lab-param="${esc(p.id)}" aria-label="${esc(p.label)}">
      </label>`).join('');
    const readouts = readoutDefs(lab).map((r, i) => `<div class="lab-readout${r.gauge ? ' has-gauge' : ''}">
        <span class="lab-readout-label">${esc(r.label)}</span><span class="lab-readout-val" data-lab-ro="${i}"></span>
        ${r.gauge ? `<span class="lab-gauge"><span data-lab-gauge="${i}"></span></span>` : ''}
      </div>`).join('');
    const bars = lab.bars ? `<div class="lab-bars">${lab.bars.map((b, i) => `<div class="lab-bar-row"><span class="lab-bar-label">${esc(b.label)}</span><span class="lab-bar-track"><span class="lab-bar-fill" data-lab-bar="${i}" style="background:${COLORS[i % 4]}"></span></span><span class="lab-bar-val" data-lab-barval="${i}"></span></div>`).join('')}</div>` : '';
    const chips = labs.map(l => `<button class="lab-chip${l === lab ? ' active' : ''}" data-lab-open="${esc(l.id)}" aria-pressed="${l === lab}">${esc(l.title)}${l.solved.length === l.challenges.length ? ' &#10003;' : ''}</button>`).join('');
    host.innerHTML = `<div class="lab-wrap">
      <div class="lab-tabs">${chips}<button class="lab-chip lab-chip-new" data-lab-act="new">+ ${T('labNew')}</button></div>
      <article class="lab" data-lab="${esc(lab.id)}">
        <header class="lab-head">
          <span class="lab-kind">${kindIcon} ${T('labTpl_' + lab.template)}</span>
          <h3 class="lab-title">${esc(lab.title)}</h3>
          ${lab.intro ? `<p class="lab-intro">${esc(lab.intro)}</p>` : ''}
        </header>
        ${lab.goal ? `<div class="lab-goal"><span class="lab-goal-icon" aria-hidden="true">&#127919;</span><div><strong>${T('labGoal')}</strong><p>${esc(lab.goal)}</p></div></div>` : ''}
        <div class="lab-main">
          <div class="lab-stage">${stage}</div>
          <div class="lab-side">
            <div class="lab-controls">${sliders}</div>
            ${readouts ? `<div class="lab-readouts">${readouts}</div>` : ''}
            ${bars}
          </div>
        </div>
        <div class="lab-challenges">
          <h4>${T('labChallenges')} <span class="lab-score" data-lab-score></span></h4>
          <ol>${lab.challenges.map((c, i) => `<li class="lab-ch" data-lab-ch="${i}">
            <span class="lab-ch-box" aria-hidden="true"></span>
            <span class="lab-ch-text">${esc(c.text)}${c.hint ? `<details class="lab-ch-hint"><summary>${T('labHint')}</summary>${esc(c.hint)}</details>` : ''}</span>
          </li>`).join('')}</ol>
        </div>
        <div class="lab-foot">
          <button class="btn-ghost" data-lab-act="reset">&#8634; ${T('labReset')}</button>
          <button class="btn-ghost" data-lab-act="delete">${T('labDelete')}</button>
        </div>
      </article>
    </div>`;
    update(true);
    if (lab.template === 'circuit') startLoop();
  }

  // Readouts: circuit built-ins, then the spec's derived values.
  function stageHtml(lab) {
    if (lab.template === 'graph') return graphStage(lab);
    if (lab.template === 'motion') return motionStage(lab);
    if (lab.template === 'circuit') return circuitStage(lab);
    return timelineStage(lab);
  }

  function readoutDefs(lab) {
    const T = i18n.t;
    const out = [];
    if (lab.circuit) out.push({ id: 'Req', label: T('labReq'), unit: 'Ω', digits: 2 }, { id: 'I', label: T('labCurrent'), unit: 'A', digits: 3 }, { id: 'P', label: T('labPower'), unit: 'W', digits: 2 });
    if (lab.timeline) out.push({ id: 'seen', label: T('labSeen'), unit: '/ ' + lab.timeline.events.length, digits: 0 });
    return out.concat(lab.derived);
  }

  function setupHtml(data) {
    const T = i18n.t;
    const has = (data.labs || []).length > 0;
    const starters = presets(data).map(p => `<button class="lab-starter" data-lab-preset="${esc(p.key)}">
        <span class="lab-starter-icon" aria-hidden="true">${p.icon}</span><span class="lab-starter-title">${esc(p.spec.title)}</span><span class="lab-starter-hint">${esc(T('labTpl_' + p.spec.template))}</span>
      </button>`).join('');
    return `<div class="lab-wrap lab-setup">
      <h3 class="lab-setup-title">&#129514; ${T('labsTitle')}</h3>
      <p class="lab-setup-text">${T('labsIntro')}</p>
      <div class="lab-setup-ai">
        <input type="text" class="editor-input" id="lab-focus" maxlength="200" placeholder="${esc(T('labFocusHolder'))}" ${busy ? 'disabled' : ''}>
        <button class="btn-primary" data-lab-act="generate" ${busy ? 'disabled' : ''}>${busy ? T('labBuilding') : '&#10024; ' + T('labGenerate')}</button>
      </div>
      <h4 class="lab-setup-sub">${T('labStarters')}</h4>
      <div class="lab-starters">${starters}</div>
      ${has ? `<button class="btn-ghost" data-lab-act="back">&larr; ${T('labBack')}</button>` : ''}
    </div>`;
  }

  // ----- Live update (called on every slider move, throttled to frames) -----

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; update(false); });
  }

  function update(first) {
    if (!cur || !host || !host.isConnected) return;
    const { lab, rt } = cur;
    const s = rt.scope(cur.values, cur.state);
    cur.scope = s;
    lab.params.forEach(p => {
      const o = host.querySelector(`[data-lab-out="${p.id}"]`);
      if (o) o.textContent = (lab.timeline && p.id === 'year' ? String(Math.round(cur.values[p.id])) : fmt(cur.values[p.id], stepDigits(p.step))) + (p.unit ? ' ' + p.unit : '');
    });
    readoutDefs(lab).forEach((r, i) => {
      const el = host.querySelector(`[data-lab-ro="${i}"]`);
      const v = s.get(r.id);
      if (el) el.textContent = fmt(v, r.digits) + (r.unit ? ' ' + r.unit : '');
      const g = r.gauge && host.querySelector(`[data-lab-gauge="${i}"]`);
      if (g) g.style.width = (Number.isFinite(v) ? Math.max(0, Math.min(1, (v - r.gauge.min) / (r.gauge.max - r.gauge.min))) * 100 : 0) + '%';
    });
    if (lab.bars) {
      const vals = rt.bars(s);
      if (first || !cur.barMax) {
        const all = [];
        combos(lab).forEach(c => all.push(...rt.bars(rt.scope(c, cur.state)).map(Math.abs)));
        cur.barMax = Math.max(1e-9, ...all.filter(Number.isFinite));
      }
      vals.forEach((v, i) => {
        const f = host.querySelector(`[data-lab-bar="${i}"]`), t = host.querySelector(`[data-lab-barval="${i}"]`);
        if (f) f.style.width = (Number.isFinite(v) ? Math.min(1, Math.abs(v) / cur.barMax) * 100 : 0) + '%';
        if (t) t.textContent = fmt(v, 2);
      });
    }
    if (lab.template === 'graph') drawGraph(s);
    else if (lab.template === 'motion') drawMotion(s);
    else if (lab.template === 'circuit') drawCircuit(s);
    else drawTimeline(s);
    checkChallenges(s, first);
  }

  function pathFrom(points) {
    const { sx, sy, yr } = cur.map;
    const span = yr[1] - yr[0];
    let d = '', pen = false, prev = null;
    points.forEach(p => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y > yr[1] + span * 4 || p.y < yr[0] - span * 4) { pen = false; prev = null; return; }
      // Break the line at jumps (asymptotes, e.g. tan x).
      if (prev && Math.abs(p.y - prev.y) > span * 1.5) pen = false;
      d += (pen ? 'L' : 'M') + sx(p.x).toFixed(1) + ',' + sy(p.y).toFixed(1);
      pen = true; prev = p;
    });
    return d;
  }

  function drawGraph(s) {
    const { lab, rt } = cur, { xr } = cur.map;
    const N = 180;
    lab.graph.curves.forEach((_, i) => {
      const pts = [];
      for (let k = 0; k <= N; k++) { const x = xr[0] + (xr[1] - xr[0]) * k / N; pts.push({ x, y: rt.curveAt(i, x, s) }); }
      const el = host.querySelector(`[data-lab-curve="${i}"]`);
      if (el) el.setAttribute('d', pathFrom(pts));
    });
    const mg = host.querySelector('[data-lab-marker]');
    if (mg) {
      const m = rt.marker(s), { sx, sy, yr } = cur.map;
      const ok = m && Number.isFinite(m.x) && Number.isFinite(m.y) && m.x >= xr[0] && m.x <= xr[1] && m.y >= yr[0] && m.y <= yr[1];
      mg.style.display = ok ? '' : 'none';
      if (ok) {
        const X = sx(m.x).toFixed(1), Y = sy(m.y).toFixed(1);
        const c = mg.querySelector('circle'), t = mg.querySelector('text');
        c.setAttribute('cx', X); c.setAttribute('cy', Y); t.setAttribute('x', X); t.setAttribute('y', Y);
        const gx = mg.querySelector('[data-lab-mx]'), gy = mg.querySelector('[data-lab-my]');
        gx.setAttribute('x1', X); gx.setAttribute('x2', X); gx.setAttribute('y1', Y); gx.setAttribute('y2', H - PAD.b);
        gy.setAttribute('x1', PAD.l); gy.setAttribute('x2', X); gy.setAttribute('y1', Y); gy.setAttribute('y2', Y);
      }
    }
  }

  function drawMotion(s) {
    const { lab, rt } = cur, { sx, sy } = cur.map;
    const te = tEndOf(s);
    const N = 120, pts = [];
    for (let k = 0; k <= N; k++) pts.push(rt.motionAt(te * k / N, s));
    const t = Math.min(cur.t, te);
    const trail = host.querySelector('[data-lab-trail]');
    if (trail) trail.setAttribute('d', pathFrom(pts));
    const done = host.querySelector('[data-lab-done]');
    if (done) done.setAttribute('d', lab.motion.kind === 'path' ? pathFrom(pts.filter((_, k) => te * k / N <= t).concat([rt.motionAt(t, s)])) : '');
    const p = rt.motionAt(t, s);
    const ball = host.querySelector('[data-lab-ball]');
    if (ball && Number.isFinite(p.x) && Number.isFinite(p.y)) { ball.setAttribute('cx', sx(p.x).toFixed(1)); ball.setAttribute('cy', sy(p.y).toFixed(1)); }
    const rod = host.querySelector('[data-lab-rod]');
    if (rod && Number.isFinite(p.x)) { rod.setAttribute('x1', sx(0)); rod.setAttribute('y1', sy(0)); rod.setAttribute('x2', sx(p.x).toFixed(1)); rod.setAttribute('y2', sy(p.y).toFixed(1)); }
    const ti = host.querySelector('[data-lab-time]');
    if (ti && document.activeElement !== ti) ti.value = String(Math.round(t / te * 1000));
    const to = host.querySelector('[data-lab-tout]');
    if (to) to.textContent = `t = ${fmt(t, 2)} s`;
  }

  function drawCircuit(s) {
    const c = cur.lab.circuit;
    const V = s.get(c.source);
    let pMax = 0;
    c.resistors.forEach(id => { pMax = Math.max(pMax, s.get('P_' + id)); });
    // Brightness relative to the hottest a resistor gets at the defaults,
    // so turning the voltage up visibly brightens everything.
    if (!cur.pRef) {
      const d = cur.rt.scope(null, { layout: 'parallel', off: {} });
      cur.pRef = Math.max(1e-9, ...c.resistors.map(id => d.get('P_' + id)));
    }
    c.resistors.forEach((id, i) => {
      const g = host.querySelector(`[data-lab-glow="${i}"]`);
      if (g) g.style.opacity = String(Math.min(0.85, s.get('P_' + id) / cur.pRef * 0.85));
      const t = host.querySelector(`[data-lab-rval="${i}"]`);
      if (t) t.textContent = `${fmt(s.get('I_' + id), 2)} A`;
      const rl = host.querySelector(`[data-lab-rlabel="${i}"]`);
      if (rl) rl.textContent = `${paramLabel(cur.lab, id)} · ${fmt(s.get(id), 1)} Ω`;
    });
    const vl = host.querySelector('[data-lab-vlabel]');
    if (vl) vl.textContent = `${fmt(V, 1)} V`;
    cur.speeds = { main: s.get('I') };
    c.resistors.forEach((id, i) => { cur.speeds[i] = (cur.state.layout || c.layout) === 'parallel' ? s.get('I_' + id) : s.get('I'); });
  }

  function drawTimeline(s) {
    const { lab } = cur, { sx } = cur.map;
    const y = s.get('year'), ev = lab.timeline.events;
    const X = sx(y).toFixed(1);
    const now = host.querySelector('[data-lab-now]');
    if (now) {
      const l = now.querySelector('line'), t = now.querySelector('text');
      l.setAttribute('x1', X); l.setAttribute('x2', X); t.setAttribute('x', X); t.textContent = String(Math.round(y));
    }
    const bar = host.querySelector('[data-lab-tlbar]');
    if (bar) bar.setAttribute('x2', X);
    let last = -1;
    ev.forEach((e, i) => {
      const el = host.querySelector(`[data-lab-ev="${i}"]`);
      const on = e.year <= y;
      if (on) last = i;
      if (el) el.classList.toggle('on', on);
    });
    const card = host.querySelector('[data-lab-evcard]');
    if (card) {
      const key = String(last);
      if (card.dataset.ev !== key) {
        card.dataset.ev = key;
        card.innerHTML = last < 0 ? `<p class="lab-hint">${esc(i18n.t('labTimelineStart'))}</p>`
          : `<span class="lab-ev-cyear">${esc(ev[last].year)}</span><strong>${esc(ev[last].label)}</strong>${ev[last].detail ? `<p>${esc(ev[last].detail)}</p>` : ''}`;
      }
    }
  }

  // ----- Challenges -----

  function checkChallenges(s, first) {
    const { lab, rt } = cur;
    const res = rt.checks(s);
    let newly = -1;
    res.forEach((ok, i) => {
      // Only count a challenge once the student has actually experimented.
      if (ok && cur.touched && !lab.solved.includes(i)) { lab.solved.push(i); newly = i; }
      const li = host.querySelector(`[data-lab-ch="${i}"]`);
      if (li) {
        li.classList.toggle('done', lab.solved.includes(i));
        li.classList.toggle('live', ok);
      }
    });
    const score = host.querySelector('[data-lab-score]');
    if (score) score.textContent = `${lab.solved.length}/${lab.challenges.length}`;
    if (newly >= 0 && !first) {
      const li = host.querySelector(`[data-lab-ch="${newly}"]`);
      if (li) { li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop'); }
      const all = lab.solved.length === lab.challenges.length;
      App.showToast(i18n.t(all ? 'labAllDone' : 'labChallengeDone'), 'success');
      if (all && typeof FX !== 'undefined') FX.celebrate();
      if (typeof Sound !== 'undefined' && Sound.play) { try { Sound.play('correct'); } catch (e) {} }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => App.persistActiveDeck(), 400);
    }
  }

  // ----- Animation loops -----

  function stopLoop() {
    if (loopRaf) cancelAnimationFrame(loopRaf);
    loopRaf = 0;
    if (cur) cur.playing = false;
  }

  function startLoop() {
    if (loopRaf) return;
    let last = performance.now();
    const offsets = {};
    const tick = now => {
      loopRaf = 0;
      if (!cur || !host || !host.isConnected || host.offsetParent === null) { if (cur) cur.playing = false; return; }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (cur.lab.template === 'circuit') {
        const ref = cur.iRef || (cur.iRef = Math.max(1e-6, Math.abs(cur.rt.scope(null, { layout: 'series', off: {} }).get('I'))));
        host.querySelectorAll('[data-lab-flow]').forEach(el => {
          const k = el.dataset.labFlow;
          const I = Math.abs((cur.speeds || {})[k] || 0);
          const v = I > 0 ? 40 + 120 * Math.min(1, I / (ref * 4)) : 0;
          offsets[k] = ((offsets[k] || 0) - v * dt) % 1000;
          el.style.strokeDashoffset = offsets[k].toFixed(1);
          el.style.opacity = I > 0 ? '1' : '0';
        });
        if (!FX.reduced()) loopRaf = requestAnimationFrame(tick);
        return;
      }
      if (cur.lab.template === 'motion' && cur.playing) {
        const te = tEndOf(cur.scope || cur.rt.scope(cur.values, cur.state));
        const speed = te / Math.max(1.5, Math.min(6, te)); // long flights play faster than real time
        cur.t += dt * speed;
        if (cur.t >= te) {
          if (cur.lab.motion.kind === 'pendulum') cur.t %= te;
          else { cur.t = te; cur.playing = false; }
        }
        update(false);
        syncPlay();
        if (cur.playing) loopRaf = requestAnimationFrame(tick);
      }
    };
    loopRaf = requestAnimationFrame(tick);
  }

  function syncPlay() {
    const b = host && host.querySelector('[data-lab-act="play"], [data-lab-act="pause"]');
    if (!b || !cur) return;
    b.dataset.labAct = cur.playing ? 'pause' : 'play';
    b.innerHTML = cur.playing ? '&#10074;&#10074;' : '&#9654;';
    b.setAttribute('aria-label', i18n.t(cur.playing ? 'labPause' : 'labPlay'));
  }

  // ----- Starter labs (offline, no AI) -----

  function presets(data) {
    const T = i18n.t;
    const list = [
      { key: 'projectile', icon: '&#9917;', spec: {
        template: 'motion', title: T('labPreProjTitle'), intro: T('labPreProjIntro'), goal: T('labPreProjGoal'),
        params: [{ id: 'v', label: T('labPreSpeed'), min: 5, max: 40, step: 1, value: 20, unit: 'm/s' }, { id: 'a', label: T('labPreAngle'), min: 5, max: 85, step: 1, value: 30, unit: '°' }, { id: 'g', label: T('labPreGravity'), min: 1.6, max: 25, step: 0.1, value: 9.8, unit: 'm/s²' }],
        derived: [{ id: 'T', label: T('labPreFlight'), expr: '2*v*sin(rad(a))/g', unit: 's', digits: 2 }, { id: 'R', label: T('labPreRange'), expr: 'v^2*sin(2*rad(a))/g', unit: 'm', digits: 1 }, { id: 'Hm', label: T('labPreHeight'), expr: '(v*sin(rad(a)))^2/(2*g)', unit: 'm', digits: 1 }],
        motion: { kind: 'path', x: 'v*cos(rad(a))*t', y: 'v*sin(rad(a))*t - g/2*t^2', tEnd: 'T' },
        challenges: [{ text: T('labPreProjC1'), check: 'abs(R-30) < 0.5', hint: T('labPreProjH1') }, { text: T('labPreProjC2'), check: 'abs(a-45) < 0.5 and abs(g-9.8) < 0.05', hint: T('labPreProjH2') }, { text: T('labPreProjC3'), check: 'g < 1.7 and T > 10', hint: T('labPreProjH3') }]
      } },
      { key: 'pendulum', icon: '&#9203;', spec: {
        template: 'motion', title: T('labPrePendTitle'), intro: T('labPrePendIntro'), goal: T('labPrePendGoal'),
        params: [{ id: 'L', label: T('labPreLength'), min: 0.1, max: 4, step: 0.05, value: 1, unit: 'm' }, { id: 'th', label: T('labPreSwing'), min: 5, max: 60, step: 1, value: 20, unit: '°' }, { id: 'g', label: T('labPreGravity'), min: 1.6, max: 25, step: 0.1, value: 9.8, unit: 'm/s²' }],
        derived: [{ id: 'T', label: T('labPrePeriod'), expr: '2*pi*sqrt(L/g)', unit: 's', digits: 2 }, { id: 'f', label: T('labPreFreq'), expr: '1/T', unit: 'Hz', digits: 2 }],
        motion: { kind: 'pendulum', x: 'L*sin(rad(th)*cos(2*pi*t/T))', y: '-L*cos(rad(th)*cos(2*pi*t/T))', tEnd: '2*T' },
        challenges: [{ text: T('labPrePendC1'), check: 'abs(T-1) < 0.02', hint: T('labPrePendH1') }, { text: T('labPrePendC2'), check: 'abs(T-4.01) < 0.05 and abs(g-9.8) < 0.05', hint: T('labPrePendH2') }, { text: T('labPrePendC3'), check: 'g < 1.7 and abs(T-3) < 0.05', hint: T('labPrePendH3') }]
      } },
      { key: 'circuit', icon: '&#128161;', spec: {
        template: 'circuit', title: T('labPreCircTitle'), intro: T('labPreCircIntro'), goal: T('labPreCircGoal'),
        params: [{ id: 'V', label: T('labPreVoltage'), min: 1, max: 24, step: 1, value: 12, unit: 'V' }, { id: 'R1', label: 'R1', min: 1, max: 100, step: 1, value: 10, unit: 'Ω' }, { id: 'R2', label: 'R2', min: 1, max: 100, step: 1, value: 20, unit: 'Ω' }, { id: 'R3', label: 'R3', min: 1, max: 100, step: 1, value: 30, unit: 'Ω' }],
        circuit: { source: 'V', resistors: ['R1', 'R2', 'R3'], layout: 'series' },
        challenges: [{ text: T('labPreCircC1'), check: 'series == 1 and abs(I-1) < 0.01', hint: T('labPreCircH1') }, { text: T('labPreCircC2'), check: 'series == 0 and Req < 5 and on_R1 and on_R2 and on_R3', hint: T('labPreCircH2') }, { text: T('labPreCircC3'), check: 'series == 1 and I == 0', hint: T('labPreCircH3') }]
      } },
      { key: 'market', icon: '&#128202;', spec: {
        template: 'graph', title: T('labPreMktTitle'), intro: T('labPreMktIntro'), goal: T('labPreMktGoal'),
        params: [{ id: 'a', label: T('labPreDemandLvl'), min: 20, max: 100, step: 1, value: 60, unit: '' }, { id: 'b', label: T('labPreDemandSlope'), min: 0.5, max: 5, step: 0.1, value: 2, unit: '' }, { id: 'c', label: T('labPreSupplyLvl'), min: 0, max: 40, step: 1, value: 10, unit: '' }, { id: 'd', label: T('labPreSupplySlope'), min: 0.5, max: 5, step: 0.1, value: 1.5, unit: '' }],
        derived: [{ id: 'Q', label: T('labPreEqQ'), expr: '(a-c)/(b+d)', digits: 1 }, { id: 'Pe', label: T('labPreEqP'), expr: 'a - b*Q', digits: 1 }],
        graph: { x: { min: 0, max: 50, label: T('labPreQty') }, y: { min: 0, max: 100, label: T('labPrePrice') }, curves: [{ expr: 'a - b*x', label: T('labPreDemand') }, { expr: 'c + d*x', label: T('labPreSupply') }], marker: { x: 'Q', y: 'Pe', label: T('labPreEq') } },
        challenges: [{ text: T('labPreMktC1'), check: 'Pe > 50', hint: T('labPreMktH1') }, { text: T('labPreMktC2'), check: 'abs(Q-20) < 0.3', hint: T('labPreMktH2') }]
      } },
      { key: 'growth', icon: '&#127793;', spec: {
        template: 'graph', title: T('labPreGrowTitle'), intro: T('labPreGrowIntro'), goal: T('labPreGrowGoal'),
        params: [{ id: 'r', label: T('labPreRate'), min: 0.05, max: 1, step: 0.01, value: 0.3, unit: '' }, { id: 'K', label: T('labPreCapacity'), min: 100, max: 1000, step: 10, value: 500, unit: '' }, { id: 'N0', label: T('labPreStart'), min: 1, max: 100, step: 1, value: 10, unit: '' }],
        derived: [{ id: 'dbl', label: T('labPreDouble'), expr: 'ln(2)/r', unit: T('labPreYears'), digits: 1 }, { id: 'half', label: T('labPreHalfK'), expr: 'if(N0 < K/2, ln(K/N0-1)/r, 0)', unit: T('labPreYears'), digits: 1 }],
        graph: { x: { min: 0, max: 30, label: T('labPreTimeYears') }, y: { min: 0, max: 1200, label: 'N' }, curves: [{ expr: 'N0*exp(r*x)', label: T('labPreExp') }, { expr: 'K/(1+(K/N0-1)*exp(-r*x))', label: T('labPreLogistic') }] },
        challenges: [{ text: T('labPreGrowC1'), check: 'abs(dbl-5) < 0.15', hint: T('labPreGrowH1') }, { text: T('labPreGrowC2'), check: 'half > 0 and half < 8', hint: T('labPreGrowH2') }]
      } },
      { key: 'wave', icon: '&#12336;&#65039;', spec: {
        template: 'graph', title: T('labPreWaveTitle'), intro: T('labPreWaveIntro'), goal: T('labPreWaveGoal'),
        params: [{ id: 'A', label: 'a', min: -4, max: 4, step: 0.1, value: 1, unit: '' }, { id: 'b', label: 'b', min: 0.2, max: 4, step: 0.1, value: 1, unit: '' }, { id: 'c', label: 'c', min: -3.14, max: 3.14, step: 0.02, value: 0, unit: '' }, { id: 'k', label: 'k', min: -3, max: 3, step: 0.1, value: 0, unit: '' }],
        derived: [{ id: 'per', label: T('labPrePeriod'), expr: '2*pi/b', digits: 2 }, { id: 'amp', label: T('labPreAmp'), expr: 'abs(A)', digits: 1 }],
        graph: { x: { min: -6.28, max: 6.28, label: 'x' }, y: { min: -7, max: 7, label: 'y' }, curves: [{ expr: 'A*sin(b*x + c) + k', label: 'y = a·sin(bx + c) + k' }, { expr: 'sin(x)', label: 'y = sin x' }] },
        challenges: [{ text: T('labPreWaveC1'), check: 'abs(per - pi) < 0.05', hint: T('labPreWaveH1') }, { text: T('labPreWaveC2'), check: 'A < 0', hint: T('labPreWaveH2') }, { text: T('labPreWaveC3'), check: 'abs(k-2) < 0.05 and abs(A) >= 2', hint: T('labPreWaveH3') }]
      } }
    ];
    const tl = timelineFromNotes(data);
    if (tl) list.push({ key: 'timeline', icon: '&#128197;', spec: tl });
    return list;
  }

  // Dated lines in the notes ("1453 – Fall of Constantinople") become a
  // scrubbable timeline.
  function timelineFromNotes(data) {
    const T = i18n.t;
    const lines = ((data.notes && data.notes.importantDates) || []).slice(0, 30);
    const events = [];
    lines.forEach(l => {
      const m = /(^|[^\d])(-?\d{3,4})(?!\d)/.exec(l);
      if (!m) return;
      const label = l.replace(m[2], '').replace(/^[\s:–—\-,.()]+|[\s:–—\-,.()]+$/g, '').trim() || l;
      events.push({ year: Number(m[2]), label: label.slice(0, 80), detail: l });
    });
    if (events.length < 2) return null;
    events.sort((a, b) => a.year - b.year);
    const n = events.length;
    return {
      template: 'timeline', title: T('labPreTlTitle'), intro: T('labPreTlIntro'), goal: T('labPreTlGoal'),
      params: [], timeline: { events, label: T('labPreYear') },
      challenges: [
        { text: T('labPreTlC1', { label: events[0].label }), check: 'seen >= 1', hint: '' },
        { text: T('labPreTlC2'), check: `seen >= ${Math.ceil(n / 2)}`, hint: '' },
        { text: T('labPreTlC3'), check: `seen == ${n}`, hint: '' }
      ]
    };
  }

  // ----- AI -----

  function prompt(focus) {
    return 'Design 1-2 small interactive simulations ("labs") that let a student learn the most important idea(s) of this study material by experimenting. ' +
      'Pick ideas that really change when a quantity changes. Each lab uses exactly ONE template: ' +
      '"graph" (curves y = f(x) that change with sliders: functions, supply/demand, growth, concentration vs time, equilibrium...), ' +
      '"motion" (an object at position x(t), y(t) in metres: projectile, free fall, pendulum (kind "pendulum": pivot at 0,0, give the bob position)...), ' +
      '"circuit" (a battery and 2-3 resistors; the student can rewire series/parallel and open switches; built-in values: Req, I, P, series (1 or 0), I_R1, V_R1, P_R1, on_R1 for each resistor id), ' +
      '"timeline" (dated events from history; the built-in slider is "year" and "seen" counts events reached). ' +
      'Formulas are plain maths only: numbers, slider/derived ids, + - * / ^ ( ), sin cos tan asin acos atan sqrt ln exp abs min max floor round if(cond,a,b) rad(deg) deg(rad), pi, e, comparisons < <= > >= == and the words and/or/not. ' +
      'Trig uses radians: wrap degrees with rad(). Write every multiplication with *. Ids are short letters/digits (not x, t, e or function names). ' +
      'Give 2-4 sliders with realistic min/max/step and units, 1-3 derived readouts, and 2-3 challenges whose "check" formula is reachable within the slider ranges (use abs(q-target) < tolerance, not ==, for continuous values). ' +
      'The goal is an open question the student answers by experimenting (e.g. "Make the period double - what did you change?"). ' +
      'Write all text in the language of the material. ' +
      (focus ? `Focus on: ${focus}. ` : '') +
      'Return ONLY JSON, no other text: {"labs":[{"template":"motion","title":"...","intro":"1-2 sentences","goal":"...",' +
      '"params":[{"id":"L","label":"Length","min":0.1,"max":4,"step":0.05,"value":1,"unit":"m"}],' +
      '"derived":[{"id":"T","label":"Period","expr":"2*pi*sqrt(L/9.8)","unit":"s","digits":2}],' +
      '"motion":{"kind":"pendulum","x":"L*sin(0.3*cos(2*pi*t/T))","y":"-L*cos(0.3*cos(2*pi*t/T))","tEnd":"2*T"},' +
      '"challenges":[{"text":"Make the period exactly 3 s","check":"abs(T-3) < 0.05","hint":"..."}]}]} ' +
      'Include only the block of the chosen template: "graph":{"x":{"min":0,"max":10,"label":"..."},"y":{"label":"..."},"curves":[{"expr":"a*x^2","label":"..."}],"marker":{"x":"formula","y":"formula","label":"..."}} (marker optional), ' +
      '"circuit":{"source":"V","resistors":["R1","R2"],"layout":"series"}, "timeline":{"events":[{"year":1453,"label":"...","detail":"..."}]}. ' +
      'Optional "bars":[{"label":"...","expr":"..."}] compares quantities as bars (e.g. reactant vs product amounts).';
  }

  async function generate() {
    const data = App.getStudyData();
    if (!data || busy) return;
    const focusEl = host && host.querySelector('#lab-focus');
    const focus = focusEl ? focusEl.value.trim().slice(0, 200) : '';
    busy = true;
    refresh();
    try {
      const raw = await API.chat(prompt(focus), App.getOriginalText());
      const obj = Parser.safeParseJSON(raw);
      const list = obj && Array.isArray(obj.labs) ? obj.labs : obj && obj.template ? [obj] : [];
      if (App.getStudyData() !== data) return;
      const now = Date.now();
      const labs = SimSpec.sanitizeLabs(list.map(l => ({ ...l, id: undefined, createdAt: now })));
      if (!labs.length) throw new Error(i18n.t('labInvalid'));
      add(data, labs);
      App.showToast(i18n.t('labReady'), 'success');
    } catch (err) {
      App.showToast(i18n.t('labFailed') + ' ' + err.message, 'error');
    } finally {
      busy = false;
      refresh();
    }
  }

  function add(data, labs) {
    const existing = data.labs || [];
    const ids = new Set(existing.map(l => l.id));
    labs.forEach((l, i) => { let id = l.id, k = existing.length + i + 1; while (ids.has(id)) id = 'lab' + (k++); l.id = id; ids.add(id); });
    data.labs = existing.concat(labs).slice(-8);
    App.persistActiveDeck();
    activeId = labs[0].id;
    mode = 'view';
  }

  function addPreset(key) {
    const data = App.getStudyData();
    if (!data) return;
    const p = presets(data).find(x => x.key === key);
    const lab = p && SimSpec.sanitizeLab({ ...p.spec, id: key, createdAt: Date.now() });
    if (!lab) return;
    add(data, [lab]);
    refresh();
  }

  function refresh() {
    const data = App.getStudyData();
    if (data && host && host.isConnected) render(null, data);
  }

  // ----- Events -----

  function init() {
    document.addEventListener('input', e => {
      if (!host || !cur || !host.contains(e.target)) return;
      const p = e.target.closest('[data-lab-param]');
      if (p) {
        cur.values[p.dataset.labParam] = parseFloat(p.value);
        cur.touched = true;
        schedule();
        return;
      }
      const t = e.target.closest('[data-lab-time]');
      if (t && cur.lab.motion) {
        cur.playing = false;
        syncPlay();
        cur.t = tEndOf(cur.scope) * (+t.value / 1000);
        schedule();
      }
    });
    // Slider released: refit the axes if the picture left the frame.
    document.addEventListener('change', e => {
      if (!host || !cur || !host.contains(e.target) || !e.target.closest('[data-lab-param]')) return;
      if (needsRefit()) redrawStage();
    });
    const toggleSwitch = sw => {
      const id = sw.dataset.labSwitch;
      cur.state.off[id] = !cur.state.off[id];
      cur.touched = true;
      redrawStage();
    };
    document.addEventListener('keydown', e => {
      if (!host || !cur || !host.contains(e.target)) return;
      const sw = e.target.closest('[data-lab-switch]');
      if (sw && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSwitch(sw); }
    });
    document.addEventListener('click', e => {
      if (!host || !host.contains(e.target)) return;
      const pre = e.target.closest('[data-lab-preset]');
      if (pre) { addPreset(pre.dataset.labPreset); return; }
      const open = e.target.closest('[data-lab-open]');
      if (open) { activeId = open.dataset.labOpen; mode = 'view'; cur = null; refresh(); return; }
      const sw = e.target.closest('[data-lab-switch]');
      if (sw && cur) { toggleSwitch(sw); return; }
      const lay = e.target.closest('[data-lab-layout]');
      if (lay && cur) { cur.state.layout = lay.dataset.labLayout; cur.touched = true; redrawStage(); return; }
      const btn = e.target.closest('[data-lab-act]');
      if (!btn) return;
      const act = btn.dataset.labAct;
      const data = App.getStudyData();
      if (act === 'generate') generate();
      else if (act === 'new') { stopLoop(); mode = 'setup'; refresh(); }
      else if (act === 'back') { mode = 'view'; refresh(); }
      else if (act === 'play' && cur) {
        const te = tEndOf(cur.scope);
        if (cur.t >= te - 1e-9 && cur.lab.motion.kind === 'path') cur.t = 0;
        cur.playing = true;
        syncPlay();
        startLoop();
      }
      else if (act === 'pause' && cur) { cur.playing = false; syncPlay(); }
      else if (act === 'reset' && cur) {
        cur.lab.solved = [];
        App.persistActiveDeck();
        cur = null;
        refresh();
      }
      else if (act === 'delete' && data && cur) {
        if (!confirm(i18n.t('labDeleteConfirm'))) return;
        const id = cur.lab.id;
        stopLoop();
        data.labs = (data.labs || []).filter(l => l.id !== id);
        if (!data.labs.length) delete data.labs;
        App.persistActiveDeck();
        cur = null; activeId = null;
        refresh();
      }
    });
  }

  // Rebuild only the stage (rewiring changes the schematic; refitting
  // changes the axes), keeping the live values.
  function redrawStage() {
    const stageEl = host && host.querySelector('.lab-stage');
    if (!stageEl || !cur) return;
    const wasPlaying = cur.playing;
    stopLoop();
    stageEl.innerHTML = stageHtml(cur.lab);
    update(false);
    if (cur.lab.template === 'circuit' || wasPlaying) { cur.playing = wasPlaying; syncPlay(); startLoop(); }
  }

  function stop() { stopLoop(); }

  return { init, render, stop, presets, fmt, _state: () => cur };
})();

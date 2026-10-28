// ===== Simulation specs (pure, no DOM) =====
// Labs are declarative: the AI fills in a small JSON spec (template, sliders,
// formulas, challenges) and our own renderer (js/labs.js) draws it. Formulas
// are parsed by the tiny expression language below — no eval/Function, only
// numbers, whitelisted names, + - * / ^ %, comparisons, and/or/not and a fixed
// set of math functions. Also sanitizes video-lesson storyboards.
const SimSpec = (() => {
  const MAX_EXPR = 300, MAX_NODES = 160, MAX_DEPTH = 24;
  const TEMPLATES = ['graph', 'motion', 'circuit', 'timeline'];
  const CONSTS = { pi: Math.PI, e: Math.E };
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // name: [minArgs, maxArgs, fn]
  const FUNCS = {
    sin: [1, 1, Math.sin], cos: [1, 1, Math.cos], tan: [1, 1, Math.tan],
    asin: [1, 1, Math.asin], acos: [1, 1, Math.acos], atan: [1, 1, Math.atan], atan2: [2, 2, Math.atan2],
    sinh: [1, 1, Math.sinh], cosh: [1, 1, Math.cosh], tanh: [1, 1, Math.tanh],
    sqrt: [1, 1, Math.sqrt], cbrt: [1, 1, Math.cbrt],
    log: [1, 1, Math.log], ln: [1, 1, Math.log], log10: [1, 1, Math.log10], log2: [1, 1, Math.log2], exp: [1, 1, Math.exp],
    abs: [1, 1, Math.abs], floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], round: [1, 1, Math.round], sign: [1, 1, Math.sign],
    min: [1, 8, Math.min], max: [1, 8, Math.max], pow: [2, 2, Math.pow], hypot: [1, 4, Math.hypot],
    clamp: [3, 3, clampN],
    rad: [1, 1, d => d * Math.PI / 180], deg: [1, 1, r => r * 180 / Math.PI],
    if: [3, 3, null] // lazy, handled by the compiler
  };
  const WORDS = { and: '&&', or: '||', not: '!' };
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'true', 'false', 'x', 't', ...Object.keys(WORDS), ...Object.keys(CONSTS), ...Object.keys(FUNCS)]);
  const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

  // ----- Expression language -----

  function tokenize(src) {
    const s = String(src).replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (num) { out.push({ k: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (id) {
        const w = id[0];
        if (Object.prototype.hasOwnProperty.call(WORDS, w)) out.push({ k: 'op', v: WORDS[w] });
        else out.push({ k: 'id', v: w });
        i += w.length; continue;
      }
      const two = s.slice(i, i + 2);
      if (['<=', '>=', '==', '!=', '&&', '||', '**'].includes(two)) { out.push({ k: 'op', v: two === '**' ? '^' : two }); i += 2; continue; }
      if ('+-*/^%(),<>!'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
      throw new Error('Unexpected character "' + c + '"');
    }
    return out;
  }

  // Recursive descent: or > and > comparison > additive > multiplicative >
  // unary > power (right-assoc, so -x^2 = -(x^2)) > primary.
  function parse(src) {
    if (typeof src !== 'string' && typeof src !== 'number') throw new Error('Not a formula');
    src = String(src);
    if (!src.trim()) throw new Error('Empty formula');
    if (src.length > MAX_EXPR) throw new Error('Formula too long');
    const toks = tokenize(src);
    let pos = 0, nodes = 0;
    const peek = () => toks[pos];
    const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
    const node = (n, depth) => {
      if (++nodes > MAX_NODES) throw new Error('Formula too complex');
      if (depth > MAX_DEPTH) throw new Error('Formula nested too deeply');
      return n;
    };
    // `depth` counts real nesting (brackets, calls, unary/power chains), not
    // precedence levels.
    const binary = (next, ops) => depth => {
      let a = next(depth);
      while (peek() && peek().k === 'op' && ops.includes(peek().v)) {
        const op = toks[pos++].v;
        a = node({ t: 'bin', op, a, b: next(depth) }, depth);
      }
      return a;
    };
    const primary = depth => {
      const tk = toks[pos++];
      if (!tk) throw new Error('Unexpected end of formula');
      if (tk.k === 'num') {
        if (!Number.isFinite(tk.v)) throw new Error('Bad number');
        // Implicit multiplication after a number: 2x, 2pi, 3(x+1)
        const n = node({ t: 'num', v: tk.v }, depth);
        if (peek() && (peek().k === 'id' || (peek().k === 'op' && peek().v === '('))) return node({ t: 'bin', op: '*', a: n, b: power(depth + 1) }, depth);
        return n;
      }
      if (tk.k === 'id') {
        if (isOp('(')) {
          if (!Object.prototype.hasOwnProperty.call(FUNCS, tk.v)) throw new Error('Unknown function "' + tk.v + '"');
          pos++;
          const args = [];
          if (!isOp(')')) {
            args.push(or(depth + 1));
            while (isOp(',')) { pos++; args.push(or(depth + 1)); }
          }
          if (!isOp(')')) throw new Error('Missing ")"');
          pos++;
          const [lo, hi] = FUNCS[tk.v];
          if (args.length < lo || args.length > hi) throw new Error('Wrong number of arguments for ' + tk.v);
          return node({ t: 'call', f: tk.v, args }, depth);
        }
        return node({ t: 'var', n: tk.v }, depth);
      }
      if (tk.v === '(') {
        const inner = or(depth + 1);
        if (!isOp(')')) throw new Error('Missing ")"');
        pos++;
        return inner;
      }
      throw new Error('Unexpected "' + tk.v + '"');
    };
    const power = depth => {
      const base = primary(depth);
      if (isOp('^')) { pos++; return node({ t: 'bin', op: '^', a: base, b: unary(depth + 1) }, depth); }
      return base;
    };
    const unary = depth => {
      if (isOp('-') || isOp('+') || isOp('!')) { const op = toks[pos++].v; return node({ t: 'un', op, a: unary(depth + 1) }, depth); }
      return power(depth);
    };
    const mul = binary(unary, ['*', '/', '%']);
    const add = binary(mul, ['+', '-']);
    const cmp = binary(add, ['<', '<=', '>', '>=', '==', '!=']);
    const and = binary(cmp, ['&&']);
    const or = binary(and, ['||']);
    const ast = or(0);
    if (pos < toks.length) throw new Error('Unexpected "' + toks[pos].v + '"');
    return ast;
  }

  const BIN = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
    '%': (a, b) => a % b, '^': (a, b) => Math.pow(a, b),
    '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b),
    // Equality with a small relative tolerance: sliders land on floats.
    '==': (a, b) => +(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))),
    '!=': (a, b) => +(Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)))
  };

  // Build a closure tree from the AST. `vars` is the whitelist of names the
  // formula may read; anything else is rejected here, before it ever runs.
  function build(ast, vars, used) {
    switch (ast.t) {
      case 'num': { const v = ast.v; return () => v; }
      case 'var': {
        const n = ast.n;
        if (Object.prototype.hasOwnProperty.call(CONSTS, n)) { const v = CONSTS[n]; return () => v; }
        if (!vars.has(n)) throw new Error('Unknown name "' + n + '"');
        used.add(n);
        return scope => { const v = scope.get(n); return typeof v === 'number' ? v : NaN; };
      }
      case 'un': {
        const a = build(ast.a, vars, used);
        if (ast.op === '-') return s => -a(s);
        if (ast.op === '!') return s => +!a(s);
        return a;
      }
      case 'bin': {
        const a = build(ast.a, vars, used), b = build(ast.b, vars, used);
        if (ast.op === '&&') return s => +(!!a(s) && !!b(s));
        if (ast.op === '||') return s => +(!!a(s) || !!b(s));
        const f = BIN[ast.op];
        return s => f(a(s), b(s));
      }
      case 'call': {
        const args = ast.args.map(x => build(x, vars, used));
        if (ast.f === 'if') { const [c, y, n] = args; return s => (c(s) ? y(s) : n(s)); }
        const fn = FUNCS[ast.f][2];
        if (args.length === 1) { const a = args[0]; return s => fn(a(s)); }
        if (args.length === 2) { const [a, b] = args; return s => fn(a(s), b(s)); }
        return s => fn(...args.map(g => g(s)));
      }
    }
    throw new Error('Bad formula');
  }

  // compile('a*x^2', ['a','x']) → { ok, fn(scope Map|object) → number, used, error }
  function compile(src, vars) {
    try {
      const allowed = vars instanceof Set ? vars : new Set(vars || []);
      const used = new Set();
      const run = build(parse(src), allowed, used);
      const fn = scope => run(scope instanceof Map ? scope : toMap(scope));
      return { ok: true, fn, run, used, src: String(src) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function toMap(obj) {
    const m = new Map();
    if (obj) Object.keys(obj).forEach(k => m.set(k, obj[k]));
    return m;
  }

  function evaluate(src, scope) {
    const vars = scope instanceof Map ? new Set(scope.keys()) : new Set(Object.keys(scope || {}));
    const c = compile(src, vars);
    if (!c.ok) throw new Error(c.error);
    return c.fn(scope || {});
  }

  // ----- Lab specs -----

  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, n) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, n);
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const list = v => (Array.isArray(v) ? v : []);
  const exprStr = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '');

  function circuitVars(c) {
    const out = ['Req', 'I', 'P', 'series'];
    c.resistors.forEach(r => out.push('I_' + r, 'V_' + r, 'P_' + r, 'on_' + r));
    return out;
  }

  // Strictly validate an AI (or stored) lab. Returns a clean lab or null.
  function sanitizeLab(raw, idx) {
    if (!obj(raw)) return null;
    const template = TEMPLATES.includes(raw.template) ? raw.template : null;
    if (!template) return null;
    const lab = {
      id: /^[a-z0-9_-]{1,24}$/i.test(str(raw.id, 24)) && !RESERVED.has(raw.id) ? str(raw.id, 24) : 'lab' + ((idx || 0) + 1),
      template,
      title: str(raw.title, 90) || 'Lab',
      intro: str(raw.intro, 500),
      goal: str(raw.goal, 300),
      params: [], derived: [], challenges: []
    };
    const names = new Set();
    const claim = id => {
      if (!IDENT.test(id) || RESERVED.has(id) || names.has(id)) return false;
      names.add(id);
      return true;
    };
    // Sliders
    list(raw.params).slice(0, 6).forEach(p => {
      if (!obj(p)) return;
      const id = str(p.id, 24);
      let min = num(p.min), max = num(p.max), step = num(p.step), value = num(p.value);
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min) || Math.abs(min) > 1e9 || Math.abs(max) > 1e9) return;
      if (!(step > 0) || step > max - min) step = niceStep((max - min) / 100);
      if ((max - min) / step > 10000) step = (max - min) / 10000;
      if (!Number.isFinite(value)) value = (min + max) / 2;
      if (!claim(id)) return;
      lab.params.push({ id, label: str(p.label, 60) || id, min, max, step, value: clampN(value, min, max), unit: str(p.unit, 16) });
    });
    // Template blocks
    if (template === 'circuit') {
      const c = obj(raw.circuit) ? raw.circuit : {};
      const pids = lab.params.map(p => p.id);
      const source = str(c.source, 24);
      const resistors = [...new Set(list(c.resistors).map(r => str(r, 24)))].filter(r => pids.includes(r) && r !== source).slice(0, 4);
      if (!pids.includes(source) || !resistors.length) return null;
      lab.circuit = { source, resistors, layout: c.layout === 'parallel' ? 'parallel' : 'series' };
      // Resistances must stay positive.
      lab.params.forEach(p => { if (resistors.includes(p.id) && p.min <= 0) { p.min = Math.min(p.step, p.max / 100) || 0.01; p.value = clampN(p.value, p.min, p.max); } });
      circuitVars(lab.circuit).forEach(v => names.add(v));
    }
    if (template === 'timeline') {
      const t = obj(raw.timeline) ? raw.timeline : {};
      const events = list(t.events).filter(obj).map(ev => ({ year: num(ev.year), label: str(ev.label, 80), detail: str(ev.detail, 300) }))
        .filter(ev => Number.isFinite(ev.year) && Math.abs(ev.year) < 1e6 && ev.label).slice(0, 30).sort((a, b) => a.year - b.year);
      if (events.length < 2) return null;
      lab.timeline = { events };
      // The scrubber is a built-in slider called "year".
      lab.params = lab.params.filter(p => p.id !== 'year');
      const lo = events[0].year, hi = events[events.length - 1].year;
      const pad = Math.max(1, Math.round((hi - lo) * 0.05));
      lab.params.unshift({ id: 'year', label: str(t.label, 40) || 'Year', min: lo - pad, max: hi + pad, step: hi - lo > 2000 ? 10 : 1, value: lo - pad, unit: '' });
      names.add('year'); names.add('seen');
    }
    if (!lab.params.length) return null;
    // Derived quantities, each may use params and earlier derived values.
    list(raw.derived).slice(0, 8).forEach(d => {
      if (!obj(d)) return;
      const id = str(d.id, 24);
      if (!IDENT.test(id) || RESERVED.has(id) || names.has(id)) return;
      const c = compile(exprStr(d.expr), names);
      if (!c.ok) return;
      names.add(id);
      const out = { id, label: str(d.label, 60) || id, expr: c.src, unit: str(d.unit, 16), digits: Number.isInteger(d.digits) ? clampN(d.digits, 0, 6) : 2 };
      if (obj(d.gauge) && Number.isFinite(num(d.gauge.min)) && num(d.gauge.max) > num(d.gauge.min)) out.gauge = { min: num(d.gauge.min), max: num(d.gauge.max) };
      lab.derived.push(out);
    });
    if (template === 'graph') {
      const g = obj(raw.graph) ? raw.graph : {};
      const gx = obj(g.x) ? g.x : {};
      let xmin = num(gx.min), xmax = num(gx.max);
      if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || !(xmax > xmin)) { xmin = 0; xmax = 10; }
      const withX = new Set([...names, 'x']);
      const curves = list(g.curves).filter(obj).map(cv => ({ c: compile(exprStr(cv.expr), withX), label: str(cv.label, 50) }))
        .filter(cv => cv.c.ok).slice(0, 4).map(cv => ({ expr: cv.c.src, label: cv.label }));
      if (!curves.length) return null;
      const gy = obj(g.y) ? g.y : {};
      lab.graph = { x: { min: xmin, max: xmax, label: str(gx.label, 30) || 'x' }, y: { label: str(gy.label, 30) || 'y' }, curves };
      if (Number.isFinite(num(gy.min)) && num(gy.max) > num(gy.min)) { lab.graph.y.min = num(gy.min); lab.graph.y.max = num(gy.max); }
      if (obj(g.marker)) {
        const mx = compile(exprStr(g.marker.x), names), my = compile(exprStr(g.marker.y), names);
        if (mx.ok && my.ok) lab.graph.marker = { x: mx.src, y: my.src, label: str(g.marker.label, 40) };
      }
    }
    if (template === 'motion') {
      const m = obj(raw.motion) ? raw.motion : {};
      const withT = new Set([...names, 't']);
      const mx = compile(exprStr(m.x), withT), my = compile(exprStr(m.y), withT), te = compile(exprStr(m.tEnd), names);
      if (!mx.ok || !my.ok || !te.ok) return null;
      lab.motion = { kind: m.kind === 'pendulum' ? 'pendulum' : 'path', x: mx.src, y: my.src, tEnd: te.src };
    }
    const bars = list(raw.bars).filter(obj).map(b => ({ c: compile(exprStr(b.expr), names), label: str(b.label, 30) }))
      .filter(b => b.c.ok && b.label).slice(0, 6).map(b => ({ label: b.label, expr: b.c.src }));
    if (bars.length && template !== 'timeline') lab.bars = bars;
    // Challenges: a goal checked live against the simulation's values.
    list(raw.challenges).slice(0, 4).forEach(ch => {
      if (!obj(ch)) return;
      const text = str(ch.text, 200), c = compile(exprStr(ch.check), names);
      if (text && c.ok) lab.challenges.push({ text, check: c.src, hint: str(ch.hint, 200) });
    });
    if (!lab.challenges.length) return null;
    lab.solved = [...new Set(list(raw.solved).filter(i => Number.isInteger(i) && i >= 0 && i < lab.challenges.length))];
    lab.createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
    return lab;
  }

  function sanitizeLabs(v) {
    const out = [];
    const ids = new Set();
    list(v).slice(0, 8).forEach((raw, i) => {
      const lab = sanitizeLab(raw, i);
      if (!lab) return;
      if (ids.has(lab.id)) lab.id = 'lab' + (i + 1) + '_' + out.length;
      ids.add(lab.id);
      out.push(lab);
    });
    return out;
  }

  // Ohm's-law circuit. Opening a switch removes that resistor: in series the
  // loop breaks (no current anywhere); in parallel only that branch stops.
  function circuit(V, Rs, layout, on) {
    const R = Rs.map(r => Math.max(1e-3, Number.isFinite(r) ? r : 1e-3));
    const active = R.map((_, i) => on ? on[i] !== false : true);
    const res = { Req: Infinity, I: 0, P: 0, parts: R.map(() => ({ I: 0, V: 0, P: 0 })) };
    if (layout === 'parallel') {
      const g = R.reduce((s, r, i) => s + (active[i] ? 1 / r : 0), 0);
      if (g > 0) { res.Req = 1 / g; res.I = V * g; }
      res.parts = R.map((r, i) => active[i] ? { I: V / r, V, P: V * V / r } : { I: 0, V: 0, P: 0 });
    } else {
      if (active.every(Boolean)) {
        res.Req = R.reduce((s, r) => s + r, 0);
        res.I = V / res.Req;
      }
      res.parts = R.map(r => ({ I: res.I, V: res.I * r, P: res.I * res.I * r }));
    }
    res.P = V * res.I;
    return res;
  }

  // A compiled, ready-to-run lab: scope(values, state) → Map of every live
  // value; plus curve/motion samplers and challenge checks.
  function runtime(lab) {
    const names = new Set(lab.params.map(p => p.id));
    if (lab.circuit) circuitVars(lab.circuit).forEach(v => names.add(v));
    if (lab.timeline) names.add('seen');
    const derived = lab.derived.map(d => { const c = compile(d.expr, names); names.add(d.id); return { id: d.id, fn: c.ok ? c.run : () => NaN }; });
    const fixed = new Set(names);
    const mk = (src, extra) => { const c = compile(src, extra ? new Set([...fixed, extra]) : fixed); return c.ok ? c.run : () => NaN; };
    const curves = lab.graph ? lab.graph.curves.map(cv => mk(cv.expr, 'x')) : [];
    const marker = lab.graph && lab.graph.marker ? { x: mk(lab.graph.marker.x), y: mk(lab.graph.marker.y) } : null;
    const motion = lab.motion ? { x: mk(lab.motion.x, 't'), y: mk(lab.motion.y, 't'), tEnd: mk(lab.motion.tEnd) } : null;
    const bars = (lab.bars || []).map(b => mk(b.expr));
    const checks = lab.challenges.map(ch => mk(ch.check));

    function scope(values, state) {
      const s = new Map();
      lab.params.forEach(p => { const v = values && Number.isFinite(values[p.id]) ? values[p.id] : p.value; s.set(p.id, v); });
      if (lab.circuit) {
        const c = lab.circuit, st = state || {};
        const layout = st.layout || c.layout;
        const on = c.resistors.map(r => !(st.off && st.off[r]));
        const r = circuit(s.get(c.source), c.resistors.map(id => s.get(id)), layout, on);
        s.set('Req', r.Req); s.set('I', r.I); s.set('P', r.P); s.set('series', layout === 'parallel' ? 0 : 1);
        c.resistors.forEach((id, i) => { s.set('I_' + id, r.parts[i].I); s.set('V_' + id, r.parts[i].V); s.set('P_' + id, r.parts[i].P); s.set('on_' + id, on[i] ? 1 : 0); });
      }
      if (lab.timeline) s.set('seen', lab.timeline.events.filter(ev => ev.year <= s.get('year')).length);
      derived.forEach(d => { let v; try { v = d.fn(s); } catch (e) { v = NaN; } s.set(d.id, v); });
      return s;
    }
    const safe = (f, s) => { try { const v = f(s); return Number.isFinite(v) ? v : NaN; } catch (e) { return NaN; } };
    function curveAt(i, x, s) { s.set('x', x); const v = safe(curves[i], s); s.delete('x'); return v; }
    function motionAt(t, s) { s.set('t', t); const p = { x: safe(motion.x, s), y: safe(motion.y, s) }; s.delete('t'); return p; }
    return {
      scope,
      curveAt,
      motionAt,
      tEnd: s => motion ? safe(motion.tEnd, s) : NaN,
      marker: s => marker ? { x: safe(marker.x, s), y: safe(marker.y, s) } : null,
      bars: s => bars.map(f => safe(f, s)),
      checks: s => checks.map(f => { try { return !!f(s); } catch (e) { return false; } })
    };
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  // ----- Video lesson storyboards -----

  // One slide; a revised slide carries the slide it replaced as "orig" (one level).
  function sanitizeSlide(sl, nested) {
    if (!obj(sl)) return null;
    const out = {
      title: str(sl.title, 120),
      bullets: list(sl.bullets).map(b => str(b, 220)).filter(Boolean).slice(0, 3),
      narration: str(sl.narration, 1500)
    };
    // Formula is stored as bare TeX; the player adds the delimiters.
    const f = str(sl.formula, 240).replace(/^\s*(\$\$?|\\\[|\\\()|(\$\$?|\\\]|\\\))\s*$/g, '').replace(/\$/g, '').trim();
    if (f) out.formula = f;
    if (obj(sl.diagram)) {
      if (sl.diagram.kind === 'notes' && Number.isInteger(sl.diagram.index) && sl.diagram.index >= 0 && sl.diagram.index < 50) out.diagram = { kind: 'notes', index: sl.diagram.index };
      else if (sl.diagram.kind === 'map' && str(sl.diagram.label, 140)) out.diagram = { kind: 'map', label: str(sl.diagram.label, 140) };
    }
    if (!out.title || !(out.narration || out.bullets.length)) return null;
    if (!out.narration) out.narration = [out.title, ...out.bullets].join('. ');
    if (!nested && obj(sl.orig)) {
      const o = sanitizeSlide(sl.orig, true);
      if (o) out.orig = o;
    }
    return out;
  }

  function sanitizeLesson(raw, idx) {
    if (!obj(raw)) return null;
    const slides = list(raw.slides).filter(obj).slice(0, 14).map(sl => sanitizeSlide(sl)).filter(Boolean);
    if (slides.length < 2) return null;
    const out = {
      id: /^[a-z0-9_-]{1,24}$/i.test(str(raw.id, 24)) ? str(raw.id, 24) : 'v' + ((idx || 0) + 1),
      title: str(raw.title, 120) || slides[0].title,
      topic: str(raw.topic, 120),
      slides,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0
    };
    // Another version of a lesson: "base" is the id of the original, "label" names the perspective.
    if (/^[a-z0-9_-]{1,24}$/i.test(str(raw.base, 24))) out.base = str(raw.base, 24);
    if (str(raw.label, 60)) out.label = str(raw.label, 60);
    return out;
  }

  function sanitizeLessons(v) {
    const out = [], ids = new Set();
    list(v).slice(0, 8).forEach((raw, i) => {
      const l = sanitizeLesson(raw, i);
      if (!l) return;
      if (ids.has(l.id)) l.id = 'v' + (i + 1) + '_' + out.length;
      ids.add(l.id);
      out.push(l);
    });
    return out;
  }

  return { compile, evaluate, parse, sanitizeLab, sanitizeLabs, runtime, circuit, niceStep, sanitizeSlide, sanitizeLesson, sanitizeLessons, TEMPLATES, FUNCS: Object.keys(FUNCS) };
})();

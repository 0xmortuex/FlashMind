// Contrast guard: opens the screens that draw tables and charts (with seeded
// data), in the dark and the light theme, and checks every text node inside
// them against WCAG AA (4.5:1, or 3:1 for large text). The background behind
// each text is the layers under it at its centre (HTML backgrounds, gradients
// by their worst stop, SVG shape fills), composited down to the first opaque one.
//
//   node tests/contrast.js            fails on any ratio below AA
//   SHOTS_DIR=<dir> node tests/contrast.js   also saves a screenshot per screen/theme
//   AUDIT_ALL=1 node tests/contrast.js       also report failures outside table/chart elements
//
// Needs the app served at BASE_URL (default http://localhost:4173/), like smoke.js.
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

// Runs in the page. Returns { checked, skipped, fails[] } for the text under `root`.
function auditInPage(rootSel, scopeRe, track) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  // Any CSS colour -> [r,g,b,a] (a 0..1) through a 1px canvas, so color-mix()/oklch() work too.
  const rgba = str => {
    if (cache.has(str)) return cache.get(str);
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = '#000';
    g.fillStyle = str;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    const out = [d[0], d[1], d[2], d[3] / 255];
    cache.set(str, out);
    return out;
  };
  const over = (top, bot) => {
    const a = top[3] + bot[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const cumOpacity = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const SHAPES = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline']);

  // Colour of a linear-gradient background at page point (px, py); null for other gradient kinds.
  const gradientAt = (el, img, px, py) => {
    const m = img.match(/^linear-gradient((.*))$/s);
    if (!m) return null;
    const parts = []; let depth = 0, cur = '';
    for (const ch of m[1]) {
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    parts.push(cur.trim());
    let deg = 180;
    const first = parts[0];
    if (/^-?[d.]+deg$/.test(first)) { deg = parseFloat(first); parts.shift(); }
    else if (/^to /.test(first)) {
      const w = first.slice(3);
      deg = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 }[w];
      parts.shift();
    }
    const stops = parts.map(p => {
      const c = p.match(/^(rgba?([^)]*)|color([^)]*)|[a-z]+)s*([d.]+%)?$/);
      return c ? { c: rgba(c[1]), p: c[2] ? parseFloat(c[2]) / 100 : null } : null;
    });
    if (!stops.length || stops.some(x => !x)) return null;
    stops[0].p = stops[0].p ?? 0; stops[stops.length - 1].p = stops[stops.length - 1].p ?? 1;
    for (let i = 1; i < stops.length - 1; i++) if (stops[i].p === null) {
      let j = i; while (stops[j].p === null) j++;
      const a = stops[i - 1].p, b = stops[j].p;
      for (let k = i; k < j; k++) stops[k].p = a + (b - a) * (k - i + 1) / (j - i + 1);
    }
    const r = el.getBoundingClientRect();
    const th = deg * Math.PI / 180, dx = Math.sin(th), dy = -Math.cos(th);
    const L = Math.abs(r.width * dx) + Math.abs(r.height * dy) || 1;
    const t = Math.min(1, Math.max(0, ((px - (r.left + r.width / 2)) * dx + (py - (r.top + r.height / 2)) * dy) / L + 0.5));
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i].p && t <= stops[i + 1].p) { a = stops[i]; b = stops[i + 1]; break; }
    const u = b.p === a.p ? 0 : Math.min(1, Math.max(0, (t - a.p) / (b.p - a.p)));
    return [0, 1, 2, 3].map(i => a.c[i] + (b.c[i] - a.c[i]) * u);
  };

  // Candidate background colours of one layer at (px, py). A gradient this function cannot
  // evaluate yields one candidate per stop (the worst is judged); 'unknown' when it has no stops.
  const layerColors = (el, px, py, skipOwn) => {
    const cs = getComputedStyle(el);
    const o = cumOpacity(el);
    const scale = c => [c[0], c[1], c[2], c[3] * o];
    if (el instanceof SVGElement) {
      if (!SHAPES.has(el.localName) || cs.fill === 'none') return null;
      const c = rgba(cs.fill);
      return [scale([c[0], c[1], c[2], c[3] * parseFloat(cs.fillOpacity)])];
    }
    if (skipOwn) return null;
    let out = [];
    const bg = rgba(cs.backgroundColor);
    if (bg[3] > 0) out.push(scale(bg));
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const at = gradientAt(el, cs.backgroundImage, px, py);
      if (at) { const t = scale(at); return [out[0] ? over(t, out[0]) : t]; }
      const stops = cs.backgroundImage.match(/(rgba?([^)]*)|color([^)]*))/g) || [];
      if (!stops.length) return 'unknown';
      return stops.map(x => scale(rgba(x))).map(x => (out[0] ? over(x, out[0]) : x));
    }
    return out.length ? out : null;
  };

  const root = document.querySelector(rootSel);
  const res = { checked: 0, skipped: 0, fails: [], gradients: 0, ratios: {} };
  if (!root) { res.missing = true; return res; }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  const label = el => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const cls = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      parts.unshift(e.localName + (cls ? '.' + cls : ''));
    }
    return parts.join(' > ');
  };
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || /^(script|style|noscript|option)$/i.test(el.localName)) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) === 0) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { res.skipped++; continue; }
    // Scrolled out of an overflow box: nobody can see it.
    let clipped = false;
    for (let p = el.parentElement; p && !clipped; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const b = p.getBoundingClientRect();
      clipped = x < b.left || x > b.right || y < b.top || y > b.bottom;
    }
    if (clipped) { res.skipped++; continue; }
    const stack = document.elementsFromPoint(x, y);
    let layers;
    // If neither the text nor an ancestor is hit there, it is covered, so nobody can see it.
    // Otherwise (pointer-events:none, like SVG labels) use what contains it plus what is painted before it.
    const at = stack.indexOf(el);
    if (at >= 0) layers = stack.slice(at);
    else if (stack.some(e => e.contains(el))) layers = stack.filter(e => e.contains(el) || (el.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING));
    else { res.skipped++; continue; }
    // Samples across the text: a gradient behind (or in) the text changes along it.
    const xs = r.width > 6 ? [r.left + r.width * 0.1, x, r.left + r.width * 0.9] : [x];
    const clipText = (cs.webkitBackgroundClip || cs.backgroundClip) === 'text';
    const op = cumOpacity(el);
    const textColors = px => {
      if (el instanceof SVGElement) { const c = rgba(cs.fill); return [[c[0], c[1], c[2], c[3] * parseFloat(cs.fillOpacity) * op]]; }
      if (clipText) { const lc = layerColors(el, px, y, false); return lc && lc !== 'unknown' ? lc : null; }
      const c = rgba(cs.webkitTextFillColor && cs.webkitTextFillColor !== 'currentcolor' ? cs.webkitTextFillColor : cs.color);
      return [[c[0], c[1], c[2], c[3] * op]];
    };
    const pairs = [];
    let unknown = false;
    for (const px of xs) {
      const fgs = textColors(px);
      if (!fgs) { unknown = true; break; }
      // Backgrounds: bottom-up from the first opaque layer, one candidate list per sample.
      let bases = [rgba(getComputedStyle(document.documentElement).backgroundColor)];
      if (bases[0][3] < 1) bases = [over(bases[0], [255, 255, 255, 1])];
      const lc = layers.map(l => layerColors(l, px, y, clipText && l === el));
      let start = layers.length - 1;
      for (let i = 0; i < lc.length; i++) { if (lc[i] && lc[i] !== 'unknown' && lc[i].every(c => c[3] >= 0.999)) { start = i; break; } }
      for (let i = start; i >= 0; i--) {
        const c = lc[i];
        if (c === 'unknown') { unknown = true; continue; }
        if (!c) continue;
        bases = c.flatMap(top => bases.map(b => over(top, b)));
      }
      for (const f of fgs) for (const b of bases) pairs.push([f, b]);
    }
    if (unknown) { res.gradients++; res.skipped++; continue; }
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    let worst = Infinity, wbg = null, wfg = null;
    for (const [f0, b] of pairs) {
      const f = f0[3] < 1 ? over(f0, b) : f0;
      const rt = ratio(f, b);
      if (rt < worst) { worst = rt; wbg = b; wfg = f0; }
    }
    res.checked++;
    if (track) { const k = label(el) + ' | ' + text.slice(0, 40); res.ratios[k] = Math.min(res.ratios[k] ?? Infinity, Math.round(worst * 100) / 100); }
    if (worst >= need) continue;
    const key = label(el) + '|' + wfg.join() + '|' + wbg.join();
    if (seen.has(key)) continue;
    seen.add(key);
    const inScope = (!scopeRe || new RegExp(scopeRe).test(label(el))) && !el.closest('button, a.btn-primary, .btn-primary, .btn-ghost, select, input');
    res.fails.push({
      sel: label(el), text: text.slice(0, 40), fg: wfg.map(v => Math.round(v * 100) / 100).join(','),
      stack: layers.slice(0, 8).map(l => l.localName + '.' + String(l.getAttribute('class') || '').split(' ')[0] + ' ' + getComputedStyle(l).backgroundColor + ' op=' + cumOpacity(l).toFixed(2)).join(' | '),
      bg: wbg.map(v => Math.round(v)).join(','), ratio: Math.round(worst * 100) / 100, need, size, inScope
    });
  }
  return res;
}

// What counts as a table or chart: classes that draw data (bars, grids, heat cells, rows of
// numbers, SVG charts). Anything else on the page is reported separately, not failed.
const SCOPE_RE = '(chart|heat|bar|cal-|cal\\.|table|-row|-cell|grid|plan-|pred-|mem-|cm-|stat-|qb-|btl-|cls-|exam-|mt-|meb-topics|meb-tab|scen-|forecast|lab-|mm-|svg|tl-|tr-|ln-|tx-)';

(async () => {
  let browser;
  try { await run(); } finally { if (browser) await browser.close(); }
  async function run() {
  const base = process.env.BASE_URL || 'http://localhost:4173/';
  const shots = process.env.SHOTS_DIR || '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-first-run', '--disable-extensions', ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])],
    defaultViewport: { width: 1280, height: 6000 }
  });
  const page = await browser.newPage();
  page.on('dialog', d => (d.type() === 'confirm' ? d.accept() : d.dismiss()).catch(() => {}));
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.click('#demo-btn');
  await page.waitForSelector('#study-view.active');

  // ----- seed: reviews, calibration, exams, exam date, mistakes, focus -----
  await page.evaluate(() => {
    const deck = Decks.getActive();
    const cards = deck.data.flashcards;
    cards.forEach((c, i) => Decks.review(c.id, [5, 3, 1, 5, 3][i % 5]));
    cards.slice(0, 6).forEach((c, i) => {
      Decks.recordConfidence(deck.id, c.id, ['sure', 'unsure', 'guess'][i % 3], i % 2 === 0);
      Decks.recordConfidence(deck.id, c.id, 'sure', i % 4 === 0);
    });
    // Sixty days of varied activity so every heat level and bar height is drawn.
    const days = {};
    for (let i = 0; i < 60; i++) {
      const t = new Date(Date.now() - i * 864e5);
      const reviews = [0, 2, 7, 15, 31, 55][(i * 7) % 6];
      if (reviews) days[t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')] = { reviews, gotit: Math.round(reviews * 0.7) };
    }
    Stats.mergeRemote({ days });
    for (let i = 0; i < 12; i++) Stats.recordReview(i % 3 ? 'gotit' : 'again');
    Stats.recordExam(82, 'B', 'Unit 1'); Stats.recordExam(55, 'D', 'Unit 2'); Stats.recordExam(93, 'A', 'Unit 3');
    Stats.recordFocus(25);
    const d = new Date(Date.now() + 9 * 864e5);
    Decks.setExamDate(deck.id, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    Decks.addMistakes(deck.data.quiz.slice(0, 3));
    deck.data.quiz.slice(0, 3).forEach((q, i) => Decks.tagMistake(q, ['concept', 'careless', 'misread'][i]));
    Decks.recordAnswers(deck.data.quiz.map((q, i) => ({ id: q.id, ok: i % 2 === 0 })));
  });

  const results = [];
  let failed = 0;
  const setTheme = t => page.evaluate(t => { if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme; }, t);
  // The study screens need the deck open (the home screen may have been shown by an earlier pass).
  const studyView = () => page.evaluate(() => { document.querySelectorAll('.shortcuts-backdrop, .btl-overlay').forEach(e => { e.style.display = 'none'; }); if (!document.getElementById('study-view').classList.contains('active')) App.openDeck(Decks.getActive().id, true); });
  const screens = [];
  const screen = (name, root, show) => screens.push({ name, root, show });

  screen('stats', '#tab-stats', async () => {
    await studyView();
    await page.evaluate(() => { App.switchTab('stats'); Stats.render(); });
    await page.waitForSelector('#tab-stats .heatmap');
    await sleep(1100); // count-up tiles and chart draw-in
  });
  screen('notes', '#tab-notes', async () => { await studyView(); await page.evaluate(() => { App.switchTab('notes'); Notes.render(App.getStudyData()); }); await sleep(900); });
  screen('flashcards-plan', '#tab-flashcards', async () => { await studyView(); await page.evaluate(() => App.switchTab('flashcards')); await sleep(700); });
  screen('home-library', '#deck-library', async () => {
    await page.evaluate(() => document.getElementById('back-to-input').click());
    await page.waitForSelector('#deck-library .deck-card');
    await sleep(700);
  });

  screen('quiz-ready', '#tab-quiz', async () => {
    await studyView();
    await page.evaluate(() => { App.switchTab('quiz'); Quiz.renderReady(); });
    await sleep(700);
  });
  screen('quiz-results', '#tab-quiz', async () => {
    await studyView();
    await page.evaluate(() => { App.switchTab('quiz'); Quiz.renderReady(); });
    await page.evaluate(() => Quiz.startQuiz([
      { id: 9001, type: 'multiple-choice', question: 'Contrast MC?', options: ['a', 'b', 'c', 'd', 'e'], correct: 0, explanation: '', category: 'Light' },
      { id: 9002, type: 'true-false', question: 'Contrast TF?', correct: true, explanation: '', category: 'Cells' },
      { id: 9003, type: 'multiple-choice', question: 'Contrast MC 2?', options: ['a', 'b', 'c', 'd'], correct: 1, explanation: '', category: 'Light' }
    ]));
    for (let i = 0; i < 8 && !(await page.$('.quiz-breakdown')); i++) {
      await page.evaluate(() => { const o = document.querySelector('.quiz-options:not(.tf-options) .quiz-option') || document.querySelector('.tf-option'); if (o) o.click(); });
      await sleep(350);
      await page.evaluate(() => { const n = document.getElementById('quiz-next-btn'); if (n) n.click(); });
      await sleep(350);
    }
    await page.waitForSelector('.quiz-breakdown');
    await page.evaluate(() => document.getElementById('review-btn').click()); // the answer review list
    await sleep(1200); // score ring and bars animate in
  });
  screen('labs', '#tab-notes', async () => {
    await studyView();
    await page.evaluate(() => { App.switchTab('notes'); });
    await page.evaluate(() => document.querySelector('[data-notes-view="labs"]').click());
    if (await page.$('[data-lab-curve="0"]')) return; // generated on the first pass
    await page.waitForSelector('[data-lab-act="generate"]');
    await page.evaluate(() => {
      window.__chat0 = API.chat;
      API.chat = async () => JSON.stringify({ labs: [
        { template: 'graph', title: 'Parabola lab', goal: 'Make it steeper', params: [{ id: 'a', label: 'a', min: 0, max: 4, step: 0.5, value: 3 }],
          derived: [{ id: 'y2', label: 'y(2)', expr: 'a*2^2' }], graph: { x: { min: -3, max: 3 }, curves: [{ expr: 'a*x^2', label: 'y' }] },
          challenges: [{ text: 'Make y(2) equal 12', check: 'abs(y2-12) < 0.01' }] }] });
    });
    await page.evaluate(() => document.querySelector('[data-lab-act="generate"]').click());
    await page.waitForSelector('[data-lab-curve="0"]');
    await page.evaluate(() => { API.chat = window.__chat0; });
    await sleep(500);
  });
  screen('meb-library', '.meb-panel', async () => {
    await page.evaluate(() => { document.querySelectorAll('.shortcuts-backdrop').forEach(e => { e.style.display = 'none'; }); MebIndex.open(); });
    await page.waitForSelector('.meb-panel .meb-row');
    await page.evaluate(() => {
      document.querySelector('.meb-panel [data-meb-year=""]').click();
      const sel = document.getElementById('meb-type'); sel.value = 'konu'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => document.querySelectorAll('.meb-panel .meb-topics').forEach(d => { d.open = true; }));
    await sleep(300);
  });
  screen('meb-scenarios', '.meb-panel', async () => {
    await page.evaluate(() => { document.querySelectorAll('.shortcuts-backdrop').forEach(e => { e.style.display = 'none'; }); MebIndex.open({ tab: 'scen' }); });
    await page.waitForSelector('.meb-panel .scen-row');
    await page.evaluate(() => document.querySelector('.meb-panel [data-scen-grade="0"]').click());
    await sleep(300);
  });
  screen('mind-map', '#tab-notes', async () => {
    await studyView();
    await page.evaluate(() => { App.switchTab('notes'); document.querySelector('[data-notes-view="map"]').click(); });
    await page.waitForSelector('.mm-svg [data-mm="0.0"]');
    await page.evaluate(() => document.querySelector('[data-mm="0.0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); // expand one branch
    await sleep(500);
  });
  screen('audio-overview', '#tab-notes', async () => {
    await studyView();
    await page.evaluate(() => { App.switchTab('notes'); document.querySelector('[data-notes-view="audio"]').click(); });
    await sleep(500);
  });
  screen('class-dashboard', '#cls-body', async () => {
    if (!await page.$('#cls-body .cls-heat')) {
      await page.evaluate(() => {
        document.querySelectorAll('.shortcuts-backdrop').forEach(e => { e.style.display = 'none'; });
        window.__api0 = API.classCall;
        API.classCall = async (a) => {
          if (a === 'classCreate') return { join: 'abcd234', teacher: 't'.repeat(20), name: '10-A' };
          if (a === 'classDashboard') {
            const topics = [['Light', [3, 4]], ['Cells', [1, 5]], ['Energy', [5, 5]], ['Water', [2, 6]], ['Gases', [4, 5]], ['Sugars', [3, 5]]];
            return { name: '10-A', items: [], students: [['Ayşe', 90, 1], ['Bora', 62, 2], ['Can', 35, 3], ['Deniz', 48, 4]].map(([nick, m, k], i) => ({
              sid: 's' + i, nick, joined: 1, t: Date.now() - i * 3600e3,
              r: { decks: { d1: { m, topics: Object.fromEntries(topics.map(([t, [a, b]], j) => [t, [Math.min(b, Math.max(0, a + ((i + j) % 3) - 1)), b]])), mis: {} } } }
            })) };
          }
          return { ok: true };
        };
      });
      await page.evaluate(() => document.getElementById('back-to-input').click());
      await page.waitForSelector('#class-section [data-cls-act="create"]', { visible: true });
      await page.evaluate(() => document.querySelector('[data-cls-act="create"]').click());
      await page.waitForSelector('#cls-name', { visible: true });
      await page.type('#cls-name', '10-A');
      await page.evaluate(() => document.querySelector('[data-cls-act="do-create"]').click());
      await page.waitForFunction(() => /ABCD234/.test(document.querySelector('#cls-body').textContent));
      await page.evaluate(() => document.querySelector('#cls-body [data-cls-act="open-teacher"]').click());
    }
    await page.waitForSelector('#cls-body .cls-heat .cls-cell');
    await sleep(400);
  });

  // The quiz battle and lecture companion need a socket / microphone, so their markup (the same
  // classes the renderers emit: js/battle.js reveal chart + leaderboard, js/lecture.js transcript + chips)
  // is injected into the same containers the app uses.
  screen('battle-chart', '#ct-battle', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.shortcuts-backdrop').forEach(e => { e.style.display = 'none'; });
      document.getElementById('ct-battle')?.remove();
      const bars = [4, 9, 2, 7].map((n, i) => `<div class="btl-bar-col btl-c${i}${i === 1 ? ' btl-right' : ''}"><span class="btl-bar-n">${n}</span><div class="btl-bar-fill" style="height:${Math.round(n / 9 * 100)}%"></div><span class="btl-bar-key">${['&#9650;', '&#9670;', '&#9679;', '&#9632;'][i]} ${'ABCD'[i]}${i === 1 ? ' &#10003;' : ''}</span></div>`).join('');
      const rows = [['Ayşe', 1840], ['Bora', 1500], ['Can', 920]].map(([n, sc], i) => `<li class="btl-board-row${i === 1 ? ' btl-board-me' : ''}"><span class="btl-rank">${i + 1}</span><span class="btl-board-name">${n}</span><span class="btl-board-score">${sc}</span></li>`).join('');
      document.body.insertAdjacentHTML('beforeend', `<div class="btl-overlay" id="ct-battle"><div class="btl-inner"><div class="btl-stage"><h2 class="btl-question btl-question-sm">Which gas do plants release?</h2><div class="btl-reveal"><div class="btl-chart" role="img">${bars}</div><div class="btl-reveal-side"><p class="btl-correct-line">Correct answer: <b>B: Oxygen</b></p><ol class="btl-board">${rows}</ol></div></div></div></div></div>`);
    });
    await sleep(300);
  });
  screen('lecture-transcript', '#ct-lecture', async () => {
    await page.evaluate(() => {
      document.getElementById('ct-battle')?.remove();
      document.getElementById('ct-lecture')?.remove();
      const segs = [['0:12', 'Photosynthesis happens in the chloroplast.'], ['0:40', 'The light reactions make ATP and NADPH.']].map(([a, t]) => `<div class="lec-seg"><span class="lec-at">${a}</span><span>${t}</span></div>`).join('') + '<div class="lec-seg interim"><span class="lec-at"></span><span>and then the Calvin cycle</span></div>';
      const chips = '<span class="lec-chip exam">&#9888;&#65039; Exam: light reactions need light</span><span class="lec-chip cue">&#128276; remember this <small>0:40</small></span>';
      document.body.insertAdjacentHTML('beforeend', `<div class="shortcuts-backdrop ex-backdrop" id="ct-lecture" style="display:flex"><div class="shortcuts-card ex-panel"><div class="lec-alerts">${chips}</div><div class="voice-transcript lec-transcript">${segs}</div><ul class="lec-summary-alerts"><li><span class="lec-chip exam">&#9888;&#65039;</span> Calvin cycle needs ATP</li></ul></div></div>`);
    });
    await sleep(400);
  });

  for (const s of screens) {
    for (const theme of ['dark', 'light']) {
      await setTheme(theme);
      if (process.env.CONTRAST_DEBUG) console.error('screen', s.name, theme);
      await s.show();
      // Entrance animations fade text and panels in; judge the settled state.
      for (let i = 0; i < 30; i++) {
        await sleep(120);
        if (!await page.evaluate(() => document.getAnimations().some(an => an.playState === 'running' && an.effect && an.effect.getTiming().iterations !== Infinity))) break;
      }
      const r = await page.evaluate(auditInPage, s.root, SCOPE_RE, !!process.env.CONTRAST_JSON);
      if (shots) await (await page.$(s.root)).screenshot({ path: path.join(shots, `${s.name}-${theme}.png`) });
      results.push({ screen: s.name, theme, ...r });
    }
    await setTheme('dark');
  }

  const all = process.env.AUDIT_ALL;
  let total = 0;
  for (const r of results) {
    total += r.checked;
    if (r.missing) { console.log(`FAIL  ${r.screen} (${r.theme}): root not found`); failed++; continue; }
    const bad = r.fails.filter(f => all || f.inScope);
    console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${r.screen} (${r.theme}): ${r.checked} text nodes checked, ${r.skipped} skipped${r.gradients ? ' (' + r.gradients + ' over unreadable gradients)' : ''}`);
    bad.forEach(f => console.log(`        ${f.ratio}:1 < ${f.need}  "${f.text}"  ${f.sel}  fg=${f.fg} bg=${f.bg}${process.env.CONTRAST_DEBUG ? '\n          ' + f.stack : ''}`));
    if (bad.length) failed++;
    const other = r.fails.length - r.fails.filter(f => f.inScope).length;
    if (other && !all) console.log(`        (+${other} below AA outside table/chart elements; AUDIT_ALL=1 lists them)`);
  }
  if (process.env.CONTRAST_JSON) fs.writeFileSync(process.env.CONTRAST_JSON, JSON.stringify(results.map(r => ({ screen: r.screen, theme: r.theme, ratios: r.ratios })), null, 1));
  if (errors.length) { console.log(errors.join('\n')); failed++; }
  console.log(failed ? `${failed} screen(s) below WCAG AA` : `ALL CONTRAST CHECKS PASSED (${total} text nodes)`);
  if (failed) process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

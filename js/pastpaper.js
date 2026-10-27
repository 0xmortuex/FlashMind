// ===== Past-paper mode (çıkmış / örnek sınav kitapçıkları) =====
// The student brings a real exam or MEB sample booklet (PDF text or photos).
// FlashMind analyses it in batches with the AI — question formats, option
// count, length, difficulty, topic distribution (konu dağılımı) and recurring
// patterns — and stores that "style profile" on the deck
// (deck.paperProfile). From the profile it can then:
//   - generate new questions in the same style, spread over the topics in
//     proportion to the distribution;
//   - file the booklet's own questions into the exam bank (keyed from the
//     booklet's answer key when it has one, otherwise solved by the AI and
//     marked `aiKeyed` so the answer checker verifies them);
//   - weight adaptive practice toward topics that carry more questions on the
//     real exam (see topicBoost).
// The pure helpers at the top have no DOM access (covered by regression tests).
const PastPaper = (() => {
  const FORMATS = ['multiple-choice', 'true-false', 'fill-blank', 'matching', 'open-ended'];
  const CHUNK = 7000;      // chars of booklet text per AI call
  const MAX_CHUNKS = 6;    // ~42k chars, a typical 20–40 question booklet
  const GEN_BATCH = 8;     // questions per generation call (output budget)

  // Free official sources the student uses. Links only — never scraped.
  const RESOURCES = [
    { id: 'odsgm', name: 'MEB ÖDSGM', url: 'https://odsgm.meb.gov.tr', what: 'resOdsgm', how: 'resOdsgmHow' },
    { id: 'ogm', name: 'OGM Materyal', url: 'https://ogmmateryal.eba.gov.tr', what: 'resOgm', how: 'resOgmHow' },
    { id: 'mebi', name: 'MEBİ', url: 'https://mebi.eba.gov.tr', what: 'resMebi', how: 'resMebiHow' }
  ];

  // ---------- pure helpers ----------
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = v => typeof v === 'string' ? v : '';
  const list = v => Array.isArray(v) ? v : [];
  const num = (v, lo, hi, d) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

  // Accent/case-insensitive key for matching topic names (Turkish-aware).
  function normName(s) {
    return String(s == null ? '' : s).toLocaleLowerCase('tr').replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // [{name, count|weight}] → merged by name, at most 30, with `weight` the
  // share of all questions (sums to 1). Heaviest topics first.
  function normalizeTopics(input) {
    const byKey = new Map();
    list(input).forEach(t => {
      if (!obj(t)) return;
      const name = str(t.name).replace(/\s+/g, ' ').trim().slice(0, 120);
      const key = normName(name);
      if (!key) return;
      const count = num(t.count, 0, 1000, NaN) > 0 ? num(t.count, 0, 1000, 0) : num(t.weight, 0, 1000, NaN) > 0 ? num(t.weight, 0, 1000, 0) : 1;
      const cur = byKey.get(key);
      if (cur) cur.count += count; else byKey.set(key, { name, count });
    });
    const out = [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 30);
    const total = out.reduce((s, t) => s + t.count, 0) || 1;
    return out.map(t => ({ name: t.name, count: Math.round(t.count * 100) / 100, weight: Math.round(t.count / total * 10000) / 10000 }));
  }

  // A pasted konu dağılımı: one topic per line ending in a question count or
  // a percentage ("Hücre Bölünmeleri ..... 4", "Kalıtım - %20", "Optik: 3 soru").
  function parseDistribution(text) {
    const rows = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const m = line.trim().match(/^(.*?[^\d\s%].*?)[\s:;|.\-–—\t]+%?\s*(\d{1,3}(?:[.,]\d+)?)\s*%?\s*(?:soru|sorular|question|questions|adet)?\s*$/i);
      if (!m) return;
      const name = m[1].replace(/^\s*\d+\s*[.)\-]\s*/, '').replace(/[\s.:\-–—|]+$/, '').trim();
      if (!/[a-zçğıöşüâîû]/i.test(name) || name.length < 2) return;
      if (/^(toplam|total|genel toplam|sum)$/i.test(normName(name))) return;
      const count = parseFloat(m[2].replace(',', '.'));
      if (count > 0) rows.push({ name, count });
    });
    return normalizeTopics(rows);
  }

  // The best topic for a question category, or null. Exact name, then
  // containment, then ≥50% shared words.
  function matchTopic(category, topics) {
    const c = normName(category);
    if (!c || !topics || !topics.length) return null;
    let best = null, bestScore = 0;
    const words = s => new Set(s.split(' ').filter(w => w.length >= 3));
    const cw = words(c);
    for (const t of topics) {
      const k = normName(t.name);
      if (!k) continue;
      if (k === c) return t;
      let score = 0;
      if ((k.length >= 4 && c.includes(k)) || (c.length >= 4 && k.includes(c))) score = 0.9;
      else {
        const kw = words(k);
        const inter = [...cw].filter(w => kw.has(w)).length;
        const union = new Set([...cw, ...kw]).size;
        score = union ? inter / union : 0;
      }
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore >= 0.5 ? best : null;
  }

  // Multiplier for adaptive practice: a topic worth twice the average share
  // of the exam is picked about twice as often (clamped to 0.5×–3×).
  // Questions whose topic is not in the distribution keep 1×.
  function topicBoost(profile) {
    const topics = profile && Array.isArray(profile.topics) ? profile.topics : [];
    if (topics.length < 2) return null;
    const cache = new Map();
    return q => {
      const cat = (q && q.category) || '';
      if (!cache.has(cat)) {
        const t = matchTopic(cat, topics);
        cache.set(cat, t ? Math.round(Math.min(3, Math.max(0.5, t.weight * topics.length)) * 100) / 100 : 1);
      }
      return cache.get(cat);
    };
  }

  // Largest-remainder split of n items over weights.
  function allocate(n, weights) {
    const w = weights.map(x => (Number.isFinite(x) && x > 0 ? x : 0));
    const total = w.reduce((a, b) => a + b, 0);
    if (!n || !w.length) return w.map(() => 0);
    const exact = total ? w.map(x => x / total * n) : w.map(() => n / w.length);
    const out = exact.map(Math.floor);
    let left = n - out.reduce((a, b) => a + b, 0);
    exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    return out;
  }

  // n generation slots [{topic, type}] following the profile's topic weights
  // and format mix, interleaved so every batch gets a fair mix.
  function planSlots(n, profile) {
    const p = profile || {};
    const topics = list(p.topics).length ? p.topics : [{ name: '', weight: 1 }];
    const fm = (p.style && p.style.formats) || {};
    const fWeights = FORMATS.map(f => fm[f] || 0);
    const fCounts = fWeights.some(Boolean) ? allocate(n, fWeights) : FORMATS.map(f => f === 'multiple-choice' ? n : 0);
    const tCounts = allocate(n, topics.map(t => t.weight));
    const spread = counts => {
      const left = counts.slice(), out = [];
      while (out.length < n && left.some(Boolean)) left.forEach((c, i) => { if (c > 0 && out.length < n) { out.push(i); left[i]--; } });
      return out;
    };
    const ts = spread(tCounts), fs = spread(fCounts);
    return ts.map((ti, i) => ({ topic: topics[ti].name, type: FORMATS[fs[i] != null ? fs[i] : 0] }));
  }

  // Answer key printed in the booklet ("CEVAP ANAHTARI 1-C 2.A 3) E").
  function parseAnswerKey(text) {
    const s = String(text || '');
    const re = /cevap\s+anahtar|answer\s+key|yan[ıi]t\s+anahtar/gi;
    let at = -1, m;
    while ((m = re.exec(s))) at = m.index;
    if (at < 0) return { key: {}, text: '' };
    const tail = s.slice(at, at + 3000);
    const key = {};
    const pair = /(?:^|[^\d])(\d{1,3})\s*[-.):]?\s*([A-E])(?![a-zçğıöşü])/g;
    while ((m = pair.exec(tail))) if (!key[m[1]]) key[m[1]] = m[2].toUpperCase();
    return Object.keys(key).length >= 3 ? { key, text: tail.slice(0, 1500) } : { key: {}, text: '' };
  }

  // Split booklet text into ≤size chunks on paragraph/page boundaries.
  function chunkText(text, size, max) {
    size = size || CHUNK; max = max || MAX_CHUNKS;
    const paras = String(text || '').split(/\n{2,}/);
    const chunks = [];
    let cur = '';
    const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
    for (const p of paras) {
      if (p.length > size) { push(); for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size)); continue; }
      if (cur.length + p.length + 2 > size) push();
      cur += (cur ? '\n\n' : '') + p;
    }
    push();
    return { chunks: chunks.slice(0, max), truncated: chunks.length > max };
  }

  function sanitizeStyle(s) {
    s = obj(s) ? s : {};
    const f = obj(s.formats) ? s.formats : {};
    const alias = { mc: 'multiple-choice', tf: 'true-false', fill: 'fill-blank', match: 'matching', open: 'open-ended', 'open ended': 'open-ended' };
    const formats = {};
    FORMATS.forEach(k => { formats[k] = 0; });
    Object.keys(f).forEach(k => { const key = alias[k] || k; if (FORMATS.includes(key)) formats[key] += Math.round(num(f[k], 0, 500, 0)); });
    return {
      formats,
      optionCount: Math.round(num(s.optionCount, 2, 6, 5)),
      length: ['short', 'medium', 'long'].includes(s.length) ? s.length : 'medium',
      difficulty: ['easy', 'medium', 'hard'].includes(s.difficulty) ? s.difficulty : 'medium',
      notes: str(s.notes).trim().slice(0, 300)
    };
  }

  // Deck-level profile boundary (also applied on every read).
  function sanitizeProfile(p) {
    if (!obj(p)) return null;
    const out = {
      style: sanitizeStyle(p.style),
      topics: normalizeTopics(p.topics),
      topicsFrom: ['distribution', 'paper'].includes(p.topicsFrom) ? p.topicsFrom : 'paper',
      patterns: list(p.patterns).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 200)).slice(0, 8),
      source: str(p.source).trim().slice(0, 160),
      papers: Math.round(num(p.papers, 0, 999, 0)),
      updatedAt: num(p.updatedAt, 0, 1e15, 0)
    };
    const hasStyle = FORMATS.some(k => out.style.formats[k] > 0);
    return hasStyle || out.topics.length || out.patterns.length ? out : null;
  }

  // One AI analysis of one chunk → { style, topics, patterns, isDistribution,
  // questions[] } with the booklet's answer key applied where it exists.
  function parseAnalysis(raw, answerKey) {
    const o = Parser.safeParseJSON(raw);
    if (!obj(o)) throw new Error('Invalid analysis');
    const key = obj(answerKey) ? answerKey : {};
    const qs = list(o.questions).filter(obj).map(q => {
      q = Object.assign({}, q);
      const n = String(q.number == null ? '' : q.number).replace(/\D/g, '');
      if (q.type !== 'true-false' && q.type !== 'fill-blank' && q.type !== 'matching' && q.type !== 'open-ended') {
        q.type = 'multiple-choice';
        if (typeof q.correct === 'string' && /^[A-F]$/i.test(q.correct.trim())) q.correct = q.correct.trim().toUpperCase().charCodeAt(0) - 65;
      }
      let fromBooklet = false;
      if (q.type === 'multiple-choice' && n && key[n]) {
        const idx = key[n].charCodeAt(0) - 65;
        if (Array.isArray(q.options) && idx < q.options.length) { q.correct = idx; fromBooklet = true; }
      } else if (q.keyed === 'booklet' && Object.keys(key).length) fromBooklet = true;
      const topic = str(q.topic).trim().slice(0, 120);
      if (topic && !str(q.category)) q.category = topic;
      q.src = 'paper';
      if (fromBooklet) delete q.aiKeyed; else q.aiKeyed = true;
      ['number', 'keyed', 'topic', 'id'].forEach(k => delete q[k]);
      return q;
    });
    return {
      style: sanitizeStyle(o.style),
      topics: normalizeTopics(o.topics),
      patterns: list(o.patterns).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()),
      isDistribution: o.isDistribution === true,
      questions: Parser.normalizeStudyData({ quiz: qs }).quiz.map(q => { delete q.id; return q; })
    };
  }

  // Combine the per-chunk analyses of one booklet.
  function mergeAnalyses(parts) {
    const ok = list(parts).filter(obj);
    const formats = {};
    FORMATS.forEach(k => { formats[k] = ok.reduce((s, p) => s + ((p.style && p.style.formats && p.style.formats[k]) || 0), 0); });
    const vote = field => {
      const tally = {};
      ok.forEach(p => { const v = p.style && p.style[field]; const w = FORMATS.reduce((s, k) => s + (p.style.formats[k] || 0), 0) || 1; if (v != null) tally[v] = (tally[v] || 0) + w; });
      const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      return best ? best[0] : undefined;
    };
    const seen = new Set(), patterns = [];
    ok.forEach(p => list(p.patterns).forEach(x => { const k = normName(x); if (k && !seen.has(k)) { seen.add(k); patterns.push(x); } }));
    const notes = ok.map(p => p.style && p.style.notes).find(Boolean) || '';
    return {
      style: sanitizeStyle({ formats, optionCount: Number(vote('optionCount')), length: vote('length'), difficulty: vote('difficulty'), notes }),
      topics: normalizeTopics([].concat(...ok.map(p => list(p.topics)))),
      patterns: patterns.slice(0, 8),
      isDistribution: ok.some(p => p.isDistribution),
      questions: [].concat(...ok.map(p => list(p.questions)))
    };
  }

  // ---------- deck storage ----------
  function getProfile(deck) {
    const d = deck || (typeof Decks !== 'undefined' ? Decks.getActive() : null);
    return d ? sanitizeProfile(d.paperProfile) : null;
  }

  function saveProfile(p) {
    if (typeof App !== 'undefined' && App.getStudyData && !Decks.getActive()) App.persistActiveDeck();
    const deck = Decks.getActive();
    if (!deck) return null;
    const clean = sanitizeProfile(Object.assign({}, p, { updatedAt: Date.now() }));
    if (clean) deck.paperProfile = clean; else delete deck.paperProfile;
    Decks.touch(deck.id);
    return clean;
  }

  // ---------- AI prompts ----------
  function analysisPrompt(i, n, keyText) {
    return `This is part ${i + 1} of ${n} of a real Turkish school exam or MEB sample question booklet (10th grade, lise), as extracted text ` +
      '(PDF or OCR, may contain errors). Analyse it:\n' +
      '- style: how many questions of each format appear in THIS part, the number of options per multiple-choice question, typical ' +
      'question length (short|medium|long), difficulty (easy|medium|hard), and one sentence on the style (e.g. "long scenario stems with a table").\n' +
      '- topics: the curriculum unit/topic (konu) of each question, counted. If the text is a topic distribution table (konu dağılımı, ' +
      'topics with question counts) instead of questions, return those topics with their counts and set isDistribution to true.\n' +
      '- patterns: at most 4 short recurring patterns (e.g. "asks which statement is NOT true", "interprets a graph").\n' +
      '- questions: the booklet\'s own questions that are fully readable, at most 8, rewritten cleanly in the original language. ' +
      'Multiple-choice: "options" (without the A) letters) and "correct" (0-based index). True-false: "correct" true/false. Fill-blank: ' +
      '"answers" (accepted answers) and a ___ gap in "question". Matching: "pairs" [{"left","right"}]. Open-ended: "correctAnswer" and ' +
      '"keyPoints". Use the booklet\'s answer key when present and set "keyed":"booklet"; otherwise solve it yourself and set "keyed":"ai". ' +
      'Skip questions that depend on a picture you cannot see.\n' +
      (keyText ? 'The booklet\'s answer key section reads:\n' + keyText.slice(0, 1200) + '\n' : '') +
      'Return ONLY JSON, no other text: {"style":{"formats":{"multiple-choice":0,"true-false":0,"fill-blank":0,"matching":0,"open-ended":0},' +
      '"optionCount":5,"length":"medium","difficulty":"medium","notes":""},"topics":[{"name":"","count":1}],"isDistribution":false,' +
      '"patterns":[""],"questions":[{"number":1,"type":"multiple-choice","question":"","options":["","","","",""],"correct":0,' +
      '"keyed":"ai","topic":"","explanation":""}]}';
  }

  function stylePrompt(profile, slots) {
    const s = profile.style;
    const fm = FORMATS.filter(k => s.formats[k]).map(k => `${k}: ${s.formats[k]}`).join(', ') || 'multiple-choice';
    const lines = slots.map((x, i) => `${i + 1}. ${x.type}${x.topic ? ' — topic: ' + x.topic : ''}`).join('\n');
    return 'Write NEW exam questions in the exact style of a real Turkish 10th-grade (lise) exam the student uploaded. Style profile:\n' +
      `- format mix on the real paper: ${fm}\n- multiple-choice questions have ${s.optionCount} options (A–${'ABCDEF'[s.optionCount - 1]})\n` +
      `- stem length: ${s.length}; difficulty: ${s.difficulty}${s.notes ? '\n- style: ' + s.notes : ''}\n` +
      (profile.patterns.length ? '- recurring patterns: ' + profile.patterns.join('; ') + '\n' : '') +
      'Write exactly these questions, in this order:\n' + lines + '\n' +
      'Set each question\'s "category" to its topic exactly as written. Do not copy the original paper; same language as the topics ' +
      '(Turkish for Turkish topics). Use the study material for facts when it helps. Multiple-choice: "options" and "correct" (0-based); ' +
      'true-false: "correct" boolean; fill-blank: "answers" and a ___ gap; matching: "pairs"; open-ended: "correctAnswer", "keyPoints". ' +
      'Add a one-sentence "explanation".\n' +
      'Return ONLY JSON, no other text: {"type":"quiz","quiz":[{"type":"multiple-choice","question":"","options":[],"correct":0,"category":"","explanation":""}]}';
  }

  function quizFrom(raw) {
    const o = Parser.safeParseJSON(raw);
    const qs = obj(o) ? list(o.quiz).length ? o.quiz : list(o.questions) : list(o);
    return Parser.normalizeStudyData({ quiz: qs }).quiz.map(q => { delete q.id; return q; });
  }

  // ---------- UI ----------
  function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML.replace(/"/g, '&quot;'); }
  const T = (k, p) => i18n.t(k, p);

  // Shared modal shell for the exam tools (reuses the shortcuts card).
  function makeModal(cls) {
    let el = null, release = null;
    const api = {
      get el() { return el; },
      isOpen: () => !!el && el.style.display !== 'none',
      show(html) {
        if (!el) {
          el = document.createElement('div');
          el.className = 'shortcuts-backdrop ex-backdrop';
          el.style.display = 'none';
          document.body.appendChild(el);
          el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-ex-close]')) api.close(); });
          document.addEventListener('keydown', e => { if (e.key === 'Escape' && api.isOpen()) api.close(); });
        }
        const wasOpen = api.isOpen();
        el.innerHTML = `<div class="shortcuts-card ex-panel ${cls}" role="dialog" aria-modal="true">${html}</div>`;
        el.style.display = 'flex';
        if (!wasOpen) release = FX.trapFocus(el);
      },
      close() {
        if (!el) return;
        el.style.display = 'none';
        if (release) { release(); release = null; }
      }
    };
    return api;
  }

  const modal = typeof document !== 'undefined' ? makeModal('pp-panel') : null;
  let files = [];
  let busy = false;
  let status = ''; // progress / result line
  let draft = '';  // pasted text survives re-renders

  function resourcesHtml(compact) {
    return `<div class="meb-res${compact ? ' compact' : ''}">
      <div class="meb-res-title">&#127963;&#65039; ${T('resTitle')}</div>
      <p class="meb-res-sub">${T('resSub')}</p>
      <ul class="meb-res-list">${RESOURCES.map(r => `<li class="meb-res-item">
        <a class="meb-res-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)} <span aria-hidden="true">&#8599;</span></a>
        <span class="meb-res-what">${T(r.what)}</span>
        <span class="meb-res-how">${T(r.how)}</span>
      </li>`).join('')}</ul>
      ${typeof MebIndex !== 'undefined' ? `<button class="btn-ghost meb-lib-btn" data-meb-act="open">&#128218; ${T('mebOpen')}</button>` : ''}
    </div>`;
  }

  function pct(w) { return Math.round(w * 100); }

  function weightNoteHtml(profile) {
    const p = profile || getProfile();
    if (!p || p.topics.length < 2) return '';
    const top = p.topics.slice(0, 3).map(t => `${esc(t.name)} %${pct(t.weight)}`).join(', ');
    return `<p class="pp-weight-note">&#9878;&#65039; ${T(p.topicsFrom === 'distribution' ? 'ppWeightOnDist' : 'ppWeightOnPaper', { t: top })}</p>`;
  }

  // Exam tab ready-screen row (entry points for past papers + paper review).
  function readyHtml() {
    if (typeof Decks === 'undefined') return '';
    const p = getProfile();
    return `<div class="ex-tools-row">
        <button class="btn-ghost ex-tool-btn" data-pp-act="open">&#128196; ${T(p ? 'ppOpenHas' : 'ppOpen')}</button>
        ${typeof PaperReview !== 'undefined' ? `<button class="btn-ghost ex-tool-btn" data-pr-act="open">&#128248; ${T('prOpen')}</button>` : ''}
      </div>${weightNoteHtml(p)}`;
  }

  function profileHtml(p) {
    const s = p.style;
    const fm = FORMATS.filter(k => s.formats[k]).map(k => `<span class="pp-chip">${esc(T('ppFmt_' + k))} × ${s.formats[k]}</span>`).join('');
    return `<div class="pp-profile">
      <div class="pp-profile-head"><b>${T('ppProfileTitle')}</b>${p.source ? `<span class="pp-src">${esc(p.source)}</span>` : ''}</div>
      ${fm ? `<div class="pp-chips">${fm}
        <span class="pp-chip">${T('ppOptions', { n: s.optionCount })}</span>
        <span class="pp-chip">${T('ppLen_' + s.length)}</span>
        <span class="pp-chip">${T('ppDiff_' + s.difficulty)}</span></div>` : ''}
      ${s.notes ? `<p class="pp-notes">${esc(s.notes)}</p>` : ''}
      ${p.topics.length ? `<div class="pp-topics"><div class="pp-sub">${T(p.topicsFrom === 'distribution' ? 'ppTopicsDist' : 'ppTopicsPaper')}</div>
        ${p.topics.slice(0, 8).map(t => `<div class="qb-row"><span class="qb-name">${esc(t.name)}</span>
          <span class="qb-bar"><span class="qb-fill good" style="width:${pct(t.weight)}%"></span></span><span class="qb-score">%${pct(t.weight)}</span></div>`).join('')}
        ${p.topics.length >= 2 ? `<p class="pp-explain">${T('ppWeightExplain')}</p>` : ''}</div>` : ''}
      ${p.patterns.length ? `<div class="pp-sub">${T('ppPatterns')}</div><ul class="pp-patterns">${p.patterns.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="pp-gen-row">
        <span class="pp-sub">${T('ppGenerate')}</span>
        <button class="btn-primary" data-pp-act="gen" data-n="10" ${busy ? 'disabled' : ''}>+10</button>
        <button class="btn-ghost" data-pp-act="gen" data-n="20" ${busy ? 'disabled' : ''}>+20</button>
        <button class="btn-ghost pp-clear" data-pp-act="clear" ${busy ? 'disabled' : ''}>${T('ppClear')}</button>
      </div>
    </div>`;
  }

  // `fresh` drops the typed text (after it was used successfully).
  function render(fresh) {
    if (!modal) return;
    const ta = document.getElementById('pp-text');
    if (ta && !fresh) draft = ta.value;
    const keep = document.getElementById('pp-keep');
    const keepOn = keep ? keep.checked : true;
    const p = getProfile();
    modal.show(`
      <div class="chk-head"><h3>&#128196; ${T('ppTitle')}</h3><button class="btn-icon" data-ex-close aria-label="${esc(T('close'))}">&times;</button></div>
      <div class="ex-scroll">
        <p class="chk-intro">${T('ppIntro')}</p>
        ${p ? profileHtml(p) : ''}
        <div class="pp-upload">
          <label class="btn-ghost pp-file-btn">&#128206; ${T('ppChoose')}
            <input type="file" id="pp-files" accept=".pdf,application/pdf,image/*" multiple hidden></label>
          <span class="pp-files">${files.length ? esc(files.map(f => f.name).join(', ')) : T('ppNoFiles')}</span>
        </div>
        <textarea id="pp-text" class="pp-text" rows="4" placeholder="${esc(T('ppPasteHolder'))}">${esc(draft)}</textarea>
        <label class="pp-keep"><input type="checkbox" id="pp-keep" ${keepOn ? 'checked' : ''}> ${T('ppKeepQs')}</label>
        <div class="pp-actions">
          <button class="btn-primary" data-pp-act="analyse" ${busy ? 'disabled' : ''}>&#128269; ${T('ppAnalyse')}</button>
          <button class="btn-ghost" data-pp-act="dist" ${busy ? 'disabled' : ''}>&#9878;&#65039; ${T('ppUseDist')}</button>
          ${typeof MebIndex !== 'undefined' ? `<button class="btn-ghost" data-meb-act="open">&#128218; ${T('mebOpen')}</button>` : ''}
        </div>
        <div class="pp-status" id="pp-status" aria-live="polite">${status ? esc(status) : ''}</div>
        <details class="pp-res-details"${p ? '' : ' open'}><summary>${T('resTitle')}</summary>${resourcesHtml(true)}</details>
      </div>`);
  }

  function setStatus(msg) {
    status = msg || '';
    const el = document.getElementById('pp-status');
    if (el) el.textContent = status;
  }

  function open() { status = ''; render(); }

  // PDF text and/or OCR text of the chosen files, else the pasted text.
  async function gatherText() {
    if (!files.length) return (document.getElementById('pp-text') || {}).value || draft || '';
    let text = '';
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        const r = await PDF.extractText(f, (c, t) => setStatus(T('ppReadingPdf', { c, t })));
        text += r.text + '\n\n';
      } else {
        const t = await OCR.extractText(f, p => setStatus(T('ppReadingPhoto', { i: i + 1, n: files.length, p: Math.round(p * 100) })));
        text += t + `\n\n--- Page ${i + 1} ---\n\n`;
      }
    }
    return text;
  }

  async function analyse() {
    if (busy) return;
    const keep = (document.getElementById('pp-keep') || { checked: true }).checked;
    let fresh = false;
    busy = true; render();
    try {
      const text = (await gatherText()).trim();
      if (text.length < 40) { setStatus(T(files.length ? 'ppScanned' : 'ppNoInput')); return; }
      const { key, text: keyText } = parseAnswerKey(text);
      const { chunks, truncated } = chunkText(text);
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        setStatus(T('ppAnalysing', { i: i + 1, n: chunks.length }));
        try { parts.push(parseAnalysis(await API.chat(analysisPrompt(i, chunks.length, keyText), chunks[i]), key)); }
        catch (e) { /* one bad part should not sink the booklet */ }
      }
      if (!parts.length) throw new Error(T('chatError'));
      const merged = mergeAnalyses(parts);
      const old = getProfile();
      // An explicit konu dağılımı beats topics counted from one booklet.
      const keepDist = old && old.topicsFrom === 'distribution' && !merged.isDistribution;
      const name = files.length ? files.map(f => f.name).join(', ') : T('ppPasted');
      const profile = saveProfile({
        style: FORMATS.some(k => merged.style.formats[k]) ? merged.style : (old ? old.style : merged.style),
        topics: keepDist ? old.topics : merged.topics,
        topicsFrom: keepDist || merged.isDistribution ? 'distribution' : 'paper',
        patterns: merged.patterns.length ? merged.patterns : (old ? old.patterns : []),
        source: name,
        papers: (old ? old.papers : 0) + 1
      });
      let added = 0, aiKeyed = 0;
      if (keep && merged.questions.length && typeof Quiz !== 'undefined') {
        added = Quiz.addQuestions(merged.questions);
        aiKeyed = merged.questions.filter(q => q.aiKeyed && q.id != null).length;
      }
      files = [];
      draft = '';
      fresh = true;
      status = T('ppDone', { t: profile ? profile.topics.length : 0, q: added }) +
        (aiKeyed ? ' ' + T('ppAiKeyed', { n: aiKeyed }) : '') + (truncated ? ' ' + T('ppTruncated') : '');
      App.showToast(T('ppSaved'), 'success');
      if (aiKeyed && typeof Checker !== 'undefined' && Checker.autoEnabled() && !Checker.isRunning()) Checker.run(true);
    } catch (err) {
      setStatus(T('ppFailed') + ' ' + (err && err.message ? err.message : ''));
    } finally {
      busy = false;
      if (modal.isOpen()) render(fresh);
      refreshReady();
    }
  }

  async function useDistribution() {
    if (busy) return;
    let fresh = false;
    busy = true; render();
    try {
      const text = (await gatherText()).trim();
      if (!text) { setStatus(T('ppNoInput')); return; }
      let topics = parseDistribution(text);
      if (topics.length < 2) {
        setStatus(T('ppDistAi'));
        const raw = await API.chat('The text is a topic distribution table (konu dağılımı) for a Turkish school exam: topics/learning ' +
          'outcomes with how many questions each gets. Extract it. Return ONLY JSON, no other text: {"topics":[{"name":"","count":1}]}', text.slice(0, 12000));
        const o = Parser.safeParseJSON(raw);
        topics = normalizeTopics(obj(o) ? o.topics : []);
      }
      if (topics.length < 2) { setStatus(T('ppDistNone')); return; }
      const old = getProfile() || {};
      saveProfile(Object.assign({}, old, { topics, topicsFrom: 'distribution', source: old.source || (files.length ? files[0].name : T('ppPasted')) }));
      files = []; draft = '';
      fresh = true;
      status = T('ppDistSaved', { n: topics.length });
      App.showToast(T('ppSaved'), 'success');
    } catch (err) {
      setStatus(T('ppFailed') + ' ' + (err && err.message ? err.message : ''));
    } finally {
      busy = false;
      if (modal.isOpen()) render(fresh);
      refreshReady();
    }
  }

  async function generateStyled(n) {
    const profile = getProfile();
    if (!profile || busy) return;
    busy = true; render();
    const slots = planSlots(n, profile);
    let added = 0;
    try {
      for (let i = 0; i < slots.length; i += GEN_BATCH) {
        setStatus(T('ppGenerating', { d: i, n: slots.length }));
        try {
          const qs = quizFrom(await API.chat(stylePrompt(profile, slots.slice(i, i + GEN_BATCH)), App.getOriginalText()));
          qs.forEach(q => { q.src = 'paper-style'; });
          added += Quiz.addQuestions(qs);
        } catch (e) { /* keep what earlier batches produced */ }
      }
      status = added ? T('questionsAddedN', { n: added }) : T('chatError');
      App.showToast(status, added ? 'success' : 'error');
    } finally {
      busy = false;
      if (modal.isOpen()) render();
      refreshReady();
    }
  }

  // Re-draw whatever shows the saved profile (used when another screen changes it).
  function refresh() {
    if (modal && modal.isOpen()) render();
    refreshReady();
  }

  function refreshReady() {
    if (typeof Quiz !== 'undefined' && Quiz.isIdle && Quiz.isIdle() && document.getElementById('tab-quiz')) Quiz.renderReady();
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-pp-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.ppAct;
      if (act === 'open') open();
      else if (act === 'analyse') analyse();
      else if (act === 'dist') useDistribution();
      else if (act === 'gen') generateStyled(parseInt(b.dataset.n, 10) || 10);
      else if (act === 'clear') {
        if (!confirm(T('ppClearConfirm'))) return;
        const deck = Decks.getActive();
        if (deck) { delete deck.paperProfile; Decks.touch(deck.id); }
        status = ''; render(); refreshReady();
      }
    });
    document.addEventListener('change', e => {
      if (e.target && e.target.id === 'pp-files') {
        files = Array.from(e.target.files || []).slice(0, 20);
        status = '';
        render();
      }
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

  return {
    // pure
    normName, normalizeTopics, parseDistribution, matchTopic, topicBoost, allocate, planSlots,
    parseAnswerKey, chunkText, parseAnalysis, mergeAnalyses, sanitizeProfile, quizFrom, RESOURCES,
    // deck + UI
    getProfile, saveProfile, refresh, resourcesHtml, readyHtml, weightNoteHtml, makeModal, open, close: () => modal.close(), analyse, generateStyled, useDistribution
  };
})();

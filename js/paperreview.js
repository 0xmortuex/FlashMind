// ===== Post-exam paper review =====
// The student photographs their marked school exam (one or more pages).
// FlashMind OCRs the pages (editable, to fix OCR slips), the AI identifies
// each question, the student's answer, whether it was marked wrong, the marks
// lost, the correct answer and the concept behind it. Lost marks are filed
// into the mistake notebook (with `_given` and a suggested `mtype`), and a
// short report shows marks lost per topic and the three things to fix first,
// with one-click flashcards and practice questions for them. The last few
// reports are kept on the deck (deck.paperReviews) for the Stats tab.
const PaperReview = (() => {
  const MTYPES = ['concept', 'careless', 'misread', 'time'];
  const BATCH_CHARS = 8000;
  const MAX_BATCHES = 5;
  const KEEP = 5;

  // ---------- pure helpers ----------
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, n) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, n || 600);
  const num = (v, lo, hi) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

  function sanitizeItem(x) {
    if (!obj(x)) return null;
    const question = str(x.question);
    if (!question) return null;
    let lost = num(x.lost, 0, 100);
    const max = num(x.max, 0, 100);
    const wrong = x.wrong === true || x.wrong === 'true' || (lost != null && lost > 0);
    if (wrong && !lost) lost = 1; // marked wrong, marks not readable: count one
    const item = {
      n: Number.isInteger(x.n) && x.n > 0 && x.n < 1000 ? x.n : null,
      topic: str(x.topic, 120),
      question,
      given: str(x.given, 400),
      wrong,
      lost: wrong ? Math.round(lost * 100) / 100 : 0,
      max: max || 0,
      correct: str(x.correct),
      concept: str(x.concept, 300),
      mtype: MTYPES.includes(x.mtype) ? x.mtype : (wrong ? 'concept' : '')
    };
    const opts = Array.isArray(x.options) ? x.options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim().slice(0, 300)) : [];
    if (opts.length >= 2 && opts.length <= 6 && Number.isInteger(x.correctIndex) && x.correctIndex >= 0 && x.correctIndex < opts.length) {
      item.options = opts;
      item.correctIndex = x.correctIndex;
    }
    return item;
  }

  // AI JSON → sanitized items.
  function parseReview(raw) {
    const o = Parser.safeParseJSON(raw);
    const items = obj(o) ? (Array.isArray(o.items) ? o.items : Array.isArray(o.questions) ? o.questions : []) : Array.isArray(o) ? o : [];
    return items.map(sanitizeItem).filter(Boolean).slice(0, 80);
  }

  // Marks lost per topic (most first) and the three concepts to fix first
  // (grouped by concept, ranked by marks lost, then by how often).
  function buildReport(items) {
    const all = (items || []).filter(Boolean);
    const wrong = all.filter(i => i.wrong);
    const byTopic = {};
    wrong.forEach(i => {
      const k = i.topic || '—';
      const t = byTopic[k] = byTopic[k] || { topic: k, lost: 0, n: 0 };
      t.lost += i.lost; t.n++;
    });
    const topics = Object.values(byTopic).map(t => ({ ...t, lost: Math.round(t.lost * 100) / 100 })).sort((a, b) => b.lost - a.lost || b.n - a.n);
    const byConcept = new Map();
    wrong.forEach(i => {
      const label = i.concept || i.topic || i.question.slice(0, 80);
      const k = label.toLocaleLowerCase('tr').replace(/\s+/g, ' ');
      const c = byConcept.get(k) || { concept: label, topic: i.topic, lost: 0, n: 0, mtype: i.mtype };
      c.lost += i.lost; c.n++;
      byConcept.set(k, c);
    });
    const fixes = [...byConcept.values()].sort((a, b) => b.lost - a.lost || b.n - a.n).slice(0, 3);
    const totalLost = Math.round(wrong.reduce((s, i) => s + i.lost, 0) * 100) / 100;
    const maxKnown = all.every(i => i.max > 0);
    return { topics, fixes, totalLost, totalMax: maxKnown ? all.reduce((s, i) => s + i.max, 0) : 0, wrongN: wrong.length, n: all.length };
  }

  // Wrong items → mistake-notebook questions (retakeable: multiple-choice
  // when the options were readable, open-ended otherwise).
  function toMistakes(items) {
    return (items || []).filter(i => i && i.wrong).map(i => {
      const base = {
        question: i.question,
        category: i.topic || '',
        explanation: i.concept || '',
        src: 'paper-review',
        _given: i.given || '',
        mtype: MTYPES.includes(i.mtype) ? i.mtype : 'concept'
      };
      if (i.options && Number.isInteger(i.correctIndex)) return Object.assign({ type: 'multiple-choice', options: i.options.slice(), correct: i.correctIndex }, base);
      return Object.assign({
        type: 'open-ended',
        correctAnswer: i.correct || i.concept || '',
        keyPoints: i.concept ? [i.concept] : [],
        maxPoints: 3
      }, base);
    });
  }

  // Page-aware batching of the OCR text for the AI.
  function batches(text) {
    const pages = String(text || '').split(/\n*-{3}\s*(?:Page|Sayfa)\s*\d+\s*-{3}\n*/i).map(p => p.trim()).filter(Boolean);
    const out = [];
    let cur = '';
    pages.forEach(p => {
      if (p.length > BATCH_CHARS) { if (cur) out.push(cur); cur = ''; for (let i = 0; i < p.length; i += BATCH_CHARS) out.push(p.slice(i, i + BATCH_CHARS)); return; }
      if (cur && cur.length + p.length + 2 > BATCH_CHARS) { out.push(cur); cur = ''; }
      cur += (cur ? '\n\n' : '') + p;
    });
    if (cur) out.push(cur);
    return out.slice(0, MAX_BATCHES);
  }

  function sanitizeStored(list) {
    return (Array.isArray(list) ? list : []).filter(obj).map(r => ({
      t: Number.isFinite(r.t) ? r.t : 0,
      title: str(r.title, 160),
      n: Number.isInteger(r.n) ? r.n : 0,
      items: (Array.isArray(r.items) ? r.items : []).map(sanitizeItem).filter(Boolean).slice(0, 40)
    })).filter(r => r.items.length || r.n).slice(-KEEP);
  }

  // ---------- AI ----------
  function reviewPrompt(i, n) {
    return `This is OCR text (page group ${i + 1} of ${n}) of a student's MARKED school exam paper (Turkish 10th grade, lise). ` +
      'OCR may garble words, ticks and crosses. Identify every question you can. For each: its number "n", the curriculum topic (konu) ' +
      '"topic" (short), the question "question" (cleanly restated), the student\'s answer "given", whether the teacher marked it wrong or ' +
      'partly wrong ("wrong": true/false — look for crosses, X, red marks, points like 3/10 or -2), marks lost "lost" and the question\'s ' +
      'maximum marks "max" when written (else 0), the correct answer "correct", the concept behind it in one sentence "concept", and the ' +
      'most likely mistake type "mtype": concept (did not know it), careless (knew it but slipped), misread (misread the question), time ' +
      '(blank or unfinished). If the options of a multiple-choice question are readable add "options" and "correctIndex" (0-based). ' +
      'Same language as the paper.\nReturn ONLY JSON, no other text: {"items":[{"n":1,"topic":"","question":"","given":"","wrong":true,' +
      '"lost":2,"max":5,"correct":"","concept":"","mtype":"concept"}]}';
  }

  // ---------- UI ----------
  function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML.replace(/"/g, '&quot;'); }
  const T = (k, p) => i18n.t(k, p);
  let modal = null;
  let files = [];
  let text = '';
  let busy = false;
  let status = '';
  let report = null; // { title, items, rep }

  function getModal() {
    if (!modal) modal = PastPaper.makeModal('pr-panel');
    return modal;
  }

  function head(title) {
    return `<div class="chk-head"><h3>${title}</h3><button class="btn-icon" data-ex-close aria-label="${esc(T('close'))}">&times;</button></div>`;
  }

  function renderInput() {
    const ta = document.getElementById('pr-text');
    if (ta) text = ta.value;
    getModal().show(`${head('&#128248; ' + T('prTitle'))}
      <div class="ex-scroll">
        <p class="chk-intro">${T('prIntro')}</p>
        <div class="pp-upload">
          <label class="btn-ghost pp-file-btn">&#128247; ${T('prChoose')}
            <input type="file" id="pr-files" accept="image/*,.pdf,application/pdf" multiple hidden></label>
          <span class="pp-files">${files.length ? esc(T('prPages', { n: files.length })) : T('ppNoFiles')}</span>
        </div>
        <textarea id="pr-text" class="pp-text pr-text" rows="7" placeholder="${esc(T('prTextHolder'))}">${esc(text)}</textarea>
        <div class="pp-actions">
          <button class="btn-primary" data-pr-act="analyse" ${busy || !text.trim() ? 'disabled' : ''}>&#128269; ${T('prAnalyse')}</button>
        </div>
        <div class="pp-status" id="pr-status" aria-live="polite">${esc(status)}</div>
      </div>`);
  }

  function setStatus(msg) {
    status = msg || '';
    const el = document.getElementById('pr-status');
    if (el) el.textContent = status;
  }

  async function readFiles() {
    if (busy || !files.length) return;
    busy = true; renderInput();
    let out = '';
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let t;
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          t = (await PDF.extractText(f, (c, n) => setStatus(T('ppReadingPdf', { c, t: n })))).text;
        } else {
          t = await OCR.extractText(f, p => setStatus(T('ppReadingPhoto', { i: i + 1, n: files.length, p: Math.round(p * 100) })));
        }
        out += `--- Page ${i + 1} ---\n${(t || '').trim()}\n\n`;
      }
      text = out.trim();
      status = text.replace(/-{3}\s*Page\s*\d+\s*-{3}/g, '').trim() ? T('prReadDone') : T('ocrEmpty');
    } catch (err) {
      status = T('ocrFailed') + ' ' + (err && err.message ? err.message : '');
    } finally {
      busy = false;
      const ta = document.getElementById('pr-text');
      if (ta) ta.value = text;
      if (getModal().isOpen()) renderInput();
    }
  }

  async function analyse() {
    const ta = document.getElementById('pr-text');
    if (ta) text = ta.value;
    if (busy || !text.trim()) return;
    busy = true; renderInput();
    const groups = batches(text);
    const items = [];
    let failed = 0;
    try {
      for (let i = 0; i < groups.length; i++) {
        setStatus(T('prAnalysing', { i: i + 1, n: groups.length }));
        try { items.push(...parseReview(await API.chat(reviewPrompt(i, groups.length), groups[i]))); }
        catch (e) { failed++; }
      }
      if (!items.length) { status = failed ? T('chatError') : T('prNoItems'); return; }
      const title = (files.length ? T('prPages', { n: files.length }) : T('ppPasted')) + ' · ' + new Date().toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US');
      const mistakes = toMistakes(items);
      if (mistakes.length) Decks.addMistakes(mistakes);
      const deck = Decks.getActive();
      if (deck) {
        const wrong = items.filter(i => i.wrong);
        deck.paperReviews = sanitizeStored(deck.paperReviews).concat([{ t: Date.now(), title, n: items.length, items: wrong.slice(0, 40) }]).slice(-KEEP);
        Decks.touch(deck.id);
      }
      report = { title, items, rep: buildReport(items), filed: mistakes.length };
      files = []; text = ''; status = '';
      busy = false;
      renderReport();
      if (typeof Quiz !== 'undefined' && Quiz.isIdle && Quiz.isIdle()) Quiz.renderReady();
      return;
    } finally {
      busy = false;
      if (!report && getModal().isOpen()) renderInput();
    }
  }

  function mtLabel(k) { return k ? T('mt_' + k) : ''; }

  function reportHtml(r) {
    const rep = r.rep;
    const maxLost = Math.max(1, ...rep.topics.map(t => t.lost));
    return `<div class="pr-report">
      <p class="pr-summary">${rep.wrongN
        ? T(rep.totalMax ? 'prSummaryMax' : 'prSummary', { l: rep.totalLost, m: rep.totalMax, w: rep.wrongN, n: rep.n })
        : T('prAllRight', { n: rep.n })}</p>
      ${r.filed ? `<p class="pr-filed">&#128213; ${T('prFiled', { n: r.filed })}</p>` : ''}
      ${rep.topics.length ? `<div class="pp-sub">${T('prByTopic')}</div>
        ${rep.topics.map(t => `<div class="qb-row"><span class="qb-name">${esc(t.topic)}</span>
          <span class="qb-bar"><span class="qb-fill bad" style="width:${Math.round(t.lost / maxLost * 100)}%"></span></span>
          <span class="qb-score">-${t.lost}</span></div>`).join('')}` : ''}
      ${rep.fixes.length ? `<div class="pp-sub">${T('prFixFirst')}</div>
        <ol class="pr-fixes">${rep.fixes.map(f => `<li><b>${esc(f.concept)}</b>
          <span class="pr-fix-meta">${f.topic ? esc(f.topic) + ' · ' : ''}-${Math.round(f.lost * 100) / 100} · ${esc(mtLabel(f.mtype))}</span></li>`).join('')}</ol>
        <div class="pp-actions">
          <button class="btn-primary" data-pr-act="cards" ${busy ? 'disabled' : ''}>&#127183; ${T('prMakeCards')}</button>
          <button class="btn-ghost" data-pr-act="practise" ${busy ? 'disabled' : ''}>&#127919; ${T('prPractise')}</button>
        </div>` : ''}
      <div class="pp-status" id="pr-status" aria-live="polite">${esc(status)}</div>
      ${rep.wrongN ? `<details class="pr-items"><summary>${T('prDetails', { n: rep.wrongN })}</summary>
        ${r.items.filter(i => i.wrong).map(i => `<div class="pr-item">
          <p class="pr-q">${i.n ? i.n + '. ' : ''}${esc(i.question)}</p>
          ${i.given ? `<p class="review-answer your-wrong">${T('yourAnswer')} ${esc(i.given)}</p>` : ''}
          ${i.correct ? `<p class="review-answer correct-answer">${T('correct')} ${esc(i.correct)}</p>` : ''}
          ${i.concept ? `<p class="review-explanation">${esc(i.concept)}</p>` : ''}
        </div>`).join('')}</details>` : ''}
    </div>`;
  }

  function renderReport() {
    if (!report) return;
    getModal().show(`${head('&#128202; ' + T('prReportTitle'))}
      <div class="ex-scroll">
        <p class="chk-intro">${esc(report.title)}</p>
        ${reportHtml(report)}
        <div class="pp-actions"><button class="btn-ghost" data-pr-act="new">${T('prAnother')}</button></div>
      </div>`);
  }

  function open() {
    report = null; status = '';
    renderInput();
  }

  function openLast() {
    const deck = Decks.getActive();
    const last = deck ? sanitizeStored(deck.paperReviews).slice(-1)[0] : null;
    if (!last) return;
    report = { title: last.title, items: last.items, rep: buildReport(last.items), filed: 0 };
    report.rep.n = last.n || report.rep.n;
    status = '';
    renderReport();
  }

  function weakItems() {
    return report ? report.items.filter(i => i.wrong).sort((a, b) => b.lost - a.lost).slice(0, 8) : [];
  }

  function listing(items) {
    return items.map((i, k) => `${k + 1}. [${i.topic || '-'}] ${i.question}\n   Correct: ${i.correct || '?'}\n   Concept: ${i.concept || '?'}\n   Student wrote: ${i.given || '(blank)'}`).join('\n');
  }

  async function makeCards() {
    const items = weakItems();
    if (busy || !items.length) return;
    busy = true; renderReport(); setStatus(T('generatingMore'));
    let cards = [];
    try {
      const raw = await API.chat('A student lost marks on these questions of a real school exam. Make one or two clear flashcards per ' +
        'concept so they will not lose these marks again (front: a precise question, back: the short correct answer with the key reason). ' +
        'Same language as the questions, at most 12 cards. Return ONLY JSON, no other text: ' +
        '{"type":"flashcards","flashcards":[{"front":"","back":"","difficulty":"medium","category":""}]}\n\n' + listing(items), App.getOriginalText());
      const o = Parser.safeParseJSON(raw);
      cards = Parser.normalizeStudyData({ flashcards: obj(o) ? o.flashcards : [] }).flashcards;
    } catch (e) { /* fall back to cards built from the report */ }
    if (!cards.length) {
      cards = Parser.normalizeStudyData({ flashcards: items.map(i => ({ front: i.question, back: [i.correct, i.concept].filter(Boolean).join(' — ') || '?', category: i.topic || 'Exam review' })) }).flashcards;
    }
    cards.forEach(c => { delete c.id; });
    busy = false;
    if (!cards.length) { renderReport(); return; }
    Flashcards.addCards(cards);
    App.showToast(T('prCardsAdded', { n: cards.length }), 'success');
    getModal().close();
    App.switchTab('flashcards');
  }

  async function practise() {
    const items = weakItems().slice(0, 6);
    if (busy || !items.length) return;
    busy = true; renderReport(); setStatus(T('generatingMore'));
    let qs = [];
    try {
      const raw = await API.chat('A student lost marks on these questions of a real school exam. For EACH one write 2 NEW similar exam ' +
        'questions that test the same concept from a slightly different angle (multiple-choice with 5 options A–E, true-false or fill-blank; ' +
        'Turkish lise style). Set "category" to the topic. Same language as the questions. Return ONLY JSON, no other text: ' +
        '{"type":"quiz","quiz":[{"type":"multiple-choice","question":"","options":["","","","",""],"correct":0,"category":"","explanation":""}]}\n\n' +
        listing(items), App.getOriginalText());
      qs = PastPaper.quizFrom(raw);
    } catch (e) { /* handled below */ }
    busy = false;
    if (!qs.length) { status = T('chatError'); renderReport(); return; }
    qs.forEach(q => { q.src = 'paper-review'; });
    Quiz.addQuestions(qs);
    getModal().close();
    App.switchTab('quiz');
    Quiz.startQuiz(qs);
  }

  // Stats tab card: the latest reviewed paper at a glance.
  function statsCard() {
    if (typeof Decks === 'undefined') return '';
    const deck = Decks.getActive();
    const last = deck ? sanitizeStored(deck.paperReviews).slice(-1)[0] : null;
    if (!last) return '';
    const rep = buildReport(last.items);
    return `<div class="stat-card pr-stat">
      <h3 class="stat-card-title">${T('prStatTitle')}</h3>
      <p class="plan-pitch">${esc(last.title)} — ${T('prStatLine', { l: rep.totalLost, w: rep.wrongN })}</p>
      ${rep.fixes.length ? `<ol class="pr-fixes">${rep.fixes.map(f => `<li>${esc(f.concept)}</li>`).join('')}</ol>` : ''}
      <button class="btn-ghost" data-pr-act="last">${T('prOpenReport')}</button>
    </div>`;
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-pr-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.prAct;
      if (act === 'open' || act === 'new') open();
      else if (act === 'analyse') analyse();
      else if (act === 'cards') makeCards();
      else if (act === 'practise') practise();
      else if (act === 'last') openLast();
    });
    document.addEventListener('change', e => {
      if (e.target && e.target.id === 'pr-files') {
        files = Array.from(e.target.files || []).slice(0, 12);
        if (files.length) readFiles();
      }
    });
    document.addEventListener('input', e => {
      if (e.target && e.target.id === 'pr-text') {
        const btn = document.querySelector('[data-pr-act="analyse"]');
        if (btn && !busy) btn.disabled = !e.target.value.trim();
      }
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

  return { parseReview, buildReport, toMistakes, batches, sanitizeStored, sanitizeItem, statsCard, open, openLast };
})();

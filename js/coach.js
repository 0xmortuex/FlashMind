// ===== Autopilot coach =====
// "What should I do now?" — one button (home, study topbar, command palette)
// that picks the best next ~20-minute session across all decks and launches
// it, with a one-line reason. The decision is a deterministic scoring of
// candidate sessions (no AI call): exam dates (pressure), due load, the
// predictor's marks-per-minute ranking, filed mistakes, confidence
// calibration (deck.calib) and time since the last exam practice. After a
// coach session ends, the next step is suggested.
const Coach = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const KEY = 'flashmind_coach_v1';
  const SESSION_MIN = 20;
  const CARD_KINDS = ['review', 'marks', 'new', 'over'];

  // ----- Pure: deck summary -----
  // Everything decide() needs about one deck. Uses Planner/Predictor/Insights
  // when loaded; P is the memory model.
  function summarize(deck, now, P) {
    const data = deck.data || {};
    const cards = Array.isArray(data.flashcards) ? data.flashcards : [];
    const srs = deck.srs || {};
    const plan = typeof Planner !== 'undefined' ? Planner.plan(deck, now) : null;
    const seen = cards.filter(c => srs[c.id] && srs[c.id].reps);
    const due = seen.filter(c => srs[c.id].due <= now).length;
    let lastPractice = 0;
    Object.values(deck.qstats || {}).forEach(s => { if (s && s.t > lastPractice) lastPractice = s.t; });
    let sureN = 0, sureOk = 0, over = 0;
    if (typeof Insights !== 'undefined') {
      const cal = Insights.calibration(deck);
      sureOk = cal.levels.sure[0]; sureN = sureOk + cal.levels.sure[1];
      const ids = new Set(cards.map(c => String(c.id)));
      over = cal.over.filter(o => ids.has(String(o.id))).length;
    }
    const daysLeft = plan ? plan.daysLeft : null;
    const examSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
    const rank = examSoon && typeof Predictor !== 'undefined' ? Predictor.rank(deck, now, P, SESSION_MIN) : null;
    const sections = data.notes && Array.isArray(data.notes.sections) ? data.notes.sections.length : 0;
    // Video-lesson slides the student got wrong or asked to have explained again, not yet practised.
    let weak = 0;
    (Array.isArray(data.lessons) ? data.lessons : []).forEach(l => Object.keys(l.checks || {}).forEach(k => {
      if (['wrong', 'lost'].includes(l.checks[k]) && l.slides && l.slides[+k] && l.slides[+k].check) weak++;
    }));
    return {
      weak,
      id: deck.id, title: data.title || '',
      daysLeft, cards: cards.length, unseen: cards.length - seen.length, due,
      todayNew: plan ? plan.todayNew : 0,
      questions: Array.isArray(data.quiz) ? data.quiz.length : 0,
      mistakes: Array.isArray(deck.mistakes) ? deck.mistakes.length : 0,
      lastPractice, sureN, sureAcc: sureN ? sureOk / sureN : 1, over,
      hasMap: !!(data.notes && (data.notes.mindmap || sections >= 2)),
      gain20: rank ? rank.marks : 0
    };
  }

  // ----- Pure: the decision -----
  // ctx: { now, decks: [summary], caps: { voice }, recent: [{k, d}], activeId }
  // Returns { kind, deckId, score, why: { key, p } } — kind is one of
  // review | marks | new | mistakes | adaptive | voice | over | mindmap | rest | none.
  function decide(ctx) {
    const now = ctx.now;
    const decks = (ctx.decks || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!decks.length) return { kind: 'none', deckId: null, score: 0, why: { key: 'coachWhyNone', p: {} } };
    const recent = ctx.recent || [];
    const last = recent[0];
    const cands = [];
    const push = (kind, deckId, score, key, p) => {
      // Don't repeat the session that just finished straight away.
      if (last && last.k === kind && (last.d || null) === (deckId || null)) score *= 0.5;
      cands.push({ kind, deckId: deckId || null, score: Math.round(score * 1000) / 1000, why: { key, p: p || {} } });
    };
    const pressure = d => d.daysLeft === null || d.daysLeft < 0 ? 1 : 1 + 4 / (d.daysLeft + 1);
    const soon = d => d.daysLeft !== null && d.daysLeft >= 0 && d.daysLeft <= 30;

    // Everything due, across decks.
    const dueTotal = decks.reduce((a, d) => a + d.due, 0);
    if (dueTotal > 0) push('review', null, 1 + Math.min(dueTotal, 80) / 12, 'coachWhyReview', { n: dueTotal });

    decks.forEach(d => {
      const pr = pressure(d);
      const title = d.title;
      // Exam coming: the cards that add the most marks per minute.
      if (soon(d) && d.gain20 > 0.05) {
        push('marks', d.id, pr * (1 + Math.log1p(d.gain20) / 1.5), d.daysLeft <= 1 ? 'coachWhyMarksUrgent' : 'coachWhyMarks',
          { m: d.gain20.toFixed(1), t: title, d: d.daysLeft });
      }
      // No exam: keep learning new cards (a little extra for the open deck).
      if (!soon(d) && d.unseen > 0) {
        push('new', d.id, 1 + Math.min(d.unseen, 20) / 20 + (ctx.activeId === d.id ? 0.3 : 0), 'coachWhyNew', { n: Math.min(d.unseen, 25), t: title });
      }
      // Filed wrong answers.
      if (d.mistakes >= 3) {
        push('mistakes', d.id, (1 + Math.min(d.mistakes, 20) / 6) * (soon(d) ? pr : 0.9), 'coachWhyMistakes', { n: d.mistakes, t: title });
      }
      // Slides of a video lesson the student found hard: they are one tap from practice.
      if (d.weak > 0) {
        push('weak', d.id, (1.2 + Math.min(d.weak, 6) / 4) * (soon(d) ? Math.min(pr, 2.5) : 1), 'coachWhyWeak', { n: d.weak, t: title });
      }
      // Exam practice gone stale.
      if (d.questions >= 4) {
        const stale = d.lastPractice ? (now - d.lastPractice) / DAY : 7;
        const p = { d: Math.round(Math.min(stale, 99)), t: title, never: d.lastPractice ? 0 : 1 };
        const key = d.lastPractice ? 'coachWhyAdaptive' : 'coachWhyAdaptiveNever';
        if (soon(d) && d.daysLeft <= 21) push('adaptive', d.id, pr * (0.5 + Math.min(stale, 7) / 3), key, p);
        else if (stale >= 3) push('adaptive', d.id, 0.5 + Math.min(stale, 7) / 4, key, p);
      }
      // Overconfidence: sure but wrong too often — say it out loud, or drill
      // exactly those cards.
      if (d.sureN >= 8 && d.sureAcc < 0.8) {
        const s = 1.5 + (0.8 - d.sureAcc) * 10;
        const p = { p: Math.round(d.sureAcc * 100), t: title };
        if (ctx.caps && ctx.caps.voice) push('voice', d.id, s, 'coachWhyVoice', p);
        else if (d.over > 0) push('over', d.id, s, 'coachWhyOver', p);
      }
      // Variety: after two card sessions in a row, a big-picture pass.
      if (d.hasMap && recent.length >= 2 && CARD_KINDS.includes(recent[0].k) && CARD_KINDS.includes(recent[1].k)) {
        push('mindmap', d.id, 2.5 * (pr > 2 ? 0.6 : 1), 'coachWhyMap', { t: title });
      }
    });
    push('rest', null, 0.8, 'coachWhyRest', {});

    let best = cands[0];
    cands.forEach(c => { if (c.score > best.score) best = c; });
    return best;
  }

  // ----- History -----
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s && Array.isArray(s.recent) ? s : { recent: [] };
    } catch (e) { return { recent: [] }; }
  }
  function remember(kind, deckId) {
    const s = loadState();
    s.recent = [{ k: kind, d: deckId || null, t: Date.now() }].concat(s.recent.filter(r => r && typeof r.k === 'string')).slice(0, 5);
    s.active = { k: kind, d: deckId || null, t: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* per-device convenience */ }
  }

  // ----- Context from the live library -----
  function context() {
    const now = Date.now();
    const P = typeof Memory !== 'undefined' ? Memory.ensure() : null;
    const active = Decks.getActive();
    return {
      now,
      decks: Decks.list().map(d => summarize(d, now, P && P.fitted ? P : null)),
      caps: { voice: typeof Voice !== 'undefined' && Voice.supported() },
      recent: loadState().recent,
      activeId: active ? active.id : null
    };
  }

  // ----- Launching -----
  function ensureOpen(deckId) {
    const active = Decks.getActive();
    const studyOpen = document.getElementById('study-view') && document.getElementById('study-view').classList.contains('active');
    if (!active || active.id !== deckId || !studyOpen) App.openDeck(deckId);
  }

  function tag(deck, cards) {
    const active = Decks.getActive();
    const local = active && active.id === deck.id;
    const title = (deck.data && deck.data.title) || '';
    return cards.map(c => local ? Object.assign({}, c) : Object.assign({}, c, { _deckId: deck.id, _deckTitle: title }));
  }

  function reviewItems(now) {
    // Most-forgotten first, capped to roughly one 20-minute block.
    return Decks.dueAcrossDecks().map(x => {
      const d = Decks.get(x.deckId);
      const s = d && d.srs ? d.srs[x.card.id] : null;
      return { x, r: s ? Decks.retrievability(Math.max(0, (now - s.last) / DAY), s.stab) : 1 };
    }).sort((a, b) => a.r - b.r).slice(0, 80)
      .map(({ x }) => Object.assign({}, x.card, { _deckId: x.deckId, _deckTitle: x.deckTitle }));
  }

  function launch(choice) {
    const deck = choice.deckId ? Decks.get(choice.deckId) : null;
    const cards = deck && deck.data && Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
    switch (choice.kind) {
      case 'review': Flashcards.startQueue(reviewItems(Date.now())); break;
      case 'marks': Predictor.startBest(choice.deckId, SESSION_MIN); break;
      case 'new': {
        const srs = deck.srs || {};
        Flashcards.startQueue(tag(deck, cards.filter(c => !(srs[c.id] && srs[c.id].reps)).slice(0, 25)));
        break;
      }
      case 'over': {
        const ids = new Set(Insights.calibration(deck).over.map(o => String(o.id)));
        Flashcards.startQueue(tag(deck, cards.filter(c => ids.has(String(c.id)))));
        break;
      }
      case 'weak': ensureOpen(choice.deckId); VideoLesson.practiseAllWeak(); break;
      case 'mistakes': ensureOpen(choice.deckId); App.switchTab('quiz'); Quiz.startQuiz(Decks.getMistakes()); break;
      case 'adaptive': ensureOpen(choice.deckId); App.switchTab('quiz'); Quiz.startAdaptive(); break;
      case 'voice': ensureOpen(choice.deckId); App.switchTab('chat'); Voice.open('quiz'); break;
      case 'mindmap': ensureOpen(choice.deckId); App.switchTab('notes'); Notes.showView('map'); break;
      default: break;
    }
  }

  function reason(choice) { return i18n.t(choice.why.key, choice.why.p); }

  let busy = false;
  function go() {
    if (busy || typeof Decks === 'undefined') return;
    busy = true;
    hideNext();
    try {
      const choice = decide(context());
      if (choice.kind === 'none' || choice.kind === 'rest') { App.showToast(reason(choice), 'info'); return; }
      remember(choice.kind, choice.deckId);
      launch(choice);
      App.showToast('🧭 ' + reason(choice), 'info');
    } finally { busy = false; }
  }

  // ----- "Next step" after a coach session -----
  let nextEl = null, nextChoice = null;
  function hideNext() { if (nextEl) nextEl.style.display = 'none'; nextChoice = null; }

  function onSessionEnd() {
    const s = loadState();
    if (!s.active || Date.now() - s.active.t > 3 * 60 * 60 * 1000) return;
    s.active = null;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    const choice = decide(context());
    if (choice.kind === 'none') return;
    showNext(choice);
  }

  function showNext(choice) {
    const T = i18n.t;
    if (!nextEl) {
      nextEl = document.createElement('div');
      nextEl.className = 'coach-next';
      nextEl.setAttribute('role', 'status');
      document.body.appendChild(nextEl);
    }
    nextChoice = choice;
    const rest = choice.kind === 'rest';
    nextEl.innerHTML = `<span class="coach-next-icon" aria-hidden="true">&#129517;</span>
      <span class="coach-next-text"><strong>${esc(T('coachNext'))}</strong> ${esc(reason(choice))}</span>
      ${rest ? '' : `<button class="btn-primary" data-coach-act="next">${esc(T('coachGo'))}</button>`}
      <button class="btn-ghost coach-next-x" data-coach-act="dismiss" aria-label="${esc(T('close'))}">&#10005;</button>`;
    nextEl.style.display = 'flex';
  }

  function runNext() {
    const choice = nextChoice;
    if (!choice) return;
    hideNext();
    // Close the session-complete overlay / results before launching.
    const dc = document.getElementById('deck-complete-overlay');
    if (dc && dc.style.display === 'flex') { const x = document.getElementById('study-mode-close'); dc.style.display = 'none'; if (x) x.click(); }
    remember(choice.kind, choice.deckId);
    launch(choice);
    App.showToast('🧭 ' + reason(choice), 'info');
  }

  // ----- Buttons -----
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function homeHtml() {
    const T = i18n.t;
    return `<div class="coach-home">
      <span class="coach-home-text"><strong>&#129517; ${T('coachAsk')}</strong><small>${T('coachHomeHint')}</small></span>
      <button class="btn-primary coach-go-btn" data-coach-act="go">${T('coachBtn')}</button>
    </div>`;
  }

  function addTopbarButton() {
    const bar = document.querySelector('#study-view .topbar-actions');
    if (!bar || bar.querySelector('.coach-btn')) return;
    const b = document.createElement('button');
    b.className = 'btn-ghost coach-btn';
    b.dataset.coachAct = 'go';
    b.title = i18n.t('coachAsk');
    b.innerHTML = `<span aria-hidden="true">&#129517;</span><span class="btn-label">${esc(i18n.t('coachBtnShort'))}</span>`;
    bar.insertBefore(b, bar.firstChild);
  }

  function init() {
    addTopbarButton();
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-coach-act]');
      if (!b) return;
      const a = b.dataset.coachAct;
      if (a === 'go') go();
      else if (a === 'next') runNext();
      else if (a === 'dismiss') hideNext();
    });
    document.addEventListener('fm:session-end', () => setTimeout(onSessionEnd, 50));
    // Warm the memory model off the critical path.
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 2500));
    idle(() => { try { if (typeof Memory !== 'undefined') Memory.ensure(); } catch (e) { /* best effort */ } });
  }

  return { init, summarize, decide, go, homeHtml, context, showNext, launch };
})();

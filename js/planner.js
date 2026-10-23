// ===== Exam Planner =====
// Per-deck exam date → a day-by-day study plan. FSRS already pulls reviews
// forward so every card comes up before the exam (Decks.capForExam); this
// module spreads the never-seen cards across the days left, estimates
// readiness on exam day, and renders the plan in the Flashcards tab, the
// Stats tab, and the deck library.
const Planner = (() => {
  const DAY = 24 * 60 * 60 * 1000;

  function startOfDay(t) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function dateKey(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Pure plan computation (no DOM) — covered by the regression suite.
  function plan(deck, now = Date.now()) {
    if (!deck || !deck.examDate) return null;
    const exam = Decks.examStart(deck.examDate);
    if (!exam) return null;
    const today0 = startOfDay(now);
    const daysLeft = Math.round((exam - today0) / DAY); // 0 = exam is today
    const cards = deck.data && Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
    const srs = deck.srs || {};
    const seen = c => { const s = srs[c.id]; return !!(s && s.reps); };
    const unseen = cards.filter(c => !seen(c));
    const learnedToday = cards.filter(c => { const s = srs[c.id]; return s && s.first >= today0; }).length;
    // The last day before the exam is kept for a full review, so new cards
    // are spread over the days before it.
    const studyDays = Math.max(1, daysLeft - 1);
    const unseenStart = unseen.length + learnedToday;
    const newPerDay = daysLeft > 0 && unseenStart ? Math.ceil(unseenStart / studyDays) : 0;
    const todayNew = daysLeft > 0 ? Math.min(unseen.length, Math.max(0, newPerDay - learnedToday)) : 0;
    const dueNow = cards.filter(c => { const s = srs[c.id]; return s && s.reps && s.due <= now; });

    const schedule = [];
    let remaining = unseen.length - todayNew;
    for (let i = 0; i < Math.min(Math.max(daysLeft, 0), 14); i++) {
      const from = today0 + i * DAY, to = from + DAY;
      const reviews = cards.filter(c => {
        const s = srs[c.id];
        if (!s || !s.reps) return false;
        return i === 0 ? s.due < to : s.due >= from && s.due < to;
      }).length;
      let fresh = 0;
      if (i === 0) fresh = todayNew;
      else if (i < studyDays) { fresh = Math.min(newPerDay, remaining); remaining -= fresh; }
      schedule.push({ date: dateKey(from), newCards: fresh, reviews, final: i === daysLeft - 1 && daysLeft > 1 });
    }

    // Readiness: mean predicted recall at the exam if studying stopped now
    // (never-seen cards count as 0).
    let recall = 0;
    cards.forEach(c => {
      const s = srs[c.id];
      if (!s || !s.reps || !s.stab) return;
      const t = Math.max(0, (exam - (s.last || now)) / DAY);
      recall += Decks.retrievability(t, s.stab);
    });
    const readiness = cards.length ? Math.round((recall / cards.length) * 100) : 0;

    return {
      examDate: deck.examDate, exam, daysLeft, total: cards.length,
      learned: cards.length - unseen.length, unseen: unseen.length,
      learnedToday, newPerDay, todayNew, dueNow: dueNow.length, schedule, readiness,
      todayCards: dueNow.concat(unseen.slice(0, todayNew))
    };
  }

  // ----- UI helpers -----

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function countdownLabel(p) {
    const T = i18n.t;
    if (p.daysLeft < 0) return T('planExamPassed');
    if (p.daysLeft === 0) return T('planExamToday');
    if (p.daysLeft === 1) return T('planExamTomorrow');
    return T('planExamIn', { n: p.daysLeft });
  }

  function fmtDate(key, opts) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function todayLine(p) {
    const T = i18n.t;
    if (p.daysLeft < 0) return '';
    if (!p.todayNew && !p.dueNow) return `<span class="plan-today done">${T('planDone')}</span>`;
    return `<span class="plan-today">${T('planToday', { n: p.todayNew, d: p.dueNow })}</span>`;
  }

  function actionButtons(deckId, p) {
    const T = i18n.t;
    let html = '';
    if (p.daysLeft >= 0 && (p.todayNew || p.dueNow)) {
      html += `<button class="btn-primary plan-start-btn" data-plan-act="start" data-deck="${esc(deckId)}">${T('planStart')}</button>`;
    }
    if (p.daysLeft >= 0 && p.daysLeft <= 1) {
      html += `<button class="btn-ghost" data-plan-act="cram" data-deck="${esc(deckId)}">&#9889; ${T('planCramNow')}</button>`;
    }
    return html;
  }

  // Compact bar at the top of the Flashcards tab.
  function flashcardsBar() {
    const deck = typeof Decks !== 'undefined' ? Decks.getActive() : null;
    if (!deck) return '';
    const T = i18n.t;
    const p = plan(deck);
    if (!p) {
      return `<div class="plan-bar plan-bar-empty">
        <span>&#128197; ${T('planPitch')}</span>
        <button class="btn-ghost" data-plan-act="date" data-deck="${esc(deck.id)}">${T('planSetDate')}</button>
      </div>`;
    }
    return `<div class="plan-bar${p.daysLeft >= 0 && p.daysLeft <= 3 ? ' urgent' : ''}">
      <span class="plan-countdown">&#128197; ${countdownLabel(p)}</span>
      ${todayLine(p)}
      <span class="plan-bar-actions">
        ${actionButtons(deck.id, p)}
        <button class="btn-ghost" data-plan-act="date" data-deck="${esc(deck.id)}" title="${T('planEdit')}">&#9998;</button>
      </span>
    </div>`;
  }

  // Full plan card for the Stats tab.
  function statsCard() {
    const deck = typeof Decks !== 'undefined' ? Decks.getActive() : null;
    if (!deck) return '';
    const T = i18n.t;
    const p = plan(deck);
    if (!p) {
      return `<div class="stat-card plan-card">
        <h3 class="stat-card-title">${T('planTitle')}</h3>
        <p class="plan-pitch">${T('planDateHint')}</p>
        <button class="btn-primary" data-plan-act="date" data-deck="${esc(deck.id)}">&#128197; ${T('planSetDate')}</button>
      </div>`;
    }
    const pct = p.total ? Math.round((p.learned / p.total) * 100) : 0;
    let rows = '';
    p.schedule.forEach((d, i) => {
      rows += `<div class="plan-row${i === 0 ? ' today' : ''}${d.final ? ' final' : ''}">
        <span class="plan-row-date">${i === 0 ? T('todayLabel') : fmtDate(d.date)}</span>
        <span class="plan-row-new">${d.newCards ? '+' + d.newCards : '—'}</span>
        <span class="plan-row-rev">${d.reviews || '—'}</span>
        <span class="plan-row-note">${d.final ? T('planFinalDay') : ''}</span>
      </div>`;
    });
    if (p.daysLeft > 0 && p.daysLeft <= 14) {
      rows += `<div class="plan-row exam"><span class="plan-row-date">${fmtDate(p.examDate)}</span><span class="plan-row-note">&#127891; ${T('planExamDay')}</span></div>`;
    }
    return `<div class="stat-card plan-card">
      <div class="plan-card-head">
        <h3 class="stat-card-title">${T('planTitle')}</h3>
        <span class="plan-countdown">${countdownLabel(p)} &middot; ${fmtDate(p.examDate, { day: 'numeric', month: 'long' })}</span>
      </div>
      <div class="plan-metrics">
        <div class="plan-metric"><span class="plan-metric-value">${p.readiness}%</span><span class="plan-metric-label" title="${T('planReadinessHint')}">${T('planReadiness')}</span></div>
        <div class="plan-metric"><span class="plan-metric-value">${p.learned}/${p.total}</span><span class="plan-metric-label">${T('planLearned')} (${pct}%)</span></div>
        <div class="plan-metric"><span class="plan-metric-value">${p.newPerDay}</span><span class="plan-metric-label">${T('planNewPerDay')}</span></div>
      </div>
      <div class="plan-meter" role="img" aria-label="${T('planReadiness')} ${p.readiness}%"><span style="width:${p.readiness}%"></span></div>
      ${p.schedule.length ? `<div class="plan-table">
        <div class="plan-row head"><span>${T('planColDay')}</span><span>${T('planColNew')}</span><span>${T('planColReview')}</span><span></span></div>
        ${rows}
      </div>` : ''}
      <div class="plan-actions">
        ${actionButtons(deck.id, p)}
        <button class="btn-ghost" data-plan-act="date" data-deck="${esc(deck.id)}">${T('planEdit')}</button>
        <button class="btn-ghost" data-plan-act="clear" data-deck="${esc(deck.id)}">${T('planClear')}</button>
      </div>
    </div>`;
  }

  // "Upcoming exams" strip on the home screen library.
  function libraryStrip() {
    if (typeof Decks === 'undefined') return '';
    const T = i18n.t;
    const upcoming = Decks.list()
      .map(d => ({ d, p: plan(d) }))
      .filter(x => x.p && x.p.daysLeft >= 0)
      .sort((a, b) => a.p.exam - b.p.exam)
      .slice(0, 4);
    if (!upcoming.length) return '';
    return `<div class="plan-strip">
      <div class="plan-strip-title">&#128197; ${T('planUpcoming')}</div>
      ${upcoming.map(({ d, p }) => `<div class="plan-strip-row">
        <span class="plan-strip-days${p.daysLeft <= 3 ? ' urgent' : ''}">${p.daysLeft === 0 ? T('todayLabel') : T('planDaysShort', { n: p.daysLeft })}</span>
        <span class="plan-strip-name">${esc((d.data && d.data.title) || T('importedSet'))}</span>
        ${todayLine(p)}
        ${(p.todayNew || p.dueNow) ? `<button class="btn-ghost" data-plan-act="start" data-deck="${esc(d.id)}">${T('planStart')}</button>` : ''}
      </div>`).join('')}
    </div>`;
  }

  // Badge for a deck card in the library.
  function deckBadge(deck) {
    const p = plan(deck);
    if (!p || p.daysLeft < 0) return '';
    return `<span class="deck-card-exam${p.daysLeft <= 3 ? ' urgent' : ''}" title="${esc(countdownLabel(p))}">&#128197; ${p.daysLeft === 0 ? i18n.t('todayLabel') : i18n.t('planDaysShort', { n: p.daysLeft })}</span>`;
  }

  // ----- Actions -----

  function startToday(deckId) {
    const deck = Decks.get(deckId);
    const p = plan(deck);
    if (!p || !p.todayCards.length) { App.showToast(i18n.t('planNothingToday'), 'info'); return; }
    const active = Decks.getActive();
    const local = active && active.id === deckId;
    const title = (deck.data && deck.data.title) || '';
    // Cards of a non-active deck carry their deck id so ratings land there.
    const items = p.todayCards.map(c => local ? Object.assign({}, c) : Object.assign({}, c, { _deckId: deckId, _deckTitle: title }));
    Flashcards.startQueue(items);
  }

  function cram(deckId) {
    const active = Decks.getActive();
    if (!active || active.id !== deckId) App.openDeck(deckId, true);
    App.switchTab('flashcards');
    Flashcards.startStudy('cram');
  }

  let pickerEl = null, releaseTrap = null, pickerDeck = null;

  function openDatePicker(deckId) {
    const T = i18n.t;
    const deck = Decks.get(deckId);
    if (!deck) return;
    pickerDeck = deckId;
    if (!pickerEl) {
      pickerEl = document.createElement('div');
      pickerEl.className = 'shortcuts-backdrop';
      pickerEl.style.display = 'none';
      document.body.appendChild(pickerEl);
      pickerEl.addEventListener('click', e => { if (e.target === pickerEl) closePicker(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && pickerEl.style.display !== 'none') closePicker(); });
    }
    pickerEl.innerHTML = `<div class="shortcuts-card plan-picker" role="dialog" aria-modal="true" aria-labelledby="plan-picker-title">
      <h3 id="plan-picker-title">&#128197; ${T('planDateTitle')}</h3>
      <p class="plan-picker-deck">${esc((deck.data && deck.data.title) || '')}</p>
      <input type="date" id="plan-date-input" class="editor-input" min="${dateKey(Date.now())}" value="${esc(deck.examDate || '')}">
      <p class="plan-picker-hint">${T('planDateHint')}</p>
      <div class="editor-actions">
        ${deck.examDate ? `<button class="btn-ghost editor-danger" id="plan-date-clear">${T('planClear')}</button>` : ''}
        <span class="editor-actions-spacer"></span>
        <button class="btn-ghost" id="plan-date-cancel">${T('cancel')}</button>
        <button class="btn-primary" id="plan-date-save">${T('planSave')}</button>
      </div>
    </div>`;
    pickerEl.style.display = 'flex';
    releaseTrap = FX.trapFocus(pickerEl);
    const input = pickerEl.querySelector('#plan-date-input');
    input.focus();
    pickerEl.querySelector('#plan-date-cancel').addEventListener('click', closePicker);
    pickerEl.querySelector('#plan-date-save').addEventListener('click', () => {
      if (!input.value) { App.showToast(T('planPickDate'), 'error'); return; }
      Decks.setExamDate(pickerDeck, input.value);
      closePicker();
      refresh();
      App.showToast(T('planSaved'), 'success');
    });
    const clr = pickerEl.querySelector('#plan-date-clear');
    if (clr) clr.addEventListener('click', () => { clearDate(pickerDeck); closePicker(); });
  }

  function closePicker() {
    if (!pickerEl) return;
    pickerEl.style.display = 'none';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  }

  function clearDate(deckId) {
    Decks.setExamDate(deckId, '');
    refresh();
    App.showToast(i18n.t('planCleared'), 'info');
  }

  function refresh() {
    if (typeof Flashcards !== 'undefined') Flashcards.render(false);
    const statsTab = document.getElementById('tab-stats');
    if (statsTab && statsTab.classList.contains('active') && typeof Stats !== 'undefined') Stats.render();
    if (typeof Library !== 'undefined') Library.render();
  }

  // Delegated so buttons rendered into any view (stats, cards, library)
  // work without inline handlers.
  function init() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-plan-act]');
      if (!btn) return;
      e.stopPropagation();
      const id = btn.dataset.deck;
      const act = btn.dataset.planAct;
      if (act === 'date') openDatePicker(id);
      else if (act === 'clear') clearDate(id);
      else if (act === 'start') startToday(id);
      else if (act === 'cram') cram(id);
    });
  }

  return { init, plan, flashcardsBar, statsCard, libraryStrip, deckBadge, openDatePicker, startToday, refresh };
})();

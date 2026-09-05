// ===== Flashcards Module =====
const Flashcards = (() => {
  let container;
  let cards = [];
  let filter = 'all';
  let studyState = null;
  let generatingMore = false;

  // Card status tracking
  let cardStatus = {}; // id -> 'unseen' | 'reviewing' | 'mastered'

  function init() {
    container = document.getElementById('tab-flashcards');
    setupStudyMode();
    setupGridTilt();
  }

  // ----- Hover tilt on grid cards (mouse only) -----
  let tiltedCard = null;

  function setupGridTilt() {
    container.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || FX.reduced()) return;
      const card = e.target.closest('.flashcard');
      if (tiltedCard && card !== tiltedCard) tiltedCard.style.transform = '';
      tiltedCard = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(700px) rotateY(${(px * 7).toFixed(2)}deg) rotateX(${(py * -7).toFixed(2)}deg)`;
    });
    container.addEventListener('pointerleave', () => {
      if (tiltedCard) { tiltedCard.style.transform = ''; tiltedCard = null; }
    });
  }

  // Study session mode: 'all' (whole deck) or 'due' (SM-2 due cards only).
  let sessionMode = 'all';

  function setCards(newCards) {
    if (studyState) exitStudy();
    cards = newCards;
    filter = 'all';
    refreshStatus();
    render();
  }

  function addCards(newCards) {
    // Re-number past the current max id and push IN PLACE: `cards` is the
    // same array as studyData.flashcards, so replacing it (the old concat)
    // silently orphaned added cards — they were never saved to the deck.
    let maxId = cards.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
    newCards.forEach(c => { c.id = ++maxId; cards.push(c); });
    if (typeof App !== 'undefined' && App.persistActiveDeck) App.persistActiveDeck();
    refreshStatus();
    render(false);
  }

  // Pull each card's status from the deck's SM-2 state so mastered/reviewing
  // persists across sessions instead of resetting to "unseen" every load.
  function refreshStatus() {
    cardStatus = {};
    const hasDecks = typeof Decks !== 'undefined' && Decks.getActive();
    cards.forEach(c => {
      cardStatus[c.id] = hasDecks ? Decks.statusOf(c.id) : 'unseen';
    });
  }

  function render(animate = true) {
    if (!container) init();
    const T = i18n.t;
    const filtered = filter === 'all' ? cards : cards.filter(c => c.difficulty === filter);
    const stats = getStats();
    const dueCount = typeof Decks !== 'undefined' ? Decks.dueCards(cards).length : 0;

    let html = `
      <div class="cards-header">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <span class="cards-count">${T('flashcardCount', { n: cards.length })}</span>
          <div class="cards-filters">
            <button class="filter-btn ${filter === 'all' ? 'active' : ''}" onclick="Flashcards.setFilter('all')">${T('filterAll')}</button>
            <button class="filter-btn ${filter === 'easy' ? 'active' : ''}" onclick="Flashcards.setFilter('easy')">${T('filterEasy')}</button>
            <button class="filter-btn ${filter === 'medium' ? 'active' : ''}" onclick="Flashcards.setFilter('medium')">${T('filterMedium')}</button>
            <button class="filter-btn ${filter === 'hard' ? 'active' : ''}" onclick="Flashcards.setFilter('hard')">${T('filterHard')}</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn-ghost" id="generate-more-cards-btn" onclick="Flashcards.generateMore()" ${generatingMore ? 'disabled' : ''}>${generatingMore ? T('generatingMore') : T('generateMore')}</button>
          ${weakCategories().length ? `<button class="btn-ghost" onclick="Flashcards.generateWeakSpots()" ${generatingMore ? 'disabled' : ''}>&#127919; ${T('targetWeak')}</button>` : ''}
          ${clozeCandidates().length ? `<button class="btn-ghost" onclick="Flashcards.addClozeCards()">&#9998; ${T('clozeBtn')}</button>` : ''}
          ${dueCount > 0 ? `<button class="btn-ghost review-due-btn" onclick="Flashcards.startStudy('due')">${T('reviewDue', { n: dueCount })}</button>` : ''}
          <button class="start-study-btn" onclick="Flashcards.startStudy('all')">${T('startStudy')}</button>
        </div>
      </div>

      <div class="cards-grid">`;

    filtered.forEach((card, idx) => {
      html += `
        <div class="flashcard diff-${card.difficulty}${animate ? ' fade-up' : ''}" style="--i:${Math.min(idx, 18)}" role="button" tabindex="0" aria-pressed="false" onclick="Flashcards.flipCard(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Flashcards.flipCard(this)}" data-id="${card.id}">
          <div class="flashcard-inner">
            <div class="flashcard-front">
              <p class="flashcard-text">${esc(card.front)}</p>
              <div class="flashcard-meta">
                <span class="difficulty-badge ${card.difficulty}">${T('filter' + card.difficulty.charAt(0).toUpperCase() + card.difficulty.slice(1))}</span>
                <span class="card-category">${esc(card.category)}</span>
              </div>
            </div>
            <div class="flashcard-back">
              <p class="flashcard-text">${esc(card.back)}</p>
            </div>
          </div>
        </div>`;
    });

    html += `</div>

      <div class="deck-stats">
        <div class="deck-stat-item"><span class="deck-stat-dot mastered"></span> ${T('mastered')}: ${stats.mastered}</div>
        <div class="deck-stat-item"><span class="deck-stat-dot reviewing"></span> ${T('reviewing')}: ${stats.reviewing}</div>
        <div class="deck-stat-item"><span class="deck-stat-dot unseen"></span> ${T('unseen')}: ${stats.unseen}</div>
        <div class="deck-progress-bar">
          <div class="deck-progress-segments">
            <div class="deck-progress-mastered" style="width:${stats.masteredPct}%"></div>
            <div class="deck-progress-reviewing" style="width:${stats.reviewingPct}%"></div>
          </div>
        </div>
      </div>`;

    container.innerHTML = html;
  }

  function getStats() {
    let mastered = 0, reviewing = 0, unseen = 0;
    Object.values(cardStatus).forEach(s => {
      if (s === 'mastered') mastered++;
      else if (s === 'reviewing') reviewing++;
      else unseen++;
    });
    const total = cards.length || 1;
    return {
      mastered, reviewing, unseen,
      masteredPct: (mastered / total * 100).toFixed(1),
      reviewingPct: (reviewing / total * 100).toFixed(1)
    };
  }

  // Filter changes animate with the FLIP technique: capture card positions,
  // re-render, then invert-and-play so surviving cards glide to their new
  // spots instead of snapping.
  function setFilter(f) {
    const grid = container ? container.querySelector('.cards-grid') : null;
    const before = {};
    if (grid) grid.querySelectorAll('.flashcard').forEach(el => { before[el.dataset.id] = el.getBoundingClientRect(); });
    filter = f;
    render(false);
    if (FX.reduced() || !grid) return;
    container.querySelectorAll('.cards-grid .flashcard').forEach(el => {
      const b = before[el.dataset.id];
      if (!b) { el.classList.add('fade-up'); return; } // newly visible card
      const a = el.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = '';
        setTimeout(() => { el.style.transition = ''; }, 450);
      });
    });
  }

  function flipCard(el) {
    el.classList.toggle('flipped');
    el.setAttribute('aria-pressed', String(el.classList.contains('flipped')));
  }

  // ===== Generate More Flashcards =====
  // Optionally takes a custom prompt (weak-spot targeting). Guard against the
  // inline onclick handler passing a MouseEvent as the first argument.
  async function generateMore(customPrompt) {
    if (generatingMore) return;
    const targetCards = cards;
    generatingMore = true;
    render(false);

    try {
      const context = App.getOriginalText() || JSON.stringify(App.getStudyData());
      const prompt = (typeof customPrompt === 'string' && customPrompt) ||
        'Generate 10 more flashcards covering concepts not yet in the existing cards. Return diverse difficulty levels.';
      const raw = await API.chat(prompt, context);
      const data = Parser.parseChat(raw);

      if (cards !== targetCards) { generatingMore = false; render(false); return; }
      if (data.type === 'flashcards' && Array.isArray(data.flashcards)) {
        addCards(data.flashcards);
        App.showToast(i18n.t('moreAdded', { n: data.flashcards.length }), 'success');
      } else {
        App.showToast(i18n.t('chatError'), 'error');
      }
    } catch (err) {
      App.showToast(i18n.t('genFailed') + ' ' + err.message, 'error');
    }

    generatingMore = false;
    render(false);
  }

  // Categories where the user struggles: lapsed cards (FSRS lapses) or cards
  // still in "reviewing", ranked by how many weak cards they contain.
  function weakCategories() {
    const counts = {};
    cards.forEach(c => {
      const s = typeof Decks !== 'undefined' ? Decks.getSrs(c.id) : null;
      const weak = (s && s.lapses > 0) || cardStatus[c.id] === 'reviewing';
      if (weak && c.category) counts[c.category] = (counts[c.category] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  }

  function generateWeakSpots() {
    const cats = weakCategories();
    if (!cats.length) { App.showToast(i18n.t('noWeakSpots'), 'info'); return; }
    generateMore(`The student is struggling with these topics: ${cats.join(', ')}. ` +
      'Generate 10 new flashcards focused specifically on these weak areas, mostly medium and hard difficulty, ' +
      'approaching the concepts from different angles than typical flashcards.');
  }

  // ===== Cloze cards (client-side, no AI call) =====
  // Build fill-in-the-blank cards from the notes' key terms: blank the term
  // out of a sentence in its section that mentions it, or fall back to the
  // definition. Skips terms that already have a cloze card.
  function clozeCandidates() {
    const data = typeof App !== 'undefined' && App.getStudyData ? App.getStudyData() : null;
    if (!data || !data.notes || !Array.isArray(data.notes.sections)) return [];
    const existingFronts = new Set(cards.map(c => c.front));
    const out = [];
    data.notes.sections.forEach(section => {
      (section.keyTerms || []).forEach(kt => {
        if (!kt || !kt.term || !kt.definition) return;
        const term = kt.term.trim();
        let front = null;
        // Prefer a real sentence from the section content containing the term.
        const sentences = String(section.content || '').match(/[^.!?…]+[.!?…]+/g) || [];
        const hit = sentences.find(s => s.toLocaleLowerCase('tr').includes(term.toLocaleLowerCase('tr')));
        if (hit && hit.trim().length <= 220) {
          const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          front = hit.trim().replace(re, '____');
        }
        if (!front) front = `____: ${kt.definition}`;
        if (existingFronts.has(front)) return;
        existingFronts.add(front);
        out.push({ front, back: term, difficulty: 'medium', category: section.title || 'Cloze' });
      });
    });
    return out;
  }

  function addClozeCards() {
    const fresh = clozeCandidates();
    if (!fresh.length) { App.showToast(i18n.t('clozeNone'), 'info'); return; }
    addCards(fresh);
    App.showToast(i18n.t('clozeAdded', { n: fresh.length }), 'success');
  }

  // ===== STUDY MODE =====
  function setupStudyMode() {
    const card = document.getElementById('study-card');
    const closeBtn = document.getElementById('study-mode-close');
    const actionsEl = document.getElementById('study-mode-actions');

    card.addEventListener('click', () => {
      if (studyState && !studyState.flipped && !dragMoved) flipStudyCard();
    });
    closeBtn.addEventListener('click', exitStudy);
    actionsEl.querySelectorAll('.study-btn').forEach(btn => {
      btn.addEventListener('click', () => rateCard(btn.dataset.rating));
    });

    // Read the visible side of the current card aloud.
    const ttsBtn = document.getElementById('study-tts');
    if (ttsBtn) {
      if (typeof TTS !== 'undefined' && !TTS.supported()) ttsBtn.style.display = 'none';
      else ttsBtn.addEventListener('click', () => {
        if (!studyState) return;
        const c = studyState.deck[studyState.index];
        if (TTS.isSpeaking()) TTS.stop();
        else TTS.speak(studyState.flipped ? c.back : c.front);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('deck-complete-overlay').style.display === 'flex') { exitStudy(); return; }
      if (!studyState) return;
      if (e.code === 'Space') { e.preventDefault(); if (!studyState.flipped) flipStudyCard(); }
      else if (e.key === '1' && studyState.flipped) rateCard('again');
      else if (e.key === '2' && studyState.flipped) rateCard('hard');
      else if (e.key === '3' && studyState.flipped) rateCard('gotit');
      else if (e.code === 'Escape') exitStudy();
    });

    setupDrag(card);
  }

  // Drag the flipped card with mouse or finger (Pointer Events): it follows
  // the pointer with rotation, glows toward the rating it's heading for
  // (right = Got it, left = Again, up = Hard), flies off past the threshold,
  // and springs back otherwise.
  let drag = null, dragMoved = false, ratingLock = false;
  let releaseStudyTrap = null;

  function setupDrag(cardEl) {
    cardEl.addEventListener('pointerdown', (e) => {
      if (!studyState || !studyState.flipped || ratingLock) return;
      drag = { sx: e.clientX, sy: e.clientY };
      dragMoved = false;
      try { cardEl.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
      cardEl.classList.remove('spring-back', 'card-enter', 'drag-hint');
      cardEl.classList.add('dragging');
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!dragMoved && Math.hypot(dx, dy) > 6) dragMoved = true;
      if (!dragMoved) return;
      cardEl.style.transform = `translate(${dx}px, ${Math.min(dy, 40)}px) rotate(${(dx / 18).toFixed(2)}deg)`;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      cardEl.classList.toggle('drag-right', horizontal && dx > 48);
      cardEl.classList.toggle('drag-left', horizontal && dx < -48);
      cardEl.classList.toggle('drag-up', !horizontal && dy < -48);
    });

    const release = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      drag = null;
      cardEl.classList.remove('dragging', 'drag-right', 'drag-left', 'drag-up');
      const TH = 90;
      if (e.type !== 'pointercancel' && studyState && dragMoved) {
        if (Math.abs(dy) > Math.abs(dx) && dy < -TH) return rateCard('hard');
        if (dx > TH) return rateCard('gotit');
        if (dx < -TH) return rateCard('again');
      }
      // Under threshold — spring back to center.
      cardEl.classList.add('spring-back');
      cardEl.style.transform = '';
      setTimeout(() => cardEl.classList.remove('spring-back'), 500);
    };
    cardEl.addEventListener('pointerup', release);
    cardEl.addEventListener('pointercancel', release);
  }

  function startStudy(mode) {
    if (!cards.length) return;
    clearTimeout(rateTimer);
    ratingLock = false;
    sessionMode = mode === 'due' ? 'due' : 'all';
    let deck;
    if (sessionMode === 'due') {
      deck = typeof Decks !== 'undefined' ? Decks.dueCards(cards).slice() : [];
      if (deck.length === 0) { App.showToast(i18n.t('noDue'), 'info'); return; }
    } else {
      deck = cards.filter(c => cardStatus[c.id] !== 'mastered');
      if (deck.length === 0) deck = cards.slice(); // all mastered — review everything
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    studyState = { deck, index: 0, flipped: false, startTime: Date.now(), mastered: 0, reviewed: 0 };
    document.getElementById('study-mode-overlay').style.display = 'flex';
    if (releaseStudyTrap) releaseStudyTrap();
    releaseStudyTrap = FX.trapFocus(document.getElementById('study-mode-overlay'));
    document.body.style.overflow = 'hidden';
    showStudyCard();
  }

  function showStudyCard() {
    if (typeof TTS !== 'undefined') TTS.stop();
    const { deck, index } = studyState;
    const card = deck[index];
    const total = deck.length;
    document.getElementById('study-card-front-text').textContent = card.front;
    document.getElementById('study-card-back-text').textContent = card.back;
    document.getElementById('study-progress-text').textContent = `${index + 1} / ${total}`;
    document.getElementById('study-progress-fill').style.width = `${((index) / total) * 100}%`;
    document.getElementById('study-flip-hint').style.display = '';
    document.getElementById('study-mode-actions').style.display = 'none';
    studyState.flipped = false;
    const cardEl = document.getElementById('study-card');
    cardEl.classList.remove('flipped', 'fly-right', 'fly-left', 'fly-up', 'spring-back', 'dragging', 'drag-right', 'drag-left', 'drag-up', 'card-enter', 'drag-hint');
    cardEl.style.transform = '';
    void cardEl.offsetWidth; // restart the entrance animation
    cardEl.classList.add('card-enter');
  }

  function flipStudyCard() {
    studyState.flipped = true;
    const cardEl = document.getElementById('study-card');
    cardEl.classList.add('flipped');
    document.getElementById('study-flip-hint').style.display = 'none';
    document.getElementById('study-mode-actions').style.display = 'flex';
    Sound.play('flip');
    Sound.haptic(8);
    // First flip of the session: nudge the card sideways so the drag gesture
    // is discoverable without instructions.
    if (!studyState.hintShown && !FX.reduced()) {
      studyState.hintShown = true;
      cardEl.classList.add('drag-hint');
      setTimeout(() => cardEl.classList.remove('drag-hint'), 2000);
    }
  }

  // Rating first plays the card's exit (fly-off in the rating's direction),
  // then commits the SM-2 update and advances.
  const FLY_DIR = { gotit: 'fly-right', again: 'fly-left', hard: 'fly-up' };
  let rateTimer = null;

  function rateCard(rating) {
    if (!studyState || !studyState.flipped || ratingLock || !Object.hasOwn(FLY_DIR, rating)) return;
    ratingLock = true;
    Sound.play(rating === 'gotit' ? 'correct' : 'flip');
    Sound.haptic(rating === 'gotit' ? [12, 40, 12] : 10);
    const cardEl = document.getElementById('study-card');
    document.getElementById('study-mode-actions').style.display = 'none';
    if (FX.reduced()) return commitRate(rating);
    cardEl.classList.add(FLY_DIR[rating]);
    rateTimer = setTimeout(() => commitRate(rating), 300);
  }

  function commitRate(rating) {
    ratingLock = false;
    if (!studyState) return; // study mode exited mid-animation
    const { deck, index } = studyState;
    const card = deck[index];
    // Map the three buttons to SM-2 quality scores and persist scheduling.
    const quality = rating === 'gotit' ? 5 : rating === 'hard' ? 3 : 1;
    if (typeof Decks !== 'undefined') Decks.review(card.id, quality);
    if (typeof Stats !== 'undefined') Stats.recordReview(rating);

    if (rating === 'gotit') { cardStatus[card.id] = 'mastered'; studyState.mastered++; }
    else if (rating === 'hard') { cardStatus[card.id] = 'reviewing'; studyState.reviewed++; }
    else { cardStatus[card.id] = 'reviewing'; studyState.reviewed++; deck.push(card); }
    studyState.index++;
    if (studyState.index >= deck.length) showDeckComplete();
    else showStudyCard();
  }

  function showDeckComplete() {
    const elapsed = Math.floor((Date.now() - studyState.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    document.getElementById('dc-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    FX.countUp(document.getElementById('dc-mastered'), studyState.mastered, { duration: 700 });
    FX.countUp(document.getElementById('dc-reviewed'), studyState.reviewed, { duration: 700 });
    document.getElementById('study-mode-overlay').style.display = 'none';
    document.getElementById('deck-complete-overlay').style.display = 'flex';
    if (releaseStudyTrap) releaseStudyTrap();
    releaseStudyTrap = FX.trapFocus(document.getElementById('deck-complete-overlay'));
    studyState = null;
    refreshStatus();
    render(false);
    Sound.play('complete');
    FX.celebrate();
    document.getElementById('dc-study-again').onclick = () => {
      document.getElementById('deck-complete-overlay').style.display = 'none';
      if (releaseStudyTrap) { releaseStudyTrap(); releaseStudyTrap = null; }
      document.body.style.overflow = '';
      startStudy(sessionMode);
    };
    document.getElementById('dc-take-quiz').onclick = () => {
      document.getElementById('deck-complete-overlay').style.display = 'none';
      if (releaseStudyTrap) { releaseStudyTrap(); releaseStudyTrap = null; }
      document.body.style.overflow = '';
      App.switchTab('quiz');
    };
  }

  function exitStudy() {
    clearTimeout(rateTimer);
    if (releaseStudyTrap) { releaseStudyTrap(); releaseStudyTrap = null; }
    studyState = null;
    drag = null;
    ratingLock = false;
    if (typeof TTS !== 'undefined') TTS.stop();
    document.getElementById('study-mode-overlay').style.display = 'none';
    document.getElementById('deck-complete-overlay').style.display = 'none';
    document.body.style.overflow = '';
    render();
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, setCards, addCards, render, setFilter, flipCard, startStudy, generateMore, generateWeakSpots, addClozeCards };
})();

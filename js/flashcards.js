// ===== Flashcards Module =====
const Flashcards = (() => {
  let container;
  let cards = [];
  let filter = 'all';
  let studyState = null;

  // Card status tracking
  let cardStatus = {}; // id -> 'unseen' | 'reviewing' | 'mastered'

  function init() {
    container = document.getElementById('tab-flashcards');
    setupStudyMode();
  }

  function setCards(newCards) {
    cards = newCards;
    cardStatus = {};
    cards.forEach(c => { cardStatus[c.id] = 'unseen'; });
    filter = 'all';
    render();
  }

  function addCards(newCards) {
    cards = cards.concat(newCards);
    newCards.forEach(c => { cardStatus[c.id] = 'unseen'; });
    render();
  }

  function render() {
    if (!container) init();
    const filtered = filter === 'all' ? cards : cards.filter(c => c.difficulty === filter);

    const stats = getStats();

    let html = `
      <div class="cards-header">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <span class="cards-count">${cards.length} flashcards</span>
          <div class="cards-filters">
            <button class="filter-btn ${filter === 'all' ? 'active' : ''}" onclick="Flashcards.setFilter('all')">All</button>
            <button class="filter-btn ${filter === 'easy' ? 'active' : ''}" onclick="Flashcards.setFilter('easy')">Easy</button>
            <button class="filter-btn ${filter === 'medium' ? 'active' : ''}" onclick="Flashcards.setFilter('medium')">Medium</button>
            <button class="filter-btn ${filter === 'hard' ? 'active' : ''}" onclick="Flashcards.setFilter('hard')">Hard</button>
          </div>
        </div>
        <button class="start-study-btn" onclick="Flashcards.startStudy()">Start Study Mode</button>
      </div>

      <div class="cards-grid">`;

    filtered.forEach(card => {
      html += `
        <div class="flashcard" onclick="Flashcards.flipCard(this)" data-id="${card.id}">
          <div class="flashcard-inner">
            <div class="flashcard-front">
              <p class="flashcard-text">${esc(card.front)}</p>
              <div class="flashcard-meta">
                <span class="difficulty-badge ${card.difficulty}">${card.difficulty}</span>
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
        <div class="deck-stat-item"><span class="deck-stat-dot mastered"></span> Mastered: ${stats.mastered}</div>
        <div class="deck-stat-item"><span class="deck-stat-dot reviewing"></span> Reviewing: ${stats.reviewing}</div>
        <div class="deck-stat-item"><span class="deck-stat-dot unseen"></span> Unseen: ${stats.unseen}</div>
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

  function setFilter(f) {
    filter = f;
    render();
  }

  function flipCard(el) {
    el.classList.toggle('flipped');
  }

  // ===== STUDY MODE =====
  function setupStudyMode() {
    const overlay = document.getElementById('study-mode-overlay');
    const card = document.getElementById('study-card');
    const closeBtn = document.getElementById('study-mode-close');
    const actionsEl = document.getElementById('study-mode-actions');

    card.addEventListener('click', () => {
      if (studyState && !studyState.flipped) {
        flipStudyCard();
      }
    });

    closeBtn.addEventListener('click', exitStudy);

    actionsEl.querySelectorAll('.study-btn').forEach(btn => {
      btn.addEventListener('click', () => rateCard(btn.dataset.rating));
    });

    document.addEventListener('keydown', (e) => {
      if (!studyState) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!studyState.flipped) flipStudyCard();
      } else if (e.key === '1' && studyState.flipped) {
        rateCard('again');
      } else if (e.key === '2' && studyState.flipped) {
        rateCard('hard');
      } else if (e.key === '3' && studyState.flipped) {
        rateCard('gotit');
      } else if (e.code === 'Escape') {
        exitStudy();
      }
    });
  }

  function startStudy() {
    // Build study deck — unmastered cards first
    const deck = cards.filter(c => cardStatus[c.id] !== 'mastered');
    if (deck.length === 0) {
      // All mastered, reset
      cards.forEach(c => { cardStatus[c.id] = 'unseen'; });
      return startStudy();
    }

    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    studyState = {
      deck,
      index: 0,
      flipped: false,
      startTime: Date.now(),
      mastered: 0,
      reviewed: 0
    };

    document.getElementById('study-mode-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    showStudyCard();
  }

  function showStudyCard() {
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
    cardEl.classList.remove('flipped');
    // Re-trigger animation
    cardEl.style.animation = 'none';
    cardEl.offsetHeight;
    cardEl.style.animation = '';
  }

  function flipStudyCard() {
    studyState.flipped = true;
    document.getElementById('study-card').classList.add('flipped');
    document.getElementById('study-flip-hint').style.display = 'none';
    document.getElementById('study-mode-actions').style.display = 'flex';
  }

  function rateCard(rating) {
    const { deck, index } = studyState;
    const card = deck[index];

    if (rating === 'gotit') {
      cardStatus[card.id] = 'mastered';
      studyState.mastered++;
    } else if (rating === 'hard') {
      cardStatus[card.id] = 'reviewing';
      studyState.reviewed++;
    } else {
      // again — put card back near end
      cardStatus[card.id] = 'reviewing';
      studyState.reviewed++;
      deck.push(card);
    }

    studyState.index++;

    if (studyState.index >= deck.length) {
      showDeckComplete();
    } else {
      showStudyCard();
    }
  }

  function showDeckComplete() {
    const elapsed = Math.floor((Date.now() - studyState.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    document.getElementById('dc-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('dc-mastered').textContent = studyState.mastered;
    document.getElementById('dc-reviewed').textContent = studyState.reviewed;

    document.getElementById('study-mode-overlay').style.display = 'none';
    document.getElementById('deck-complete-overlay').style.display = 'flex';

    document.getElementById('dc-study-again').onclick = () => {
      document.getElementById('deck-complete-overlay').style.display = 'none';
      startStudy();
    };

    document.getElementById('dc-take-quiz').onclick = () => {
      document.getElementById('deck-complete-overlay').style.display = 'none';
      document.body.style.overflow = '';
      // Switch to quiz tab
      App.switchTab('quiz');
    };
  }

  function exitStudy() {
    studyState = null;
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

  return { init, setCards, addCards, render, setFilter, flipCard, startStudy };
})();

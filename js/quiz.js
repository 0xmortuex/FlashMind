// ===== Quiz Module =====
const Quiz = (() => {
  let container;
  let questions = [];
  let settings = {
    timer: false,
    timerDuration: 30,
    shuffle: true,
    showExplanations: 'each' // 'each' or 'end'
  };
  let state = null; // null = ready, object = in progress
  let timerInterval = null;

  function init() {
    container = document.getElementById('tab-quiz');
  }

  function setQuestions(newQuestions) {
    questions = newQuestions;
    state = null;
    renderReady();
  }

  function addQuestions(newQuestions) {
    questions = questions.concat(newQuestions);
    if (!state) renderReady();
  }

  function renderReady() {
    if (!container) init();

    container.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-ready">
          <h2>Test Your Knowledge</h2>
          <p class="quiz-info">${questions.length} questions &middot; Multiple choice</p>

          <div class="quiz-settings">
            <div class="quiz-setting">
              <span class="quiz-setting-label">Timer</span>
              <div class="quiz-setting-control">
                <div class="toggle ${settings.timer ? 'active' : ''}" id="timer-toggle"></div>
              </div>
            </div>
            <div class="quiz-setting" id="timer-duration-row" style="display:${settings.timer ? 'flex' : 'none'}">
              <span class="quiz-setting-label">Time per question</span>
              <div class="timer-options">
                <button class="timer-option ${settings.timerDuration === 30 ? 'active' : ''}" data-dur="30">30s</button>
                <button class="timer-option ${settings.timerDuration === 60 ? 'active' : ''}" data-dur="60">60s</button>
                <button class="timer-option ${settings.timerDuration === 90 ? 'active' : ''}" data-dur="90">90s</button>
              </div>
            </div>
            <div class="quiz-setting">
              <span class="quiz-setting-label">Shuffle questions</span>
              <div class="toggle ${settings.shuffle ? 'active' : ''}" id="shuffle-toggle"></div>
            </div>
            <div class="quiz-setting">
              <span class="quiz-setting-label">Show explanations</span>
              <div class="timer-options">
                <button class="timer-option ${settings.showExplanations === 'each' ? 'active' : ''}" data-exp="each">After each</button>
                <button class="timer-option ${settings.showExplanations === 'end' ? 'active' : ''}" data-exp="end">After quiz</button>
              </div>
            </div>
          </div>

          <button class="start-quiz-btn" id="start-quiz-btn">Start Quiz</button>
        </div>
      </div>`;

    // Event listeners
    document.getElementById('timer-toggle').addEventListener('click', function() {
      settings.timer = !settings.timer;
      this.classList.toggle('active');
      document.getElementById('timer-duration-row').style.display = settings.timer ? 'flex' : 'none';
    });

    document.getElementById('shuffle-toggle').addEventListener('click', function() {
      settings.shuffle = !settings.shuffle;
      this.classList.toggle('active');
    });

    container.querySelectorAll('[data-dur]').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.timerDuration = parseInt(btn.dataset.dur);
        container.querySelectorAll('[data-dur]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    container.querySelectorAll('[data-exp]').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.showExplanations = btn.dataset.exp;
        container.querySelectorAll('[data-exp]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('start-quiz-btn').addEventListener('click', startQuiz);
  }

  function startQuiz() {
    let qs = [...questions];
    if (settings.shuffle) {
      for (let i = qs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [qs[i], qs[j]] = [qs[j], qs[i]];
      }
    }

    state = {
      questions: qs,
      current: 0,
      answers: [],
      startTime: Date.now(),
      questionStartTime: Date.now(),
      timeLeft: settings.timerDuration
    };

    renderQuestion();
  }

  function renderQuestion() {
    if (!container) init();
    const { questions: qs, current } = state;
    const q = qs[current];
    const total = qs.length;

    let timerHtml = '';
    if (settings.timer) {
      state.timeLeft = settings.timerDuration;
      state.questionStartTime = Date.now();
      timerHtml = `<span class="quiz-timer" id="quiz-timer">${settings.timerDuration}s</span>`;
    }

    container.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-progress-bar">
          <div class="quiz-progress-fill" style="width:${(current / total) * 100}%"></div>
        </div>
        <div class="quiz-question-number">Question ${current + 1} of ${total} ${timerHtml}</div>
        <p class="quiz-question-text">${esc(q.question)}</p>
        <div class="quiz-options" id="quiz-options">
          ${q.options.map((opt, i) => `
            <button class="quiz-option" data-idx="${i}">${esc(opt)}</button>
          `).join('')}
        </div>
        <div id="quiz-feedback"></div>
      </div>`;

    // Option click handlers
    container.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => selectAnswer(parseInt(btn.dataset.idx)));
    });

    // Start timer
    if (settings.timer) {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        state.timeLeft--;
        const timerEl = document.getElementById('quiz-timer');
        if (timerEl) {
          timerEl.textContent = state.timeLeft + 's';
          if (state.timeLeft <= 5) timerEl.classList.add('warning');
        }
        if (state.timeLeft <= 0) {
          clearInterval(timerInterval);
          selectAnswer(-1); // Time's up
        }
      }, 1000);
    }
  }

  function selectAnswer(idx) {
    clearInterval(timerInterval);
    const { questions: qs, current } = state;
    const q = qs[current];
    const correct = q.correct;
    const isCorrect = idx === correct;

    state.answers.push({
      questionIdx: current,
      selected: idx,
      correct: correct,
      isCorrect,
      time: Math.floor((Date.now() - state.questionStartTime) / 1000)
    });

    // Disable all options
    const options = container.querySelectorAll('.quiz-option');
    options.forEach(opt => {
      opt.classList.add('disabled');
      const i = parseInt(opt.dataset.idx);
      if (i === correct) {
        opt.classList.add('correct');
        opt.innerHTML += '<span class="option-indicator">&#10003;</span>';
      }
      if (i === idx && !isCorrect) {
        opt.classList.add('wrong');
        opt.innerHTML += '<span class="option-indicator">&#10007;</span>';
      }
    });

    // Show explanation
    const feedbackEl = document.getElementById('quiz-feedback');
    let feedbackHtml = '';

    if (settings.showExplanations === 'each' && q.explanation) {
      feedbackHtml += `<div class="quiz-explanation">${esc(q.explanation)}</div>`;
    }

    if (current + 1 < qs.length) {
      feedbackHtml += `<button class="quiz-next-btn" id="quiz-next-btn">Next Question &rarr;</button>`;
    } else {
      feedbackHtml += `<button class="quiz-next-btn" id="quiz-next-btn">See Results</button>`;
    }

    feedbackEl.innerHTML = feedbackHtml;
    document.getElementById('quiz-next-btn').addEventListener('click', () => {
      state.current++;
      if (state.current >= state.questions.length) {
        showResults();
      } else {
        renderQuestion();
      }
    });
  }

  function showResults() {
    clearInterval(timerInterval);
    const { answers, startTime } = state;
    const total = state.questions.length;
    const correctCount = answers.filter(a => a.isCorrect).length;
    const pct = Math.round((correctCount / total) * 100);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const avgTime = Math.round(elapsed / total);

    let grade, gradeClass;
    if (pct >= 90) { grade = 'A'; gradeClass = 'grade-a'; }
    else if (pct >= 80) { grade = 'B'; gradeClass = 'grade-b'; }
    else if (pct >= 70) { grade = 'C'; gradeClass = 'grade-c'; }
    else if (pct >= 60) { grade = 'D'; gradeClass = 'grade-d'; }
    else { grade = 'F'; gradeClass = 'grade-f'; }

    container.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-results">
          <div class="quiz-score-circle">
            <span class="quiz-score-value">${correctCount}/${total}</span>
            <span class="quiz-score-percent">${pct}%</span>
          </div>
          <div class="quiz-grade ${gradeClass}">${grade}</div>

          <div class="quiz-result-stats">
            <div class="quiz-result-stat">
              <span class="quiz-result-stat-value" style="color:var(--correct)">${correctCount}</span>
              <span class="quiz-result-stat-label">Correct</span>
            </div>
            <div class="quiz-result-stat">
              <span class="quiz-result-stat-value" style="color:var(--wrong)">${total - correctCount}</span>
              <span class="quiz-result-stat-label">Wrong</span>
            </div>
            <div class="quiz-result-stat">
              <span class="quiz-result-stat-value">${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}</span>
              <span class="quiz-result-stat-label">Time</span>
            </div>
            <div class="quiz-result-stat">
              <span class="quiz-result-stat-value">${avgTime}s</span>
              <span class="quiz-result-stat-label">Avg/question</span>
            </div>
          </div>

          <div class="quiz-result-actions">
            <button class="btn-primary" id="review-btn">Review Answers</button>
            <button class="btn-ghost" id="retake-btn">Retake Quiz</button>
          </div>

          <div class="quiz-review" id="quiz-review" style="display:none"></div>
        </div>
      </div>`;

    // Confetti for 90%+
    if (pct >= 90) {
      launchConfetti();
    }

    document.getElementById('review-btn').addEventListener('click', showReview);
    document.getElementById('retake-btn').addEventListener('click', () => {
      state = null;
      renderReady();
    });
  }

  function showReview() {
    const reviewEl = document.getElementById('quiz-review');
    const { answers, questions: qs } = state;

    let html = `
      <div class="quiz-review-header">
        <h3>Review Answers</h3>
        <button class="btn-ghost" id="show-wrong-only">Show wrong only</button>
      </div>`;

    answers.forEach((a, i) => {
      const q = qs[a.questionIdx];
      html += `
        <div class="review-question" data-correct="${a.isCorrect}">
          <p class="review-question-text">${i + 1}. ${esc(q.question)}</p>`;

      if (a.selected >= 0) {
        if (a.isCorrect) {
          html += `<div class="review-answer your-correct">Your answer: ${esc(q.options[a.selected])}</div>`;
        } else {
          html += `<div class="review-answer your-wrong">Your answer: ${esc(q.options[a.selected])}</div>`;
          html += `<div class="review-answer correct-answer">Correct: ${esc(q.options[q.correct])}</div>`;
        }
      } else {
        html += `<div class="review-answer your-wrong">Time's up — no answer</div>`;
        html += `<div class="review-answer correct-answer">Correct: ${esc(q.options[q.correct])}</div>`;
      }

      if (q.explanation) {
        html += `<div class="review-explanation">${esc(q.explanation)}</div>`;
      }

      html += `</div>`;
    });

    reviewEl.innerHTML = html;
    reviewEl.style.display = 'block';

    let showingWrongOnly = false;
    document.getElementById('show-wrong-only').addEventListener('click', function() {
      showingWrongOnly = !showingWrongOnly;
      this.textContent = showingWrongOnly ? 'Show all' : 'Show wrong only';
      reviewEl.querySelectorAll('.review-question').forEach(el => {
        if (showingWrongOnly && el.dataset.correct === 'true') {
          el.style.display = 'none';
        } else {
          el.style.display = '';
        }
      });
    });
  }

  function launchConfetti() {
    const container = document.getElementById('confetti-container');
    const colors = ['#7c3aed', '#06b6d4', '#22c55e', '#fbbf24', '#ef4444', '#ec4899'];

    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 2 + 's';
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      container.appendChild(piece);
    }

    setTimeout(() => { container.innerHTML = ''; }, 4000);
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, setQuestions, addQuestions, renderReady, startQuiz };
})();

// ===== Quiz Module =====
const Quiz = (() => {
  let container;
  let questions = [];
  let settings = {
    timer: false,
    timerDuration: 30,
    shuffle: true,
    showExplanations: 'each',
    questionTypes: 'both'
  };
  let state = null;
  let timerInterval = null;

  function init() { container = document.getElementById('tab-quiz'); }

  function setQuestions(newQuestions) { questions = newQuestions; state = null; renderReady(); }
  function addQuestions(newQuestions) { questions = questions.concat(newQuestions); if (!state) renderReady(); }

  function getFilteredQuestions() {
    if (settings.questionTypes === 'mc') return questions.filter(q => q.type !== 'open-ended');
    if (settings.questionTypes === 'written') return questions.filter(q => q.type === 'open-ended');
    return [...questions];
  }

  function renderReady() {
    if (!container) init();
    const T = i18n.t;
    const mcCount = questions.filter(q => q.type !== 'open-ended').length;
    const oeCount = questions.filter(q => q.type === 'open-ended').length;
    const filtered = getFilteredQuestions();

    container.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-ready">
          <h2>${T('testKnowledge')}</h2>
          <p class="quiz-info">${T('quizInfo', { n: filtered.length, mc: mcCount, oe: oeCount })}</p>
          <div class="quiz-settings">
            <div class="quiz-setting">
              <span class="quiz-setting-label">${T('questionTypes')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.questionTypes === 'both' ? 'active' : ''}" data-qtype="both">${T('both')}</button>
                <button class="timer-option ${settings.questionTypes === 'mc' ? 'active' : ''}" data-qtype="mc">${T('mcOnly')}</button>
                <button class="timer-option ${settings.questionTypes === 'written' ? 'active' : ''}" data-qtype="written">${T('writtenOnly')}</button>
              </div>
            </div>
            <div class="quiz-setting">
              <span class="quiz-setting-label">${T('timer')}</span>
              <div class="quiz-setting-control">
                <div class="toggle ${settings.timer ? 'active' : ''}" id="timer-toggle"></div>
              </div>
            </div>
            <div class="quiz-setting" id="timer-duration-row" style="display:${settings.timer ? 'flex' : 'none'}">
              <span class="quiz-setting-label">${T('timePerQ')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.timerDuration === 30 ? 'active' : ''}" data-dur="30">30s</button>
                <button class="timer-option ${settings.timerDuration === 60 ? 'active' : ''}" data-dur="60">60s</button>
                <button class="timer-option ${settings.timerDuration === 90 ? 'active' : ''}" data-dur="90">90s</button>
              </div>
            </div>
            <div class="quiz-setting">
              <span class="quiz-setting-label">${T('shuffleQ')}</span>
              <div class="toggle ${settings.shuffle ? 'active' : ''}" id="shuffle-toggle"></div>
            </div>
            <div class="quiz-setting">
              <span class="quiz-setting-label">${T('showExplanations')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.showExplanations === 'each' ? 'active' : ''}" data-exp="each">${T('afterEach')}</button>
                <button class="timer-option ${settings.showExplanations === 'end' ? 'active' : ''}" data-exp="end">${T('afterQuiz')}</button>
              </div>
            </div>
          </div>
          <button class="start-quiz-btn" id="start-quiz-btn">${T('startQuiz')}</button>
        </div>
      </div>`;

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
    container.querySelectorAll('[data-qtype]').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.questionTypes = btn.dataset.qtype;
        container.querySelectorAll('[data-qtype]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = getFilteredQuestions();
        container.querySelector('.quiz-info').textContent = T('quizInfo', { n: f.length, mc: mcCount, oe: oeCount });
      });
    });
    document.getElementById('start-quiz-btn').addEventListener('click', startQuiz);
  }

  function startQuiz() {
    const T = i18n.t;
    let qs = getFilteredQuestions();
    if (qs.length === 0) { App.showToast(T('noQuestions'), 'error'); return; }
    if (settings.shuffle) {
      for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
    }
    state = { questions: qs, current: 0, answers: [], startTime: Date.now(), questionStartTime: Date.now(), timeLeft: settings.timerDuration };
    renderQuestion();
  }

  function renderQuestion() {
    if (!container) init();
    const T = i18n.t;
    const { questions: qs, current } = state;
    const q = qs[current];
    const total = qs.length;
    const isOpenEnded = q.type === 'open-ended';

    let timerHtml = '';
    if (settings.timer) {
      state.timeLeft = settings.timerDuration;
      state.questionStartTime = Date.now();
      timerHtml = `<span class="quiz-timer" id="quiz-timer">${settings.timerDuration}s</span>`;
    }

    let questionBody = '';
    if (isOpenEnded) {
      questionBody = `
        <div class="open-ended-area">
          <span class="oe-badge">${T('writtenAnswer')}</span>
          <textarea class="oe-textarea" id="oe-answer" placeholder="${T('typeAnswer')}" spellcheck="false"></textarea>
          <button class="btn-primary oe-submit-btn" id="oe-submit-btn">${T('submitAnswer')}</button>
        </div>`;
    } else {
      questionBody = `<div class="quiz-options" id="quiz-options">
        ${q.options.map((opt, i) => `<button class="quiz-option" data-idx="${i}">${esc(opt)}</button>`).join('')}
      </div>`;
    }

    container.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${(current / total) * 100}%"></div></div>
        <div class="quiz-question-number">${T('questionOf', { c: current + 1, t: total })} ${timerHtml}</div>
        <p class="quiz-question-text">${esc(q.question)}</p>
        ${questionBody}
        <div id="quiz-feedback"></div>
      </div>`;

    if (isOpenEnded) document.getElementById('oe-submit-btn').addEventListener('click', submitOpenEnded);
    else container.querySelectorAll('.quiz-option').forEach(btn => { btn.addEventListener('click', () => selectAnswer(parseInt(btn.dataset.idx))); });

    if (settings.timer) {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        state.timeLeft--;
        const timerEl = document.getElementById('quiz-timer');
        if (timerEl) { timerEl.textContent = state.timeLeft + 's'; if (state.timeLeft <= 5) timerEl.classList.add('warning'); }
        if (state.timeLeft <= 0) { clearInterval(timerInterval); if (q.type === 'open-ended') submitOpenEnded(); else selectAnswer(-1); }
      }, 1000);
    }
  }

  function selectAnswer(idx) {
    clearInterval(timerInterval);
    const { questions: qs, current } = state;
    const q = qs[current];
    const correct = q.correct;
    const isCorrect = idx === correct;
    state.answers.push({ questionIdx: current, type: 'multiple-choice', selected: idx, correct, isCorrect, time: Math.floor((Date.now() - state.questionStartTime) / 1000) });
    const options = container.querySelectorAll('.quiz-option');
    options.forEach(opt => {
      opt.classList.add('disabled');
      const i = parseInt(opt.dataset.idx);
      if (i === correct) { opt.classList.add('correct'); opt.innerHTML += '<span class="option-indicator">&#10003;</span>'; }
      if (i === idx && !isCorrect) { opt.classList.add('wrong'); opt.innerHTML += '<span class="option-indicator">&#10007;</span>'; }
    });
    showNextButton(q);
  }

  async function submitOpenEnded() {
    clearInterval(timerInterval);
    const T = i18n.t;
    const { questions: qs, current } = state;
    const q = qs[current];
    const answerEl = document.getElementById('oe-answer');
    const submitBtn = document.getElementById('oe-submit-btn');
    const studentAnswer = answerEl ? answerEl.value.trim() : '';
    if (answerEl) answerEl.disabled = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = T('grading'); }

    const feedbackEl = document.getElementById('quiz-feedback');
    feedbackEl.innerHTML = `<div class="oe-grading-loader">
      <svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>
      <span>${T('aiGrading')}</span></div>`;

    let gradeResult;
    try {
      const raw = await API.grade(studentAnswer, q.correctAnswer, q.keyPoints);
      gradeResult = Parser.parseGrade(raw);
    } catch (err) { gradeResult = fallbackGrade(studentAnswer, q); }

    state.answers.push({ questionIdx: current, type: 'open-ended', studentAnswer, score: gradeResult.score, maxScore: gradeResult.maxScore, feedback: gradeResult.feedback, missedPoints: gradeResult.missedPoints, correctAnswer: q.correctAnswer, time: Math.floor((Date.now() - state.questionStartTime) / 1000) });

    const scoreColor = gradeResult.score === 3 ? 'var(--correct)' : gradeResult.score === 2 ? 'var(--highlight)' : gradeResult.score === 1 ? '#f97316' : 'var(--wrong)';
    let html = `<div class="oe-grade-result" style="animation: fadeSlideUp 0.3s ease">
      <div class="oe-score" style="color:${scoreColor}">${gradeResult.score}/${gradeResult.maxScore}</div>
      <div class="oe-feedback">${esc(gradeResult.feedback)}</div>`;
    if (gradeResult.missedPoints && gradeResult.missedPoints.length > 0) {
      html += `<div class="oe-missed"><span class="oe-missed-label">${T('missedLabel')}</span>
        ${gradeResult.missedPoints.map(p => `<span class="oe-missed-point">${esc(p)}</span>`).join('')}</div>`;
    }
    html += `<div class="oe-correct-answer"><span class="oe-correct-label">${T('modelAnswer')}</span><p>${esc(q.correctAnswer)}</p></div></div>`;
    feedbackEl.innerHTML = html;
    showNextButton(q);
  }

  function fallbackGrade(studentAnswer, q) {
    const T = i18n.t;
    if (!studentAnswer) return { score: 0, maxScore: 3, feedback: T('noAnswerProvided'), missedPoints: q.keyPoints || [] };
    const lower = studentAnswer.toLowerCase();
    const matched = (q.keyPoints || []).filter(kp => lower.includes(kp.toLowerCase()));
    const missed = (q.keyPoints || []).filter(kp => !lower.includes(kp.toLowerCase()));
    const ratio = q.keyPoints.length > 0 ? matched.length / q.keyPoints.length : 0;
    let score = 0;
    if (ratio >= 0.9) score = 3; else if (ratio >= 0.6) score = 2; else if (ratio >= 0.3) score = 1;
    return { score, maxScore: 3, feedback: T('offlineGrading', { m: matched.length, t: q.keyPoints.length }), missedPoints: missed };
  }

  function showNextButton(q) {
    const T = i18n.t;
    const feedbackEl = document.getElementById('quiz-feedback');
    const { current, questions: qs } = state;
    if (q.type !== 'open-ended' && settings.showExplanations === 'each' && q.explanation) {
      feedbackEl.insertAdjacentHTML('beforeend', `<div class="quiz-explanation">${esc(q.explanation)}</div>`);
    }
    const btnText = current + 1 < qs.length ? T('nextQuestion') : T('seeResults');
    feedbackEl.insertAdjacentHTML('beforeend', `<button class="quiz-next-btn" id="quiz-next-btn">${btnText}</button>`);
    document.getElementById('quiz-next-btn').addEventListener('click', () => {
      state.current++;
      if (state.current >= state.questions.length) showResults(); else renderQuestion();
    });
  }

  function showResults() {
    clearInterval(timerInterval);
    const T = i18n.t;
    const { answers, startTime } = state;
    const total = state.questions.length;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const avgTime = Math.round(elapsed / total);
    const mcAnswers = answers.filter(a => a.type === 'multiple-choice');
    const oeAnswers = answers.filter(a => a.type === 'open-ended');
    const mcCorrect = mcAnswers.filter(a => a.isCorrect).length;
    const mcTotal = mcAnswers.length;
    const oePoints = oeAnswers.reduce((sum, a) => sum + a.score, 0);
    const oeMaxPoints = oeAnswers.reduce((sum, a) => sum + a.maxScore, 0);
    const oeTotal = oeAnswers.length;
    const totalPoints = mcCorrect + oePoints;
    const totalPossible = mcTotal + oeMaxPoints;
    const pct = totalPossible > 0 ? Math.round((totalPoints / totalPossible) * 100) : 0;

    let grade, gradeClass;
    if (pct >= 90) { grade = 'A'; gradeClass = 'grade-a'; }
    else if (pct >= 80) { grade = 'B'; gradeClass = 'grade-b'; }
    else if (pct >= 70) { grade = 'C'; gradeClass = 'grade-c'; }
    else if (pct >= 60) { grade = 'D'; gradeClass = 'grade-d'; }
    else { grade = 'F'; gradeClass = 'grade-f'; }

    let breakdownHtml = '';
    if (mcTotal > 0 && oeTotal > 0) breakdownHtml = `<p class="quiz-breakdown">${T('mcBreakdown', { c: mcCorrect, t: mcTotal, p: oePoints, m: oeMaxPoints, n: oeTotal })}</p>`;
    else if (oeTotal > 0) breakdownHtml = `<p class="quiz-breakdown">${T('oeBreakdown', { p: oePoints, m: oeMaxPoints, n: oeTotal })}</p>`;

    container.innerHTML = `
      <div class="quiz-container"><div class="quiz-results">
        <div class="quiz-score-circle"><span class="quiz-score-value">${totalPoints}/${totalPossible}</span><span class="quiz-score-percent">${pct}%</span></div>
        <div class="quiz-grade ${gradeClass}">${grade}</div>
        ${breakdownHtml}
        <div class="quiz-result-stats">
          ${mcTotal > 0 ? `<div class="quiz-result-stat"><span class="quiz-result-stat-value" style="color:var(--correct)">${mcCorrect}</span><span class="quiz-result-stat-label">${T('mcCorrect')}</span></div>
          <div class="quiz-result-stat"><span class="quiz-result-stat-value" style="color:var(--wrong)">${mcTotal - mcCorrect}</span><span class="quiz-result-stat-label">${T('mcWrong')}</span></div>` : ''}
          ${oeTotal > 0 ? `<div class="quiz-result-stat"><span class="quiz-result-stat-value" style="color:var(--secondary)">${oePoints}/${oeMaxPoints}</span><span class="quiz-result-stat-label">${T('writtenPts')}</span></div>` : ''}
          <div class="quiz-result-stat"><span class="quiz-result-stat-value">${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}</span><span class="quiz-result-stat-label">${T('time')}</span></div>
          <div class="quiz-result-stat"><span class="quiz-result-stat-value">${avgTime}s</span><span class="quiz-result-stat-label">${T('avgPerQ')}</span></div>
        </div>
        <div class="quiz-result-actions">
          <button class="btn-primary" id="review-btn">${T('reviewAnswers')}</button>
          <button class="btn-ghost" id="retake-btn">${T('retakeQuiz')}</button>
        </div>
        <div class="quiz-review" id="quiz-review" style="display:none"></div>
      </div></div>`;

    if (pct >= 90) launchConfetti();
    document.getElementById('review-btn').addEventListener('click', showReview);
    document.getElementById('retake-btn').addEventListener('click', () => { state = null; renderReady(); });
  }

  function showReview() {
    const T = i18n.t;
    const reviewEl = document.getElementById('quiz-review');
    const { answers, questions: qs } = state;
    let html = `<div class="quiz-review-header"><h3>${T('reviewAnswers')}</h3><button class="btn-ghost" id="show-wrong-only">${T('showWrongOnly')}</button></div>`;

    answers.forEach((a, i) => {
      const q = qs[a.questionIdx];
      const isWrong = a.type === 'multiple-choice' ? !a.isCorrect : a.score < 3;
      html += `<div class="review-question" data-correct="${!isWrong}"><p class="review-question-text">${i + 1}. ${esc(q.question)} ${q.type === 'open-ended' ? '<span class="oe-badge-sm">' + T('writtenAnswer') + '</span>' : ''}</p>`;

      if (a.type === 'multiple-choice') {
        if (a.selected >= 0) {
          if (a.isCorrect) html += `<div class="review-answer your-correct">${T('yourAnswer')} ${esc(q.options[a.selected])}</div>`;
          else { html += `<div class="review-answer your-wrong">${T('yourAnswer')} ${esc(q.options[a.selected])}</div>`; html += `<div class="review-answer correct-answer">${T('correct')} ${esc(q.options[q.correct])}</div>`; }
        } else { html += `<div class="review-answer your-wrong">${T('timesUp')}</div><div class="review-answer correct-answer">${T('correct')} ${esc(q.options[q.correct])}</div>`; }
        if (q.explanation) html += `<div class="review-explanation">${esc(q.explanation)}</div>`;
      } else {
        const scoreColor = a.score === 3 ? 'var(--correct)' : a.score === 2 ? 'var(--highlight)' : a.score === 1 ? '#f97316' : 'var(--wrong)';
        html += `<div class="review-answer ${a.score >= 2 ? 'your-correct' : 'your-wrong'}">${T('yourAnswer')} ${esc(a.studentAnswer || '(-)') }</div>`;
        html += `<div class="oe-review-score" style="color:${scoreColor}">${T('score')} ${a.score}/${a.maxScore}</div>`;
        if (a.feedback) html += `<div class="review-explanation">${esc(a.feedback)}</div>`;
        html += `<div class="review-answer correct-answer">${T('modelAnswer')} ${esc(a.correctAnswer)}</div>`;
      }
      html += `</div>`;
    });

    reviewEl.innerHTML = html;
    reviewEl.style.display = 'block';
    let showingWrongOnly = false;
    document.getElementById('show-wrong-only').addEventListener('click', function() {
      showingWrongOnly = !showingWrongOnly;
      this.textContent = showingWrongOnly ? T('showAll') : T('showWrongOnly');
      reviewEl.querySelectorAll('.review-question').forEach(el => {
        el.style.display = (showingWrongOnly && el.dataset.correct === 'true') ? 'none' : '';
      });
    });
  }

  function launchConfetti() {
    const c = document.getElementById('confetti-container');
    const colors = ['#7c3aed', '#06b6d4', '#22c55e', '#fbbf24', '#ef4444', '#ec4899'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = Math.random() * 100 + '%';
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = Math.random() * 2 + 's';
      p.style.animationDuration = (2 + Math.random() * 2) + 's';
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      p.style.width = (6 + Math.random() * 8) + 'px';
      p.style.height = (6 + Math.random() * 8) + 'px';
      c.appendChild(p);
    }
    setTimeout(() => { c.innerHTML = ''; }, 4000);
  }

  function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  return { init, setQuestions, addQuestions, renderReady, startQuiz };
})();

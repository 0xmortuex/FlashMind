// ===== Quiz / Exam Module — Turkish-style exam (Türk sınav sistemi) =====
// Question types: multiple-choice (çoktan seçmeli, 5 options A–E),
// true-false (doğru-yanlış), fill-blank (boşluk doldurma),
// matching (eşleştirme), open-ended (açık uçlu / klasik, AI-graded).
// Scoring follows the Turkish convention: Doğru / Yanlış / Boş counts and a
// "Net" for the multiple-choice section (net = doğru − yanlış / 4).
const Quiz = (() => {
  const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const OBJECTIVE = ['multiple-choice', 'true-false', 'fill-blank', 'matching'];

  let container;
  let questions = [];
  let settings = {
    timer: false,
    timerDuration: 30,
    shuffle: true,
    showExplanations: 'each',
    questionTypes: 'both', // both | objective | written
    mode: 'practice', // practice | sim (deneme: one countdown, no per-question feedback)
    simDuration: 10 // total exam minutes in simulation mode
  };
  let state = null;
  let timerInterval = null;
  let simInterval = null;

  function init() { container = document.getElementById('tab-quiz'); }

  function setQuestions(newQuestions) { questions = newQuestions || []; state = null; renderReady(); }

  function addQuestions(newQuestions) {
    // Push IN PLACE and persist: `questions` is the same array as
    // studyData.quiz, so replacing it (the old concat) orphaned added
    // questions — they were never saved to the deck.
    let maxId = questions.reduce((m, q) => Math.max(m, q.id || 0), 0);
    (newQuestions || []).forEach(q => { q.id = ++maxId; questions.push(q); });
    if (typeof App !== 'undefined' && App.persistActiveDeck) App.persistActiveDeck();
    if (!state) renderReady();
  }

  function isObjective(q) { return q.type !== 'open-ended'; }

  function getFilteredQuestions() {
    if (settings.questionTypes === 'objective') return questions.filter(isObjective);
    if (settings.questionTypes === 'written') return questions.filter(q => q.type === 'open-ended');
    return [...questions];
  }

  // Turkish-aware normalization for fill-in-the-blank comparison.
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLocaleLowerCase('tr')
      .replace(/[.,;:!?'"`´()\[\]{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function typeLabel(type) {
    const T = i18n.t;
    return type === 'true-false' ? T('typeTf')
      : type === 'fill-blank' ? T('typeFill')
      : type === 'matching' ? T('typeMatch')
      : type === 'open-ended' ? T('writtenAnswer')
      : T('typeMc');
  }

  // ===== Ready / settings screen =====
  function renderReady() {
    if (!container) init();
    const T = i18n.t;
    const objCount = questions.filter(isObjective).length;
    const oeCount = questions.filter(q => q.type === 'open-ended').length;
    const filtered = getFilteredQuestions();

    container.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-ready">
          <h2>${T('examTitle')}</h2>
          <p class="quiz-info">${T('quizInfo', { n: filtered.length, mc: objCount, oe: oeCount })}</p>
          <div class="quiz-settings">
            <div class="quiz-setting">
              <span class="quiz-setting-label">${T('questionTypes')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.questionTypes === 'both' ? 'active' : ''}" data-qtype="both">${T('allTypes')}</button>
                <button class="timer-option ${settings.questionTypes === 'objective' ? 'active' : ''}" data-qtype="objective">${T('objectiveOnly')}</button>
                <button class="timer-option ${settings.questionTypes === 'written' ? 'active' : ''}" data-qtype="written">${T('writtenOnly')}</button>
              </div>
            </div>
            <div class="quiz-setting">
              <span class="quiz-setting-label">${T('examMode')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.mode === 'practice' ? 'active' : ''}" data-mode="practice">${T('modePractice')}</button>
                <button class="timer-option ${settings.mode === 'sim' ? 'active' : ''}" data-mode="sim">${T('modeSim')}</button>
              </div>
            </div>
            <div class="quiz-setting" id="sim-duration-row" style="display:${settings.mode === 'sim' ? 'flex' : 'none'}">
              <span class="quiz-setting-label">${T('simDuration')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.simDuration === 10 ? 'active' : ''}" data-simdur="10">10:00</button>
                <button class="timer-option ${settings.simDuration === 20 ? 'active' : ''}" data-simdur="20">20:00</button>
                <button class="timer-option ${settings.simDuration === 40 ? 'active' : ''}" data-simdur="40">40:00</button>
              </div>
            </div>
            <div class="quiz-setting" id="timer-row" style="display:${settings.mode === 'sim' ? 'none' : 'flex'}">
              <span class="quiz-setting-label">${T('timer')}</span>
              <div class="quiz-setting-control"><div class="toggle ${settings.timer ? 'active' : ''}" id="timer-toggle"></div></div>
            </div>
            <div class="quiz-setting" id="timer-duration-row" style="display:${settings.timer && settings.mode !== 'sim' ? 'flex' : 'none'}">
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
            <div class="quiz-setting" id="explanations-row" style="display:${settings.mode === 'sim' ? 'none' : 'flex'}">
              <span class="quiz-setting-label">${T('showExplanations')}</span>
              <div class="timer-options">
                <button class="timer-option ${settings.showExplanations === 'each' ? 'active' : ''}" data-exp="each">${T('afterEach')}</button>
                <button class="timer-option ${settings.showExplanations === 'end' ? 'active' : ''}" data-exp="end">${T('afterQuiz')}</button>
              </div>
            </div>
          </div>
          <p class="sim-hint" id="sim-hint" style="display:${settings.mode === 'sim' ? 'block' : 'none'}">${T('simHint')}</p>
          <button class="start-quiz-btn" id="start-quiz-btn">${T('startExam')}</button>
          ${(typeof Decks !== 'undefined' && Decks.getMistakes().length) ? `
          <div class="mistakes-row">
            <button class="btn-ghost mistakes-btn" id="retake-mistakes-btn">&#128213; ${T('retakeMistakes', { n: Decks.getMistakes().length })}</button>
            <p class="mistakes-hint">${T('mistakesHint')}</p>
          </div>` : ''}
        </div>
      </div>`;

    document.getElementById('timer-toggle').addEventListener('click', function () {
      settings.timer = !settings.timer;
      this.classList.toggle('active');
      document.getElementById('timer-duration-row').style.display = settings.timer ? 'flex' : 'none';
    });
    document.getElementById('shuffle-toggle').addEventListener('click', function () {
      settings.shuffle = !settings.shuffle; this.classList.toggle('active');
    });
    bindOptionGroup('[data-dur]', btn => { settings.timerDuration = parseInt(btn.dataset.dur); });
    bindOptionGroup('[data-exp]', btn => { settings.showExplanations = btn.dataset.exp; });
    bindOptionGroup('[data-simdur]', btn => { settings.simDuration = parseInt(btn.dataset.simdur); });
    bindOptionGroup('[data-mode]', btn => {
      settings.mode = btn.dataset.mode;
      const sim = settings.mode === 'sim';
      document.getElementById('sim-duration-row').style.display = sim ? 'flex' : 'none';
      document.getElementById('timer-row').style.display = sim ? 'none' : 'flex';
      document.getElementById('timer-duration-row').style.display = settings.timer && !sim ? 'flex' : 'none';
      document.getElementById('explanations-row').style.display = sim ? 'none' : 'flex';
      document.getElementById('sim-hint').style.display = sim ? 'block' : 'none';
    });
    bindOptionGroup('[data-qtype]', btn => {
      settings.questionTypes = btn.dataset.qtype;
      const f = getFilteredQuestions();
      container.querySelector('.quiz-info').textContent = T('quizInfo', { n: f.length, mc: objCount, oe: oeCount });
    });
    document.getElementById('start-quiz-btn').addEventListener('click', () => startQuiz());
    const mistakesBtn = document.getElementById('retake-mistakes-btn');
    if (mistakesBtn) mistakesBtn.addEventListener('click', () => startQuiz(Decks.getMistakes()));
  }

  function bindOptionGroup(selector, onPick) {
    container.querySelectorAll(selector).forEach(btn => {
      btn.addEventListener('click', () => {
        onPick(btn);
        container.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // ===== Run =====
  // Pass an explicit question list (e.g. the mistake notebook) to bypass the
  // type filter; otherwise the configured filter applies.
  function startQuiz(customQs) {
    const T = i18n.t;
    clearInterval(simInterval);
    let qs = Array.isArray(customQs) ? customQs.slice() : getFilteredQuestions();
    // Simulation is objective-only: AI grading mid-exam would break the
    // one-sitting format, so open-ended questions are dropped regardless of
    // the type filter (and even for custom lists like the mistake notebook).
    if (settings.mode === 'sim') qs = qs.filter(isObjective);
    if (qs.length === 0) { App.showToast(T('noQuestions'), 'error'); return; }
    if (settings.shuffle) {
      for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
    }
    state = { questions: qs, current: 0, answers: [], startTime: Date.now(), questionStartTime: Date.now(), timeLeft: settings.timerDuration };
    if (settings.mode === 'sim') {
      state.mode = 'sim';
      state.simTimeLeft = settings.simDuration * 60;
      simInterval = setInterval(simTick, 1000);
    }
    renderQuestion();
  }

  // ===== Simulation (deneme) helpers =====
  function fmtClock(secs) { return Math.floor(secs / 60) + ':' + (secs % 60).toString().padStart(2, '0'); }

  function simIsAnswered(idx) { return state.answers.some(a => a.questionIdx === idx); }

  function simTick() {
    if (!state || state.mode !== 'sim' || state.finished) { clearInterval(simInterval); return; }
    state.simTimeLeft--;
    const el = document.getElementById('sim-timer');
    const ring = document.getElementById('sim-timer-ring');
    const wrap = document.getElementById('sim-timer-wrap');
    if (el) el.textContent = fmtClock(Math.max(0, state.simTimeLeft));
    if (ring) ring.style.strokeDashoffset = (100 * (1 - state.simTimeLeft / (settings.simDuration * 60))).toFixed(1);
    if (wrap && state.simTimeLeft < 60) wrap.classList.add('warning');
    if (state.simTimeLeft <= 0) finishExam(true);
  }

  // One persistent countdown for the whole sitting + an optik-form style
  // question navigator (current / answered / blank chips).
  function renderSimHeader() {
    const T = i18n.t;
    const totalSecs = settings.simDuration * 60;
    const offset = (100 * (1 - state.simTimeLeft / totalSecs)).toFixed(1);
    const chips = state.questions.map((q, i) =>
      `<button class="sim-chip ${i === state.current ? 'current' : simIsAnswered(i) ? 'answered' : ''}" data-nav="${i}">${i + 1}</button>`).join('');
    return `
        <div class="sim-header">
          <span class="quiz-timer-wrap ${state.simTimeLeft < 60 ? 'warning' : ''}" id="sim-timer-wrap" role="timer" aria-label="${esc(T('simDuration'))}">
            <svg viewBox="0 0 36 36"><circle class="qt-track" cx="18" cy="18" r="15"/><circle class="qt-fill" id="sim-timer-ring" cx="18" cy="18" r="15" pathLength="100" style="stroke-dashoffset:${offset}"/></svg>
            <span class="quiz-timer" id="sim-timer">${fmtClock(state.simTimeLeft)}</span>
          </span>
          <button class="btn-ghost sim-finish-btn" id="sim-finish-btn">${T('finishExam')}</button>
          <div class="sim-nav">${chips}</div>
        </div>`;
  }

  // Answered questions can be revisited but not changed: like a pencil-marked
  // optik form, a committed answer is final (deliberate simplification —
  // erasing is not supported). Controls are shown disabled with the recorded
  // answer selected; no listeners are wired, so nothing re-records.
  function simMarkReadOnly(q, a) {
    if (q.type === 'true-false') {
      container.querySelectorAll('.tf-option').forEach(opt => {
        opt.classList.add('disabled');
        if (a.selected !== undefined && (opt.dataset.tf === 'true') === a.selected) opt.classList.add('selected');
      });
    } else if (q.type === 'fill-blank') {
      const inp = document.getElementById('fill-input');
      if (inp) { inp.value = a.answerText || ''; inp.disabled = true; }
      const btn = document.getElementById('fill-submit-btn'); if (btn) btn.disabled = true;
    } else if (q.type === 'matching') {
      container.querySelectorAll('.match-select').forEach(sel => {
        const i = parseInt(sel.dataset.i);
        if (a.selections && a.selections[i]) sel.value = a.selections[i];
        sel.disabled = true;
      });
      const btn = document.getElementById('match-submit-btn'); if (btn) btn.disabled = true;
    } else {
      container.querySelectorAll('.quiz-option').forEach(opt => {
        opt.classList.add('disabled');
        if (parseInt(opt.dataset.idx) === a.selected) opt.classList.add('selected');
      });
    }
  }

  // After a silent recording: jump to the next unanswered question, or submit
  // when every question has been committed (answers are final anyway).
  function simAfterAnswer() {
    const total = state.questions.length;
    for (let step = 1; step <= total; step++) {
      const idx = (state.current + step) % total;
      if (!simIsAnswered(idx)) { state.current = idx; renderQuestion(); return; }
    }
    finishExam(false);
  }

  function confirmFinishExam() {
    const unanswered = state.questions.filter((q, i) => !simIsAnswered(i)).length;
    if (unanswered > 0 && !confirm(i18n.t('simUnansweredConfirm', { n: unanswered }))) return;
    finishExam(false);
  }

  function finishExam(timeUp) {
    if (!state || state.mode !== 'sim' || state.finished) return;
    state.finished = true;
    clearInterval(simInterval);
    // Every unanswered question records a 'blank' entry shaped exactly like
    // the ones recordObjective produces, so the existing results pipeline
    // (Net, mistake notebook, Stats.recordExam) works unchanged.
    state.questions.forEach((q, i) => {
      if (simIsAnswered(i)) return;
      const extra = q.type === 'multiple-choice' ? { selected: -1 }
        : q.type === 'fill-blank' ? { answerText: '' }
        : q.type === 'matching' ? { correctPairs: 0, totalPairs: q.pairs.length }
        : {};
      state.answers.push(Object.assign({ questionIdx: i, qType: q.type, result: 'blank', time: 0 }, extra));
    });
    if (timeUp) App.showToast(i18n.t('simTimeUp'), 'info');
    Sound.play('complete');
    showResults();
  }

  function renderQuestion() {
    if (!container) init();
    const T = i18n.t;
    const { questions: qs, current } = state;
    const q = qs[current];
    const total = qs.length;
    const sim = state.mode === 'sim';

    let timerHtml = '';
    if (!sim && settings.timer) {
      state.timeLeft = settings.timerDuration;
      timerHtml = `<span class="quiz-timer-wrap" id="quiz-timer-wrap" role="timer" aria-label="${esc(T('timePerQ'))}">
        <svg viewBox="0 0 36 36"><circle class="qt-track" cx="18" cy="18" r="15"/><circle class="qt-fill" id="quiz-timer-ring" cx="18" cy="18" r="15" pathLength="100"/></svg>
        <span class="quiz-timer" id="quiz-timer">${settings.timerDuration}s</span>
      </span>`;
    }
    state.questionStartTime = Date.now();
    const answeredEntry = sim ? state.answers.find(a => a.questionIdx === current) : null;
    const progress = sim ? state.answers.length / total : current / total;

    container.innerHTML = `
      <div class="quiz-container">
        ${sim ? renderSimHeader() : ''}
        <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${progress * 100}%"></div></div>
        <div class="quiz-question-number">${T('questionOf', { c: current + 1, t: total })}
          <span class="q-type-badge">${esc(typeLabel(q.type))}</span> ${timerHtml}</div>
        <p class="quiz-question-text">${renderStem(q)}</p>
        <div id="quiz-body">${renderBody(q)}</div>
        <div id="quiz-feedback"></div>
      </div>`;

    if (sim) {
      document.getElementById('sim-finish-btn').addEventListener('click', confirmFinishExam);
      container.querySelectorAll('.sim-chip').forEach(chip =>
        chip.addEventListener('click', () => { state.current = parseInt(chip.dataset.nav); renderQuestion(); }));
    }
    if (answeredEntry) simMarkReadOnly(q, answeredEntry);
    else wireBody(q);

    if (!sim && settings.timer) {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        state.timeLeft--;
        const el = document.getElementById('quiz-timer');
        const ring = document.getElementById('quiz-timer-ring');
        const wrap = document.getElementById('quiz-timer-wrap');
        if (el) el.textContent = state.timeLeft + 's';
        if (ring) ring.style.strokeDashoffset = (100 * (1 - state.timeLeft / settings.timerDuration)).toFixed(1);
        if (state.timeLeft <= 5 && state.timeLeft > 0) {
          if (wrap) wrap.classList.add('warning');
          Sound.play('click');
        }
        if (state.timeLeft <= 0) { clearInterval(timerInterval); timeOut(q); }
      }, 1000);
    }
  }

  // The stem: for fill-blank show the blank as a styled gap.
  function renderStem(q) {
    if (q.type === 'fill-blank') return esc(q.question).replace(/_{2,}/, '<span class="fill-gap">_____</span>');
    return esc(q.question);
  }

  function renderBody(q) {
    const T = i18n.t;
    if (q.type === 'open-ended') {
      return `<div class="open-ended-area">
          <span class="oe-badge">${T('writtenAnswer')}</span>
          <textarea class="oe-textarea" id="oe-answer" placeholder="${T('typeAnswer')}" spellcheck="false"></textarea>
          <button class="btn-primary oe-submit-btn" id="oe-submit-btn">${T('submitAnswer')}</button>
        </div>`;
    }
    if (q.type === 'true-false') {
      return `<div class="quiz-options tf-options" id="quiz-options">
          <button class="quiz-option tf-option" data-tf="true">${T('tfTrue')}</button>
          <button class="quiz-option tf-option" data-tf="false">${T('tfFalse')}</button>
        </div>`;
    }
    if (q.type === 'fill-blank') {
      return `<div class="fill-area">
          <input type="text" class="fill-input" id="fill-input" placeholder="${T('fillPlaceholder')}" autocomplete="off" spellcheck="false">
          <button class="btn-primary" id="fill-submit-btn">${T('checkAnswer')}</button>
        </div>`;
    }
    if (q.type === 'matching') {
      const rights = q.pairs.map(p => p.right);
      const shuffled = rights.slice();
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      const rows = q.pairs.map((p, i) => `
          <div class="match-row" data-i="${i}">
            <span class="match-left">${esc(p.left)}</span>
            <select class="match-select" data-i="${i}">
              <option value="">${esc(T('matchChoose'))}</option>
              ${shuffled.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>
          </div>`).join('');
      return `<div class="match-area">${rows}
          <button class="btn-primary" id="match-submit-btn">${T('checkAnswer')}</button>
        </div>`;
    }
    // multiple-choice
    return `<div class="quiz-options" id="quiz-options">
        ${q.options.map((opt, i) => `<button class="quiz-option" data-idx="${i}"><span class="opt-letter">${OPT_LETTERS[i] || '?'}</span>${esc(opt)}</button>`).join('')}
      </div>`;
  }

  function wireBody(q) {
    if (q.type === 'open-ended') {
      document.getElementById('oe-submit-btn').addEventListener('click', submitOpenEnded);
    } else if (q.type === 'true-false') {
      container.querySelectorAll('.tf-option').forEach(btn =>
        btn.addEventListener('click', () => gradeTrueFalse(q, btn.dataset.tf === 'true', btn)));
    } else if (q.type === 'fill-blank') {
      const submit = () => gradeFillBlank(q);
      document.getElementById('fill-submit-btn').addEventListener('click', submit);
      const inp = document.getElementById('fill-input');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      inp.focus();
    } else if (q.type === 'matching') {
      document.getElementById('match-submit-btn').addEventListener('click', () => gradeMatching(q));
    } else {
      container.querySelectorAll('.quiz-option').forEach(btn =>
        btn.addEventListener('click', () => gradeMultipleChoice(q, parseInt(btn.dataset.idx))));
    }
  }

  function timeOut(q) {
    if (q.type === 'open-ended') { submitOpenEnded(); return; }
    if (q.type === 'multiple-choice') { gradeMultipleChoice(q, -1); return; }
    if (q.type === 'true-false') { recordObjective(q, 'blank'); revealTrueFalse(q, null); showNextButton(q); return; }
    if (q.type === 'fill-blank') { gradeFillBlank(q, true); return; }
    if (q.type === 'matching') { gradeMatching(q, true); return; }
  }

  // ===== Grading per type =====
  function recordObjective(q, result, extra) {
    state.answers.push(Object.assign({
      questionIdx: state.current, qType: q.type, result, // 'correct' | 'wrong' | 'blank'
      time: Math.floor((Date.now() - state.questionStartTime) / 1000)
    }, extra || {}));
  }

  // Animated per-option verdicts: a checkmark that draws itself on the
  // correct option, a drawn cross + shake on a wrong pick.
  const CHECK_SVG = '<svg class="opt-check" viewBox="0 0 24 24"><path d="M5 13l4 4 10-10"/></svg>';
  const CROSS_SVG = '<svg class="opt-cross" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';

  function feedbackSound(result) {
    Sound.play(result === 'correct' ? 'correct' : result === 'blank' ? 'flip' : 'wrong');
    Sound.haptic(result === 'correct' ? [12, 40, 12] : 25);
  }

  function gradeMultipleChoice(q, idx) {
    clearInterval(timerInterval);
    const result = idx < 0 ? 'blank' : (idx === q.correct ? 'correct' : 'wrong');
    recordObjective(q, result, { selected: idx });
    if (state.mode === 'sim') { simAfterAnswer(); return; } // no feedback until the end
    feedbackSound(result);
    container.querySelectorAll('.quiz-option').forEach(opt => {
      opt.classList.add('disabled');
      const i = parseInt(opt.dataset.idx);
      if (i === q.correct) { opt.classList.add('correct'); opt.innerHTML += CHECK_SVG; }
      if (i === idx && result === 'wrong') { opt.classList.add('wrong', 'shake'); opt.innerHTML += CROSS_SVG; }
    });
    showNextButton(q);
  }

  function gradeTrueFalse(q, chosen, btn) {
    clearInterval(timerInterval);
    const result = chosen === !!q.correct ? 'correct' : 'wrong';
    recordObjective(q, result, { selected: chosen });
    if (state.mode === 'sim') { simAfterAnswer(); return; } // no feedback until the end
    feedbackSound(result);
    revealTrueFalse(q, chosen);
    showNextButton(q);
  }
  function revealTrueFalse(q, chosen) {
    container.querySelectorAll('.tf-option').forEach(opt => {
      opt.classList.add('disabled');
      const val = opt.dataset.tf === 'true';
      if (val === !!q.correct) opt.classList.add('correct');
      else if (chosen !== null && val === chosen) opt.classList.add('wrong', 'shake');
    });
  }

  function gradeFillBlank(q, fromTimeout) {
    clearInterval(timerInterval);
    const inp = document.getElementById('fill-input');
    const val = inp ? inp.value.trim() : '';
    const accepted = (q.answers || []).map(normalize);
    const result = !val ? 'blank' : (accepted.includes(normalize(val)) ? 'correct' : 'wrong');
    recordObjective(q, result, { answerText: val });
    if (state.mode === 'sim') { simAfterAnswer(); return; } // no feedback until the end
    feedbackSound(result);
    if (inp) {
      inp.disabled = true;
      inp.classList.add(result === 'correct' ? 'correct' : 'wrong');
      if (result === 'wrong') inp.classList.add('shake');
    }
    const btn = document.getElementById('fill-submit-btn'); if (btn) btn.disabled = true;
    const fb = document.getElementById('quiz-feedback');
    fb.innerHTML = `<div class="fill-answer ${result}">
        <span class="fill-answer-label">${i18n.t(result === 'correct' ? 'correctLabel' : 'acceptedAnswer')}</span>
        ${esc((q.answers || []).join(' / '))}</div>`;
    showNextButton(q);
  }

  function gradeMatching(q, fromTimeout) {
    clearInterval(timerInterval);
    const sim = state.mode === 'sim';
    const selects = container.querySelectorAll('.match-select');
    let correctPairs = 0, anyChosen = false;
    const selections = [];
    selects.forEach(sel => {
      const i = parseInt(sel.dataset.i);
      const chosen = sel.value;
      const right = q.pairs[i].right;
      if (chosen) anyChosen = true;
      selections[i] = chosen;
      const ok = normalize(chosen) === normalize(right);
      if (ok) correctPairs++;
      if (sim) return; // no feedback until the end
      const row = container.querySelector(`.match-row[data-i="${i}"]`);
      sel.disabled = true;
      if (ok) { row.classList.add('correct'); }
      else { row.classList.add('wrong', 'shake'); row.insertAdjacentHTML('beforeend', `<span class="match-correct">→ ${esc(right)}</span>`); }
    });
    const total = q.pairs.length;
    const result = !anyChosen ? 'blank' : (correctPairs === total ? 'correct' : (correctPairs === 0 ? 'wrong' : 'partial'));
    // In sim the per-pair picks are kept too, so a revisited question can
    // redisplay them read-only (extra field; the results pipeline ignores it).
    recordObjective(q, result, sim ? { correctPairs, totalPairs: total, selections } : { correctPairs, totalPairs: total });
    if (sim) { simAfterAnswer(); return; }
    feedbackSound(result === 'partial' ? 'correct' : result);
    const btn = document.getElementById('match-submit-btn'); if (btn) btn.disabled = true;
    showNextButton(q);
  }

  async function submitOpenEnded() {
    clearInterval(timerInterval);
    const T = i18n.t;
    const q = state.questions[state.current];
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
    try { gradeResult = Parser.parseGrade(await API.grade(studentAnswer, q.correctAnswer, q.keyPoints)); }
    catch (err) { gradeResult = fallbackGrade(studentAnswer, q); }

    state.answers.push({
      questionIdx: state.current, qType: 'open-ended', studentAnswer,
      score: gradeResult.score, maxScore: gradeResult.maxScore, feedback: gradeResult.feedback,
      missedPoints: gradeResult.missedPoints, correctAnswer: q.correctAnswer,
      time: Math.floor((Date.now() - state.questionStartTime) / 1000)
    });
    feedbackSound(gradeResult.score >= 2 ? 'correct' : 'wrong');

    const scoreColor = gradeResult.score === 3 ? 'var(--correct)' : gradeResult.score === 2 ? 'var(--highlight)' : gradeResult.score === 1 ? '#f97316' : 'var(--wrong)';
    let html = `<div class="oe-grade-result" style="animation: fadeSlideUp 0.3s ease">
      <div class="oe-score" style="color:${scoreColor}">${gradeResult.score}/${gradeResult.maxScore}</div>
      <div class="oe-feedback">${esc(gradeResult.feedback)}</div>`;
    if (gradeResult.missedPoints && gradeResult.missedPoints.length) {
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
    const ratio = q.keyPoints.length ? matched.length / q.keyPoints.length : 0;
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

  // ===== Results (Turkish scoring) =====
  function objectivePoints(a) {
    // 1 point per objective question; matching gets a fraction of its pairs.
    if (a.qType === 'matching') return a.totalPairs ? a.correctPairs / a.totalPairs : 0;
    return a.result === 'correct' ? 1 : 0;
  }

  function showResults() {
    clearInterval(timerInterval);
    const T = i18n.t;
    const { answers, startTime } = state;
    const total = state.questions.length;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    const objAnswers = answers.filter(a => a.qType !== 'open-ended');
    const oeAnswers = answers.filter(a => a.qType === 'open-ended');

    const dogru = objAnswers.filter(a => a.result === 'correct').length;
    const yanlis = objAnswers.filter(a => a.result === 'wrong').length;
    const bos = objAnswers.filter(a => a.result === 'blank').length;
    const partial = objAnswers.filter(a => a.result === 'partial').length;

    // Net for multiple-choice section (YKS: net = doğru − yanlış / 4)
    const mc = objAnswers.filter(a => a.qType === 'multiple-choice');
    const mcCorrect = mc.filter(a => a.result === 'correct').length;
    const mcWrong = mc.filter(a => a.result === 'wrong').length;
    const net = Math.max(0, mcCorrect - mcWrong / 4);

    const oePoints = oeAnswers.reduce((s, a) => s + a.score, 0);
    const oeMax = oeAnswers.reduce((s, a) => s + a.maxScore, 0);

    const earned = objAnswers.reduce((s, a) => s + objectivePoints(a), 0) + (oeMax ? (oePoints / oeMax) * oeAnswers.length : 0);
    const possible = objAnswers.length + oeAnswers.length;
    const pct = possible > 0 ? Math.round((earned / possible) * 100) : 0;

    let grade, gradeClass;
    if (pct >= 85) { grade = 'AA'; gradeClass = 'grade-a'; }
    else if (pct >= 70) { grade = 'BA'; gradeClass = 'grade-b'; }
    else if (pct >= 60) { grade = 'BB'; gradeClass = 'grade-c'; }
    else if (pct >= 50) { grade = 'CC'; gradeClass = 'grade-d'; }
    else { grade = 'FF'; gradeClass = 'grade-f'; }

    const stat = (val, label, color) =>
      `<div class="quiz-result-stat"><span class="quiz-result-stat-value"${color ? ` style="color:${color}"` : ''}>${val}</span><span class="quiz-result-stat-label">${label}</span></div>`;

    container.innerHTML = `
      <div class="quiz-container"><div class="quiz-results">
        <div class="quiz-score-ring">
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="var(--primary)"/>
                <stop offset="1" stop-color="var(--secondary)"/>
              </linearGradient>
            </defs>
            <circle class="ring-track" cx="60" cy="60" r="52"/>
            <circle class="ring-fill" cx="60" cy="60" r="52" pathLength="100"/>
          </svg>
          <div class="ring-center">
            <span class="quiz-score-value" id="quiz-score-num">0</span>
            <span class="quiz-score-percent">${T('points100')}</span>
          </div>
        </div>
        <div class="quiz-grade ${gradeClass}">${grade}</div>
        <div class="quiz-result-stats">
          ${objAnswers.length ? stat(dogru, T('correctCount'), 'var(--correct)') : ''}
          ${objAnswers.length ? stat(yanlis, T('wrongCount'), 'var(--wrong)') : ''}
          ${objAnswers.length ? stat(bos, T('blankCount'), 'var(--text-muted)') : ''}
          ${partial ? stat(partial, T('partialCount'), 'var(--highlight)') : ''}
          ${mc.length ? stat(net.toFixed(2), T('netScore'), 'var(--secondary)') : ''}
          ${oeAnswers.length ? stat(oePoints + '/' + oeMax, T('writtenPts'), 'var(--secondary)') : ''}
          ${stat(Math.floor(elapsed / 60) + ':' + (elapsed % 60).toString().padStart(2, '0'), T('time'))}
        </div>
        <div class="quiz-result-actions">
          <button class="btn-primary" id="review-btn">${T('reviewAnswers')}</button>
          <button class="btn-ghost" id="retake-btn">${T('retakeExam')}</button>
        </div>
        <div class="quiz-review" id="quiz-review" style="display:none"></div>
      </div></div>`;

    // Mistake notebook (yanlış defteri): wrong/blank answers are filed for a
    // targeted retake; answering correctly clears the question from the bank.
    if (typeof Decks !== 'undefined') {
      const wrongQs = [], rightQs = [];
      answers.forEach(a => {
        const q = state.questions[a.questionIdx];
        const ok = a.qType === 'open-ended' ? a.score >= 2 : a.result === 'correct';
        (ok ? rightQs : wrongQs).push(q);
      });
      Decks.addMistakes(wrongQs);
      Decks.resolveMistakes(rightQs);
    }

    // Record the result for the Stats tab (exam history + score chart).
    if (typeof Stats !== 'undefined') {
      const title = (typeof App !== 'undefined' && App.getStudyData && App.getStudyData()) ? App.getStudyData().title : '';
      Stats.recordExam(pct, grade, title);
    }

    // Animate the gauge: the ring transitions to the score (see fx.css) while
    // the number counts up in sync; the result stats cascade in.
    const ringFill = container.querySelector('.ring-fill');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (ringFill) ringFill.style.setProperty('--pct', pct);
    }));
    FX.countUp(document.getElementById('quiz-score-num'), pct, { duration: 1200 });
    container.querySelectorAll('.quiz-result-stat').forEach((el, i) => el.style.setProperty('--i', i));

    if (pct >= 85) { FX.celebrate(); if (state.mode !== 'sim') Sound.play('complete'); } // sim already played it on finish
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
      const ok = a.qType === 'open-ended' ? a.score >= 3 : a.result === 'correct';
      html += `<div class="review-question" data-correct="${ok}">
        <p class="review-question-text">${i + 1}. ${esc(q.question)} <span class="oe-badge-sm">${esc(typeLabel(q.type))}</span></p>`;

      if (a.qType === 'multiple-choice') {
        if (a.result === 'blank') html += `<div class="review-answer your-wrong">${T('blankCount')}</div>`;
        else html += `<div class="review-answer ${a.result === 'correct' ? 'your-correct' : 'your-wrong'}">${T('yourAnswer')} ${esc(q.options[a.selected])}</div>`;
        if (a.result !== 'correct') html += `<div class="review-answer correct-answer">${T('correct')} ${esc(q.options[q.correct])}</div>`;
      } else if (a.qType === 'true-false') {
        const ans = v => v ? T('tfTrue') : T('tfFalse');
        if (a.result === 'blank') html += `<div class="review-answer your-wrong">${T('blankCount')}</div>`;
        else html += `<div class="review-answer ${a.result === 'correct' ? 'your-correct' : 'your-wrong'}">${T('yourAnswer')} ${ans(a.selected)}</div>`;
        if (a.result !== 'correct') html += `<div class="review-answer correct-answer">${T('correct')} ${ans(!!q.correct)}</div>`;
      } else if (a.qType === 'fill-blank') {
        html += `<div class="review-answer ${a.result === 'correct' ? 'your-correct' : 'your-wrong'}">${T('yourAnswer')} ${esc(a.answerText || '(-)')}</div>`;
        if (a.result !== 'correct') html += `<div class="review-answer correct-answer">${T('acceptedAnswer')} ${esc((q.answers || []).join(' / '))}</div>`;
      } else if (a.qType === 'matching') {
        html += `<div class="review-answer ${a.result === 'correct' ? 'your-correct' : 'your-wrong'}">${a.correctPairs}/${a.totalPairs} ${T('pairsCorrect')}</div>`;
        html += `<div class="review-explanation">${q.pairs.map(p => esc(p.left) + ' → ' + esc(p.right)).join('<br>')}</div>`;
      } else {
        const scoreColor = a.score === 3 ? 'var(--correct)' : a.score === 2 ? 'var(--highlight)' : a.score === 1 ? '#f97316' : 'var(--wrong)';
        html += `<div class="review-answer ${a.score >= 2 ? 'your-correct' : 'your-wrong'}">${T('yourAnswer')} ${esc(a.studentAnswer || '(-)')}</div>`;
        html += `<div class="oe-review-score" style="color:${scoreColor}">${T('score')} ${a.score}/${a.maxScore}</div>`;
        if (a.feedback) html += `<div class="review-explanation">${esc(a.feedback)}</div>`;
        html += `<div class="review-answer correct-answer">${T('modelAnswer')} ${esc(a.correctAnswer)}</div>`;
      }
      if (q.explanation && a.qType !== 'open-ended') html += `<div class="review-explanation">${esc(q.explanation)}</div>`;
      // Wrong answers get a one-click bridge to the AI tutor.
      if (!ok) html += `<button class="btn-ghost explain-btn" data-qi="${a.questionIdx}">&#128172; ${T('explainThis')}</button>`;
      html += `</div>`;
    });

    reviewEl.innerHTML = html;
    reviewEl.querySelectorAll('.explain-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = qs[parseInt(btn.dataset.qi)];
        const correctText = q.type === 'multiple-choice' ? q.options[q.correct]
          : q.type === 'true-false' ? (q.correct ? T('tfTrue') : T('tfFalse'))
          : q.type === 'fill-blank' ? (q.answers || []).join(' / ')
          : q.type === 'matching' ? q.pairs.map(p => p.left + ' → ' + p.right).join('; ')
          : q.correctAnswer;
        App.switchTab('chat');
        Chat.sendMessage(T('explainPrompt', { q: q.question, a: correctText }));
      });
    });
    reviewEl.style.display = 'block';
    let wrongOnly = false;
    document.getElementById('show-wrong-only').addEventListener('click', function () {
      wrongOnly = !wrongOnly;
      this.textContent = wrongOnly ? T('showAll') : T('showWrongOnly');
      reviewEl.querySelectorAll('.review-question').forEach(el => {
        el.style.display = (wrongOnly && el.dataset.correct === 'true') ? 'none' : '';
      });
    });
  }

  function esc(str) { if (str == null) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }

  return { init, setQuestions, addQuestions, renderReady, startQuiz };
})();

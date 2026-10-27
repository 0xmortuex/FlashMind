// ===== Insights (Stats tab) =====
// Two diagnostics that turn raw review data into exam advice:
//  - Calibration: how often you're right when you said you were sure /
//    unsure / guessing, and the "overconfident" cards — the ones you were
//    sure about and still got wrong (the costliest kind of error in an exam).
//  - Mistake analysis: wrong exam answers by cause (didn't know, careless,
//    misread, ran out of time), plus an AI diagnosis of the misconceptions
//    behind them.
const Insights = (() => {
  let diagnosis = null; // { deckId, text } — cached per session
  let diagnosing = false;

  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // Pure: totals per confidence level + overconfident card ids, newest first.
  function calibration(deck) {
    const calib = deck && deck.calib && typeof deck.calib === 'object' ? deck.calib : {};
    const levels = { sure: [0, 0], unsure: [0, 0], guess: [0, 0] };
    const over = [];
    Object.entries(calib).forEach(([id, c]) => {
      Object.keys(levels).forEach(k => {
        if (Array.isArray(c[k])) { levels[k][0] += c[k][0] || 0; levels[k][1] += c[k][1] || 0; }
      });
      if (Array.isArray(c.sure) && c.sure[1] > 0) over.push({ id, misses: c.sure[1], t: c.lastSureMiss || 0 });
    });
    over.sort((a, b) => b.t - a.t);
    return { levels, over };
  }

  function calibrationCard(deck) {
    const T = i18n.t;
    const { levels, over } = calibration(deck);
    const total = Object.values(levels).reduce((a, l) => a + l[0] + l[1], 0);
    if (!total) {
      return `<div class="stat-card"><h3 class="stat-card-title">${T('calTitle')}</h3><p class="plan-pitch">${T('calEmpty')}</p></div>`;
    }
    const cards = (deck.data && deck.data.flashcards) || [];
    const byId = new Map(cards.map(c => [String(c.id), c]));
    const overCards = over.map(o => byId.get(String(o.id))).filter(Boolean);
    const row = (k, icon) => {
      const [ok, miss] = levels[k];
      const n = ok + miss;
      const pct = n ? Math.round(ok / n * 100) : 0;
      return `<div class="cal-row"><span class="cal-label">${icon} ${T('conf_' + k)}</span>
        <span class="qb-bar"><span class="qb-fill ${pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'bad'}" style="width:${n ? pct : 0}%"></span></span>
        <span class="cal-num">${n ? pct + '%' : '—'} <small>(${n})</small></span></div>`;
    };
    const sureN = levels.sure[0] + levels.sure[1];
    const surePct = sureN ? levels.sure[0] / sureN : 1;
    return `<div class="stat-card">
      <h3 class="stat-card-title">${T('calTitle')}</h3>
      ${row('sure', '&#128526;')}${row('unsure', '&#129300;')}${row('guess', '&#128556;')}
      <p class="cal-verdict">${sureN >= 5 && surePct < 0.85 ? T('calOverconfident', { p: Math.round(surePct * 100) }) : T('calHint')}</p>
      ${overCards.length ? `<div class="cal-over">
        <div class="cal-over-title">&#9888;&#65039; ${T('calOverTitle', { n: overCards.length })}</div>
        ${overCards.slice(0, 5).map(c => `<div class="cal-over-card">${esc(c.front)}</div>`).join('')}
        <button class="btn-primary" data-ins-act="study-over">${T('calStudyOver')}</button>
      </div>` : ''}
    </div>`;
  }

  const TYPES = ['concept', 'careless', 'misread', 'time'];

  function mistakeCard(deck) {
    const T = i18n.t;
    const ms = deck && Array.isArray(deck.mistakes) ? deck.mistakes : [];
    if (!ms.length) return '';
    const counts = { concept: 0, careless: 0, misread: 0, time: 0, untagged: 0 };
    ms.forEach(m => { counts[TYPES.includes(m.mtype) ? m.mtype : 'untagged']++; });
    const top = TYPES.filter(k => counts[k]).sort((a, b) => counts[b] - counts[a])[0];
    const cached = diagnosis && diagnosis.deckId === deck.id ? diagnosis.text : '';
    return `<div class="stat-card">
      <h3 class="stat-card-title">${T('mtTitle')}</h3>
      <div class="mt-grid">${TYPES.map(k => `<div class="mt-cell"><span class="mt-num">${counts[k]}</span><span class="mt-label">${T('mt_' + k)}</span></div>`).join('')}</div>
      ${counts.untagged ? `<p class="plan-pitch">${T('mtUntagged', { n: counts.untagged })}</p>` : ''}
      ${top ? `<p class="cal-verdict">${T('mtAdvice_' + top)}</p>` : ''}
      <div id="mt-diagnosis">${cached ? `<div class="weekly-report-text">${esc(cached)}</div>`
        : `<button class="btn-ghost" data-ins-act="diagnose" ${diagnosing ? 'disabled' : ''}>&#10024; ${diagnosing ? T('mtDiagnosing') : T('mtDiagnose')}</button>`}</div>
    </div>`;
  }

  function statsCards() {
    const deck = typeof Decks !== 'undefined' ? Decks.getActive() : null;
    if (!deck) return '';
    return calibrationCard(deck) + mistakeCard(deck);
  }

  async function diagnose() {
    const deck = Decks.getActive();
    if (!deck || diagnosing) return;
    const ms = (deck.mistakes || []).slice(-25);
    if (!ms.length) return;
    diagnosing = true;
    rerender();
    const lines = ms.map((m, i) => {
      const keyed = typeof Checker !== 'undefined' ? Checker.answerText(m) : '';
      return `${i + 1}. Q: ${m.question}\n   Correct: ${keyed}\n   Student answered: ${m._given || '(blank)'}${m.mtype ? `\n   Student's own tag: ${m.mtype}` : ''}`;
    }).join('\n');
    const prompt = 'Here are exam questions a student got wrong, with their answers. Diagnose the underlying misconceptions: ' +
      'group the mistakes into at most 3 patterns (what the student seems to believe vs. what is true), name the concept to ' +
      're-learn for each, and finish with one concrete exercise to fix the biggest one. Plain text, max 160 words, in the ' +
      'language of the questions.\n\n' + lines;
    try {
      const raw = await API.chat(prompt, App.getOriginalText());
      const text = (Parser.parseChat(raw).answer || '').trim();
      if (!text) throw new Error('empty');
      diagnosis = { deckId: deck.id, text };
    } catch (err) {
      App.showToast(i18n.t('chatError'), 'error');
    } finally {
      diagnosing = false;
      rerender();
    }
  }

  function studyOverconfident() {
    const deck = Decks.getActive();
    if (!deck) return;
    const ids = new Set(calibration(deck).over.map(o => String(o.id)));
    const cards = (deck.data.flashcards || []).filter(c => ids.has(String(c.id))).map(c => Object.assign({}, c));
    if (!cards.length) return;
    Flashcards.startQueue(cards);
  }

  function rerender() {
    const tab = document.getElementById('tab-stats');
    if (tab && tab.classList.contains('active') && typeof Stats !== 'undefined') Stats.render();
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-ins-act]');
      if (!b) return;
      if (b.dataset.insAct === 'diagnose') diagnose();
      else if (b.dataset.insAct === 'study-over') studyOverconfident();
    });
  }

  return { init, statsCards, calibration };
})();

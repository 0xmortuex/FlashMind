// ===== Exam predictor =====
// For a deck with an exam date: predicts the exam score on exam day from the
// memory forecast (js/memory.js), the adaptive-exam history (deck.qstats via
// Adaptive.topicAccuracy) and topic weights (share of the question bank per
// topic), with an honest uncertainty range. Also ranks every card by the
// expected exam marks a review right now would add per minute spent — the
// "next 2 hours that gain the most marks" optimizer. Pure functions + small
// render helpers used by the planner bar/card.
const Predictor = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const PRIOR = 0.4, PRIOR_W = 2;       // weak prior: unknown topic ≈ 40%
  const CAP = 30;                        // evidence per topic saturates
  const MIN_EVIDENCE = 4;                // before this, show no number
  const MIN_REVIEW = 0.2, MIN_LEARN = 0.75; // minutes per review / new card

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function params(P) { return P || (typeof Memory !== 'undefined' && (Memory.current() || Memory.defaults())) || { w: Decks.W.slice(0, 4), c: 1 }; }

  // Topic weights: share of the question bank (what the exam asks), falling
  // back to the share of cards when there are no questions.
  function weights(deck) {
    const qs = (deck.data && deck.data.quiz) || [];
    const cards = (deck.data && deck.data.flashcards) || [];
    // The question bank defines the exam's topic mix — but only when its
    // categories line up with the cards' (otherwise memory can't map onto it).
    const cardCats = new Set(cards.map(c => c.category || ''));
    const matched = qs.filter(q => cardCats.has(q.category || '')).length;
    const src = qs.length && (!cards.length || matched >= qs.length / 2) ? qs : cards;
    const w = {};
    src.forEach(x => { const k = x.category || ''; w[k] = (w[k] || 0) + 1; });
    Object.keys(w).forEach(k => { w[k] /= src.length || 1; });
    return w;
  }

  // Predicted score on exam day. Returns null without an upcoming exam.
  function predict(deck, now, P) {
    if (!deck || !deck.examDate) return null;
    now = now == null ? Date.now() : now;
    const exam = Decks.examStart(deck.examDate);
    if (!exam || exam < now - DAY) return null;
    P = params(P);
    const horizon = Math.max(exam, now);
    const f = Memory.forecast(deck, horizon, P, now);
    const qs = (deck.data && deck.data.quiz) || [];
    const qstats = deck.qstats || {};
    const acc = typeof Adaptive !== 'undefined' ? Adaptive.topicAccuracy(qs, qstats) : {};
    const answers = {};
    qs.forEach(q => { const s = qstats[q.id]; if (s) answers[q.category || ''] = (answers[q.category || ''] || 0) + (s.n || 0); });
    const mem = new Map(f.topics.map(t => [t.name, t]));
    // Topics without their own exam history fall back to overall accuracy.
    let okAll = 0, nAll = 0;
    qs.forEach(q => { const s = qstats[q.id]; if (s) { okAll += s.ok || 0; nAll += s.n || 0; } });
    const overallAcc = nAll ? (okAll + 1) / (nAll + 2) : undefined;
    const answeredAll = Math.min(nAll, CAP);
    const w = weights(deck);
    let score = 0, stop = 0, evidence = 0;
    const topics = Object.keys(w).map(name => {
      const m = mem.get(name);
      const own = answers[name] || 0;
      // Borrowed overall accuracy counts as weaker evidence than the topic's own.
      const nq = own ? Math.min(own, CAP) : (overallAcc !== undefined ? Math.min(answeredAll * w[name], CAP) * 0.5 : 0);
      const nc = m ? Math.min(m.seen, CAP) * 0.5 : 0;
      // Practice accuracy was measured now; scale it by how memory of the
      // topic's cards changes between now and exam day.
      const ratio = (to) => m && m.seen && m.now > 0.05 ? clamp(to / m.now, 0.6, 1.15) : 1;
      const keepSeen = m && m.seen ? m.keep : 0, stopSeen = m && m.seen ? m.stop : 0;
      const a = own ? acc[name] : overallAcc;
      const blend = (memV, r) => ((nq && a !== undefined ? nq * clamp(a * r, 0, 1) : 0) + nc * memV + PRIOR_W * PRIOR) / (nq + nc + PRIOR_W);
      const p = blend(m ? m.keep : 0, ratio(keepSeen));
      const pStop = blend(m ? m.stop : 0, ratio(stopSeen));
      score += w[name] * p;
      stop += w[name] * pStop;
      evidence += nq + nc;
      return { name, weight: w[name], p, pStop, acc: a, mem: m ? m.stop : null, cards: m ? m.n : 0 };
    }).sort((x, y) => (x.p - y.p) || x.name.localeCompare(y.name));
    // Uncertainty: sampling noise of the evidence plus model error (smaller
    // once the personal memory model is fitted).
    const modelErr = P.fitted ? 0.04 : 0.07;
    const sd = Math.sqrt(score * (1 - score) / Math.max(1, evidence) + modelErr * modelErr);
    const pct = v => Math.round(clamp(v, 0, 1) * 100);
    return {
      exam, daysLeft: Math.round((exam - new Date(now).setHours(0, 0, 0, 0)) / DAY),
      score: pct(score), low: pct(score - 1.64 * sd), high: pct(score + 1.64 * sd), stop: pct(stop),
      evidence: Math.round(evidence), fitted: !!P.fitted, topics,
      // Too little evidence for a meaningful number (range would be ~0–100).
      insufficient: evidence < MIN_EVIDENCE
    };
  }

  // Rank cards by expected exam marks gained per minute if reviewed now.
  // gain = recall on exam day after a successful review now − recall if left
  // alone; marks per card = 100 × topic weight ÷ cards in topic.
  function rank(deck, now, P, budget) {
    if (!deck) return null;
    now = now == null ? Date.now() : now;
    P = params(P);
    const exam = deck.examDate ? Decks.examStart(deck.examDate) : null;
    // Exam today: count recall a few hours out; no exam: a week out.
    const horizon = exam && exam > now - DAY ? Math.max(exam, now + 3 * 3600 * 1000) : now + 7 * DAY;
    const cards = (deck.data && deck.data.flashcards) || [];
    const srs = deck.srs || {};
    const w = weights(deck);
    const perTopic = {};
    cards.forEach(c => { const k = c.category || ''; perTopic[k] = (perTopic[k] || 0) + 1; });
    const nTopics = Object.keys(perTopic).length || 1;
    const days = (horizon - now) / DAY;
    const items = cards.map(c => {
      const k = c.category || '';
      const s = srs[c.id];
      const seen = !!(s && s.reps);
      const topicW = w[k] !== undefined ? w[k] : 1 / nTopics * 0.5;
      const marks = 100 * topicW / perTopic[k];
      const base = seen ? Memory.recallAt(s, horizon, P) : 0;
      const rNow = seen ? Memory.recallAt(s, now, P) : 0;
      const after = Decks.nextState(seen ? s : null, 3, now, P);
      const gain = Math.max(0, Memory.recallAt(after, horizon, P) - base);
      const cost = seen ? MIN_REVIEW + (1 - rNow) * 0.3 : MIN_LEARN;
      return { id: c.id, topic: k, seen, rExam: base, gain, marks: marks * gain, cost, mpm: marks * gain / cost };
    }).sort((a, b) => (b.mpm - a.mpm) || (String(a.id) < String(b.id) ? -1 : 1));
    const B = budget == null ? 120 : budget;
    const picked = [];
    let minutes = 0, gain = 0;
    for (const it of items) {
      if (minutes >= B || it.mpm <= 0) break;
      picked.push(it); minutes += it.cost; gain += it.marks;
    }
    const topics = {};
    picked.forEach(it => {
      const t = topics[it.topic] = topics[it.topic] || { name: it.topic, cards: 0, minutes: 0, marks: 0 };
      t.cards++; t.minutes += it.cost; t.marks += it.marks;
    });
    return {
      budget: B, minutes, marks: gain, days,
      items, picked, topics: Object.values(topics).sort((a, b) => b.marks - a.marks)
    };
  }

  // ----- Memo (per deck, per day, per model) -----
  const memo = new Map();
  function cached(kind, deck, fn) {
    const P = params();
    const key = kind + '|' + deck.id + '|' + (deck.updatedAt || 0) + '|' + new Date().toDateString() + '|' + P.c + '|' + P.w.join(',');
    const hit = memo.get(kind + deck.id);
    if (hit && hit.key === key) return hit.v;
    const v = fn();
    memo.set(kind + deck.id, { key, v });
    return v;
  }
  const predictCached = deck => cached('p', deck, () => predict(deck));
  const rankCached = (deck, budget) => cached('r' + budget, deck, () => rank(deck, Date.now(), null, budget));

  // ----- UI -----
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // One-line chip for the Flashcards plan bar.
  function barHtml(deck) {
    const p = deck && predictCached(deck);
    if (!p || p.insufficient) return '';
    return `<span class="pred-chip" title="${esc(i18n.t('predRangeHint'))}">&#127919; ${i18n.t('predChip', { s: p.score, lo: p.low, hi: p.high })}</span>`;
  }

  // Block inside the Stats plan card.
  function planHtml(deck) {
    const p = deck && predictCached(deck);
    if (!p) return '';
    const T = i18n.t;
    const r = rankCached(deck, 120);
    const topicRows = p.topics.slice(0, 6).map(t => {
      const v = Math.round(t.p * 100);
      return `<div class="pred-topic"><span class="pred-topic-name">${esc(t.name || T('memNoTopic'))}</span>
        <span class="qb-bar"><span class="qb-fill ${v >= 75 ? 'good' : v >= 50 ? 'mid' : 'bad'}" style="width:${v}%"></span></span>
        <span class="pred-topic-num">${v}%<small> &middot; ${Math.round(t.weight * 100)}%</small></span></div>`;
    }).join('');
    const opt = r && r.picked.length ? `<div class="pred-opt">
        <div class="pred-opt-head">&#9201; ${T('predOptTitle', { h: 2 })}<span class="pred-opt-gain">${T('predOptGain', { m: r.marks.toFixed(1) })}</span></div>
        ${r.topics.slice(0, 4).map(t => `<div class="pred-opt-row"><span>${esc(t.name || T('memNoTopic'))}</span><span>${T('predOptRow', { n: t.cards, m: Math.round(t.minutes), g: t.marks.toFixed(1) })}</span></div>`).join('')}
        <button class="btn-primary" data-pred-act="start" data-deck="${esc(deck.id)}">${T('predOptStart')}</button>
      </div>` : '';
    if (p.insufficient) {
      return `<div class="pred-block"><p class="plan-pitch">&#127919; ${T('predNeedData')}</p>${opt}</div>`;
    }
    return `<div class="pred-block">
      <div class="pred-head">
        <div class="pred-score"><span class="pred-score-num">${p.score}</span><span class="pred-score-range">${T('predRange', { lo: p.low, hi: p.high })}</span></div>
        <div class="pred-score-text"><strong>${T('predTitle')}</strong><span>${T('predIfStop', { s: p.stop })}</span><span class="pred-note">${T(p.fitted ? 'predNoteFitted' : 'predNoteDefault', { n: p.evidence })}</span></div>
      </div>
      ${topicRows ? `<div class="pred-topics"><div class="pred-topics-head"><span>${T('predTopic')}</span><span>${T('predTopicCols')}</span></div>${topicRows}</div>` : ''}
      ${opt}
    </div>`;
  }

  // Launch the top marks-per-minute cards (default: one 20-minute block).
  function startBest(deckId, minutes) {
    const deck = Decks.get(deckId);
    if (!deck) return;
    const r = rank(deck, Date.now(), null, minutes || 20);
    if (!r || !r.picked.length) { App.showToast(i18n.t('planNothingToday'), 'info'); return; }
    const active = Decks.getActive();
    const local = active && active.id === deckId;
    const byId = new Map(((deck.data && deck.data.flashcards) || []).map(c => [c.id, c]));
    const title = (deck.data && deck.data.title) || '';
    const items = r.picked.map(it => byId.get(it.id)).filter(Boolean)
      .map(c => local ? Object.assign({}, c) : Object.assign({}, c, { _deckId: deckId, _deckTitle: title }));
    Flashcards.startQueue(items);
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-pred-act]');
      if (!b) return;
      if (b.dataset.predAct === 'start') startBest(b.dataset.deck, 20);
    });
  }

  return { init, weights, predict, rank, barHtml, planHtml, startBest, predictCached, rankCached };
})();

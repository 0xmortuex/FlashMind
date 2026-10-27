// ===== Adaptive exams + score prediction =====
// Uses each deck's per-question history (deck.qstats, recorded after every
// exam) to (1) assemble practice sets weighted toward what you get wrong,
// haven't seen, or belongs to a weak topic, and (2) predict your score on
// the full question bank. Pure functions — no DOM.
const Adaptive = (() => {
  // Smoothed accuracy: one imagined right and one wrong answer, so a single
  // result doesn't swing a topic to 0% or 100%.
  const smooth = (ok, n) => (ok + 1) / (n + 2);

  function topicAccuracy(questions, qstats) {
    const t = {};
    questions.forEach(q => {
      const s = qstats[q.id];
      if (!s) return;
      const k = q.category || '';
      const a = t[k] = t[k] || { ok: 0, n: 0 };
      a.ok += s.ok;
      a.n += s.n;
    });
    const out = {};
    Object.keys(t).forEach(k => { out[k] = smooth(t[k].ok, t[k].n); });
    return out;
  }

  // How much a question deserves a spot in the next practice set.
  function weight(q, s, topicAcc, mistakeKeys) {
    let w = 1;
    if (!s) w += 1.5;                                   // never answered
    else if (s.last === 0) w += 3;                      // missed last time
    else if (s.ok / s.n < 0.6) w += 1.5;                // shaky
    else if (s.n >= 2 && s.ok === s.n) w -= 0.7;        // solid
    const acc = topicAcc[q.category || ''];
    if (acc !== undefined) w += 2 * (1 - acc);          // weak topic
    if (mistakeKeys && mistakeKeys.has((q.type || 'mc') + '|' + String(q.question || '').slice(0, 200))) w += 2;
    if (q.check && q.check.v && q.check.v !== 'ok') w *= 0.3; // flagged as possibly wrong
    return Math.max(0.2, w);
  }

  // Weighted sampling without replacement. `rand` is injectable for tests.
  function pick(questions, qstats, n, opts) {
    const o = opts || {};
    const rand = o.rand || Math.random;
    const topicAcc = topicAccuracy(questions, qstats || {});
    // Optional per-question multiplier, e.g. from an exam's topic distribution.
    const pool = questions.map(q => ({ q, w: weight(q, (qstats || {})[q.id], topicAcc, o.mistakeKeys) * (o.topicBoost ? o.topicBoost(q) : 1) }));
    const out = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((a, x) => a + x.w, 0);
      let r = rand() * total, i = 0;
      while (i < pool.length - 1 && r >= pool[i].w) { r -= pool[i].w; i++; }
      out.push(pool.splice(i, 1)[0].q);
    }
    return out;
  }

  // Predicted score on the whole bank: each question's smoothed accuracy,
  // falling back to its topic's accuracy, then to the overall rate.
  function predict(questions, qstats) {
    const stats = qstats || {};
    const answered = questions.filter(q => stats[q.id]);
    if (answered.length < 5) return null;
    const topicAcc = topicAccuracy(questions, stats);
    const totals = answered.reduce((a, q) => ({ ok: a.ok + stats[q.id].ok, n: a.n + stats[q.id].n }), { ok: 0, n: 0 });
    const overall = smooth(totals.ok, totals.n);
    const p = questions.map(q => {
      const s = stats[q.id];
      if (s) return smooth(s.ok, s.n);
      const t = topicAcc[q.category || ''];
      return t !== undefined ? t : overall;
    });
    return {
      pct: Math.round(p.reduce((a, b) => a + b, 0) / p.length * 100),
      coverage: Math.round(answered.length / questions.length * 100),
      weakest: Object.entries(topicAcc).filter(([k]) => k).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => k)
    };
  }

  return { pick, predict, weight, topicAccuracy };
})();

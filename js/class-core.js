// ===== Class mode + quiz battles: pure logic =====
// No DOM, no network — classroom.js and battle.js do the I/O. Covered by
// tests/regression.js.
const ClassCore = (() => {
  const list = v => Array.isArray(v) ? v : [];
  const norm = s => String(s == null ? '' : s).toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim().slice(0, 300);
  const cardKey = c => norm(c && c.front);
  const questionKey = q => (q && q.type || 'multiple-choice') + '|' + norm(q && q.question);
  const topicOf = q => String((q && q.category) || '').trim().slice(0, 40) || 'General';
  // Smoothed accuracy (one imagined right and one wrong answer), same as Adaptive.
  const smooth = (ok, n) => (ok + 1) / (n + 2);

  // A teacher pushed a new version of a class deck. Carry the student's
  // progress over by content (card front / question text), not by id, so
  // re-numbered or regenerated items keep their FSRS state and history and
  // removed items simply drop out.
  function remapProgress(oldDeck, newData) {
    const od = (oldDeck && oldDeck.data) || {};
    const out = { srs: {}, qstats: {}, calib: {} };
    const move = (oldItems, newItems, keyOf, src, dst) => {
      if (!src || typeof src !== 'object') return;
      const byKey = new Map();
      list(newItems).forEach(x => { const k = keyOf(x); if (k && !byKey.has(k)) byKey.set(k, x.id); });
      const oldKey = new Map(list(oldItems).map(x => [String(x.id), keyOf(x)]));
      Object.entries(src).forEach(([id, v]) => {
        const k = oldKey.get(id);
        const nid = k && byKey.get(k);
        if (nid != null && !(String(nid) in dst)) dst[String(nid)] = v;
      });
    };
    move(od.flashcards, newData.flashcards, cardKey, oldDeck && oldDeck.srs, out.srs);
    move(od.flashcards, newData.flashcards, cardKey, oldDeck && oldDeck.calib, out.calib);
    move(od.quiz, newData.quiz, questionKey, oldDeck && oldDeck.qstats, out.qstats);
    return out;
  }

  function topN(obj, n, weight) {
    return Object.fromEntries(Object.entries(obj).sort((a, b) => weight(b[1]) - weight(a[1])).slice(0, n));
  }

  // Small aggregated progress for one class deck: mastery %, cards seen,
  // exam accuracy overall and per topic, mistakes per topic.
  function deckReport(deck, now) {
    const data = (deck && deck.data) || {};
    const cards = list(data.flashcards);
    const ids = new Set(cards.map(c => String(c.id)));
    let mastered = 0, seen = 0;
    Object.entries((deck && deck.srs) || {}).forEach(([id, s]) => {
      if (!ids.has(id) || !s) return;
      if (s.reps) seen++;
      if (s.due > now) mastered++;
    });
    const qstats = (deck && deck.qstats) || {};
    let ok = 0, n = 0;
    const topics = {};
    list(data.quiz).forEach(q => {
      const s = qstats[q.id];
      if (!s || !s.n) return;
      ok += s.ok; n += s.n;
      const a = topics[topicOf(q)] = topics[topicOf(q)] || [0, 0];
      a[0] += s.ok; a[1] += s.n;
    });
    const mis = {};
    list(deck && deck.mistakes).forEach(m => { const t = topicOf(m); mis[t] = (mis[t] || 0) + 1; });
    return {
      m: cards.length ? Math.round(mastered / cards.length * 100) : 0,
      seen, n,
      acc: n ? Math.round(ok / n * 100) : null,
      topics: topN(topics, 25, a => a[1]),
      mis: topN(mis, 25, x => x)
    };
  }

  // The report for one class: every library deck that came from it.
  function buildReport(decks, join, now) {
    const out = { decks: {} };
    list(decks).forEach(d => {
      if (d && d.cls && d.cls.join === join && d.cls.id) out.decks[d.cls.id] = deckReport(d, now);
    });
    return out;
  }

  // Teacher dashboard: students × topics, weakest topics, who's behind.
  function aggregate(students, now) {
    const DAY = 86400000;
    const classTopics = {};
    const rows = list(students).map(st => {
      const decks = (st.r && st.r.decks) || {};
      const cells = {};
      let ok = 0, n = 0, mSum = 0, mN = 0, mis = 0;
      Object.values(decks).forEach(d => {
        mSum += d.m || 0; mN++;
        Object.entries(d.topics || {}).forEach(([t, [a, b]]) => {
          const c = cells[t] = cells[t] || { ok: 0, n: 0 };
          c.ok += a; c.n += b; ok += a; n += b;
          const ct = classTopics[t] = classTopics[t] || { ok: 0, n: 0, students: 0 };
          ct.ok += a; ct.n += b;
        });
        Object.values(d.mis || {}).forEach(v => { mis += v; });
      });
      Object.keys(cells).forEach(t => { classTopics[t].students++; cells[t].pct = Math.round(cells[t].ok / cells[t].n * 100); });
      return {
        sid: st.sid, nick: st.nick, t: st.t || 0, joined: st.joined || 0, reported: !!st.r,
        mastery: mN ? Math.round(mSum / mN) : null,
        acc: n ? Math.round(ok / n * 100) : null, n, mis, cells
      };
    });
    const topics = Object.entries(classTopics)
      .map(([name, x]) => ({ name, ok: x.ok, n: x.n, students: x.students, pct: Math.round(x.ok / x.n * 100), score: smooth(x.ok, x.n) }))
      .sort((a, b) => a.score - b.score || b.n - a.n);
    const weakest = topics.filter(t => t.n >= 3 && t.pct < 85).slice(0, 5);
    const withM = rows.filter(r => r.mastery != null);
    const avgM = withM.length ? withM.reduce((a, r) => a + r.mastery, 0) / withM.length : 0;
    const behind = [];
    rows.forEach(r => {
      const why = [];
      if (!r.reported) why.push('noReport');
      else {
        if (now - r.t > 7 * DAY) why.push('inactive');
        if (r.mastery != null && r.mastery < 50 && r.mastery < avgM - 20) why.push('lowMastery');
        if (r.acc != null && r.n >= 5 && r.acc < 50) why.push('lowAccuracy');
      }
      if (why.length) behind.push({ sid: r.sid, nick: r.nick, why });
    });
    return { rows, topics, weakest, behind, avgMastery: Math.round(avgM) };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Revision exam: existing class questions from the weakest topics (weakest
  // first, de-duplicated), re-numbered.
  function revisionQuestions(quizzes, weakTopics, n, rand) {
    const r = rand || Math.random;
    const order = new Map(list(weakTopics).map((t, i) => [t, i]));
    const seen = new Set();
    const pool = [];
    list(quizzes).forEach(qs => list(qs).forEach(q => {
      const k = questionKey(q);
      if (!q || !order.has(topicOf(q)) || seen.has(k)) return;
      seen.add(k);
      pool.push(q);
    }));
    const picked = shuffle(pool, r).sort((a, b) => order.get(topicOf(a)) - order.get(topicOf(b)));
    // Round-robin across topics so one big topic doesn't crowd out the rest.
    const byTopic = list(weakTopics).map(t => picked.filter(q => topicOf(q) === t));
    const out = [];
    while (out.length < n && byTopic.some(b => b.length)) byTopic.forEach(b => { if (b.length && out.length < n) out.push(b.shift()); });
    return out.map((q, i) => ({ ...JSON.parse(JSON.stringify(q)), id: i + 1 }));
  }

  // Exam questions → battle questions { q, o[], c }: multiple choice with 2–5
  // options, and true/false as two options. Others can't be played live.
  function battleQuestions(quiz, labels, max, rand) {
    const out = [];
    list(quiz).forEach(q => {
      if (!q || !String(q.question || '').trim()) return;
      if (q.type === 'true-false' && typeof q.correct === 'boolean') {
        out.push({ q: q.question, o: [labels.t, labels.f], c: q.correct ? 0 : 1 });
      } else if ((!q.type || q.type === 'multiple-choice') && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 5 && Number.isInteger(q.correct)) {
        out.push({ q: q.question, o: q.options.map(String), c: q.correct });
      }
    });
    return (rand ? shuffle(out, rand) : out).slice(0, max || 50);
  }

  return { remapProgress, deckReport, buildReport, aggregate, revisionQuestions, battleQuestions, topicOf };
})();

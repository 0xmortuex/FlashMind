// ===== Personal memory model =====
// FSRS ships with weights fitted on millions of other learners. Every rated
// review is logged per deck (Decks.rlog, compact and capped), and once there
// is enough history this module fits the student's own parameters:
//   - w[0..3]: initial stability after a first Again / Hard / Good / Easy,
//   - c: a global stability multiplier ("you forget c× slower than average").
// Fitting maximises the log-likelihood of every observed recall (grade > 1)
// against the retrievability FSRS predicted at that moment, replaying each
// card's logged history under candidate parameters. The optimizer is plain
// coordinate descent with golden-section line searches in log space, with a
// weak Gaussian prior around the published defaults so sparse data can't
// drag a parameter somewhere silly. Everything here is pure and
// deterministic except the small cache helpers at the bottom.
const Memory = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const FACTOR = 19 / 81;
  const MIN_OBS = 200;      // scored reviews needed before fitting
  const MIN_GAP = 0.5;      // days; same-day re-reviews are not scored
  const CACHE_KEY = 'flashmind_memory_v1';
  const W_BOUNDS = [Math.log(0.1), Math.log(100)];
  const C_BOUNDS = [Math.log(0.25), Math.log(4)];
  const SIGMA_W = 1.0, SIGMA_C = 0.6;
  const SWEEPS = 3, GOLDEN_ITERS = 20;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const recall = (days, stab, c) => Math.pow(1 + FACTOR * days / (stab * c), -0.5);

  function defaults() { return { w: Decks.W.slice(0, 4), c: 1 }; }

  // ----- Log → per-card sequences -----
  // Entry: [cardId, minutes, grade, elapsedDays, stabBefore, diffBefore].
  function sequences(decks) {
    const out = [];
    (decks || []).forEach(d => {
      if (!d || !Array.isArray(d.rlog)) return;
      const by = new Map();
      d.rlog.forEach(e => {
        if (!Array.isArray(e) || e.length < 6 || !Number.isFinite(e[1]) || ![1, 2, 3, 4].includes(e[2])) return;
        const k = String(e[0]);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(e);
      });
      by.forEach((entries, k) => {
        entries.sort((a, b) => a[1] - b[1]);
        out.push({ deckId: d.id, cardId: k, entries, g0: entries[0][4] > 0 ? 0 : entries[0][2] });
      });
    });
    return out;
  }

  // Replays one card's history under P, calling onObs(predictedR, recalled)
  // for every scored review. A log that starts mid-history (older entries were
  // trimmed by the cap) is seeded from the state logged with its first entry.
  function replay(seq, P, onObs) {
    let st = null;
    const es = seq.entries;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      const t = e[1] * 60000, g = e[2];
      if (i === 0 && e[4] > 0) st = { stab: e[4], diff: e[5] || 5, reps: 1, lapses: 0, last: t - (e[3] || 0) * DAY };
      if (st && st.reps) {
        const el = (t - st.last) / DAY;
        if (el >= MIN_GAP) onObs(recall(el, st.stab, P.c), g > 1);
      }
      st = Decks.nextState(st, g, t, P);
    }
  }

  function loglik(seqs, P) {
    let ll = 0, n = 0;
    const obs = (r, y) => { const p = clamp(r, 0.001, 0.999); ll += y ? Math.log(p) : Math.log(1 - p); n++; };
    for (let i = 0; i < seqs.length; i++) replay(seqs[i], P, obs);
    return { ll, n };
  }

  function countObs(seqs) { return loglik(seqs, defaults()).n; }

  // Golden-section minimisation of a unimodal f on [lo, hi].
  function golden(f, lo, hi, iters) {
    const k = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi;
    let x1 = b - k * (b - a), x2 = a + k * (b - a);
    let f1 = f(x1), f2 = f(x2);
    for (let i = 0; i < (iters || GOLDEN_ITERS); i++) {
      if (f1 <= f2) { b = x2; x2 = x1; f2 = f1; x1 = b - k * (b - a); f1 = f(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + k * (b - a); f2 = f(x2); }
    }
    return f1 <= f2 ? x1 : x2;
  }

  const toP = th => ({ w: th.slice(0, 4).map(Math.exp), c: Math.exp(th[4]) });

  // MAP fit of [ln w1..ln w4, ln c]. w_g only influences cards whose logged
  // history starts with a first review of grade g, so its line search only
  // replays those — the fit stays cheap enough to run on a Stats render.
  function fit(seqs) {
    const base = defaults();
    const prior = base.w.map(Math.log).concat([0]);
    const th = prior.slice();
    const groups = [1, 2, 3, 4].map(g => seqs.filter(s => s.g0 === g));
    const objective = (subset, idx, sigma) => x => {
      const cand = th.slice(); cand[idx] = x;
      return -loglik(subset, toP(cand)).ll + (x - prior[idx]) ** 2 / (2 * sigma * sigma);
    };
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      for (let g = 0; g < 4; g++) {
        if (!groups[g].length) continue;
        th[g] = golden(objective(groups[g], g, SIGMA_W), W_BOUNDS[0], W_BOUNDS[1]);
      }
      th[4] = golden(objective(seqs, 4, SIGMA_C), C_BOUNDS[0], C_BOUNDS[1]);
    }
    const P = toP(th);
    const r3 = v => Math.round(v * 1000) / 1000;
    const mine = loglik(seqs, P), avg = loglik(seqs, base);
    return {
      w: P.w.map(r3), c: r3(P.c), fitted: true, n: mine.n,
      ll: mine.ll, llDefault: avg.ll,
      firsts: groups.map(gr => gr.filter(s => s.entries.length > 1).length)
    };
  }

  // Predicted-vs-actual recall in buckets of predicted retrievability, for
  // both the personal and the default model (same observations).
  const BIN_EDGES = [0, 0.7, 0.8, 0.9, 0.95, 1.01];
  function calibration(seqs, P) {
    const mine = [], avg = [];
    seqs.forEach(s => {
      replay(s, P, (r, y) => mine.push([r, y]));
      replay(s, defaults(), r => avg.push(r));
    });
    const bins = BIN_EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: BIN_EDGES[i + 1], n: 0, pred: 0, predDefault: 0, actual: 0 }));
    mine.forEach(([r, y], i) => {
      const b = bins.find(x => r >= x.lo && r < x.hi);
      if (!b) return;
      b.n++; b.pred += r; b.predDefault += avg[i]; b.actual += y ? 1 : 0;
    });
    bins.forEach(b => { if (b.n) { b.pred /= b.n; b.predDefault /= b.n; b.actual /= b.n; } });
    const mae = list => { const used = bins.filter(b => b.n); const tot = used.reduce((a, b) => a + b.n, 0);
      return tot ? used.reduce((a, b) => a + b.n * Math.abs(list(b) - b.actual), 0) / tot : 0; };
    return { bins, n: mine.length, errMine: mae(b => b.pred), errDefault: mae(b => b.predDefault) };
  }

  // ----- Forecast -----
  // Recall of one card at time `at` if studying stopped now.
  function recallAt(s, at, P) {
    if (!s || !s.reps || !s.stab) return 0;
    return recall(Math.max(0, (at - (s.last || at)) / DAY), s.stab, (P && P.c) || 1);
  }

  // Recall at `exam` if every scheduled review (exam-capped) is done and
  // passed with Good; never-seen cards are learned at `learnAt`.
  function keepUpRecall(s, exam, examDate, P, now, learnAt) {
    let st;
    if (!s || !s.reps) {
      if (learnAt == null || learnAt >= exam) return 0;
      st = Decks.nextState(null, 3, learnAt, P);
      st.due = Decks.capForExam(examDate, learnAt + Decks.intervalDays(st.stab, P) * DAY, learnAt);
    } else st = Object.assign({}, s, { due: s.due || now });
    for (let guard = 0; guard < 24 && st.due < exam; guard++) {
      const at = Math.max(st.due, now);
      const due = st.due;
      st = Decks.nextState(st, 3, at, P);
      st.due = Decks.capForExam(examDate, at + Decks.intervalDays(st.stab, P) * DAY, at);
      if (st.due <= due) break;
    }
    return recallAt(st, exam, P);
  }

  // Per-topic forecast for one deck at `horizon` (exam start or any time).
  // stop: no more study; keep: every scheduled review done; seen-only means
  // ignore never-seen cards. Topics are card categories.
  function forecast(deck, horizon, P, now) {
    P = P || current() || defaults();
    now = now == null ? Date.now() : now;
    const cards = deck && deck.data && Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
    const srs = (deck && deck.srs) || {};
    const examDate = deck && deck.examDate && Decks.examStart(deck.examDate) === horizon ? deck.examDate : null;
    const unseen = cards.filter(c => !(srs[c.id] && srs[c.id].reps));
    const studyDays = Math.max(1, Math.floor((horizon - now) / DAY) - 1);
    const learnIdx = new Map(unseen.map((c, i) => [c.id, i]));
    const topics = new Map();
    const tot = { n: 0, seen: 0, stop: 0, keep: 0, now: 0 };
    cards.forEach(c => {
      const s = srs[c.id];
      const seen = !!(s && s.reps);
      const li = learnIdx.get(c.id);
      const learnAt = seen ? null : (horizon - now < DAY ? now : now + Math.floor(li * studyDays / Math.max(1, unseen.length)) * DAY);
      const stop = recallAt(s, horizon, P);
      const keep = keepUpRecall(s, horizon, examDate, P, now, learnAt);
      const rn = recallAt(s, now, P);
      const name = c.category || '';
      const t = topics.get(name) || { name, n: 0, seen: 0, stop: 0, keep: 0, now: 0 };
      [t, tot].forEach(a => { a.n++; a.stop += stop; a.keep += keep; if (seen) { a.seen++; a.now += rn; } });
      topics.set(name, t);
    });
    const fin = a => ({ name: a.name, n: a.n, seen: a.seen,
      stop: a.n ? a.stop / a.n : 0, keep: a.n ? a.keep / a.n : 0, now: a.seen ? a.now / a.seen : 0 });
    return { horizon, total: fin(tot), topics: [...topics.values()].map(fin).sort((a, b) => a.stop - b.stop) };
  }

  // ----- Cache (device-local; params are derivable from the synced logs) -----
  let cache = null; // { sig, P }

  function signature(decks) {
    let n = 0, last = 0;
    (decks || []).forEach(d => { if (Array.isArray(d.rlog) && d.rlog.length) { n += d.rlog.length; last = Math.max(last, d.rlog[d.rlog.length - 1][1] || 0); } });
    return n + ':' + last;
  }

  function loadCache() {
    if (cache) return;
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch (e) { cache = null; }
    if (!cache || typeof cache !== 'object' || !cache.P || !Array.isArray(cache.P.w) || cache.P.w.length !== 4 ||
      !cache.P.w.every(v => Number.isFinite(v) && v > 0) || !(cache.P.c > 0)) cache = null;
  }

  // Fitted params for scheduling, or null (defaults) — never computes.
  function current() {
    loadCache();
    return cache && cache.P.fitted ? cache.P : null;
  }

  // Entries logged after time t (minutes), across decks.
  function newSince(decks, t) {
    let n = 0;
    (decks || []).forEach(d => { if (Array.isArray(d.rlog)) d.rlog.forEach(e => { if (Array.isArray(e) && e[1] > t) n++; }); });
    return n;
  }

  function lastT(decks) {
    let t = 0;
    (decks || []).forEach(d => { if (Array.isArray(d.rlog) && d.rlog.length) t = Math.max(t, d.rlog[d.rlog.length - 1][1] || 0); });
    return t;
  }

  // Refit when the logs changed since the last fit. Called lazily (Stats
  // render, coach button) — never on the review path. Once fitted, a refit
  // waits for REFIT_EVERY new reviews so the cost is paid rarely.
  const REFIT_EVERY = 25;
  function ensure(decks) {
    decks = decks || (typeof Decks !== 'undefined' ? Decks.list() : []);
    loadCache();
    const sig = signature(decks);
    if (cache && cache.sig === sig) return cache.P;
    if (cache && cache.P.fitted && newSince(decks, cache.lastT || 0) < REFIT_EVERY) return cache.P;
    const seqs = sequences(decks);
    const n = countObs(seqs);
    const P = n >= MIN_OBS ? fit(seqs) : Object.assign(defaults(), { fitted: false, n });
    cache = { sig, lastT: lastT(decks), P };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* derived data */ }
    return P;
  }

  // Everything the Stats card needs, memoised on the log signature.
  let reportMemo = null;
  function report(decks) {
    decks = decks || Decks.list();
    const P = ensure(decks);
    const sig = signature(decks) + '|' + P.n + '|' + P.c;
    if (reportMemo && reportMemo.sig === sig) return reportMemo.r;
    const r = { P, need: MIN_OBS, cal: P.fitted ? calibration(sequences(decks), P) : null };
    reportMemo = { sig, r };
    return r;
  }

  // ----- Stats card -----
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function pct(v) { return Math.round(v * 100); }

  function calChart(cal) {
    const W = 560, H = 150, PAD = 28;
    const bins = cal.bins.filter(b => b.n);
    if (!bins.length) return '';
    const x = v => PAD + (v - 0.5) / 0.5 * (W - PAD * 2);
    const y = v => H - 22 - (v - 0.4) / 0.6 * (H - 40);
    let g = `<line x1="${x(0.5)}" y1="${y(0.5)}" x2="${x(1)}" y2="${y(1)}" class="mem-diag"/>`;
    [0.5, 0.75, 1].forEach(v => {
      g += `<text x="${x(v)}" y="${H - 6}" class="stat-axis" text-anchor="middle">${pct(v)}%</text>`;
      g += `<text x="4" y="${y(v) + 4}" class="stat-axis">${pct(v)}%</text>`;
    });
    bins.forEach(b => {
      const px = x(Math.max(0.5, b.pred));
      const r = Math.min(9, 3 + Math.sqrt(b.n) / 2);
      g += `<circle cx="${x(Math.max(0.5, b.predDefault)).toFixed(1)}" cy="${y(Math.max(0.4, b.actual)).toFixed(1)}" r="${r.toFixed(1)}" class="mem-dot avg"><title>${i18n.t('memAvgModel')}: ${pct(b.predDefault)}% → ${pct(b.actual)}% (${b.n})</title></circle>`;
      g += `<circle cx="${px.toFixed(1)}" cy="${y(Math.max(0.4, b.actual)).toFixed(1)}" r="${r.toFixed(1)}" class="mem-dot mine"><title>${i18n.t('memYourModel')}: ${pct(b.pred)}% → ${pct(b.actual)}% (${b.n})</title></circle>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="stat-chart mem-chart" role="img" aria-label="${esc(i18n.t('memCalAria'))}">${g}</svg>
      <div class="mem-legend"><span><i class="mem-key mine"></i>${i18n.t('memYourModel')}</span><span><i class="mem-key avg"></i>${i18n.t('memAvgModel')}</span><span class="mem-legend-note">${i18n.t('memCalAxes')}</span></div>`;
  }

  function differenceLine(P) {
    const T = i18n.t;
    const lines = [];
    if (P.c >= 1.1) lines.push(T('memSlower', { x: P.c.toFixed(1) }));
    else if (P.c <= 0.9) lines.push(T('memFaster', { x: (1 / P.c).toFixed(1) }));
    else lines.push(T('memAverage'));
    const d = defaults();
    if (P.firsts && P.firsts[2] >= 10) lines.push(T('memFirstGood', { a: (P.w[2] * P.c).toFixed(1), b: d.w[2].toFixed(1) }));
    return lines.map(l => `<p class="mem-line">${l}</p>`).join('');
  }

  // Forecast for the active deck: exam day when set, else a week out.
  function forecastHtml(deck) {
    const T = i18n.t;
    if (!deck) return '';
    const now = Date.now();
    const exam = deck.examDate ? Decks.examStart(deck.examDate) : null;
    const horizon = exam && exam > now ? exam : now + 7 * DAY;
    const days = exam && exam > now ? Math.max(1, Math.round((horizon - new Date(now).setHours(0, 0, 0, 0)) / DAY)) : 7;
    const f = forecast(deck, horizon, null, now);
    if (!f.total.n || !f.total.seen) return `<p class="plan-pitch">${T('memForecastEmpty')}</p>`;
    const rows = f.topics.slice(0, 8).map(t => {
      const s = pct(t.stop), k = pct(t.keep);
      return `<div class="mem-topic">
        <span class="mem-topic-name">${esc(t.name || T('memNoTopic'))}</span>
        <span class="qb-bar mem-bar" title="${T('memStopKeep', { s, k })}"><span class="mem-keep" style="width:${k}%"></span><span class="qb-fill ${s >= 75 ? 'good' : s >= 50 ? 'mid' : 'bad'}" style="width:${s}%"></span></span>
        <span class="mem-topic-num">${s}%<small> → ${k}%</small></span>
      </div>`;
    }).join('');
    const worst = f.topics.find(t => t.n >= 2) || f.topics[0];
    return `<p class="mem-forecast-lead">${T(exam && exam > now ? 'memForecastExam' : 'memForecastWeek', { n: days, p: pct(worst.stop), t: esc(worst.name || T('memNoTopic')) })}</p>
      <div class="mem-topics">${rows}</div>
      <p class="mem-legend-note">${T('memForecastLegend')}</p>`;
  }

  function statsCard() {
    if (typeof Decks === 'undefined') return '';
    const T = i18n.t;
    const decks = Decks.list();
    if (!decks.some(d => Array.isArray(d.rlog) && d.rlog.length)) return '';
    const { P, need, cal } = report(decks);
    const deck = Decks.getActive();
    let model;
    if (!P.fitted) {
      const have = P.n || 0;
      model = `<p class="plan-pitch">${T('memCollecting', { n: have, need })}</p>
        <div class="plan-meter" role="img" aria-label="${have}/${need}"><span style="width:${Math.min(100, Math.round(have / need * 100))}%"></span></div>`;
    } else {
      model = `${differenceLine(P)}
        ${calChart(cal)}
        <p class="mem-legend-note">${T('memFitNote', { n: P.n, a: (cal.errDefault * 100).toFixed(1), b: (cal.errMine * 100).toFixed(1) })}</p>`;
    }
    return `<div class="stat-card mem-card" id="memory-card">
      <h3 class="stat-card-title">&#129504; ${T('memTitle')}</h3>
      ${model}
      ${forecastHtml(deck)}
    </div>`;
  }

  return {
    MIN_OBS, defaults, sequences, replay, loglik, fit, golden, calibration,
    recallAt, keepUpRecall, forecast, current, ensure, report, statsCard, signature
  };
})();

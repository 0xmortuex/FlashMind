// ===== Stats Module =====
// Records study activity (card reviews, exam results) and renders the Stats
// tab: streak, totals, a 14-day review bar chart, and exam history — all in
// dependency-free inline SVG.
const Stats = (() => {
  const KEY = 'flashmind_stats_v1';
  const MAX_EXAMS = 50;
  let data = null; // { days: {'YYYY-MM-DD': {reviews, gotit}}, exams: [{t, pct, grade, title}] }

  function load() {
    if (data) return data;
    try { data = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { data = null; }
    if (!data || typeof data.days !== 'object') data = { days: {}, exams: [] };
    if (!Array.isArray(data.exams)) data.exams = [];
    // Streak freezes: earned every 7 studied days, consumed automatically to
    // bridge a single missed day so one quiet day doesn't zero the streak.
    if (typeof data.freezes !== 'number') data.freezes = 0;
    if (typeof data.freezeMeter !== 'number') data.freezeMeter = 0;
    if (!data.frozen || typeof data.frozen !== 'object') data.frozen = {};
    return data;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* non-fatal */ }
    if (typeof Sync !== 'undefined' && Sync.schedulePush) Sync.schedulePush();
  }

  // Merge remote stats (device sync): per-day counts take the max (avoids
  // double-counting), exam history unions by timestamp.
  function mergeRemote(remoteJson) {
    load();
    let remote;
    try { remote = typeof remoteJson === 'string' ? JSON.parse(remoteJson) : remoteJson; }
    catch (e) { return false; }
    if (!remote || typeof remote !== 'object') return false;
    let changed = false;
    Object.entries(remote.days || {}).forEach(([k, day]) => {
      if (!day) return;
      const local = data.days[k];
      if (!local || (day.reviews || 0) > local.reviews) {
        data.days[k] = {
          reviews: Math.max(day.reviews || 0, local ? local.reviews : 0),
          gotit: Math.max(day.gotit || 0, local ? local.gotit : 0)
        };
        changed = true;
      }
    });
    const have = new Set(data.exams.map(e => e.t));
    (remote.exams || []).forEach(e => {
      if (e && e.t && !have.has(e.t)) { data.exams.push(e); changed = true; }
    });
    if (changed) {
      data.exams.sort((a, b) => a.t - b.t);
      if (data.exams.length > MAX_EXAMS) data.exams = data.exams.slice(-MAX_EXAMS);
      persist();
    }
    return changed;
  }

  function dayKey(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ----- Recording -----

  function recordReview(rating) {
    load();
    const k = dayKey(Date.now());
    const firstToday = !data.days[k];
    const day = data.days[k] || { reviews: 0, gotit: 0 };
    day.reviews += 1;
    if (rating === 'gotit') day.gotit += 1;
    data.days[k] = day;
    // Every 7 studied days earns a streak freeze (held max 2).
    if (firstToday) {
      data.freezeMeter += 1;
      if (data.freezeMeter >= 7) {
        data.freezeMeter = 0;
        if (data.freezes < 2) data.freezes += 1;
      }
    }
    persist();
  }

  function recordExam(pct, grade, title) {
    load();
    data.exams.push({ t: Date.now(), pct, grade, title: title || '' });
    if (data.exams.length > MAX_EXAMS) data.exams = data.exams.slice(-MAX_EXAMS);
    persist();
  }

  // ----- Derived numbers -----

  function streak() {
    load();
    let n = 0, spent = false;
    const d = new Date();
    // Today counts if studied; otherwise the streak may still be alive from
    // yesterday, so a quiet today doesn't zero it.
    if (!data.days[dayKey(d.getTime())]) d.setDate(d.getDate() - 1);
    while (true) {
      const k = dayKey(d.getTime());
      if (data.days[k]) {
        n++;
      } else if (data.frozen[k]) {
        // Already bridged by a freeze on an earlier computation.
      } else if (n > 0 && data.freezes > 0) {
        // Gap inside a live streak — spend a freeze to bridge it.
        data.freezes -= 1;
        data.frozen[k] = true;
        spent = true;
      } else {
        break;
      }
      d.setDate(d.getDate() - 1);
    }
    if (spent) persist();
    return n;
  }

  function freezes() { load(); return data.freezes; }

  function totalReviews() {
    load();
    return Object.values(data.days).reduce((s, d) => s + d.reviews, 0);
  }

  // ----- Rendering -----

  function esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function tile(value, label) {
    return `<div class="stat-tile"><span class="stat-tile-value">${value}</span><span class="stat-tile-label">${label}</span></div>`;
  }

  // Vertical bar chart of reviews for the last `days` days.
  function barChart(days) {
    load();
    const W = 560, H = 140, PAD = 4;
    const bw = (W - PAD * 2) / days;
    const series = [];
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const day = data.days[dayKey(d.getTime())];
      series.push({ n: day ? day.reviews : 0, label: (d.getMonth() + 1) + '/' + d.getDate() });
      d.setDate(d.getDate() + 1);
    }
    const max = Math.max(4, ...series.map(s => s.n));
    let bars = '';
    series.forEach((s, i) => {
      const h = s.n === 0 ? 2 : Math.max(3, (s.n / max) * (H - 34));
      const x = PAD + i * bw + bw * 0.15;
      const y = H - 22 - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="--i:${i}" class="${s.n ? 'stat-bar' : 'stat-bar empty'}"><title>${s.label}: ${s.n}</title></rect>`;
      if (s.n > 0) bars += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 5).toFixed(1)}" style="--i:${i}" class="stat-bar-num" text-anchor="middle">${s.n}</text>`;
      if (i === 0 || i === days - 1 || i === Math.floor(days / 2)) {
        bars += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 7}" class="stat-axis" text-anchor="middle">${s.label}</text>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="stat-chart" role="img">${bars}</svg>`;
  }

  // GitHub-style activity heatmap of the last ~26 weeks of reviews.
  function heatmap() {
    load();
    const WEEKS = 26, CELL = 10, GAP = 2;
    const W = WEEKS * (CELL + GAP) + 30, H = 7 * (CELL + GAP) + 18;
    // Start on the Monday at least 26 weeks back.
    const start = new Date();
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
    const today = dayKey(Date.now());
    let cells = '', maxN = 1;
    const grid = [];
    const d = new Date(start);
    for (let w = 0; w < WEEKS + 1; w++) {
      for (let r = 0; r < 7; r++) {
        const k = dayKey(d.getTime());
        const n = data.days[k] ? data.days[k].reviews : 0;
        if (k > today) break;
        grid.push({ w, r, k, n });
        maxN = Math.max(maxN, n);
        d.setDate(d.getDate() + 1);
      }
    }
    grid.forEach(c => {
      const level = c.n === 0 ? 0 : Math.min(4, Math.ceil((c.n / maxN) * 4));
      cells += `<rect x="${26 + c.w * (CELL + GAP)}" y="${c.r * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="2.5" class="heat-cell heat-${level}"><title>${c.k}: ${c.n}</title></rect>`;
    });
    // Weekday hints (Mon/Fri rows).
    const days = i18n.getLang() === 'tr' ? ['Pzt', 'Cum'] : ['Mon', 'Fri'];
    const labels = `<text x="0" y="${CELL - 2}" class="stat-axis">${days[0]}</text>
      <text x="0" y="${4 * (CELL + GAP) + CELL - 2}" class="stat-axis">${days[1]}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="stat-chart heatmap" role="img">${labels}${cells}</svg>`;
  }

  // Due-count forecast for the next 7 days (from the active deck's SRS state).
  function forecast() {
    const deck = Decks.getActive();
    if (!deck) return '';
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const buckets = new Array(7).fill(0);
    Object.values(deck.srs || {}).forEach(s => {
      if (!s || !s.due) return;
      const idx = s.due <= now ? 0 : Math.floor((s.due - now) / DAY) + 1;
      if (idx < 7) buckets[idx] += 1;
    });
    if (!buckets.some(n => n)) return '';
    const W = 560, H = 120, PAD = 8;
    const bw = (W - PAD * 2) / 7;
    const max = Math.max(...buckets, 3);
    const lang = i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US';
    let bars = '';
    buckets.forEach((n, i) => {
      const h = n === 0 ? 2 : Math.max(3, (n / max) * (H - 40));
      const x = PAD + i * bw + bw * 0.2;
      const y = H - 24 - h;
      const d = new Date(now + i * DAY);
      const label = i === 0 ? i18n.t('todayLabel') : d.toLocaleDateString(lang, { weekday: 'short' });
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="--i:${i}" class="${n ? 'stat-bar forecast-bar' : 'stat-bar empty'}"><title>${label}: ${n}</title></rect>`;
      if (n > 0) bars += `<text x="${(x + bw * 0.3).toFixed(1)}" y="${(y - 5).toFixed(1)}" style="--i:${i}" class="stat-bar-num" text-anchor="middle">${n}</text>`;
      bars += `<text x="${(x + bw * 0.3).toFixed(1)}" y="${H - 8}" class="stat-axis" text-anchor="middle">${label}</text>`;
    });
    return `<div class="stat-card"><h3 class="stat-card-title">${i18n.t('forecastTitle')}</h3>
      <svg viewBox="0 0 ${W} ${H}" class="stat-chart" role="img">${bars}</svg></div>`;
  }

  // Line chart of the last exams' scores (0-100).
  function examChart(exams) {
    const W = 560, H = 140, PADX = 14, PADY = 16;
    const n = exams.length;
    if (n === 0) return '';
    const step = n > 1 ? (W - PADX * 2) / (n - 1) : 0;
    const pt = (e, i) => {
      const x = n > 1 ? PADX + i * step : W / 2;
      const y = PADY + (1 - e.pct / 100) * (H - PADY * 2);
      return [x, y];
    };
    let path = '', dots = '';
    exams.forEach((e, i) => {
      const [x, y] = pt(e, i);
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" style="--i:${i}" class="stat-dot"><title>${esc(e.title)}: ${e.pct}</title></circle>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="stat-chart" role="img">
      <line x1="${PADX}" y1="${PADY}" x2="${W - PADX}" y2="${PADY}" class="stat-grid"/>
      <line x1="${PADX}" y1="${H - PADY}" x2="${W - PADX}" y2="${H - PADY}" class="stat-grid"/>
      ${n > 1 ? `<path d="${path}" pathLength="1" class="stat-line"/>` : ''}${dots}
    </svg>`;
  }

  function render() {
    load();
    const T = i18n.t;
    const container = document.getElementById('tab-stats');
    if (!container) return;

    const deck = Decks.getActive();
    const cards = deck && deck.data && Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
    const due = Decks.dueCards(cards).length;
    const reviews = totalReviews();
    const exams = data.exams;

    if (reviews === 0 && exams.length === 0) {
      container.innerHTML = `
        <div class="stats-container">
          <div class="empty-state">
            <svg viewBox="0 0 72 72" fill="none">
              <rect x="10" y="34" width="10" height="24" rx="3" stroke="currentColor" stroke-width="2.5"/>
              <rect x="31" y="22" width="10" height="36" rx="3" stroke="currentColor" stroke-width="2.5"/>
              <rect x="52" y="42" width="10" height="16" rx="3" stroke="currentColor" stroke-width="2.5"/>
              <path d="M12 24c8-10 18-12 26-8s14 2 22-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 5"/>
            </svg>
            <p>${T('noStatsYet')}</p>
          </div>
        </div>`;
      return;
    }

    const lastExams = exams.slice(-12);
    let examRows = '';
    exams.slice(-6).reverse().forEach(e => {
      const date = new Date(e.t).toLocaleDateString(i18n.getLang() === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' });
      examRows += `<div class="exam-row"><span class="exam-row-title">${esc(e.title) || '—'}</span><span class="exam-row-date">${date}</span><span class="exam-row-grade">${esc(e.grade)}</span><span class="exam-row-pct">${e.pct}</span></div>`;
    });

    container.innerHTML = `
      <div class="stats-container">
        <div class="stat-tiles">
          ${tile(`<span class="flame">&#128293;</span> <span data-count="${streak()}">0</span>`, T('statStreak'))}
          ${data.freezes > 0 ? tile(`&#129482; ${data.freezes}`, T('statFreezes')) : ''}
          ${tile(`<span data-count="${reviews}">0</span>`, T('statReviews'))}
          ${tile(`<span data-count="${due}">0</span>`, T('statDue'))}
          ${tile(`<span data-count="${exams.length}">0</span>`, T('statExams'))}
        </div>
        <div class="stat-card">
          <h3 class="stat-card-title">${T('reviewsLast14')}</h3>
          ${barChart(14)}
        </div>
        ${forecast()}
        <div class="stat-card">
          <h3 class="stat-card-title">${T('activityTitle')}</h3>
          ${heatmap()}
        </div>
        ${exams.length ? `
        <div class="stat-card">
          <h3 class="stat-card-title">${T('examHistory')}</h3>
          ${examChart(lastExams)}
          <div class="exam-rows">${examRows}</div>
        </div>` : ''}
        <div class="stat-card">
          <h3 class="stat-card-title">${T('weeklyTitle')}</h3>
          <div id="weekly-report-body">${weeklyCache
            ? `<div class="weekly-report-text">${esc(weeklyCache)}</div>`
            : `<button class="btn-ghost" id="weekly-report-btn">&#10024; ${T('weeklyBtn')}</button>`}
          </div>
        </div>
      </div>`;

    const weeklyBtn = document.getElementById('weekly-report-btn');
    if (weeklyBtn) weeklyBtn.addEventListener('click', weeklyReport);

    // Bring the numbers to life: tiles cascade in and count up.
    container.querySelectorAll('.stat-tile').forEach((el, i) => el.style.setProperty('--i', i));
    container.querySelectorAll('[data-count]').forEach(el =>
      FX.countUp(el, parseInt(el.dataset.count, 10) || 0, { duration: 800 }));
  }

  // ===== AI weekly report =====
  // One paragraph-style report generated from the raw last-7-days numbers.
  // Cached per session so tab switches don't re-bill the API.
  let weeklyCache = null;

  async function weeklyReport() {
    const body = document.getElementById('weekly-report-body');
    if (!body) return;
    body.innerHTML = `<div class="chat-loading"><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div></div>`;
    load();
    const lines = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      const k = dayKey(d.getTime());
      const e = data.days[k];
      lines.push(`${k}: ${e ? e.reviews : 0} reviews (${e ? e.gotit : 0} correct)`);
      d.setDate(d.getDate() + 1);
    }
    const exams = data.exams.filter(e => Date.now() - e.t < 7 * 86400000)
      .map(e => `${e.title || 'exam'}: ${e.pct}/100 (${e.grade})`);
    const weak = {};
    const deck = typeof Decks !== 'undefined' ? Decks.getActive() : null;
    if (deck && deck.data && Array.isArray(deck.data.flashcards)) {
      deck.data.flashcards.forEach(c => {
        const s = (deck.srs || {})[c.id];
        if (s && s.lapses > 0 && c.category) weak[c.category] = (weak[c.category] || 0) + 1;
      });
    }
    const prompt = 'Write my weekly study report as a short, motivating summary (max 120 words, plain text, no lists needed). ' +
      'Mention the trend, my weakest area, and ONE concrete suggestion for next week.\n' +
      `Current streak: ${streak()} days.\n` +
      'Reviews per day, last 7 days:\n' + lines.join('\n') +
      (exams.length ? '\nExams this week:\n' + exams.join('\n') : '\nNo exams this week.') +
      (Object.keys(weak).length ? '\nCategories with forgotten cards: ' +
        Object.entries(weak).sort((a, b) => b[1] - a[1]).map(e => `${e[0]} (${e[1]})`).join(', ') : '');
    try {
      const raw = await API.chat(prompt, '');
      const parsed = Parser.parseChat(raw);
      weeklyCache = parsed.answer || '';
      body.innerHTML = `<div class="weekly-report-text">${esc(weeklyCache)}</div>`;
    } catch (err) {
      body.innerHTML = `<button class="btn-ghost" id="weekly-report-btn">&#10024; ${i18n.t('weeklyBtn')}</button>`;
      const again = document.getElementById('weekly-report-btn');
      if (again) again.addEventListener('click', weeklyReport);
      App.showToast(i18n.t('chatError'), 'error');
    }
  }

  return { recordReview, recordExam, render, streak, freezes, mergeRemote };
})();
